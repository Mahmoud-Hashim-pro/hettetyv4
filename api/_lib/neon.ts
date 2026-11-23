/**
 * HETTETY v4 — Neon Serverless PostgreSQL Client, Schema Bootstrap,
 * Distributed Rate Limiting & Immutable Audit Logging
 */

import crypto from 'crypto';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { AdminRole, AuditLogEntry, SystemSettings } from '../../src/core/domain/entities.js';

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  maintenanceMode: false,
  allowPublicRegistration: true,
  requireAdminApprovalForListings: true,
  enable3DReconstructionPipeline: true,
  enableAiAdvisor: true,
  defaultCurrency: 'EGP',
  storageProvider: 'neon_storage',
  maxUploadImagesPerProperty: 40,
  seoSiteTitle: 'HETTETY | حتتي — Luxury Real Estate & 3D Spatial Discovery in Egypt',
  seoDefaultDescription:
    'Verified luxury properties, compounds, coastal residences, and interactive 3D digital twins across Egypt.',
};

/** Resolves the configured Neon PostgreSQL connection string if valid. */
export function getNeonDatabaseUrl(): string | null {
  const raw = (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL ||
    ''
  ).trim();
  if (!raw || raw.startsWith('mock://')) return null;
  if (!raw.startsWith('postgres://') && !raw.startsWith('postgresql://')) return null;
  return raw;
}

/** True when a valid Neon Postgres connection string is available. */
export function isNeonConfigured(): boolean {
  return Boolean(getNeonDatabaseUrl());
}

let cachedUrl: string | null = null;
let cachedSql: NeonQueryFunction<false, false> | null = null;
let schemaReadyUrl: string | null = null;
let schemaInitPromise: Promise<void> | null = null;

/** Returns a cached Neon serverless SQL client bound to DATABASE_URL. */
export function getNeonSql(): NeonQueryFunction<false, false> {
  const url = getNeonDatabaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL is not configured for Neon PostgreSQL.');
  }
  if (!cachedSql || cachedUrl !== url) {
    cachedSql = neon(url);
    cachedUrl = url;
    schemaReadyUrl = null;
    schemaInitPromise = null;
  }
  return cachedSql;
}

