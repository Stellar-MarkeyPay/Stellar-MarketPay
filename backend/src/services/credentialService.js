"use strict";

/**
 * backend/src/services/credentialService.js
 *
 * Verifiable Credential issuance, status management, revocation, and export.
 * Credentials are W3C VC Data Model 2.0 compliant with Data Integrity proofs.
 */

const { createHash, randomBytes } = require("node:crypto");
const { createProof } = require("../lib/vcProof");
const { validateClaims, CREDENTIAL_SCHEMAS } = require("../lib/credentialSchema");
const { DID_CONTEXT_CREDENTIALS } = require("../lib/did-stellar");

class CredentialService {
  /**
   * @param {object} db - PostgreSQL pool or client
   * @param {object} issuerKeys
   * @param {Buffer} issuerKeys.privateKey - Platform Ed25519 private key
   * @param {string} issuerKeys.publicKeyMultibase - Platform public key in multibase
   * @param {string} issuerKeys.verificationMethod - Full DID URL of signing key
   * @param {string} issuerKeys.issuerDid - Platform DID
   */
  constructor(db, issuerKeys) {
    this.db = db;
    this.privateKey = issuerKeys.privateKey;
    this.publicKeyMultibase = issuerKeys.publicKeyMultibase;
    this.verificationMethod = issuerKeys.verificationMethod;
    this.issuerDid = issuerKeys.issuerDid;
  }

