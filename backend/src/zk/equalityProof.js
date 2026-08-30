/**
 * src/zk/equalityProof.js
 *
 * Schnorr proof of knowledge that a Pedersen commitment opens to a *public*
 * value (Issue #319).
 *
 * For C = v·G + ρ·H and a public target t, define C' = C - t·G = ρ·H. Proving
 * C opens to t reduces to a Schnorr proof of knowledge of the discrete log of
 * C' base H — standard, and exact (unlike a range proof, which only bounds a
 * value between two limits, this pins it to one value). Used for the
 * dispute-free-streak statement: "the sum of dispute flags over my last K
 * jobs is exactly 0", which range-bounding to [0, 1) would say less precisely
 * and less cheaply.
 *
 * Soundness: forging a valid (A, z) pair for a C' that is *not* v'·H for any
 * v' requires computing a discrete log or predicting the Fiat–Shamir
 * challenge before committing to the nonce — both negligible under the
 * discrete-log assumption on H. The negative tests in equalityProof.test.js
 * construct a commitment to a *different* value and confirm the proof for
 * "equals 0" fails against it.
 */
"use strict";

const crypto = require("crypto");
const bls = require("./bls12381");
const { G, H } = require("./pedersen");

/**
 * Prove that `commitment` opens to public value `target` under blinding
 * `blinding` (i.e. commitment = target*G + blinding*H).
 */
function prove(transcript, { commitment, target, blinding }) {
  const k = bls.frMod(BigInt(`0x${crypto.randomBytes(32).toString("hex")}`));
  const A = bls.multiply(H, k);

  transcript.absorbPoint("eq.commitment", commitment);
  transcript.absorbUint("eq.target", target);
  transcript.absorbPoint("eq.A", A);
  const e = transcript.challengeScalar("eq.e");

  const z = bls.frAdd(k, bls.frMul(e, blinding));
  return { A, z };
}

/** Verify against `commitment` and the same public `target` used to prove. */
function verify(transcript, commitment, target, proof) {
  try {
    const cPrime = bls.subtract(commitment, bls.multiply(G, target));
    transcript.absorbPoint("eq.commitment", commitment);
    transcript.absorbUint("eq.target", target);
    transcript.absorbPoint("eq.A", proof.A);
    const e = transcript.challengeScalar("eq.e");

    const lhs = bls.multiply(H, proof.z);
    const rhs = bls.add(proof.A, bls.multiply(cPrime, e));
    return bls.equals(lhs, rhs);
  } catch {
    return false;
  }
}

function serializeProof(proof) {
  return Buffer.concat([bls.serialize(proof.A), bls.frToBytes(proof.z)]);
}

function deserializeProof(buf) {
  if (buf.length !== bls.G1_BYTES + bls.FR_BYTES) {
    throw new Error("equalityProof: bad length");
  }
  const A = bls.deserialize(buf.subarray(0, bls.G1_BYTES));
  const z = bls.bytesToFr(buf.subarray(bls.G1_BYTES));
  return { A, z };
}

module.exports = { prove, verify, serializeProof, deserializeProof };
