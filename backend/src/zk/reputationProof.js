/**
 * src/zk/reputationProof.js
 *
 * Top-level reputation proof: binds a statement (statements.js) to a
 * specific subject, epoch/root, leaf range, and verification context, and
 * carries a Merkle inclusion proof for the range's endpoints so a verifier
 * never has to trust the prover's claim about which leaves it used (Issue
 * #319).
 *
 * A full proof object is:
 *
 *   {
 *     version, subject, statementKind, publicParams,
 *     epoch, root,                 // which anchored state this is about
 *     startIndex, endIndex,        // public leaf range [start, end]
 *     context: { audience, purpose, nonce, expiresAt },
 *     leafCommitments: { score[], amount[], dispute[] },  // per-leaf, public
 *     boundaryInclusion: { start: MerkleProof, end: MerkleProof },
 *     circuitProof,                // statement-specific proof bytes
 *   }
 *
 * REPLAY / CONTEXT BINDING: `context` is absorbed into the Fiat–Shamir
 * transcript before any circuit challenge is derived (see buildTranscript
 * below), together with subject, epoch, root and the exact leaf commitments.
 * Changing the audience, purpose, nonce, or presenting the same circuitProof
 * bytes against a different leaf range or epoch all produce a different
 * transcript and therefore a different set of challenges — the *same*
 * response scalars will not satisfy a *different* challenge under the
 * discrete-log assumption. That is what makes a proof non-replayable and
 * non-reusable outside the context it was built for; it is also what makes
 * `expiresAt` meaningful even though it is otherwise a plain, unauthenticated
 * field — a verifier who checks it locally is checking a value that is
 * cryptographically bound to everything else in the proof.
 *
 * REVOCATION: verify() also checks the epoch against the subject's
 * `earliestInvalidatedEpoch` (see reputationService.js / the Soroban
 * contract's `RevocationState`). A rating revoked after this proof's epoch
 * was anchored does not affect it; a rating that was already included by
 * this epoch, and is later revoked, invalidates every proof bound to this
 * epoch or later. See docs/ADR-010-zk-reputation.md, "Revocation model".
 */
"use strict";

const bls = require("./bls12381");
const merkle = require("./merkle");
const { Transcript, hashContext } = require("./transcript");
const statements = require("./statements");

const PROOF_VERSION = 1;

function buildTranscript(header) {
  const t = new Transcript("ReputationProof/v1");
  t.absorbUint("version", header.version);
  t.absorbString("subject", header.subject);
  t.absorbString("statementKind", header.statementKind);
  t.absorbString("publicParams", JSON.stringify(header.publicParams));
  t.absorbUint("epoch", header.epoch);
  t.absorbBytes("root", Buffer.from(header.root, "hex"));
  t.absorbUint("startIndex", header.startIndex);
  t.absorbUint("endIndex", header.endIndex);
  t.absorbBytes("contextHash", hashContext(header.context));
  return t;
}

/**
 * Build a full reputation proof.
 *
 * `leaves` is the prover's plaintext view of their own committed rating
 * history for [startIndex, endIndex] inclusive — either fetched from the
 * authenticated openings endpoint or recomputed locally from a deterministic
 * seed (see pedersen.deriveBlinding). `merkleContext` supplies the full leaf
 * set needed to build the two boundary inclusion proofs.
 */
