import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PREMIER_LANDMARK_PROPERTIES } from '../../src/lib/inventoryData';
import { EGYPTIAN_DEVELOPERS, PRIME_GROWTH_HUBS, calculateFinancialPlan } from '../../src/lib/marketIntelligence';
import { BrandLogo, BrandMonogram } from '../../src/components/BrandLogo';
import { checkRateLimit } from '../../api/_lib/rateLimiter';

describe('Premier Landmark Inventory & Market Intelligence', () => {
  it('exports landmark properties with 3D digital twins and valid payment structures', () => {
    expect(PREMIER_LANDMARK_PROPERTIES.length).toBeGreaterThanOrEqual(4);

    const hydePark = PREMIER_LANDMARK_PROPERTIES.find((p) => p.compound?.includes('Hyde Park'));
    const mountainView = PREMIER_LANDMARK_PROPERTIES.find((p) => p.developer?.includes('Mountain View'));
    const sodic = PREMIER_LANDMARK_PROPERTIES.find((p) => p.developer === 'SODIC');

    expect(hydePark).toBeDefined();
    expect(mountainView).toBeDefined();
    expect(sodic).toBeDefined();

    PREMIER_LANDMARK_PROPERTIES.forEach((prop) => {
      expect(prop.price).toBeGreaterThan(0);
      expect(prop.location).toBeDefined();
      expect(prop.verificationStatus).toBe('Verified');
      // Has 3D virtual tour or 360 panorama capability
      const hasTour = Boolean(prop.digitalTwinUrl || (prop.panoramas && prop.panoramas.length > 0));
      expect(hasTour).toBe(true);
      expect(prop.deliveryTimeline).toBeDefined();
    });
  });

  it('contains comprehensive developer intelligence and growth hubs', () => {
    expect(EGYPTIAN_DEVELOPERS.length).toBeGreaterThanOrEqual(8);
    const emaar = EGYPTIAN_DEVELOPERS.find((d) => d.id === 'Emaar Misr');
    expect(emaar).toBeDefined();
    expect(emaar?.avgAnnualAppreciation).toBeGreaterThan(0);

    expect(PRIME_GROWTH_HUBS.length).toBeGreaterThanOrEqual(3);
    const newCairo = PRIME_GROWTH_HUBS.find((h) => h.id === 'New Cairo');
    expect(newCairo).toBeDefined();
    expect(newCairo?.expectedRentalYield).toBeGreaterThan(0);
  });

  it('calculates financial returns and yields with Egyptian market metrics', () => {
    const plan = calculateFinancialPlan({
      budget: 10000000,
      downPayment: 2000000,
      monthlyCapacity: 80000,
      targetDistrict: 'New Cairo',
      horizonYears: 7,
    });

    expect(plan.annualRentalYieldEgp).toBeGreaterThan(0);
    expect(plan.estimatedCapitalGrowthEgp).toBeGreaterThan(0);
    expect(plan.netTotalReturnEgp).toBeGreaterThan(plan.annualRentalYieldEgp);
    expect(plan.recommendedDevelopers.length).toBeGreaterThan(0);
    expect(plan.paybackYears).toBeGreaterThan(0);
  });
});

describe('Brand Identity — Slanted HT Monogram & Logo', () => {
  it('renders BrandLogo with monogram, HETTETY brand name and tagline', () => {
    render(<BrandLogo isRtl={false} size="md" showTagline={true} />);
    expect(screen.getByText('HETTETY')).toBeInTheDocument();
    expect(screen.getByText('FIND. TRUST. OWN.')).toBeInTheDocument();
  });

  it('renders BrandMonogram with slanted italic geometry', () => {
    const { container } = render(<BrandMonogram size={48} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    // Skew transform represents forward italic slant
    const skewedGroup = container.querySelector('g[transform*="skewX(-14)"]');
    expect(skewedGroup).toBeInTheDocument();
  });

  it('adapts logo in Arabic RTL mode', () => {
    render(<BrandLogo isRtl={true} size="lg" showTagline={true} />);
    expect(screen.getByText('HETTETY')).toBeInTheDocument();
    expect(screen.getByText('ابحث. ثق. امتلك.')).toBeInTheDocument();
  });
});

describe('API Security — Rate Limiter', () => {
  it('allows requests within threshold and blocks with 429 when quota exceeded', () => {
    const testIp = `test-ip-${Date.now()}`;
    const limit = 5;

    for (let i = 0; i < limit; i++) {
      const res = checkRateLimit(testIp, limit);
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(limit - 1 - i);
    }

    // Exceeded
    const blockedRes = checkRateLimit(testIp, limit);
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.remaining).toBe(0);
    expect(blockedRes.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    // Different IP should still be allowed
    const otherIpRes = checkRateLimit(`other-ip-${Date.now()}`, limit);
    expect(otherIpRes.allowed).toBe(true);
  });
});
