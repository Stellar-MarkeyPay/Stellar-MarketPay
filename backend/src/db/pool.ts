/**
 * src/db/pool.ts
 * Shared PostgreSQL connection pool.
 * All services import this — never create a second Pool.
 */
import { Pool } from "pg";
// @ts-ignore
import { requireEnv } from "../config/env";

const DATABASE_URL = requireEnv("DATABASE_URL");

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Keep a modest pool; tune per deployment.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Enforce SSL in production but allow plain-text in local Docker.
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : false,
});

pool.on("error", (err: Error) => {
  console.error("[pg] Unexpected pool error:", err.message);
});

export default pool;
// Maintain CJS module.exports = pool contract for legacy JS tests/callers
// @ts-ignore
module.exports = pool;
// @ts-ignore
module.exports.default = pool;
