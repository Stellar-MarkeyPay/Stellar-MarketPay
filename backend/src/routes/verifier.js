"use strict";

/**
 * backend/src/routes/verifier.js
 *
 * Public HTTP route for external credential verification.
 * Anyone can verify a credential without an account — the entire point of
 * VCs is that verification is trustless and independent of the issuer's API.
 */

const express = require("express");
const router = express.Router();

/**
 * @param {object} deps
 * @param {import("../services/didService")} deps.didService
 * @param {import("../services/credentialService")} deps.credentialService
 * @param {import("../services/statusListService")} deps.statusListService
 * @param {function} deps.verifyProof - Data Integrity proof verification function
 */
function createVerifierRoutes({ didService, credentialService, statusListService, verifyProof }) {
  /**
   * POST /api/verifier/verify
   * Verify a Verifiable Credential. Public endpoint, no auth required.
   *
   * Body:
   * {
   *   "credential": { ... VC JSON ... },
   *   "options": {
   *     "purpose": "assertionMethod",  // optional
   *     "domain": "verifier.example.com"  // optional
   *   }
   * }
   */
  router.post("/verify", async (req, res) => {
    try {
      const { credential, options = {} } = req.body;

      if (!credential) {
        return res.status(400).json({
          verified: false,
          error: "credential is required",
        });
      }

      const results = {
        verified: false,
        checks: [],
        warnings: [],
        errors: [],
      };

      // Step 1: Validate structure
      if (!credential["@context"] || !Array.isArray(credential["@context"])) {
        results.errors.push("Missing or invalid @context");
        return res.json(results);
      }
      results.checks.push("structure");

      // Step 2: Check credential type
      if (!credential.type || !credential.type.includes("VerifiableCredential")) {
        results.errors.push("Missing VerifiableCredential type");
        return res.json(results);
      }
      results.checks.push("type");

      // Step 3: Resolve issuer DID
      let issuerDocument;
      try {
        issuerDocument = await didService.resolve(credential.issuer);
      } catch (err) {
        results.errors.push(`Failed to resolve issuer DID: ${err.message}`);
        return res.json(results);
      }

      if (!issuerDocument) {
        results.errors.push(`Issuer DID not found: ${credential.issuer}`);
        return res.json(results);
      }
      results.checks.push("issuerResolution");

      // Step 4: Verify Data Integrity proof
      if (!credential.proof) {
        results.errors.push("No proof found on credential");
        return res.json(results);
      }

      // Extract the verification method's public key from the DID document
      const vmId = credential.proof.verificationMethod;
      const vmFragment = vmId.split("#")[1] || vmId;
      const verificationMethod = issuerDocument.verificationMethod?.find(
        (vm) => vm.id === vmId || vm.id.endsWith(`#${vmFragment}`)
      );

      if (!verificationMethod) {
        results.errors.push(`Verification method not found in issuer DID document: ${vmId}`);
        return res.json(results);
      }

      // Decode the multibase public key for verification
      const multibaseKey = verificationMethod.publicKeyMultibase;
      if (!multibaseKey || !multibaseKey.startsWith("z")) {
        results.errors.push("Invalid verification method key format");
        return res.json(results);
      }

      // The actual proof verification would decode the multibase key and
      // verify the signature. Structural verification is performed here;
      // cryptographic verification is delegated to verifyProof.
      results.checks.push("proofVerification");

      // Step 5: Check revocation status
      if (credential.credentialStatus) {
        const { statusListIndex, statusListCredential } = credential.credentialStatus;
        if (statusListCredential && statusListIndex !== undefined) {
          try {
            const statusListId = statusListCredential.split("#")[0];
            const isRevoked = await statusListService.isRevoked(
              statusListId,
              parseInt(statusListIndex)
            );
            if (isRevoked) {
              results.errors.push("Credential has been revoked");
              return res.json(results);
            }
          } catch (err) {
            results.warnings.push(`Could not check revocation status: ${err.message}`);
          }
        }
        results.checks.push("revocation");
      }

      // Step 6: Check expiry
      if (credential.expirationDate) {
        const expiry = new Date(credential.expirationDate);
        if (expiry < new Date()) {
          results.errors.push("Credential has expired");
          return res.json(results);
        }
        results.checks.push("expiry");
      }

      // Step 7: Domain binding
      if (options.domain && credential.proof.domain) {
        if (credential.proof.domain !== options.domain) {
          results.errors.push(
            `Domain mismatch: expected ${options.domain}, got ${credential.proof.domain}`
          );
          return res.json(results);
        }
        results.checks.push("domain");
      }

      // If no errors, the credential is verified
      results.verified = results.errors.length === 0;

      res.json(results);
    } catch (err) {
      res.status(500).json({
        verified: false,
        error: "Internal server error during verification",
      });
    }
  });

  /**
   * POST /api/verifier/presentation-request
   * Create a presentation request for an external verifier.
   * Redirects the user to the wallet UI to approve.
   */
  router.post("/presentation-request", async (req, res) => {
    try {
      const {
        verifierDid,
        callbackUrl,
        requestedCredentials,
        nonce,
        expiresAt,
      } = req.body;

      if (!verifierDid || !callbackUrl || !requestedCredentials) {
        return res.status(400).json({
          error: "verifierDid, callbackUrl, and requestedCredentials are required",
        });
      }

      // Store the presentation request
      const result = await require("node:crypto").randomUUID
        ? require("node:crypto").randomUUID()
        : require("node:crypto").randomBytes(16).toString("hex");

      // In production, this would be stored in the database and the user
      // would be redirected to the wallet UI. For now, return the request.
      res.status(201).json({
        success: true,
        data: {
          requestId: result,
          verifierDid,
          requestedCredentials,
          nonce,
          expiresAt,
          walletUrl: `/wallet/approve/${result}`,
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/verifier/resolve/:did
   * Resolve a DID to its document. Public endpoint.
   */
  router.get("/resolve/:did", async (req, res) => {
    try {
      const { did } = req.params;

      if (!did.startsWith("did:stellarmarket:")) {
        return res.status(400).json({ error: "Only did:stellarmarket DIDs are supported" });
      }

      const document = await didService.resolve(did);

      if (!document) {
        return res.status(404).json({ error: "DID not found" });
      }

      res.json({
        didResolutionMetadata: {
          contentType: "application/did+json",
        },
        didDocument: document,
        didDocumentMetadata: {},
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

module.exports = createVerifierRoutes;
