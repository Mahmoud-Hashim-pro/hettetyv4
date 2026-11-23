/**
 * HETTETY v4 — Neon Serverless Authentication, Password Hashing (scrypt),
 * HMAC-SHA256 JWT Session Verification & RBAC Helpers
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AdminRole } from '../../src/core/domain/entities.js';
import { isNeonConfigured, getNeonSql, ensureNeonSchema, devMemoryStore } from './neon.js';

export const SUPER_ADMIN_EMAILS = [
  'abdallahahmedpilot2426@gmail.com',
  'marwaneltaweel0@gmail.com',
  'pro.mahmoud.h@gmail.com',
  'modyhashim2006@gmail.com',
] as const;

export const VALID_ROLES: readonly AdminRole[] = [
  'super_admin',
  'admin',
  'operations',
  'broker',
  'technician',
  'seller',
  'buyer',
  'user',
] as const;

export const SELF_REGISTER_ROLES: readonly AdminRole[] = [
  'buyer',
  'seller',
  'broker',
  'user',
] as const;

export interface VerifiedAuthUser {
  uid: string;
  email: string;
  role: AdminRole;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  sid?: string;
}

const DEV_JWT_FALLBACK = 'hettety-v4-dev-jwt-secret-local-only-32bytes';

function getJwtSecret(): string {
  const configured = (process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || '').trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === 'production') {
    const seed = process.env.DATABASE_URL || process.env.WORKER_SHARED_SECRET || '';
    if (seed) {
      return crypto.createHash('sha256').update(`hettety-jwt::${seed}`).digest('hex');
    }
    console.warn('[Auth] AUTH_JWT_SECRET is not set in production; configure it in environment variables.');
  }
  return DEV_JWT_FALLBACK;
}

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const clean = normalizeEmail(email);
  return (SUPER_ADMIN_EMAILS as readonly string[]).includes(clean);
}

export function isValidRole(role: unknown): role is AdminRole {
  return typeof role === 'string' && (VALID_ROLES as readonly string[]).includes(role);
}

export function resolveEffectiveRole(email: string, storedRole?: string | null): AdminRole {
  if (isSuperAdminEmail(email)) return 'super_admin';
  if (isValidRole(storedRole)) return storedRole;
  return 'buyer';
}

export function computeRoleFlags(email: string, role: AdminRole): { isAdmin: boolean; isSuperAdmin: boolean } {
  const isSuperAdmin = role === 'super_admin' || isSuperAdminEmail(email);
  const isAdmin = isSuperAdmin || role === 'admin' || role === 'operations';
  return { isAdmin, isSuperAdmin };
}

/** Hashes a password with a per-user 16-byte random salt using Node scrypt. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/** Constant-time verification of a plaintext password against a stored scrypt hash. */
export function verifyPassword(password: string, storedHash?: string | null): boolean {
  if (!password || !storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Computes a SHA-256 hex digest of a session token for database storage. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return Buffer.from(b64, 'base64');
}

/** Signs a compact HMAC-SHA256 JWT token valid for ttlSeconds (default 7 days). */
export function signAuthToken(
  payload: { uid: string; email: string; role: AdminRole; sid?: string },
  ttlSeconds = 7 * 24 * 60 * 60
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const bodyB64 = base64UrlEncode(
    JSON.stringify({
      sub: payload.uid,
      uid: payload.uid,
      email: normalizeEmail(payload.email),
      role: payload.role,
      sid: payload.sid,
      iat: nowSec,
      exp: nowSec + ttlSeconds,
    })
  );
  const signingInput = `${headerB64}.${bodyB64}`;
  const sig = crypto.createHmac('sha256', getJwtSecret()).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

/** Synchronously verifies a Neon HMAC-SHA256 JWT token. Returns null if invalid or expired. */
export function verifyAuthToken(token: string): VerifiedAuthUser | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, bodyB64, sigB64] = parts;
  if (!headerB64 || !bodyB64 || !sigB64) return null;

  try {
    const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    if (!header || header.alg !== 'HS256') return null;

    const signingInput = `${headerB64}.${bodyB64}`;
    const expectedSig = crypto.createHmac('sha256', getJwtSecret()).update(signingInput).digest();
    const actualSig = base64UrlDecode(sigB64);

    if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(bodyB64).toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload.exp !== 'number' || payload.exp <= nowSec) {
      return null;
    }

    const uid = String(payload.uid || payload.sub || '').trim();
    const email = normalizeEmail(payload.email || '');
    if (!uid || !email) return null;

    const role = resolveEffectiveRole(email, payload.role);
    const { isAdmin, isSuperAdmin } = computeRoleFlags(email, role);

    return {
      uid,
      email,
      role,
      isAdmin,
      isSuperAdmin,
      sid: typeof payload.sid === 'string' ? payload.sid : undefined,
    };
  } catch {
    return null;
  }
}

