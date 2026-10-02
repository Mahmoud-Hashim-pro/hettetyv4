/**
 * HETTETY Core Real-Estate Property Lifecycle Service
 * Manages formal state transitions, role-based permissions, pre-flight validation,
 * immutable audit logging, and transition notifications.
 */

import {
  Property,
  PropertyLifecycleStatus,
  PropertyAuditLog,
  UserRole,
  PropertyLifecycleValidation,
  GranularVerificationDetails,
} from '../types';

// Allowed State Transitions Matrix
const ALLOWED_TRANSITIONS: Record<PropertyLifecycleStatus, PropertyLifecycleStatus[]> = {
  draft: ['submitted', 'archived'],
  submitted: ['under_review', 'draft', 'archived'],
  under_review: ['changes_requested', 'approved', 'archived'],
  changes_requested: ['submitted', 'draft', 'archived'],
  approved: ['published', 'archived'],
  published: ['viewed', 'contacted', 'reserved', 'sold', 'archived'],
  viewed: ['contacted', 'reserved', 'sold', 'archived'],
  contacted: ['reserved', 'sold', 'archived'],
  reserved: ['sold', 'published', 'archived'],
  sold: ['archived'],
  archived: ['draft'],
};

// In-memory audit registry for active session (persisted via Firestore audit_logs collection)
const auditLogsStore: PropertyAuditLog[] = [];

/**
 * Validates if the property data satisfies the prerequisites for the target status.
 */
