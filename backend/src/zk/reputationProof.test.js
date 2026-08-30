"use strict";

const bls = require("./bls12381");
const ped = require("./pedersen");
const merkle = require("./merkle");
const reputationProof = require("./reputationProof");

const SUBJECT = "GFREELANCER1234567890123456789012345678901234567890";
const SEED = "test-seed-for-freelancer-openings";

/** Build a simulated N-rating history with deterministic openings. */
function buildHistory(n, subject = SUBJECT, seed = SEED, scoreOf = () => 450n) {
  const leaves = [];
  const encoded = [];
  for (let i = 0; i < n; i += 1) {
    const values = { score: scoreOf(i), amount: 1000n + BigInt(i) * 10n, dispute: 0n };
    const blindings = {
      score: ped.deriveBlinding(seed, `score:${i}`),
      amount: ped.deriveBlinding(seed, `amount:${i}`),
      dispute: ped.deriveBlinding(seed, `dispute:${i}`),
    };
    const commitments = {
      score: ped.commit(values.score, blindings.score),
      amount: ped.commit(values.amount, blindings.amount),
      dispute: ped.commit(values.dispute, blindings.dispute),
    };
    leaves.push({ index: i, values, blindings, commitments });
    encoded.push(
      merkle.encodeLeaf({
        index: i,
        revoked: false,
        subject,
        commitments: {
          score: bls.serialize(commitments.score),
          amount: bls.serialize(commitments.amount),
          dispute: bls.serialize(commitments.dispute),
        },
      })
    );
  }
  const root = merkle.computeRoot(encoded).toString("hex");
  return { leaves, encoded, root, epoch: n };
}

function baseContext(overrides = {}) {
  return {
    audience: "GCLIENT999",
    purpose: "job-application:job-42",
    nonce: "fixed-test-nonce",
    expiresAt: Date.now() + 3600_000,
    ...overrides,
  };
}