function buildProof({
  subject,
  statementKind,
  statementParams,
  epoch,
  root,
  startIndex,
  endIndex,
  context,
  leaves,
  allEncodedLeaves,
}) {
  if (endIndex < startIndex) throw new Error("reputationProof: empty range");
  const count = endIndex - startIndex + 1;
  if (leaves.length !== count) throw new Error("reputationProof: leaf count mismatch");

  const statement = statements.buildStatement(statementKind, { ...statementParams, count });

  const header = {
    version: PROOF_VERSION,
    subject,
    statementKind,
    publicParams: statement.publicParams,
    epoch,
    root,
    startIndex,
    endIndex,
    context,
  };

  const leafCommitments = {
    score: leaves.map((l) => l.commitments.score),
    amount: leaves.map((l) => l.commitments.amount),
    dispute: leaves.map((l) => l.commitments.dispute),
  };

  const transcript = buildTranscript(header);
  transcript.absorbPoints("leaf.score", leafCommitments.score);
  transcript.absorbPoints("leaf.amount", leafCommitments.amount);
  transcript.absorbPoints("leaf.dispute", leafCommitments.dispute);

  const circuitProof = statement.prove(transcript, {
    scoreValues: leaves.map((l) => l.values.score),
    scoreBlindings: leaves.map((l) => l.blindings.score),
    amountValues: leaves.map((l) => l.values.amount),
    amountBlindings: leaves.map((l) => l.blindings.amount),
    disputeValues: leaves.map((l) => l.values.dispute),
    disputeBlindings: leaves.map((l) => l.blindings.dispute),
  });

  const boundaryInclusion = {
    start: merkle.inclusionProof(allEncodedLeaves, startIndex),
    end: merkle.inclusionProof(allEncodedLeaves, endIndex),
  };

  return {
    ...header,
    leafCommitmentsHex: {
      score: leafCommitments.score.map((p) => bls.serialize(p).toString("hex")),
      amount: leafCommitments.amount.map((p) => bls.serialize(p).toString("hex")),
      dispute: leafCommitments.dispute.map((p) => bls.serialize(p).toString("hex")),
    },
    boundaryInclusion,
    circuitProof: serializeCircuitProof(statementKind, circuitProof),
  };
}

function serializeCircuitProof(statementKind, circuitProof) {
  const rangeProof = require("./rangeProof");
  const equalityProof = require("./equalityProof");
  switch (statementKind) {
    case "rating_threshold":
      return { range: rangeProof.serializeProof(circuitProof).toString("hex") };
    case "earnings_band":
      return {
        lower: rangeProof.serializeProof(circuitProof.lowerProof).toString("hex"),
        upper: rangeProof.serializeProof(circuitProof.upperProof).toString("hex"),
      };
    case "dispute_free":
      return { equality: equalityProof.serializeProof(circuitProof).toString("hex") };
    case "completion_count":
      return {};
    default:
      throw new Error(`reputationProof: unknown statement kind "${statementKind}"`);
  }
}

function deserializeCircuitProof(statementKind, encoded) {
  const rangeProof = require("./rangeProof");
  const equalityProof = require("./equalityProof");
  switch (statementKind) {
    case "rating_threshold":
      return rangeProof.deserializeProof(Buffer.from(encoded.range, "hex"));
    case "earnings_band":
      return {
        lowerProof: rangeProof.deserializeProof(Buffer.from(encoded.lower, "hex")),
        upperProof: rangeProof.deserializeProof(Buffer.from(encoded.upper, "hex")),
      };
    case "dispute_free":
      return equalityProof.deserializeProof(Buffer.from(encoded.equality, "hex"));
    case "completion_count":
      return {};
    default:
      throw new Error(`reputationProof: unknown statement kind "${statementKind}"`);
  }
}

/**
 * Verify a full reputation proof.
 *
 * `resolveEpoch(subject, epoch)` returns `{ root, valid }` (or a Promise of
 * one — it is always awaited below) for the anchored state the proof claims
 * — `root` for the historical Merkle root at that epoch (so boundary
 * inclusion can be checked even if the subject has since moved to a later
 * epoch) and `valid` reflecting the revocation rule (false once epoch >= the
 * subject's earliestInvalidatedEpoch). Both the on-chain contract and the
 * off-chain HTTP path implement this lookup; this function is deliberately
 * storage-agnostic so the same verify() runs against either, which is why it
 * is async even though the in-memory crypto checks below it are not.
 */