export const validatePropertyForTransition = (
  property: Partial<Property>,
  targetStatus: PropertyLifecycleStatus
): PropertyLifecycleValidation => {
  const errors: string[] = [];
  const errorsAr: string[] = [];
  const warnings: string[] = [];
  const warningsAr: string[] = [];

  if (targetStatus === 'submitted') {
    if (!property.title || property.title.trim().length < 5) {
      errors.push('Title must be at least 5 characters long.');
      errorsAr.push('يجب ألا يقل عنوان العقار عن 5 أحرف.');
    }
    if (!property.price || property.price <= 0) {
      errors.push('A valid positive price is required.');
      errorsAr.push('يجب تحديد سعر صحيح للعقار.');
    }
    if (!property.location || property.location.trim().length === 0) {
      errors.push('Location is mandatory.');
      errorsAr.push('موقع العقار إلزامي.');
    }
    if (!property.area || property.area <= 0) {
      errors.push('Area in square meters is required.');
      errorsAr.push('مساحة العقار بالمتر المربع مطلوبة.');
    }
    const photoCount = (property.images?.length || 0) + (property.imageUrl ? 1 : 0);
    if (photoCount < 3) {
      errors.push('At least 3 photos are required for submission.');
      errorsAr.push('يلزم رفع 3 صور على الأقل لتقديم العقار للمراجعة.');
    }
  }

  if (targetStatus === 'approved') {
    const hasLegalDocs = Boolean(property.legalDocs && property.legalDocs.length > 0);
    const hasRegNumber = Boolean(property.registrationNumber && property.registrationNumber.trim().length > 0);
    if (!hasLegalDocs && !hasRegNumber) {
      errors.push('Cannot approve property without proof of ownership or official registration number.');
      errorsAr.push('لا يمكن اعتماد العقار دون مستند إثبات ملكية أو رقم شهر عقاري رسمي.');
    }
  }

  if (targetStatus === 'published') {
    if (property.lifecycleStatus !== 'approved' && property.lifecycleStatus !== 'reserved') {
      errors.push('Property must be approved by compliance before publishing to the public grid.');
      errorsAr.push('يجب اعتماد العقار أولاً من إدارة المنصة قبل نشره للجمهور.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    errorsAr,
    warnings,
    warningsAr,
  };
};

/**
 * Checks whether an actor is authorized to perform the requested transition.
 */
export const isAuthorizedForTransition = (
  fromStatus: PropertyLifecycleStatus,
  toStatus: PropertyLifecycleStatus,
  actorRole: UserRole | 'system',
  isPropertyOwner: boolean
): boolean => {
  if (actorRole === 'super_admin' || actorRole === 'system') return true;

  // Seller / Owner permissions
  if (isPropertyOwner && (actorRole === 'owner' || actorRole === 'user')) {
    if (fromStatus === 'draft' && toStatus === 'submitted') return true;
    if (fromStatus === 'changes_requested' && toStatus === 'submitted') return true;
    if (fromStatus === 'submitted' && toStatus === 'draft') return true;
    if (toStatus === 'archived') return true;
    if (fromStatus === 'archived' && toStatus === 'draft') return true;
    return false;
  }

  // Compliance Admin permissions
  if (actorRole === 'compliance_admin') {
    if (fromStatus === 'submitted' && toStatus === 'under_review') return true;
    if (fromStatus === 'under_review' && (toStatus === 'changes_requested' || toStatus === 'approved')) return true;
    if (fromStatus === 'approved' && toStatus === 'published') return true;
    if (toStatus === 'archived') return true;
    return false;
  }

  // Verified Agent permissions
  if (actorRole === 'agent') {
    if (isPropertyOwner) {
      if (fromStatus === 'draft' && toStatus === 'submitted') return true;
      if (fromStatus === 'changes_requested' && toStatus === 'submitted') return true;
      if (toStatus === 'archived') return true;
    }
    // Agents can mark viewed, contacted, or reserved for their properties
    if (['published', 'viewed'].includes(fromStatus) && ['contacted', 'reserved'].includes(toStatus)) {
      return true;
    }
  }

  return false;
};

export interface TransitionRequest {
  property: Property;
  targetStatus: PropertyLifecycleStatus;
  actorId: string;
  actorEmail?: string;
  actorRole: UserRole | 'system';
  isPropertyOwner: boolean;
  reason?: string;
  reviewerNotes?: string;
  granularVerificationUpdate?: Partial<GranularVerificationDetails>;
}

export interface TransitionResult {
  success: boolean;
  property: Property;
  auditLog?: PropertyAuditLog;
  errors?: string[];
  errorsAr?: string[];
}

/**
 * Executes a formal lifecycle state transition, writes audit log, and updates verification fields.
 */
export const executePropertyLifecycleTransition = (
  req: TransitionRequest
): TransitionResult => {
  const currentStatus = req.property.lifecycleStatus || 'draft';
  const targetStatus = req.targetStatus;

  // 1. Check if transition is mathematically allowed in the State Machine
  const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowedNext.includes(targetStatus)) {
    return {
      success: false,
      property: req.property,
      errors: [`Illegal transition from '${currentStatus}' to '${targetStatus}'.`],
      errorsAr: [`انتقال غير مسموح به في دورة الحياة من '${currentStatus}' إلى '${targetStatus}'.`],
    };
  }

  // 2. Check RBAC permissions
  const authorized = isAuthorizedForTransition(currentStatus, targetStatus, req.actorRole, req.isPropertyOwner);
  if (!authorized) {
    return {
      success: false,
      property: req.property,
      errors: [`Role '${req.actorRole}' is not authorized to transition property to '${targetStatus}'.`],
      errorsAr: [`الصلاحية '${req.actorRole}' غير مخولة بنقل العقار إلى حالة '${targetStatus}'.`],
    };
  }

  // 3. Pre-flight validation
  const validation = validatePropertyForTransition(req.property, targetStatus);
  if (!validation.valid) {
    return {
      success: false,
      property: req.property,
      errors: validation.errors,
      errorsAr: validation.errorsAr,
    };
  }

  // 4. Create immutable audit log entry
  const now = new Date().toISOString();
  const auditLog: PropertyAuditLog = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    propertyId: req.property.id,
    actorId: req.actorId,
    actorEmail: req.actorEmail,
    actorRole: req.actorRole,
    fromStatus: currentStatus,
    toStatus: targetStatus,
    reason: req.reason || `Transitioned to ${targetStatus}`,
    timestamp: now,
  };
  auditLogsStore.push(auditLog);

  // 5. Build updated property entity
  const updatedProperty: Property = {
    ...req.property,
    lifecycleStatus: targetStatus,
    // Sync legacy listingState for backward compatibility with existing views
    listingState: targetStatus === 'published' ? 'Live' : targetStatus === 'archived' ? 'Removed' : 'Draft',
  };

  // Update verification attributes if approving
  if (targetStatus === 'approved') {
    updatedProperty.isVerified = true;
    updatedProperty.verificationStatus = 'Verified';
    updatedProperty.verifiedBy = req.actorEmail || req.actorId;
    updatedProperty.verifiedAt = now;
    if (req.reviewerNotes) updatedProperty.reviewNote = req.reviewerNotes;

    updatedProperty.granularVerification = {
      propertyVerified: true,
      ownerVerified: true,
      documentsSubmitted: Boolean(req.property.legalDocs && req.property.legalDocs.length > 0),
      documentsReviewed: true,
      locationVerified: Boolean(req.property.location),
      priceVerified: Boolean(req.property.price > 0),
      verifiedBy: req.actorEmail || req.actorId,
      verifiedAt: now,
      reviewNote: req.reviewerNotes,
      ...(req.granularVerificationUpdate || {}),
    };
  } else if (targetStatus === 'changes_requested') {
    updatedProperty.isVerified = false;
    updatedProperty.verificationStatus = 'Rejected';
    if (req.reviewerNotes) updatedProperty.reviewNote = req.reviewerNotes;
  }

  return {
    success: true,
    property: updatedProperty,
    auditLog,
  };
};

/**
 * Retrieves the audit trail for a property.
 */
export const getPropertyAuditTrail = (propertyId: string): PropertyAuditLog[] => {
  return auditLogsStore.filter((log) => log.propertyId === propertyId);
};
