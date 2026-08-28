/**
 * src/services/reputationService.js
 *
 * Zero-knowledge reputation service (Issue #319).
 *
 * Wires the crypto core in src/zk/ to Postgres: computes and stores Pedersen
 * commitments at rating-issuance time, maintains an append-only per-subject
 * Merkle root history ("epochs"), handles revocation, and offers both a
 * hosted proving path and an off-chain verification path.
 *
 * TRUST BOUNDARY (read this before wiring anything to this module): the
 * platform backend sees every rating's plaintext at issuance — same as
 * today's public `ratings` table. What changes is what *other users* see by
 * default. If `buildProofForSubject` below is used as a hosted proving
 * service, the platform additionally learns exactly which statement and
 * which leaf range a freelancer chose to prove and to whom — see the
 * "Proving paths" section of docs/ADR-010-zk-reputation.md. A freelancer who
 * does not want the platform to know even that can fetch their own openings
 * via GET /api/reputation/:publicKey/openings and run src/zk/*.js client-side
 * (the same modules; they have no server-only dependency beyond Node's
 * `crypto`, which any modern bundler polyfills with Web Crypto).
 */
"use strict";

const pool = require("../db/pool");
const bls = require("../zk/bls12381");
const ped = require("../zk/pedersen");
const merkle = require("../zk/merkle");
const reputationProof = require("../zk/reputationProof");
const statements = require("../zk/statements");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("reputation");

/** Ratings are 1..5 stars; stored ×100 to match statements.SCORE_SCALE. */
const SCORE_SCALE = statements.SCORE_SCALE;

/** XLM budget field is NUMERIC(20,7); convert to integer stroops for commitments. */
const STROOPS_PER_XLM = 10_000_000n;

function toStroops(xlmDecimalString) {
  // budget is stored as a fixed 7-decimal string; avoid floating point.
  const [whole, frac = ""] = String(xlmDecimalString).split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fracPadded || "0");
}

/**
 * Per-subject blinding derivation key.
 *
 * Held server-side today (the platform is the issuer and, optionally, the
 * prover), namespaced per subject so a leak of one subject's derivation
 * material says nothing about another's. This is exactly the seed a
 * freelancer would derive locally (e.g. by signing a fixed domain string with
 * their Stellar key) if they choose the client-side proving path instead —
 * the two are interchangeable inputs to the same deriveBlinding() function.
 */
function serverSeedFor(subjectAddress) {
  // HMAC-derived from a fixed server key + subject; never transmitted.
  const key = process.env.REPUTATION_COMMITMENT_KEY || process.env.JWT_SECRET;
  if (!key)
    throw new Error("reputationService: REPUTATION_COMMITMENT_KEY (or JWT_SECRET) required");
  return ped.deriveBlinding(key, `subject-seed:${subjectAddress}`).toString(16);
}

/**
 * Commit and append a leaf for a newly-issued rating.
 *
 * Called from ratingService.createRating() in the same DB transaction as the
 * rating insert, so a rating and its commitment are created atomically — a
 * rating can never exist without a corresponding committed, Merkle-anchored
 * leaf, which is what the "cannot be retroactively altered" guarantee in
 * ADR-010 depends on.
 */
async function commitRating(client, { ratingId, jobId, subjectAddress, stars, disputeFlag }) {
  const { rows: jobRows } = await client.query("SELECT budget FROM jobs WHERE id = $1", [jobId]);
  if (!jobRows.length) throw new Error(`reputationService: job ${jobId} not found`);
  const amountValue = toStroops(jobRows[0].budget);
  const scoreValue = BigInt(stars) * BigInt(SCORE_SCALE);
  const disputeValue = disputeFlag ? 1n : 0n;

  const { rows: countRows } = await client.query(
    "SELECT COALESCE(MAX(leaf_index), -1) + 1 AS next_index FROM reputation_commitments WHERE subject_address = $1",
    [subjectAddress]
  );
  const leafIndex = countRows[0].next_index;

  const seed = serverSeedFor(subjectAddress);
  const blindings = {
    score: ped.deriveBlinding(seed, `score:${leafIndex}`),
    amount: ped.deriveBlinding(seed, `amount:${leafIndex}`),
    dispute: ped.deriveBlinding(seed, `dispute:${leafIndex}`),
  };
  const commitments = {
    score: ped.commit(scoreValue, blindings.score),
    amount: ped.commit(amountValue, blindings.amount),
    dispute: ped.commit(disputeValue, blindings.dispute),
  };

  const { rows } = await client.query(
    `INSERT INTO reputation_commitments
       (rating_id, subject_address, leaf_index,
        score_commitment, amount_commitment, dispute_commitment,
        score_value, score_blinding, amount_value, amount_blinding,
        dispute_value, dispute_blinding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, leaf_index`,
    [
      ratingId,
      subjectAddress,
      leafIndex,
      bls.serialize(commitments.score),
      bls.serialize(commitments.amount),
      bls.serialize(commitments.dispute),
      scoreValue.toString(),
      bls.frToBytes(blindings.score),
      amountValue.toString(),
      bls.frToBytes(blindings.amount),
      Number(disputeValue),
      bls.frToBytes(blindings.dispute),
    ]
  );

  await appendEpoch(client, subjectAddress, "issued");
  return rows[0];
}

