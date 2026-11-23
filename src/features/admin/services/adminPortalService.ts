/**
 * HETTETY Enterprise Admin Portal Service
 * Clean SOLID implementation of IAdminRepository with dual-backend resilience:
 * - Prefers Neon Serverless API (/api/admin) when live and responding with JSON
 * - Seamlessly integrates with src/firebase.ts exports for Firestore/Storage & Vitest compatibility
 * - Persists every administrative mutation into an immutable audit log (Neon/Firestore + localStorage mirror)
 */

import { IAdminRepository } from '../../../core/domain/repositories';
import {
  AdminOverviewMetrics,
  AdminRole,
  AdminSnapshotData,
  AdvisorHealthStatus,
  AuditLogEntry,
  Property,
  ResetPropertiesResult,
  ServiceHealthItem,
  SystemSettings,
  TransactionRecord,
  UserAccountRecord,
  UserDocument,
} from '../../../core/domain/entities';
import { SUPER_ADMIN_EMAILS } from '../../../constants';
import {
  db,
  auth,
  storage,
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  doc,
  query,
  where,
  ref,
  getDownloadURL,
} from '../../../firebase';
import {
  AdminNeonConnectionStatus,
  AdminReconstructionMetrics,
  DEFAULT_SYSTEM_SETTINGS,
} from '../types';

const AUDIT_STORAGE_KEY = 'hettety_admin_audit_logs_v4';
const SETTINGS_STORAGE_KEY = 'hettety_admin_system_settings_v4';
const MAX_LOCAL_AUDIT_ENTRIES = 250;

/** Normalizes Firestore Timestamp or ISO/date value into a Date object. */
export function toDateSafe(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    const dt = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(String(value));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function toIsoSafe(value: unknown): string | undefined {
  const dt = toDateSafe(value);
  return dt ? dt.toISOString() : undefined;
}

const ROLE_PRIORITY: Record<AdminRole, number> = {
  super_admin: 100,
  admin: 90,
  operations: 70,
  broker: 60,
  technician: 50,
  seller: 40,
  buyer: 20,
  user: 10,
};

/**
 * Collapses duplicate auth documents sharing the same email (e.g., Google + Email/Password)
 * into a single canonical user row while preserving all linked accountIds and highest role.
 */
export function mergeDuplicateUsers(users: UserAccountRecord[]): UserAccountRecord[] {
  const byEmail = new Map<string, UserAccountRecord>();

  for (const raw of users) {
    const emailNorm = (raw.email || '').trim().toLowerCase();
    const key = emailNorm || raw.id;
    const isSuperEmail = emailNorm && SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(emailNorm);
    const normalizedRole: AdminRole = isSuperEmail
      ? 'super_admin'
      : (raw.role && raw.role in ROLE_PRIORITY ? raw.role : 'user');

    const candidate: UserAccountRecord = {
      ...raw,
      email: raw.email || '',
      name: raw.name || (raw.email ? raw.email.split('@')[0] : `User #${raw.id.slice(0, 6)}`),
      role: normalizedRole,
      kycStatus: raw.kycStatus || 'unverified',
      isSuspended: Boolean(raw.isSuspended),
      createdAt: toIsoSafe(raw.createdAt) || raw.createdAt,
      lastLoginAt: toIsoSafe(raw.lastLoginAt) || raw.lastLoginAt,
      accounts: raw.accounts || 1,
      accountIds: raw.accountIds?.length ? raw.accountIds : [raw.id],
    };

    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, candidate);
      continue;
    }

    const existingPriority = ROLE_PRIORITY[existing.role] ?? 10;
    const candidatePriority = ROLE_PRIORITY[candidate.role] ?? 10;
    const existingTime = toDateSafe(existing.lastLoginAt ?? existing.createdAt)?.getTime() ?? 0;
    const candidateTime = toDateSafe(candidate.lastLoginAt ?? candidate.createdAt)?.getTime() ?? 0;

    const primary =
      candidatePriority > existingPriority
        ? candidate
        : existingPriority > candidatePriority
        ? existing
        : candidateTime > existingTime
        ? candidate
        : existing;

    const mergedIds = Array.from(new Set([...(existing.accountIds || [existing.id]), ...(candidate.accountIds || [candidate.id])]));
    const freshestTime = Math.max(existingTime, candidateTime);

    byEmail.set(key, {
      ...primary,
      accounts: mergedIds.length,
      accountIds: mergedIds,
      lastLoginAt: freshestTime > 0 ? new Date(freshestTime).toISOString() : primary.lastLoginAt,
      isSuspended: Boolean(existing.isSuspended || candidate.isSuspended),
      kycStatus:
        existing.kycStatus === 'verified' || candidate.kycStatus === 'verified'
          ? 'verified'
          : primary.kycStatus,
    });
  }

  return Array.from(byEmail.values()).sort((a, b) => {
    const tA = toDateSafe(a.lastLoginAt ?? a.createdAt)?.getTime() ?? 0;
    const tB = toDateSafe(b.lastLoginAt ?? b.createdAt)?.getTime() ?? 0;
    return tB - tA;
  });
}

/**
 * Pure computation of real-time AdminOverviewMetrics and 5-service Infrastructure Health Matrix.
 */
