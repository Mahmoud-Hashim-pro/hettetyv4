/**
 * HETTETY Clean Architecture — Core Domain Entities & Contracts
 * Strictly adheres to SOLID (SRP, ISP, DIP) with zero framework or vendor coupling.
 */

import { Property, UserDocument, ChatSession, TransactionRecord, Notification } from '../../types';

export type AdminRole =
  | 'super_admin'
  | 'admin'
  | 'operations'
  | 'broker'
  | 'technician'
  | 'seller'
  | 'buyer'
  | 'user';

export type AdminSectionId =
  | 'overview'
  | 'properties'
  | 'verifications'
  | 'reconstruction'
  | 'escrow'
  | 'users'
  | 'crm'
  | 'ai-ops'
  | 'analytics-seo'
  | 'audit-settings';

export interface UserAccountRecord {
  id: string;
  uid?: string;
  email: string;
  name: string;
  phone?: string;
  role: AdminRole;
  kycStatus?: 'unverified' | 'pending' | 'verified' | 'rejected';
  isSuspended?: boolean;
  avatarUrl?: string;
  preferences?: string;
  createdAt?: string;
  lastLoginAt?: string;
  accounts?: number;
  accountIds?: string[];
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorEmail: string;
  actorRole: AdminRole;
  action: string;
  resourceType:
    | 'property'
    | 'user'
    | 'document'
    | 'transaction'
    | 'purchase'
    | 'reconstruction'
    | 'crm'
    | 'report'
    | 'system'
    | 'ai';
  resourceId: string;
  summary: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ServiceHealthItem {
  id: 'neon_postgres' | 'object_storage' | 'ai_advisor' | 'gpu_3d_workers' | 'rate_limiter';
  name: string;
  nameAr: string;
  status: 'healthy' | 'degraded' | 'offline' | 'configured' | 'standby';
  latencyMs?: number;
  provider: string;
  details: string;
  detailsAr: string;
}

export interface AdminOverviewMetrics {
  totalUsers: number;
  totalAdmins: number;
  totalProperties: number;
  liveProperties: number;
  verifiedProperties: number;
  pendingVerifications: number;
  forSaleCount: number;
  forRentCount: number;
  propertiesWith3D: number;
  openPurchases: number;
  activeEscrowCount: number;
  activeEscrowVolumeEGP: number;
  pendingDocuments: number;
  openReports: number;
  activeReconstructionJobs: number;
  servicesHealth: ServiceHealthItem[];
}

export interface AdvisorHealthStatus {
  healthy: boolean;
  provider: string;
  model: string;
  fallbackModel?: string;
  rateLimiterBackend: 'redis' | 'neon_postgres' | 'memory';
  hasApiKey: boolean;
  latencyMs?: number;
  timestamp: string;
  diagnostics?: string;
}

export interface SystemSettings {
  maintenanceMode: boolean;
  allowPublicRegistration: boolean;
  requireAdminApprovalForListings: boolean;
  enable3DReconstructionPipeline: boolean;
  enableAiAdvisor: boolean;
  defaultCurrency: 'EGP' | 'USD';
  storageProvider: 'neon_storage' | 'cloudflare_r2' | 'gcs' | 'aws_s3' | 'vercel_blob';
  maxUploadImagesPerProperty: number;
  seoSiteTitle: string;
  seoDefaultDescription: string;
  updatedBy?: string;
  updatedAt?: string;
}

export type PropertySortOption =
  | 'default'
  | 'newest'
  | 'price-asc'
  | 'price-desc'
  | 'price-per-sqm-asc'
  | 'area-desc'
  | 'name-asc'
  | 'name-desc';

export type PropertyDisplayMode = 'grid' | 'list' | 'projects';

export interface PropertyFilterCriteria {
  query: string;
  type: string;
  listingStatus: 'all' | 'For Sale' | 'For Rent';
  minPrice: string;
  maxPrice: string;
  minArea: string;
  maxArea: string;
  minBedrooms: number;
  minBathrooms: number;
  finishing: string;
  deliveryTimeline: string;
  district: string;
  verifiedOnly: boolean;
  has3DOnly: boolean;
  installmentsOnly: boolean;
  yallaSahelOnly: boolean;
  aiFilteredIds: string[] | null;
  sortBy: PropertySortOption;
}

export const DEFAULT_PROPERTY_FILTER_CRITERIA: PropertyFilterCriteria = {
  query: '',
  type: 'all',
  listingStatus: 'all',
  minPrice: '',
  maxPrice: '',
  minArea: '',
  maxArea: '',
  minBedrooms: 0,
  minBathrooms: 0,
  finishing: 'all',
  deliveryTimeline: 'all',
  district: 'all',
  verifiedOnly: false,
  has3DOnly: false,
  installmentsOnly: false,
  yallaSahelOnly: false,
  aiFilteredIds: null,
  sortBy: 'default',
};

export interface SeoMetadata {
  title: string;
  description: string;
  canonicalPath?: string;
  ogType?: 'website' | 'article' | 'product';
  ogImage?: string;
  noIndex?: boolean;
  lang?: 'ar' | 'en';
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

export interface ResetPropertiesResult {
  success: boolean;
  deletedProperties: number;
  preservedUsers: number;
  timestamp: string;
  backend: 'neon_postgres' | 'local_adapter';
  message: string;
}

export interface AdminSnapshotData {
  users: UserAccountRecord[];
  properties: Property[];
  purchases: any[];
  transactions: TransactionRecord[];
  reports: any[];
  reviewDocs: UserDocument[];
  contactMessages: any[];
  alertSubscriptions: any[];
  reconstructionJobs: any[];
  auditLogs: AuditLogEntry[];
  settings: SystemSettings;
  metrics: AdminOverviewMetrics;
}

export type { Property, UserDocument, ChatSession, TransactionRecord, Notification };