/** Load every non-revoked... and revoked leaf, in index order, for tree reconstruction. */
async function loadAllLeaves(client, subjectAddress) {
  const { rows } = await client.query(
    `SELECT leaf_index, score_commitment, amount_commitment, dispute_commitment,
            (revoked_at IS NOT NULL) AS revoked
     FROM reputation_commitments
     WHERE subject_address = $1
     ORDER BY leaf_index ASC`,
    [subjectAddress]
  );
  return rows;
}

function encodeAllLeaves(subjectAddress, rows) {
  return rows.map((row) =>
    merkle.encodeLeaf({
      index: row.leaf_index,
      revoked: row.revoked,
      subject: subjectAddress,
      commitments: {
        score: row.score_commitment,
        amount: row.amount_commitment,
        dispute: row.dispute_commitment,
      },
    })
  );
}

/** Recompute the root over a subject's full leaf set and append a new epoch row. */
async function appendEpoch(client, subjectAddress, reason) {
  const rows = await loadAllLeaves(client, subjectAddress);
  const encoded = encodeAllLeaves(subjectAddress, rows);
  const root = merkle.computeRoot(encoded);

  const { rows: epochRows } = await client.query(
    "SELECT COALESCE(MAX(epoch), 0) + 1 AS next_epoch FROM reputation_epochs WHERE subject_address = $1",
    [subjectAddress]
  );
  const epoch = epochRows[0].next_epoch;

  await client.query(
    `INSERT INTO reputation_epochs (subject_address, epoch, root, leaf_count, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [subjectAddress, epoch, root, rows.length, reason]
  );
  return { epoch, root: root.toString("hex"), leafCount: rows.length };
}

/**
 * Revoke a rating (an appeal was upheld). Invalidates every proof bound to
 * an epoch >= the epoch that first included this rating — see
 * reputation_revocations.invalidates_from_epoch and isEpochValid() below.
 */
async function revokeRating({ commitmentId, reason, revokedBy }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, subject_address, leaf_index, revoked_at
       FROM reputation_commitments WHERE id = $1 FOR UPDATE`,
      [commitmentId]
    );
    if (!rows.length) {
      const e = new Error("Reputation commitment not found");
      e.status = 404;
      throw e;
    }
    const commitment = rows[0];
    if (commitment.revoked_at) {
      const e = new Error("Rating already revoked");
      e.status = 409;
      throw e;
    }

    // The epoch this rating first appeared in: the earliest 'issued' epoch
    // whose leaf_count already covered this leaf_index.
    const { rows: firstEpochRows } = await client.query(
      `SELECT MIN(epoch) AS epoch FROM reputation_epochs
       WHERE subject_address = $1 AND leaf_count > $2`,
      [commitment.subject_address, commitment.leaf_index]
    );
    const invalidatesFromEpoch = firstEpochRows[0].epoch;

    await client.query(
      `UPDATE reputation_commitments
       SET revoked_at = NOW(), revoked_reason = $2, revoked_by = $3
       WHERE id = $1`,
      [commitmentId, reason, revokedBy]
    );

    await client.query(
      `INSERT INTO reputation_revocations
         (subject_address, reputation_commitment_id, invalidates_from_epoch, reason, revoked_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [commitment.subject_address, commitmentId, invalidatesFromEpoch, reason, revokedBy]
    );

    const newEpoch = await appendEpoch(client, commitment.subject_address, "revoked");

    await client.query("COMMIT");
    logger.info(
      {
        subject: commitment.subject_address,
        commitmentId,
        invalidatesFromEpoch,
        newEpoch: newEpoch.epoch,
      },
      "Reputation rating revoked"
    );
    return { invalidatesFromEpoch, newEpoch };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** The lowest epoch that is no longer valid for this subject, or null if none revoked. */
async function earliestInvalidatedEpoch(subjectAddress) {
  const { rows } = await pool.query(
    "SELECT MIN(invalidates_from_epoch) AS epoch FROM reputation_revocations WHERE subject_address = $1",
    [subjectAddress]
  );
  return rows[0].epoch;
}

/**
 * Resolve `(subject, epoch) -> { root, valid }` against the database — the
 * off-chain counterpart of the Soroban contract's identical rule. Passed as
 * `resolveEpoch` to reputationProof.verifyProof().
 */
async function resolveEpoch(subjectAddress, epoch) {
  const { rows } = await pool.query(
    "SELECT root FROM reputation_epochs WHERE subject_address = $1 AND epoch = $2",
    [subjectAddress, epoch]
  );
  if (!rows.length) return null;
  const invalidFrom = await earliestInvalidatedEpoch(subjectAddress);
  const valid = invalidFrom == null || epoch < invalidFrom;
  return { root: rows[0].root.toString("hex"), valid };
}

async function latestEpoch(subjectAddress) {
  const { rows } = await pool.query(
    "SELECT epoch, root, leaf_count FROM reputation_epochs WHERE subject_address = $1 ORDER BY epoch DESC LIMIT 1",
    [subjectAddress]
  );
  if (!rows.length) return null;
  return {
    epoch: rows[0].epoch,
    root: rows[0].root.toString("hex"),
    leafCount: rows[0].leaf_count,
  };
}

/**
 * Return the authenticated subject's own openings — what a client-side
 * prover needs. Never call this for anyone but the authenticated subject
 * (enforced in the route layer); this is the entire content that a
 * non-hosted proving path exists to keep away from the server otherwise.
 */
async function getOwnOpenings(subjectAddress) {
  const { rows } = await pool.query(
    `SELECT leaf_index, score_value, score_blinding, amount_value, amount_blinding,
            dispute_value, dispute_blinding, (revoked_at IS NOT NULL) AS revoked
     FROM reputation_commitments
     WHERE subject_address = $1
     ORDER BY leaf_index ASC`,
    [subjectAddress]
  );
  return rows.map((r) => ({
    index: r.leaf_index,
    revoked: r.revoked,
    values: { score: r.score_value, amount: r.amount_value, dispute: r.dispute_value },
    blindings: {
      score: bls.bytesToFr(r.score_blinding).toString(16),
      amount: bls.bytesToFr(r.amount_blinding).toString(16),
      dispute: bls.bytesToFr(r.dispute_blinding).toString(16),
    },
  }));
}

/**
 * Hosted proving service: build a full reputation proof for `subjectAddress`
 * over their most recent `count` non-revoked ratings, at the current epoch.
 *
 * Learns: the subject's full plaintext rating history for the chosen range
 * (same as the platform already has), which statement was proved, its
 * public parameters, and the context (audience/purpose) it was proved for.
 * See the module doc comment above.
 */
async function buildProofForSubject({
  subjectAddress,
  statementKind,
  statementParams,
  count,
  context,
}) {
  const epochInfo = await latestEpoch(subjectAddress);
  if (!epochInfo) {
    const e = new Error("No reputation history for this subject yet");
    e.status = 404;
    throw e;
  }

  const allRows = await loadAllLeaves(pool, subjectAddress);
  const encoded = encodeAllLeaves(subjectAddress, allRows);
  const nonRevoked = allRows.filter((r) => !r.revoked);
  if (nonRevoked.length < count) {
    const e = new Error(`Subject has only ${nonRevoked.length} non-revoked ratings, need ${count}`);
    e.status = 422;
    throw e;
  }
  const range = nonRevoked.slice(-count); // most recent `count` non-revoked leaves
  const startIndex = range[0].leaf_index;
  const endIndex = range[range.length - 1].leaf_index;
  if (endIndex - startIndex + 1 !== count) {
    const e = new Error(
      "Requested statement requires a contiguous leaf range; a revoked rating sits inside the most recent window — request a smaller count or wait for the freelancer's next non-revoked rating"
    );
    e.status = 422;
    throw e;
  }

  const seed = serverSeedFor(subjectAddress);
  const openLeaves = await pool.query(
    `SELECT leaf_index, score_value, score_blinding, amount_value, amount_blinding, dispute_value, dispute_blinding,
            score_commitment, amount_commitment, dispute_commitment
     FROM reputation_commitments
     WHERE subject_address = $1 AND leaf_index BETWEEN $2 AND $3
     ORDER BY leaf_index ASC`,
    [subjectAddress, startIndex, endIndex]
  );
  void seed; // openings are read directly from storage below; seed kept for parity with client-side derivation docs

  const leaves = openLeaves.rows.map((r) => ({
    index: r.leaf_index,
    values: {
      score: BigInt(r.score_value),
      amount: BigInt(r.amount_value),
      dispute: BigInt(r.dispute_value),
    },
    blindings: {
      score: bls.bytesToFr(r.score_blinding),
      amount: bls.bytesToFr(r.amount_blinding),
      dispute: bls.bytesToFr(r.dispute_blinding),
    },
    commitments: {
      score: bls.deserialize(r.score_commitment),
      amount: bls.deserialize(r.amount_commitment),
      dispute: bls.deserialize(r.dispute_commitment),
    },
  }));

  const proof = reputationProof.buildProof({
    subject: subjectAddress,
    statementKind,
    statementParams,
    epoch: epochInfo.epoch,
    root: epochInfo.root,
    startIndex,
    endIndex,
    context,
    leaves,
    allEncodedLeaves: encoded,
  });

  return proof;
}

/** Off-chain verification path: verify any proof against this database's epoch history. */
async function verifyProofOffChain(proof, { audience, purpose } = {}) {
  return reputationProof.verifyProof(proof, {
    resolveEpoch,
    audience,
    purpose,
    now: Date.now(),
  });
}

module.exports = {
  SCORE_SCALE,
  toStroops,
  commitRating,
  revokeRating,
  resolveEpoch,
  earliestInvalidatedEpoch,
  latestEpoch,
  getOwnOpenings,
  buildProofForSubject,
  verifyProofOffChain,
};