describe("zk/reputationProof — end to end", () => {
  test("a freelancer proves rating_threshold without revealing individual scores", async () => {
    const { leaves, encoded, root, epoch } = buildHistory(25, SUBJECT, SEED, (i) =>
      i % 3 === 0 ? 500n : 450n
    );
    const resolveEpoch = (subject, e) =>
      subject === SUBJECT && e === epoch ? { root, valid: true } : null;

    const proof = reputationProof.buildProof({
      subject: SUBJECT,
      statementKind: "rating_threshold",
      statementParams: { thresholdScaled: 450 },
      epoch,
      root,
      startIndex: 0,
      endIndex: 19,
      context: baseContext(),
      leaves: leaves.slice(0, 20),
      allEncodedLeaves: encoded,
    });

    // The proof object must not contain any bare star ratings.
    expect(JSON.stringify(proof)).not.toMatch(/"value":"45/);

    const result = await reputationProof.verifyProof(proof, {
      resolveEpoch,
      audience: "GCLIENT999",
      purpose: "job-application:job-42",
    });
    expect(result.ok).toBe(true);
  });

  test("NEGATIVE: a proof cannot be replayed against a different audience", async () => {
    const { leaves, encoded, root, epoch } = buildHistory(20);
    const resolveEpoch = () => ({ root, valid: true });
    const proof = reputationProof.buildProof({
      subject: SUBJECT,
      statementKind: "rating_threshold",
      statementParams: { thresholdScaled: 450 },
      epoch,
      root,
      startIndex: 0,
      endIndex: 19,
      context: baseContext(),
      leaves,
      allEncodedLeaves: encoded,
    });
    const result = await reputationProof.verifyProof(proof, {
      resolveEpoch,
      audience: "GATTACKER",
      purpose: "job-application:job-42",
    });
    expect(result).toEqual({ ok: false, reason: "audience_mismatch" });
  });

  test("NEGATIVE: an expired proof is rejected", async () => {
    const { leaves, encoded, root, epoch } = buildHistory(20);
    const resolveEpoch = () => ({ root, valid: true });
    const proof = reputationProof.buildProof({
      subject: SUBJECT,
      statementKind: "rating_threshold",
      statementParams: { thresholdScaled: 450 },
      epoch,
      root,
      startIndex: 0,
      endIndex: 19,
      context: baseContext({ expiresAt: Date.now() - 1000 }),
      leaves,
      allEncodedLeaves: encoded,
    });
    expect((await reputationProof.verifyProof(proof, { resolveEpoch })).reason).toBe("expired");
  });

  test("NEGATIVE: a revoked epoch invalidates every proof bound to it", async () => {
    const { leaves, encoded, root, epoch } = buildHistory(20);
    const proof = reputationProof.buildProof({
      subject: SUBJECT,
      statementKind: "rating_threshold",
      statementParams: { thresholdScaled: 450 },
      epoch,
      root,
      startIndex: 0,
      endIndex: 19,
      context: baseContext(),
      leaves,
      allEncodedLeaves: encoded,
    });
    const resolveRevoked = () => ({ root, valid: false });
    expect(
      (await reputationProof.verifyProof(proof, { resolveEpoch: resolveRevoked })).reason
    ).toBe("revoked");
  });

  test("NEGATIVE: an epoch before the offending rating was included stays valid (revocation is not retroactive past its own inclusion)", async () => {
    const { root, epoch } = buildHistory(20);
    // A proof bound to an *earlier* epoch, before whatever gets revoked
    // later, must still resolve to a valid, differently-rooted anchor.
    const earlierHistory = buildHistory(10);
    const proof = reputationProof.buildProof({
      subject: SUBJECT,
      statementKind: "rating_threshold",
      statementParams: { thresholdScaled: 450 },
      epoch: earlierHistory.epoch,
      root: earlierHistory.root,
      startIndex: 0,
      endIndex: 9,
      context: baseContext(),
      leaves: earlierHistory.leaves,
      allEncodedLeaves: earlierHistory.encoded,
    });
    const resolveEpoch = (subject, e) => {
      if (e === earlierHistory.epoch) return { root: earlierHistory.root, valid: true };
      if (e === epoch) return { root, valid: false }; // the later epoch got revoked
      return null;
    };
    expect((await reputationProof.verifyProof(proof, { resolveEpoch })).ok).toBe(true);
  });

  test("NEGATIVE: swapping in a forged leaf commitment the attacker does not control the opening of breaks verification", async () => {
    const { leaves, encoded, root, epoch } = buildHistory(20);
    const resolveEpoch = () => ({ root, valid: true });
    const proof = reputationProof.buildProof({
      subject: SUBJECT,
      statementKind: "rating_threshold",
      statementParams: { thresholdScaled: 450 },
      epoch,
      root,
      startIndex: 0,
      endIndex: 19,
      context: baseContext(),
      leaves,
      allEncodedLeaves: encoded,
    });
    const forged = JSON.parse(JSON.stringify(proof));
    forged.leafCommitmentsHex.score[5] = bls
      .serialize(ped.commit(500n, ped.randomBlinding()))
      .toString("hex");
    expect((await reputationProof.verifyProof(forged, { resolveEpoch })).ok).toBe(false);
  });

  test("NEGATIVE: refuses to build a proof for a false rating_threshold claim", () => {
    const { leaves, encoded, root, epoch } = buildHistory(20, SUBJECT, SEED, () => 450n);
    expect(() =>
      reputationProof.buildProof({
        subject: SUBJECT,
        statementKind: "rating_threshold",
        statementParams: { thresholdScaled: 500 }, // history is all 450, never 500
        epoch,
        root,
        startIndex: 0,
        endIndex: 19,
        context: baseContext(),
        leaves,
        allEncodedLeaves: encoded,
      })
    ).toThrow(/does not hold/);
  });

  test("earnings_band and dispute_free proofs verify end to end", async () => {
    const { leaves, encoded, root, epoch } = buildHistory(10);
    const resolveEpoch = () => ({ root, valid: true });

    const earningsProof = reputationProof.buildProof({
      subject: SUBJECT,
      statementKind: "earnings_band",
      statementParams: { minAmount: 10000, maxAmount: 11000 },
      epoch,
      root,
      startIndex: 0,
      endIndex: 9,
      context: baseContext({ purpose: "earnings-check" }),
      leaves,
      allEncodedLeaves: encoded,
    });
    expect(
      (
        await reputationProof.verifyProof(earningsProof, {
          resolveEpoch,
          purpose: "earnings-check",
        })
      ).ok
    ).toBe(true);

    const disputeProof = reputationProof.buildProof({
      subject: SUBJECT,
      statementKind: "dispute_free",
      statementParams: {},
      epoch,
      root,
      startIndex: 0,
      endIndex: 9,
      context: baseContext({ purpose: "dispute-check" }),
      leaves,
      allEncodedLeaves: encoded,
    });
    expect(
      (await reputationProof.verifyProof(disputeProof, { resolveEpoch, purpose: "dispute-check" }))
        .ok
    ).toBe(true);
  });
});
