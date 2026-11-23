/**
 * HETTETY Clean Architecture — Neon Auth & User Repository
 *
 * Implements `IUserRepository` and manages email/password authentication against
 * `/api/auth` with a secure localStorage fallback for preview environments
 * without `DATABASE_URL`. Enforces `SUPER_ADMIN_EMAILS` elevation, account
 * suspension checks, KYC status updates, and RBAC role management.
 */

import type { AdminRole, UserAccountRecord } from '../../core/domain/entities';
import type { IUserRepository } from '../../core/domain/repositories';
import { SUPER_ADMIN_EMAILS } from '../../constants';
import {
  neonClient,
  generateDocumentId,
  NeonApiError,
  type NeonClient,
  type NeonStoredUser,
  type NeonAuthListener,
} from './NeonClient';

const USERS_COLLECTION = 'users';
const LOCAL_AUTH_CREDS_KEY = 'hettety_neon_local_auth_creds';

const VALID_ADMIN_ROLES: ReadonlySet<AdminRole> = new Set<AdminRole>([
  'super_admin',
  'admin',
  'operations',
  'broker',
  'technician',
  'seller',
  'buyer',
  'user',
]);

const VALID_KYC_STATUSES: ReadonlySet<NonNullable<UserAccountRecord['kycStatus']>> = new Set([
  'unverified',
  'pending',
  'verified',
  'rejected',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NeonAuthResult {
  user: UserAccountRecord;
  token: string;
}

export class NeonAuthError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'NeonAuthError';
    this.code = code;
    this.status = status;
  }
}

interface LocalCredentialEntry {
  uid: string;
  email: string;
  salt: string;
  passwordHash: string;
}

const memoryCreds = new Map<string, LocalCredentialEntry>();

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return SUPER_ADMIN_EMAILS.some((adminEmail) => adminEmail.toLowerCase() === normalized);
}

export function resolveEffectiveRole(email: string, storedRole?: string): AdminRole {
  if (isSuperAdminEmail(email)) {
    return 'super_admin';
  }
  if (storedRole && VALID_ADMIN_ROLES.has(storedRole as AdminRole)) {
    return storedRole as AdminRole;
  }
  return 'user';
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function validateEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 254 || !EMAIL_REGEX.test(normalized)) {
    throw new NeonAuthError('auth/invalid-email', 'Please enter a valid email address.', 400);
  }
  return normalized;
}

function validatePassword(password: string, minLength = 6): string {
  const value = String(password || '');
  if (!value || value.length < minLength) {
    throw new NeonAuthError(
      'auth/weak-password',
      `Password must be at least ${minLength} characters.`,
      400
    );
  }
  return value;
}

async function hashLocalPassword(password: string, salt: string): Promise<string> {
  const input = `hettety:v4:${salt}:${password}`;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback salted multi-round digest for non-HTTPS LAN dev previews where crypto.subtle is unavailable
  let h1 = 0xdeadbeef ^ salt.length;
  let h2 = 0x41c6ce57 ^ password.length;
  for (let round = 0; round < 32; round++) {
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch ^ round, 2654435761);
      h2 = Math.imul(h2 ^ ch ^ (round << 1), 1597334677);
    }
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function generateSalt(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(12);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function readLocalCredentials(): Record<string, LocalCredentialEntry> {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(LOCAL_AUTH_CREDS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, LocalCredentialEntry>;
        }
      }
    } catch {
      // Fall back to in-memory map
    }
  }
  return Object.fromEntries(memoryCreds.entries());
}

function writeLocalCredentials(entries: Record<string, LocalCredentialEntry>): void {
  memoryCreds.clear();
  for (const [k, v] of Object.entries(entries)) {
    memoryCreds.set(k, v);
  }
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.setItem(LOCAL_AUTH_CREDS_KEY, JSON.stringify(entries));
    } catch {
      // Keep memory mirror
    }
  }
}

function createLocalFallbackToken(user: UserAccountRecord): string {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    mode: 'local_adapter',
  };
  const encoded =
    typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      : Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return `local_fallback_${encoded.replace(/=+$/, '')}`;
}

