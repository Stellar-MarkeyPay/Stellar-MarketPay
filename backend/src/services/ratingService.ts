import pool from "../db/pool";
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
 * src/services/ratingService.ts
 */
import { refreshFreelancerTier } from "./profileService";

interface CustomError extends Error {
  status?: number;
}

export async function createRating({
  jobId,
  raterAddress,
  ratedAddress,
  stars,
  review,
}: {
  jobId: string;
  raterAddress: string;
  ratedAddress: string;
  stars: number;
  review?: string;
}): Promise<any> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO ratings (job_id, rater_address, rated_address, stars, review)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_id, rater_address) DO NOTHING
       RETURNING *`,
      [jobId, raterAddress, ratedAddress, stars, review || null]
    );

    if (!rows.length) {
      const e = new Error("Rating already submitted for this job") as CustomError;
      e.status = 409;
      throw e;
    }

    const freelancerTier = await refreshFreelancerTier(ratedAddress, client);

    await client.query("COMMIT");
    return { ...rows[0], freelancer_tier: freelancerTier };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getRatingsForUser(publicKey: string): Promise<any[]> {
  const { rows } = await rawQuery<RatingTable>(
    `SELECT * FROM ratings WHERE rated_address = $1 ORDER BY created_at DESC`,
    [publicKey]
  );
  return rows;
}
