/**
 * src/zk/statements.js
 *
 * The four provable reputation statements (Issue #319), each reduced to the
 * two audited circuits in rangeProof.js and equalityProof.js via the
 * Pedersen homomorphism. See docs/ADR-010-zk-reputation.md for the full
 * design rationale and the scope decision this module encodes: a proof
 * covers a *contiguous, publicly-stated leaf range* of a subject's rating
 * history (e.g. "jobs 12 through 44"), not an arbitrarily-chosen hidden
 * subset. The range's endpoints are visible to the verifier; the individual
 * star ratings, bid amounts, and dispute outcomes inside it are not — only
 * the aggregate claim is.
 *
 * Statement types:
 *
 *   rating_threshold   avg(score) over the range ≥ threshold (score scaled
 *                       ×100, so "≥ 4.5" is threshold = 450)
 *   completion_count   range length ≥ minCount (the range bounds are public,
 *                       so this is really "the prover controls ≥ minCount
 *                       committed, Merkle-anchored ratings" — see
 *                       verifyLeafRange in reputationProof.js for how a
 *                       count claim is actually anchored to real leaves)
 *   earnings_band      sum(amount) over the range ∈ [minAmount, maxAmount]
 *   dispute_free       sum(disputeFlag) over the range == 0, exactly
 *
 * Each statement below returns { kind, publicParams, prove, verify } — prove
 * consumes the prover's plaintext (value, blinding) pairs for the leaves in
 * range; verify consumes only the aggregate commitment(s) any verifier can
 * recompute homomorphically from public per-leaf commitments.
 */
"use strict";

const bls = require("./bls12381");
const ped = require("./pedersen");
const rangeProof = require("./rangeProof");
const equalityProof = require("./equalityProof");

/** Ratings are stored ×100 (1..5 stars -> 100..500) to stay integral. */
const SCORE_SCALE = 100;
const MAX_SCORE_PER_JOB = 5 * SCORE_SCALE;

/** Bit widths sized to the largest value each aggregate can plausibly reach.
 *  Kept small deliberately: proof size and on-chain verification cost are
 *  both linear in bit width (see rangeProof.js doc comment). */
const BIT_WIDTH = {
  // avg*count - threshold*count, bounded by (max score - min threshold) * max jobs.
  ratingThreshold: 32,
  completionCount: 24,
  earningsBand: 48, // stroops; XLM amounts can be large
};

/** Sum a list of Fr scalars (used for both values-as-scalars and blindings). */
function sumScalars(values) {
  return values.reduce((acc, v) => bls.frAdd(acc, BigInt(v)), 0n);
}

// ─── rating_threshold ────────────────────────────────────────────────────────
//
// Claim: avg(score) >= thresholdScaled, over `count` jobs (count is public —
// it is the stated range length). Equivalent to: sum(score) - threshold*count
// >= 0, which is exactly a homomorphic shift-and-scale of the aggregate score
// commitment, followed by a non-negativity range proof.

function ratingThreshold({ thresholdScaled, count }) {
  if (!Number.isInteger(thresholdScaled) && typeof thresholdScaled !== "bigint") {
    throw new Error("statements: thresholdScaled must be an integer");
  }
  const threshold = BigInt(thresholdScaled);
  if (threshold < SCORE_SCALE || threshold > BigInt(MAX_SCORE_PER_JOB)) {
    throw new Error("statements: thresholdScaled out of [100, 500]");
  }
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("statements: count must be a positive integer");
  }

  return {
    kind: "rating_threshold",
    publicParams: { thresholdScaled: threshold.toString(), count },

    prove(transcript, { scoreValues, scoreBlindings }) {
      if (scoreValues.length !== count) throw new Error("statements: score count mismatch");
      const sumBlind = sumScalars(scoreBlindings);
      const trueDiff = scoreValues.reduce((a, v) => a + BigInt(v), 0n) - threshold * BigInt(count);
      if (trueDiff < 0n) {
        throw new Error("statements: rating_threshold does not hold for given values");
      }
      return rangeProof.prove(transcript, {
        value: trueDiff,
        blinding: sumBlind,
        bitWidth: BIT_WIDTH.ratingThreshold,
      });
    },

    verify(transcript, { scoreCommitments }, proof) {
      if (scoreCommitments.length !== count) return false;
      const sumCommitment = ped.addCommitments(scoreCommitments);
      const shifted = ped.shiftByConstant(sumCommitment, -(threshold * BigInt(count)));
      return rangeProof.verify(transcript, shifted, proof);
    },
  };
}

// ─── completion_count ────────────────────────────────────────────────────────
//
// Claim: the prover controls a committed, Merkle-anchored range of at least
// minCount ratings. Because the range length is exactly the public `count`
// parameter (see reputationProof.js), this statement's cryptographic content
// is just `count >= minCount`, checked in plain arithmetic by the verifier —
// no circuit needed. It is still routed through this module so every
// statement shares one shape and one place that defines what "true" means.

