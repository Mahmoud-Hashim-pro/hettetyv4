/**
 * HETTETY v4 — Enterprise Admin Command Center Control Plane (/api/admin)
 *
 * Strictly RBAC-protected administrative API supporting:
 *   - overview & full dashboard snapshot (with live infrastructure telemetry)
 *   - users RBAC directory, role management, suspension, KYC & deletion
 *   - properties CMS verification, listing state, availability & deletion
 *   - legal documents review workbench (with automatic owner notifications)
 *   - purchases & escrow operations
 *   - moderation reports & inbox management
 *   - live 3D reconstruction worker queue telemetry
 *   - immutable audit logs viewer
 *   - platform system settings
 *   - super_admin-only atomic property reset preserving all user accounts
 */

import crypto from 'crypto';
import type {
  AdminOverviewMetrics,
  AdminRole,
  AdminSnapshotData,
  AuditLogEntry,
  ResetPropertiesResult,
  ServiceHealthItem,
  SystemSettings,
  TransactionRecord,
} from '../src/core/domain/entities.js';
import {
  isNeonConfigured,
  getNeonSql,
  ensureNeonSchema,
  probeNeonHealth,
  writeAuditLog,
  getInMemoryAuditLogs,
  devMemoryStore,
  DEFAULT_SYSTEM_SETTINGS,
} from './_lib/neon.js';
import {
  verifyAuthHeaderAsync,
  isValidRole,
  isSuperAdminEmail,
  getQueryParams,
  getJsonBody,
} from './_lib/auth.js';
import { getActiveRateLimiterBackend } from './_lib/rateLimiter.js';
import { buildAdvisorHealthStatus } from './ai.js';
import { getControlPlaneMetrics, controlPlaneJobs } from './reconstruction.js';
import { mockTransactionsStore } from './transactions.js';
import {
  mapPropertyRowToDomain,
  mapUserRowToDomain,
  mapDocumentRowToDomain,
  mapPurchaseRowToDomain,
  mapReportRowToDomain,
  mapContactRowToDomain,
  mapAlertRowToDomain,
} from './db.js';

