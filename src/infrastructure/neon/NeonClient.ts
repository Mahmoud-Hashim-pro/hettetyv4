/**
 * HETTETY Clean Architecture — Neon Serverless Postgres Client Adapter
 *
 * Typed HTTP client communicating with HETTETY's serverless API surface:
 *   - /api/db    (document & collection CRUD + atomic batches)
 *   - /api/auth  (Neon Postgres JWT auth)
 *   - /api/admin (privileged admin operations & property reset)
 *   - /api/ai    (server-side AI proxy)
 *
 * Includes a strict, zero-demo-seeding localStorage fallback (`hettety_neon_local_<table>`)
 * when `/api/db` is unreachable or returns 503 (e.g., local preview without `DATABASE_URL`),
 * plus an internal reactive EventBus so UI listeners update immediately on writes.
 */

import type { AdminRole, ResetPropertiesResult } from '../../core/domain/entities';

export const NEON_TOKEN_STORAGE_KEY = 'hettety_neon_token';
export const NEON_USER_STORAGE_KEY = 'hettety_neon_user';
export const NEON_LOCAL_TABLE_PREFIX = 'hettety_neon_local_';
const NEON_LOCAL_FILES_KEY = 'hettety_neon_local_files';

const SAFE_COLLECTION_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const DEFAULT_HTTP_TIMEOUT_MS = 12_000;
const FALLBACK_RETRY_COOLDOWN_MS = 30_000;
const MAX_INLINE_DATA_URL_BYTES = 1_500_000; // 1.5 MB safe cap for localStorage persistence
const MAX_DIRECT_UPLOAD_BYTES = 3_500_000; // Stay under Vercel's ~4.5 MB payload ceiling

export type WhereOp =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'not-in'
  | 'array-contains'
  | 'array-contains-any';

export interface QueryFilter {
  field: string;
  op: WhereOp;
  value: unknown;
}

export type NeonDocument<T = Record<string, unknown>> = T & { id: string };

export interface NeonStoredUser {
  id: string;
  uid: string;
  email: string;
  name: string;
  displayName?: string | null;
  phone?: string;
  role: AdminRole;
  kycStatus?: 'unverified' | 'pending' | 'verified' | 'rejected';
  isSuspended?: boolean;
  avatarUrl?: string;
  photoURL?: string | null;
  preferences?: string;
  favorites?: string[];
  createdAt?: string;
  lastLoginAt?: string;
}

export interface NeonUploadResult {
  path: string;
  url: string;
  size: number;
  contentType: string;
  storageBackend: 'remote_api' | 'local_data_url' | 'local_object_url';
}

export interface NeonBatchOperation {
  type: 'set' | 'update' | 'delete';
  collection: string;
  id: string;
  data?: Record<string, unknown>;
  merge?: boolean;
}

export type CollectionListener<T = Record<string, unknown>> = (docs: NeonDocument<T>[]) => void;
export type NeonAuthListener = (user: NeonStoredUser | null) => void;

export class NeonApiError extends Error {
  status: number;
  code: string;
  transient: boolean;

  constructor(message: string, status: number, code = 'neon/api-error', transient = false) {
    super(message);
    this.name = 'NeonApiError';
    this.status = status;
    this.code = code;
    this.transient = transient;
  }
}

/** In-memory mirror used whenever browser localStorage is unavailable or quota-full. */
const memoryKV = new Map<string, string>();
const memoryObjectUrls = new Map<string, string>();

function hasBrowserStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function safeStorageGet(key: string): string | null {
  if (hasBrowserStorage()) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) return value;
    } catch {
      // Fall through to memoryKV
    }
  }
  return memoryKV.has(key) ? memoryKV.get(key)! : null;
}

function safeStorageSet(key: string, value: string): void {
  memoryKV.set(key, value);
  if (hasBrowserStorage()) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota exceeded or restricted storage; memoryKV retains the state for this session.
    }
  }
}

function safeStorageRemove(key: string): void {
  memoryKV.delete(key);
  if (hasBrowserStorage()) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore restricted storage errors.
    }
  }
}

export function generateDocumentId(prefix = 'doc'): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'doc';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${safePrefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  const rand = Math.random().toString(36).slice(2, 10);
  const rand2 = Math.random().toString(36).slice(2, 8);
  return `${safePrefix}_${Date.now().toString(36)}_${rand}${rand2}`;
}

function assertSafeCollectionName(name: string): string {
  const trimmed = String(name || '').trim();
  if (!SAFE_COLLECTION_REGEX.test(trimmed)) {
    throw new NeonApiError(`Invalid collection name: "${name}"`, 400, 'neon/invalid-collection');
  }
  return trimmed;
}

function assertSafeDocumentId(id: string): string {
  const trimmed = String(id || '').trim();
  if (!trimmed || trimmed.length > 256 || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new NeonApiError(`Invalid document ID: "${id}"`, 400, 'neon/invalid-document-id');
  }
  return trimmed;
}

