"use strict";

const {
  blindIndex,
  getFederationHashKey,
  hashesEqual,
  hashFederatedSubject,
  hashOneTimeValue,
} = require("./security");

const KEY = Buffer.alloc(32, 7);

describe("federation blind indexes", () => {
  it("is deterministic for one provider and subject without storing the subject", () => {
    const first = hashFederatedSubject("provider-1", "opaque-subject", KEY);
    const second = hashFederatedSubject("provider-1", "opaque-subject", KEY);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
    expect(first).not.toContain("opaque-subject");
  });

  it("domain-separates providers and one-time value kinds", () => {
    const values = new Set([
      hashFederatedSubject("provider-1", "same-value", KEY),
      hashFederatedSubject("provider-2", "same-value", KEY),
      hashOneTimeValue("provider-1", "oidc-state", "same-value", KEY),
      hashOneTimeValue("provider-1", "oidc-nonce", "same-value", KEY),
      blindIndex("custom", "provider-1", "same-value", KEY),
    ]);
    expect(values.size).toBe(5);
  });

  it("preserves opaque subject and protocol-value bytes", () => {
    expect(hashFederatedSubject("provider-1", "subject", KEY)).not.toBe(
      hashFederatedSubject("provider-1", " subject ", KEY)
    );
    expect(hashOneTimeValue("provider-1", "oidc-state", "State", KEY)).not.toBe(
      hashOneTimeValue("provider-1", "oidc-state", "state", KEY)
    );
  });

  it("compares only well-formed hashes in constant-time code", () => {
    const hash = hashOneTimeValue("provider-1", "saml-assertion", "assertion-1", KEY);
    expect(hashesEqual(hash, hash)).toBe(true);
    expect(hashesEqual(hash, "f".repeat(64))).toBe(false);
    expect(hashesEqual(hash, "not-a-hash")).toBe(false);
  });

  it("requires an independent 32-byte key in production", () => {
    expect(() => getFederationHashKey({ NODE_ENV: "production", JWT_SECRET: "jwt" })).toThrow(
      "FEDERATION_HASH_KEY"
    );
    expect(
      getFederationHashKey({ NODE_ENV: "production", FEDERATION_HASH_KEY: KEY.toString("base64") })
    ).toEqual(KEY);
  });

  it("rejects unknown replay-value namespaces", () => {
    expect(() => hashOneTimeValue("provider-1", "relay-state", "value", KEY)).toThrow(
      "Unknown one-time value kind"
    );
  });
});
