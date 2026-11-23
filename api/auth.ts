/**
 * HETTETY v4 — Neon Serverless Authentication API (/api/auth)
 * Actions: register | login | logout | me | oauth-sync | update-profile
 */

import crypto from 'crypto';
import type { AdminRole, UserAccountRecord } from '../src/core/domain/entities.js';
import {
  isNeonConfigured,
  getNeonSql,
  ensureNeonSchema,
  writeAuditLog,
  devMemoryStore,
  DEFAULT_SYSTEM_SETTINGS,
} from './_lib/neon.js';
import {
  SUPER_ADMIN_EMAILS,
  SELF_REGISTER_ROLES,
  normalizeEmail,
  isSuperAdminEmail,
  resolveEffectiveRole,
  hashPassword,
  verifyPassword,
  hashToken,
  signAuthToken,
  extractBearerToken,
  verifyAuthHeader,
  verifyAuthHeaderAsync,
  verifyFirebaseIdTokenLightweight,
  getQueryParams,
  getJsonBody,
} from './_lib/auth.js';

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeUserRow(row: Record<string, any>): UserAccountRecord {
  const email = normalizeEmail(row.email || '');
  const role = resolveEffectiveRole(email, row.role);
  return {
    id: String(row.id),
    uid: String(row.id),
    email,
    name: String(row.name || email.split('@')[0] || 'User'),
    phone: row.phone ? String(row.phone) : '',
    role,
    kycStatus: (row.kyc_status || row.kycStatus || 'unverified') as UserAccountRecord['kycStatus'],
    isSuspended: Boolean(row.is_suspended ?? row.isSuspended ?? false),
    avatarUrl: row.avatar_url || row.avatarUrl || undefined,
    preferences: String(row.preferences || ''),
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : row.createdAt || new Date().toISOString(),
    lastLoginAt: row.last_login_at
      ? new Date(row.last_login_at).toISOString()
      : row.lastLoginAt || new Date().toISOString(),
  };
}

async function isPublicRegistrationEnabled(): Promise<boolean> {
  if (isNeonConfigured()) {
    try {
      await ensureNeonSchema();
      const sql = getNeonSql();
      const rows = (await sql`
        SELECT value FROM system_settings WHERE setting_key = 'platform_config' LIMIT 1
      `) as Record<string, any>[];
      const val = rows[0]?.value;
      if (val && typeof val.allowPublicRegistration === 'boolean') {
        return val.allowPublicRegistration;
      }
    } catch {
      return DEFAULT_SYSTEM_SETTINGS.allowPublicRegistration;
    }
  }
  return devMemoryStore.settings.allowPublicRegistration;
}

async function createSessionForUser(user: UserAccountRecord): Promise<{ token: string; sid: string }> {
  const sid = `ses_${crypto.randomUUID()}`;
  const token = signAuthToken(
    { uid: user.id, email: user.email, role: user.role, sid },
    SESSION_TTL_SECONDS
  );
  const tokenHash = hashToken(token);
  const expiresAtIso = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  if (isNeonConfigured()) {
    await ensureNeonSchema();
    const sql = getNeonSql();
    await sql`
      INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (${sid}, ${user.id}, ${tokenHash}, ${expiresAtIso}::timestamptz, NOW())
    `;
  } else {
    devMemoryStore.sessions.set(sid, {
      id: sid,
      userId: user.id,
      tokenHash,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
      revokedAt: null,
    });
  }

  return { token, sid };
}

async function findUserByEmail(email: string): Promise<Record<string, any> | null> {
  const cleanEmail = normalizeEmail(email);
  if (isNeonConfigured()) {
    await ensureNeonSchema();
    const sql = getNeonSql();
    const rows = (await sql`
      SELECT * FROM users WHERE LOWER(email) = ${cleanEmail} LIMIT 1
    `) as Record<string, any>[];
    return rows[0] || null;
  }
  for (const user of devMemoryStore.users.values()) {
    if (normalizeEmail(user.email) === cleanEmail) return user;
  }
  return null;
}

