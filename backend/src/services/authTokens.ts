import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Request, Response } from "express";

const { JWT_SECRET } = require("../middleware/auth");

export const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE_NAME = "refreshToken";
const JWT_RESERVED_CLAIMS = new Set(["iat", "exp", "nbf", "jti"]);

interface RefreshSession {
  payload: Record<string, any>;
  expiresAt: number;
}

export const refreshSessions = new Map<string, RefreshSession>();

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizePayload(payload: Record<string, any> | undefined): Record<string, any> {
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([claim]) => !JWT_RESERVED_CLAIMS.has(claim))
  );
}

export function signAccessToken(payload: Record<string, any>): string {
  return jwt.sign(normalizePayload(payload), JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

function createRefreshToken(payload: Record<string, any>): string {
  const token = crypto.randomBytes(48).toString("base64url");
  refreshSessions.set(hashToken(token), {
    payload: normalizePayload(payload),
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });
  return token;
}

export function issueTokenPair(payload: Record<string, any>): {
  accessToken: string;
  refreshToken: string;
} {
  return {
    accessToken: signAccessToken(payload),
    refreshToken: createRefreshToken(payload),
  };
}

export function rotateRefreshToken(
  token: string | undefined
): { accessToken: string; refreshToken: string } | null {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = refreshSessions.get(tokenHash);
  refreshSessions.delete(tokenHash);

  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }

  return issueTokenPair(session.payload);
}

export function revokeRefreshToken(token: string | undefined): void {
  if (token) {
    refreshSessions.delete(hashToken(token));
  }
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const name = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

export function getRefreshTokenFromRequest(req: Request): string | null {
  return parseCookieHeader(req.headers.cookie)[REFRESH_COOKIE_NAME] || null;
}

function getCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge,
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie("jwt", accessToken, getCookieOptions(15 * 60 * 1000));
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions(REFRESH_TOKEN_TTL_MS));
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie("jwt", getCookieOptions(0));
  res.clearCookie(REFRESH_COOKIE_NAME, getCookieOptions(0));
}