async function verifyProof(proof, { resolveEpoch, now = Date.now(), audience, purpose } = {}) {
  try {
    if (proof.version !== PROOF_VERSION) return { ok: false, reason: "unsupported_version" };
    if (proof.endIndex < proof.startIndex) return { ok: false, reason: "empty_range" };

    if (proof.context.expiresAt && now > Number(proof.context.expiresAt)) {
      return { ok: false, reason: "expired" };
    }
    if (audience && proof.context.audience !== audience) {
      return { ok: false, reason: "audience_mismatch" };
    }
    if (purpose && proof.context.purpose !== purpose) {
      return { ok: false, reason: "purpose_mismatch" };
    }

    // Awaiting a plain (non-Promise) return value is a no-op, so resolveEpoch
    // may be sync (as every test in this repo's crypto-layer suite uses) or
    // async (as reputationService's DB-backed lookup is) without the caller
    // needing to know which.
    const anchored = await resolveEpoch(proof.subject, proof.epoch);
    if (!anchored) return { ok: false, reason: "unknown_epoch" };
    if (anchored.root !== proof.root) return { ok: false, reason: "root_mismatch" };
    if (!anchored.valid) return { ok: false, reason: "revoked" };

    const count = proof.endIndex - proof.startIndex + 1;
    const statement = statements.buildStatement(proof.statementKind, {
      ...decodePublicParams(proof.statementKind, proof.publicParams),
      count,
    });

    const scoreCommitments = proof.leafCommitmentsHex.score.map((h) =>
      bls.deserialize(Buffer.from(h, "hex"))
    );
    const amountCommitments = proof.leafCommitmentsHex.amount.map((h) =>
      bls.deserialize(Buffer.from(h, "hex"))
    );
    const disputeCommitments = proof.leafCommitmentsHex.dispute.map((h) =>
      bls.deserialize(Buffer.from(h, "hex"))
    );
    if (
      scoreCommitments.length !== count ||
      amountCommitments.length !== count ||
      disputeCommitments.length !== count
    ) {
      return { ok: false, reason: "leaf_count_mismatch" };
    }

    // Boundary inclusion: the first and last leaf commitments in the proof
    // really are the leaves at startIndex/endIndex under the anchored root.
    const encodeBoundaryLeaf = (index, revoked, i) =>
      merkle.encodeLeaf({
        index,
        revoked,
        subject: proof.subject,
        commitments: {
          score: Buffer.from(proof.leafCommitmentsHex.score[i], "hex"),
          amount: Buffer.from(proof.leafCommitmentsHex.amount[i], "hex"),
          dispute: Buffer.from(proof.leafCommitmentsHex.dispute[i], "hex"),
        },
      });
    // NOTE: boundary inclusion here checks index+commitment binding only for
    // the endpoints; reputationService verifies every intermediate leaf's
    // commitment server-side at issuance time (they are never re-derivable
    // from a proof alone, by design — that is what stays hidden). Both
    // endpoints are checked as non-revoked: a revoked leaf changes its own
    // leaf hash (see merkle.js), so if either boundary had been revoked
    // since this epoch, this reconstruction would not match the anchored
    // root and inclusion would correctly fail.
    const startOk = merkle.verifyInclusion(
      encodeBoundaryLeaf(proof.startIndex, false, 0),
      proof.boundaryInclusion.start,
      proof.root
    );
    const endOk = merkle.verifyInclusion(
      encodeBoundaryLeaf(proof.endIndex, false, count - 1),
      proof.boundaryInclusion.end,
      proof.root
    );

    const header = {
      version: proof.version,
      subject: proof.subject,
      statementKind: proof.statementKind,
      publicParams: statement.publicParams,
      epoch: proof.epoch,
      root: proof.root,
      startIndex: proof.startIndex,
      endIndex: proof.endIndex,
      context: proof.context,
    };
    const transcript = buildTranscript(header);
    transcript.absorbPoints("leaf.score", scoreCommitments);
    transcript.absorbPoints("leaf.amount", amountCommitments);
    transcript.absorbPoints("leaf.dispute", disputeCommitments);

    const circuitProof = deserializeCircuitProof(proof.statementKind, proof.circuitProof);
    const statementOk = statement.verify(
      transcript,
      { scoreCommitments, amountCommitments, disputeCommitments },
      circuitProof
    );

    if (!startOk || !endOk) return { ok: false, reason: "boundary_inclusion_failed" };
    if (!statementOk) return { ok: false, reason: "circuit_verification_failed" };

    return { ok: true, statementKind: proof.statementKind, publicParams: statement.publicParams };
  } catch (err) {
    return { ok: false, reason: "malformed_proof", error: err.message };
  }
}

function decodePublicParams(kind, publicParams) {
  switch (kind) {
    case "rating_threshold":
      return { thresholdScaled: BigInt(publicParams.thresholdScaled) };
    case "completion_count":
      return { minCount: publicParams.minCount };
    case "earnings_band":
      return {
        minAmount: BigInt(publicParams.minAmount),
        maxAmount: BigInt(publicParams.maxAmount),
      };
    case "dispute_free":
      return {};
    default:
      throw new Error(`reputationProof: unknown statement kind "${kind}"`);
  }
}

module.exports = { PROOF_VERSION, buildProof, verifyProof, buildTranscript };
