import { Kysely, PostgresDialect } from "kysely";
import type { Database } from "./types";
import pool from "./pool";

const dialect = new PostgresDialect({
  pool,
});

export const db = new Kysely<Database>({
  dialect,
});

/**
 * Execute a raw SQL query via the underlying pg.Pool.
 * This preserves compatibility with test mocks that stub pool.query.
 * The generic T provides typed rows without changing the execution path.
 */
export async function rawQuery<T = any>(
  queryStr: string,
  params: any[] = []
): Promise<{ rows: T[]; rowCount: number }> {
  const result = await pool.query(queryStr, params);
  return {
    rows: result.rows as T[],
    rowCount: result.rowCount ?? result.rows.length,
  };
}
