"use strict";

/**
 * src/services/reputationService.test.js
 *
 * Hermetic tests against an in-memory fake of the exact queries
 * reputationService issues (following this repo's pgMock.js convention of
 * purpose-built per-domain fakes rather than a general SQL engine). Covers
 * the full DB-backed lifecycle: issuance -> epoch append -> proof ->
 * verify -> revocation -> proof invalidation, plus the negative cases the
 * epic's acceptance criteria call out explicitly.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-with-enough-length-for-ci";
process.env.REPUTATION_COMMITMENT_KEY = "test-reputation-commitment-key";

function createFakePool() {
  const jobs = new Map();
  const commitments = []; // { id, subject_address, leaf_index, ..., revoked_at }
  const epochs = []; // { subject_address, epoch, root(Buffer), leaf_count, reason }
  const revocations = []; // { subject_address, reputation_commitment_id, invalidates_from_epoch }
  let commitmentSeq = 0;

  function tx() {
    return {
      async query(sql, params = []) {
        return runQuery(sql, params);
      },
      release() {},
    };
  }

  function runQuery(sql, params) {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };

    if (text.startsWith("SELECT budget FROM jobs WHERE id = $1")) {
      const job = jobs.get(params[0]);
      return { rows: job ? [{ budget: job.budget }] : [] };
    }

    if (text.startsWith("SELECT COALESCE(MAX(leaf_index), -1) + 1 AS next_index")) {
      const subj = params[0];
      const max = commitments
        .filter((c) => c.subject_address === subj)
        .reduce((m, c) => Math.max(m, c.leaf_index), -1);
      return { rows: [{ next_index: max + 1 }] };
    }

    if (text.startsWith("INSERT INTO reputation_commitments")) {
      const row = {
        id: `commit-${commitmentSeq++}`,
        rating_id: params[0],
        subject_address: params[1],
        leaf_index: params[2],
        score_commitment: params[3],
        amount_commitment: params[4],
        dispute_commitment: params[5],
        score_value: params[6],
        score_blinding: params[7],
        amount_value: params[8],
        amount_blinding: params[9],
        dispute_value: params[10],
        dispute_blinding: params[11],
        revoked_at: null,
        revoked_reason: null,
        revoked_by: null,
      };
      commitments.push(row);
      return { rows: [{ id: row.id, leaf_index: row.leaf_index }] };
    }

    if (
      text.startsWith("SELECT leaf_index, score_commitment, amount_commitment, dispute_commitment")
    ) {
      const subj = params[0];
      const rows = commitments
        .filter((c) => c.subject_address === subj)
        .sort((a, b) => a.leaf_index - b.leaf_index)
        .map((c) => ({
          leaf_index: c.leaf_index,
          score_commitment: c.score_commitment,
          amount_commitment: c.amount_commitment,
          dispute_commitment: c.dispute_commitment,
          revoked: c.revoked_at != null,
        }));
      return { rows };
    }

    if (text.startsWith("SELECT COALESCE(MAX(epoch), 0) + 1 AS next_epoch")) {
      const subj = params[0];
      const max = epochs
        .filter((e) => e.subject_address === subj)
        .reduce((m, e) => Math.max(m, e.epoch), 0);
      return { rows: [{ next_epoch: max + 1 }] };
    }

    if (text.startsWith("INSERT INTO reputation_epochs")) {
      epochs.push({
        subject_address: params[0],
        epoch: params[1],
        root: params[2],
        leaf_count: params[3],
        reason: params[4],
      });
      return { rows: [] };
    }

    if (
      text.startsWith("SELECT id, subject_address, leaf_index, revoked_at") &&
      text.includes("FOR UPDATE")
    ) {
      const row = commitments.find((c) => c.id === params[0]);
      return { rows: row ? [row] : [] };
    }

    if (text.startsWith("SELECT MIN(epoch) AS epoch FROM reputation_epochs")) {
      const [subj, leafIndex] = params;
      const candidates = epochs.filter(
        (e) => e.subject_address === subj && e.leaf_count > leafIndex
      );
      const min = candidates.length ? Math.min(...candidates.map((e) => e.epoch)) : null;
      return { rows: [{ epoch: min }] };
    }

    if (text.startsWith("UPDATE reputation_commitments")) {
      const row = commitments.find((c) => c.id === params[0]);
      if (row) {
        row.revoked_at = new Date();
        row.revoked_reason = params[1];
        row.revoked_by = params[2];
      }
      return { rows: [] };
    }

    if (text.startsWith("INSERT INTO reputation_revocations")) {
      revocations.push({
        subject_address: params[0],
        reputation_commitment_id: params[1],
        invalidates_from_epoch: params[2],
        reason: params[3],
        revoked_by: params[4],
      });
      return { rows: [] };
    }

    if (
      text.startsWith("SELECT MIN(invalidates_from_epoch) AS epoch FROM reputation_revocations")
    ) {
      const subj = params[0];
      const candidates = revocations.filter((r) => r.subject_address === subj);
      const min = candidates.length
        ? Math.min(...candidates.map((r) => r.invalidates_from_epoch))
        : null;
      return { rows: [{ epoch: min }] };
    }

    if (
      text.startsWith(
        "SELECT root FROM reputation_epochs WHERE subject_address = $1 AND epoch = $2"
      )
    ) {
      const [subj, epoch] = params;
      const row = epochs.find((e) => e.subject_address === subj && e.epoch === epoch);
      return { rows: row ? [{ root: row.root }] : [] };
    }

    if (
      text.startsWith(
        "SELECT epoch, root, leaf_count FROM reputation_epochs WHERE subject_address = $1 ORDER BY epoch DESC LIMIT 1"
      )
    ) {
      const subj = params[0];
      const rows = epochs
        .filter((e) => e.subject_address === subj)
        .sort((a, b) => b.epoch - a.epoch)
        .slice(0, 1)
        .map((e) => ({ epoch: e.epoch, root: e.root, leaf_count: e.leaf_count }));
      return { rows };
    }

    if (
      text.startsWith(
        "SELECT leaf_index, score_value, score_blinding, amount_value, amount_blinding,"
      ) &&
      text.includes("dispute_value, dispute_blinding, (revoked_at IS NOT NULL) AS revoked")
    ) {
      const subj = params[0];
      const rows = commitments
        .filter((c) => c.subject_address === subj)
        .sort((a, b) => a.leaf_index - b.leaf_index)
        .map((c) => ({
          leaf_index: c.leaf_index,
          score_value: c.score_value,
          score_blinding: c.score_blinding,
          amount_value: c.amount_value,
          amount_blinding: c.amount_blinding,
          dispute_value: c.dispute_value,
          dispute_blinding: c.dispute_blinding,
          revoked: c.revoked_at != null,
        }));
      return { rows };
    }

    if (
      text.startsWith(
        "SELECT leaf_index, score_value, score_blinding, amount_value, amount_blinding, dispute_value, dispute_blinding,"
      )
    ) {
      const [subj, start, end] = params;
      const rows = commitments
        .filter((c) => c.subject_address === subj && c.leaf_index >= start && c.leaf_index <= end)
        .sort((a, b) => a.leaf_index - b.leaf_index);
      return { rows };
    }

    throw new Error(`fakePool: unhandled query: ${text}`);
  }

  return {
    jobs,
    async connect() {
      return tx();
    },
    async query(sql, params) {
      return runQuery(sql, params);
    },
  };
}

jest.mock("../db/pool", () => {
  // Populated by each test via require("../db/pool").__setFake(fakePool)
  let current = null;
  const proxy = {
    __setFake(p) {
      current = p;
    },
    connect: (...args) => current.connect(...args),
    query: (...args) => current.query(...args),
  };
  return proxy;
});

const pool = require("../db/pool");
const reputationService = require("./reputationService");

describe("reputationService — DB-backed lifecycle", () => {
  let fake;
  const SUBJECT = "GFREELANCER_TEST_1234567890";

  beforeEach(() => {
    fake = createFakePool();
    fake.jobs.set("job-1", { budget: "500.0000000" });
    pool.__setFake(fake);
  });

  test("commitRating creates a leaf and appends epoch 1", async () => {
    const client = await pool.connect();
    const result = await reputationService.commitRating(client, {
      ratingId: "rating-1",
      jobId: "job-1",
      subjectAddress: SUBJECT,
      stars: 5,
      disputeFlag: false,
    });
    expect(result.leaf_index).toBe(0);
    const epoch = await reputationService.latestEpoch(SUBJECT);
    expect(epoch.epoch).toBe(1);
    expect(epoch.leafCount).toBe(1);
  });

  test("issuing 20 ratings then proving+verifying rating_threshold end to end", async () => {
    const client = await pool.connect();
    for (let i = 0; i < 20; i += 1) {
      fake.jobs.set(`job-${i}`, { budget: "500.0000000" });
      await reputationService.commitRating(client, {
        ratingId: `rating-${i}`,
        jobId: `job-${i}`,
        subjectAddress: SUBJECT,
        stars: 5,
        disputeFlag: false,
      });
    }
    const proof = await reputationService.buildProofForSubject({
      subjectAddress: SUBJECT,
      statementKind: "rating_threshold",
      statementParams: { thresholdScaled: 450 },
      count: 20,
      context: {
        audience: "GCLIENT",
        purpose: "job-application:job-99",
        nonce: "n1",
        expiresAt: Date.now() + 3600_000,
      },
    });
    const result = await reputationService.verifyProofOffChain(proof, {
      audience: "GCLIENT",
      purpose: "job-application:job-99",
    });
    expect(result.ok).toBe(true);
  });

  test("NEGATIVE: revoking a rating invalidates a proof bound to an epoch at or after its inclusion", async () => {
    const client = await pool.connect();
    const commitmentIds = [];
    for (let i = 0; i < 5; i += 1) {
      fake.jobs.set(`job-${i}`, { budget: "500.0000000" });
      const r = await reputationService.commitRating(client, {
        ratingId: `rating-${i}`,
        jobId: `job-${i}`,
        subjectAddress: SUBJECT,
        stars: 5,
        disputeFlag: false,
      });
      commitmentIds.push(r.id);
    }

    const proof = await reputationService.buildProofForSubject({
      subjectAddress: SUBJECT,
      statementKind: "rating_threshold",
      statementParams: { thresholdScaled: 450 },
      count: 5,
      context: { audience: "A", purpose: "P", nonce: "n", expiresAt: Date.now() + 3600_000 },
    });
    expect(
      (await reputationService.verifyProofOffChain(proof, { audience: "A", purpose: "P" })).ok
    ).toBe(true);

    // Revoke the very first rating in the tree — it was included at epoch 1,
    // which is <= this proof's epoch (5), so the proof must now fail.
    await reputationService.revokeRating({
      commitmentId: commitmentIds[0],
      reason: "Appeal upheld: rating was retaliatory",
      revokedBy: "GADMIN",
    });

    const afterRevocation = await reputationService.verifyProofOffChain(proof, {
      audience: "A",
      purpose: "P",
    });
    expect(afterRevocation).toEqual({ ok: false, reason: "revoked" });
  });

  test("a proof bound to an epoch entirely before a later revocation remains valid", async () => {
    const client = await pool.connect();
    fake.jobs.set("job-early", { budget: "500.0000000" });
    const early = await reputationService.commitRating(client, {
      ratingId: "rating-early",
      jobId: "job-early",
      subjectAddress: SUBJECT,
      stars: 5,
      disputeFlag: false,
    });
    void early;

    const proofBefore = await reputationService.buildProofForSubject({
      subjectAddress: SUBJECT,
      statementKind: "rating_threshold",
      statementParams: { thresholdScaled: 450 },
      count: 1,
      context: { audience: "A", purpose: "P", nonce: "n1", expiresAt: Date.now() + 3600_000 },
    });

    // Now issue and revoke a *later* rating — should not affect proofBefore.
    fake.jobs.set("job-later", { budget: "10.0000000" });
    const later = await reputationService.commitRating(client, {
      ratingId: "rating-later",
      jobId: "job-later",
      subjectAddress: SUBJECT,
      stars: 1,
      disputeFlag: false,
    });
    await reputationService.revokeRating({
      commitmentId: later.id,
      reason: "Appeal upheld",
      revokedBy: "GADMIN",
    });

    const result = await reputationService.verifyProofOffChain(proofBefore, {
      audience: "A",
      purpose: "P",
    });
    expect(result.ok).toBe(true);
  });

  test("NEGATIVE: verifyProofOffChain rejects a proof replayed against a mismatched purpose", async () => {
    const client = await pool.connect();
    for (let i = 0; i < 3; i += 1) {
      fake.jobs.set(`job-${i}`, { budget: "500.0000000" });
      await reputationService.commitRating(client, {
        ratingId: `rating-${i}`,
        jobId: `job-${i}`,
        subjectAddress: SUBJECT,
        stars: 5,
        disputeFlag: false,
      });
    }
    const proof = await reputationService.buildProofForSubject({
      subjectAddress: SUBJECT,
      statementKind: "rating_threshold",
      statementParams: { thresholdScaled: 450 },
      count: 3,
      context: {
        audience: "GCLIENT",
        purpose: "job-application:job-1",
        nonce: "n",
        expiresAt: Date.now() + 3600_000,
      },
    });
    const result = await reputationService.verifyProofOffChain(proof, {
      audience: "GCLIENT",
      purpose: "job-application:job-DIFFERENT",
    });
    expect(result).toEqual({ ok: false, reason: "purpose_mismatch" });
  });

  test("buildProofForSubject refuses when the most recent window is not contiguous non-revoked leaves", async () => {
    const client = await pool.connect();
    const ids = [];
    // 5 leaves so that revoking the middle one still leaves >= 3 non-revoked
    // leaves overall (the contiguity check, not the "not enough ratings"
    // check, is what this test targets).
    for (let i = 0; i < 5; i += 1) {
      fake.jobs.set(`job-${i}`, { budget: "500.0000000" });
      const r = await reputationService.commitRating(client, {
        ratingId: `rating-${i}`,
        jobId: `job-${i}`,
        subjectAddress: SUBJECT,
        stars: 5,
        disputeFlag: false,
      });
      ids.push(r.id);
    }
    await reputationService.revokeRating({
      commitmentId: ids[2], // revoke leaf index 2, inside the most recent 3
      reason: "Appeal upheld",
      revokedBy: "GADMIN",
    });

    await expect(
      reputationService.buildProofForSubject({
        subjectAddress: SUBJECT,
        statementKind: "rating_threshold",
        statementParams: { thresholdScaled: 450 },
        count: 3,
        context: { audience: "A", purpose: "P", nonce: "n", expiresAt: Date.now() + 3600_000 },
      })
    ).rejects.toThrow(/contiguous/);
  });
});
