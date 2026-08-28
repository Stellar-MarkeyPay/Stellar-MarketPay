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

interface CustomError extends Error {
  status?: number;
}

export const TRACKED_CONTRACT_FUNCTIONS = new Set([
  "create_escrow",
  "start_work",
  "release_escrow",
  "release_with_conversion",
  "refund_escrow",
]);

export async function logContractInteraction({
  functionName,
  callerAddress,
  jobId,
  txHash,
}: {
  functionName: string;
  callerAddress: string;
  jobId?: string | null;
  txHash: string;
}): Promise<any> {
  if (!TRACKED_CONTRACT_FUNCTIONS.has(functionName)) return null;
  if (!callerAddress || !txHash) return null;

  const { rows } = await rawQuery<any>(
    `INSERT INTO contract_audit_log (function_name, caller_address, job_id, tx_hash, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [functionName, callerAddress, jobId || null, txHash]
  );
  return rows[0];
}

export async function getAuditLogsForJob(jobId: string): Promise<any[]> {
  const { rows } = await rawQuery<any>(
    `SELECT id, function_name, caller_address, job_id, tx_hash, created_at
     FROM contract_audit_log
     WHERE job_id = $1
     ORDER BY created_at DESC`,
    [jobId]
  );
  return rows;
}
