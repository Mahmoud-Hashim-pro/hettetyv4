import { describe, it, expect } from 'vitest';
import { calculatePropertyFit } from '../../src/components/RealEstateAdvisor';
import { AdvisorFinancialProfile, Property } from '../../src/types';

const unit = (over: Partial<Property> = {}): Property => ({
  id: 'p1',
  title: 'Test unit',
  price: 5_000_000,
  location: 'New Cairo',
  bedrooms: 2,
  bathrooms: 2,
  area: 120,
  propertyType: 'Apartment',
  status: 'For Sale',
  isVerified: false,
  verificationStatus: 'Pending',
  imageUrl: 'x',
  ...over,
});

const profile = (over: Partial<AdvisorFinancialProfile> = {}): AdvisorFinancialProfile => ({
  budget: 6_000_000,
  downPayment: 1_000_000,
  monthlyCapacity: 50_000,
  currency: 'EGP',
  purpose: 'residential',
  preferredLocation: 'New Cairo',
  propertyType: 'Apartment',
  deliveryTimeline: 'all',
  ...over,
});

describe('Tier 1 — the advisor can tell a finished unit from an off-plan one', () => {
  const wantsReady = profile({ deliveryTimeline: 'ready' });

  it('scores a ready unit above one that is years away', () => {
    // Property carries the handover in deliveryDate ("Handover date, or Ready").
    const ready = calculatePropertyFit(unit({ deliveryDate: 'Ready to move' }), wantsReady, false);
    const offPlan = calculatePropertyFit(unit({ deliveryDate: '2029' }), wantsReady, false);
    expect(ready.matchScore).toBeGreaterThan(offPlan.matchScore);
  });

  it('tells the buyer why, rather than moving the number silently', () => {
    const ready = calculatePropertyFit(unit({ deliveryDate: 'Ready' }), wantsReady, false);
    expect(ready.reasons.join(' ')).toMatch(/ready to move/i);
  });

  it('says it in Arabic too', () => {
    const ready = calculatePropertyFit(unit({ deliveryDate: 'Ready' }), wantsReady, true);
    expect(ready.reasons.join(' ')).toContain('جاهز للاستلام');
  });

  it('does not punish a unit when the buyer has no preference', () => {
    const anyTime = profile({ deliveryTimeline: 'all' });
    const withDate = calculatePropertyFit(unit({ deliveryDate: '2029' }), anyTime, false);
    const noDate = calculatePropertyFit(unit(), anyTime, false);
    expect(withDate.matchScore).toBe(noDate.matchScore);
  });

  it('treats a unit with no handover stated as not-known, not as ready', () => {
    // Claiming immediate handover we cannot evidence is the expensive mistake.
    const unknown = calculatePropertyFit(unit(), wantsReady, false);
    expect(unknown.reasons.join(' ')).not.toMatch(/ready to move/i);
  });
});
