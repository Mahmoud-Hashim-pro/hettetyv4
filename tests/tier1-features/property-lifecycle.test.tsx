import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  executePropertyLifecycleTransition,
  validatePropertyForTransition,
  isAuthorizedForTransition,
  getPropertyAuditTrail,
} from '../../src/services/property-lifecycle-service';
import { PropertyLifecycleBadge } from '../../src/components/lifecycle/PropertyLifecycleBadge';
import { PropertyAuditHistory } from '../../src/components/lifecycle/PropertyAuditHistory';
import { Property, PropertyAuditLog } from '../../src/types';

const createBaseProperty = (overrides: Partial<Property> = {}): Property => ({
  id: 'prop-lifecycle-101',
  title: 'Palm Hills Villa with Private Pool',
  price: 18500000,
  location: '6th of October City',
  bedrooms: 4,
  bathrooms: 4,
  area: 420,
  status: 'For Sale',
  images: [
    'https://cdn.hettety.com/img1.jpg',
    'https://cdn.hettety.com/img2.jpg',
    'https://cdn.hettety.com/img3.jpg',
  ],
  imageUrl: 'https://cdn.hettety.com/img1.jpg',
  legalDocs: ['https://cdn.hettety.com/docs/ownership_contract.pdf'],
  registrationNumber: 'REG-GIZA-88421',
  isVerified: false,
  lifecycleStatus: 'draft',
  listingState: 'Draft',
  ...overrides,
});

