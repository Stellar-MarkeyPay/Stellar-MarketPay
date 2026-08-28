"use strict";

/**
 * backend/src/routes/wallet.test.js
 *
 * Tests for the holder wallet HTTP routes.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const requireAuth = (req, res, next) => next();

function createMockWalletService() {
  return {
    listCredentials: async () => [],
    createPresentation: async () => ({ type: ["VerifiablePresentation"] }),
    importCredential: async () => ({ importId: "test", verificationStatus: "unverified" }),
    createBackup: async () => ({ holderDid: "test", credentials: [], imports: [] }),
  };
}

test("createWalletRoutes returns an Express Router", () => {
  const createWalletRoutes = require("./wallet");
  assert.equal(typeof createWalletRoutes, "function");

  const router = createWalletRoutes({
    walletService: createMockWalletService(),
    requireAuth,
  });
  assert.ok(router);
});

test("Router is created successfully with all dependencies", () => {
  const createWalletRoutes = require("./wallet");
  const router = createWalletRoutes({
    walletService: createMockWalletService(),
    requireAuth,
  });
  assert.ok(router, "Wallet router should be created");
});
