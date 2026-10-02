import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  calculateTrustScore,
  validateEgyptianLegalPrerequisites,
  formatTrustTierLabel,
} from '../../src/services/verification/trust-verification-service';
import {
  requestDocumentAccess,
  grantAccessRequest,
  isAccessGrantActive,
  generateSecureViewerSession,
} from '../../src/services/documents/private-document-service';
import { TrustVerificationDashboard } from '../../src/components/verification/TrustVerificationDashboard';
import { PrivateLegalVaultModal } from '../../src/components/documents/PrivateLegalVaultModal';
import { Property, LegalDocumentRecord, LegalDocumentAccessRequest } from '../../src/types';

describe('Tier 1 — Phase 5 & 6: Trust, Verification & Private Legal Workflow', () => {
  describe('Trust Verification Engine & Egyptian Real Estate Law', () => {
    it('calculates Premier Verified status (score >= 85) for fully verified property', () => {
      const res = calculateTrustScore(
        { status: 'verified', documentType: 'registered_deed', registrationNumber: '9842/2023' },
        { status: 'verified', licenseType: 'building_license', licenseNumber: 'LIC-2021-99' },
        { status: 'verified', developerClearancePaid: true, maintenanceDepositPaid: true, propertyTaxCleared: true, utilityBillsCleared: true },
        { status: 'verified', matched3DTour: true, gpsVerified: true }
      );

      expect(res.score).toBeGreaterThanOrEqual(85);
      expect(res.tier).toBe('PREMIER_VERIFIED');
      expect(res.breakdown.ownership).toBe(35);
      expect(res.breakdown.licensing).toBe(25);
      expect(res.breakdown.financial).toBe(20);
      expect(res.breakdown.physical).toBe(20);

      const labelEn = formatTrustTierLabel(res.tier, false);
      expect(labelEn.label).toBe('Premier Verified');

      const labelAr = formatTrustTierLabel(res.tier, true);
      expect(labelAr.label).toContain('بلاتيني');
    });

    it('assigns Documented tier for primary contract and reconciliation form 10', () => {
      const res = calculateTrustScore(
        { status: 'verified', documentType: 'primary_contract' },
        { status: 'verified', licenseType: 'reconciliation_form_10' },
        { status: 'pending' },
        { status: 'none' }
      );

      expect(res.tier).toBe('DOCUMENTED');
      expect(res.score).toBeGreaterThanOrEqual(45);
    });

    it('validates Egyptian legal prerequisites and flags missing compound allocation letter', () => {
      const compoundProperty: Partial<Property> = {
        title: 'Mivida Apartment',
        compound: 'Mivida',
        location: 'New Cairo',
        propertyType: 'Apartment',
      };

      const docsWithoutAllocation: LegalDocumentRecord[] = [
        {
          id: 'doc-1',
          propertyId: 'p-1',
          ownerId: 'owner-1',
          title: 'Primary Contract',
          titleAr: 'عقد بيع ابتدائي',
          category: 'ownership',
          documentType: 'primary_contract',
          storagePath: 'vault/p-1/contract.pdf',
          fileSizeBytes: 204800,
          mimeType: 'application/pdf',
          isEncrypted: true,
          accessControl: 'owner_and_admins_only',
          verificationStatus: 'verified',
          uploadedAt: new Date().toISOString(),
        },
      ];

      const validation = validateEgyptianLegalPrerequisites(compoundProperty, docsWithoutAllocation);
      expect(validation.compliant).toBe(true); // Has ownership document
      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.warningsAr[0]).toContain('المجتمعات العمرانية');
    });

    it('fails compliance if no ownership proof is attached', () => {
      const emptyDocs: LegalDocumentRecord[] = [];
      const validation = validateEgyptianLegalPrerequisites({ title: 'Zayed Villa' }, emptyDocs);
      expect(validation.compliant).toBe(false);
      expect(validation.missingRequirements[0]).toContain('Proof of ownership');
      expect(validation.missingRequirementsAr[0]).toContain('سند ملكية');
    });
  });

  describe('Private Document Vault & Watermarked Access Control', () => {
    it('creates an access request with watermark containing requester name and property ID', () => {
      const req = requestDocumentAccess(
        'prop-888',
        'seller-123',
        { id: 'buyer-456', name: 'Karim Farag', phone: '+201011122334' },
        'Pre-purchase legal diligence'
      );

      expect(req.status).toBe('pending');
      expect(req.requesterName).toBe('Karim Farag');
      expect(req.watermarkText).toContain('Karim Farag');
      expect(req.watermarkText).toContain('prop-888');
      expect(isAccessGrantActive(req)).toBe(false);
    });

    it('grants 48-hour access and activates viewer session with watermark', () => {
      const req = requestDocumentAccess(
        'prop-888',
        'seller-123',
        { id: 'buyer-456', name: 'Karim Farag', phone: '+201011122334' },
        'Legal review'
      );

      const granted = grantAccessRequest(req, 48);
      expect(granted.status).toBe('granted');
      expect(isAccessGrantActive(granted)).toBe(true);

      const docRecord: LegalDocumentRecord = {
        id: 'deed-99',
        propertyId: 'prop-888',
        ownerId: 'seller-123',
        title: 'Final Registered Deed',
        titleAr: 'عقد مسجل نهائي',
        category: 'ownership',
        documentType: 'registered_deed',
        storagePath: 'vault/prop-888/deed.pdf',
        fileSizeBytes: 512000,
        mimeType: 'application/pdf',
        isEncrypted: true,
        accessControl: 'granted_buyers',
        verificationStatus: 'verified',
        uploadedAt: new Date().toISOString(),
      };

      const session = generateSecureViewerSession(docRecord, granted, 'buyer-456');
      expect(session.authorized).toBe(true);
      expect(session.watermark).toContain('Karim Farag');
      expect(session.viewerUrl).toContain('vault.hettety.com/secure-view');

      // Unauthorized third party cannot access
      const intruderSession = generateSecureViewerSession(docRecord, granted, 'random-user-777');
      expect(intruderSession.authorized).toBe(false);
      expect(intruderSession.error).toContain('Unauthorized');
    });
  });

  describe('UI Integration — Trust Dashboard & Private Vault Modal', () => {
    const mockProperty: Property = {
      id: 'p-test-1',
      title: 'Luxury Duplex in Palm Hills',
      price: 14500000,
      location: '6th of October City',
      status: 'For Sale',
      bedrooms: 4,
      bathrooms: 4,
      area: 320,
      imageUrl: 'https://cdn.hettety.com/palm-hills.jpg',
      isVerified: true,
      trustMatrix: {
        score: 90,
        tier: 'PREMIER_VERIFIED',
        ownership: { status: 'verified', documentType: 'registered_deed', registrationNumber: '8821/2022' },
        licensing: { status: 'verified', licenseType: 'building_license' },
        financial: { status: 'verified', maintenanceDepositPaid: true, developerClearancePaid: true },
        physical: { status: 'verified', matched3DTour: true },
        lastAuditedAt: new Date().toISOString(),
      },
    };

    it('renders TrustVerificationDashboard with all 4 pillars and trust score', () => {
      render(<TrustVerificationDashboard property={mockProperty} isRtl={false} />);

      expect(screen.getByTestId('trust-verification-dashboard')).toBeInTheDocument();
      expect(screen.getByText('HETTETY Legal Trust Matrix')).toBeInTheDocument();
      expect(screen.getByText('Ownership Deed & Title')).toBeInTheDocument();
      expect(screen.getByText('Building License & Permits')).toBeInTheDocument();
      expect(screen.getByText('Financial Clearances')).toBeInTheDocument();
      expect(screen.getByText('3D Reality & Physical Match')).toBeInTheDocument();
      expect(screen.getByText('Premier Verified')).toBeInTheDocument();
    });

    it('renders PrivateLegalVaultModal and handles access request & watermark display', () => {
      const mockDocs: LegalDocumentRecord[] = [
        {
          id: 'doc-88',
          propertyId: 'p-test-1',
          ownerId: 'owner-99',
          title: 'Registered Title Deed',
          titleAr: 'عقد مسجل نهائي',
          category: 'ownership',
          documentType: 'registered_deed',
          storagePath: 'vault/deed.pdf',
          fileSizeBytes: 450000,
          mimeType: 'application/pdf',
          isEncrypted: true,
          accessControl: 'granted_buyers',
          verificationStatus: 'verified',
          uploadedAt: new Date().toISOString(),
        },
      ];

      const activeGrant: LegalDocumentAccessRequest = {
        id: 'req-1',
        propertyId: 'p-test-1',
        ownerId: 'owner-99',
        requesterId: 'buyer-user-1',
        requesterName: 'Sherif Zaki',
        requesterPhone: '+201200000000',
        status: 'granted',
        requestedAt: new Date().toISOString(),
        grantedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600 * 1000 * 24).toISOString(),
        purpose: 'Diligence',
        watermarkText: 'HETTETY CONFIDENTIAL • INSPECTED BY Sherif Zaki',
      };

      const { rerender } = render(
        <PrivateLegalVaultModal
          isOpen={true}
          onClose={vi.fn()}
          propertyId="p-test-1"
          propertyTitle="Luxury Duplex in Palm Hills"
          ownerId="owner-99"
          currentUserId="buyer-user-1"
          documents={mockDocs}
          accessRequest={activeGrant}
          isRtl={false}
        />
      );

      expect(screen.getByTestId('private-legal-vault-modal')).toBeInTheDocument();
      expect(screen.getByText('Registered Title Deed')).toBeInTheDocument();

      // Inspect document
      const inspectBtn = screen.getByRole('button', { name: /Inspect/i });
      fireEvent.click(inspectBtn);

      expect(screen.getByTestId('watermarked-document-viewer')).toBeInTheDocument();
      const watermarkEl = screen.getByTestId('watermark-overlay');
      expect(watermarkEl.textContent).toContain('Sherif Zaki');
    });
  });
});