function sanitizeStoragePath(rawPath: string): string {
  const normalized = String(rawPath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.includes('..') || normalized.length > 512) {
    throw new NeonApiError(`Invalid storage path: "${rawPath}"`, 400, 'storage/invalid-path');
  }
  return normalized;
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== undefined && typeof entry !== 'function') {
      clean[key] = stripUndefinedDeep(entry);
    }
  }
  return clean as T;
}

function getNestedFieldValue(obj: Record<string, unknown>, fieldPath: string): unknown {
  if (!fieldPath.includes('.')) {
    return obj[fieldPath];
  }
  return fieldPath.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, obj);
}

export function matchesFilters(record: Record<string, unknown>, filters?: QueryFilter[]): boolean {
  if (!filters || filters.length === 0) return true;
  for (const f of filters) {
    const fieldVal = getNestedFieldValue(record, f.field);
    switch (f.op) {
      case '==':
        if (fieldVal !== f.value) return false;
        break;
      case '!=':
        if (fieldVal === f.value) return false;
        break;
      case '<':
        if (!(typeof fieldVal === 'number' || typeof fieldVal === 'string') || !(fieldVal < (f.value as any))) {
          return false;
        }
        break;
      case '<=':
        if (!(typeof fieldVal === 'number' || typeof fieldVal === 'string') || !(fieldVal <= (f.value as any))) {
          return false;
        }
        break;
      case '>':
        if (!(typeof fieldVal === 'number' || typeof fieldVal === 'string') || !(fieldVal > (f.value as any))) {
          return false;
        }
        break;
      case '>=':
        if (!(typeof fieldVal === 'number' || typeof fieldVal === 'string') || !(fieldVal >= (f.value as any))) {
          return false;
        }
        break;
      case 'in':
        if (!Array.isArray(f.value) || !f.value.includes(fieldVal)) return false;
        break;
      case 'not-in':
        if (!Array.isArray(f.value) || f.value.includes(fieldVal)) return false;
        break;
      case 'array-contains':
        if (!Array.isArray(fieldVal) || !fieldVal.includes(f.value)) return false;
        break;
      case 'array-contains-any':
        if (!Array.isArray(fieldVal) || !Array.isArray(f.value) || !f.value.some((v) => fieldVal.includes(v))) {
          return false;
        }
        break;
      default:
        return false;
    }
  }
  return true;
}

function toBlob(data: Blob | File | Uint8Array | ArrayBuffer, contentType?: string): Blob {
  if (data instanceof Blob) return data;
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return new Blob([copy.buffer], { type: contentType || 'application/octet-stream' });
  }
  return new Blob([data], { type: contentType || 'application/octet-stream' });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      blob
        .arrayBuffer()
        .then((buf) => {
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
          resolve(`data:${blob.type || 'application/octet-stream'};base64,${b64}`);
        })
        .catch(reject);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to encode file as Data URL'));
    reader.readAsDataURL(blob);
  });
}

function extractDocumentsPayload<T>(payload: unknown): NeonDocument<T>[] {
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeDocRecord<T>(item));
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const list = obj.documents ?? obj.docs ?? obj.data ?? obj.items ?? obj.rows;
    if (Array.isArray(list)) {
      return list.map((item) => normalizeDocRecord<T>(item));
    }
  }
  return [];
}

function normalizeDocRecord<T>(raw: unknown): NeonDocument<T> {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // Support both flattened records `{ id, ...fields }` and Postgres `{ id, data: { ...fields } }` shapes.
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) && typeof obj.id === 'string') {
    const { data, ...rest } = obj;
    return {
      ...(data as Record<string, unknown>),
      ...rest,
      id: obj.id,
    } as NeonDocument<T>;
  }
  return {
    ...obj,
    id: String(obj.id ?? obj.uid ?? ''),
  } as NeonDocument<T>;
}

/** Internal reactive EventBus for immediate collection and auth updates. */
class ReactiveEventBus {
  private readonly collectionSubscribers = new Map<string, Set<() => void>>();
  private readonly authSubscribers = new Set<NeonAuthListener>();

  subscribeCollection(collection: string, handler: () => void): () => void {
    let set = this.collectionSubscribers.get(collection);
    if (!set) {
      set = new Set();
      this.collectionSubscribers.set(collection, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) {
        this.collectionSubscribers.delete(collection);
      }
    };
  }

  emitCollection(collection: string): void {
    const listeners = this.collectionSubscribers.get(collection);
    if (!listeners || listeners.size === 0) return;
    for (const handler of Array.from(listeners)) {
      try {
        handler();
      } catch (err) {
        console.error(`[NeonEventBus] subscriber error for "${collection}":`, err);
      }
    }
  }

  subscribeAuth(listener: NeonAuthListener): () => void {
    this.authSubscribers.add(listener);
    return () => {
      this.authSubscribers.delete(listener);
    };
  }

