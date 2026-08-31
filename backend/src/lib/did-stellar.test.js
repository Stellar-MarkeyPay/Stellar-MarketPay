"use strict";

/**
 * backend/src/lib/did-stellar.test.js
 *
 * Tests for the did:stellarmarket method library.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DID_METHOD,
  DID_PREFIX,
  STELLAR_PUBLIC_KEY_REGEX,
  isValidStellarPublicKey,
  createDID,
  extractPublicKey,
  publicKeyToMultibase,
  buildDIDDocument,
  computeCredentialId,
} = require("./did-stellar");

// A valid Stellar testnet public key (56 chars, base32)
const TEST_KEY = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

test("DID_METHOD is 'stellarmarket'", () => {
  assert.equal(DID_METHOD, "stellarmarket");
});

test("DID_PREFIX is 'did:stellarmarket:'", () => {
  assert.equal(DID_PREFIX, "did:stellarmarket:");
});

test("isValidStellarPublicKey accepts valid keys", () => {
  assert.ok(isValidStellarPublicKey(TEST_KEY));
});

test("isValidStellarPublicKey rejects short keys", () => {
  assert.ok(!isValidStellarPublicKey("GA5JQH"));
});

test("isValidStellarPublicKey rejects non-G prefix", () => {
  assert.ok(!isValidStellarPublicKey("BA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7"));
});

test("isValidStellarPublicKey rejects lowercase", () => {
  assert.ok(!isValidStellarPublicKey("ga5jqhfzllm7h45aebs7m2e7eyq3m3ky6r7b8c9d0e1f2g3h4i5j6k7"));
});

test("isValidStellarPublicKey rejects non-string", () => {
  assert.ok(!isValidStellarPublicKey(null));
  assert.ok(!isValidStellarPublicKey(undefined));
  assert.ok(!isValidStellarPublicKey(123));
});

test("createDID returns did:stellarmarket:<key>", () => {
  const did = createDID(TEST_KEY);
  assert.equal(did, `did:stellarmarket:${TEST_KEY}`);
});

test("createDID throws for invalid key", () => {
  assert.throws(
    () => createDID("invalid-key"),
    /Invalid Stellar public key/
  );
});

test("extractPublicKey recovers the Stellar key from a DID", () => {
  const did = createDID(TEST_KEY);
  const extracted = extractPublicKey(did);
  assert.equal(extracted, TEST_KEY);
});

test("extractPublicKey throws for non-did:stellarmarket strings", () => {
  assert.throws(
    () => extractPublicKey("did:web:example.com"),
    /Invalid did:stellarmarket DID/
  );
  assert.throws(
    () => extractPublicKey(null),
    /Invalid did:stellarmarket DID/
  );
});

test("publicKeyToMultibase returns a string starting with 'z'", () => {
  const mb = publicKeyToMultibase(TEST_KEY);
  assert.ok(typeof mb === "string");
  assert.ok(mb.startsWith("z"), `Expected multibase to start with 'z', got '${mb[0]}'`);
});

test("publicKeyToMultibase is deterministic for the same key", () => {
  const mb1 = publicKeyToMultibase(TEST_KEY);
  const mb2 = publicKeyToMultibase(TEST_KEY);
  assert.equal(mb1, mb2);
});

test("publicKeyToMultibase produces different output for different keys", () => {
  const key2 = "GXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMN";
  const mb1 = publicKeyToMultibase(TEST_KEY);
  const mb2 = publicKeyToMultibase(key2);
  assert.notEqual(mb1, mb2);
});

test("buildDIDDocument produces a valid W3C DID Document", () => {
  const did = createDID(TEST_KEY);
  const multibase = publicKeyToMultibase(TEST_KEY);
  const doc = buildDIDDocument({ did, publicKeyMultibase: multibase });

  assert.equal(doc.id, did);
  assert.equal(doc.controller, did);
  assert.ok(Array.isArray(doc["@context"]));
  assert.ok(doc["@context"].includes("https://www.w3.org/ns/did/v1"));
  assert.ok(Array.isArray(doc.verificationMethod));
  assert.equal(doc.verificationMethod.length, 1);
  assert.equal(doc.verificationMethod[0].id, `${did}#key-1`);
  assert.equal(doc.verificationMethod[0].type, "Ed25519VerificationKey2020");
  assert.equal(doc.verificationMethod[0].publicKeyMultibase, multibase);
  assert.deepEqual(doc.authentication, ["#key-1"]);
  assert.deepEqual(doc.assertionMethod, ["#key-1"]);
});

test("buildDIDDocument with custom keyId", () => {
  const did = createDID(TEST_KEY);
  const multibase = publicKeyToMultibase(TEST_KEY);
  const doc = buildDIDDocument({ did, publicKeyMultibase: multibase, keyId: "#key-2" });

  assert.equal(doc.verificationMethod[0].id, `${did}#key-2`);
  assert.deepEqual(doc.authentication, ["#key-2"]);
});

test("buildDIDDocument includes services when provided", () => {
  const did = createDID(TEST_KEY);
  const multibase = publicKeyToMultibase(TEST_KEY);
  const services = [{ id: `${did}#messaging`, type: "MessagingService", serviceEndpoint: "https://api.example.com/msg" }];
  const doc = buildDIDDocument({ did, publicKeyMultibase: multibase, services });

  assert.ok(doc.service);
  assert.equal(doc.service.length, 1);
  assert.equal(doc.service[0].type, "MessagingService");
});

test("computeCredentialId returns a deterministic UUID URN", () => {
  const id1 = computeCredentialId("did:1", "did:2", ["Type1"], "2026-01-01");
  const id2 = computeCredentialId("did:1", "did:2", ["Type1"], "2026-01-01");
  const id3 = computeCredentialId("did:1", "did:2", ["Type2"], "2026-01-01");

  assert.equal(id1, id2, "Same inputs should produce same ID");
  assert.notEqual(id1, id3, "Different inputs should produce different IDs");
  assert.ok(id1.startsWith("urn:uuid:"));
});
