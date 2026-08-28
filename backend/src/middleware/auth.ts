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
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
// @ts-ignore

export function requireJwtSecret(): string {
  if (!process.env.JWT_SECRET) {
    const message = "FATAL: JWT_SECRET environment variable is required";
    console.error(message);
    process.exit(1);
  }
  return process.env.JWT_SECRET;
}

export const JWT_SECRET = requireJwtSecret();

export async function verifyJWT(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
}

export function requireAdminRole(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }

  return next();
}

export async function requireAdmin2FA(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return next();

  try {
    const { rows } = await rawQuery<any>("SELECT totp_enabled FROM admin_profiles WHERE id = $1", [
      req.user.publicKey,
    ]);
    if (rows[0]?.totp_enabled && !req.user["2fa_verified"]) {
      return res.status(403).json({ error: "2FA required", requires2FA: true });
    }
    next();
  } catch {
    return res.status(500).json({ error: "Failed to verify 2FA status" });
  }
}