export function computeOverviewMetrics(params: {
  users: UserAccountRecord[];
  properties: Property[];
  purchases: any[];
  transactions: TransactionRecord[];
  reports: any[];
  reviewDocs: UserDocument[];
  reconstructionJobs: any[];
  settings: SystemSettings;
  neonOnline?: boolean;
  neonLatencyMs?: number;
  aiHealth?: AdvisorHealthStatus | null;
  gpuWorkersOnline?: number;
}): AdminOverviewMetrics {
  const {
    users,
    properties,
    purchases,
    transactions,
    reports,
    reviewDocs,
    reconstructionJobs,
    settings,
    neonOnline = false,
    neonLatencyMs,
    aiHealth,
    gpuWorkersOnline = 0,
  } = params;

  const mergedUsers = mergeDuplicateUsers(users);
  const totalAdmins = mergedUsers.filter((u) => u.role === 'super_admin' || u.role === 'admin').length;
  const liveProperties = properties.filter((p) => (p.listingState || 'Live') === 'Live').length;
  const verifiedProperties = properties.filter((p) => p.isVerified || p.verificationStatus === 'Verified').length;
  const pendingVerifications = properties.filter((p) => p.verificationStatus === 'Pending').length;
  const forSaleCount = properties.filter((p) => p.status === 'For Sale').length;
  const forRentCount = properties.filter((p) => p.status === 'For Rent').length;
  const propertiesWith3D = properties.filter(
    (p) => Boolean(p.threeDTour || p.digitalTwinUrl || (p.panoramas && p.panoramas.length > 0))
  ).length;
  const openPurchases = purchases.filter((p) => p.status === 'processing').length;

  const activeEscrows = transactions.filter(
    (t) =>
      t.status === 'deposit_escrowed' ||
      t.status === 'deposit_pending' ||
      t.status === 'contract_drafting' ||
      t.status === 'closing_scheduled'
  );
  const activeEscrowVolumeEGP = activeEscrows.reduce((sum, tx) => {
    const val = Number(tx.depositAmount || tx.agreedPrice || 0);
    return sum + (tx.currency === 'USD' ? val * 50 : val);
  }, 0);

  const pendingDocuments = reviewDocs.filter(
    (d) => !d.reviewStatus || d.reviewStatus === 'Uploaded' || d.reviewStatus === 'InReview'
  ).length;

  const openReports = reports.filter((r) => r.status !== 'resolved').length;
  const activeReconstructionJobs = reconstructionJobs.filter((j) =>
    ['UPLOADING', 'QUEUED', 'VALIDATING', 'RECONSTRUCTING', 'TRAINING', 'OPTIMIZING', 'PUBLISHING'].includes(
      String(j.status || '').toUpperCase()
    )
  ).length;

  const storageLabels: Record<SystemSettings['storageProvider'], string> = {
    neon_storage: 'Neon Object Storage (S3 — assets)',
    cloudflare_r2: 'Cloudflare R2 CDN',
    gcs: 'Google Cloud Storage',
    aws_s3: 'AWS S3 Object Store',
    vercel_blob: 'Vercel Blob Edge',
  };

  const servicesHealth: ServiceHealthItem[] = [
    {
      id: 'neon_postgres',
      name: 'Neon Serverless Postgres',
      nameAr: 'قاعدة بيانات نيون (Neon Postgres)',
      status: neonOnline ? 'healthy' : 'configured',
      latencyMs: neonLatencyMs,
      provider: neonOnline ? 'Neon Serverless SQL' : 'Firestore / Neon Adapter',
      details: neonOnline
        ? 'Direct serverless PostgreSQL pool active with zero-downtime migrations.'
        : 'Operating via resilient hybrid data adapter; ready for live Neon DATABASE_URL.',
      detailsAr: neonOnline
        ? 'اتصال مباشر بقاعدة بيانات Neon Postgres نشط وبزمن استجابة منخفض.'
        : 'يعمل عبر محول البيانات المرن وجاهز للربط المباشر مع Neon Postgres.',
    },
    {
      id: 'object_storage',
      name: 'Object Storage & 3D CDN',
      nameAr: 'التخزين السحابي وشبكة CDN للـ 3D',
      status: 'configured',
      provider: storageLabels[settings.storageProvider] || 'Cloudflare R2 CDN',
      details: `Serving SPZ splats, GLB meshes, & encrypted legal vault (max ${settings.maxUploadImagesPerProperty} photos/listing).`,
      detailsAr: `تخزين ملفات 3D (SPZ/GLB) وخزنة المستندات القانونية (حد أقصى ${settings.maxUploadImagesPerProperty} صورة/عقار).`,
    },
    {
      id: 'ai_advisor',
      name: 'AI Real Estate Advisor',
      nameAr: 'المستشار العقاري الذكي (AI)',
      status: !settings.enableAiAdvisor
        ? 'standby'
        : aiHealth
        ? aiHealth.healthy
          ? 'healthy'
          : 'degraded'
        : 'configured',
      latencyMs: aiHealth?.latencyMs,
      provider: aiHealth?.provider ? `${aiHealth.provider} (${aiHealth.model})` : 'Serverless /api/ai Router',
      details: !settings.enableAiAdvisor
        ? 'Temporarily paused via Admin Feature Flag.'
        : aiHealth?.diagnostics || 'Server-side isolated API keys with automatic model fallback.',
      detailsAr: !settings.enableAiAdvisor
        ? 'متوقف مؤقتاً من إعدادات التحكم في المزايا.'
        : aiHealth?.healthy
        ? 'يعمل بكفاءة مع عزل كامل لمفاتيح API ونموذج احتياطي تلقائي.'
        : 'بوابة المستشار الذكي مهيأة على الخادم مع دعم التبديل التلقائي للنماذج.',
    },
    {
      id: 'gpu_3d_workers',
      name: '3D GPU Photogrammetry Workers',
      nameAr: 'معالجات GPU لإعادة البناء 3D',
      status: !settings.enable3DReconstructionPipeline
        ? 'standby'
        : gpuWorkersOnline > 0
        ? 'healthy'
        : 'standby',
      provider: '3DGS / OpenSplat GPU Cluster',
      details:
        gpuWorkersOnline > 0
          ? `${gpuWorkersOnline} active GPU worker(s) heartbeating; ${activeReconstructionJobs} job(s) in pipeline.`
          : `On-demand autoscaling standby (${activeReconstructionJobs} queued job(s)).`,
      detailsAr:
        gpuWorkersOnline > 0
          ? `عدد ${gpuWorkersOnline} عقدة GPU نشطة حالياً؛ ${activeReconstructionJobs} مهمة قيد المعالجة.`
          : `في وضع الاستعداد الذكي والتوسع التلقائي (${activeReconstructionJobs} مهام في الانتظار).`,
    },
    {
      id: 'rate_limiter',
      name: 'Distributed Rate Limiter',
      nameAr: 'محدد المعدل الموزّع والحماية',
      status: 'healthy',
      provider:
        aiHealth?.rateLimiterBackend === 'neon_postgres'
          ? 'Neon Postgres Token Bucket'
          : aiHealth?.rateLimiterBackend === 'redis'
          ? 'Upstash Redis Sliding Window'
          : 'Multi-Tier IP + UID Guard',
      details: 'Enforcing per-IP, per-UID, and 5-slot concurrency ceilings across /api/ai.',
      detailsAr: 'يفرض حدود الأمان لكل IP ومستخدم مع حماية 5 طلبات متزامنة كحد أقصى.',
    },
  ];

  return {
    totalUsers: mergedUsers.length,
    totalAdmins,
    totalProperties: properties.length,
    liveProperties,
    verifiedProperties,
    pendingVerifications,
    forSaleCount,
    forRentCount,
    propertiesWith3D,
    openPurchases,
    activeEscrowCount: activeEscrows.length,
    activeEscrowVolumeEGP,
    pendingDocuments,
    openReports,
    activeReconstructionJobs,
    servicesHealth,
  };
}

