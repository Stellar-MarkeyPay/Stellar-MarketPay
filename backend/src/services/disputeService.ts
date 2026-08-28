import type {
  Database,
  ProfileTable,
  JobTable,
  ApplicationTable,
  JobViewTable,
  PrivateMessageTable,
  EscrowTable,
  ProgressUpdateTable,
  RatingTable,
  MessageTable,
  ReferralTable,
  ReferralPayoutTable,
  ScopeSessionTable,
  WebauthnCredentialTable,
  DisputeEvidenceTable,
  TimeEntryTable,
  TimeInvoiceTable,
  JobInvitationTable,
} from "../db/types";
import { db, rawQuery } from "../db/kysely";
("use strict");

const pool = require("../db/pool");
const ipfsService = require("./ipfsService");

const MAX_EVIDENCE_FILES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const IPFS_CID_PATTERN = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{55})$/;

function validateIpfsCid(cid: any) {
  if (typeof cid !== "string" || !IPFS_CID_PATTERN.test(cid)) {
    const e = new Error("Invalid IPFS CID returned from upload service");
    e.status = 422;
    throw e;
  }

  return cid;
}

async function createDispute(jobId: any, raisedBy: any) {
  if (!jobId || !raisedBy) {
    const e = new Error("Job ID and raisedBy are required");
    e.status = 400;
    throw e;
  }

  const { rows: jobRows } = await rawQuery<JobTable>(
    "SELECT client_address, freelancer_address FROM jobs WHERE id = $1",
    [jobId]
  );

  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const job = jobRows[0];
  if (job.client_address !== raisedBy && job.freelancer_address !== raisedBy) {
    const e = new Error("Only the job client or freelancer can raise a dispute");
    e.status = 403;
    throw e;
  }

  const { rows: existing } = await rawQuery<any>("SELECT id FROM disputes WHERE job_id = $1", [
    jobId,
  ]);
  if (existing.length > 0) {
    const e = new Error("A dispute already exists for this job");
    e.status = 400;
    throw e;
  }

  const { rows } = await rawQuery<any>(
    `INSERT INTO disputes (job_id, raised_by, status, created_at)
     VALUES ($1, $2, 'open', NOW())
     RETURNING *`,
    [jobId, raisedBy]
  );

  return { success: true, dispute: rows[0] };
}

