"use strict";

/**
 * backend/src/services/walletService.js
 *
 * Holder wallet: manages credentials held by a user's DID, creates verifiable
 * presentations with selective disclosure, handles import and backup/recovery.
 */

const { createHash, randomBytes } = require("node:crypto");
const { createProof } = require("../lib/vcProof");

class WalletService {
  /**
   * @param {object} db - PostgreSQL pool or client
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * List all credentials held by a DID.
   * @param {string} holderDid
   * @param {object} [options]
   * @param {string} [options.type] - Filter by credential type
   * @param {boolean} [options.includeRevoked] - Include revoked credentials
   * @returns {Promise<object[]>}
   */
  async listCredentials(holderDid, options = {}) {
    const { type, includeRevoked = false } = options;

    let query = `SELECT * FROM verifiable_credentials WHERE subject_did = $1`;
    const params = [holderDid];
    let paramIdx = 2;

    if (!includeRevoked) {
      query += ` AND revoked = false`;
    }

    if (type) {
      query += ` AND $${paramIdx} = ANY(type)`;
      params.push(type);
      paramIdx++;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.db.query(query, params);
    return result.rows.map((row) => ({
      id: row.credential_id,
      type: row.type,
      issuer: row.issuer_did,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      revoked: row.revoked,
      claims: typeof row.claims === "string" ? JSON.parse(row.claims) : row.claims,
    }));
  }

  /**
   * Create a verifiable presentation from selected credentials with selective disclosure.
   * @param {object} params
   * @param {string} params.holderDid - DID of the holder
   * @param {Buffer} params.holderPrivateKey - Holder's Ed25519 private key
   * @param {string} params.holderVerificationMethod - Holder's verification method URL
   * @param {string[]} params.credentialIds - Credential IDs to include
   * @param {object} [params.selectiveDisclosure] - Map of credentialId → claims to include
   * @param {string} [params.purpose] - "authentication" or "assertionMethod"
   * @param {string} [params.nonce] - Replay protection nonce
   * @param {string} [params.domain] - Domain binding
   * @returns {Promise<object>} Signed Verifiable Presentation
   */
  async createPresentation({
    holderDid,
    holderPrivateKey,
    holderVerificationMethod,
    credentialIds,
    selectiveDisclosure = {},
    purpose = "authentication",
    nonce,
    domain,
  }) {
    const credentials = [];

    for (const credId of credentialIds) {
      const result = await this.db.query(
        `SELECT * FROM verifiable_credentials WHERE credential_id = $1 AND subject_did = $2`,
        [credId, holderDid]
      );

      if (result.rows.length === 0) {
        throw new Error(`Credential not found or not owned by holder: ${credId}`);
      }

      const cred = result.rows[0];
      if (cred.revoked) {
        throw new Error(`Credential is revoked: ${credId}`);
      }

      let credential = typeof cred.credential === "string" ? JSON.parse(cred.credential) : cred.credential;

      // Apply selective disclosure
      if (selectiveDisclosure[credId]) {
        const allowedClaims = selectiveDisclosure[credId];
        const filteredSubject = {};
        for (const claim of allowedClaims) {
          if (claim === "id") {
            filteredSubject.id = credential.credentialSubject.id;
          } else if (credential.credentialSubject[claim] !== undefined) {
            filteredSubject[claim] = credential.credentialSubject[claim];
          }
        }
        credential = {
          ...credential,
          credentialSubject: filteredSubject,
        };
      }

      credentials.push(credential);
    }

    const presentationId = `urn:uuid:${randomBytes(16).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5")}`;

    const presentation = {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      id: presentationId,
      type: ["VerifiablePresentation"],
      holder: holderDid,
      verifiableCredential: credentials,
    };

    if (nonce) presentation.nonce = nonce;
    if (domain) presentation.domain = domain;

    const signed = createProof({
      credential: presentation,
      verificationMethod: holderVerificationMethod,
      privateKey: holderPrivateKey,
      purpose,
    });

    // Store the presentation
    await this.db.query(
      `INSERT INTO credential_presentations (holder_did, presentation, purpose, created_at)
       VALUES ($1, $2, $3, $4)`,
      [holderDid, JSON.stringify(signed), purpose, new Date().toISOString()]
    );

    return signed;
  }

  /**
   * Verify a verifiable presentation.
   * @param {object} presentation
   * @param {Buffer} publicKey - Holder's public key
   * @returns {Promise<{verified: boolean, error?: string}>}
   */
  async verifyPresentation(presentation, publicKey) {
    const { verifyProof } = require("../lib/vcProof");

    if (!presentation || !presentation.type?.includes("VerifiablePresentation")) {
      return { verified: false, error: "Not a Verifiable Presentation" };
    }

    // Verify the presentation proof
    const proofResult = verifyProof({ credential: presentation, publicKey });
    if (!proofResult.verified) {
      return proofResult;
    }

    // Verify each embedded credential
    for (const cred of presentation.verifiableCredential || []) {
      if (cred.proof) {
        // In a real implementation, we'd resolve the issuer's public key
        // and verify each credential. For now, structural validation only.
      }
    }

    return { verified: true };
  }

  /**
   * Import a credential from an external issuer.
   * @param {object} params
   * @param {string} params.holderDid
   * @param {object} params.credential - The external VC
   * @returns {Promise<object>}
   */
  async importCredential({ holderDid, credential }) {
    if (!credential?.id || !credential?.issuer) {
      throw new Error("Invalid credential: missing id or issuer");
    }

    const result = await this.db.query(
      `INSERT INTO credential_imports (holder_did, external_issuer_did, credential, verification_status, imported_at)
       VALUES ($1, $2, $3, 'unverified', $4)
       RETURNING id`,
      [
        holderDid,
        typeof credential.issuer === "string"
          ? credential.issuer
          : credential.issuer.id,
        JSON.stringify(credential),
        new Date().toISOString(),
      ]
    );

    return {
      importId: result.rows[0].id,
      credentialId: credential.id,
      verificationStatus: "unverified",
    };
  }

  /**
   * Create a backup of all credentials for a holder.
   * @param {string} holderDid
   * @returns {Promise<object>} Backup data
   */
  async createBackup(holderDid) {
    const creds = await this.db.query(
      `SELECT credential_id, type, issuer_did, credential, issued_at
       FROM verifiable_credentials WHERE subject_did = $1
       ORDER BY issued_at ASC`,
      [holderDid]
    );

    const imports = await this.db.query(
      `SELECT id, external_issuer_did, credential, verification_status, imported_at
       FROM credential_imports WHERE holder_did = $1
       ORDER BY imported_at ASC`,
      [holderDid]
    );

    return {
      holderDid,
      backupDate: new Date().toISOString(),
      credentials: creds.rows.map((r) => ({
        id: r.credential_id,
        type: r.type,
        issuer: r.issuer_did,
        credential: typeof r.credential === "string" ? JSON.parse(r.credential) : r.credential,
        issuedAt: r.issued_at,
      })),
      imports: imports.rows.map((r) => ({
        id: r.id,
        externalIssuer: r.external_issuer_did,
        credential: typeof r.credential === "string" ? JSON.parse(r.credential) : r.credential,
        verificationStatus: r.verification_status,
        importedAt: r.imported_at,
      })),
    };
  }
}

module.exports = WalletService;
