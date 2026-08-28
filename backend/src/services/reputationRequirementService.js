/**
 * src/services/reputationRequirementService.js
 *
 * Job-side of ZK reputation (Issue #319): lets a client attach a verifiable
 * requirement to a job posting, and records a freelancer's attached proof
 * per application after independently verifying it — the client never has
 * to run the verification itself, and never sees anything the proof did not
 * already reveal (the statement kind and its public parameters, never a
 * rating).
 */
"use strict";

const pool = require("../db/pool");
const reputationService = require("./reputationService");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("reputation-requirements");

const STATEMENT_KINDS = ["rating_threshold", "completion_count", "earnings_band", "dispute_free"];

async function setJobRequirements(jobId, requirements) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM job_reputation_requirements WHERE job_id = $1", [jobId]);
    for (const req of requirements) {
      if (!STATEMENT_KINDS.includes(req.statementKind)) {
        throw Object.assign(new Error(`Invalid statementKind: ${req.statementKind}`), {
          status: 400,
        });
      }
      await client.query(
        `INSERT INTO job_reputation_requirements (job_id, statement_kind, statement_params, required)
         VALUES ($1, $2, $3, $4)`,
        [
          jobId,
          req.statementKind,
          JSON.stringify(req.statementParams || {}),
          req.required !== false,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getJobRequirements(jobId) {
  const { rows } = await pool.query(
    `SELECT id, statement_kind, statement_params, required, created_at
     FROM job_reputation_requirements WHERE job_id = $1 ORDER BY created_at ASC`,
    [jobId]
  );
  return rows.map((r) => ({
    id: r.id,
    statementKind: r.statement_kind,
    statementParams: r.statement_params,
    required: r.required,
    createdAt: r.created_at,
  }));
}

/**
 * Verify and store a freelancer's proof against one of their own
 * applications. The proof's context.audience must equal the job's client
 * address and context.purpose must equal `job-application:${jobId}` — this
 * is enforced here, not left to the caller, so a proof cannot be lifted from
 * one job and replayed against another even if a client tried to accept it.
 */
async function attachApplicationProof({ applicationId, freelancerAddress, proof }) {
  const { rows: appRows } = await pool.query(
    `SELECT a.id, a.job_id, a.freelancer_address, j.client_address
     FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.id = $1`,
    [applicationId]
  );
  if (!appRows.length) {
    throw Object.assign(new Error("Application not found"), { status: 404 });
  }
  const application = appRows[0];
  if (application.freelancer_address !== freelancerAddress) {
    throw Object.assign(new Error("Forbidden: not your application"), { status: 403 });
  }
  if (proof?.subject !== freelancerAddress) {
    throw Object.assign(new Error("Proof subject does not match caller"), { status: 400 });
  }

  const expectedPurpose = `job-application:${application.job_id}`;
  const result = await reputationService.verifyProofOffChain(proof, {
    audience: application.client_address,
    purpose: expectedPurpose,
  });

  const { rows } = await pool.query(
    `INSERT INTO application_reputation_proofs
       (application_id, freelancer_address, statement_kind, public_params, epoch, root, proof, verified, verified_at, verification_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $8 THEN NOW() ELSE NULL END, $9)
     ON CONFLICT (application_id, statement_kind) DO UPDATE SET
       public_params = EXCLUDED.public_params,
       epoch = EXCLUDED.epoch,
       root = EXCLUDED.root,
       proof = EXCLUDED.proof,
       verified = EXCLUDED.verified,
       verified_at = EXCLUDED.verified_at,
       verification_reason = EXCLUDED.verification_reason
     RETURNING id, statement_kind, public_params, verified, verified_at, verification_reason`,
    [
      applicationId,
      freelancerAddress,
      proof.statementKind,
      JSON.stringify(proof.publicParams || {}),
      proof.epoch,
      Buffer.from(proof.root, "hex"),
      JSON.stringify(proof),
      result.ok,
      result.ok ? null : result.reason,
    ]
  );

  logger.info(
    {
      applicationId,
      statementKind: proof.statementKind,
      verified: result.ok,
      reason: result.reason,
    },
    "Application reputation proof recorded"
  );

  return rows[0];
}

async function getApplicationProofs(applicationIds) {
  if (!applicationIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT application_id, statement_kind, public_params, verified, verified_at
     FROM application_reputation_proofs
     WHERE application_id = ANY($1::uuid[])`,
    [applicationIds]
  );
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.application_id) || [];
    list.push({
      statementKind: row.statement_kind,
      publicParams: row.public_params,
      verified: row.verified,
      verifiedAt: row.verified_at,
    });
    map.set(row.application_id, list);
  }
  return map;
}

module.exports = {
  STATEMENT_KINDS,
  setJobRequirements,
  getJobRequirements,
  attachApplicationProof,
  getApplicationProofs,
};
