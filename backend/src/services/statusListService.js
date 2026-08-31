"use strict";

/**
 * backend/src/services/statusListService.js
 *
 * W3C Bitstring Status List 2021 management.
 * Provides efficient revocation checking without leaking individual verification activity.
 */

class StatusListService {
  /**
   * @param {object} db - PostgreSQL pool or client
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Check the revocation status of a credential by its status list position.
   * @param {string} statusListId
   * @param {number} statusListIndex
   * @returns {Promise<boolean>} true if revoked
   */
  async isRevoked(statusListId, statusListIndex) {
    const result = await this.db.query(
      `SELECT bitstring FROM credential_status_lists WHERE id = $1`,
      [statusListId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Status list not found: ${statusListId}`);
    }

    const bitstring = Buffer.from(result.rows[0].bitstring);
    const byteIndex = Math.floor(statusListIndex / 8);
    const bitOffset = statusListIndex % 8;

    if (byteIndex >= bitstring.length) return false;

    return (bitstring[byteIndex] & (1 << bitOffset)) !== 0;
  }

  /**
   * Get the full status list credential for a verifier to fetch.
   * @param {string} statusListId
   * @returns {Promise<object|null>} The status list VC
   */
  async getStatusListCredential(statusListId) {
    const result = await this.db.query(
      `SELECT credential, version, updated_at FROM credential_status_lists WHERE id = $1`,
      [statusListId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const credential =
      typeof row.credential === "string" ? JSON.parse(row.credential) : row.credential;

    return {
      credential,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  /**
   * List all status lists for an issuer.
   * @param {string} issuerDid
   * @returns {Promise<object[]>}
   */
  async listStatusLists(issuerDid) {
    const result = await this.db.query(
      `SELECT id, issuer_did, list_index, version, created_at, updated_at
       FROM credential_status_lists WHERE issuer_did = $1
       ORDER BY list_index ASC`,
      [issuerDid]
    );

    return result.rows;
  }
}

module.exports = StatusListService;
