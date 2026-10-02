/**
 * HETTETY Trust & Verification Service
 * Multi-pillar verification engine adhering to Egyptian Real Estate Law (119/2008 & 187/2023).
 * Evaluates Title Deeds, Building Licenses, Reconciliation Forms (Form 10/3), and 3D Reality Match.
 */

import {
  Property,
  PropertyTrustMatrix,
  TrustTier,
  OwnershipVerificationRecord,
  BuildingLicenseRecord,
  FinancialClearanceRecord,
  PhysicalInspectionRecord,
  LegalDocumentRecord,
} from '../../types';

export interface TrustScoreBreakdown {
  score: number;
  tier: TrustTier;
  breakdown: {
    ownership: number;   // Max 35
    licensing: number;   // Max 25
    financial: number;   // Max 20
    physical: number;    // Max 20
  };
}

export interface LegalComplianceResult {
  compliant: boolean;
  missingRequirements: string[];
  missingRequirementsAr: string[];
  warnings: string[];
  warningsAr: string[];
}

/**
 * Calculates deterministic trust score and assigns platform trust tier
 */
export const calculateTrustScore = (
  ownership?: OwnershipVerificationRecord,
  licensing?: BuildingLicenseRecord,
  financial?: FinancialClearanceRecord,
  physical?: PhysicalInspectionRecord
): TrustScoreBreakdown => {
  let ownershipScore = 0;
  let licensingScore = 0;
  let financialScore = 0;
  let physicalScore = 0;

  // 1. Ownership evaluation (Max 35 pts)
  if (ownership?.status === 'verified') {
    switch (ownership.documentType) {
      case 'registered_deed':
      case 'allocation_letter':
        ownershipScore = 35;
        break;
      case 'court_validity':
        ownershipScore = 28;
        break;
      case 'primary_contract':
        ownershipScore = 20;
        break;
      case 'power_of_attorney':
      case 'inheritance_decree':
        ownershipScore = 22;
        break;
      default:
        ownershipScore = 15;
    }
  } else if (ownership?.status === 'pending') {
    ownershipScore = 5;
  }

  // 2. Licensing evaluation (Max 25 pts)
  if (licensing?.status === 'verified') {
    switch (licensing.licenseType) {
      case 'building_license':
      case 'reconciliation_form_10':
      case 'new_urban_community_clearance':
        licensingScore = 25;
        break;
      case 'exempt':
        licensingScore = 22;
        break;
      case 'reconciliation_form_3':
        licensingScore = 14;
        break;
      default:
        licensingScore = 10;
    }
  } else if (licensing?.status === 'exempt') {
    licensingScore = 20;
  } else if (licensing?.status === 'pending') {
    licensingScore = 4;
  }

  // 3. Financial clearance evaluation (Max 20 pts)
  if (financial?.status === 'verified') {
    let pts = 0;
    if (financial.developerClearancePaid) pts += 7;
    if (financial.maintenanceDepositPaid) pts += 5;
    if (financial.propertyTaxCleared) pts += 4;
    if (financial.utilityBillsCleared) pts += 4;
    financialScore = Math.min(20, pts || 15);
  } else if (financial?.status === 'pending') {
    financialScore = 3;
  }

  // 4. Physical 3D & Reality Match evaluation (Max 20 pts)
  if (physical?.status === 'verified') {
    let pts = 10;
    if (physical.matched3DTour) pts += 7;
    if (physical.gpsVerified) pts += 3;
    physicalScore = Math.min(20, pts);
  } else if (physical?.status === 'pending') {
    physicalScore = 3;
  }

  const totalScore = ownershipScore + licensingScore + financialScore + physicalScore;

  let tier: TrustTier = 'UNVERIFIED';
  if (totalScore >= 85) {
    tier = 'PREMIER_VERIFIED';
  } else if (totalScore >= 45 || (ownership?.status === 'verified' && licensing?.status === 'verified')) {
    tier = 'DOCUMENTED';
  } else if (totalScore >= 25) {
    tier = 'BASIC_CHECK';
  } else {
    tier = 'UNVERIFIED';
  }

  return {
    score: totalScore,
    tier,
    breakdown: {
      ownership: ownershipScore,
      licensing: licensingScore,
      financial: financialScore,
      physical: physicalScore,
    },
  };
};

/**
 * Validates whether an Egyptian property listing satisfies legal requirements before publication
 */
export const validateEgyptianLegalPrerequisites = (
  property: Partial<Property>,
  documents: LegalDocumentRecord[] = []
): LegalComplianceResult => {
  const missingRequirements: string[] = [];
  const missingRequirementsAr: string[] = [];
  const warnings: string[] = [];
  const warningsAr: string[] = [];

  const hasOwnershipDoc = documents.some(
    d => d.category === 'ownership' && (d.verificationStatus === 'verified' || d.verificationStatus === 'pending')
  );

  const hasLicenseDoc = documents.some(
    d => d.category === 'license' && (d.verificationStatus === 'verified' || d.verificationStatus === 'pending')
  );

  // Compounds / New Cities requirement
  const isCompoundOrNewCity = !!(
    property.compound ||
    (property.location && /new cairo|sheikh zayed|october|mostakbal|capital|shorouk|زايد|التجمع|أكتوبر|المستقبل|العاصمة/i.test(property.location))
  );

  if (isCompoundOrNewCity) {
    const hasAllocationOrDeveloperClearance = documents.some(
      d => d.documentType === 'allocation_letter' || d.documentType === 'developer_clearance'
    );
    if (!hasAllocationOrDeveloperClearance) {
      warnings.push('New city compound properties require an official developer allocation letter or financial clearance.');
      warningsAr.push('عقارات المجتمعات العمرانية والكمبوندات تتطلب إخطار تخصيص رسمي أو مخالصة من المطور.');
    }
  }

  if (!hasOwnershipDoc) {
    missingRequirements.push('Proof of ownership document (registered deed, primary contract, or allocation letter) is required.');
    missingRequirementsAr.push('يجب إرفاق سند ملكية رسمي (عقد مسجل، عقد بيع ابتدائي، أو إخطار تخصيص).');
  }

  // Building license or reconciliation check for residential apartments
  if (property.propertyType === 'Apartment' || property.propertyType === 'Villa') {
    if (!hasLicenseDoc && !property.registrationNumber) {
      warnings.push('Building license or reconciliation Form 10 is strongly recommended to protect buyer legal standing.');
      warningsAr.push('يُوصى بإرفاق رخصة البناء أو نموذج ١٠ للتصالح لضمان الحماية القانونية للمشتري.');
    }
  }

  return {
    compliant: missingRequirements.length === 0,
    missingRequirements,
    missingRequirementsAr,
    warnings,
    warningsAr,
  };
};

/**
 * Formats trust tier for presentation badge in UI
 */
export const formatTrustTierLabel = (tier: TrustTier, isRtl: boolean = false) => {
  switch (tier) {
    case 'PREMIER_VERIFIED':
      return {
        label: isRtl ? 'توثيق بلاتيني شامل' : 'Premier Verified',
        color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
        badge: '⭐⭐⭐',
      };
    case 'DOCUMENTED':
      return {
        label: isRtl ? 'عقار موثق المستندات' : 'Documented & Verified',
        color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
        badge: '⭐⭐',
      };
    case 'BASIC_CHECK':
      return {
        label: isRtl ? 'فحص بيانات أولي' : 'Basic Check',
        color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
        badge: '⭐',
      };
    case 'UNVERIFIED':
    default:
      return {
        label: isRtl ? 'قيد المراجعة والتدقيق' : 'Under Review',
        color: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30',
        badge: '⚪',
      };
  }
};
