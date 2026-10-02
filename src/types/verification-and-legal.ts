/**
 * HETTETY Trust Verification & Private Legal Documents Domain Types
 * Strict Egyptian real estate legal taxonomy and cryptographic document access control.
 */

export type TrustTier = 'UNVERIFIED' | 'BASIC_CHECK' | 'DOCUMENTED' | 'PREMIER_VERIFIED';

export type OwnershipDocumentType =
  | 'registered_deed'             // عقد مشهر مسجل بالشهر العقاري
  | 'primary_contract'            // عقد بيع ابتدائي
  | 'power_of_attorney'           // توكيل رسمي عام / خاص بالإدارة والبيع
  | 'allocation_letter'           // إخطار تخصيص من جهاز المدينة أو المطور
  | 'court_validity'              // حكم صحة ونفاذ أو صحة توقيع
  | 'inheritance_decree';         // إعلام وراثة رسمي

export type BuildingLicenseType =
  | 'building_license'            // رخصة بناء رسمية صادرة من الحي أو جهاز المدينة
  | 'reconciliation_form_10'      // نموذج ١٠ النهائي للتصالح في مخالفات البناء
  | 'reconciliation_form_3'       // نموذج ٣ المؤقت لجدية التصالح
  | 'new_urban_community_clearance' // موافقة جهاز هيئة المجتمعات العمرانية
  | 'exempt'                      // معفى قانوناً (مباني قديمة ما قبل قانون البناء)
  | 'not_applicable';

export type FinancialClearanceType =
  | 'developer_clearance'         // مخالصة مالية نهائية من شركة التطوير العقاري
  | 'maintenance_deposit'         // شهادة سداد وديعة الصيانة
  | 'real_estate_tax_clearance'   // براءة ذمة من الضرائب العقارية (نموذج ٥)
  | 'utility_bills';              // فواتير وسجلات سداد العدادات (كهرباء / مياه / غاز)

export interface OwnershipVerificationRecord {
  status: 'verified' | 'pending' | 'rejected' | 'none';
  documentType?: OwnershipDocumentType;
  registrationNumber?: string; // رقم الشهر العقاري أو رقم التخصيص
  registryOffice?: string;     // مأمورية الشهر العقاري أو جهاز المدينة
  verifiedAt?: string;
  verifiedBy?: string;
  notes?: string;
  notesAr?: string;
}

export interface BuildingLicenseRecord {
  status: 'verified' | 'pending' | 'rejected' | 'exempt';
  licenseType?: BuildingLicenseType;
  licenseNumber?: string;
  issuingAuthority?: string;
  maxFloorsAllowed?: number;
  violationClearance?: boolean;
  verifiedAt?: string;
  verifiedBy?: string;
  notes?: string;
  notesAr?: string;
}

export interface FinancialClearanceRecord {
  status: 'verified' | 'pending' | 'rejected';
  developerClearancePaid?: boolean;
  maintenanceDepositPaid?: boolean;
  propertyTaxCleared?: boolean;
  utilityBillsCleared?: boolean;
  verifiedAt?: string;
  verifiedBy?: string;
  notes?: string;
  notesAr?: string;
}

export interface PhysicalInspectionRecord {
  status: 'verified' | 'pending' | 'none';
  matched3DTour?: boolean;
  inspectionDate?: string;
  inspectorName?: string;
  gpsVerified?: boolean;
  notes?: string;
  notesAr?: string;
}

export interface PropertyTrustMatrix {
  score: number;               // 0 to 100 calculated trust score
  tier: TrustTier;
  ownership: OwnershipVerificationRecord;
  licensing: BuildingLicenseRecord;
  financial: FinancialClearanceRecord;
  physical: PhysicalInspectionRecord;
  lastAuditedAt: string;
}

export interface LegalDocumentRecord {
  id: string;
  propertyId: string;
  ownerId: string;
  title: string;
  titleAr: string;
  category: 'ownership' | 'license' | 'financial' | 'inspection';
  documentType: OwnershipDocumentType | BuildingLicenseType | FinancialClearanceType | 'site_photos';
  storagePath: string;
  fileSizeBytes: number;
  mimeType: string;
  isEncrypted: boolean;
  accessControl: 'owner_and_admins_only' | 'granted_buyers';
  verificationStatus: 'pending' | 'verified' | 'rejected';
  reviewerNotes?: string;
  uploadedAt: string;
}

export interface LegalDocumentAccessRequest {
  id: string;
  propertyId: string;
  requesterId: string;
  requesterName: string;
  requesterPhone: string;
  requesterNationalIdMasked?: string;
  ownerId: string;
  status: 'pending' | 'granted' | 'rejected' | 'revoked' | 'expired';
  requestedAt: string;
  grantedAt?: string;
  expiresAt?: string;
  purpose: string;
  watermarkText: string;
}
