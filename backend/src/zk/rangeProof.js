/**
 * src/zk/rangeProof.js
 *
 * Bit-decomposition range proof over Pedersen commitments (Issue #319).
 *
 * This is the one circuit every provable statement in this system reduces to:
 * "the value hidden in this commitment is a non-negative integer less than
 * 2^n". Every statement in docs/ADR-010 — rating ≥ threshold, completions ≥ N,
 * earnings within a band, dispute-free streak ≥ K — is turned into range
 * membership by the caller (see statements.js) using the homomorphism in
 * pedersen.js, and then proved here. One audited circuit, four statements.
 *
 * Protocol (a disjunctive Chaum–Pedersen OR-proof per bit, chained by
 * Fiat–Shamir, in the tradition of Groth's OR-composition — this predates and
 * is simpler than Bulletproofs, which was the right trade for this codebase:
 * proof size is linear in bit-width rather than logarithmic, but every step
 * is a small number of scalar/point ops with no inner-product argument to get
 * subtly wrong, which is worth more here than proof size given `BIT_WIDTH` is
 * at most 32).
 *
 * For commitment C = v·G + ρ·H with v ∈ [0, 2^n):
 *   1. Prover decomposes v = Σ b_i 2^i, commits each bit as
 *      C_i = b_i·G + ρ_i·H with Σ ρ_i 2^i = ρ (so ΣC_i·2^i = C exactly —
 *      this is why the ρ_i are solved for, not sampled, for the last bit).
 *   2. For each bit, the prover proves C_i opens to 0 OR to 1, without saying
 *      which, using a standard 2-branch Chaum–Pedersen OR-proof:
 *      the *real* branch gets an honestly computed response; the *simulated*
 *      branch has its challenge and response chosen freely and its commitment
 *      derived backward from the verification equation. The two branch
 *      challenges are forced to sum to a value the verifier recomputes, which
 *      is what stops the prover from making both branches "real" (i.e.
 *      proving C_i opens to something that is neither 0 nor 1).
 *   3. All bit challenges are drawn from one Fiat–Shamir transcript, binding
 *      the whole range proof (and, via the caller, the whole reputation
 *      claim) into one non-interactive object.
 *
 * SOUNDNESS ARGUMENT (why a false statement cannot verify):
 *   Each bit's OR-proof is sound under the discrete-log assumption on G/H
 *   with unknown relative log (Chaum–Pedersen soundness: forging a response
 *   for a branch you didn't open requires either finding log_G(H) or
 *   guessing the challenge, both negligible). So every C_i is bound to open
 *   to 0 or 1 by knowledge extraction. The verifier then homomorphically
 *   checks Σ C_i·2^i = C, so those bits are forced to be a decomposition of
 *   the *same* v under the *same* ρ. Hence v = Σ b_i 2^i is bounded in
 *   [0, 2^n) as a plain consequence of being an n-bit binary sum, and it
 *   equals the value inside C. No proof exists for a value outside that
 *   range; the negative tests in rangeProof.test.js construct exactly this
 *   attempt and confirm verify() rejects it.
 */
"use strict";

const bls = require("./bls12381");
const { G, H } = require("./pedersen");

/** Ratings run 1–5, amounts and streaks fit comfortably under 2^32. */
const MAX_BIT_WIDTH = 64;

function assertBitWidth(bitWidth) {
  if (!Number.isInteger(bitWidth) || bitWidth < 1 || bitWidth > MAX_BIT_WIDTH) {
    throw new Error(`rangeProof: bitWidth must be an integer in [1, ${MAX_BIT_WIDTH}]`);
  }
}

/**
 * Prove that `value` (with known blinding `blinding` such that
 * commitment = value*G + blinding*H) lies in [0, 2^bitWidth).
 *
 * Throws if `value` is out of range — this is a prover-side guard, not the
 * security boundary; the security boundary is verify() below, which the
 * negative tests target directly by hand-crafting proofs for out-of-range
 * values.
 */
