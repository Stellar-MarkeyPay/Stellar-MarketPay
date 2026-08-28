/**
 * src/zk/pedersen.js
 *
 * Pedersen commitments over BLS12-381 G1 (Issue #319).
 *
 *   Com(v, ρ) = v·G + ρ·H
 *
 * Perfectly hiding, computationally binding, and additively homomorphic:
 *
 *   Com(v1, ρ1) + Com(v2, ρ2) = Com(v1 + v2, ρ1 + ρ2)
 *   k·Com(v, ρ)               = Com(k·v, k·ρ)
 *
 * The homomorphism is the whole design. Because the aggregate of a
 * freelancer's rating commitments is itself a commitment to the totals, the
 * anchored value can be published on-chain without leaking anything — it is
 * perfectly hiding — and a verifier never needs the individual ratings to
 * check a claim about their sum.
 *
 * G and H are derived from fixed labels by try-and-increment (see
 * bls12381.deriveGenerator). Nobody knows log_G(H); there is no trusted setup
 * and no toxic waste. The literal bytes are pinned below so the Rust verifier
 * and this module cannot silently drift apart, and a test re-derives them.
 */
"use strict";

const crypto = require("crypto");
const bls = require("./bls12381");

/** Domain-separated generator labels. */
const VALUE_GENERATOR_LABEL = "value";
const BLIND_GENERATOR_LABEL = "blind";

/**
 * Pinned serializations of the two generators.
 *
 * These are the output of `deriveGenerator(label)`. They are pinned rather
 * than derived at import time for two reasons: the Soroban contract embeds the
 * same literals, and a silent change to the derivation would silently
 * invalidate every anchored commitment in the database.
 */
const G_BYTES_HEX =
  "0b06ca4e51bae368365f572f031f242adc8986ec3b0dfd3e3d5d89c717cffebf8574acd6ec51a686532bef74c245d4f906e32f5ca5b393e9f0fd8d18741aa342acfd17272e2f9ac39fd63a7d23226f63ef17c22529a3d8c00116a8b5cd1e4a9c";
const H_BYTES_HEX =
  "155431b9513d6a1f2f5df59ff9b44f73f46174eba3c65aaf86fb5b0953bce905a772d023687e0f3c983e2e365bc0dabc190058cfff6aac22a9f24b404a9f457f74c52b97bff2a2b57755ba49ae0cde407bf0fa73410f81ccde07abc58a9212d5";

const G = bls.deserialize(Buffer.from(G_BYTES_HEX, "hex"));
const H = bls.deserialize(Buffer.from(H_BYTES_HEX, "hex"));

/** Fresh uniformly random blinding factor in Fr. */
function randomBlinding() {
  // 64 bytes reduced mod r: bias below 2^-256, well past anything that matters.
  let value = 0n;
  for (const byte of crypto.randomBytes(64)) value = (value << 8n) | BigInt(byte);
  return bls.frMod(value);
}

/**
 * Deterministic blinding factor derived from a secret seed.
 *
 * Rating leaves use this so that a freelancer can recover every opening in
 * their history from a single seed rather than a database of secrets. Losing
 * the seed loses the ability to prove, not the ratings themselves.
 */
function deriveBlinding(seed, label) {
  const seedBuf = Buffer.isBuffer(seed) ? seed : Buffer.from(String(seed), "utf8");
  const digest = crypto
    .createHmac("sha512", seedBuf)
    .update(`MarketPay/ZKREP/blind/v1|${label}`, "utf8")
    .digest();
  let value = 0n;
  for (const byte of digest) value = (value << 8n) | BigInt(byte);
  return bls.frMod(value);
}

/** Com(value, blinding). */
function commit(value, blinding) {
  return bls.add(bls.multiply(G, value), bls.multiply(H, blinding));
}

/** Commitment to the value 0 under the given blinding — a point on H alone. */
function commitZero(blinding) {
  return bls.multiply(H, blinding);
}

/** Sum of commitments — a commitment to the sum of the values. */
function addCommitments(commitments) {
  return commitments.reduce((acc, c) => bls.add(acc, c), bls.INFINITY);
}

/**
 * Homomorphically shift a commitment by a public constant:
 *   shift(Com(v, ρ), k) = Com(v + k, ρ)
 *
 * The verifier uses this to turn "prove avg ≥ T" into "prove this derived
 * commitment holds a non-negative value" without any help from the prover.
 */
function shiftByConstant(commitment, constant) {
  return bls.add(commitment, bls.multiply(G, constant));
}

/** Scale a commitment by a public scalar: k·Com(v, ρ) = Com(k·v, k·ρ). */
function scale(commitment, scalar) {
  return bls.multiply(commitment, scalar);
}

/** Check an opening. Only ever used in tests and by the issuer's self-audit. */
function verifyOpening(commitment, value, blinding) {
  return bls.equals(commitment, commit(value, blinding));
}

module.exports = {
  G,
  H,
  G_BYTES_HEX,
  H_BYTES_HEX,
  VALUE_GENERATOR_LABEL,
  BLIND_GENERATOR_LABEL,
  randomBlinding,
  deriveBlinding,
  commit,
  commitZero,
  addCommitments,
  shiftByConstant,
  scale,
  verifyOpening,
};
