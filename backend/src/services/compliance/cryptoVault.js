"use strict";

const crypto = require("crypto");
const { canonicalize } = require("./canonical");
const { complianceError } = require("./errors");

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = 1;

function decodeKey(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value !== "string") return Buffer.alloc(0);
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, "hex");
  return Buffer.from(value, "base64");
}

function parseKeyringFromEnv(env = process.env) {
  let configured = {};
  if (env.COMPLIANCE_ENCRYPTION_KEYS) {
    try {
      configured = JSON.parse(env.COMPLIANCE_ENCRYPTION_KEYS);
    } catch {
      throw complianceError(
        500,
        "INVALID_KEYRING",
        "COMPLIANCE_ENCRYPTION_KEYS must be a JSON object"
      );
    }
  } else if (env.COMPLIANCE_ENCRYPTION_KEY) {
    configured = { [env.COMPLIANCE_ENCRYPTION_KEY_ID || "primary"]: env.COMPLIANCE_ENCRYPTION_KEY };
  } else if (env.NODE_ENV !== "production") {
    // Local/test-only deterministic key; production is required to bind KMS or
    // an injected 32-byte key and never silently derives one from application state.
    configured = {
      local: crypto
        .createHash("sha256")
        .update(`${env.JWT_SECRET || "local"}:marketpay-compliance-local`)
        .digest("base64"),
    };
  }

  const entries = Object.entries(configured).map(([id, raw]) => [id, decodeKey(raw)]);
  if (entries.length === 0 || entries.some(([, key]) => key.length !== 32)) {
    throw complianceError(
      500,
      "INVALID_KEYRING",
      "Compliance encryption requires at least one 32-byte key"
    );
  }

  const keys = Object.fromEntries(entries);
  const activeKeyId = env.COMPLIANCE_ENCRYPTION_KEY_ID || entries[0][0];
  if (!keys[activeKeyId]) {
    throw complianceError(500, "INVALID_KEYRING", "Active compliance key ID is not configured");
  }

  const blindIndexKey = env.COMPLIANCE_BLIND_INDEX_KEY
    ? decodeKey(env.COMPLIANCE_BLIND_INDEX_KEY)
    : crypto.createHmac("sha256", keys[activeKeyId]).update("blind-index-v1").digest();
  if (blindIndexKey.length < 32) {
    throw complianceError(500, "INVALID_BLIND_INDEX_KEY", "Blind-index key is too short");
  }

  return { keys, activeKeyId, blindIndexKey };
}

class CryptoVault {
  constructor({ keys, activeKeyId, blindIndexKey, randomBytes = crypto.randomBytes }) {
    this.keys = Object.fromEntries(
      Object.entries(keys).map(([id, value]) => {
        const key = decodeKey(value);
        if (key.length !== 32) throw new Error(`Key ${id} must contain exactly 32 bytes`);
        return [id, key];
      })
    );
    this.activeKeyId = activeKeyId;
    this.blindIndexKey = decodeKey(blindIndexKey);
    this.randomBytes = randomBytes;
    if (!this.keys[activeKeyId]) throw new Error("Active key is missing from keyring");
    if (this.blindIndexKey.length < 32)
      throw new Error("Blind-index key must be at least 32 bytes");
  }

  encrypt(value, context) {
    const iv = this.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.keys[this.activeKeyId], iv);
    const aad = Buffer.from(canonicalize(context));
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(canonicalize(value), "utf8")),
      cipher.final(),
    ]);

    return {
      v: ENVELOPE_VERSION,
      alg: ALGORITHM,
      keyId: this.activeKeyId,
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  decrypt(envelope, context) {
    if (!envelope || envelope.v !== ENVELOPE_VERSION || envelope.alg !== ALGORITHM) {
      throw complianceError(400, "INVALID_ENVELOPE", "Unsupported compliance data envelope");
    }
    const key = this.keys[envelope.keyId];
    if (!key) throw complianceError(500, "KEY_UNAVAILABLE", "Envelope key is not available");

    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(Buffer.from(canonicalize(context)));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
      return JSON.parse(plaintext);
    } catch {
      throw complianceError(
        400,
        "ENVELOPE_AUTHENTICATION_FAILED",
        "Encrypted data context mismatch"
      );
    }
  }

  blindIndex(namespace, value) {
    const normalized = String(value || "")
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("en-US");
    return crypto
      .createHmac("sha256", this.blindIndexKey)
      .update(`${namespace}\u0000${normalized}`)
      .digest("hex");
  }
}

let singleton;

function getCryptoVault(env = process.env) {
  if (!singleton) singleton = new CryptoVault(parseKeyringFromEnv(env));
  return singleton;
}

function resetCryptoVaultForTests() {
  singleton = undefined;
}

module.exports = {
  CryptoVault,
  parseKeyringFromEnv,
  getCryptoVault,
  resetCryptoVaultForTests,
};
