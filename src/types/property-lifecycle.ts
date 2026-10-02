/**
 * HETTETY Core Real-Estate Property Lifecycle & Audit Trail Schema
 */

export type PropertyLifecycleStatus =
  | 'draft'              // Initial drafting by seller/broker (Private)
  | 'submitted'          // Submitted by owner for platform verification (Private)
  | 'under_review'       // Assigned to compliance officer / reviewer (Private)
  | 'changes_requested'  // Reviewer found issues; returned to seller with notes (Private)
  | 'approved'           // Verified & approved; ready for scheduling/publishing (Private)
  | 'published'          // Live on marketplace; searchable & viewable by public
  | 'viewed'             // Actively inspected with high buyer interest / viewings
  | 'contacted'          // Active lead inquiries / buyer communications open
  | 'reserved'           // Buyer reservation deposit placed / pending closing (Private/Badge)
  | 'sold'               // Transaction completed / title transferred (Archival)
  | 'archived';          // Delisted or removed by owner / compliance

export type UserRole = 'user' | 'owner' | 'agent' | 'compliance_admin' | 'super_admin';

export interface PropertyAuditLog {
  id: string;
  propertyId: string;
  actorId: string;
  actorEmail?: string;
  actorRole: UserRole | 'system';
  fromStatus: PropertyLifecycleStatus;
  toStatus: PropertyLifecycleStatus;
  reason?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface GranularVerificationDetails {
  propertyVerified: boolean;
  ownerVerified: boolean;
  documentsSubmitted: boolean;
  documentsReviewed: boolean;
  locationVerified: boolean;
  priceVerified: boolean;
  verifiedBy?: string;
  verifiedAt?: string;
  reviewNote?: string;
}

export interface PropertyLifecycleValidation {
  valid: boolean;
  errors: string[];
  errorsAr: string[];
  warnings: string[];
  warningsAr: string[];
}
