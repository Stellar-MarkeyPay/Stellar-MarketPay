import pool from "../db/pool";
/**
 * src/services/store.ts
 * Data is now persisted in PostgreSQL.
 * This module is kept for backwards compatibility with older imports.
 */

// @ts-ignore
const _store = { pool };
export default _store;
