"use strict";

const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
};
const mockCreatedPools = [];

jest.mock("../utils/logger", () => ({
  createServiceLogger: jest.fn(() => mockLogger),
}));

jest.mock("pg", () => {
  class Pool {
    constructor(config) {
      this.config = config;
      this.handlers = {};
      this.originalQuery = jest.fn(async (queryConfig) => {
        const text = typeof queryConfig === "string" ? queryConfig : queryConfig?.text || "";

        if (text.includes("pg_sleep")) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          const err = new Error("canceling statement due to statement timeout");
          err.code = "57014";
          throw err;
        }

        if (text.includes("slow_success")) {
          await new Promise((resolve) => setTimeout(resolve, 8));
        }

        return { rows: [] };
      });
      this.client = {
        query: this.originalQuery,
        release: jest.fn(),
      };
      mockCreatedPools.push(this);
    }

    on(event, handler) {
      this.handlers[event] = handler;
      if (event === "connect") {
        handler(this.client);
      }
      return this;
    }

    query(...args) {
      return this.client.query(...args);
    }

    async connect() {
      if (this.handlers.connect) {
        this.handlers.connect(this.client);
      }
      return this.client;
    }
  }

  return { Pool };
});

const ORIGINAL_ENV = process.env;

function loadPool(env = {}) {
  jest.resetModules();
  mockCreatedPools.length = 0;
  mockLogger.error.mockClear();
  mockLogger.warn.mockClear();
  process.env = {
    ...ORIGINAL_ENV,
    DATABASE_URL: "postgresql://test:test@localhost:5432/marketpay_test",
    NODE_ENV: "test",
    ...env,
  };
  return require("./pool");
}

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("PostgreSQL pool timeouts", () => {
  it("sets statement and lock timeout defaults on PostgreSQL startup options", () => {
    const pool = loadPool({
      POSTGRES_STATEMENT_TIMEOUT_MS: "1234",
      POSTGRES_LOCK_TIMEOUT_MS: "456",
    });

    expect(pool.timeoutConfig.statementTimeoutMs).toBe(1234);
    expect(pool.timeoutConfig.lockTimeoutMs).toBe(456);
    expect(mockCreatedPools[0].config.options).toContain("statement_timeout=1234ms");
    expect(mockCreatedPools[0].config.options).toContain("lock_timeout=456ms");
  });

  it("logs near-timeout queries for alerting", async () => {
    const pool = loadPool({
      POSTGRES_STATEMENT_TIMEOUT_MS: "10",
      POSTGRES_NEAR_TIMEOUT_RATIO: "0.5",
    });

    await pool.query("SELECT slow_success()");

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({
      alert: "db_query_near_statement_timeout",
      query: "SELECT slow_success()",
      statementTimeoutMs: 10,
      timeoutLabel: "api",
    }));
  });

  it("terminates a deliberately slow query instead of hanging", async () => {
    const pool = loadPool({
      POSTGRES_STATEMENT_TIMEOUT_MS: "10",
      POSTGRES_NEAR_TIMEOUT_RATIO: "0.5",
    });
    const startedAt = Date.now();

    await expect(pool.query("SELECT pg_sleep(1)")).rejects.toMatchObject({ code: "57014" });

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({
      alert: "db_query_statement_timeout",
      query: "SELECT pg_sleep(1)",
      statementTimeoutMs: 10,
    }));
  });

  it("uses an explicit longer timeout for analytics queries", async () => {
    const pool = loadPool({
      POSTGRES_ANALYTICS_STATEMENT_TIMEOUT_MS: "45000",
      POSTGRES_LOCK_TIMEOUT_MS: "900",
    });
    const createdPool = mockCreatedPools[0];

    await pool.analyticsQuery("SELECT analytics_rollup()");

    expect(createdPool.originalQuery).toHaveBeenCalledWith("BEGIN");
    expect(createdPool.originalQuery).toHaveBeenCalledWith(
      "SELECT set_config('statement_timeout', $1, true)",
      ["45000ms"],
    );
    expect(createdPool.originalQuery).toHaveBeenCalledWith(
      "SELECT set_config('lock_timeout', $1, true)",
      ["900ms"],
    );
    expect(createdPool.originalQuery).toHaveBeenCalledWith(
      "SELECT analytics_rollup()",
      undefined,
    );
    expect(createdPool.originalQuery).toHaveBeenCalledWith("COMMIT");
  });
});