  /**
   * Issue a new Verifiable Credential.
   * @param {object} params
   * @param {string} params.subjectDid - DID of the credential subject
   * @param {string[]} params.types - Credential types (e.g. ["EngagementCredential"])
   * @param {object} params.claims - The credential subject claims
   * @param {string} [params.expiresAt] - Optional expiry
   * @returns {Promise<object>} The signed credential
   */
  async issue({ subjectDid, types, claims, expiresAt }) {
    // Validate claims against schema
    const credentialType = types.find((t) => CREDENTIAL_SCHEMAS[t]);
    if (!credentialType) {
      throw new Error(`No schema found for credential types: ${types.join(", ")}`);
    }

    const validation = validateClaims(credentialType, claims);
    if (!validation.valid) {
      throw new Error(`Invalid claims: ${validation.errors.join("; ")}`);
    }

    const issuanceDate = new Date().toISOString();
    const credentialId = `urn:uuid:${randomBytes(16).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5")}`;

    // Get or create status list assignment
    const statusListAssignment = await this._assignStatusList(subjectDid);

    const credential = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        DID_CONTEXT_CREDENTIALS,
        "https://www.w3.org/2018/credentials/examples/v1",
      ],
      id: credentialId,
      type: ["VerifiableCredential", ...types],
      issuer: this.issuerDid,
      issuanceDate,
      credentialSubject: {
        id: subjectDid,
        ...claims,
      },
      credentialStatus: {
        id: `${process.env.API_URL || "https://api.stellar-marketpay.com"}/api/credentials/status/${statusListAssignment.statusListId}`,
        type: "BitstringStatusList2021",
        statusListIndex: String(statusListAssignment.index),
        statusListCredential: `${this.issuerDid}#status-list`,
      },
    };

    if (expiresAt) {
      credential.expirationDate = expiresAt;
    }

    // Sign the credential
    const signed = createProof({
      credential,
      verificationMethod: this.verificationMethod,
      privateKey: this.privateKey,
      purpose: "assertionMethod",
    });

    // Store in database
    await this.db.query(
      `INSERT INTO verifiable_credentials
       (credential_id, issuer_did, subject_did, type, claims, credential, proof_value,
        status_list_index, status_list_id, revoked, on_chain_anchored, schema_name, schema_version,
        issued_at, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, false, $10, '1.0.0',
               $11, $12, $11, $11)`,
      [
        credentialId,
        this.issuerDid,
        subjectDid,
        types,
        JSON.stringify(claims),
        JSON.stringify(signed),
        signed.proof?.proofValue || null,
        statusListAssignment.index,
        statusListAssignment.statusListId,
        credentialType,
        issuanceDate,
        expiresAt || null,
      ]
    );

    return signed;
  }

  /**
   * Revoke a credential.
   * @param {string} credentialId - The credential's URI
   * @param {string} [reason] - Revocation reason
   * @returns {Promise<void>}
   */
  async revoke(credentialId, reason) {
    const result = await this.db.query(
      `UPDATE verifiable_credentials
       SET revoked = true, revoked_at = $2, updated_at = $2
       WHERE credential_id = $1 AND revoked = false
       RETURNING status_list_id, status_list_index`,
      [credentialId, new Date().toISOString()]
    );

    if (result.rows.length === 0) {
      throw new Error(`Credential not found or already revoked: ${credentialId}`);
    }

    const { status_list_id, status_list_index } = result.rows[0];

    // Update the bitstring status list
    await this._setRevocationBit(status_list_id, status_list_index, true);

    if (reason) {
      await this.db.query(
        `UPDATE verifiable_credentials SET claims = jsonb_set(claims, '{revocationReason}', $2::jsonb)
         WHERE credential_id = $1`,
        [credentialId, JSON.stringify(reason)]
      );
    }
  }

  /**
   * Check if a credential is revoked.
   * @param {string} credentialId
   * @returns {Promise<boolean>}
   */
  async isRevoked(credentialId) {
    const result = await this.db.query(
      `SELECT revoked FROM verifiable_credentials WHERE credential_id = $1`,
      [credentialId]
    );
    if (result.rows.length === 0) {
      throw new Error(`Credential not found: ${credentialId}`);
    }
    return result.rows[0].revoked;
  }

  /**
   * Get a credential by ID.
   * @param {string} credentialId
   * @returns {Promise<object|null>}
   */
  async getCredential(credentialId) {
    const result = await this.db.query(
      `SELECT * FROM verifiable_credentials WHERE credential_id = $1`,
      [credentialId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      credential: typeof row.credential === "string" ? JSON.parse(row.credential) : row.credential,
      claims: typeof row.claims === "string" ? JSON.parse(row.claims) : row.claims,
    };
  }

  /**
   * List credentials for a subject DID.
   * @param {string} subjectDid
   * @param {object} [options]
   * @param {string[]} [options.types] - Filter by credential type
   * @param {boolean} [options.revoked] - Filter by revocation status
   * @param {number} [options.limit]
   * @param {number} [options.offset]
   * @returns {Promise<object[]>}
   */
  async listCredentials(subjectDid, options = {}) {
    const { types, revoked, limit = 50, offset = 0 } = options;

    let query = `SELECT * FROM verifiable_credentials WHERE subject_did = $1`;
    const params = [subjectDid];
    let paramIdx = 2;

    if (revoked !== undefined) {
      query += ` AND revoked = $${paramIdx}`;
      params.push(revoked);
      paramIdx++;
    }

    if (types && types.length > 0) {
      query += ` AND type && $${paramIdx}`;
      params.push(types);
      paramIdx++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(limit, offset);

    const result = await this.db.query(query, params);
    return result.rows.map((row) => ({
      ...row,
      credential: typeof row.credential === "string" ? JSON.parse(row.credential) : row.credential,
      claims: typeof row.claims === "string" ? JSON.parse(row.claims) : row.claims,
    }));
  }

  /**
   * Export a credential as a standalone signed VC JSON.
   * @param {string} credentialId
   * @returns {Promise<object|null>}
   */
  async exportCredential(credentialId) {
    const cred = await this.getCredential(credentialId);
    if (!cred) return null;
    return cred.credential;
  }

  /**
   * Get or create a status list assignment for a credential.
   * @private
   */
  async _assignStatusList(subjectDid) {
    // Find an existing status list with capacity (< 131072 bits per list)
    const list = await this.db.query(
      `SELECT id, list_index FROM credential_status_lists
       WHERE issuer_did = $1
       ORDER BY list_index DESC LIMIT 1`,
      [this.issuerDid]
    );

    if (list.rows.length === 0) {
      // Create first status list
      return this._createStatusList(0);
    }

    // Count credentials in this list to check capacity
    const count = await this.db.query(
      `SELECT COUNT(*) as cnt FROM verifiable_credentials
       WHERE status_list_id = $1`,
      [list.rows[0].id]
    );

    if (parseInt(count.rows[0].cnt) < 131072) {
      return {
        statusListId: list.rows[0].id,
        index: parseInt(count.rows[0].cnt),
      };
    }

    // Create a new status list
    return this._createStatusList(list.rows[0].list_index + 1);
  }

  /**
   * Create a new status list.
   * @private
   */
  async _createStatusList(listIndex) {
    // Initial bitstring: 16384 bytes = 131072 bits
    const initialBitstring = Buffer.alloc(16384, 0);

    const statusListCredential = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://www.w3.org/2018/credentials/examples/v1",
      ],
      id: `${this.issuerDid}#status-list-${listIndex}`,
      type: ["VerifiableCredential", "BitstringStatusListCredential"],
      issuer: this.issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: `${this.issuerDid}#status-list-${listIndex}`,
        type: "BitstringStatusList",
        statusPurpose: "revocation",
        encodedList: initialBitstring.toString("base64"),
      },
    };

    const result = await this.db.query(
      `INSERT INTO credential_status_lists (issuer_did, list_index, bitstring, credential, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5, $5)
       RETURNING id`,
      [
        this.issuerDid,
        listIndex,
        initialBitstring,
        JSON.stringify(statusListCredential),
        new Date().toISOString(),
      ]
    );

    return { statusListId: result.rows[0].id, index: 0 };
  }

  /**
   * Set a bit in a status list's bitstring.
   * @private
   */
  async _setRevocationBit(statusListId, bitIndex, revoked) {
    const result = await this.db.query(
      `SELECT bitstring FROM credential_status_lists WHERE id = $1`,
      [statusListId]
    );

    if (result.rows.length === 0) return;

    const bitstring = Buffer.from(result.rows[0].bitstring);
    const byteIndex = Math.floor(bitIndex / 8);
    const bitOffset = bitIndex % 8;

    if (revoked) {
      bitstring[byteIndex] |= 1 << bitOffset;
    } else {
      bitstring[byteIndex] &= ~(1 << bitOffset);
    }

    await this.db.query(
      `UPDATE credential_status_lists
       SET bitstring = $1, version = version + 1, updated_at = $2
       WHERE id = $3`,
      [bitstring, new Date().toISOString(), statusListId]
    );
  }

  /**
   * Get a status list for verification.
   * @param {string} statusListId
   * @returns {Promise<object|null>}
   */
  async getStatusList(statusListId) {
    const result = await this.db.query(
      `SELECT * FROM credential_status_lists WHERE id = $1`,
      [statusListId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      credential:
        typeof row.credential === "string" ? JSON.parse(row.credential) : row.credential,
    };
  }
}

module.exports = CredentialService;
