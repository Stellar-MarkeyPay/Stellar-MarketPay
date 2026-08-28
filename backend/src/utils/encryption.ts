/**
 * AES-256-GCM encryption for secrets at rest (TOTP secrets, backup codes).
 */
import crypto from "crypto";
// @ts-ignore
import { requireEnv } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || requireEnv("JWT_SECRET");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encrypt(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!ciphertext.includes(":")) return ciphertext;

  const key = getEncryptionKey();
  const [ivHex, tagHex, dataHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