function prove(transcript, { value, blinding, bitWidth }) {
  assertBitWidth(bitWidth);
  if (value < 0n || value >= 1n << BigInt(bitWidth)) {
    throw new Error("rangeProof: value out of stated range");
  }

  const bits = [];
  for (let i = 0; i < bitWidth; i += 1) bits.push((value >> BigInt(i)) & 1n);

  // Per-bit blindings, sampled freely except the last, which is solved so
  // that Σ ρ_i 2^i = ρ exactly (ties the bit commitments back to C).
  const bitBlindings = [];
  let weightedSum = 0n;
  for (let i = 0; i < bitWidth - 1; i += 1) {
    const rho = bls.frMod(BigInt(`0x${require("crypto").randomBytes(32).toString("hex")}`));
    bitBlindings.push(rho);
    weightedSum = bls.frAdd(weightedSum, bls.frMul(rho, 1n << BigInt(i)));
  }
  const lastWeight = 1n << BigInt(bitWidth - 1);
  const lastWeightInv = bls.frInv(bls.frMod(lastWeight));
  const lastBlinding = bls.frMul(bls.frSub(blinding, weightedSum), lastWeightInv);
  bitBlindings.push(lastBlinding);

  const bitCommitments = bits.map((b, i) =>
    bls.add(bls.multiply(G, b), bls.multiply(H, bitBlindings[i]))
  );

  transcript.absorbUint("range.bitWidth", bitWidth);
  transcript.absorbPoints("range.bitCommitments", bitCommitments);

  // Per-bit OR-proof (Chaum–Pedersen, branch on b_i = 0 vs b_i = 1).
  const branches = bits.map((b, i) => {
    const Ci = bitCommitments[i];
    const rho = bitBlindings[i];
    const real = b === 1n ? 1 : 0;
    const sim = 1 - real;

    // Simulated branch: pick response + challenge freely, derive its
    // commitment "in reverse" from the verification equation.
    const simChallenge = bls.frMod(
      BigInt(`0x${require("crypto").randomBytes(32).toString("hex")}`)
    );
    const simResponse = bls.frMod(BigInt(`0x${require("crypto").randomBytes(32).toString("hex")}`));
    // Branch statement for b=k: Ci - k*G = rho*H. Verify: simResponse*H ?= A + simChallenge*(Ci - k*G)
    const target = sim === 1 ? bls.subtract(Ci, G) : Ci;
    const simA = bls.subtract(bls.multiply(H, simResponse), bls.multiply(target, simChallenge));

    // Real branch nonce.
    const k = bls.frMod(BigInt(`0x${require("crypto").randomBytes(32).toString("hex")}`));
    const realA = bls.multiply(H, k);

    const A0 = real === 0 ? realA : simA;
    const A1 = real === 1 ? realA : simA;

    return { real, rho, k, simChallenge, simResponse, A0, A1 };
  });

  branches.forEach((branch, i) => {
    transcript.absorbPoint(`range.bit[${i}].A0`, branch.A0);
    transcript.absorbPoint(`range.bit[${i}].A1`, branch.A1);
  });

  const bitProofs = branches.map((branch, i) => {
    const e = transcript.challengeScalar(`range.bit[${i}].e`);
    const otherChallenge = branch.simChallenge;
    const realChallenge = bls.frSub(e, otherChallenge);
    const realResponse = bls.frAdd(branch.k, bls.frMul(realChallenge, branch.rho));

    const e0 = branch.real === 0 ? realChallenge : otherChallenge;
    const e1 = branch.real === 1 ? realChallenge : otherChallenge;
    const z0 = branch.real === 0 ? realResponse : branch.simResponse;
    const z1 = branch.real === 1 ? realResponse : branch.simResponse;

    return {
      A0: branch.A0,
      A1: branch.A1,
      e0,
      e1,
      z0,
      z1,
    };
  });

  return { bitWidth, bitCommitments, bitProofs };
}

/**
 * Verify a range proof against `commitment`.
 *
 * Returns false — never throws on adversarial input — for any malformed or
 * false proof, including one where the two branch challenges do not sum to
 * the transcript challenge (which is exactly what forging a "both branches
 * real" proof would require).
 */