function mapAuditRow(row: Record<string, any>): AuditLogEntry {
  return {
    id: String(row.id),
    actorId: String(row.actor_id || ''),
    actorEmail: String(row.actor_email || ''),
    actorRole: (row.actor_role || 'admin') as AdminRole,
    action: String(row.action || ''),
    resourceType: (row.resource_type || 'system') as AuditLogEntry['resourceType'],
    resourceId: String(row.resource_id || ''),
    summary: String(row.summary || ''),
    beforeState: row.before_state ?? null,
    afterState: row.after_state ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

async function createOwnerNotification(userId: string | undefined, title: string, message: string): Promise<void> {
  if (!userId) return;
  const id = `ntf_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const date = new Date().toISOString();
  if (isNeonConfigured()) {
    try {
      await ensureNeonSchema();
      const sql = getNeonSql();
      await sql`
        INSERT INTO notifications (id, user_id, title, message, read, date)
        VALUES (${id}, ${userId}, ${title}, ${message}, FALSE, ${date})
      `;
    } catch (err) {
      console.warn('[api/admin] Non-fatal notification write warning:', err);
    }
  } else {
    devMemoryStore.notifications.set(id, { id, userId, title, message, read: false, date });
  }
}

async function readSystemSettings(): Promise<SystemSettings> {
  if (isNeonConfigured()) {
    await ensureNeonSchema();
    const sql = getNeonSql();
    const rows = (await sql`
      SELECT value, updated_by, updated_at FROM system_settings WHERE setting_key = 'platform_config' LIMIT 1
    `) as Record<string, any>[];
    if (rows[0]?.value && typeof rows[0].value === 'object') {
      return {
        ...DEFAULT_SYSTEM_SETTINGS,
        ...rows[0].value,
        updatedBy: rows[0].updated_by || rows[0].value.updatedBy,
        updatedAt: rows[0].updated_at ? new Date(rows[0].updated_at).toISOString() : rows[0].value.updatedAt,
      };
    }
  }
  return { ...DEFAULT_SYSTEM_SETTINGS, ...devMemoryStore.settings };
}

async function listReconstructionJobs(): Promise<any[]> {
  const merged = new Map<string, any>();
  for (const job of controlPlaneJobs.values()) {
    merged.set(job.id, job);
  }
  if (isNeonConfigured()) {
    try {
      await ensureNeonSchema();
      const sql = getNeonSql();
      const rows = (await sql`
        SELECT * FROM reconstruction_jobs ORDER BY updated_at DESC LIMIT 200
      `) as Record<string, any>[];
      for (const row of rows) {
        const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
        merged.set(String(row.id), {
          ...payload,
          id: String(row.id),
          propertyId: row.property_id ?? payload.propertyId,
          ownerId: row.owner_id ?? payload.ownerId,
          type: row.job_type ?? payload.type ?? 'photos',
          status: row.status ?? payload.status ?? 'QUEUED',
          attemptId: row.attempt_id ?? payload.attemptId,
          retryCount: Number(row.retry_count ?? payload.retryCount ?? 0),
          progress: Number(row.progress ?? payload.progress ?? 0),
          stage: row.stage ?? payload.stage ?? row.status,
          workerId: row.worker_id ?? payload.workerId,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : payload.createdAt,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : payload.updatedAt,
        });
      }
    } catch (err) {
      console.warn('[api/admin] Non-fatal reconstruction_jobs read warning:', err);
    }
  }
  return Array.from(merged.values());
}

async function computeServicesHealth(): Promise<ServiceHealthItem[]> {
  const [neonProbe, advisorHealth] = await Promise.all([
    probeNeonHealth(),
    Promise.resolve(buildAdvisorHealthStatus()),
  ]);
  const cpMetrics = getControlPlaneMetrics();
  const rlBackend = getActiveRateLimiterBackend();

  const hasNeonS3 = Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      (process.env.AWS_ENDPOINT_URL_S3 || process.env.NEON_STORAGE_ENDPOINT || process.env.AWS_REGION)
  );
  const neonBucket = process.env.NEON_STORAGE_BUCKET || 'assets';
  const hasR2 = Boolean(process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID);
  const hasGcs = Boolean(process.env.GCS_BUCKET_NAME || process.env.STORAGE_BUCKET);
  const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const storageProvider = hasNeonS3
    ? `Neon Object Storage (${neonBucket})`
    : hasR2
      ? 'Cloudflare R2'
      : hasGcs
        ? 'Google Cloud Storage'
        : hasBlob
          ? 'Vercel Blob'
          : 'Neon Object Storage (Pending .env Keys)';
  const storageConfigured = hasNeonS3 || hasR2 || hasGcs || hasBlob;

  return [
    {
      id: 'neon_postgres',
      name: 'Neon Serverless Postgres',
      nameAr: 'قاعدة بيانات Neon Postgres',
      status: neonProbe.healthy ? 'healthy' : neonProbe.configured ? 'offline' : 'standby',
      latencyMs: neonProbe.latencyMs || undefined,
      provider: 'Neon Serverless PostgreSQL',
      details: neonProbe.healthy
        ? `Connected (${neonProbe.latencyMs}ms query latency)`
        : neonProbe.configured
          ? `Connection error: ${neonProbe.error || 'unreachable'}`
          : 'DATABASE_URL not configured (running local adapter)',
      detailsAr: neonProbe.healthy
        ? `متصل بنجاح (${neonProbe.latencyMs} مللي ثانية)`
        : neonProbe.configured
          ? 'تعذر الاتصال بقاعدة البيانات'
          : 'متغير DATABASE_URL غير مضبوط (وضع التطوير المحلي)',
    },
    {
      id: 'object_storage',
      name: 'Hybrid 3D & Media Storage',
      nameAr: 'تخزين الوسائط والملفات ثلاثية الأبعاد',
      status: storageConfigured ? 'configured' : 'standby',
      provider: storageProvider,
      details: storageConfigured
        ? `${storageProvider} bucket configured for high-res media & 3D assets`
        : 'Set AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY from Neon Console -> Storage -> .env',
      detailsAr: storageConfigured
        ? `تم إعداد ${storageProvider} لتخزين الصور والنماذج ثلاثية الأبعاد`
        : 'أضف مفاتيح Neon Storage (.env) لتفعيل رفع الصور وملفات 3D مباشرة',
    },
    {
      id: 'ai_advisor',
      name: 'AI Real Estate Advisor',
      nameAr: 'المستشار العقاري الذكي',
      status: advisorHealth.healthy ? 'healthy' : advisorHealth.hasApiKey ? 'degraded' : 'offline',
      latencyMs: advisorHealth.latencyMs,
      provider: `${advisorHealth.provider} (${advisorHealth.model})`,
      details: advisorHealth.diagnostics || 'AI Advisor status checked',
      detailsAr: advisorHealth.healthy
        ? `يعمل بنجاح عبر ${advisorHealth.provider} (${advisorHealth.model})`
        : 'تحقق من مفتاح API أو موزع حدود الطلبات',
    },
    {
      id: 'gpu_3d_workers',
      name: '3D Spatial GPU Workers',
      nameAr: 'محرك المعالجة ثلاثية الأبعاد GPU',
      status: cpMetrics.activeWorkersCount > 0 ? 'healthy' : 'standby',
      provider: 'HETTETY 3DGS Pipeline',
      details:
        cpMetrics.activeWorkersCount > 0
          ? `${cpMetrics.activeWorkersCount} active worker(s), avg queue latency ${cpMetrics.queueLatency.avgSeconds}s`
          : `Standby (0 active heartbeats; ${cpMetrics.totalJobs.queued} queued jobs)`,
      detailsAr:
        cpMetrics.activeWorkersCount > 0
          ? `${cpMetrics.activeWorkersCount} خادم نشط — متوسط الانتظار ${cpMetrics.queueLatency.avgSeconds} ثانية`
          : `في وضع الاستعداد (${cpMetrics.totalJobs.queued} مهمة في قائمة الانتظار)`,
    },
    {
      id: 'rate_limiter',
      name: 'Distributed Rate Limiter',
      nameAr: 'موزع حماية وحدود الطلبات',
      status: rlBackend === 'redis' || rlBackend === 'neon_postgres' ? 'healthy' : process.env.NODE_ENV === 'production' ? 'offline' : 'standby',
      provider:
        rlBackend === 'redis'
          ? 'Redis Lua Atomic'
          : rlBackend === 'neon_postgres'
            ? 'Neon Postgres Buckets'
            : 'In-Memory Dev',
      details: `Active backend: ${rlBackend}`,
      detailsAr:
        rlBackend === 'redis'
          ? 'نشط عبر Redis الموزع'
          : rlBackend === 'neon_postgres'
            ? 'نشط عبر جداول Neon Postgres الذرية'
            : 'ذاكرة محلية (وضع التطوير فقط)',
    },
  ];
}

async function loadFullAdminSnapshot(): Promise<AdminSnapshotData> {
  const [servicesHealth, settings, reconstructionJobs] = await Promise.all([
    computeServicesHealth(),
    readSystemSettings(),
    listReconstructionJobs(),
  ]);

  let users: any[] = [];
  let properties: any[] = [];
  let purchases: any[] = [];
  let transactions: TransactionRecord[] = [];
  let reports: any[] = [];
  let reviewDocs: any[] = [];
  let contactMessages: any[] = [];
  let alertSubscriptions: any[] = [];
  let auditLogs: AuditLogEntry[] = [];

  if (isNeonConfigured()) {
    await ensureNeonSchema();
    const sql = getNeonSql();
    const [uRows, pRows, purRows, txRows, repRows, docRows, msgRows, alertRows, audRows] =
      await Promise.all([
        sql`SELECT * FROM users ORDER BY created_at DESC LIMIT 500`,
        sql`SELECT * FROM properties ORDER BY created_at DESC LIMIT 500`,
        sql`SELECT * FROM purchases ORDER BY created_at DESC LIMIT 300`,
        sql`SELECT payload FROM transactions ORDER BY updated_at DESC LIMIT 300`,
        sql`SELECT * FROM reports ORDER BY created_at DESC LIMIT 300`,
        sql`SELECT * FROM user_documents ORDER BY created_at DESC LIMIT 300`,
        sql`SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 300`,
        sql`SELECT * FROM alert_subscriptions ORDER BY created_at DESC LIMIT 300`,
        sql`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200`,
      ]);

    users = (uRows as Record<string, any>[]).map(mapUserRowToDomain);
    properties = (pRows as Record<string, any>[]).map(mapPropertyRowToDomain);
    purchases = (purRows as Record<string, any>[]).map(mapPurchaseRowToDomain);
    transactions = (txRows as Record<string, any>[]).map((r) => r.payload as TransactionRecord).filter(Boolean);
    reports = (repRows as Record<string, any>[]).map(mapReportRowToDomain);
    reviewDocs = (docRows as Record<string, any>[]).map(mapDocumentRowToDomain);
    contactMessages = (msgRows as Record<string, any>[]).map(mapContactRowToDomain);
    alertSubscriptions = (alertRows as Record<string, any>[]).map(mapAlertRowToDomain);
    auditLogs = (audRows as Record<string, any>[]).map(mapAuditRow);
  } else {
    users = Array.from(devMemoryStore.users.values()).map(mapUserRowToDomain);
    properties = Array.from(devMemoryStore.properties.values());
    purchases = Array.from(devMemoryStore.purchases.values());
    transactions = Array.from(mockTransactionsStore.values());
    reports = Array.from(devMemoryStore.reports.values());
    reviewDocs = Array.from(devMemoryStore.user_documents.values());
    contactMessages = Array.from(devMemoryStore.contact_messages.values());
    alertSubscriptions = Array.from(devMemoryStore.alert_subscriptions.values());
    auditLogs = getInMemoryAuditLogs();
  }

  const activeEscrowTxs = transactions.filter(
    (t) => t.status === 'deposit_pending' || t.status === 'deposit_escrowed'
  );
  const activeEscrowVolumeEGP = activeEscrowTxs.reduce(
    (sum, t) => sum + Number(t.depositAmount || 0),
    0
  );

  const metrics: AdminOverviewMetrics = {
    totalUsers: users.length,
    totalAdmins: users.filter((u) => ['super_admin', 'admin', 'operations'].includes(u.role)).length,
    totalProperties: properties.length,
    liveProperties: properties.filter((p) => (p.listingState || 'Live') === 'Live').length,
    verifiedProperties: properties.filter((p) => p.isVerified || p.verificationStatus === 'Verified').length,
    pendingVerifications: properties.filter((p) => (p.verificationStatus || 'Pending') === 'Pending').length,
    forSaleCount: properties.filter((p) => p.status === 'For Sale').length,
    forRentCount: properties.filter((p) => p.status === 'For Rent').length,
    propertiesWith3D: properties.filter(
      (p) => Boolean(p.threeDTour || p.digitalTwinUrl || (Array.isArray(p.panoramas) && p.panoramas.length > 0))
    ).length,
    openPurchases: purchases.filter((p) => p.status === 'processing').length,
    activeEscrowCount: activeEscrowTxs.length,
    activeEscrowVolumeEGP,
    pendingDocuments: reviewDocs.filter(
      (d) => !d.reviewStatus || d.reviewStatus === 'Uploaded' || d.reviewStatus === 'InReview'
    ).length,
    openReports: reports.length,
    activeReconstructionJobs: reconstructionJobs.filter(
      (j) => !['READY', 'FAILED', 'CANCELLED'].includes(String(j.status || ''))
    ).length,
    servicesHealth,
  };

  return {
    users,
    properties,
    purchases,
    transactions,
    reports,
    reviewDocs,
    contactMessages,
    alertSubscriptions,
    reconstructionJobs,
    auditLogs,
    settings,
    metrics,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader?.('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.NODE_ENV === 'production' && !isNeonConfigured()) {
    return res.status(503).json({
      error: 'DATABASE_NOT_CONFIGURED: Neon DATABASE_URL is required in production.',
    });
  }

  // Strict RBAC Gate: Administrative privileges required for ALL /api/admin endpoints
  const auth = await verifyAuthHeaderAsync(req);
  if (!auth) {
    return res.status(401).json({ error: 'UNAUTHORIZED: Valid admin Bearer token is required.' });
  }
  if (!auth.isAdmin) {
    return res.status(403).json({ error: 'FORBIDDEN: Enterprise Admin privileges required.' });
  }

  const query = getQueryParams(req);
  const body = getJsonBody(req);
  const action = String(query.action || body.action || 'overview').trim();

  try {
    // ------------------------------------------------------------------------
    // 1. OVERVIEW, HEALTH & FULL SNAPSHOT
    // ------------------------------------------------------------------------
    if (action === 'health') {
      const dbHealth = await probeNeonHealth();
      return res.status(200).json({
        success: true,
        connected: dbHealth.configured && dbHealth.healthy,
        configured: dbHealth.configured,
        healthy: dbHealth.healthy,
        latencyMs: dbHealth.latencyMs,
        mode: dbHealth.configured ? 'neon_postgres' : 'dev_memory_store',
        schemaVersion: 'v4.0-neon-postgres',
        checkedAt: new Date().toISOString(),
      });
    }

    if (action === 'overview' || action === 'snapshot') {
      const snapshot = await loadFullAdminSnapshot();
      if (action === 'snapshot') {
        return res.status(200).json({ success: true, ...snapshot });
      }
      return res.status(200).json({
        success: true,
        metrics: snapshot.metrics,
        servicesHealth: snapshot.metrics.servicesHealth,
        ...snapshot.metrics,
      });
    }

    // ------------------------------------------------------------------------
    // 2. USERS & RBAC MANAGEMENT
    // ------------------------------------------------------------------------
    if (action === 'users') {
      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`SELECT * FROM users ORDER BY created_at DESC LIMIT 500`) as Record<string, any>[];
        return res.status(200).json({ success: true, users: rows.map(mapUserRowToDomain) });
      }
      return res.status(200).json({
        success: true,
        users: Array.from(devMemoryStore.users.values()).map(mapUserRowToDomain),
      });
    }

    if (action === 'update-user-role') {
      const userId = String(body.userId || body.id || '').trim();
      const nextRole = body.role;
      if (!userId || !isValidRole(nextRole)) {
        return res.status(400).json({ error: 'INVALID_REQUEST: Valid userId and role are required.' });
      }
      if (nextRole === 'super_admin' && !auth.isSuperAdmin) {
        return res.status(403).json({ error: 'FORBIDDEN: Only super_admin can assign super_admin role.' });
      }

      let target: Record<string, any> | null = null;
      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`SELECT * FROM users WHERE id = ${userId} LIMIT 1`) as Record<string, any>[];
        target = rows[0] || null;
      } else {
        target = devMemoryStore.users.get(userId) || null;
      }

      if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      if (isSuperAdminEmail(target.email) && nextRole !== 'super_admin') {
        return res.status(403).json({ error: 'FORBIDDEN: Platform owner super_admin role cannot be revoked.' });
      }
      if (target.role === 'super_admin' && !auth.isSuperAdmin) {
        return res.status(403).json({ error: 'FORBIDDEN: Only super_admin can modify another super_admin.' });
      }

      const prevRole = target.role;
      if (isNeonConfigured()) {
        const sql = getNeonSql();
        await sql`UPDATE users SET role = ${nextRole} WHERE id = ${userId}`;
      } else {
        target.role = nextRole;
        devMemoryStore.users.set(userId, target);
      }

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'UPDATE_USER_ROLE',
        resourceType: 'user',
        resourceId: userId,
        summary: `Changed role for ${target.email} from ${prevRole} to ${nextRole}.`,
        beforeState: { role: prevRole },
        afterState: { role: nextRole },
      });

      return res.status(200).json({ success: true, userId, role: nextRole });
    }

    if (action === 'suspend-user') {
      const userId = String(body.userId || body.id || '').trim();
      const suspended = Boolean(body.suspended ?? body.isSuspended ?? true);
      if (!userId) return res.status(400).json({ error: 'INVALID_REQUEST: userId is required.' });
      if (userId === auth.uid) {
        return res.status(400).json({ error: 'INVALID_REQUEST: You cannot suspend your own active account.' });
      }

      let target: Record<string, any> | null = null;
      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`SELECT * FROM users WHERE id = ${userId} LIMIT 1`) as Record<string, any>[];
        target = rows[0] || null;
      } else {
        target = devMemoryStore.users.get(userId) || null;
      }

      if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      if ((target.role === 'super_admin' || isSuperAdminEmail(target.email)) && !auth.isSuperAdmin) {
        return res.status(403).json({ error: 'FORBIDDEN: Cannot suspend a super_admin.' });
      }
      if (isSuperAdminEmail(target.email)) {
        return res.status(403).json({ error: 'FORBIDDEN: Platform owner super_admin cannot be suspended.' });
      }

      if (isNeonConfigured()) {
        const sql = getNeonSql();
        await sql`UPDATE users SET is_suspended = ${suspended} WHERE id = ${userId}`;
        if (suspended) {
          await sql`UPDATE sessions SET revoked_at = NOW() WHERE user_id = ${userId} AND revoked_at IS NULL`;
        }
      } else {
        target.is_suspended = suspended;
        devMemoryStore.users.set(userId, target);
        if (suspended) {
          for (const sess of devMemoryStore.sessions.values()) {
            if (sess.userId === userId) sess.revokedAt = Date.now();
          }
        }
      }

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: suspended ? 'SUSPEND_USER' : 'ACTIVATE_USER',
        resourceType: 'user',
        resourceId: userId,
        summary: `${suspended ? 'Suspended' : 'Re-activated'} account ${target.email}.`,
        beforeState: { isSuspended: Boolean(target.is_suspended) },
        afterState: { isSuspended: suspended },
      });

      return res.status(200).json({ success: true, userId, isSuspended: suspended });
    }

    if (action === 'update-kyc') {
      const userId = String(body.userId || body.id || '').trim();
      const kycStatus = String(body.kycStatus || body.status || '').trim();
      if (!userId || !['unverified', 'pending', 'verified', 'rejected'].includes(kycStatus)) {
        return res.status(400).json({ error: 'INVALID_REQUEST: Valid userId and kycStatus required.' });
      }

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE users SET kyc_status = ${kycStatus} WHERE id = ${userId} RETURNING *
        `) as Record<string, any>[];
        if (!rows[0]) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      } else {
        const target = devMemoryStore.users.get(userId);
        if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
        target.kyc_status = kycStatus;
        devMemoryStore.users.set(userId, target);
      }

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'UPDATE_USER_KYC',
        resourceType: 'user',
        resourceId: userId,
        summary: `Updated KYC status for user ${userId} to ${kycStatus}.`,
        afterState: { kycStatus },
      });

      return res.status(200).json({ success: true, userId, kycStatus });
    }

    if (action === 'delete-user') {
      const rawIds: string[] = Array.isArray(body.userIds)
        ? body.userIds.map((x: any) => String(x).trim()).filter(Boolean)
        : [String(body.userId || body.id || '').trim()].filter(Boolean);

      if (rawIds.length === 0) {
        return res.status(400).json({ error: 'INVALID_REQUEST: userId or userIds is required.' });
      }
      if (rawIds.includes(auth.uid)) {
        return res.status(400).json({ error: 'INVALID_REQUEST: Cannot delete your own active account.' });
      }

      let deletedCount = 0;
      for (const uid of rawIds) {
        let target: Record<string, any> | null = null;
        if (isNeonConfigured()) {
          await ensureNeonSchema();
          const sql = getNeonSql();
          const rows = (await sql`SELECT * FROM users WHERE id = ${uid} LIMIT 1`) as Record<string, any>[];
          target = rows[0] || null;
        } else {
          target = devMemoryStore.users.get(uid) || null;
        }
        if (!target) continue;
        if (isSuperAdminEmail(target.email)) {
          return res.status(403).json({ error: 'FORBIDDEN: Platform owner super_admin cannot be deleted.' });
        }
        if (target.role === 'super_admin' && !auth.isSuperAdmin) {
          return res.status(403).json({ error: 'FORBIDDEN: Only super_admin can delete a super_admin.' });
        }

        if (isNeonConfigured()) {
          const sql = getNeonSql();
          await sql`DELETE FROM users WHERE id = ${uid}`;
        } else {
          devMemoryStore.users.delete(uid);
        }
        deletedCount++;
      }

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'DELETE_USER',
        resourceType: 'user',
        resourceId: rawIds.join(','),
        summary: `Deleted ${deletedCount} user account(s).`,
        afterState: { deletedUserIds: rawIds },
      });

      return res.status(200).json({ success: true, deletedCount });
    }

    // ------------------------------------------------------------------------
    // 3. PROPERTIES CMS & VERIFICATION
    // ------------------------------------------------------------------------
    if (action === 'properties') {
      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`SELECT * FROM properties ORDER BY created_at DESC LIMIT 500`) as Record<string, any>[];
        return res.status(200).json({ success: true, properties: rows.map(mapPropertyRowToDomain) });
      }
      return res.status(200).json({
        success: true,
        properties: Array.from(devMemoryStore.properties.values()),
      });
    }

    if (action === 'verify-property') {
      const propertyId = String(body.propertyId || body.id || '').trim();
      const status = String(body.status || body.verificationStatus || '').trim();
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
      if (!propertyId || !['Verified', 'Rejected', 'Pending'].includes(status)) {
        return res.status(400).json({ error: 'INVALID_REQUEST: Valid propertyId and status required.' });
      }

      const isVerified = status === 'Verified';
      const nowIso = new Date().toISOString();
      const rejectedAt = status === 'Rejected' ? nowIso : null;
      let authorUid: string | undefined;
      let propTitle = propertyId;

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE properties
          SET is_verified = ${isVerified},
              verification_status = ${status},
              verified_by = ${auth.email},
              verified_at = ${nowIso}::timestamptz,
              review_note = ${note || null},
              rejected_at = ${rejectedAt}::timestamptz,
              updated_at = NOW()
          WHERE id = ${propertyId}
          RETURNING *
        `) as Record<string, any>[];
        if (!rows[0]) return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
        authorUid = rows[0].author_uid || undefined;
        propTitle = rows[0].title || propertyId;
      } else {
        const existing = devMemoryStore.properties.get(propertyId);
        if (!existing) return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
        existing.isVerified = isVerified;
        existing.verificationStatus = status;
        existing.verifiedBy = auth.email;
        existing.verifiedAt = nowIso;
        existing.reviewNote = note || undefined;
        if (rejectedAt) existing.rejectedAt = rejectedAt;
        devMemoryStore.properties.set(propertyId, existing);
        authorUid = existing.authorUid;
        propTitle = existing.title || propertyId;
      }

      await createOwnerNotification(
        authorUid,
        status === 'Verified'
          ? 'Property Verified / تم توثيق عقارك'
          : status === 'Rejected'
            ? 'Property Review Update / تحديث مراجعة العقار'
            : 'Property Set to Pending Review',
        `${propTitle}: ${status}${note ? ` — ${note}` : ''}`
      );

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'VERIFY_PROPERTY',
        resourceType: 'property',
        resourceId: propertyId,
        summary: `Set verification status of '${propTitle}' to ${status}.`,
        afterState: { verificationStatus: status, isVerified, reviewNote: note },
      });

      return res.status(200).json({ success: true, propertyId, verificationStatus: status, isVerified });
    }

    if (action === 'set-listing-state') {
      const propertyId = String(body.propertyId || body.id || '').trim();
      const state = String(body.state || body.listingState || '').trim();
      if (!propertyId || !['Live', 'Draft', 'Removed'].includes(state)) {
        return res.status(400).json({ error: 'INVALID_REQUEST: Valid propertyId and state (Live|Draft|Removed) required.' });
      }

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE properties SET listing_state = ${state}, updated_at = NOW() WHERE id = ${propertyId} RETURNING id
        `) as Record<string, any>[];
        if (!rows[0]) return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
      } else {
        const existing = devMemoryStore.properties.get(propertyId);
        if (!existing) return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
        existing.listingState = state;
        devMemoryStore.properties.set(propertyId, existing);
      }

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'SET_PROPERTY_LISTING_STATE',
        resourceType: 'property',
        resourceId: propertyId,
        summary: `Set listing_state of property ${propertyId} to ${state}.`,
        afterState: { listingState: state },
      });

      return res.status(200).json({ success: true, propertyId, listingState: state });
    }

    if (action === 'set-availability') {
      const propertyId = String(body.propertyId || body.id || '').trim();
      const availability = String(body.availability || '').trim();
      if (!propertyId || !['Available', 'Sold', 'Reserved'].includes(availability)) {
        return res.status(400).json({ error: 'INVALID_REQUEST: Valid propertyId and availability required.' });
      }

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE properties SET availability = ${availability}, updated_at = NOW() WHERE id = ${propertyId} RETURNING id
        `) as Record<string, any>[];
        if (!rows[0]) return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
      } else {
        const existing = devMemoryStore.properties.get(propertyId);
        if (!existing) return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
        existing.availability = availability;
        devMemoryStore.properties.set(propertyId, existing);
      }

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'SET_PROPERTY_AVAILABILITY',
        resourceType: 'property',
        resourceId: propertyId,
        summary: `Set availability of property ${propertyId} to ${availability}.`,
        afterState: { availability },
      });

      return res.status(200).json({ success: true, propertyId, availability });
    }

    if (action === 'delete-property') {
      const propertyId = String(body.propertyId || body.id || '').trim();
      if (!propertyId) return res.status(400).json({ error: 'INVALID_REQUEST: propertyId is required.' });

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`DELETE FROM properties WHERE id = ${propertyId} RETURNING id, title`) as Record<string, any>[];
        if (!rows[0]) return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
      } else {
        if (!devMemoryStore.properties.has(propertyId)) {
          return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
        }
        devMemoryStore.properties.delete(propertyId);
      }

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'DELETE_PROPERTY',
        resourceType: 'property',
        resourceId: propertyId,
        summary: `Deleted property ${propertyId}.`,
      });

      return res.status(200).json({ success: true, propertyId, deleted: true });
    }

    // ------------------------------------------------------------------------
    // 4. LEGAL DOCUMENTS REVIEW WORKBENCH
    // ------------------------------------------------------------------------
    if (action === 'documents') {
      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`SELECT * FROM user_documents ORDER BY created_at DESC LIMIT 300`) as Record<string, any>[];
        return res.status(200).json({ success: true, documents: rows.map(mapDocumentRowToDomain) });
      }
      return res.status(200).json({
        success: true,
        documents: Array.from(devMemoryStore.user_documents.values()),
      });
    }

    if (action === 'review-document') {
      const documentId = String(body.documentId || body.id || '').trim();
      const reviewStatus = String(body.reviewStatus || body.nextStatus || body.status || '').trim();
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
      if (!documentId || !['Uploaded', 'InReview', 'Checked', 'NeedsAttention'].includes(reviewStatus)) {
        return res.status(400).json({ error: 'INVALID_REQUEST: Valid documentId and reviewStatus required.' });
      }

      const nowIso = new Date().toISOString();
      let ownerUid: string | undefined;
      let docName = documentId;

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE user_documents
          SET review_status = ${reviewStatus},
              reviewed_by = ${auth.email},
              reviewed_at = ${nowIso}::timestamptz,
              review_note = ${note || null}
          WHERE id = ${documentId}
          RETURNING *
        `) as Record<string, any>[];
        if (!rows[0]) return res.status(404).json({ error: 'DOCUMENT_NOT_FOUND' });
        ownerUid = rows[0].owner_uid || undefined;
        docName = rows[0].name || documentId;
      } else {
        const existing = devMemoryStore.user_documents.get(documentId);
        if (!existing) return res.status(404).json({ error: 'DOCUMENT_NOT_FOUND' });
        existing.reviewStatus = reviewStatus;
        existing.reviewedBy = auth.email;
        existing.reviewedAt = nowIso;
        existing.reviewNote = note || undefined;
        devMemoryStore.user_documents.set(documentId, existing);
        ownerUid = existing.ownerUid;
        docName = existing.name || documentId;
      }

      await createOwnerNotification(
        ownerUid,
        'Legal Document Reviewed / مراجعة المستند القانوني',
        `${docName}: ${reviewStatus}${note ? ` — ${note}` : ''}`
      );

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'REVIEW_DOCUMENT',
        resourceType: 'document',
        resourceId: documentId,
        summary: `Marked document '${docName}' as ${reviewStatus}.`,
        afterState: { reviewStatus, reviewNote: note },
      });

      return res.status(200).json({ success: true, documentId, reviewStatus });
    }

    // ------------------------------------------------------------------------
    // 5. PURCHASES & ESCROW DESK
    // ------------------------------------------------------------------------
    if (action === 'purchases') {
      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const [purRows, txRows] = await Promise.all([
          sql`SELECT * FROM purchases ORDER BY created_at DESC LIMIT 300`,
          sql`SELECT payload FROM transactions ORDER BY updated_at DESC LIMIT 300`,
        ]);
        return res.status(200).json({
          success: true,
          purchases: (purRows as Record<string, any>[]).map(mapPurchaseRowToDomain),
          transactions: (txRows as Record<string, any>[]).map((r) => r.payload).filter(Boolean),
        });
      }
      return res.status(200).json({
        success: true,
        purchases: Array.from(devMemoryStore.purchases.values()),
        transactions: Array.from(mockTransactionsStore.values()),
      });
    }

    if (action === 'update-purchase') {
      const purchaseId = String(body.purchaseId || body.id || '').trim();
      const status = String(body.status || '').trim();
      if (!purchaseId || !['completed', 'cancelled', 'processing'].includes(status)) {
        return res.status(400).json({ error: 'INVALID_REQUEST: Valid purchaseId and status required.' });
      }

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE purchases SET status = ${status} WHERE id = ${purchaseId} RETURNING id
        `) as Record<string, any>[];
        if (!rows[0]) return res.status(404).json({ error: 'PURCHASE_NOT_FOUND' });
      } else {
        const existing = devMemoryStore.purchases.get(purchaseId);
        if (!existing) return res.status(404).json({ error: 'PURCHASE_NOT_FOUND' });
        existing.status = status;
        devMemoryStore.purchases.set(purchaseId, existing);
      }

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'UPDATE_PURCHASE_STATUS',
        resourceType: 'purchase',
        resourceId: purchaseId,
        summary: `Updated purchase ${purchaseId} status to ${status}.`,
        afterState: { status },
      });

      return res.status(200).json({ success: true, purchaseId, status });
    }

    // ------------------------------------------------------------------------
    // 6. REPORTS & MODERATION
    // ------------------------------------------------------------------------
    if (action === 'reports') {
      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const [repRows, msgRows, alertRows] = await Promise.all([
          sql`SELECT * FROM reports ORDER BY created_at DESC LIMIT 300`,
          sql`SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 300`,
          sql`SELECT * FROM alert_subscriptions ORDER BY created_at DESC LIMIT 300`,
        ]);
        return res.status(200).json({
          success: true,
          reports: (repRows as Record<string, any>[]).map(mapReportRowToDomain),
          contactMessages: (msgRows as Record<string, any>[]).map(mapContactRowToDomain),
          alertSubscriptions: (alertRows as Record<string, any>[]).map(mapAlertRowToDomain),
        });
      }
      return res.status(200).json({
        success: true,
        reports: Array.from(devMemoryStore.reports.values()),
        contactMessages: Array.from(devMemoryStore.contact_messages.values()),
        alertSubscriptions: Array.from(devMemoryStore.alert_subscriptions.values()),
      });
    }

    if (action === 'delete-report') {
      const reportId = String(body.reportId || body.id || '').trim();
      if (!reportId) return res.status(400).json({ error: 'INVALID_REQUEST: reportId is required.' });

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`DELETE FROM reports WHERE id = ${reportId} RETURNING id`) as Record<string, any>[];
        if (!rows[0]) return res.status(404).json({ error: 'REPORT_NOT_FOUND' });
      } else {
        if (!devMemoryStore.reports.has(reportId)) {
          return res.status(404).json({ error: 'REPORT_NOT_FOUND' });
        }
        devMemoryStore.reports.delete(reportId);
      }

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'DELETE_REPORT',
        resourceType: 'report',
        resourceId: reportId,
        summary: `Resolved and removed abuse report ${reportId}.`,
      });

      return res.status(200).json({ success: true, reportId, deleted: true });
    }

    // ------------------------------------------------------------------------
    // 7. 3D RECONSTRUCTION WORKER OPS
    // ------------------------------------------------------------------------
    if (action === 'reconstruction') {
      const [metrics, jobs] = await Promise.all([
        Promise.resolve(getControlPlaneMetrics()),
        listReconstructionJobs(),
      ]);
      return res.status(200).json({ success: true, metrics, jobs });
    }

    // ------------------------------------------------------------------------
    // 8. IMMUTABLE AUDIT LOGS
    // ------------------------------------------------------------------------
    if (action === 'audit-logs') {
      const limit = Math.min(500, Math.max(1, Number(query.limit || body.limit || 150)));
      const resourceType = String(query.resourceType || body.resourceType || '').trim();

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (resourceType
          ? await sql`
              SELECT * FROM audit_logs
              WHERE resource_type = ${resourceType}
              ORDER BY created_at DESC
              LIMIT ${limit}
            `
          : await sql`
              SELECT * FROM audit_logs
              ORDER BY created_at DESC
              LIMIT ${limit}
            `) as Record<string, any>[];
        return res.status(200).json({ success: true, auditLogs: rows.map(mapAuditRow) });
      }

      let logs = getInMemoryAuditLogs();
      if (resourceType) logs = logs.filter((l) => l.resourceType === resourceType);
      return res.status(200).json({ success: true, auditLogs: logs.slice(0, limit) });
    }

    // ------------------------------------------------------------------------
    // 9. SYSTEM SETTINGS
    // ------------------------------------------------------------------------
    if (action === 'get-settings') {
      const settings = await readSystemSettings();
      return res.status(200).json({ success: true, settings });
    }

    if (action === 'save-settings') {
      const incoming = (body.settings && typeof body.settings === 'object' ? body.settings : body) as Partial<SystemSettings>;
      const current = await readSystemSettings();
      const nowIso = new Date().toISOString();

      const next: SystemSettings = {
        maintenanceMode:
          incoming.maintenanceMode !== undefined ? Boolean(incoming.maintenanceMode) : current.maintenanceMode,
        allowPublicRegistration:
          incoming.allowPublicRegistration !== undefined
            ? Boolean(incoming.allowPublicRegistration)
            : current.allowPublicRegistration,
        requireAdminApprovalForListings:
          incoming.requireAdminApprovalForListings !== undefined
            ? Boolean(incoming.requireAdminApprovalForListings)
            : current.requireAdminApprovalForListings,
        enable3DReconstructionPipeline:
          incoming.enable3DReconstructionPipeline !== undefined
            ? Boolean(incoming.enable3DReconstructionPipeline)
            : current.enable3DReconstructionPipeline,
        enableAiAdvisor:
          incoming.enableAiAdvisor !== undefined ? Boolean(incoming.enableAiAdvisor) : current.enableAiAdvisor,
        defaultCurrency:
          incoming.defaultCurrency === 'USD' || incoming.defaultCurrency === 'EGP'
            ? incoming.defaultCurrency
            : current.defaultCurrency,
        storageProvider:
          incoming.storageProvider &&
          ['cloudflare_r2', 'gcs', 'aws_s3', 'vercel_blob'].includes(incoming.storageProvider)
            ? incoming.storageProvider
            : current.storageProvider,
        maxUploadImagesPerProperty:
          typeof incoming.maxUploadImagesPerProperty === 'number' &&
          Number.isFinite(incoming.maxUploadImagesPerProperty)
            ? Math.min(100, Math.max(1, Math.round(incoming.maxUploadImagesPerProperty)))
            : current.maxUploadImagesPerProperty,
        seoSiteTitle:
          typeof incoming.seoSiteTitle === 'string' && incoming.seoSiteTitle.trim()
            ? incoming.seoSiteTitle.trim().slice(0, 160)
            : current.seoSiteTitle,
        seoDefaultDescription:
          typeof incoming.seoDefaultDescription === 'string' && incoming.seoDefaultDescription.trim()
            ? incoming.seoDefaultDescription.trim().slice(0, 320)
            : current.seoDefaultDescription,
        updatedBy: auth.email,
        updatedAt: nowIso,
      };

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();
        await sql`
          INSERT INTO system_settings (setting_key, value, updated_by, updated_at)
          VALUES ('platform_config', ${JSON.stringify(next)}::jsonb, ${auth.email}, ${nowIso}::timestamptz)
          ON CONFLICT (setting_key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at
        `;
      } else {
        devMemoryStore.settings = next;
      }

      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'UPDATE_SYSTEM_SETTINGS',
        resourceType: 'system',
        resourceId: 'platform_config',
        summary: `Updated platform system settings.`,
        beforeState: current as unknown as Record<string, unknown>,
        afterState: next as unknown as Record<string, unknown>,
      });

      return res.status(200).json({ success: true, settings: next });
    }

    // ------------------------------------------------------------------------
    // 10. DANGER ZONE: RESET PROPERTIES WHILE PRESERVING ALL USERS (SUPER_ADMIN ONLY)
    // ------------------------------------------------------------------------
    if (action === 'reset-properties-keep-users') {
      if (!auth.isSuperAdmin) {
        return res.status(403).json({
          error: 'FORBIDDEN: Only super_admin is authorized to execute reset-properties-keep-users.',
        });
      }
      if (body.confirm === false) {
        return res.status(400).json({ error: 'CONFIRMATION_REQUIRED: Reset cancelled.' });
      }

      const timestamp = new Date().toISOString();

      if (isNeonConfigured()) {
        await ensureNeonSchema();
        const sql = getNeonSql();

        const countRows = (await sql`
          SELECT
            (SELECT COUNT(*)::int FROM properties) AS props_count,
            (SELECT COUNT(*)::int FROM users) AS users_count
        `) as Record<string, any>[];

        const deletedProperties = Number(countRows[0]?.props_count || 0);
        const preservedUsers = Number(countRows[0]?.users_count || 0);
        const auditId = `aud_reset_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const summary = `Super admin ${auth.email} cleared ${deletedProperties} properties while strictly preserving ${preservedUsers} user accounts.`;

        await sql.transaction([
          sql`DELETE FROM media_assets`,
          sql`DELETE FROM reviews`,
          sql`DELETE FROM reports`,
          sql`DELETE FROM viewing_appointments`,
          sql`DELETE FROM crm_leads`,
          sql`DELETE FROM purchases`,
          sql`DELETE FROM transactions`,
          sql`DELETE FROM reconstruction_jobs`,
          sql`DELETE FROM properties`,
          sql`
            INSERT INTO audit_logs (
              id, actor_id, actor_email, actor_role, action, resource_type, resource_id,
              summary, before_state, after_state, created_at
            )
            VALUES (
              ${auditId}, ${auth.uid}, ${auth.email}, ${auth.role},
              'RESET_PROPERTIES_PRESERVE_USERS', 'system', 'properties_catalog',
              ${summary},
              ${JSON.stringify({ properties: deletedProperties, users: preservedUsers })}::jsonb,
              ${JSON.stringify({ properties: 0, usersPreserved: preservedUsers })}::jsonb,
              ${timestamp}::timestamptz
            )
          `,
        ]);

        // Also clear in-memory caches for transactions & control plane jobs
        mockTransactionsStore.clear();
        controlPlaneJobs.clear();

        const result: ResetPropertiesResult = {
          success: true,
          deletedProperties,
          preservedUsers,
          timestamp,
          backend: 'neon_postgres',
          message: summary,
        };
        return res.status(200).json(result);
      }

      // Non-production local dev adapter reset
      const deletedProperties = devMemoryStore.properties.size;
      const preservedUsers = devMemoryStore.users.size;
      devMemoryStore.properties.clear();
      devMemoryStore.reviews.clear();
      devMemoryStore.reports.clear();
      devMemoryStore.viewing_appointments.clear();
      devMemoryStore.crm_leads.clear();
      devMemoryStore.purchases.clear();
      mockTransactionsStore.clear();
      controlPlaneJobs.clear();

      const summary = `Local adapter reset cleared ${deletedProperties} properties while preserving ${preservedUsers} users.`;
      await writeAuditLog({
        actorId: auth.uid,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'RESET_PROPERTIES_PRESERVE_USERS',
        resourceType: 'system',
        resourceId: 'properties_catalog',
        summary,
        beforeState: { properties: deletedProperties, users: preservedUsers },
        afterState: { properties: 0, usersPreserved: preservedUsers },
      });

      const result: ResetPropertiesResult = {
        success: true,
        deletedProperties,
        preservedUsers,
        timestamp,
        backend: 'local_adapter',
        message: summary,
      };
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: `UNKNOWN_ACTION: Unsupported admin action '${action}'.` });
  } catch (err: any) {
    console.error('[api/admin] Error:', err);
    return res.status(500).json({ error: err?.message || 'Admin control plane error.' });
  }
}