  emitAuth(user: NeonStoredUser | null): void {
    for (const listener of Array.from(this.authSubscribers)) {
      try {
        listener(user);
      } catch (err) {
        console.error('[NeonEventBus] auth listener error:', err);
      }
    }
  }
}

interface HttpOutcome<T> {
  ok: boolean;
  data?: T;
  status?: number;
  unavailable?: boolean;
  notFound?: boolean;
  reason?: string;
}

export class NeonClient {
  private readonly baseUrl: string;
  private readonly bus = new ReactiveEventBus();
  private lastFallbackTimestamp = 0;
  private backendMode: 'neon_postgres' | 'local_adapter' = 'neon_postgres';
  private directUploadSupported: boolean | null = null;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.attachCrossTabSync();
  }

  private attachCrossTabSync(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('storage', (event) => {
      if (!event.key) return;
      if (event.key === NEON_USER_STORAGE_KEY || event.key === NEON_TOKEN_STORAGE_KEY) {
        this.bus.emitAuth(this.getStoredUser());
      } else if (event.key.startsWith(NEON_LOCAL_TABLE_PREFIX)) {
        const table = event.key.slice(NEON_LOCAL_TABLE_PREFIX.length);
        if (table) this.bus.emitCollection(table);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Auth Token & Session State Management
  // ---------------------------------------------------------------------------

  getAuthToken(): string | null {
    const token = safeStorageGet(NEON_TOKEN_STORAGE_KEY);
    return token && token.trim() ? token.trim() : null;
  }

  getStoredUser(): NeonStoredUser | null {
    const raw = safeStorageGet(NEON_USER_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<NeonStoredUser>;
      if (!parsed || typeof parsed !== 'object' || (!parsed.id && !parsed.uid)) return null;
      const id = String(parsed.id || parsed.uid);
      return {
        ...parsed,
        id,
        uid: String(parsed.uid || id),
        email: String(parsed.email || ''),
        name: String(parsed.name || parsed.displayName || ''),
        displayName: parsed.displayName ?? parsed.name ?? null,
        role: (parsed.role || 'user') as AdminRole,
      };
    } catch {
      return null;
    }
  }

  setAuthSession(token: string | null, user: NeonStoredUser | null): void {
    if (token && token.trim()) {
      safeStorageSet(NEON_TOKEN_STORAGE_KEY, token.trim());
    } else {
      safeStorageRemove(NEON_TOKEN_STORAGE_KEY);
    }

    if (user) {
      const normalized: NeonStoredUser = {
        ...user,
        id: user.id || user.uid,
        uid: user.uid || user.id,
        displayName: user.displayName ?? user.name ?? null,
      };
      safeStorageSet(NEON_USER_STORAGE_KEY, JSON.stringify(normalized));
      this.bus.emitAuth(normalized);
    } else {
      safeStorageRemove(NEON_USER_STORAGE_KEY);
      this.bus.emitAuth(null);
    }
  }

  clearAuthSession(): void {
    safeStorageRemove(NEON_TOKEN_STORAGE_KEY);
    safeStorageRemove(NEON_USER_STORAGE_KEY);
    this.bus.emitAuth(null);
  }

  onAuthChange(listener: NeonAuthListener): () => void {
    return this.bus.subscribeAuth(listener);
  }

  getBackendMode(): 'neon_postgres' | 'local_adapter' {
    return this.backendMode;
  }

  /** Builds standard JSON headers, automatically attaching Authorization Bearer JWT when present. */
  buildHeaders(extra: Record<string, string> = {}, includeAuth = true): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extra,
    };
    if (includeAuth) {
      const token = this.getAuthToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }
    return headers;
  }

  // ---------------------------------------------------------------------------
  // Resilient HTTP Transport Layer
  // ---------------------------------------------------------------------------

  private isInFallbackCooldown(): boolean {
    if (this.lastFallbackTimestamp === 0) return false;
    return Date.now() - this.lastFallbackTimestamp < FALLBACK_RETRY_COOLDOWN_MS;
  }

  private markFallbackActive(): void {
    this.lastFallbackTimestamp = Date.now();
    this.backendMode = 'local_adapter';
  }

  private markRemoteHealthy(): void {
    this.lastFallbackTimestamp = 0;
    this.backendMode = 'neon_postgres';
  }

  async requestJson<T = Record<string, unknown>>(
    path: string,
    init: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
      allowFallbackOnUnavailable?: boolean;
      treatJson404AsNotFound?: boolean;
    } = {}
  ): Promise<HttpOutcome<T>> {
    const {
      method = 'GET',
      body,
      headers = {},
      timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
      allowFallbackOnUnavailable = true,
      treatJson404AsNotFound = false,
    } = init;

    if (typeof fetch !== 'function') {
      this.markFallbackActive();
      return { ok: false, unavailable: true, reason: 'fetch API unavailable in this environment' };
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const url = `${this.baseUrl}${path}`;
      const res = await fetch(url, {
        method,
        headers: this.buildHeaders(headers),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      });

      const contentType = (res.headers?.get?.('content-type') || '').toLowerCase();
      const isJson = contentType.includes('application/json');

      // 502 / 503 / 504 or HTML 404 (Vite SPA fallback when /api/db is not mounted) => graceful fallback
      if (
        res.status === 502 ||
        res.status === 503 ||
        res.status === 504 ||
        (res.status === 404 && !isJson) ||
        (res.ok && !isJson && res.status !== 204)
      ) {
        if (allowFallbackOnUnavailable) {
          this.markFallbackActive();
          return {
            ok: false,
            unavailable: true,
            reason: `API ${path} unavailable (HTTP ${res.status}, content-type: ${contentType || 'none'})`,
          };
        }
        throw new NeonApiError(`Backend service unavailable (${res.status})`, res.status, 'neon/unavailable', true);
      }

      if (res.status === 204) {
        this.markRemoteHealthy();
        return { ok: true, data: {} as T, status: 204 };
      }

      let parsed: any = {};
      if (isJson) {
        parsed = await res.json().catch(() => ({}));
      }

      if (res.status === 404 && treatJson404AsNotFound) {
        this.markRemoteHealthy();
        return { ok: false, unavailable: false, notFound: true };
      }

      if (res.status === 404 && allowFallbackOnUnavailable) {
        const msg = String(parsed?.error || parsed?.message || '').toLowerCase();
        if (!msg || msg.includes('route') || msg.includes('endpoint')) {
          this.markFallbackActive();
          return { ok: false, unavailable: true, reason: `Endpoint ${path} not found` };
        }
      }

      if (!res.ok) {
        // Explicit 500 caused by missing DATABASE_URL should also degrade gracefully in preview
        const errMsg = String(parsed?.error || parsed?.message || `Request failed (${res.status})`);
        const isDbConfigMissing =
          res.status >= 500 &&
          /database_url|neon.*not configured|connection refused|econnrefused|enotfound/i.test(errMsg);
        if (isDbConfigMissing && allowFallbackOnUnavailable) {
          this.markFallbackActive();
          return { ok: false, unavailable: true, reason: errMsg };
        }

        const errCode = String(parsed?.code || (res.status === 401 ? 'auth/unauthorized' : 'neon/api-error'));
        throw new NeonApiError(errMsg, res.status, errCode, res.status === 429 || res.status >= 500);
      }

      this.markRemoteHealthy();
      return { ok: true, data: parsed as T, status: res.status };
    } catch (err: any) {
      if (err instanceof NeonApiError) throw err;
      if (allowFallbackOnUnavailable) {
        this.markFallbackActive();
        return {
          ok: false,
          unavailable: true,
          reason: err?.name === 'AbortError' ? `Request to ${path} timed out` : String(err?.message || err),
        };
      }
      throw new NeonApiError(
        err?.name === 'AbortError' ? 'Request timed out' : String(err?.message || 'Network error'),
        err?.name === 'AbortError' ? 408 : 0,
        err?.name === 'AbortError' ? 'neon/timeout' : 'neon/network-error',
        true
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // Local Fallback Store (`hettety_neon_local_<table>`)
  // IMPORTANT: Starts with EMPTY `properties` (0 demo listings) & preserves `users`.
  // ---------------------------------------------------------------------------

  private localTableKey(collection: string): string {
    return `${NEON_LOCAL_TABLE_PREFIX}${collection}`;
  }

  readLocalCollection<T = Record<string, unknown>>(collection: string): NeonDocument<T>[] {
    const safeName = assertSafeCollectionName(collection);
    const raw = safeStorageGet(this.localTableKey(safeName));
    if (!raw) return []; // Always starts empty — NEVER auto-seeds demo properties!
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => normalizeDocRecord<T>(item));
    } catch {
      return [];
    }
  }

  writeLocalCollection<T = Record<string, unknown>>(collection: string, docs: NeonDocument<T>[]): void {
    const safeName = assertSafeCollectionName(collection);
    safeStorageSet(this.localTableKey(safeName), JSON.stringify(docs));
  }

  private upsertLocalDocument<T = Record<string, unknown>>(
    collection: string,
    id: string,
    data: Record<string, unknown>,
    merge: boolean
  ): NeonDocument<T> {
    const list = this.readLocalCollection<Record<string, unknown>>(collection);
    const idx = list.findIndex((item) => item.id === id);
    const cleanData = stripUndefinedDeep(data);
    const nextRecord: NeonDocument<Record<string, unknown>> =
      idx >= 0 && merge
        ? { ...list[idx], ...cleanData, id }
        : { ...cleanData, id };

    if (idx >= 0) {
      list[idx] = nextRecord;
    } else {
      list.push(nextRecord);
    }
    this.writeLocalCollection(collection, list);
    return nextRecord as NeonDocument<T>;
  }

  private removeLocalDocument(collection: string, id: string): void {
    const list = this.readLocalCollection<Record<string, unknown>>(collection);
    const next = list.filter((item) => item.id !== id);
    if (next.length !== list.length) {
      this.writeLocalCollection(collection, next);
    }
  }

  // ---------------------------------------------------------------------------
  // Collection & Document CRUD
  // ---------------------------------------------------------------------------

  async queryCollection<T = Record<string, unknown>>(
    name: string,
    filters?: QueryFilter[]
  ): Promise<NeonDocument<T>[]> {
    const safeName = assertSafeCollectionName(name);

    if (!this.isInFallbackCooldown()) {
      const params = new URLSearchParams({ table: safeName });
      if (filters && filters.length > 0) {
        for (const f of filters) {
          if (f.op === '==' && f.value !== undefined && f.value !== null && typeof f.value !== 'object') {
            params.set(f.field, String(f.value));
          }
        }
        params.set('filters', JSON.stringify(filters));
      }
      const outcome = await this.requestJson<unknown>(`/api/db?${params.toString()}`, {
        method: 'GET',
        allowFallbackOnUnavailable: true,
      });

      if (outcome.ok) {
        const docs = extractDocumentsPayload<T>(outcome.data);
        // Apply client-side filter guard as well for compound/non-equality operators (e.g. `in`).
        return filters && filters.length > 0
          ? docs.filter((d) => matchesFilters(d as Record<string, unknown>, filters))
          : docs;
      }
    }

    const localDocs = this.readLocalCollection<T>(safeName);
    return filters && filters.length > 0
      ? localDocs.filter((d) => matchesFilters(d as Record<string, unknown>, filters))
      : localDocs;
  }

  async getDocument<T = Record<string, unknown>>(
    name: string,
    id: string
  ): Promise<NeonDocument<T> | null> {
    const safeName = assertSafeCollectionName(name);
    const safeId = assertSafeDocumentId(id);

    if (!this.isInFallbackCooldown()) {
      const params = new URLSearchParams({ table: safeName, id: safeId });
      const outcome = await this.requestJson<Record<string, unknown>>(`/api/db?${params.toString()}`, {
        method: 'GET',
        allowFallbackOnUnavailable: true,
        treatJson404AsNotFound: true,
      });

      if (outcome.ok) {
        const body = outcome.data;
        if (body && body.exists === false) return null;
        const rawDoc = body?.item ?? body?.document ?? body?.doc ?? body?.data ?? (body?.id ? body : null);
        if (!rawDoc || typeof rawDoc !== 'object') return null;
        return normalizeDocRecord<T>({ ...(rawDoc as Record<string, unknown>), id: String((rawDoc as any).id || safeId) });
      }
      if (!outcome.unavailable && outcome.notFound) {
        return null;
      }
    }

    const localDocs = this.readLocalCollection<T>(safeName);
    return localDocs.find((item) => item.id === safeId) ?? null;
  }

  async createDocument<T = Record<string, unknown>>(
    name: string,
    data: Record<string, unknown>
  ): Promise<NeonDocument<T>> {
    const safeName = assertSafeCollectionName(name);
    const cleanData = stripUndefinedDeep(data);
    const candidateId =
      typeof cleanData.id === 'string' && cleanData.id.trim()
        ? assertSafeDocumentId(cleanData.id)
        : generateDocumentId(safeName.slice(0, 6));

    const payloadRecord = {
      ...cleanData,
      id: candidateId,
    };

    if (!this.isInFallbackCooldown()) {
      const outcome = await this.requestJson<Record<string, unknown>>('/api/db', {
        method: 'POST',
        body: {
          table: safeName,
          action: 'create',
          id: candidateId,
          data: payloadRecord,
        },
        allowFallbackOnUnavailable: true,
      });

      if (outcome.ok) {
        const serverDoc =
          outcome.data?.item ?? outcome.data?.document ?? outcome.data?.doc ?? outcome.data?.data ?? outcome.data;
        const resolvedId = String((serverDoc as any)?.id || outcome.data?.id || candidateId);
        const finalDoc = normalizeDocRecord<T>({
          ...payloadRecord,
          ...(serverDoc && typeof serverDoc === 'object' ? (serverDoc as Record<string, unknown>) : {}),
          id: resolvedId,
        });
        this.bus.emitCollection(safeName);
        return finalDoc;
      }
    }

    const saved = this.upsertLocalDocument<T>(safeName, candidateId, payloadRecord, false);
    this.bus.emitCollection(safeName);
    return saved;
  }

  async setDocument<T = Record<string, unknown>>(
    name: string,
    id: string,
    data: Record<string, unknown>,
    merge = false
  ): Promise<NeonDocument<T>> {
    const safeName = assertSafeCollectionName(name);
    const safeId = assertSafeDocumentId(id);
    const cleanData = stripUndefinedDeep({ ...data, id: safeId });

    if (!this.isInFallbackCooldown()) {
      const outcome = await this.requestJson<Record<string, unknown>>('/api/db', {
        method: 'PUT',
        body: {
          table: safeName,
          action: 'update',
          id: safeId,
          data: cleanData,
          merge: Boolean(merge),
        },
        allowFallbackOnUnavailable: true,
        treatJson404AsNotFound: true,
      });

      if (outcome.ok) {
        const serverDoc = outcome.data?.item ?? outcome.data?.document ?? outcome.data?.doc ?? outcome.data?.data;
        const finalDoc = normalizeDocRecord<T>({
          ...cleanData,
          ...(serverDoc && typeof serverDoc === 'object' ? (serverDoc as Record<string, unknown>) : {}),
          id: safeId,
        });
        this.bus.emitCollection(safeName);
        return finalDoc;
      }

      // True upsert semantics: if PUT returned 404 NOT_FOUND on a non-users table, create it via POST
      if (!outcome.unavailable && outcome.notFound && safeName !== 'users') {
        const createOutcome = await this.requestJson<Record<string, unknown>>('/api/db', {
          method: 'POST',
          body: {
            table: safeName,
            action: 'create',
            id: safeId,
            data: cleanData,
          },
          allowFallbackOnUnavailable: true,
        });
        if (createOutcome.ok) {
          const serverDoc =
            createOutcome.data?.item ??
            createOutcome.data?.document ??
            createOutcome.data?.doc ??
            createOutcome.data?.data;
          const finalDoc = normalizeDocRecord<T>({
            ...cleanData,
            ...(serverDoc && typeof serverDoc === 'object' ? (serverDoc as Record<string, unknown>) : {}),
            id: safeId,
          });
          this.bus.emitCollection(safeName);
          return finalDoc;
        }
      }
    }

    const saved = this.upsertLocalDocument<T>(safeName, safeId, cleanData, merge);
    this.bus.emitCollection(safeName);
    return saved;
  }

  async updateDocument(
    name: string,
    id: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    const safeName = assertSafeCollectionName(name);
    const safeId = assertSafeDocumentId(id);
    const cleanPatch = stripUndefinedDeep({ ...patch });
    delete cleanPatch.id;

    if (!this.isInFallbackCooldown()) {
      const outcome = await this.requestJson<Record<string, unknown>>('/api/db', {
        method: 'PATCH',
        body: {
          table: safeName,
          action: 'update',
          id: safeId,
          data: cleanPatch,
          patch: cleanPatch,
        },
        allowFallbackOnUnavailable: true,
      });

      if (outcome.ok) {
        this.bus.emitCollection(safeName);
        return;
      }
    }

    this.upsertLocalDocument(safeName, safeId, cleanPatch, true);
    this.bus.emitCollection(safeName);
  }

  async deleteDocument(name: string, id: string): Promise<void> {
    const safeName = assertSafeCollectionName(name);
    const safeId = assertSafeDocumentId(id);

    if (!this.isInFallbackCooldown()) {
      const params = new URLSearchParams({ table: safeName, id: safeId });
      const outcome = await this.requestJson<Record<string, unknown>>(`/api/db?${params.toString()}`, {
        method: 'DELETE',
        allowFallbackOnUnavailable: true,
        treatJson404AsNotFound: true,
      });

      if (outcome.ok || (!outcome.unavailable && outcome.notFound)) {
        this.bus.emitCollection(safeName);
        return;
      }
    }

    this.removeLocalDocument(safeName, safeId);
    this.bus.emitCollection(safeName);
  }

  async commitBatch(operations: NeonBatchOperation[]): Promise<void> {
    if (!operations || operations.length === 0) return;

    const normalizedOps = operations.map((op) => ({
      ...op,
      collection: assertSafeCollectionName(op.collection),
      id: assertSafeDocumentId(op.id),
      data: op.data ? stripUndefinedDeep(op.data) : undefined,
    }));

    const touchedCollections = new Set(normalizedOps.map((op) => op.collection));

    if (!this.isInFallbackCooldown()) {
      // Execute batch sequentially through `/api/db` so partial validation errors surface cleanly
      for (const op of normalizedOps) {
        if (op.type === 'delete') {
          await this.deleteDocument(op.collection, op.id);
        } else if (op.type === 'update') {
          await this.updateDocument(op.collection, op.id, op.data || {});
        } else {
          await this.setDocument(op.collection, op.id, op.data || {}, Boolean(op.merge));
        }
      }
      return;
    }

    // Atomic in-memory staging before committing to localStorage fallback
    const staged = new Map<string, NeonDocument<Record<string, unknown>>[]>();
    for (const col of touchedCollections) {
      staged.set(col, this.readLocalCollection<Record<string, unknown>>(col));
    }

    for (const op of normalizedOps) {
      const list = staged.get(op.collection)!;
      const idx = list.findIndex((item) => item.id === op.id);
      if (op.type === 'delete') {
        if (idx >= 0) list.splice(idx, 1);
      } else if (op.type === 'update') {
        const cleanPatch = { ...(op.data || {}) };
        delete cleanPatch.id;
        if (idx >= 0) {
          list[idx] = { ...list[idx], ...cleanPatch, id: op.id };
        } else {
          list.push({ ...cleanPatch, id: op.id });
        }
      } else {
        const cleanData = { ...(op.data || {}), id: op.id };
        if (idx >= 0 && op.merge) {
          list[idx] = { ...list[idx], ...cleanData, id: op.id };
        } else if (idx >= 0) {
          list[idx] = cleanData;
        } else {
          list.push(cleanData);
        }
      }
    }

    for (const [col, list] of staged.entries()) {
      this.writeLocalCollection(col, list);
      this.bus.emitCollection(col);
    }
  }

  // ---------------------------------------------------------------------------
  // Reactive Subscriptions
  // ---------------------------------------------------------------------------

  subscribeCollection<T = Record<string, unknown>>(
    name: string,
    filters: QueryFilter[] | undefined,
    callback: CollectionListener<T>,
    onError?: (err: Error) => void
  ): () => void {
    const safeName = assertSafeCollectionName(name);
    let active = true;

    const emitSnapshot = async () => {
      try {
        const docs = await this.queryCollection<T>(safeName, filters);
        if (active) {
          callback(docs);
        }
      } catch (err) {
        if (active && onError) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    // Initial push
    void emitSnapshot();

    // Re-emit immediately whenever a write mutates this collection
    const unsubBus = this.bus.subscribeCollection(safeName, () => {
      if (active) {
        void emitSnapshot();
      }
    });

    return () => {
      active = false;
      unsubBus();
    };
  }

  // ---------------------------------------------------------------------------
  // Storage / File Uploads (Zero Firebase Storage SDK)
  // ---------------------------------------------------------------------------

  private readLocalFilesMap(): Record<string, string> {
    const raw = safeStorageGet(NEON_LOCAL_FILES_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private writeLocalFilesMap(map: Record<string, string>): void {
    safeStorageSet(NEON_LOCAL_FILES_KEY, JSON.stringify(map));
  }

  async uploadFile(
    path: string,
    file: Blob | File | Uint8Array | ArrayBuffer,
    metadata?: { contentType?: string }
  ): Promise<NeonUploadResult> {
    const safePath = sanitizeStoragePath(path);
    const contentType =
      metadata?.contentType ||
      (file instanceof Blob && file.type ? file.type : 'application/octet-stream');
    const blob = toBlob(file, contentType);

    // 1. Attempt Native Neon Object Storage (S3 presigned PUT -> supports unlimited large photos & 3D SPZ/GLB!)
    if (this.directUploadSupported !== false && typeof fetch === 'function') {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 15_000) : null;
        try {
          const presignRes = await fetch(`${this.baseUrl}/api/storage?action=presign-upload`, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify({
              action: 'presign-upload',
              path: safePath,
              contentType,
              sizeBytes: blob.size,
            }),
            signal: controller?.signal,
          });
          const resType = (presignRes.headers?.get?.('content-type') || '').toLowerCase();
          if (presignRes.ok && resType.includes('application/json')) {
            const payload = await presignRes.json().catch(() => ({}));
            if (typeof payload?.uploadUrl === 'string' && payload.uploadUrl.trim()) {
              const putRes = await fetch(payload.uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Type': contentType },
                body: blob,
              });
              if (putRes.ok) {
                const remoteUrl = payload.downloadUrl || payload.url || payload.uploadUrl.split('?')[0];
                this.directUploadSupported = true;
                const map = this.readLocalFilesMap();
                map[safePath] = remoteUrl;
                this.writeLocalFilesMap(map);
                return {
                  path: payload.storagePath || safePath,
                  url: remoteUrl,
                  size: blob.size,
                  contentType,
                  storageBackend: 'remote_api',
                };
              }
            }
          } else if (presignRes.status === 400 || presignRes.status === 404 || presignRes.status === 405 || presignRes.status === 503) {
            this.directUploadSupported = false;
          }
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch {
        this.directUploadSupported = false;
      }
    }

    // Local preview / zero-SDK fallback: inline Data URL for small files, Object URL for larger blobs
    if (blob.size <= MAX_INLINE_DATA_URL_BYTES) {
      const dataUrl = await blobToDataUrl(blob);
      const map = this.readLocalFilesMap();
      map[safePath] = dataUrl;
      this.writeLocalFilesMap(map);
      memoryObjectUrls.set(safePath, dataUrl);
      return {
        path: safePath,
        url: dataUrl,
        size: blob.size,
        contentType,
        storageBackend: 'local_data_url',
      };
    }

    const objectUrl =
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(blob)
        : await blobToDataUrl(blob);

    memoryObjectUrls.set(safePath, objectUrl);
    return {
      path: safePath,
      url: objectUrl,
      size: blob.size,
      contentType,
      storageBackend: 'local_object_url',
    };
  }

  async getFileUrl(path: string): Promise<string> {
    const safePath = sanitizeStoragePath(path);
    const inMem = memoryObjectUrls.get(safePath);
    if (inMem) return inMem;

    const map = this.readLocalFilesMap();
    if (map[safePath]) return map[safePath];

    if (safePath.startsWith('http://') || safePath.startsWith('https://') || safePath.startsWith('data:')) {
      return safePath;
    }

    if (typeof fetch === 'function') {
      try {
        const res = await fetch(`${this.baseUrl}/api/storage?action=presign-download`, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify({ action: 'presign-download', path: safePath }),
        });
        if (res.ok) {
          const payload = await res.json().catch(() => ({}));
          if (typeof payload?.url === 'string' && payload.url.trim()) {
            return payload.url;
          }
        }
      } catch {
        // Fall through to 404
      }
    }

    const err = new NeonApiError(`Storage object not found: ${safePath}`, 404, 'storage/object-not-found');
    throw err;
  }

  async deleteFile(path: string): Promise<void> {
    const safePath = sanitizeStoragePath(path);
    const inMem = memoryObjectUrls.get(safePath);
    if (inMem) {
      if (inMem.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(inMem);
        } catch {
          // Ignore revoke failures
        }
      }
      memoryObjectUrls.delete(safePath);
    }

    const map = this.readLocalFilesMap();
    if (safePath in map) {
      delete map[safePath];
      this.writeLocalFilesMap(map);
    }

    if (this.directUploadSupported === true && typeof fetch === 'function') {
      try {
        await fetch(`${this.baseUrl}/api/storage?action=delete`, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify({ action: 'delete', path: safePath }),
        });
      } catch {
        // Best-effort remote cleanup
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Admin Operations & Property Reset (Preserving All Users)
  // ---------------------------------------------------------------------------

  async callAdmin<T = Record<string, unknown>>(
    action: string,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    const safeAction = String(action || '').trim();
    if (!safeAction || !/^[a-zA-Z0-9_-]{1,64}$/.test(safeAction)) {
      throw new NeonApiError(`Invalid admin action: "${action}"`, 400, 'admin/invalid-action');
    }

    const outcome = await this.requestJson<T>(`/api/admin?action=${encodeURIComponent(safeAction)}`, {
      method: 'POST',
      body: { action: safeAction, ...stripUndefinedDeep(payload) },
      allowFallbackOnUnavailable: true,
    });

    if (outcome.ok) {
      return outcome.data;
    }

    throw new NeonApiError(
      `Admin API action "${safeAction}" is currently unavailable`,
      503,
      'admin/unavailable',
      true
    );
  }

  async resetPropertiesKeepUsers(): Promise<ResetPropertiesResult> {
    if (!this.isInFallbackCooldown()) {
      const outcome = await this.requestJson<Partial<ResetPropertiesResult>>(
        '/api/admin?action=reset-properties-keep-users',
        {
          method: 'POST',
          body: { action: 'reset-properties-keep-users', confirm: true },
          allowFallbackOnUnavailable: true,
        }
      );

      if (outcome.ok && outcome.data) {
        // Keep local mirror clean too so fallback never resurrects cleared listings
        this.writeLocalCollection('properties', []);
        this.bus.emitCollection('properties');
        return {
          success: outcome.data.success !== false,
          deletedProperties: Number(outcome.data.deletedProperties ?? 0),
          preservedUsers: Number(outcome.data.preservedUsers ?? 0),
          timestamp: outcome.data.timestamp || new Date().toISOString(),
          backend: outcome.data.backend || 'neon_postgres',
          message:
            outcome.data.message ||
            'All property listings cleared from Neon Postgres while preserving all user accounts.',
        };
      }
    }

    const existingProperties = this.readLocalCollection('properties');
    const existingUsers = this.readLocalCollection('users');
    const deletedProperties = existingProperties.length;
    const preservedUsers = existingUsers.length;

    // Clear ONLY properties — NEVER touch users!
    this.writeLocalCollection('properties', []);
    this.bus.emitCollection('properties');

    return {
      success: true,
      deletedProperties,
      preservedUsers,
      timestamp: new Date().toISOString(),
      backend: 'local_adapter',
      message: `Cleared ${deletedProperties} property listing(s) while preserving ${preservedUsers} user account(s).`,
    };
  }
}

export const neonClient = new NeonClient();

export function getAuthToken(): string | null {
  return neonClient.getAuthToken();
}
