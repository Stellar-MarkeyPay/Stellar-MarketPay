"use strict";

/**
 * backend/src/lib/vcProof.js
 *
 * Data Integrity proof creation and verification using the EdDSA-JCS-2022
 * (Ed25519 + JSON Canonicalization Scheme) cryptosuite.
 *
 * This implements the W3C Data Integrity specification:
 * - https://www.w3.org/TR/vc-data-integrity/
 * - https://www.w3.org/TR/vc-data-integrity/#cryptosuites
 */

const { createHash, sign: signEd25519, verify: verifyEd25519, createPublicKey } = require("node:crypto");

/**
 * JSON Canonicalization Scheme (JCS) per RFC 8785.
 * Produces deterministic JSON by sorting object keys recursively and removing whitespace.
 * @param {object} obj
 * @returns {string} Canonicalized JSON
 */
function canonicalize(obj) {
  return JSON.stringify(obj, function replacer(key, val) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((sorted, k) => {
          sorted[k] = val[k];
          return sorted;
        }, {});
    }
    return val;
  });
}

/**
 * Compute SHA-256 hash of a canonicalized object.
 * @param {object} obj
 * @returns {Buffer} 32-byte hash
 */
function canonicalHash(obj) {
  const canonical = canonicalize(obj);
  return createHash("sha256").update(canonical, "utf8").digest();
}

/**
 * Create a Data Integrity proof for a credential.
 * @param {object} params
 * @param {object} params.credential - The unsigned credential
 * @param {string} params.verificationMethod - DID URL of the signing key
 * @param {Buffer} params.privateKey - Ed25519 private key (32 bytes raw or 64 bytes with seed)
 * @param {string} [params.created] - ISO 8601 timestamp (defaults to now)
 * @param {string} [params.purpose] - proof purpose (defaults to "assertionMethod")
 * @returns {object} Credential with embedded proof
 */
function createProof({ credential, verificationMethod, privateKey, created, purpose = "assertionMethod" }) {
  const proofCreated = created || new Date().toISOString();
  const proofPurpose = purpose;

  // Build the document to be signed: credential + proof options
  const docToSign = {
    ...credential,
    "@context": credential["@context"],
  };

  const proofOptions = {
    "@context": ["https://w3.org/2018/credentials/v1", "https://w3.org/2018/credentials/examples/v1"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: proofCreated,
    verificationMethod,
    proofPurpose,
  };

  // Canonicalize the proof options and the document, then concatenate
  const canonicalOptions = canonicalize(proofOptions);
  const canonicalDoc = canonicalize(docToSign);
  const combined = canonicalOptions + canonicalDoc;
  const dataToSign = createHash("sha256").update(combined, "utf8").digest();

  // Sign with Ed25519 using top-level sign function
  const signature = signEd25519(null, dataToSign, privateKey);

  // Multibase-encode the signature (z + base58btc)
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const b of signature) {
    num = num * 256n + BigInt(b);
  }
  let encoded = "";
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    encoded = B58[rem] + encoded;
  }

  return {
    ...credential,
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-jcs-2022",
      created: proofCreated,
      verificationMethod,
      proofPurpose,
      proofValue: "z" + encoded,
    },
  };
}

/**
 * Verify a Data Integrity proof on a credential.
 * @param {object} params
 * @param {object} params.credential - The credential with proof
 * @param {Buffer} params.publicKey - Ed25519 public key (32 bytes raw)
 * @returns {{ verified: boolean, error?: string }}
 */
function verifyProof({ credential, publicKey }) {
  const { proof, ...unsignedCredential } = credential;

  if (!proof) {
    return { verified: false, error: "No proof found on credential" };
  }

  if (proof.type !== "DataIntegrityProof") {
    return { verified: false, error: `Unsupported proof type: ${proof.type}` };
  }

  if (proof.cryptosuite !== "eddsa-jcs-2022") {
    return { verified: false, error: `Unsupported cryptosuite: ${proof.cryptosuite}` };
  }

  if (!proof.proofValue) {
    return { verified: false, error: "Missing proofValue" };
  }

  // Decode the multibase proof value
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const b58Value = proof.proofValue.slice(1); // strip 'z' prefix
  let num = 0n;
  for (const ch of b58Value) {
    const idx = B58.indexOf(ch);
    if (idx === -1) return { verified: false, error: "Invalid base58btc in proofValue" };
    num = num * 58n + BigInt(idx);
  }
  const sigBytes = [];
  let temp = num;
  while (temp > 0n) {
    sigBytes.unshift(Number(temp & 0xffn));
    temp = temp >> 8n;
  }
  const signature = Buffer.from(sigBytes);

  // Reconstruct the signed data
  const proofOptions = {
    "@context": proof["@context"] || [
      "https://w3.org/2018/credentials/v1",
      "https://w3.org/2018/credentials/examples/v1",
    ],
    type: proof.type,
    cryptosuite: proof.cryptosuite,
    created: proof.created,
    verificationMethod: proof.verificationMethod,
    proofPurpose: proof.proofPurpose,
  };

  const canonicalOptions = canonicalize(proofOptions);
  const canonicalDoc = canonicalize(unsignedCredential);
  const combined = canonicalOptions + canonicalDoc;
  const dataToVerify = createHash("sha256").update(combined, "utf8").digest();

  try {
    // Construct an Ed25519 public key object from raw bytes
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const keyObj = createPublicKey({
      key: Buffer.concat([spkiPrefix, publicKey]),
      format: "der",
      type: "spki",
    });
    const valid = verifyEd25519(null, dataToVerify, keyObj, signature);
    return valid
      ? { verified: true }
      : { verified: false, error: "Signature verification failed" };
  } catch (err) {
    return { verified: false, error: `Verification error: ${err.message}` };
  }
}

module.exports = {
  canonicalize,
  canonicalHash,
  createProof,
  verifyProof,
};
