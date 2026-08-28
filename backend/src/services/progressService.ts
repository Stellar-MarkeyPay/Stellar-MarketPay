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
/**
 * src/services/progressService.ts
 */

interface CustomError extends Error {
  status?: number;
}

export async function addProgressUpdate({
  jobId,
  authorAddress,
  updateText,
}: {
  jobId: string;
  authorAddress: string;
  updateText: string;
}): Promise<any> {
  if (!jobId || !authorAddress || !updateText) {
    const e = new Error("Missing required fields for progress update") as CustomError;
    e.status = 400;
    throw e;
  }

  const { rows } = await rawQuery<ProgressUpdateTable>(
    `INSERT INTO progress_updates (job_id, author_address, update_text)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [jobId, authorAddress, updateText]
  );

  return rows[0];
}

export async function getProgressUpdates(jobId: string): Promise<any[]> {
  const { rows } = await rawQuery<ProgressUpdateTable>(
    `SELECT pu.*, p.display_name as author_name
     FROM progress_updates pu
     JOIN profiles p ON p.public_key = pu.author_address
     WHERE pu.job_id = $1
     ORDER BY pu.created_at DESC`,
    [jobId]
  );
  return rows;
}
