"use strict";

/**
 * backend/src/lib/vcProof.test.js
 *
 * Tests for Data Integrity proof creation and verification using EdDSA-JCS-2022.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");

const { canonicalize, canonicalHash, createProof, verifyProof } = require("./vcProof");

test("canonicalize produces sorted, whitespace-free JSON", () => {
  const obj = { z: 1, a: 2, m: { b: 3, a: 1 } };
  const result = canonicalize(obj);
  assert.equal(result, '{"a":2,"m":{"a":1,"b":3},"z":1}');
});

test("canonicalize is deterministic for the same object", () => {
  const obj = { b: 2, a: 1, c: { z: 3, y: 2 } };
  const r1 = canonicalize(obj);
  const r2 = canonicalize(obj);
  assert.equal(r1, r2);
});

test("canonicalize produces different output for different objects", () => {
  const r1 = canonicalize({ a: 1 });
  const r2 = canonicalize({ a: 2 });
  assert.notEqual(r1, r2);
});

test("canonicalHash returns a 32-byte Buffer", () => {
  const hash = canonicalHash({ test: true });
  assert.ok(Buffer.isBuffer(hash));
  assert.equal(hash.length, 32);
});

test("canonicalHash is deterministic", () => {
  const h1 = canonicalHash({ x: 42 });
  const h2 = canonicalHash({ x: 42 });
  assert.deepEqual(h1, h2);
});

test("createProof produces a signed credential with proof", () => {
  const { privateKey } = generateKeyPairSync("ed25519");

  const credential = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential", "TestCredential"],
    issuer: "did:stellarmarket:GA5TEST",
    issuanceDate: "2026-01-01T00:00:00Z",
    credentialSubject: { id: "did:stellarmarket:GB6TEST", name: "Test" },
  };

  const signed = createProof({
    credential,
    verificationMethod: "did:stellarmarket:GA5TEST#key-1",
    privateKey,
    purpose: "assertionMethod",
  });

  assert.ok(signed.proof, "Signed credential should have a proof");
  assert.equal(signed.proof.type, "DataIntegrityProof");
  assert.equal(signed.proof.cryptosuite, "eddsa-jcs-2022");
  assert.equal(signed.proof.proofPurpose, "assertionMethod");
  assert.ok(signed.proof.proofValue, "Proof should have a proofValue");
  assert.ok(signed.proof.proofValue.startsWith("z"), "proofValue should be multibase-encoded");
  assert.ok(signed.proof.verificationMethod, "Proof should have a verificationMethod");
  assert.ok(signed.proof.created, "Proof should have a created timestamp");
});

test("verifyProof verifies a validly signed credential", () => {
  const keyPair = generateKeyPairSync("ed25519");
  const publicKeyRaw = keyPair.publicKey.export({ type: "spki", format: "der" }).slice(-32);

  const credential = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential"],
    issuer: "did:stellarmarket:GA5TEST",
    issuanceDate: "2026-01-01T00:00:00Z",
    credentialSubject: { id: "did:stellarmarket:GB6TEST" },
  };

  const signed = createProof({
    credential,
    verificationMethod: "did:stellarmarket:GA5TEST#key-1",
    privateKey: keyPair.privateKey,
  });

  const result = verifyProof({ credential: signed, publicKey: publicKeyRaw });
  assert.ok(result.verified, `Proof should verify, got error: ${result.error}`);
});

test("verifyProof rejects tampered credentials", () => {
  const keyPair = generateKeyPairSync("ed25519");
  const publicKeyRaw = keyPair.publicKey.export({ type: "spki", format: "der" }).slice(-32);

  const credential = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential"],
    issuer: "did:stellarmarket:GA5TEST",
    issuanceDate: "2026-01-01T00:00:00Z",
    credentialSubject: { id: "did:stellarmarket:GB6TEST" },
  };

  const signed = createProof({
    credential,
    verificationMethod: "did:stellarmarket:GA5TEST#key-1",
    privateKey: keyPair.privateKey,
  });

  // Tamper with the credential subject
  const tampered = { ...signed, credentialSubject: { ...signed.credentialSubject, name: "HACKED" } };

  const result = verifyProof({ credential: tampered, publicKey: publicKeyRaw });
  assert.ok(!result.verified, "Tampered credential should not verify");
  assert.ok(result.error, "Should provide error message");
});

test("verifyProof rejects wrong public key", () => {
  const keyPair1 = generateKeyPairSync("ed25519");
  const keyPair2 = generateKeyPairSync("ed25519");
  const wrongPubKey = keyPair2.publicKey.export({ type: "spki", format: "der" }).slice(-32);

  const credential = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential"],
    issuer: "did:stellarmarket:GA5TEST",
    issuanceDate: "2026-01-01T00:00:00Z",
    credentialSubject: { id: "did:stellarmarket:GB6TEST" },
  };

  const signed = createProof({
    credential,
    verificationMethod: "did:stellarmarket:GA5TEST#key-1",
    privateKey: keyPair1.privateKey,
  });

  const result = verifyProof({ credential: signed, publicKey: wrongPubKey });
  assert.ok(!result.verified, "Wrong key should not verify");
});

test("verifyProof rejects missing proof", () => {
  const credential = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential"],
  };

  const result = verifyProof({ credential, publicKey: Buffer.alloc(32) });
  assert.ok(!result.verified);
  assert.ok(result.error.includes("No proof"));
});

test("verifyProof rejects unsupported proof type", () => {
  const credential = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential"],
    proof: { type: "EcdsaSecp256k1Signature2019" },
  };

  const result = verifyProof({ credential, publicKey: Buffer.alloc(32) });
  assert.ok(!result.verified);
  assert.ok(result.error.includes("Unsupported proof type"));
});

test("verifyProof rejects unsupported cryptosuite", () => {
  const credential = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential"],
    proof: { type: "DataIntegrityProof", cryptosuite: "bbs-bls12381" },
  };

  const result = verifyProof({ credential, publicKey: Buffer.alloc(32) });
  assert.ok(!result.verified);
  assert.ok(result.error.includes("Unsupported cryptosuite"));
});
