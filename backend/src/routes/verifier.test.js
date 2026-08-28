"use strict";

/**
 * backend/src/routes/verifier.test.js
 *
 * Tests for the external verifier HTTP routes.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

function createMockServices() {
  return {
    didService: {
      resolve: async (did) => {
        if (did.includes("GA5")) {
          return {
            id: did,
            verificationMethod: [
              {
                id: `${did}#key-1`,
                type: "Ed25519VerificationKey2020",
                publicKeyMultibase: "zTestKeyMultibase123",
              },
            ],
          };
        }
        return null;
      },
    },
    credentialService: {},
    statusListService: {
      isRevoked: async () => false,
    },
    verifyProof: () => ({ verified: true }),
  };
}

test("createVerifierRoutes returns an Express Router", () => {
  const createVerifierRoutes = require("./verifier");
  assert.equal(typeof createVerifierRoutes, "function");

  const router = createVerifierRoutes(createMockServices());
  assert.ok(router);
});

test("Router is created successfully with all dependencies", () => {
  const createVerifierRoutes = require("./verifier");
  const router = createVerifierRoutes(createMockServices());
  assert.ok(router, "Verifier router should be created");
});

test("Router handles missing services gracefully", () => {
  const createVerifierRoutes = require("./verifier");
  // Should not throw even with minimal deps
  const router = createVerifierRoutes({
    didService: { resolve: async () => null },
    credentialService: {},
    statusListService: { isRevoked: async () => false },
    verifyProof: () => ({ verified: false }),
  });
  assert.ok(router);
});