describe('Tier 1 — Core Property Real-Estate Lifecycle & Audit System', () => {
  describe('Pre-flight Validation Rules', () => {
    it('rejects submission if property lacks minimum required photos (at least 3)', () => {
      const prop = createBaseProperty({ images: ['https://cdn.hettety.com/1.jpg'] });
      const val = validatePropertyForTransition(prop, 'submitted');
      expect(val.valid).toBe(false);
      expect(val.errors[0]).toContain('At least 3 photos are required');
      expect(val.errorsAr[0]).toContain('يلزم رفع 3 صور');
    });

    it('rejects approval if property lacks ownership documents and registration number', () => {
      const prop = createBaseProperty({ legalDocs: [], registrationNumber: '' });
      const val = validatePropertyForTransition(prop, 'approved');
      expect(val.valid).toBe(false);
      expect(val.errors[0]).toContain('Cannot approve property without proof of ownership');
    });

    it('passes submission validation when all mandatory specs and photos are present', () => {
      const prop = createBaseProperty();
      const val = validatePropertyForTransition(prop, 'submitted');
      expect(val.valid).toBe(true);
      expect(val.errors).toHaveLength(0);
    });
  });

  describe('Role-Based Authorization (RBAC)', () => {
    it('permits owner to submit draft and request revisions', () => {
      expect(isAuthorizedForTransition('draft', 'submitted', 'owner', true)).toBe(true);
      expect(isAuthorizedForTransition('changes_requested', 'submitted', 'owner', true)).toBe(true);
      expect(isAuthorizedForTransition('submitted', 'draft', 'owner', true)).toBe(true);
    });

    it('strictly forbids property owner from self-approving or self-publishing', () => {
      expect(isAuthorizedForTransition('draft', 'approved', 'owner', true)).toBe(false);
      expect(isAuthorizedForTransition('under_review', 'approved', 'owner', true)).toBe(false);
      expect(isAuthorizedForTransition('approved', 'published', 'owner', true)).toBe(false);
    });

    it('permits compliance admin to assign review, request changes, and approve', () => {
      expect(isAuthorizedForTransition('submitted', 'under_review', 'compliance_admin', false)).toBe(true);
      expect(isAuthorizedForTransition('under_review', 'changes_requested', 'compliance_admin', false)).toBe(true);
      expect(isAuthorizedForTransition('under_review', 'approved', 'compliance_admin', false)).toBe(true);
      expect(isAuthorizedForTransition('approved', 'published', 'compliance_admin', false)).toBe(true);
    });
  });

  describe('State Machine Transitions & Immutable Audit Trail', () => {
    it('executes full end-to-end lifecycle progression from draft to published', () => {
      let prop = createBaseProperty({ lifecycleStatus: 'draft' });

      // Step 1: Owner submits for review
      const res1 = executePropertyLifecycleTransition({
        property: prop,
        targetStatus: 'submitted',
        actorId: 'owner-123',
        actorEmail: 'seller@example.com',
        actorRole: 'owner',
        isPropertyOwner: true,
        reason: 'Ready for platform compliance review',
      });
      expect(res1.success).toBe(true);
      expect(res1.property.lifecycleStatus).toBe('submitted');
      expect(res1.auditLog?.fromStatus).toBe('draft');
      expect(res1.auditLog?.toStatus).toBe('submitted');
      prop = res1.property;

      // Step 2: Compliance officer takes for review
      const res2 = executePropertyLifecycleTransition({
        property: prop,
        targetStatus: 'under_review',
        actorId: 'admin-99',
        actorEmail: 'auditor@hettety.com',
        actorRole: 'compliance_admin',
        isPropertyOwner: false,
        reason: 'Checking legal documents and cadastral deed',
      });
      expect(res2.success).toBe(true);
      expect(res2.property.lifecycleStatus).toBe('under_review');
      prop = res2.property;

      // Step 3: Compliance officer approves property
      const res3 = executePropertyLifecycleTransition({
        property: prop,
        targetStatus: 'approved',
        actorId: 'admin-99',
        actorEmail: 'auditor@hettety.com',
        actorRole: 'compliance_admin',
        isPropertyOwner: false,
        reviewerNotes: 'Verified against real estate registry. All clear.',
        granularVerificationUpdate: {
          propertyVerified: true,
          ownerVerified: true,
          documentsReviewed: true,
          locationVerified: true,
          priceVerified: true,
        },
      });
      expect(res3.success).toBe(true);
      expect(res3.property.lifecycleStatus).toBe('approved');
      expect(res3.property.isVerified).toBe(true);
      expect(res3.property.granularVerification?.documentsReviewed).toBe(true);
      prop = res3.property;

      // Step 4: Published to the marketplace
      const res4 = executePropertyLifecycleTransition({
        property: prop,
        targetStatus: 'published',
        actorId: 'admin-99',
        actorRole: 'compliance_admin',
        isPropertyOwner: false,
      });
      expect(res4.success).toBe(true);
      expect(res4.property.lifecycleStatus).toBe('published');
      expect(res4.property.listingState).toBe('Live');

      // Verify audit logs for this property
      const history = getPropertyAuditTrail(prop.id);
      expect(history.length).toBeGreaterThanOrEqual(4);
      expect(history[0].fromStatus).toBe('draft');
      expect(history[history.length - 1].toStatus).toBe('published');
    });

    it('rejects illegal transition jumps bypassing required review stages', () => {
      const prop = createBaseProperty({ lifecycleStatus: 'draft' });

      const illegalJump = executePropertyLifecycleTransition({
        property: prop,
        targetStatus: 'published',
        actorId: 'admin-99',
        actorRole: 'compliance_admin',
        isPropertyOwner: false,
      });

      expect(illegalJump.success).toBe(false);
      expect(illegalJump.errors?.[0]).toContain("Illegal transition from 'draft' to 'published'");
    });

    it('handles review feedback loop: changes_requested -> fixes -> resubmitted', () => {
      const prop = createBaseProperty({ lifecycleStatus: 'under_review' });

      // Reviewer finds missing floor plan and requests revision
      const resFeedback = executePropertyLifecycleTransition({
        property: prop,
        targetStatus: 'changes_requested',
        actorId: 'admin-99',
        actorRole: 'compliance_admin',
        isPropertyOwner: false,
        reviewerNotes: 'Please upload the registered cadastral map.',
      });
      expect(resFeedback.success).toBe(true);
      expect(resFeedback.property.lifecycleStatus).toBe('changes_requested');
      expect(resFeedback.property.reviewNote).toContain('cadastral map');

      // Seller re-submits after fix
      const resResubmit = executePropertyLifecycleTransition({
        property: resFeedback.property,
        targetStatus: 'submitted',
        actorId: 'owner-123',
        actorRole: 'owner',
        isPropertyOwner: true,
        reason: 'Uploaded cadastral map.',
      });
      expect(resResubmit.success).toBe(true);
      expect(resResubmit.property.lifecycleStatus).toBe('submitted');
    });
  });

  describe('UI Presentation & Granular Verification Display', () => {
    it('renders PropertyLifecycleBadge with correct status label and icon', () => {
      render(<PropertyLifecycleBadge status="published" isRtl={false} />);
      expect(screen.getByText('Published & Live')).toBeInTheDocument();
    });

    it('renders Arabic status badge when isRtl is enabled', () => {
      render(<PropertyLifecycleBadge status="under_review" isRtl={true} />);
      expect(screen.getByText('قيد التدقيق القانوني')).toBeInTheDocument();
    });

    it('toggles granular verification details breakdown on badge interaction', () => {
      const verification = {
        propertyVerified: true,
        ownerVerified: true,
        documentsSubmitted: true,
        documentsReviewed: true,
        locationVerified: true,
        priceVerified: true,
        verifiedBy: 'auditor@hettety.com',
        verifiedAt: '2026-10-01T12:00:00Z',
        reviewNote: 'Title checked at New Cairo notary office.',
      };

      render(
        <PropertyLifecycleBadge
          status="approved"
          verification={verification}
          isRtl={false}
          interactive={true}
        />
      );

      const badge = screen.getByText('Approved');
      fireEvent.click(badge);

      expect(screen.getByText('Hettety Trust Matrix')).toBeInTheDocument();
      expect(screen.getByText('Property & Specs')).toBeInTheDocument();
      expect(screen.getByText('Owner Identity')).toBeInTheDocument();
      expect(screen.getByText(/Title checked at New Cairo notary office/i)).toBeInTheDocument();
    });

    it('renders PropertyAuditHistory modal with chronological timeline', () => {
      const logs: PropertyAuditLog[] = [
        {
          id: 'log-1',
          propertyId: 'p-test',
          actorId: 'owner-1',
          actorEmail: 'owner@hettety.com',
          actorRole: 'owner',
          fromStatus: 'draft',
          toStatus: 'submitted',
          reason: 'Initial submission',
          timestamp: '2026-10-01T10:00:00Z',
        },
        {
          id: 'log-2',
          propertyId: 'p-test',
          actorId: 'admin-1',
          actorEmail: 'compliance@hettety.com',
          actorRole: 'compliance_admin',
          fromStatus: 'submitted',
          toStatus: 'approved',
          reason: 'Approved by compliance',
          timestamp: '2026-10-01T14:30:00Z',
        },
      ];

      render(
        <PropertyAuditHistory
          logs={logs}
          propertyTitle="Palm Hills Villa"
          isOpen={true}
          onClose={() => {}}
          isRtl={false}
        />
      );

      expect(screen.getByText('Property Lifecycle Audit Trail')).toBeInTheDocument();
      expect(screen.getByText('Palm Hills Villa')).toBeInTheDocument();
      expect(screen.getByText('Initial submission')).toBeInTheDocument();
      expect(screen.getByText('Approved by compliance')).toBeInTheDocument();
    });
  });
});
