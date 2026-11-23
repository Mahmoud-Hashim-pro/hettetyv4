/**
 * HETTETY Enterprise Admin Command Center — Types, RBAC Matrix & Navigation Contracts
 */

import {
  AdminRole,
  AdminSectionId,
  UserAccountRecord,
  AuditLogEntry,
  ServiceHealthItem,
  AdminOverviewMetrics,
  AdvisorHealthStatus,
  SystemSettings,
  ResetPropertiesResult,
  AdminSnapshotData,
} from '../../core/domain/entities';
import {
  Property,
  UserDocument,
  TransactionRecord,
  LeadRecord,
  LeadStatus,
  AgentProfile,
  ReconstructionJob,
  DocReviewStatus,
} from '../../types';

export type {
  AdminRole,
  AdminSectionId,
  UserAccountRecord,
  AuditLogEntry,
  ServiceHealthItem,
  AdminOverviewMetrics,
  AdvisorHealthStatus,
  SystemSettings,
  ResetPropertiesResult,
  AdminSnapshotData,
  Property,
  UserDocument,
  TransactionRecord,
  LeadRecord,
  LeadStatus,
  AgentProfile,
  ReconstructionJob,
  DocReviewStatus,
};

export interface AdminPortalAppProps {
  isRtl: boolean;
  isSuperAdmin: boolean;
  userEmail?: string | null;
  userName?: string | null;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  onToggleLanguage?: () => void;
  onExitAdmin?: () => void;
  onOpenAddListing?: () => void;
  onOpenEditListing?: (property: Property) => void;
  onOpenProperty?: (propertyId: string) => void;
  onOpen3D?: (propertyId: string) => void;
  onPropertiesChanged?: () => void;
}

export interface AdminPurchaseRecord {
  id: string;
  propertyId: string;
  userId?: string;
  buyerEmail?: string;
  buyerName?: string;
  amount?: number;
  currency?: 'EGP' | 'USD';
  purchaseDate?: string;
  createdAt?: string;
  status: 'processing' | 'completed' | 'cancelled' | string;
  notes?: string;
}

export interface AdminReportRecord {
  id: string;
  propertyId?: string;
  propertyTitle?: string;
  reporterUid?: string;
  reporterEmail?: string;
  reason?: string;
  details?: string;
  status?: 'open' | 'resolved';
  createdAt?: string;
}

export interface AdminContactMessage {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
  createdAt?: string;
  status?: 'new' | 'replied';
}

export interface AdminAlertSubscription {
  id: string;
  email: string;
  query?: string;
  location?: string;
  propertyType?: string;
  maxPrice?: number;
  createdAt?: string;
}

export interface AdminReconstructionMetrics {
  activeWorkersCount: number;
  activeWorkers: Array<{
    workerId: string;
    lastSeenSecondsAgo: number;
    currentJobId?: string;
  }>;
  queueLatency: {
    samples: number;
    avgSeconds: number;
    lastSeconds: number;
    minSeconds: number;
    maxSeconds: number;
  };
  jobFailureCounters: Record<string, number>;
  totalJobs: {
    queued: number;
    ready: number;
    failed: number;
    cancelled: number;
  };
}

export interface AdminToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

export interface AdminNeonConnectionStatus {
  connected: boolean;
  backend: 'neon_postgres' | 'adapter_fallback';
  latencyMs: number;
  schemaVersion: string;
  tables: Array<{ name: string; status: 'ready' | 'fallback'; rowCount?: number }>;
  checkedAt: string;
  details: string;
  detailsAr: string;
}

export interface SeoAuditCheckItem {
  id: string;
  labelEn: string;
  labelAr: string;
  status: 'pass' | 'warn' | 'fail';
  points: number;
  maxPoints: number;
  currentValue: string;
  recommendationEn: string;
  recommendationAr: string;
}

export interface SeoAuditReport {
  score: number;
  maxScore: number;
  checks: SeoAuditCheckItem[];
  auditedAt: string;
}

export interface RoleMeta {
  id: AdminRole;
  labelEn: string;
  labelAr: string;
  badgeClass: string;
  descriptionEn: string;
  descriptionAr: string;
}

export const ADMIN_ROLES_META: Record<AdminRole, RoleMeta> = {
  super_admin: {
    id: 'super_admin',
    labelEn: 'Super Admin',
    labelAr: 'سوبر أدمن',
    badgeClass: 'bg-accent-500/15 text-accent-700 dark:text-accent-300 border-accent-500/30',
    descriptionEn: 'Full unrestricted control including RBAC & Neon DB danger zone.',
    descriptionAr: 'صلاحيات كاملة شاملة لإدارة الأدوار وعمليات قاعدة البيانات.',
  },
  admin: {
    id: 'admin',
    labelEn: 'Admin',
    labelAr: 'أدمن',
    badgeClass: 'bg-brand-600/15 text-brand-700 dark:text-brand-200 border-brand-500/30',
    descriptionEn: 'Full platform operations, listings, verifications, escrow, and reports.',
    descriptionAr: 'إدارة شاملة للعقارات، المراجعات، الضمان، والبلاغات.',
  },
  operations: {
    id: 'operations',
    labelEn: 'Operations',
    labelAr: 'عمليات',
    badgeClass: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
    descriptionEn: 'Document verification queue, CRM dispatch, and report moderation.',
    descriptionAr: 'مراجعة المستندات، متابعة الـ CRM، ومعالجة البلاغات.',
  },
  broker: {
    id: 'broker',
    labelEn: 'Broker',
    labelAr: 'وسيط عقاري',
    badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    descriptionEn: 'CRM pipeline, client viewings, and assigned property listings.',
    descriptionAr: 'إدارة العملاء المحتملين، المعاينات، والوحدات المسندة.',
  },
  technician: {
    id: 'technician',
    labelEn: '3D Technician',
    labelAr: 'فني مسح 3D',
    badgeClass: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
    descriptionEn: '3D capture validation, photogrammetry pipeline, and asset QA.',
    descriptionAr: 'تشغيل ومراقبة خط إنتاج النماذج ثلاثية الأبعاد وفحص الجودة.',
  },
  seller: {
    id: 'seller',
    labelEn: 'Seller',
    labelAr: 'بائع / مطور',
    badgeClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
    descriptionEn: 'Publish listings, upload ownership documents, and accept offers.',
    descriptionAr: 'نشر الإعلانات ورفع مستندات الملكية وقبول العروض.',
  },
  buyer: {
    id: 'buyer',
    labelEn: 'Buyer',
    labelAr: 'مشتري',
    badgeClass: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-400/30',
    descriptionEn: 'Browse, save favorites, submit escrow offers, and consult AI Advisor.',
    descriptionAr: 'التصفح، حفظ المفضلة، تقديم عروض الشراء، واستشارة المساعد الذكي.',
  },
  user: {
    id: 'user',
    labelEn: 'Standard User',
    labelAr: 'مستخدم عادي',
    badgeClass: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-300/40 dark:border-slate-700',
    descriptionEn: 'Default registered account with standard browsing & saved items.',
    descriptionAr: 'حساب مسجل قياسي للتصفح وحفظ العقارات.',
  },
};

