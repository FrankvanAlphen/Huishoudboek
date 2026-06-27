import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config, isProd } from "./config.js";

const COOKIE_NAME = "fa_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dagen

// --- Wachtwoord (scrypt, dependency-vrij) --------------------------------

/** Maak een opslagbare hash 'salt:derived' (beide hex). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Verifieer een wachtwoord tegen een opgeslagen hash (timing-safe). */
export function verifyPassword(plain: string, stored: string): boolean {
  const [saltHex, derivedHex] = stored.split(":");
  if (!saltHex || !derivedHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(derivedHex, "hex");
  const actual = scryptSync(plain, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// --- Sessiecookie (HMAC-ondertekend) -------------------------------------

function sign(payload: string): string {
  return createHmac("sha256", config.AUTH_SECRET).update(payload).digest("hex");
}

function createToken(): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = String(expires);
  return `${payload}.${sign(payload)}`;
}

function isValidToken(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const expires = Number(payload);
  return Number.isFinite(expires) && expires > Date.now();
}

export function setSessionCookie(res: Response): void {
  res.cookie(COOKIE_NAME, createToken(), {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function isAuthenticated(req: Request): boolean {
  return isValidToken(req.cookies?.[COOKIE_NAME]);
}

/** Middleware: blokkeer niet-geauthenticeerde verzoeken. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "Niet ingelogd" });
}

// --- Eenvoudige in-memory rate-limiter voor login -------------------------
// (Voor productie met meerdere instances later vervangen door een gedeelde store.)

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 1000 * 60 * 10; // 10 minuten
const MAX_ATTEMPTS = 10;

export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? "onbekend";
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }
  if (entry.count >= MAX_ATTEMPTS) {
    res.status(429).json({ error: "Te veel pogingen, probeer het later opnieuw" });
    return;
  }
  entry.count += 1;
  next();
}