const BOOTSTRAP_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    name TEXT,
    phone TEXT,
    role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('super_admin','admin','operations','broker','technician','seller','buyer','user')),
    kyc_status TEXT NOT NULL DEFAULT 'unverified',
    is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    avatar_url TEXT,
    preferences TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS properties (
    id TEXT PRIMARY KEY,
    author_uid TEXT,
    title TEXT NOT NULL,
    description TEXT,
    price DOUBLE PRECISION NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EGP',
    location TEXT NOT NULL,
    compound TEXT,
    developer TEXT,
    property_type TEXT,
    bedrooms INT NOT NULL DEFAULT 0,
    bathrooms INT NOT NULL DEFAULT 0,
    area DOUBLE PRECISION NOT NULL DEFAULT 0,
    area_to DOUBLE PRECISION,
    garden_area DOUBLE PRECISION,
    roof_area DOUBLE PRECISION,
    floor TEXT,
    finishing TEXT,
    view_desc TEXT,
    furnished BOOLEAN NOT NULL DEFAULT FALSE,
    delivery_date TEXT,
    delivery_timeline TEXT,
    status TEXT NOT NULL DEFAULT 'For Sale',
    availability TEXT NOT NULL DEFAULT 'Available',
    listing_state TEXT NOT NULL DEFAULT 'Live',
    lifecycle_status TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_status TEXT NOT NULL DEFAULT 'Pending',
    verified_by TEXT,
    verified_at TIMESTAMPTZ,
    review_note TEXT,
    rejected_at TIMESTAMPTZ,
    image_url TEXT,
    images JSONB NOT NULL DEFAULT '[]'::jsonb,
    panoramas JSONB NOT NULL DEFAULT '[]'::jsonb,
    floor_plan_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    depth_maps JSONB NOT NULL DEFAULT '[]'::jsonb,
    video_url TEXT,
    digital_twin_url TEXT,
    three_d_tour JSONB,
    payment_plans JSONB NOT NULL DEFAULT '[]'::jsonb,
    payment_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
    amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
    trust_matrix JSONB,
    granular_verification JSONB,
    registration_number TEXT,
    court_signature_validity BOOLEAN NOT NULL DEFAULT FALSE,
    is_resale BOOLEAN NOT NULL DEFAULT FALSE,
    yalla_sahel BOOLEAN NOT NULL DEFAULT FALSE,
    village TEXT,
    contact_phone TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    unit_code TEXT,
    unit_model TEXT,
    building_type TEXT,
    floors_description TEXT,
    maintenance_fee DOUBLE PRECISION,
    phase TEXT,
    project_area_feddan DOUBLE PRECISION,
    green_space_percent DOUBLE PRECISION,
    financing JSONB NOT NULL DEFAULT '[]'::jsonb,
    master_plan_url TEXT,
    legal_docs JSONB NOT NULL DEFAULT '[]'::jsonb,
    publish_date TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
    owner_uid TEXT,
    asset_type TEXT,
    storage_provider TEXT NOT NULL DEFAULT 'cloudflare_r2',
    storage_key TEXT,
    public_url TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    sha256 TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS reconstruction_jobs (
    id TEXT PRIMARY KEY,
    property_id TEXT,
    owner_id TEXT,
    job_type TEXT,
    status TEXT,
    attempt_id TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    progress INT NOT NULL DEFAULT 0,
    stage TEXT,
    worker_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    property_id TEXT,
    property_title TEXT,
    buyer_id TEXT,
    seller_id TEXT,
    agent_id TEXT,
    agreed_price DOUBLE PRECISION,
    currency TEXT NOT NULL DEFAULT 'EGP',
    deposit_amount DOUBLE PRECISION,
    status TEXT,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    property_id TEXT,
    user_id TEXT,
    status TEXT NOT NULL DEFAULT 'processing',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS user_documents (
    id TEXT PRIMARY KEY,
    owner_uid TEXT,
    name TEXT NOT NULL,
    type TEXT,
    review_status TEXT NOT NULL DEFAULT 'Uploaded',
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    storage_path TEXT,
    content TEXT,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    upload_date TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS crm_leads (
    id TEXT PRIMARY KEY,
    property_id TEXT,
    buyer_id TEXT,
    buyer_name TEXT,
    buyer_phone TEXT,
    agent_id TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS viewing_appointments (
    id TEXT PRIMARY KEY,
    property_id TEXT,
    buyer_id TEXT,
    agent_id TEXT,
    visit_type TEXT NOT NULL DEFAULT 'in_person',
    scheduled_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'scheduled',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT,
    message TEXT,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    date TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL,
    user_id TEXT,
    rating INT,
    comment TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    property_id TEXT,
    reporter_id TEXT,
    reason TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS alert_subscriptions (
    id TEXT PRIMARY KEY,
    email TEXT,
    user_id TEXT,
    criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS contact_messages (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    message TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    actor_email TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    summary TEXT,
    before_state JSONB,
    after_state JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    timestamps BIGINT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS system_settings (
    setting_key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

/**
 * Idempotent lightweight DDL bootstrap executed once per serverless cold start.
 * Safe to invoke concurrently; resets on failure so transient outages recover cleanly.
 */
export async function ensureNeonSchema(): Promise<void> {
  const url = getNeonDatabaseUrl();
  if (!url) return;
  if (schemaReadyUrl === url) return;

  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      const sql = getNeonSql();
      try {
        await sql.transaction((txn) => BOOTSTRAP_STATEMENTS.map((stmt) => txn.query(stmt)));
        schemaReadyUrl = url;
      } catch (err) {
        schemaInitPromise = null;
        throw err;
      }
    })();
  }

  await schemaInitPromise;
}

export interface NeonHealthProbe {
  healthy: boolean;
  latencyMs: number;
  configured: boolean;
  error?: string;
}

/** Probes live Neon PostgreSQL reachability and query latency. */
export async function probeNeonHealth(): Promise<NeonHealthProbe> {
  if (!isNeonConfigured()) {
    return { healthy: false, latencyMs: 0, configured: false };
  }
  const start = Date.now();
  try {
    const sql = getNeonSql();
    await sql`SELECT 1 AS ok`;
    return {
      healthy: true,
      latencyMs: Math.max(1, Date.now() - start),
      configured: true,
    };
  } catch (err: any) {
    return {
      healthy: false,
      latencyMs: Math.max(1, Date.now() - start),
      configured: true,
      error: err?.message || 'Neon health probe failed',
    };
  }
}

export interface NeonRateLimitOptions {
  ip: string;
  userId?: string;
  task?: string;
  ipLimit: number;
  userLimit: number;
  taskLimit: number;
  windowMs: number;
}

export interface NeonRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  reason?: string;
}

/**
 * Atomic multi-tier distributed sliding-window rate limiter backed by Neon Postgres.
 * Evaluates IP, User, and Task buckets inside a single row-locked PostgreSQL transaction.
 * If ANY tier breaches its limit, ZERO quota is consumed from any other tier.
 */
export async function checkNeonDistributedRateLimit(
  options: NeonRateLimitOptions
): Promise<NeonRateLimitResult> {
  await ensureNeonSchema();
  const sql = getNeonSql();

  const now = Date.now();
  const cutoff = now - options.windowMs;

  const keys: string[] = [`ip:${options.ip}`];
  const limits: number[] = [options.ipLimit];

  if (options.userId) {
    keys.push(`user:${options.userId}`);
    limits.push(options.userLimit);
  }
  if (options.task) {
    keys.push(`task:${options.task}:${options.ip}`);
    limits.push(options.taskLimit);
  }

  const upsertSql = `
    INSERT INTO rate_limit_buckets (bucket_key, timestamps, updated_at)
    SELECT k, ARRAY[]::BIGINT[], NOW()
    FROM UNNEST($1::text[]) AS k
    ON CONFLICT (bucket_key) DO NOTHING
  `;

  const atomicCheckCommitSql = `
    WITH input_tiers AS (
      SELECT idx, key, lim
      FROM UNNEST($1::text[], $2::int[]) WITH ORDINALITY AS t(key, lim, idx)
    ),
    locked_rows AS (
      SELECT b.bucket_key, b.timestamps
      FROM rate_limit_buckets b
      WHERE b.bucket_key = ANY($1::text[])
      ORDER BY b.bucket_key ASC
      FOR UPDATE
    ),
    evaluated AS (
      SELECT
        it.idx,
        it.key AS bucket_key,
        it.lim,
        COALESCE(
          ARRAY(
            SELECT ts
            FROM UNNEST(lr.timestamps) AS ts
            WHERE ts > $3::bigint
            ORDER BY ts ASC
          ),
          ARRAY[]::BIGINT[]
        ) AS valid_ts
      FROM input_tiers it
      JOIN locked_rows lr ON lr.bucket_key = it.key
    ),
    breach AS (
      SELECT idx, bucket_key, valid_ts[1] AS oldest_ts
      FROM evaluated
      WHERE COALESCE(array_length(valid_ts, 1), 0) >= lim
      ORDER BY idx ASC
      LIMIT 1
    ),
    updated AS (
      UPDATE rate_limit_buckets b
      SET timestamps = e.valid_ts || $4::bigint,
          updated_at = NOW()
      FROM evaluated e
      WHERE b.bucket_key = e.bucket_key
        AND NOT EXISTS (SELECT 1 FROM breach)
      RETURNING b.bucket_key, GREATEST(0, e.lim - (COALESCE(array_length(e.valid_ts, 1), 0) + 1)) AS rem
    )
    SELECT
      NOT EXISTS (SELECT 1 FROM breach) AS allowed,
      (SELECT idx FROM breach LIMIT 1) AS breached_idx,
      (SELECT oldest_ts FROM breach LIMIT 1) AS oldest_ts,
      COALESCE((SELECT MIN(rem) FROM updated), 0) AS min_remaining
  `;

  const results = await sql.transaction((txn) => [
    txn.query(upsertSql, [keys]),
    txn.query(atomicCheckCommitSql, [keys, limits, cutoff, now]),
  ]);

  const evalRows = (results[1] || []) as Record<string, any>[];
  const row = evalRows[0];

  if (!row || !row.allowed) {
    const breachedIdx = Number(row?.breached_idx || 1);
    const oldestTs = row?.oldest_ts ? Number(row.oldest_ts) : 0;
    const retryAfterMs = oldestTs
      ? Math.max(1000, oldestTs + options.windowMs - now)
      : options.windowMs;

    let reason = 'Distributed IP rate limit exceeded';
    if (breachedIdx === 2 && options.userId) {
      reason = 'Distributed user account rate limit exceeded';
    } else if (
      (breachedIdx === 3 && options.task) ||
      (breachedIdx === 2 && !options.userId && options.task)
    ) {
      reason = `Distributed task rate limit exceeded: ${options.task}`;
    }

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      reason,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, Number(row.min_remaining ?? 0)),
    retryAfterSeconds: 0,
  };
}

// ----------------------------------------------------------------------------
// Immutable Audit Trail Helper + Shared Non-Production Dev Store
// ----------------------------------------------------------------------------

const MAX_DEV_AUDIT_LOGS = 250;
const inMemoryAuditLogs: AuditLogEntry[] = [];

export interface WriteAuditLogInput {
  actorId: string;
  actorEmail: string;
  actorRole: AdminRole;
  action: string;
  resourceType: AuditLogEntry['resourceType'];
  resourceId: string;
  summary: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}

/** Records an immutable audit entry to Neon `audit_logs` (and dev ring buffer). */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<AuditLogEntry> {
  const entry: AuditLogEntry = {
    id: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    summary: input.summary,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    createdAt: new Date().toISOString(),
  };

  inMemoryAuditLogs.unshift(entry);
  if (inMemoryAuditLogs.length > MAX_DEV_AUDIT_LOGS) {
    inMemoryAuditLogs.length = MAX_DEV_AUDIT_LOGS;
  }

  if (isNeonConfigured()) {
    try {
      await ensureNeonSchema();
      const sql = getNeonSql();
      await sql`
        INSERT INTO audit_logs (
          id, actor_id, actor_email, actor_role, action, resource_type, resource_id,
          summary, before_state, after_state, created_at
        )
        VALUES (
          ${entry.id},
          ${entry.actorId},
          ${entry.actorEmail},
          ${entry.actorRole},
          ${entry.action},
          ${entry.resourceType},
          ${entry.resourceId},
          ${entry.summary},
          ${entry.beforeState ? JSON.stringify(entry.beforeState) : null}::jsonb,
          ${entry.afterState ? JSON.stringify(entry.afterState) : null}::jsonb,
          ${entry.createdAt}::timestamptz
        )
      `;
    } catch (err) {
      console.warn('[NeonAuditLog] Non-fatal audit write failure:', err);
    }
  }

  return entry;
}

export function getInMemoryAuditLogs(): AuditLogEntry[] {
  return [...inMemoryAuditLogs];
}

/**
 * Cohesive in-memory fallback store used ONLY in non-production (local dev / Vitest)
 * when DATABASE_URL is absent. Production ALWAYS fails closed without DATABASE_URL.
 */
export const devMemoryStore = {
  users: new Map<string, Record<string, any>>(),
  sessions: new Map<string, { id: string; userId: string; tokenHash: string; expiresAt: number; revokedAt: number | null }>(),
  properties: new Map<string, Record<string, any>>(),
  user_documents: new Map<string, Record<string, any>>(),
  purchases: new Map<string, Record<string, any>>(),
  chat_sessions: new Map<string, Record<string, any>>(),
  notifications: new Map<string, Record<string, any>>(),
  reviews: new Map<string, Record<string, any>>(),
  reports: new Map<string, Record<string, any>>(),
  alert_subscriptions: new Map<string, Record<string, any>>(),
  contact_messages: new Map<string, Record<string, any>>(),
  crm_leads: new Map<string, Record<string, any>>(),
  viewing_appointments: new Map<string, Record<string, any>>(),
  settings: { ...DEFAULT_SYSTEM_SETTINGS } as SystemSettings,
};