function toUserAccountRecord(raw: Record<string, unknown>): UserAccountRecord {
  const email = normalizeEmail(String(raw.email || ''));
  const id = String(raw.id || raw.uid || '');
  const role = resolveEffectiveRole(email, typeof raw.role === 'string' ? raw.role : undefined);
  const name = String(raw.name || raw.displayName || (email ? email.split('@')[0] : 'User'));

  return {
    id,
    uid: String(raw.uid || id),
    email,
    name,
    phone: typeof raw.phone === 'string' ? raw.phone : undefined,
    role,
    kycStatus: VALID_KYC_STATUSES.has(raw.kycStatus as any)
      ? (raw.kycStatus as UserAccountRecord['kycStatus'])
      : 'unverified',
    isSuspended: Boolean(raw.isSuspended),
    avatarUrl:
      typeof raw.avatarUrl === 'string'
        ? raw.avatarUrl
        : typeof raw.photoURL === 'string'
        ? raw.photoURL
        : undefined,
    preferences: typeof raw.preferences === 'string' ? raw.preferences : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    lastLoginAt: typeof raw.lastLoginAt === 'string' ? raw.lastLoginAt : undefined,
  };
}

function toStoredUser(record: UserAccountRecord): NeonStoredUser {
  return {
    id: record.id,
    uid: record.uid || record.id,
    email: record.email,
    name: record.name,
    displayName: record.name,
    phone: record.phone,
    role: record.role,
    kycStatus: record.kycStatus,
    isSuspended: record.isSuspended,
    avatarUrl: record.avatarUrl,
    photoURL: record.avatarUrl || null,
    preferences: record.preferences,
    createdAt: record.createdAt,
    lastLoginAt: record.lastLoginAt,
  };
}

function mapApiAuthError(err: NeonApiError): NeonAuthError {
  const msg = err.message || 'Authentication failed';
  const lower = msg.toLowerCase();
  if (err.code.startsWith('auth/')) {
    return new NeonAuthError(err.code, msg, err.status);
  }
  if (err.status === 409 || lower.includes('email_exists') || lower.includes('already exists') || lower.includes('already in use')) {
    return new NeonAuthError('auth/email-already-in-use', msg, 409);
  }
  if (lower.includes('invalid_email')) {
    return new NeonAuthError('auth/invalid-email', msg, 400);
  }
  if (lower.includes('invalid_password')) {
    return new NeonAuthError('auth/weak-password', msg, 400);
  }
  if (lower.includes('registration_disabled')) {
    return new NeonAuthError('auth/operation-not-allowed', msg, 403);
  }
  if (lower.includes('not found') || lower.includes('no account') || lower.includes('does not exist')) {
    return new NeonAuthError('auth/user-not-found', msg, 404);
  }
  if (lower.includes('account_suspended') || lower.includes('suspended') || lower.includes('disabled')) {
    return new NeonAuthError('auth/user-disabled', msg, 403);
  }
  if (err.status === 401 || lower.includes('invalid_credentials') || lower.includes('invalid password') || lower.includes('invalid credentials')) {
    return new NeonAuthError('auth/invalid-credential', msg, 401);
  }
  return new NeonAuthError('auth/internal-error', msg, err.status || 500);
}

export class NeonAuthRepository implements IUserRepository {
  private readonly client: NeonClient;