export type PermissionLevel = 'full' | 'limited' | 'view' | 'none';

export interface RbacPermissionRow {
  capabilityEn: string;
  capabilityAr: string;
  roles: Record<Exclude<AdminRole, 'user'>, PermissionLevel>;
}

export const RBAC_PERMISSIONS_MATRIX: RbacPermissionRow[] = [
  {
    capabilityEn: 'Properties Inventory CMS',
    capabilityAr: 'إدارة مخزون العقارات (CMS)',
    roles: { super_admin: 'full', admin: 'full', operations: 'limited', broker: 'limited', technician: 'view', seller: 'limited', buyer: 'view' },
  },
  {
    capabilityEn: 'Listing & Document Verification',
    capabilityAr: 'مراجعة وتوثيق العقارات والمستندات',
    roles: { super_admin: 'full', admin: 'full', operations: 'full', broker: 'none', technician: 'none', seller: 'none', buyer: 'none' },
  },
  {
    capabilityEn: '3D Photogrammetry & GPU Ops',
    capabilityAr: 'عمليات المسح ثلاثي الأبعاد والـ GPU',
    roles: { super_admin: 'full', admin: 'full', operations: 'view', broker: 'view', technician: 'full', seller: 'limited', buyer: 'none' },
  },
  {
    capabilityEn: 'Escrow & Purchase Settlement',
    capabilityAr: 'إدارة حساب الضمان وتسوية الصفقات',
    roles: { super_admin: 'full', admin: 'full', operations: 'limited', broker: 'view', technician: 'none', seller: 'limited', buyer: 'limited' },
  },
  {
    capabilityEn: 'Users, KYC & RBAC Roles',
    capabilityAr: 'إدارة المستخدمين وـ KYC والصلاحيات',
    roles: { super_admin: 'full', admin: 'limited', operations: 'view', broker: 'none', technician: 'none', seller: 'none', buyer: 'none' },
  },
  {
    capabilityEn: 'CRM Leads & Report Moderation',
    capabilityAr: 'نظام الـ CRM ومعالجة البلاغات',
    roles: { super_admin: 'full', admin: 'full', operations: 'full', broker: 'full', technician: 'none', seller: 'none', buyer: 'none' },
  },
  {
    capabilityEn: 'AI Advisor Health & Live Console',
    capabilityAr: 'فحص وتشغيل المستشار العقاري الذكي',
    roles: { super_admin: 'full', admin: 'full', operations: 'view', broker: 'none', technician: 'view', seller: 'none', buyer: 'none' },
  },
  {
    capabilityEn: 'Analytics, Security & SEO Auditor',
    capabilityAr: 'التحليلات والأمن وفحص الـ SEO',
    roles: { super_admin: 'full', admin: 'full', operations: 'view', broker: 'view', technician: 'view', seller: 'none', buyer: 'none' },
  },
  {
    capabilityEn: 'System Settings & Feature Flags',
    capabilityAr: 'إعدادات النظام وتفعيل المزايا',
    roles: { super_admin: 'full', admin: 'limited', operations: 'none', broker: 'none', technician: 'none', seller: 'none', buyer: 'none' },
  },
  {
    capabilityEn: 'Neon DB Reset & Danger Zone',
    capabilityAr: 'عمليات قاعدة البيانات نيون والمنطقة الخطرة',
    roles: { super_admin: 'full', admin: 'none', operations: 'none', broker: 'none', technician: 'none', seller: 'none', buyer: 'none' },
  },
];

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  maintenanceMode: false,
  allowPublicRegistration: true,
  requireAdminApprovalForListings: true,
  enable3DReconstructionPipeline: true,
  enableAiAdvisor: true,
  defaultCurrency: 'EGP',
  storageProvider: 'neon_storage',
  maxUploadImagesPerProperty: 40,
  seoSiteTitle: 'HETTETY | Smart Egyptian Real Estate, 3D Tours & AI Advisor',
  seoDefaultDescription:
    'Discover verified Egyptian real estate with immersive 3D Gaussian Splatting tours, escrow protection, and an AI real estate advisor.',
  updatedBy: 'system',
  updatedAt: new Date().toISOString(),
};