function verify(transcript, commitment, proof) {
  try {
    assertBitWidth(proof.bitWidth);
    if (proof.bitCommitments.length !== proof.bitWidth) return false;
    if (proof.bitProofs.length !== proof.bitWidth) return false;

    transcript.absorbUint("range.bitWidth", proof.bitWidth);
    transcript.absorbPoints("range.bitCommitments", proof.bitCommitments);
    proof.bitProofs.forEach((bp, i) => {
      transcript.absorbPoint(`range.bit[${i}].A0`, bp.A0);
      transcript.absorbPoint(`range.bit[${i}].A1`, bp.A1);
    });

    // Reconstruct Σ C_i·2^i and compare against the commitment under test.
    let weightedSum = bls.INFINITY;
    for (let i = 0; i < proof.bitWidth; i += 1) {
      weightedSum = bls.add(weightedSum, bls.multiply(proof.bitCommitments[i], 1n << BigInt(i)));
    }
    if (!bls.equals(weightedSum, commitment)) return false;

    for (let i = 0; i < proof.bitWidth; i += 1) {
      const e = transcript.challengeScalar(`range.bit[${i}].e`);
      const bp = proof.bitProofs[i];
      const eSum = bls.frAdd(bp.e0, bp.e1);
      if (eSum !== e) return false;

      const Ci = proof.bitCommitments[i];
      // Branch 0: Ci = rho*H  →  z0*H ?= A0 + e0*Ci
      const lhs0 = bls.multiply(H, bp.z0);
      const rhs0 = bls.add(bp.A0, bls.multiply(Ci, bp.e0));
      if (!bls.equals(lhs0, rhs0)) return false;

      // Branch 1: Ci - G = rho*H  →  z1*H ?= A1 + e1*(Ci - G)
      const target1 = bls.subtract(Ci, G);
      const lhs1 = bls.multiply(H, bp.z1);
      const rhs1 = bls.add(bp.A1, bls.multiply(target1, bp.e1));
      if (!bls.equals(lhs1, rhs1)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/** Serialize a range proof to a flat byte buffer for on-chain submission. */
function serializeProof(proof) {
  const parts = [];
  const header = Buffer.alloc(4);
  header.writeUInt32BE(proof.bitWidth, 0);
  parts.push(header);
  for (const c of proof.bitCommitments) parts.push(bls.serialize(c));
  for (const bp of proof.bitProofs) {
    parts.push(bls.serialize(bp.A0), bls.serialize(bp.A1));
    parts.push(bls.frToBytes(bp.e0), bls.frToBytes(bp.e1));
    parts.push(bls.frToBytes(bp.z0), bls.frToBytes(bp.z1));
  }
  return Buffer.concat(parts);
}

function deserializeProof(buf) {
  let offset = 0;
  const bitWidth = buf.readUInt32BE(offset);
  offset += 4;
  assertBitWidth(bitWidth);

  const bitCommitments = [];
  for (let i = 0; i < bitWidth; i += 1) {
    bitCommitments.push(bls.deserialize(buf.subarray(offset, offset + bls.G1_BYTES)));
    offset += bls.G1_BYTES;
  }

  const bitProofs = [];
  for (let i = 0; i < bitWidth; i += 1) {
    const A0 = bls.deserialize(buf.subarray(offset, offset + bls.G1_BYTES));
    offset += bls.G1_BYTES;
    const A1 = bls.deserialize(buf.subarray(offset, offset + bls.G1_BYTES));
    offset += bls.G1_BYTES;
    const e0 = bls.bytesToFr(buf.subarray(offset, offset + bls.FR_BYTES));
    offset += bls.FR_BYTES;
    const e1 = bls.bytesToFr(buf.subarray(offset, offset + bls.FR_BYTES));
    offset += bls.FR_BYTES;
    const z0 = bls.bytesToFr(buf.subarray(offset, offset + bls.FR_BYTES));
    offset += bls.FR_BYTES;
    const z1 = bls.bytesToFr(buf.subarray(offset, offset + bls.FR_BYTES));
    offset += bls.FR_BYTES;
    bitProofs.push({ A0, A1, e0, e1, z0, z1 });
  }

  if (offset !== buf.length) throw new Error("rangeProof: trailing bytes");
  return { bitWidth, bitCommitments, bitProofs };
}

module.exports = { MAX_BIT_WIDTH, prove, verify, serializeProof, deserializeProof };
