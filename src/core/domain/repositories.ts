/**
 * HETTETY Clean Architecture — Domain Repository Interfaces (Dependency Inversion Principle)
 * Higher-level use cases and presentation modules depend solely on these abstractions.
 */

import {
  Property,
  UserAccountRecord,
  UserDocument,
  ChatSession,
  AdminSnapshotData,
  AdminRole,
  SystemSettings,
  ResetPropertiesResult,
  SeoMetadata,
  AdvisorHealthStatus,
} from './entities';

export interface IPropertyRepository {
  findAll(): Promise<Property[]>;
  findById(id: string): Promise<Property | null>;
  create(property: Omit<Property, 'id'>): Promise<Property>;
  update(id: string, patch: Partial<Property>): Promise<void>;
  delete(id: string): Promise<void>;
  resetAllKeepUsers(): Promise<ResetPropertiesResult>;
}

export interface IUserRepository {
  getCurrentUser(): Promise<UserAccountRecord | null>;
  findAll(): Promise<UserAccountRecord[]>;
  updateRole(userId: string, role: AdminRole): Promise<void>;
  setSuspended(userId: string, suspended: boolean): Promise<void>;
  updateKycStatus(userId: string, status: UserAccountRecord['kycStatus']): Promise<void>;
  deleteUser(userIds: string[]): Promise<void>;
}

export interface IAdminRepository {
  loadDashboardSnapshot(): Promise<AdminSnapshotData>;
  verifyProperty(
    propertyId: string,
    status: 'Verified' | 'Rejected' | 'Pending',
    note?: string,
    actorEmail?: string
  ): Promise<void>;
  setPropertyListingState(propertyId: string, state: 'Live' | 'Draft' | 'Removed'): Promise<void>;
  setPropertyAvailability(propertyId: string, availability: 'Available' | 'Sold' | 'Reserved'): Promise<void>;
  reviewDocument(
    doc: UserDocument,
    nextStatus: 'InReview' | 'Checked' | 'NeedsAttention',
    note: string,
    actorEmail?: string
  ): Promise<void>;
  updatePurchaseStatus(purchaseId: string, status: 'completed' | 'cancelled' | 'processing'): Promise<void>;
  deleteReport(reportId: string): Promise<void>;
  saveSystemSettings(settings: Partial<SystemSettings>, actorEmail?: string): Promise<SystemSettings>;
  checkAdvisorHealth(): Promise<AdvisorHealthStatus>;
  resetPropertiesKeepUsers(actorEmail?: string): Promise<ResetPropertiesResult>;
}

export interface IAdvisorRepository {
  listSessions(userId: string): Promise<ChatSession[]>;
  saveSession(session: Omit<ChatSession, 'id'> & { id?: string }): Promise<string>;
}

export interface ISeoService {
  apply(meta: SeoMetadata): void;
  buildPropertyJsonLd(property: Property, siteUrl: string): Record<string, unknown>;
  buildOrganizationJsonLd(siteUrl: string): Record<string, unknown>;
  buildBreadcrumbJsonLd(items: Array<{ name: string; url: string }>): Record<string, unknown>;
}