/** Extracts raw Bearer token from an incoming HTTP request. */
export function extractBearerToken(req: any): string | null {
  const header = req?.headers?.authorization || req?.headers?.Authorization;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Synchronously validates the Authorization Bearer header against Neon HMAC-SHA256 JWT.
 * Returns { uid, email, role, isAdmin, isSuperAdmin } or null.
 */
export function verifyAuthHeader(req: any): VerifiedAuthUser | null {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifyAuthToken(token);
}

// ----------------------------------------------------------------------------
// Lightweight Google/Firebase RS256 ID Token Verification (OAuth Sync Bridge)
// ----------------------------------------------------------------------------

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cachedGoogleCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

function resolveFirebaseProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (parsed?.projectId) return String(parsed.projectId);
    }
  } catch {
    // ignore missing config
  }
  return 'gen-lang-client-0748002195';
}

async function fetchGooglePublicCerts(): Promise<Record<string, string>> {
  if (cachedGoogleCerts && Date.now() < cachedGoogleCerts.expiresAt) {
    return cachedGoogleCerts.certs;
  }
  const res = await fetch(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Failed to fetch Google x509 certs (${res.status})`);
  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlMs = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) * 1000 : 300_000;
  cachedGoogleCerts = { certs, expiresAt: Date.now() + ttlMs };
  return certs;
}

/**
 * Cryptographically verifies a Firebase RS256 ID token against Google's official x509 certs
 * without requiring FIREBASE_SERVICE_ACCOUNT_KEY. Rejects non-RS256/malformed tokens immediately.
 */
export async function verifyFirebaseIdTokenLightweight(
  idToken: string
): Promise<{ uid: string; email: string; name?: string; avatarUrl?: string } | null> {
  if (!idToken || typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

    const payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
    const projectId = resolveFirebaseProjectId();
    const nowSec = Math.floor(Date.now() / 1000);

    if (
      !payload ||
      payload.aud !== projectId ||
      payload.iss !== `https://securetoken.google.com/${projectId}` ||
      typeof payload.exp !== 'number' ||
      payload.exp <= nowSec ||
      typeof payload.sub !== 'string' ||
      !payload.sub
    ) {
      return null;
    }

    const certs = await fetchGooglePublicCerts();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
    const signature = base64UrlDecode(parts[2]);
    const valid = crypto.verify('RSA-SHA256', signingInput, certPem, signature);
    if (!valid) return null;

    return {
      uid: payload.sub,
      email: normalizeEmail(payload.email || ''),
      name: typeof payload.name === 'string' ? payload.name : undefined,
      avatarUrl: typeof payload.picture === 'string' ? payload.picture : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Full async authentication resolver:
 * 1. Verifies Neon HMAC-SHA256 JWT + checks session revocation & suspension in Neon/dev store.
 * 2. Falls back to verifying an RS256 Firebase ID token (for OAuth bridge during migration).
 * 3. In NODE_ENV === 'test', accepts explicit test tokens (`test_*` / `admin-test-token`) cleanly.
 */
export async function verifyAuthHeaderAsync(req: any): Promise<VerifiedAuthUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  // 1. Primary: Neon HMAC-SHA256 JWT
  const neonUser = verifyAuthToken(token);
  if (neonUser) {
    const tokenHash = hashToken(token);
    if (isNeonConfigured()) {
      try {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const [sessionRows, userRows] = await Promise.all([
          neonUser.sid
            ? sql`SELECT revoked_at, expires_at FROM sessions WHERE id = ${neonUser.sid} AND token_hash = ${tokenHash} LIMIT 1`
            : sql`SELECT revoked_at, expires_at FROM sessions WHERE token_hash = ${tokenHash} LIMIT 1`,
          sql`SELECT role, is_suspended FROM users WHERE id = ${neonUser.uid} LIMIT 1`,
        ]);

        const sess = (sessionRows as Record<string, any>[])[0];
        if (sess && (sess.revoked_at || new Date(sess.expires_at).getTime() <= Date.now())) {
          return null;
        }
        const dbUser = (userRows as Record<string, any>[])[0];
        if (dbUser) {
          if (dbUser.is_suspended) return null;
          const effectiveRole = resolveEffectiveRole(neonUser.email, dbUser.role);
          const flags = computeRoleFlags(neonUser.email, effectiveRole);
          return { ...neonUser, role: effectiveRole, ...flags };
        }
      } catch (err) {
        console.warn('[Auth] Neon session lookup warning:', err);
      }
    } else {
      const devSession = Array.from(devMemoryStore.sessions.values()).find(
        (s) => s.tokenHash === tokenHash
      );
      if (devSession && (devSession.revokedAt !== null || devSession.expiresAt <= Date.now())) {
        return null;
      }
      const devUser = devMemoryStore.users.get(neonUser.uid);
      if (devUser) {
        if (devUser.isSuspended || devUser.is_suspended) return null;
        const effectiveRole = resolveEffectiveRole(neonUser.email, devUser.role);
        const flags = computeRoleFlags(neonUser.email, effectiveRole);
        return { ...neonUser, role: effectiveRole, ...flags };
      }
    }
    return neonUser;
  }

  // 2. Unit-test token helper ONLY in NODE_ENV === 'test'
  if (process.env.NODE_ENV === 'test' && (token.startsWith('test_') || token.includes('admin-test'))) {
    const isAdmin = token.includes('admin');
    const isSuperAdmin = token.includes('super_admin') || token.includes('superadmin');
    const role: AdminRole = isSuperAdmin ? 'super_admin' : isAdmin ? 'admin' : 'buyer';
    return {
      uid: token,
      email: isSuperAdmin ? SUPER_ADMIN_EMAILS[0] : `${token}@test.hettety.local`,
      role,
      isAdmin: isAdmin || isSuperAdmin,
      isSuperAdmin,
    };
  }

  // 3. Bridge: cryptographically verified Firebase RS256 ID token
  const fb = await verifyFirebaseIdTokenLightweight(token);
  if (fb && fb.email) {
    let dbRole: string | null = null;
    if (isNeonConfigured()) {
      try {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          SELECT role, is_suspended FROM users WHERE id = ${fb.uid} OR LOWER(email) = ${fb.email} LIMIT 1
        `) as Record<string, any>[];
        if (rows[0]?.is_suspended) return null;
        dbRole = rows[0]?.role || null;
      } catch {
        // fallback to email role check
      }
    }
    const role = resolveEffectiveRole(fb.email, dbRole);
    const flags = computeRoleFlags(fb.email, role);
    return {
      uid: fb.uid,
      email: fb.email,
      role,
      ...flags,
    };
  }

  return null;
}

// ----------------------------------------------------------------------------
// Request Parsing Helpers (Vercel + Vite Dev + Vitest Compatible)
// ----------------------------------------------------------------------------

export function getQueryParams(req: any): Record<string, string> {
  const result: Record<string, string> = {};
  if (req?.url && typeof req.url === 'string' && req.url.includes('?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      url.searchParams.forEach((value, key) => {
        result[key] = value;
      });
    } catch {
      // ignore malformed URL
    }
  }
  if (req?.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      if (Array.isArray(v)) result[k] = String(v[0] ?? '');
      else if (v !== undefined && v !== null) result[k] = String(v);
    }
  }
  return result;
}

export function getJsonBody(req: any): Record<string, any> {
  if (!req?.body) return {};
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof req.body === 'object' ? req.body : {};
}

export function getClientIp(req: any): string {
  const raw =
    (req?.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) ||
    req?.socket?.remoteAddress ||
    '127.0.0.1';
  return Array.isArray(raw) ? String(raw[0] || '127.0.0.1') : String(raw || '127.0.0.1');
}
