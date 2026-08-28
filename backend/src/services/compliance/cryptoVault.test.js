"use strict";

const { CryptoVault } = require("./cryptoVault");

function vault(activeKeyId = "v1", keys) {
  return new CryptoVault({
    keys: keys || { v1: Buffer.alloc(32, 1) },
    activeKeyId,
    blindIndexKey: Buffer.alloc(32, 9),
    randomBytes: (length) => Buffer.alloc(length, 7),
  });
}

describe("compliance CryptoVault", () => {
  it("encrypts PII with authenticated context and never places plaintext in the envelope", () => {
    const store = vault();
    const pii = { fullName: "Ada Example", documentNumber: "P123456" };
    const context = { subjectId: "subject-1", recordType: "identity", schemaVersion: 1 };

    const envelope = store.encrypt(pii, context);

    expect(JSON.stringify(envelope)).not.toContain("Ada Example");
    expect(JSON.stringify(envelope)).not.toContain("P123456");
    expect(store.decrypt(envelope, context)).toEqual(pii);
  });

  it("rejects ciphertext replayed under another subject or record type", () => {
    const store = vault();
    const envelope = store.encrypt(
      { fullName: "Ada Example" },
      { subjectId: "subject-1", recordType: "identity", schemaVersion: 1 }
    );

    expect(() =>
      store.decrypt(envelope, {
        subjectId: "subject-2",
        recordType: "identity",
        schemaVersion: 1,
      })
    ).toThrow("context mismatch");
  });

  it("supports key rotation while retaining decrypt access to the previous key", () => {
    const keys = { v1: Buffer.alloc(32, 1), v2: Buffer.alloc(32, 2) };
    const oldVault = vault("v1", keys);
    const context = { subjectId: "subject-1", recordType: "identity", schemaVersion: 1 };
    const oldEnvelope = oldVault.encrypt({ country: "NG" }, context);
    const rotatedVault = vault("v2", keys);

    expect(rotatedVault.decrypt(oldEnvelope, context)).toEqual({ country: "NG" });
    expect(rotatedVault.encrypt({ country: "GH" }, context).keyId).toBe("v2");
  });

  it("creates normalized blind indexes without deterministic encryption", () => {
    const store = vault();
    expect(store.blindIndex("identity", "  ADA EXAMPLE ")).toBe(
      store.blindIndex("identity", "ada example")
    );
    expect(store.blindIndex("identity", "ada example")).not.toBe(
      store.blindIndex("corporate-party", "ada example")
    );
  });
});