async function uploadEvidence(
  jobId: any,
  uploaderAddress: any,
  fileBuffer: any,
  fileName: any,
  mimeType: any
) {
  if (!jobId || !uploaderAddress) {
    const e = new Error("Job ID and uploader address are required");
    e.status = 400;
    throw e;
  }

  const { rows: jobRows } = await rawQuery<JobTable>(
    "SELECT client_address, freelancer_address, status FROM jobs WHERE id = $1",
    [jobId]
  );

  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const job = jobRows[0];
  if (job.client_address !== uploaderAddress && job.freelancer_address !== uploaderAddress) {
    const e = new Error("Only the client or freelancer can upload evidence");
    e.status = 403;
    throw e;
  }

  const { rows: disputeRows } = await rawQuery<any>(
    "SELECT id, status FROM disputes WHERE job_id = $1",
    [jobId]
  );

  if (!disputeRows.length) {
    const e = new Error("No dispute exists for this job. Create a dispute first.");
    e.status = 400;
    throw e;
  }

  if (disputeRows[0].status !== "open") {
    const e = new Error("Cannot upload evidence after dispute has been resolved");
    e.status = 400;
    throw e;
  }

  const { rows: countRows } = await rawQuery<DisputeEvidenceTable>(
    "SELECT COUNT(*) FROM dispute_evidence WHERE job_id = $1 AND uploader_address = $2",
    [jobId, uploaderAddress]
  );

  if (parseInt(countRows[0].count, 10) >= MAX_EVIDENCE_FILES) {
    const e = new Error(`Maximum ${MAX_EVIDENCE_FILES} files allowed per party`);
    e.status = 400;
    throw e;
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    const e = new Error("File size exceeds 5MB limit");
    e.status = 400;
    throw e;
  }

  const ipfsResult = await ipfsService.uploadFile(fileBuffer, fileName, mimeType);
  const ipfsCid = validateIpfsCid(ipfsResult?.cid);

  const { rows } = await rawQuery<DisputeEvidenceTable>(
    `INSERT INTO dispute_evidence
       (job_id, uploader_address, file_name, file_size, mime_type, ipfs_cid)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [jobId, uploaderAddress, fileName, fileBuffer.length, mimeType, ipfsCid]
  );

  const ev = rows[0];
  return {
    success: true,
    data: {
      id: ev.id,
      uploaderAddress: ev.uploader_address,
      fileName: ev.file_name,
      fileSize: ev.file_size,
      mimeType: ev.mime_type,
      ipfsCid: ev.ipfs_cid,
      gatewayUrl: ipfsService.getGatewayUrl(ev.ipfs_cid),
      createdAt: ev.created_at,
    },
  };
}

async function resolveDispute(jobId: any, resolvedBy: any, resolution: any) {
  if (!jobId || !resolvedBy || !resolution) {
    const e = new Error("Job ID, resolver, and resolution are required");
    e.status = 400;
    throw e;
  }

  if (!["release_funds", "refund_client"].includes(resolution)) {
    const e = new Error("Resolution must be 'release_funds' or 'refund_client'");
    e.status = 400;
    throw e;
  }

  const { rows: adminRows } = await rawQuery<any>("SELECT id FROM admin_profiles WHERE id = $1", [
    resolvedBy,
  ]);
  if (!adminRows.length) {
    const e = new Error("Only an admin can resolve disputes");
    e.status = 403;
    throw e;
  }

  const { rows: disputeRows } = await rawQuery<any>(
    "SELECT id, status FROM disputes WHERE job_id = $1",
    [jobId]
  );

  if (!disputeRows.length) {
    const e = new Error("No dispute found for this job");
    e.status = 404;
    throw e;
  }

  if (disputeRows[0].status !== "open") {
    const e = new Error("Dispute has already been resolved");
    e.status = 400;
    throw e;
  }

  const { rows } = await rawQuery<any>(
    `UPDATE disputes
     SET status = 'resolved', resolved_by = $2, resolution = $3, resolved_at = NOW()
     WHERE job_id = $1
     RETURNING *`,
    [jobId, resolvedBy, resolution]
  );

  if (resolution === "release_funds") {
    await rawQuery<EscrowTable>("UPDATE escrows SET status = 'released' WHERE job_id = $1", [
      jobId,
    ]);
  } else {
    await rawQuery<EscrowTable>("UPDATE escrows SET status = 'refunded' WHERE job_id = $1", [
      jobId,
    ]);
  }

  return { success: true, dispute: rows[0] };
}

async function getDispute(jobId: any) {
  if (!jobId) {
    const e = new Error("Job ID is required");
    e.status = 400;
    throw e;
  }

  const { rows: jobRows } = await rawQuery<JobTable>(
    `SELECT id, title, status, client_address, freelancer_address, created_at
     FROM jobs WHERE id = $1`,
    [jobId]
  );

  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const { rows: evidence } = await rawQuery<DisputeEvidenceTable>(
    `SELECT id, uploader_address, file_name, file_size, mime_type, ipfs_cid, created_at
     FROM dispute_evidence
     WHERE job_id = $1
     ORDER BY created_at ASC`,
    [jobId]
  );

  return {
    success: true,
    data: {
      job: jobRows[0],
      evidence: evidence.map((ev: any) => ({
        id: ev.id,
        uploaderAddress: ev.uploader_address,
        fileName: ev.file_name,
        fileSize: ev.file_size,
        mimeType: ev.mime_type,
        ipfsCid: ev.ipfs_cid,
        gatewayUrl: ipfsService.getGatewayUrl(ev.ipfs_cid),
        createdAt: ev.created_at,
      })),
    },
  };
}

module.exports = {
  createDispute,
  uploadEvidence,
  resolveDispute,
  getDispute,
  MAX_EVIDENCE_FILES,
  MAX_FILE_SIZE,
  validateIpfsCid,
};
