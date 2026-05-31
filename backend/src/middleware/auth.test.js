"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

describe("JWT secret configuration", () => {
  it("exits with a fatal error when JWT_SECRET is missing", () => {
    const authModule = path.join(__dirname, "auth.js");
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/marketpay_test",
      NODE_ENV: "production",
    };
    delete env.JWT_SECRET;

    const result = spawnSync(
      process.execPath,
      ["-e", `require(${JSON.stringify(authModule)})`],
      { env, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FATAL: JWT_SECRET environment variable is required");
  });
});
