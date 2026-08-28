"use strict";

/**
 * backend/src/lib/did-stellar.js
 *
 * DID method definition and resolver for did:stellarmarket.
 *
 * Method-specific identifier: Stellar ed25519 public key (56 chars, G... prefix).
 * DID Document reconstruction is deterministic from the key state and rotation
 * history stored in PostgreSQL, making resolution decentralisable in principle.
 */

const DID_METHOD = "stellarmarket";
const DID_PREFIX = `did:${DID_METHOD}:`;

const DID_CONTEXT_DID_V1 = "https://www.w3.org/ns/did/v1";
const DID_CONTEXT_ED25519_2020 =
  "https://w3id.org/security/suites/ed25519-2020/v1";
const DID_CONTEXT_CREDENTIALS = "https://www.w3.org/2018/credentials/v1";

const KEY_TYPE = "Ed25519VerificationKey2020";

// Stellar ed25519 public keys: 56 characters, base32-encoded, starting with G.
const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;

/**
 * Validate a Stellar ed25519 public key.
 * @param {string} publicKey
 * @returns {boolean}
 */
function isValidStellarPublicKey(publicKey) {
  return typeof publicKey === "string" && STELLAR_PUBLIC_KEY_REGEX.test(publicKey);
}

/**
 * Construct a DID string from a Stellar public key.
 * @param {string} stellarPublicKey
 * @returns {string} e.g. "did:stellarmarket:GA5..."
 */
function createDID(stellarPublicKey) {
  if (!isValidStellarPublicKey(stellarPublicKey)) {
    throw new Error(
      `Invalid Stellar public key: expected 56-char base32 string starting with G, got "${stellarPublicKey}"`
    );
  }
  return `${DID_PREFIX}${stellarPublicKey}`;
}

/**
 * Parse the Stellar public key from a DID string.
 * @param {string} did
 * @returns {string} The Stellar public key.
 */
function extractPublicKey(did) {
  if (!did || !did.startsWith(DID_PREFIX)) {
    throw new Error(`Invalid did:stellarmarket DID: "${did}"`);
  }
  const specificId = did.slice(DID_PREFIX.length);
  if (!isValidStellarPublicKey(specificId)) {
    throw new Error(
      `Invalid did:stellarmarket DID: method-specific identifier is not a valid Stellar public key`
    );
  }
  return specificId;
}

/**
 * Encode an Ed25519 public key to multibase (z-prefixed base58btc).
 * For platform-issued keys we use a deterministic encoding.
 * @param {string} publicKeyBase32 - Stellar base32 public key
 * @returns {string} Multibase-encoded key
 */
function publicKeyToMultibase(publicKeyBase32) {
  // Stellar keys are already 32 bytes (ed25519) encoded in base32.
  // Multibase prefix 'z' = base58btc, then the raw 32 bytes.
  // We decode base32 → raw bytes → base58btc with z prefix.
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const key = publicKeyBase32.slice(1); // strip leading G
  let bits = 0;
  let value = 0n;
  for (const ch of key) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5n) | BigInt(idx);
    bits += 5;
  }
  // Remove trailing zeros from the 36-byte (288-bit) base32 encoding
  const bytes = [];
  let bitStr = value.toString(2).padStart(bits, "0");
  // Take only the first 256 bits (32 bytes)
  bitStr = bitStr.slice(bitStr.length - 256);
  for (let i = 0; i < 32; i++) {
    bytes.push(parseInt(bitStr.slice(i * 8, i * 8 + 8), 2));
  }

  // Base58btc encoding
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }
  let encoded = "";
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    encoded = B58[rem] + encoded;
  }
  // Preserve leading zeros
  for (const b of bytes) {
    if (b === 0) encoded = "1" + encoded;
    else break;
  }
  return "z" + encoded;
}

/**
 * Build a DID Document from key data.
 * @param {object} params
 * @param {string} params.did - Full DID string
 * @param {string} params.publicKeyMultibase - Current active key in multibase
 * @param {string} [params.keyId] - Key fragment (defaults to #key-1)
 * @param {object[]} [params.services] - Service entries
 * @returns {object} W3C DID Document
 */
function buildDIDDocument({ did, publicKeyMultibase, keyId = "#key-1", services = [] }) {
  const verificationMethod = [
    {
      id: `${did}${keyId}`,
      type: KEY_TYPE,
      controller: did,
      publicKeyMultibase,
    },
  ];

  const doc = {
    "@context": [DID_CONTEXT_DID_V1, DID_CONTEXT_ED25519_2020],
    id: did,
    controller: did,
    verificationMethod,
    authentication: [keyId],
    assertionMethod: [keyId],
    capabilityDelegation: [],
    keyAgreement: [],
  };

  if (services.length > 0) {
    doc.service = services;
  }

  return doc;
}

/**
 * Compute the deterministic credential ID for a VC.
 * @param {string} issuerDid
 * @param {string} subjectDid
 * @param {string[]} type
 * @param {string} issuanceDate
 * @returns {string} Deterministic credential ID URI
 */
function computeCredentialId(issuerDid, subjectDid, type, issuanceDate) {
  const { createHash } = require("node:crypto");
  const input = JSON.stringify({ issuerDid, subjectDid, type, issuanceDate });
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 16);
  return `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-0000-000000000000`;
}

/**
 * Verify a Stellar signature against a message.
 * Uses the ed25519 signature verification built into Node.js crypto.
 * @param {string} publicKeyBase32 - Stellar public key (base32, G...)
 * @param {Buffer} message - The signed message
 * @param {Buffer} signature - The 64-byte Ed25519 signature
 * @returns {boolean}
 */
function verifyStellarSignature(publicKeyBase32, message, signature) {
  const { verify, createPublicKey } = require("node:crypto");
  // Decode the Stellar base32 public key to raw 32 bytes
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const key = publicKeyBase32.slice(1);
  let bits = 0;
  let value = 0n;
  for (const ch of key) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) return false;
    value = (value << 5n) | BigInt(idx);
    bits += 5;
  }
  const bitStr = value.toString(2).padStart(bits, "0").slice(-256);
  const rawBytes = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    rawBytes[i] = parseInt(bitStr.slice(i * 8, i * 8 + 8), 2);
  }

  // Construct an Ed25519 public key object from raw bytes
  const keyObj = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawBytes]),
    format: "der",
    type: "spki",
  });
  return verify(null, message, keyObj, signature);
}

module.exports = {
  DID_METHOD,
  DID_PREFIX,
  DID_CONTEXT_DID_V1,
  DID_CONTEXT_ED25519_2020,
  DID_CONTEXT_CREDENTIALS,
  KEY_TYPE,
  STELLAR_PUBLIC_KEY_REGEX,
  isValidStellarPublicKey,
  createDID,
  extractPublicKey,
  publicKeyToMultibase,
  buildDIDDocument,
  computeCredentialId,
  verifyStellarSignature,
};
