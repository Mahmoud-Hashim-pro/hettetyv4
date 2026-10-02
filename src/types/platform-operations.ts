/**
 * HETTETY Platform Operations, Market Analytics & Security Hardening Domain Types
 */

export interface AreaMarketMetric {
  location: string;
  locationAr: string;
  averagePricePerSqm: number;
  averagePrice: number;
  totalListings: number;
  averageRentalYieldPercent: number;
  threeDTourAdoptionPercent: number;
  demandTrend: 'rising' | 'stable' | 'cooling';
}

export interface MarketAnalyticsReport {
  timestamp: string;
  totalActiveVolumeEGP: number;
  totalProperties: number;
  averagePricePerSqmAll: number;
  threeDTourEngagementLiftMultiplier: number; // e.g. 2.4x higher conversion
  areaBreakdown: AreaMarketMetric[];
}

export interface SecurityAuditCheck {
  id: string;
  category: 'data_privacy' | 'storage_isolation' | 'audit_trail' | 'access_control';
  title: string;
  titleAr: string;
  passed: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string;
  detailsAr: string;
}

export interface PlatformHealthDashboardData {
  uptimePercent: number;
  gpuWorkerQueueDepth: number;
  p95ReconstructionMinutes: number;
  activeEscrowVolumeEGP: number;
  securityChecks: SecurityAuditCheck[];
  lastSecurityAuditDate: string;
}
