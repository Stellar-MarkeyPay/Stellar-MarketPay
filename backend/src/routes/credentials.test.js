"use strict";

/**
 * backend/src/routes/credentials.test.js
 *
 * Tests for the credential management HTTP routes.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const requireAuth = (req, res, next) => next();
const requireAdmin = (req, res, next) => next();

function createMockServices() {
  return {
    credentialService: {
      issue: async () => ({ id: "urn:uuid:test", type: ["VerifiableCredential"] }),
      listCredentials: async () => [],
      getCredential: async () => null,
      exportCredential: async () => null,
      revoke: async () => {},
    },
    statusListService: {
      getStatusListCredential: async () => null,
    },
  };
}

test("createCredentialRoutes returns an Express Router", () => {
  const createCredentialRoutes = require("./credentials");
  assert.equal(typeof createCredentialRoutes, "function");

  const { credentialService, statusListService } = createMockServices();
  const router = createCredentialRoutes({
    credentialService,
    statusListService,
    requireAuth,
    requireAdmin,
  });
  assert.ok(router);
});

test("Router is created with all dependencies", () => {
  const createCredentialRoutes = require("./credentials");
  const services = createMockServices();

  // Should not throw
  const router = createCredentialRoutes({
    ...services,
    requireAuth,
    requireAdmin,
  });
  assert.ok(router, "Router should be created successfully");
});