function completionCount({ minCount, count }) {
  if (!Number.isInteger(minCount) || minCount <= 0) {
    throw new Error("statements: minCount must be a positive integer");
  }
  if (!Number.isInteger(count) || count < minCount) {
    throw new Error("statements: count must be >= minCount to prove this claim");
  }
  return {
    kind: "completion_count",
    publicParams: { minCount, count },
    prove() {
      return {}; // no circuit: truth is the public arithmetic count >= minCount
    },
    verify(transcript, context, proof) {
      void transcript;
      void context;
      void proof;
      return count >= minCount;
    },
  };
}

// ─── earnings_band ───────────────────────────────────────────────────────────
//
// Claim: sum(amount) over the range is in [minAmount, maxAmount] (stroops).
// Two independent range proofs: sum - min >= 0, and max - sum >= 0.

function earningsBand({ minAmount, maxAmount, count }) {
  const lo = BigInt(minAmount);
  const hi = BigInt(maxAmount);
  if (lo < 0n || hi < lo) throw new Error("statements: invalid earnings band");
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("statements: count must be a positive integer");
  }

  return {
    kind: "earnings_band",
    publicParams: { minAmount: lo.toString(), maxAmount: hi.toString(), count },

    prove(transcript, { amountValues, amountBlindings }) {
      if (amountValues.length !== count) throw new Error("statements: amount count mismatch");
      const total = amountValues.reduce((a, v) => a + BigInt(v), 0n);
      if (total < lo || total > hi) {
        throw new Error("statements: earnings_band does not hold for given values");
      }
      const sumBlind = sumScalars(amountBlindings);
      const lowerProof = rangeProof.prove(transcript.fork("earnings.lower"), {
        value: total - lo,
        blinding: sumBlind,
        bitWidth: BIT_WIDTH.earningsBand,
      });
      const upperProof = rangeProof.prove(transcript.fork("earnings.upper"), {
        value: hi - total,
        blinding: bls.frNeg(sumBlind),
        bitWidth: BIT_WIDTH.earningsBand,
      });
      return { lowerProof, upperProof };
    },

    verify(transcript, { amountCommitments }, proof) {
      if (amountCommitments.length !== count) return false;
      const sumCommitment = ped.addCommitments(amountCommitments);
      const lowerTarget = ped.shiftByConstant(sumCommitment, -lo);
      const negSum = ped.scale(sumCommitment, bls.frNeg(1n));
      const upperTarget = ped.shiftByConstant(negSum, hi);
      const lowerOk = rangeProof.verify(
        transcript.fork("earnings.lower"),
        lowerTarget,
        proof.lowerProof
      );
      const upperOk = rangeProof.verify(
        transcript.fork("earnings.upper"),
        upperTarget,
        proof.upperProof
      );
      return lowerOk && upperOk;
    },
  };
}

// ─── dispute_free ────────────────────────────────────────────────────────────
//
// Claim: sum(disputeFlag) over the range == 0 exactly. An equality proof, not
// a range proof — the claim is precise, not bounded.

function disputeFree({ count }) {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("statements: count must be a positive integer");
  }
  return {
    kind: "dispute_free",
    publicParams: { count },

    prove(transcript, { disputeValues, disputeBlindings }) {
      if (disputeValues.length !== count) throw new Error("statements: dispute count mismatch");
      const total = disputeValues.reduce((a, v) => a + BigInt(v), 0n);
      if (total !== 0n) {
        throw new Error("statements: dispute_free does not hold for given values");
      }
      const sumBlind = sumScalars(disputeBlindings);
      const sumCommitment = ped.commit(0n, sumBlind);
      return equalityProof.prove(transcript, {
        commitment: sumCommitment,
        target: 0n,
        blinding: sumBlind,
      });
    },

    verify(transcript, { disputeCommitments }, proof) {
      if (disputeCommitments.length !== count) return false;
      const sumCommitment = ped.addCommitments(disputeCommitments);
      return equalityProof.verify(transcript, sumCommitment, 0n, proof);
    },
  };
}

const BUILDERS = {
  rating_threshold: ratingThreshold,
  completion_count: completionCount,
  earnings_band: earningsBand,
  dispute_free: disputeFree,
};

function buildStatement(kind, params) {
  const builder = BUILDERS[kind];
  if (!builder) throw new Error(`statements: unknown statement kind "${kind}"`);
  return builder(params);
}

module.exports = {
  SCORE_SCALE,
  MAX_SCORE_PER_JOB,
  BIT_WIDTH,
  ratingThreshold,
  completionCount,
  earningsBand,
  disputeFree,
  buildStatement,
};