async function findUserById(id: string): Promise<Record<string, any> | null> {
  if (isNeonConfigured()) {
    await ensureNeonSchema();
    const sql = getNeonSql();
    const rows = (await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
    return rows[0] || null;
  }
  return devMemoryStore.users.get(id) || null;
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.NODE_ENV === 'production' && !isNeonConfigured()) {
    return res.status(503).json({
      error: 'DATABASE_NOT_CONFIGURED: Neon DATABASE_URL is required in production.',
    });
  }

  const query = getQueryParams(req);
  const body = getJsonBody(req);
  const action = String(body.action || query.action || (req.method === 'GET' ? 'me' : '')).trim();

  try {
    // ------------------------------------------------------------------------
    // 1. REGISTER
    // ------------------------------------------------------------------------
    if (action === 'register') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Use POST for register.' });
      }

      const email = normalizeEmail(body.email);
      const password = typeof body.password === 'string' ? body.password : '';
      const name = String(body.name || '').trim().slice(0, 120) || email.split('@')[0] || 'User';
      const phone = String(body.phone || '').trim().slice(0, 40);

      if (!EMAIL_REGEX.test(email) || email.length > 254) {
        return res.status(400).json({ error: 'INVALID_EMAIL: Please provide a valid email address.' });
      }
      if (password.length < 8 || password.length > 128) {
        return res.status(400).json({
          error: 'INVALID_PASSWORD: Password must be between 8 and 128 characters.',
        });
      }

      const canRegister = await isPublicRegistrationEnabled();
      if (!canRegister && !isSuperAdminEmail(email)) {
        return res.status(403).json({ error: 'REGISTRATION_DISABLED: Public registration is currently paused.' });
      }

      const existing = await findUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: 'EMAIL_EXISTS: An account with this email already exists.' });
      }

      // Strictly prevent privilege escalation on self-registration
      const requestedRole = typeof body.role === 'string' ? body.role.trim() : 'buyer';
      const safeRequestedRole: AdminRole = (SELF_REGISTER_ROLES as readonly string[]).includes(requestedRole)
        ? (requestedRole as AdminRole)
        : 'buyer';
      const effectiveRole = resolveEffectiveRole(email, safeRequestedRole);

      const userId = `usr_${crypto.randomUUID()}`;
      const passwordHash = hashPassword(password);
      const nowIso = new Date().toISOString();

      let savedRow: Record<string, any>;
      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const inserted = (await sql`
          INSERT INTO users (
            id, email, password_hash, name, phone, role, kyc_status, is_suspended,
            avatar_url, preferences, created_at, last_login_at
          )
          VALUES (
            ${userId}, ${email}, ${passwordHash}, ${name}, ${phone}, ${effectiveRole},
            'unverified', FALSE, ${body.avatarUrl ? String(body.avatarUrl).slice(0, 500) : null},
            '', ${nowIso}::timestamptz, ${nowIso}::timestamptz
          )
          RETURNING *
        `) as Record<string, any>[];
        savedRow = inserted[0];
      } else {
        savedRow = {
          id: userId,
          email,
          password_hash: passwordHash,
          name,
          phone,
          role: effectiveRole,
          kyc_status: 'unverified',
          is_suspended: false,
          avatar_url: body.avatarUrl ? String(body.avatarUrl).slice(0, 500) : null,
          preferences: '',
          created_at: nowIso,
          last_login_at: nowIso,
        };
        devMemoryStore.users.set(userId, savedRow);
      }

      const sanitized = sanitizeUserRow(savedRow);
      const { token } = await createSessionForUser(sanitized);

      await writeAuditLog({
        actorId: sanitized.id,
        actorEmail: sanitized.email,
        actorRole: sanitized.role,
        action: 'USER_REGISTERED',
        resourceType: 'user',
        resourceId: sanitized.id,
        summary: `New user registered (${sanitized.email}) with role ${sanitized.role}.`,
        afterState: { email: sanitized.email, role: sanitized.role },
      });

      return res.status(201).json({ success: true, token, user: sanitized });
    }

    // ------------------------------------------------------------------------
    // 2. LOGIN
    // ------------------------------------------------------------------------
    if (action === 'login') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Use POST for login.' });
      }

      const email = normalizeEmail(body.email);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!email || !password) {
        return res.status(400).json({ error: 'INVALID_CREDENTIALS: Email and password are required.' });
      }

      const row = await findUserByEmail(email);
      if (!row || !verifyPassword(password, row.password_hash)) {
        return res.status(401).json({ error: 'INVALID_CREDENTIALS: Invalid email or password.' });
      }

      if (row.is_suspended) {
        return res.status(403).json({ error: 'ACCOUNT_SUSPENDED: This account has been suspended.' });
      }

      const effectiveRole = resolveEffectiveRole(email, row.role);
      const nowIso = new Date().toISOString();

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        await sql`
          UPDATE users
          SET last_login_at = ${nowIso}::timestamptz, role = ${effectiveRole}
          WHERE id = ${row.id}
        `;
      } else {
        row.last_login_at = nowIso;
        row.role = effectiveRole;
        devMemoryStore.users.set(row.id, row);
      }

      const sanitized = sanitizeUserRow({ ...row, role: effectiveRole, last_login_at: nowIso });
      const { token } = await createSessionForUser(sanitized);

      return res.status(200).json({ success: true, token, user: sanitized });
    }

    // ------------------------------------------------------------------------
    // 3. OAUTH-SYNC (Bridge Google / Firebase OAuth users into Neon Auth)
    // ------------------------------------------------------------------------
    if (action === 'oauth-sync') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Use POST for oauth-sync.' });
      }

      const rawIdToken =
        (typeof body.idToken === 'string' && body.idToken.trim()) || extractBearerToken(req) || '';
      const existingNeon = verifyAuthHeader(req);

      let verifiedEmail = '';
      let verifiedUid = '';
      let verifiedName = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
      let verifiedAvatar = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim().slice(0, 500) : '';

      if (existingNeon) {
        verifiedEmail = existingNeon.email;
        verifiedUid = existingNeon.uid;
      } else if (rawIdToken) {
        const fbVerified = await verifyFirebaseIdTokenLightweight(rawIdToken);
        if (fbVerified && fbVerified.email) {
          verifiedEmail = fbVerified.email;
          verifiedUid = fbVerified.uid;
          if (!verifiedName && fbVerified.name) verifiedName = fbVerified.name;
          if (!verifiedAvatar && fbVerified.avatarUrl) verifiedAvatar = fbVerified.avatarUrl;
        } else if (process.env.NODE_ENV === 'production') {
          return res.status(401).json({
            error: 'UNAUTHORIZED: Invalid or expired OAuth ID token.',
          });
        }
      }

      // In production, NEVER mint a session without cryptographic proof of identity
      if (!verifiedEmail) {
        if (process.env.NODE_ENV === 'production') {
          return res.status(401).json({
            error: 'UNAUTHORIZED: A valid verified ID token is required for oauth-sync in production.',
          });
        }
        const devEmail = normalizeEmail(body.email);
        if (!EMAIL_REGEX.test(devEmail)) {
          return res.status(400).json({ error: 'INVALID_EMAIL: Valid email is required.' });
        }
        verifiedEmail = devEmail;
        verifiedUid = String(body.uid || body.id || `usr_${crypto.randomUUID()}`).trim();
      }

      const existing = await findUserByEmail(verifiedEmail);
      const nowIso = new Date().toISOString();
      const displayName = verifiedName || existing?.name || verifiedEmail.split('@')[0] || 'User';
      const avatarUrl = verifiedAvatar || existing?.avatar_url || null;
      const effectiveRole = resolveEffectiveRole(verifiedEmail, existing?.role);

      if (existing?.is_suspended) {
        return res.status(403).json({ error: 'ACCOUNT_SUSPENDED: This account has been suspended.' });
      }

      let savedRow: Record<string, any>;
      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        if (existing) {
          const updated = (await sql`
            UPDATE users
            SET name = ${displayName},
                avatar_url = COALESCE(${avatarUrl}, avatar_url),
                role = ${effectiveRole},
                last_login_at = ${nowIso}::timestamptz
            WHERE id = ${existing.id}
            RETURNING *
          `) as Record<string, any>[];
          savedRow = updated[0];
        } else {
          const newId = verifiedUid || `usr_${crypto.randomUUID()}`;
          const inserted = (await sql`
            INSERT INTO users (
              id, email, name, phone, role, kyc_status, is_suspended,
              avatar_url, preferences, created_at, last_login_at
            )
            VALUES (
              ${newId}, ${verifiedEmail}, ${displayName}, ${String(body.phone || '').slice(0, 40)},
              ${effectiveRole}, 'unverified', FALSE, ${avatarUrl}, '',
              ${nowIso}::timestamptz, ${nowIso}::timestamptz
            )
            ON CONFLICT (email) DO UPDATE
            SET name = EXCLUDED.name,
                avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
                role = ${effectiveRole},
                last_login_at = NOW()
            RETURNING *
          `) as Record<string, any>[];
          savedRow = inserted[0];
        }
      } else {
        const targetId = existing?.id || verifiedUid || `usr_${crypto.randomUUID()}`;
        savedRow = {
          ...(existing || {}),
          id: targetId,
          email: verifiedEmail,
          name: displayName,
          phone: existing?.phone || String(body.phone || '').slice(0, 40),
          role: effectiveRole,
          kyc_status: existing?.kyc_status || 'unverified',
          is_suspended: false,
          avatar_url: avatarUrl,
          preferences: existing?.preferences || '',
          created_at: existing?.created_at || nowIso,
          last_login_at: nowIso,
        };
        devMemoryStore.users.set(targetId, savedRow);
      }

      const sanitized = sanitizeUserRow(savedRow);
      const { token } = await createSessionForUser(sanitized);

      return res.status(200).json({
        success: true,
        token,
        user: sanitized,
        superAdminEmailsCount: SUPER_ADMIN_EMAILS.length,
      });
    }

    // ------------------------------------------------------------------------
    // 4. ME (Get Current Authenticated Profile)
    // ------------------------------------------------------------------------
    if (action === 'me') {
      const auth = await verifyAuthHeaderAsync(req);
      if (!auth) {
        return res.status(401).json({ error: 'UNAUTHORIZED: Missing or expired session token.' });
      }

      const row = (await findUserById(auth.uid)) || (await findUserByEmail(auth.email));
      if (!row) {
        // Return synthesized verified profile if token is valid but row hasn't synced yet
        return res.status(200).json({
          success: true,
          user: {
            id: auth.uid,
            uid: auth.uid,
            email: auth.email,
            name: auth.email.split('@')[0],
            role: auth.role,
            kycStatus: 'unverified',
            isSuspended: false,
            preferences: '',
          } satisfies UserAccountRecord,
        });
      }

      if (row.is_suspended) {
        return res.status(403).json({ error: 'ACCOUNT_SUSPENDED: This account has been suspended.' });
      }

      return res.status(200).json({ success: true, user: sanitizeUserRow(row) });
    }

    // ------------------------------------------------------------------------
    // 5. LOGOUT (Revoke Active Session)
    // ------------------------------------------------------------------------
    if (action === 'logout') {
      const token = extractBearerToken(req);
      if (token) {
        const tokenHash = hashToken(token);
        if (isNeonConfigured()) {
          await ensureNeonSchema();
          const sql = getNeonSql();
          await sql`
            UPDATE sessions SET revoked_at = NOW()
            WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
          `;
        } else {
          for (const sess of devMemoryStore.sessions.values()) {
            if (sess.tokenHash === tokenHash) {
              sess.revokedAt = Date.now();
            }
          }
        }
      }
      return res.status(200).json({ success: true });
    }

    // ------------------------------------------------------------------------
    // 6. UPDATE-PROFILE (Self-service safe fields only)
    // ------------------------------------------------------------------------
    if (action === 'update-profile') {
      const auth = await verifyAuthHeaderAsync(req);
      if (!auth) {
        return res.status(401).json({ error: 'UNAUTHORIZED: Authentication required.' });
      }

      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : undefined;
      const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 40) : undefined;
      const preferences = typeof body.preferences === 'string' ? body.preferences.slice(0, 2000) : undefined;
      const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim().slice(0, 500) : undefined;

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const updated = (await sql`
          UPDATE users
          SET name = COALESCE(${name ?? null}, name),
              phone = COALESCE(${phone ?? null}, phone),
              preferences = COALESCE(${preferences ?? null}, preferences),
              avatar_url = COALESCE(${avatarUrl ?? null}, avatar_url)
          WHERE id = ${auth.uid}
          RETURNING *
        `) as Record<string, any>[];
        if (!updated[0]) {
          return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }
        return res.status(200).json({ success: true, user: sanitizeUserRow(updated[0]) });
      }

      const existing = devMemoryStore.users.get(auth.uid);
      if (!existing) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
      }
      if (name !== undefined) existing.name = name;
      if (phone !== undefined) existing.phone = phone;
      if (preferences !== undefined) existing.preferences = preferences;
      if (avatarUrl !== undefined) existing.avatar_url = avatarUrl;
      devMemoryStore.users.set(auth.uid, existing);
      return res.status(200).json({ success: true, user: sanitizeUserRow(existing) });
    }

    return res.status(400).json({ error: `UNKNOWN_ACTION: Unsupported auth action '${action}'.` });
  } catch (err: any) {
    console.error('[api/auth] Error:', err);
    return res.status(500).json({ error: err?.message || 'Authentication service error.' });
  }
}
