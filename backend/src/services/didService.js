"use strict";

/**
 * backend/src/services/didService.js
 *
 * DID lifecycle management: create, resolve, rotate keys, deactivate.
 * Resolution uses a PostgreSQL cache with a 5-minute TTL.
 * The cache is a performance optimisation; resolution is deterministic from
 * the key state and rotation history, so any party can reconstruct the DID
 * Document independently.
 */

const {
  createDID,
  extractPublicKey,
  publicKeyToMultibase,
  buildDIDDocument,
  isValidStellarPublicKey,
} = require("../lib/did-stellar");

const DID_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class DidService {
  /**
   * @param {object} db - PostgreSQL pool or client
   * @param {object} [options]
   * @param {number} [options.cacheTtlMs] - Cache TTL override
   */
  constructor(db, options = {}) {
    this.db = db;
    this.cacheTtlMs = options.cacheTtlMs || DID_CACHE_TTL_MS;
  }

  /**
   * Create a new DID for a Stellar public key.
   * @param {string} stellarPublicKey - Base32 public key (G...)
   * @param {object} [options]
   * @param {string} [options.controllerDid] - Controller DID (defaults to self)
   * @returns {Promise<{did: string, document: object}>}
   */
  async create(stellarPublicKey, options = {}) {
    if (!isValidStellarPublicKey(stellarPublicKey)) {
      throw new Error("Invalid Stellar public key");
    }

    const did = createDID(stellarPublicKey);
    const multibaseKey = publicKeyToMultibase(stellarPublicKey);
    const keyId = "#key-1";
    const controllerDid = options.controllerDid || did;

    const document = buildDIDDocument({
      did,
      publicKeyMultibase: multibaseKey,
      keyId,
    });

    const now = new Date().toISOString();

    // Check for existing DID
    const existing = await this.db.query(
      "SELECT id FROM did_documents WHERE did = $1",
      [did]
    );
    if (existing.rows.length > 0) {
      throw new Error(`DID already exists: ${did}`);
    }

    // Insert DID document
    const docResult = await this.db.query(
      `INSERT INTO did_documents (did, controller, document, version, created_at, updated_at, deactivated)
       VALUES ($1, $2, $3, 1, $4, $4, false)
       RETURNING id`,
      [did, controllerDid, JSON.stringify(document), now]
    );

    const docId = docResult.rows[0].id;

    // Insert initial key
    await this.db.query(
      `INSERT INTO did_key_history (did_id, key_id, public_key_multibase, key_type, activated_at, deactivated_at, rotation_reason)
       VALUES ($1, $2, $3, $4, $5, NULL, 'initial')`,
      [docId, keyId, multibaseKey, "Ed25519VerificationKey2020", now]
    );

    return { did, document };
  }

  /**
   * Resolve a DID to its current DID Document.
   * Uses a PostgreSQL cache with TTL.
   * @param {string} did
   * @returns {Promise<object|null>} The DID Document, or null if not found
   */
  async resolve(did) {
    // Check cache
    const cached = await this.db.query(
      `SELECT document, updated_at FROM did_documents WHERE did = $1 AND deactivated = false`,
      [did]
    );

    if (cached.rows.length === 0) {
      return null;
    }

    const doc = cached.rows[0].document;
    const updatedAt = new Date(cached.rows[0].updated_at).getTime();
    const now = Date.now();

    // Return cached if within TTL
    if (now - updatedAt < this.cacheTtlMs) {
      return typeof doc === "string" ? JSON.parse(doc) : doc;
    }

    // Rebuild and refresh cache
    const rebuilt = await this._rebuildDocument(did);
    if (rebuilt) {
      const nowStr = new Date().toISOString();
      await this.db.query(
        `UPDATE did_documents SET document = $1, updated_at = $2 WHERE did = $3`,
        [JSON.stringify(rebuilt), nowStr, did]
      );
    }

    return rebuilt;
  }

  /**
   * Rotate the key for a DID. Requires authentication via the current key.
   * @param {string} did
   * @param {string} newPublicKeyBase32 - New Stellar public key
   * @param {string} [reason] - Reason for rotation
   * @returns {Promise<{did: string, document: object, previousKeyId: string}>}
   */
  async rotateKey(did, newPublicKeyBase32, reason = "key rotation") {
    if (!isValidStellarPublicKey(newPublicKeyBase32)) {
      throw new Error("Invalid Stellar public key for rotation");
    }

    const docResult = await this.db.query(
      `SELECT id, document, version FROM did_documents WHERE did = $1 AND deactivated = false`,
      [did]
    );

    if (docResult.rows.length === 0) {
      throw new Error(`DID not found: ${did}`);
    }

    const docRow = docResult.rows[0];
    const newMultibase = publicKeyToMultibase(newPublicKeyBase32);

    // Determine new key ID (increment from current max)
    const maxKeyResult = await this.db.query(
      `SELECT key_id FROM did_key_history WHERE did_id = $1 ORDER BY activated_at DESC LIMIT 1`,
      [docRow.id]
    );
    const currentKeyId = maxKeyResult.rows[0]?.key_id || "#key-1";
    const keyNum = parseInt(currentKeyId.replace("#key-", "")) || 0;
    const newKeyId = `#key-${keyNum + 1}`;

    const now = new Date().toISOString();

    // Deactivate current key
    await this.db.query(
      `UPDATE did_key_history SET deactivated_at = $1 WHERE did_id = $2 AND deactivated_at IS NULL`,
      [now, docRow.id]
    );

    // Add new key
    await this.db.query(
      `INSERT INTO did_key_history (did_id, key_id, public_key_multibase, key_type, activated_at, deactivated_at, rotation_reason)
       VALUES ($1, $2, $3, $4, $5, NULL, $6)`,
      [docRow.id, newKeyId, newMultibase, "Ed25519VerificationKey2020", now, reason]
    );

    // Rebuild DID document
    const document = buildDIDDocument({
      did,
      publicKeyMultibase: newMultibase,
      keyId: newKeyId,
    });

    // Update DID document version
    await this.db.query(
      `UPDATE did_documents SET document = $1, version = version + 1, updated_at = $2 WHERE did = $3`,
      [JSON.stringify(document), now, did]
    );

    return { did, document, previousKeyId: currentKeyId };
  }

  /**
   * Deactivate a DID. Sets the deactivated flag and clears the document.
   * @param {string} did
   * @returns {Promise<void>}
   */
  async deactivate(did) {
    const result = await this.db.query(
      `UPDATE did_documents SET deactivated = true, updated_at = $1 WHERE did = $2 AND deactivated = false
       RETURNING id`,
      [new Date().toISOString(), did]
    );

    if (result.rows.length === 0) {
      throw new Error(`DID not found or already deactivated: ${did}`);
    }

    // Deactivate all keys
    await this.db.query(
      `UPDATE did_key_history SET deactivated_at = $1 WHERE did_id = $2 AND deactivated_at IS NULL`,
      [new Date().toISOString(), result.rows[0].id]
    );
  }

  /**
   * Get the full key history for a DID.
   * @param {string} did
   * @returns {Promise<object[]>}
   */
  async getKeyHistory(did) {
    const result = await this.db.query(
      `SELECT kh.* FROM did_key_history kh
       JOIN did_documents dd ON kh.did_id = dd.id
       WHERE dd.did = $1
       ORDER BY kh.activated_at ASC`,
      [did]
    );
    return result.rows;
  }

  /**
   * Rebuild a DID Document from the current key state.
   * @private
   * @param {string} did
   * @returns {Promise<object|null>}
   */
  async _rebuildDocument(did) {
    const activeKey = await this.db.query(
      `SELECT kh.key_id, kh.public_key_multibase
       FROM did_key_history kh
       JOIN did_documents dd ON kh.did_id = dd.id
       WHERE dd.did = $1 AND kh.deactivated_at IS NULL
       ORDER BY kh.activated_at DESC LIMIT 1`,
      [did]
    );

    if (activeKey.rows.length === 0) return null;

    return buildDIDDocument({
      did,
      publicKeyMultibase: activeKey.rows[0].public_key_multibase,
      keyId: activeKey.rows[0].key_id,
    });
  }
}

module.exports = DidService;