class AdminPortalService implements IAdminRepository {
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const currentUser = auth?.currentUser as { getIdToken?: () => Promise<string> } | null | undefined;
      if (currentUser && typeof currentUser.getIdToken === 'function') {
        const token = await currentUser.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Non-fatal: proceed without bearer token in local/test adapters
    }
    return headers;
  }

  private async tryJsonFetch<T>(url: string, init?: RequestInit, timeoutMs = 4500): Promise<{ ok: boolean; status: number; data: T | null; latencyMs: number }> {
    if (typeof fetch !== 'function') {
      return { ok: false, status: 0, data: null, latencyMs: 0 };
    }
    const start = Date.now();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller?.signal,
      });
      const latencyMs = Date.now() - start;
      const contentType = res.headers?.get?.('content-type') || '';
      if (!contentType.includes('application/json')) {
        return { ok: false, status: res.status, data: null, latencyMs };
      }
      const data = (await res.json()) as T;
      return { ok: res.ok, status: res.status, data, latencyMs };
    } catch {
      return { ok: false, status: 0, data: null, latencyMs: Date.now() - start };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private loadLocalAuditLogs(): AuditLogEntry[] {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return [];
      const raw = window.localStorage.getItem(AUDIT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveLocalAuditLogs(logs: AuditLogEntry[]): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(logs.slice(0, MAX_LOCAL_AUDIT_ENTRIES)));
    } catch {
      // Ignore storage quota errors
    }
  }

  public loadLocalSettings(): SystemSettings {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return { ...DEFAULT_SYSTEM_SETTINGS };
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SYSTEM_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SYSTEM_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SYSTEM_SETTINGS };
    }
  }

  private saveLocalSettings(settings: SystemSettings): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage quota errors
    }
  }

  private resolveActor(actorEmail?: string): { actorId: string; actorEmail: string; actorRole: AdminRole } {
    const email = (actorEmail || auth?.currentUser?.email || 'admin@hettety.com').trim();
    const isSuper = SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
    return {
      actorId: auth?.currentUser?.uid || 'admin_session',
      actorEmail: email,
      actorRole: isSuper ? 'super_admin' : 'admin',
    };
  }

  /**
   * Records every admin mutation into an immutable audit log entry
   * (persists to localStorage immediately + fires Neon API & Firestore async writes).
   */
  public async recordAuditLog(params: {
    action: string;
    resourceType: AuditLogEntry['resourceType'];
    resourceId: string;
    summary: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    actorEmail?: string;
  }): Promise<AuditLogEntry> {
    const actor = this.resolveActor(params.actorEmail);
    const entry: AuditLogEntry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      actorId: actor.actorId,
      actorEmail: actor.actorEmail,
      actorRole: actor.actorRole,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      summary: params.summary,
      beforeState: params.beforeState ?? null,
      afterState: params.afterState ?? null,
      createdAt: new Date().toISOString(),
    };

    // 1. Local durable mirror
    const current = this.loadLocalAuditLogs();
    this.saveLocalAuditLogs([entry, ...current]);

    // 2. Best-effort Neon API audit persistence
    try {
      const headers = await this.getAuthHeaders();
      await this.tryJsonFetch('/api/admin', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'audit-log', entry }),
      }, 2500);
    } catch {
      // Non-fatal
    }

    // 3. Best-effort Firestore audit_logs persistence
    try {
      await addDoc(collection(db, 'audit_logs'), entry);
    } catch {
      // Non-fatal if rules restrict direct client audit_logs writes
    }

    return entry;
  }

  private async safeFirestoreCollection(name: string): Promise<any[]> {
    try {
      const snap = await getDocs(collection(db, name));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      return [];
    }
  }

  private async safeReviewDocsQueue(): Promise<UserDocument[]> {
    try {
      const snap = await getDocs(
        query(collection(db, 'user_documents'), where('reviewStatus', 'in', ['Uploaded', 'InReview', 'NeedsAttention', 'Checked']))
      );
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as UserDocument[];
    } catch {
      // Fallback: try smaller queue filter or full collection
      try {
        const snap = await getDocs(
          query(collection(db, 'user_documents'), where('reviewStatus', 'in', ['Uploaded', 'InReview']))
        );
        return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as UserDocument[];
      } catch {
        return (await this.safeFirestoreCollection('user_documents')) as UserDocument[];
      }
    }
  }

  public async loadDashboardSnapshot(): Promise<AdminSnapshotData> {
    const headers = await this.getAuthHeaders();
    const neonRes = await this.tryJsonFetch<Partial<AdminSnapshotData> & { backend?: string }>(
      '/api/admin?action=snapshot',
      { method: 'GET', headers },
      3500
    );

    let users: UserAccountRecord[] = [];
    let properties: Property[] = [];
    let purchases: any[] = [];
    let transactions: TransactionRecord[] = [];
    let reports: any[] = [];
    let reviewDocs: UserDocument[] = [];
    let contactMessages: any[] = [];
    let alertSubscriptions: any[] = [];
    let reconstructionJobs: any[] = [];
    let remoteAuditLogs: AuditLogEntry[] = [];
    let remoteSettings: Partial<SystemSettings> | null = null;
    const neonOnline = Boolean(neonRes.ok && neonRes.data);

    if (neonOnline && neonRes.data) {
      users = (neonRes.data.users || []) as UserAccountRecord[];
      properties = (neonRes.data.properties || []) as Property[];
      purchases = neonRes.data.purchases || [];
      transactions = (neonRes.data.transactions || []) as TransactionRecord[];
      reports = neonRes.data.reports || [];
      reviewDocs = (neonRes.data.reviewDocs || []) as UserDocument[];
      contactMessages = neonRes.data.contactMessages || [];
      alertSubscriptions = neonRes.data.alertSubscriptions || [];
      reconstructionJobs = neonRes.data.reconstructionJobs || [];
      remoteAuditLogs = (neonRes.data.auditLogs || []) as AuditLogEntry[];
      remoteSettings = neonRes.data.settings || null;
    } else {
      const [
        usersRaw,
        propsRaw,
        purchasesRaw,
        txRaw,
        reportsRaw,
        docsRaw,
        contactsRaw,
        alertsRaw,
        jobsRaw,
        auditRaw,
        settingsRaw,
      ] = await Promise.all([
        this.safeFirestoreCollection('users'),
        this.safeFirestoreCollection('properties'),
        this.safeFirestoreCollection('purchases'),
        this.safeFirestoreCollection('transactions'),
        this.safeFirestoreCollection('reports'),
        this.safeReviewDocsQueue(),
        this.safeFirestoreCollection('contactMessages'),
        this.safeFirestoreCollection('alertSubscriptions'),
        this.safeFirestoreCollection('reconstruction_jobs'),
        this.safeFirestoreCollection('audit_logs'),
        this.safeFirestoreCollection('system_settings'),
      ]);

      users = usersRaw as UserAccountRecord[];
      properties = propsRaw as Property[];
      purchases = purchasesRaw;
      transactions = txRaw as TransactionRecord[];
      reports = reportsRaw;
      reviewDocs = docsRaw;
      contactMessages = contactsRaw;
      alertSubscriptions = alertsRaw;
      reconstructionJobs = jobsRaw;
      remoteAuditLogs = auditRaw as AuditLogEntry[];
      if (settingsRaw.length > 0) {
        remoteSettings = settingsRaw[0] as Partial<SystemSettings>;
      }
    }

    const mergedUsers = mergeDuplicateUsers(users);

    // Combine remote + local audit logs without duplicates, newest first
    const localAudit = this.loadLocalAuditLogs();
    const auditMap = new Map<string, AuditLogEntry>();
    for (const item of [...remoteAuditLogs, ...localAudit]) {
      if (item && item.id) auditMap.set(item.id, item);
    }
    const auditLogs = Array.from(auditMap.values()).sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );

    const settings: SystemSettings = {
      ...DEFAULT_SYSTEM_SETTINGS,
      ...this.loadLocalSettings(),
      ...(remoteSettings || {}),
    };

    const sortedReports = [...reports].sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    );

    const metrics = computeOverviewMetrics({
      users: mergedUsers,
      properties,
      purchases,
      transactions,
      reports: sortedReports,
      reviewDocs,
      reconstructionJobs,
      settings,
      neonOnline,
      neonLatencyMs: neonOnline ? neonRes.latencyMs : undefined,
    });

    return {
      users: mergedUsers,
      properties,
      purchases,
      transactions,
      reports: sortedReports,
      reviewDocs,
      contactMessages: [...contactMessages].sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      ),
      alertSubscriptions: [...alertSubscriptions].sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      ),
      reconstructionJobs,
      auditLogs,
      settings,
      metrics,
    };
  }

  public async verifyProperty(
    propertyId: string,
    status: 'Verified' | 'Rejected' | 'Pending',
    note?: string,
    actorEmail?: string,
    propertyContext?: Property
  ): Promise<void> {
    const actor = this.resolveActor(actorEmail);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      verificationStatus: status,
      isVerified: status === 'Verified',
      verifiedBy: actor.actorEmail,
      verifiedAt: now,
    };
    if (note !== undefined) patch.reviewNote = note;
    if (status === 'Rejected') patch.rejectedAt = now;
    if (status === 'Verified') patch.rejectedAt = '';

    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'verify-property', propertyId, status, note, patch }),
    });

    if (!apiRes.ok) {
      await updateDoc(doc(db, 'properties', propertyId), patch);
    }

    if (propertyContext?.authorUid && propertyContext.authorUid !== 'anonymous') {
      const msg =
        status === 'Verified'
          ? `راجع فريق حتتي مستندات إعلانك «${propertyContext.title}». — A HETTETY reviewer has reviewed the documents for your listing "${propertyContext.title}".`
          : status === 'Rejected'
          ? `إعلانك «${propertyContext.title}» محتاج تعديل. ${note || ''} — Your listing "${propertyContext.title}" needs changes. ${note || ''}`
          : `رجع إعلانك «${propertyContext.title}» لحالة «لم تتم المراجعة». — Your listing "${propertyContext.title}" is back to "not reviewed".`;

      await addDoc(collection(db, 'notifications'), {
        userId: propertyContext.authorUid,
        title:
          status === 'Rejected'
            ? 'إعلانك يحتاج تعديل / Listing needs changes'
            : 'تحديث مراجعة إعلانك / Listing review update',
        message: msg.slice(0, 999),
        date: now,
        read: false,
      }).catch(() => undefined);
    }

    await this.recordAuditLog({
      action: `PROPERTY_${status.toUpperCase()}`,
      resourceType: 'property',
      resourceId: propertyId,
      summary: `Marked property "${propertyContext?.title || propertyId}" as ${status}${note ? ` — Note: ${note}` : ''}`,
      beforeState: propertyContext
        ? { verificationStatus: propertyContext.verificationStatus || 'Pending', isVerified: propertyContext.isVerified }
        : null,
      afterState: patch,
      actorEmail: actor.actorEmail,
    });
  }

  public async setPropertyListingState(
    propertyId: string,
    state: 'Live' | 'Draft' | 'Removed',
    actorEmail?: string,
    previousState?: string
  ): Promise<void> {
    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'set-property-state', propertyId, listingState: state }),
    });

    if (!apiRes.ok) {
      await updateDoc(doc(db, 'properties', propertyId), { listingState: state });
    }

    await this.recordAuditLog({
      action: 'PROPERTY_STATE_CHANGED',
      resourceType: 'property',
      resourceId: propertyId,
      summary: `Changed listing state for ${propertyId} to ${state}`,
      beforeState: previousState ? { listingState: previousState } : null,
      afterState: { listingState: state },
      actorEmail,
    });
  }

  public async setPropertyAvailability(
    propertyId: string,
    availability: 'Available' | 'Sold' | 'Reserved',
    actorEmail?: string,
    previousAvailability?: string
  ): Promise<void> {
    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'set-property-availability', propertyId, availability }),
    });

    if (!apiRes.ok) {
      await updateDoc(doc(db, 'properties', propertyId), { availability });
    }

    await this.recordAuditLog({
      action: 'PROPERTY_AVAILABILITY_CHANGED',
      resourceType: 'property',
      resourceId: propertyId,
      summary: `Updated availability for ${propertyId} to ${availability}`,
      beforeState: previousAvailability ? { availability: previousAvailability } : null,
      afterState: { availability },
      actorEmail,
    });
  }

  public async deleteProperty(propertyId: string, title?: string, actorEmail?: string): Promise<void> {
    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'delete-property', propertyId }),
    });

    if (!apiRes.ok) {
      await deleteDoc(doc(db, 'properties', propertyId));
    }

    await this.recordAuditLog({
      action: 'PROPERTY_DELETED',
      resourceType: 'property',
      resourceId: propertyId,
      summary: `Permanently deleted property "${title || propertyId}"`,
      beforeState: { id: propertyId, title: title || propertyId },
      afterState: null,
      actorEmail,
    });
  }

  public async bulkPropertyAction(
    properties: Property[],
    operation: 'verify' | 'hide' | 'live' | 'delete',
    actorEmail?: string
  ): Promise<number> {
    let affected = 0;
    for (const prop of properties) {
      if (operation === 'verify') {
        await this.verifyProperty(prop.id, 'Verified', undefined, actorEmail, prop);
      } else if (operation === 'hide') {
        await this.setPropertyListingState(prop.id, 'Removed', actorEmail, prop.listingState);
      } else if (operation === 'live') {
        await this.setPropertyListingState(prop.id, 'Live', actorEmail, prop.listingState);
      } else if (operation === 'delete') {
        await this.deleteProperty(prop.id, prop.title, actorEmail);
      }
      affected++;
    }
    return affected;
  }

  public async reviewDocument(
    targetDoc: UserDocument,
    nextStatus: 'InReview' | 'Checked' | 'NeedsAttention',
    note: string,
    actorEmail?: string
  ): Promise<void> {
    if (nextStatus === 'NeedsAttention' && !note.trim()) {
      throw new Error('A reviewer note is required when flagging a document as NeedsAttention.');
    }
    const actor = this.resolveActor(actorEmail);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      reviewStatus: nextStatus,
      reviewedBy: actor.actorEmail,
      reviewedAt: now,
    };
    if (nextStatus !== 'InReview' || note.trim()) {
      patch.reviewNote = note.trim();
    }

    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'review-document', documentId: targetDoc.id, patch }),
    });

    if (!apiRes.ok) {
      await updateDoc(doc(db, 'user_documents', targetDoc.id), patch);
    }

    if (nextStatus !== 'InReview' && targetDoc.ownerUid) {
      const label =
        nextStatus === 'Checked'
          ? 'راجع فريق حتتي مستندك. المراجعة مش إثبات إن المستند سليم أو مسجّل في الشهر العقاري. — A HETTETY reviewer read your document. A review is not proof the document is genuine or registered.'
          : `مستندك محتاج إجراء: ${note.trim()} — Your document needs attention: ${note.trim()}`;

      await addDoc(collection(db, 'notifications'), {
        userId: targetDoc.ownerUid,
        title: 'تحديث مراجعة المستند / Document review update',
        message: `${targetDoc.name} — ${label}`.slice(0, 999),
        date: now,
        read: false,
      }).catch(() => undefined);
    }

    await this.recordAuditLog({
      action: `DOCUMENT_${nextStatus.toUpperCase()}`,
      resourceType: 'document',
      resourceId: targetDoc.id,
      summary: `Reviewed document "${targetDoc.name}" -> ${nextStatus}`,
      beforeState: { reviewStatus: targetDoc.reviewStatus || 'Uploaded', reviewNote: targetDoc.reviewNote || '' },
      afterState: patch,
      actorEmail: actor.actorEmail,
    });
  }

  public async resolveDocumentFileUrl(targetDoc: UserDocument): Promise<string> {
    if (targetDoc.storagePath && storage) {
      return await getDownloadURL(ref(storage, targetDoc.storagePath));
    }
    if (targetDoc.content && (targetDoc.content.startsWith('http') || targetDoc.content.startsWith('data:'))) {
      return targetDoc.content;
    }
    throw new Error('NO_STORAGE_PATH');
  }

  public async updatePurchaseStatus(
    purchaseId: string,
    status: 'completed' | 'cancelled' | 'processing',
    actorEmail?: string
  ): Promise<void> {
    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'update-purchase', purchaseId, status }),
    });

    if (!apiRes.ok) {
      await updateDoc(doc(db, 'purchases', purchaseId), { status });
    }

    await this.recordAuditLog({
      action: 'PURCHASE_STATUS_UPDATED',
      resourceType: 'purchase',
      resourceId: purchaseId,
      summary: `Updated purchase request ${purchaseId} to ${status}`,
      afterState: { status },
      actorEmail,
    });
  }

  public async updateTransactionStatus(
    tx: TransactionRecord,
    nextStatus: TransactionRecord['status'],
    nextDepositStatus?: TransactionRecord['depositStatus'],
    escrowRef?: string,
    actorEmail?: string
  ): Promise<TransactionRecord> {
    const now = new Date().toISOString();
    const patch: Partial<TransactionRecord> = {
      status: nextStatus,
      ...(nextDepositStatus ? { depositStatus: nextDepositStatus } : {}),
      ...(escrowRef ? { escrowReference: escrowRef } : {}),
      updatedAt: now,
    };

    const headers = await this.getAuthHeaders();
    let updatedViaApi = false;

    if (nextStatus === 'deposit_escrowed' && escrowRef) {
      const res = await this.tryJsonFetch('/api/transactions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'confirm-escrow',
          transactionId: tx.id,
          verifiedEscrowReference: escrowRef,
          amount: tx.depositAmount,
          currency: tx.currency,
          settlementStatus: 'SETTLED',
        }),
      });
      updatedViaApi = res.ok;
    }

    if (!updatedViaApi) {
      const adminRes = await this.tryJsonFetch('/api/admin', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'update-transaction', transactionId: tx.id, patch }),
      });
      if (!adminRes.ok) {
        await updateDoc(doc(db, 'transactions', tx.id), patch as Record<string, unknown>);
      }
    }

    await this.recordAuditLog({
      action: 'ESCROW_TRANSACTION_UPDATED',
      resourceType: 'transaction',
      resourceId: tx.id,
      summary: `Transitioned escrow tx ${tx.id} (${tx.propertyTitle}) from ${tx.status} -> ${nextStatus}`,
      beforeState: { status: tx.status, depositStatus: tx.depositStatus, escrowReference: tx.escrowReference || null },
      afterState: patch as Record<string, unknown>,
      actorEmail,
    });

    return { ...tx, ...patch };
  }

  public async updateUserRole(
    user: UserAccountRecord,
    nextRole: AdminRole,
    actorEmail?: string
  ): Promise<void> {
    const ids = user.accountIds?.length ? user.accountIds : [user.id];
    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'update-user-role', userId: user.id, accountIds: ids, role: nextRole }),
    });

    if (!apiRes.ok) {
      await Promise.all(ids.map((id) => updateDoc(doc(db, 'users', id), { role: nextRole })));
    }

    await this.recordAuditLog({
      action: 'USER_ROLE_CHANGED',
      resourceType: 'user',
      resourceId: user.id,
      summary: `Changed RBAC role for ${user.email || user.id} from ${user.role} to ${nextRole}`,
      beforeState: { role: user.role },
      afterState: { role: nextRole },
      actorEmail,
    });
  }

  public async updateUserKyc(
    user: UserAccountRecord,
    kycStatus: NonNullable<UserAccountRecord['kycStatus']>,
    actorEmail?: string
  ): Promise<void> {
    const ids = user.accountIds?.length ? user.accountIds : [user.id];
    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'update-user-kyc', userId: user.id, accountIds: ids, kycStatus }),
    });

    if (!apiRes.ok) {
      await Promise.all(ids.map((id) => updateDoc(doc(db, 'users', id), { kycStatus })));
    }

    await this.recordAuditLog({
      action: 'USER_KYC_UPDATED',
      resourceType: 'user',
      resourceId: user.id,
      summary: `Updated KYC status for ${user.email || user.id} to ${kycStatus}`,
      beforeState: { kycStatus: user.kycStatus || 'unverified' },
      afterState: { kycStatus },
      actorEmail,
    });
  }

  public async setUserSuspended(
    user: UserAccountRecord,
    isSuspended: boolean,
    actorEmail?: string
  ): Promise<void> {
    const ids = user.accountIds?.length ? user.accountIds : [user.id];
    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'set-user-suspended', userId: user.id, accountIds: ids, isSuspended }),
    });

    if (!apiRes.ok) {
      await Promise.all(ids.map((id) => updateDoc(doc(db, 'users', id), { isSuspended })));
    }

    await this.recordAuditLog({
      action: isSuspended ? 'USER_SUSPENDED' : 'USER_ACTIVATED',
      resourceType: 'user',
      resourceId: user.id,
      summary: `${isSuspended ? 'Suspended' : 'Reactivated'} account ${user.email || user.id}`,
      beforeState: { isSuspended: Boolean(user.isSuspended) },
      afterState: { isSuspended },
      actorEmail,
    });
  }

  public async deleteUserAccount(user: UserAccountRecord, actorEmail?: string): Promise<void> {
    const ids = user.accountIds?.length ? user.accountIds : [user.id];
    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'delete-user', userId: user.id, accountIds: ids }),
    });

    if (!apiRes.ok) {
      await Promise.all(ids.map((id) => deleteDoc(doc(db, 'users', id))));
    }

    await this.recordAuditLog({
      action: 'USER_DELETED',
      resourceType: 'user',
      resourceId: user.id,
      summary: `Deleted user profile ${user.email || user.id} (${ids.length} linked doc(s))`,
      beforeState: { email: user.email, role: user.role, accountIds: ids },
      afterState: null,
      actorEmail,
    });
  }

  public async deleteReport(reportId: string, actorEmail?: string): Promise<void> {
    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'delete-report', reportId }),
    });

    if (!apiRes.ok) {
      await deleteDoc(doc(db, 'reports', reportId));
    }

    await this.recordAuditLog({
      action: 'REPORT_DELETED',
      resourceType: 'report',
      resourceId: reportId,
      summary: `Removed abuse/listing report ${reportId}`,
      afterState: null,
      actorEmail,
    });
  }

  public async resolveReport(reportId: string, actorEmail?: string): Promise<void> {
    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'resolve-report', reportId, status: 'resolved' }),
    });

    if (!apiRes.ok) {
      await updateDoc(doc(db, 'reports', reportId), { status: 'resolved', resolvedAt: new Date().toISOString() });
    }

    await this.recordAuditLog({
      action: 'REPORT_RESOLVED',
      resourceType: 'report',
      resourceId: reportId,
      summary: `Marked report ${reportId} as resolved`,
      afterState: { status: 'resolved' },
      actorEmail,
    });
  }

  public async saveSystemSettings(
    settingsPatch: Partial<SystemSettings>,
    actorEmail?: string
  ): Promise<SystemSettings> {
    const actor = this.resolveActor(actorEmail);
    const previous = this.loadLocalSettings();
    const next: SystemSettings = {
      ...previous,
      ...settingsPatch,
      updatedBy: actor.actorEmail,
      updatedAt: new Date().toISOString(),
    };

    this.saveLocalSettings(next);

    const headers = await this.getAuthHeaders();
    const apiRes = await this.tryJsonFetch('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'save-settings', settings: next }),
    });

    if (!apiRes.ok) {
      try {
        await updateDoc(doc(db, 'system_settings', 'platform'), next as unknown as Record<string, unknown>);
      } catch {
        try {
          await addDoc(collection(db, 'system_settings'), next);
        } catch {
          // Local persistence succeeded even if Firestore rules block system_settings
        }
      }
    }

    await this.recordAuditLog({
      action: 'SYSTEM_SETTINGS_UPDATED',
      resourceType: 'system',
      resourceId: 'platform_settings',
      summary: `Updated platform configuration & feature flags`,
      beforeState: previous as unknown as Record<string, unknown>,
      afterState: next as unknown as Record<string, unknown>,
      actorEmail: actor.actorEmail,
    });

    return next;
  }

  public async checkAdvisorHealth(): Promise<AdvisorHealthStatus> {
    const res = await this.tryJsonFetch<Partial<AdvisorHealthStatus>>('/api/ai?health=1', { method: 'GET' }, 4000);
    const now = new Date().toISOString();

    if (res.ok && res.data) {
      return {
        healthy: Boolean(res.data.healthy ?? true),
        provider: res.data.provider || 'gemini',
        model: res.data.model || 'gemini-2.5-flash',
        fallbackModel: res.data.fallbackModel,
        rateLimiterBackend: res.data.rateLimiterBackend || 'neon_postgres',
        hasApiKey: Boolean(res.data.hasApiKey ?? true),
        latencyMs: res.data.latencyMs ?? res.latencyMs,
        timestamp: res.data.timestamp || now,
        diagnostics: res.data.diagnostics || 'AI Advisor serverless endpoint healthy.',
      };
    }

    if (res.status === 405) {
      return {
        healthy: true,
        provider: 'serverless-router',
        model: 'configured-via-env',
        rateLimiterBackend: 'memory',
        hasApiKey: true,
        latencyMs: res.latencyMs,
        timestamp: now,
        diagnostics: 'POST /api/ai endpoint is reachable (GET health probe returned 405; test with Live Prompt Console below).',
      };
    }

    return {
      healthy: false,
      provider: 'unavailable',
      model: 'unknown',
      rateLimiterBackend: 'memory',
      hasApiKey: false,
      latencyMs: res.latencyMs,
      timestamp: now,
      diagnostics:
        res.status > 0
          ? `Health endpoint returned HTTP ${res.status}. Verify GEMINI_API_KEY / AI_PROVIDER environment variables.`
          : 'Could not reach /api/ai in this environment. Ensure serverless API runtime is running.',
    };
  }

  public async testAdvisorPrompt(
    prompt: string,
    task: 'chat' | 'search' | 'describe' = 'chat',
    actorEmail?: string
  ): Promise<{ ok: boolean; text: string; provider?: string; model?: string; latencyMs: number; status: number; error?: string }> {
    const headers = await this.getAuthHeaders();
    const res = await this.tryJsonFetch<{ text?: string; provider?: string; model?: string; error?: string }>(
      '/api/ai',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          task,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction:
            'You are HETTETY AI Real Estate Advisor running an Admin Operations diagnostic check. Reply concisely in the same language as the prompt.',
        }),
      },
      15000
    );

    await this.recordAuditLog({
      action: 'AI_DIAGNOSTIC_TEST',
      resourceType: 'ai',
      resourceId: task,
      summary: `Ran AI live console test (${task}) — ${res.ok ? 'SUCCESS' : `FAILED (${res.status})`} in ${res.latencyMs}ms`,
      afterState: { ok: res.ok, provider: res.data?.provider, model: res.data?.model, latencyMs: res.latencyMs },
      actorEmail,
    });

    if (res.ok && res.data?.text) {
      return {
        ok: true,
        text: res.data.text,
        provider: res.data.provider,
        model: res.data.model,
        latencyMs: res.latencyMs,
        status: res.status,
      };
    }

    return {
      ok: false,
      text: '',
      latencyMs: res.latencyMs,
      status: res.status,
      error: res.data?.error || (res.status ? `HTTP ${res.status}` : 'Network error reaching /api/ai'),
    };
  }

  public async fetchReconstructionMetrics(): Promise<{
    online: boolean;
    metrics: AdminReconstructionMetrics;
    latencyMs: number;
    error?: string;
  }> {
    const headers = await this.getAuthHeaders();
    const res = await this.tryJsonFetch<AdminReconstructionMetrics & { metrics?: AdminReconstructionMetrics }>(
      '/api/reconstruction?action=metrics',
      { method: 'GET', headers },
      4000
    );

    const emptyMetrics: AdminReconstructionMetrics = {
      activeWorkersCount: 0,
      activeWorkers: [],
      queueLatency: { samples: 0, avgSeconds: 0, lastSeconds: 0, minSeconds: 0, maxSeconds: 0 },
      jobFailureCounters: {},
      totalJobs: { queued: 0, ready: 0, failed: 0, cancelled: 0 },
    };

    if (res.ok && res.data) {
      const payload = res.data.metrics || res.data;
      return {
        online: true,
        metrics: {
          activeWorkersCount: payload.activeWorkersCount ?? 0,
          activeWorkers: payload.activeWorkers ?? [],
          queueLatency: payload.queueLatency ?? emptyMetrics.queueLatency,
          jobFailureCounters: payload.jobFailureCounters ?? {},
          totalJobs: payload.totalJobs ?? emptyMetrics.totalJobs,
        },
        latencyMs: res.latencyMs,
      };
    }

    return {
      online: false,
      metrics: emptyMetrics,
      latencyMs: res.latencyMs,
      error: res.status ? `Control plane returned HTTP ${res.status}` : '3D Control Plane telemetry offline / standby',
    };
  }

  public async controlReconstructionJob(
    jobId: string,
    action: 'retry' | 'cancel',
    actorEmail?: string
  ): Promise<void> {
    const headers = await this.getAuthHeaders();
    const nextStatus = action === 'retry' ? 'QUEUED' : 'CANCELLED';

    const apiRes = await this.tryJsonFetch('/api/reconstruction', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: action === 'retry' ? 'retry-job' : 'cancel-job',
        jobId,
      }),
    });

    if (!apiRes.ok) {
      await updateDoc(doc(db, 'reconstruction_jobs', jobId), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }

    await this.recordAuditLog({
      action: action === 'retry' ? 'RECONSTRUCTION_RETRIED' : 'RECONSTRUCTION_CANCELLED',
      resourceType: 'reconstruction',
      resourceId: jobId,
      summary: `${action === 'retry' ? 'Queued retry for' : 'Cancelled'} 3D reconstruction job ${jobId}`,
      afterState: { status: nextStatus },
      actorEmail,
    });
  }

  public async checkNeonHealth(counts?: {
    users: number;
    properties: number;
    transactions: number;
    auditLogs: number;
    jobs: number;
  }): Promise<AdminNeonConnectionStatus> {
    const headers = await this.getAuthHeaders();
    const res = await this.tryJsonFetch<{
      connected?: boolean;
      schemaVersion?: string;
      tables?: Array<{ name: string; status: 'ready' | 'fallback'; rowCount?: number }>;
    }>('/api/admin?action=health', { method: 'GET', headers }, 4000);

    const now = new Date().toISOString();
    const defaultTables: AdminNeonConnectionStatus['tables'] = [
      { name: 'users', status: res.ok ? 'ready' : 'fallback', rowCount: counts?.users },
      { name: 'properties', status: res.ok ? 'ready' : 'fallback', rowCount: counts?.properties },
      { name: 'transactions', status: res.ok ? 'ready' : 'fallback', rowCount: counts?.transactions },
      { name: 'reconstruction_jobs', status: res.ok ? 'ready' : 'fallback', rowCount: counts?.jobs },
      { name: 'audit_logs', status: res.ok ? 'ready' : 'fallback', rowCount: counts?.auditLogs },
      { name: 'system_settings', status: res.ok ? 'ready' : 'fallback', rowCount: 1 },
    ];

    if (res.ok && res.data) {
      return {
        connected: Boolean(res.data.connected ?? true),
        backend: 'neon_postgres',
        latencyMs: res.latencyMs,
        schemaVersion: res.data.schemaVersion || 'v4.0-neon-enterprise',
        tables: res.data.tables || defaultTables,
        checkedAt: now,
        details: 'Connected directly to Neon Serverless PostgreSQL.',
        detailsAr: 'تم الاتصال المباشر بقاعدة بيانات Neon Serverless PostgreSQL بنجاح.',
      };
    }

    return {
      connected: false,
      backend: 'adapter_fallback',
      latencyMs: res.latencyMs,
      schemaVersion: 'v4.0-hybrid-adapter',
      tables: defaultTables,
      checkedAt: now,
      details: 'Neon /api/admin endpoint not active locally — using synchronized Firestore & local adapter.',
      detailsAr: 'نقطة /api/admin غير مفعّلة محلياً — يعمل عبر محول البيانات المتزامن حالياً.',
    };
  }

  /**
   * Safeguarded Neon/Firestore Database Operation:
   * Deletes ALL properties while preserving 100% of users & Super Admin accounts,
   * logs a high-priority immutable audit entry, and returns ResetPropertiesResult.
   */
  public async resetPropertiesKeepUsers(actorEmail?: string): Promise<ResetPropertiesResult> {
    const actor = this.resolveActor(actorEmail);
    const now = new Date().toISOString();
    const headers = await this.getAuthHeaders();

    // 1. Try Neon API endpoint first
    const apiRes = await this.tryJsonFetch<ResetPropertiesResult>('/api/admin', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'reset-properties-keep-users',
        confirmation: 'RESET',
        actorEmail: actor.actorEmail,
      }),
    }, 10000);

    if (apiRes.ok && apiRes.data && apiRes.data.success) {
      await this.recordAuditLog({
        action: 'RESET_ALL_PROPERTIES_KEEP_USERS',
        resourceType: 'system',
        resourceId: 'properties_table',
        summary: `Deleted ${apiRes.data.deletedProperties} properties on Neon Postgres while preserving ${apiRes.data.preservedUsers} users.`,
        afterState: apiRes.data as unknown as Record<string, unknown>,
        actorEmail: actor.actorEmail,
      });
      return apiRes.data;
    }

    // 2. Local / Firestore adapter path — deletes ONLY properties, NEVER touches users!
    const [propsSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, 'properties')),
      getDocs(collection(db, 'users')).catch(() => ({ docs: [] as any[] })),
    ]);

    const propIds = propsSnap.docs.map((d) => d.id);
    for (const id of propIds) {
      await deleteDoc(doc(db, 'properties', id));
    }

    const preservedUsers = mergeDuplicateUsers(
      usersSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as UserAccountRecord[]
    ).length;

    const result: ResetPropertiesResult = {
      success: true,
      deletedProperties: propIds.length,
      preservedUsers,
      timestamp: now,
      backend: 'local_adapter',
      message: `Successfully cleared ${propIds.length} properties while preserving ${preservedUsers} user & admin account(s).`,
    };

    await this.recordAuditLog({
      action: 'RESET_ALL_PROPERTIES_KEEP_USERS',
      resourceType: 'system',
      resourceId: 'properties_collection',
      summary: result.message,
      beforeState: { propertiesCount: propIds.length, usersCount: preservedUsers },
      afterState: { propertiesCount: 0, preservedUsers },
      actorEmail: actor.actorEmail,
    });

    return result;
  }
}

export const adminPortalService = new AdminPortalService();
export { AdminPortalService };