  constructor(client: NeonClient = neonClient) {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Authentication Flows (Neon /api/auth + Secure Local Fallback)
  // ---------------------------------------------------------------------------

  async register(email: string, password: string, name?: string): Promise<NeonAuthResult> {
    const cleanEmail = validateEmail(email);
    const cleanPassword = validatePassword(password, 6);
    const displayName = String(name || '').trim() || cleanEmail.split('@')[0];

    try {
      const outcome = await this.client.requestJson<Record<string, unknown>>(
        '/api/auth?action=register',
        {
          method: 'POST',
          body: {
            action: 'register',
            email: cleanEmail,
            password: cleanPassword,
            name: displayName,
          },
          allowFallbackOnUnavailable: true,
        }
      );

      if (outcome.ok) {
        const body = outcome.data;
        const token = String(body.token || body.accessToken || body.jwt || '');
        const rawUser = (body.user || body.data || body) as Record<string, unknown>;
        const userRecord = toUserAccountRecord({
          ...rawUser,
          email: rawUser.email || cleanEmail,
          name: rawUser.name || displayName,
        });
        if (userRecord.isSuspended) {
          throw new NeonAuthError('auth/user-disabled', 'This account has been suspended.', 403);
        }
        const effectiveToken = token || createLocalFallbackToken(userRecord);
        this.client.setAuthSession(effectiveToken, toStoredUser(userRecord));
        return { user: userRecord, token: effectiveToken };
      }
    } catch (err) {
      if (err instanceof NeonAuthError) throw err;
      if (err instanceof NeonApiError) throw mapApiAuthError(err);
      throw err;
    }

    // Graceful local storage fallback when /api/auth or Neon DB is unavailable
    const existingUsers = this.client.readLocalCollection<Record<string, unknown>>(USERS_COLLECTION);
    const duplicate = existingUsers.find(
      (u) => normalizeEmail(String(u.email || '')) === cleanEmail
    );
    if (duplicate) {
      throw new NeonAuthError(
        'auth/email-already-in-use',
        'An account with this email already exists.',
        409
      );
    }

    const uid = generateDocumentId('usr');
    const now = new Date().toISOString();
    const role = resolveEffectiveRole(cleanEmail);
    const salt = generateSalt();
    const passwordHash = await hashLocalPassword(cleanPassword, salt);

    const userRecord: UserAccountRecord = {
      id: uid,
      uid,
      email: cleanEmail,
      name: displayName,
      role,
      kycStatus: 'unverified',
      isSuspended: false,
      createdAt: now,
      lastLoginAt: now,
    };

    const creds = readLocalCredentials();
    creds[cleanEmail] = { uid, email: cleanEmail, salt, passwordHash };
    writeLocalCredentials(creds);

    await this.client.setDocument(USERS_COLLECTION, uid, {
      ...userRecord,
      favorites: [],
    });

    const token = createLocalFallbackToken(userRecord);
    this.client.setAuthSession(token, toStoredUser(userRecord));
    return { user: userRecord, token };
  }

  async login(email: string, password: string): Promise<NeonAuthResult> {
    const cleanEmail = validateEmail(email);
    const cleanPassword = validatePassword(password, 1);

    try {
      const outcome = await this.client.requestJson<Record<string, unknown>>(
        '/api/auth?action=login',
        {
          method: 'POST',
          body: {
            action: 'login',
            email: cleanEmail,
            password: cleanPassword,
          },
          allowFallbackOnUnavailable: true,
        }
      );

      if (outcome.ok) {
        const body = outcome.data;
        const token = String(body.token || body.accessToken || body.jwt || '');
        const rawUser = (body.user || body.data || body) as Record<string, unknown>;
        const userRecord = toUserAccountRecord({
          ...rawUser,
          email: rawUser.email || cleanEmail,
        });
        if (userRecord.isSuspended) {
          throw new NeonAuthError('auth/user-disabled', 'This account has been suspended.', 403);
        }
        const effectiveToken = token || createLocalFallbackToken(userRecord);
        this.client.setAuthSession(effectiveToken, toStoredUser(userRecord));
        return { user: userRecord, token: effectiveToken };
      }
    } catch (err) {
      if (err instanceof NeonAuthError) throw err;
      if (err instanceof NeonApiError) throw mapApiAuthError(err);
      throw err;
    }

    // Graceful local storage fallback when /api/auth or Neon DB is unavailable
    const localUsers = this.client.readLocalCollection<Record<string, unknown>>(USERS_COLLECTION);
    const matchedDoc = localUsers.find(
      (u) => normalizeEmail(String(u.email || '')) === cleanEmail
    );
    const creds = readLocalCredentials();
    const cred = creds[cleanEmail];

    if (!matchedDoc && !cred) {
      throw new NeonAuthError(
        'auth/user-not-found',
        'No account found with this email address. Please register first.',
        404
      );
    }

    if (cred) {
      const expectedHash = await hashLocalPassword(cleanPassword, cred.salt);
      if (expectedHash !== cred.passwordHash) {
        throw new NeonAuthError(
          'auth/invalid-credential',
          'Incorrect email or password.',
          401
        );
      }
    }

    const rawRecord = matchedDoc || {
      id: cred!.uid,
      uid: cred!.uid,
      email: cleanEmail,
      name: cleanEmail.split('@')[0],
    };

    const userRecord = toUserAccountRecord({
      ...rawRecord,
      lastLoginAt: new Date().toISOString(),
    });

    if (userRecord.isSuspended) {
      throw new NeonAuthError('auth/user-disabled', 'This account has been suspended.', 403);
    }

    await this.client.setDocument(USERS_COLLECTION, userRecord.id, {
      ...rawRecord,
      ...userRecord,
    }, true);

    const token = createLocalFallbackToken(userRecord);
    this.client.setAuthSession(token, toStoredUser(userRecord));
    return { user: userRecord, token };
  }

  async syncOAuth(payload: {
    idToken?: string;
    email?: string;
    name?: string;
    uid?: string;
    avatarUrl?: string;
  }): Promise<NeonAuthResult> {
    try {
      const outcome = await this.client.requestJson<Record<string, unknown>>(
        '/api/auth?action=oauth-sync',
        {
          method: 'POST',
          body: { action: 'oauth-sync', ...payload },
          allowFallbackOnUnavailable: false,
        }
      );

      if (outcome.ok && outcome.data) {
        const token = String(outcome.data.token || outcome.data.accessToken || '');
        const rawUser = (outcome.data.user || outcome.data.data || outcome.data) as Record<string, unknown>;
        const userRecord = toUserAccountRecord(rawUser);
        if (userRecord.isSuspended) {
          throw new NeonAuthError('auth/user-disabled', 'This account has been suspended.', 403);
        }
        const effectiveToken = token || createLocalFallbackToken(userRecord);
        this.client.setAuthSession(effectiveToken, toStoredUser(userRecord));
        return { user: userRecord, token: effectiveToken };
      }
      throw new NeonAuthError('auth/internal-error', 'OAuth sync did not return a user session.', 500);
    } catch (err) {
      if (err instanceof NeonAuthError) throw err;
      if (err instanceof NeonApiError) throw mapApiAuthError(err);
      throw err;
    }
  }

  async signOut(): Promise<void> {
    const token = this.client.getAuthToken();
    if (token && !token.startsWith('local_fallback_')) {
      try {
        await this.client.requestJson('/api/auth?action=logout', {
          method: 'POST',
          body: { action: 'logout' },
          allowFallbackOnUnavailable: true,
          timeoutMs: 4_000,
        });
      } catch {
        // Never block sign-out on remote errors
      }
    }
    this.client.clearAuthSession();
  }

  getSessionUserSync(): UserAccountRecord | null {
    const stored = this.client.getStoredUser();
    if (!stored) return null;
    return toUserAccountRecord(stored as unknown as Record<string, unknown>);
  }

  onAuthStateChange(listener: NeonAuthListener): () => void {
    return this.client.onAuthChange(listener);
  }

  // ---------------------------------------------------------------------------
  // IUserRepository Contract Implementation
  // ---------------------------------------------------------------------------

  async getCurrentUser(): Promise<UserAccountRecord | null> {
    const stored = this.client.getStoredUser();
    const token = this.client.getAuthToken();
    if (!stored && !token) return null;

    // Validate live Neon JWT with /api/auth?action=me when available
    if (token && !token.startsWith('local_fallback_')) {
      try {
        const outcome = await this.client.requestJson<Record<string, unknown>>(
          '/api/auth?action=me',
          {
            method: 'GET',
            allowFallbackOnUnavailable: true,
            timeoutMs: 6_000,
          }
        );

        if (outcome.ok) {
          const rawUser = (outcome.data.user || outcome.data.data || outcome.data) as Record<
            string,
            unknown
          >;
          if (rawUser && (rawUser.id || rawUser.uid || rawUser.email)) {
            const record = toUserAccountRecord(rawUser);
            if (record.isSuspended) {
              this.client.clearAuthSession();
              return null;
            }
            this.client.setAuthSession(token, toStoredUser(record));
            return record;
          }
        }
      } catch (err) {
        if (err instanceof NeonApiError && err.status === 401) {
          this.client.clearAuthSession();
          return null;
        }
      }
    }

    if (!stored) return null;
    const baseRecord = toUserAccountRecord(stored as unknown as Record<string, unknown>);

    // Hydrate latest role/KYC/suspension fields from users collection
    try {
      const freshDoc = await this.client.getDocument<Record<string, unknown>>(
        USERS_COLLECTION,
        baseRecord.id
      );
      if (freshDoc) {
        const merged = toUserAccountRecord({ ...baseRecord, ...freshDoc });
        if (merged.isSuspended) {
          this.client.clearAuthSession();
          return null;
        }
        return merged;
      }
    } catch {
      // Keep stored session snapshot on transient read issues
    }

    return baseRecord;
  }

  async findAll(): Promise<UserAccountRecord[]> {
    const docs = await this.client.queryCollection<Record<string, unknown>>(USERS_COLLECTION);
    return docs.map((d) => toUserAccountRecord(d));
  }

  async updateRole(userId: string, role: AdminRole): Promise<void> {
    const cleanId = String(userId || '').trim();
    if (!cleanId) {
      throw new NeonAuthError('auth/invalid-user-id', 'User ID is required.', 400);
    }
    if (!VALID_ADMIN_ROLES.has(role)) {
      throw new NeonAuthError('auth/invalid-role', `Unsupported role: "${role}".`, 400);
    }

    try {
      await this.client.callAdmin('update-user-role', { userId: cleanId, role });
      await this.syncUpdatedUserIfCurrent(cleanId, { role });
      return;
    } catch (err) {
      if (err instanceof NeonApiError && err.status !== 503 && err.status !== 404) {
        throw err;
      }
    }

    await this.client.updateDocument(USERS_COLLECTION, cleanId, { role });
    await this.syncUpdatedUserIfCurrent(cleanId, { role });
  }

  async setSuspended(userId: string, suspended: boolean): Promise<void> {
    const cleanId = String(userId || '').trim();
    if (!cleanId) {
      throw new NeonAuthError('auth/invalid-user-id', 'User ID is required.', 400);
    }
    const isSuspended = Boolean(suspended);

    try {
      await this.client.callAdmin('suspend-user', {
        userId: cleanId,
        suspended: isSuspended,
        isSuspended,
      });
      await this.syncUpdatedUserIfCurrent(cleanId, { isSuspended });
      return;
    } catch (err) {
      if (err instanceof NeonApiError && err.status !== 503 && err.status !== 404) {
        throw err;
      }
    }

    await this.client.updateDocument(USERS_COLLECTION, cleanId, { isSuspended });
    await this.syncUpdatedUserIfCurrent(cleanId, { isSuspended });
  }

  async updateKycStatus(userId: string, status: UserAccountRecord['kycStatus']): Promise<void> {
    const cleanId = String(userId || '').trim();
    if (!cleanId) {
      throw new NeonAuthError('auth/invalid-user-id', 'User ID is required.', 400);
    }
    if (!status || !VALID_KYC_STATUSES.has(status)) {
      throw new NeonAuthError('auth/invalid-kyc-status', `Invalid KYC status: "${status}".`, 400);
    }

    try {
      await this.client.callAdmin('update-kyc', { userId: cleanId, kycStatus: status });
      await this.syncUpdatedUserIfCurrent(cleanId, { kycStatus: status });
      return;
    } catch (err) {
      if (err instanceof NeonApiError && err.status !== 503 && err.status !== 404) {
        throw err;
      }
    }

    await this.client.updateDocument(USERS_COLLECTION, cleanId, { kycStatus: status });
    await this.syncUpdatedUserIfCurrent(cleanId, { kycStatus: status });
  }

  async deleteUser(userIds: string[]): Promise<void> {
    const cleanIds = Array.isArray(userIds)
      ? userIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (cleanIds.length === 0) return;

    try {
      await this.client.callAdmin('delete-user', { userIds: cleanIds });
    } catch (err) {
      if (err instanceof NeonApiError && err.status !== 503 && err.status !== 404) {
        throw err;
      }
      await Promise.all(cleanIds.map((id) => this.client.deleteDocument(USERS_COLLECTION, id)));
    }

    // Remove local credentials entries for any deleted accounts
    const creds = readLocalCredentials();
    let credsChanged = false;
    for (const [emailKey, entry] of Object.entries(creds)) {
      if (cleanIds.includes(entry.uid)) {
        delete creds[emailKey];
        credsChanged = true;
      }
    }
    if (credsChanged) {
      writeLocalCredentials(creds);
    }

    const current = this.client.getStoredUser();
    if (current && cleanIds.includes(current.id)) {
      this.client.clearAuthSession();
    }
  }

  private async syncUpdatedUserIfCurrent(
    userId: string,
    patch: Partial<UserAccountRecord>
  ): Promise<void> {
    const current = this.client.getStoredUser();
    const token = this.client.getAuthToken();
    if (!current || current.id !== userId) return;

    if (patch.isSuspended) {
      this.client.clearAuthSession();
      return;
    }

    const updatedRecord = toUserAccountRecord({
      ...(current as unknown as Record<string, unknown>),
      ...patch,
    });
    this.client.setAuthSession(token, toStoredUser(updatedRecord));
  }
}

export const neonAuthRepository = new NeonAuthRepository(neonClient);
