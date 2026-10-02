/**
 * HETTETY Private Legal Documents & Access Control Service
 * Protects title deeds and sensitive legal records with watermarking, timed access grants,
 * and immutable access audit logs. Raw storage URLs are never exposed publicly.
 */

import { LegalDocumentRecord, LegalDocumentAccessRequest } from '../../types';

export interface DocumentAccessAuditEntry {
  id: string;
  documentId: string;
  propertyId: string;
  accessorId: string;
  accessorName: string;
  accessorRole: 'owner' | 'buyer' | 'broker' | 'compliance_admin';
  timestamp: string;
  ipAddress?: string;
  action: 'requested' | 'viewed' | 'download_prevented' | 'granted' | 'revoked';
}

/**
 * Creates a formal access request for prospective buyers
 */
export const requestDocumentAccess = (
  propertyId: string,
  ownerId: string,
  requester: { id: string; name: string; phone: string; nationalIdMasked?: string },
  purpose: string
): LegalDocumentAccessRequest => {
  const reqId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const watermarkText = `HETTETY LEGAL VAULT • INSPECTED BY ${requester.name} (${requester.phone}) • PROPERTY #${propertyId} • ${now}`;

  return {
    id: reqId,
    propertyId,
    ownerId,
    requesterId: requester.id,
    requesterName: requester.name,
    requesterPhone: requester.phone,
    requesterNationalIdMasked: requester.nationalIdMasked,
    status: 'pending',
    requestedAt: now,
    purpose: purpose || 'Buyer Legal Verification',
    watermarkText,
  };
};

/**
 * Grants access to requested documents for a designated duration (default: 48 hours)
 */
export const grantAccessRequest = (
  request: LegalDocumentAccessRequest,
  durationHours: number = 48
): LegalDocumentAccessRequest => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000).toISOString();

  return {
    ...request,
    status: 'granted',
    grantedAt: now.toISOString(),
    expiresAt,
  };
};

/**
 * Validates whether an active access grant is currently valid and unexpired
 */
export const isAccessGrantActive = (request?: LegalDocumentAccessRequest | null): boolean => {
  if (!request) return false;
  if (request.status !== 'granted') return false;
  if (!request.expiresAt) return false;

  return new Date(request.expiresAt).getTime() > Date.now();
};

/**
 * Generates a secure, temporary, watermarked viewer descriptor
 * In a real production deployment, this produces a time-limited signed URL with overlaid watermark
 */
export const generateSecureViewerSession = (
  doc: LegalDocumentRecord,
  request: LegalDocumentAccessRequest,
  viewerUserId: string
): { authorized: boolean; viewerUrl: string; watermark: string; expiresAt?: string; error?: string } => {
  const isOwner = viewerUserId === doc.ownerId;
  const isGrantee = viewerUserId === request.requesterId && isAccessGrantActive(request);

  if (!isOwner && !isGrantee) {
    return {
      authorized: false,
      viewerUrl: '',
      watermark: '',
      error: 'Unauthorized. You do not hold an active legal inspection grant for this property.',
    };
  }

  const watermark = isOwner
    ? `HETTETY OFFICIAL OWNER COPY • PROPERTY #${doc.propertyId}`
    : request.watermarkText;

  // Render via secure gateway endpoint or encoded session token
  const viewerUrl = `https://vault.hettety.com/secure-view/${doc.propertyId}/${doc.id}?token=jwt_${Date.now()}`;

  return {
    authorized: true,
    viewerUrl,
    watermark,
    expiresAt: request.expiresAt,
  };
};

/**
 * Translates document categories and types for Egyptian Arabic and English
 */
export const getDocumentTypeLabel = (type: string, isRtl: boolean = false) => {
  const labels: Record<string, { en: string; ar: string }> = {
    registered_deed: { en: 'Registered Title Deed (Shahr 3aqary)', ar: 'عقد مشهر مسجل بالشهر العقاري' },
    primary_contract: { en: 'Primary Sales Contract', ar: 'عقد بيع ابتدائي' },
    power_of_attorney: { en: 'Official Power of Attorney', ar: 'توكيل رسمي بالبيع والإدارة' },
    allocation_letter: { en: 'Developer / New City Allocation Letter', ar: 'إخطار تخصيص رسمي' },
    court_validity: { en: 'Court Signature / Title Validity Ruling', ar: 'حكم صحة ونفاذ / صحة توقيع' },
    inheritance_decree: { en: 'Inheritance Legal Decree', ar: 'إعلام وراثة رسمي' },
    building_license: { en: 'Building License', ar: 'رخصة بناء رسمية' },
    reconciliation_form_10: { en: 'Reconciliation Form 10 (Final)', ar: 'نموذج ١٠ للتصالح النهائي' },
    reconciliation_form_3: { en: 'Reconciliation Form 3 (Temporary)', ar: 'نموذج ٣ لجدية التصالح' },
    new_urban_community_clearance: { en: 'New Urban Communities Authority Approval', ar: 'موافقة جهاز هيئة المجتمعات العمرانية' },
    developer_clearance: { en: 'Developer Financial Clearance', ar: 'مخالصة مالية نهائية من المطور' },
    maintenance_deposit: { en: 'Maintenance Deposit Certificate', ar: 'شهادة سداد وديعة الصيانة' },
    real_estate_tax_clearance: { en: 'Real Estate Tax Clearance (Form 5)', ar: 'براءة ذمة من الضرائب العقارية' },
    utility_bills: { en: 'Utility Meters Clearance', ar: 'مخالصة وسجلات عدادات المرافق' },
    site_photos: { en: 'Physical Inspection Photos', ar: 'صور المعاينة الميدانية' },
  };

  const found = labels[type] || { en: type, ar: type };
  return isRtl ? found.ar : found.en;
};
