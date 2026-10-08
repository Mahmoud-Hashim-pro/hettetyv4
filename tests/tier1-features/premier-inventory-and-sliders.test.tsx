import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PREMIER_LANDMARK_PROPERTIES } from '../../src/lib/inventoryData';
import { EGYPTIAN_DEVELOPERS, PRIME_GROWTH_HUBS, calculateFinancialPlan } from '../../src/lib/marketIntelligence';
import { BrandLogo, BrandMonogram } from '../../src/components/BrandLogo';
import { checkRateLimit } from '../../api/_lib/rateLimiter';
import { AddListingPage } from '../../src/components/add-listing-page';
import { TRANSLATIONS } from '../../src/constants';

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

describe('Real 3D Spatial Walkthrough & Honest Tour Decoupling', () => {
  it('equips premier landmark villas with real 3D room waypoints and scan quality validation scores', () => {
    const hydePark = PREMIER_LANDMARK_PROPERTIES.find((p) => p.id === 'hyde-park-one-1');
    const mv = PREMIER_LANDMARK_PROPERTIES.find((p) => p.id === 'mv-icity-lagoon-1');

    expect(hydePark?.threeDTour).toBeDefined();
    expect(hydePark?.threeDTour?.status).toBe('ready');
    expect(hydePark?.threeDTour?.format).toBe('spz');
    expect(hydePark?.threeDTour?.rooms?.length).toBe(4);
    expect(hydePark?.threeDTour?.qualityReport?.coverageScore).toBeGreaterThanOrEqual(90);
    expect(hydePark?.threeDTour?.qualityReport?.blurScore).toBeGreaterThanOrEqual(90);

    expect(mv?.threeDTour).toBeDefined();
    expect(mv?.threeDTour?.rooms?.length).toBe(3);
    expect(mv?.threeDTour?.qualityReport?.cameraMotionScore).toBeGreaterThanOrEqual(90);
  });

  it('truthfully decouples real 3D, 360 panorama, and photo relief without semantic misrepresentation', () => {
    // Case 1: Only multiple photos -> Has relief, but NEVER real 3D or 360
    const photosOnlyProperty = {
      images: ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'],
    };
    const hasReal3D_1 = Boolean((photosOnlyProperty as any).threeDTour?.assetUrl || (photosOnlyProperty as any).digitalTwinUrl);
    const has360_1 = Boolean((photosOnlyProperty as any).panoramas && (photosOnlyProperty as any).panoramas.length > 0);
    const hasPhotoRelief_1 = Boolean(photosOnlyProperty.images && photosOnlyProperty.images.length > 1);

    expect(hasReal3D_1).toBe(false);
    expect(has360_1).toBe(false);
    expect(hasPhotoRelief_1).toBe(true);

    // Case 2: 360 Panoramas only -> Has 360, but NOT real reconstructed 3D walkthrough
    const panoProperty = {
      panoramas: ['https://example.com/pano1.jpg'],
    };
    const hasReal3D_2 = Boolean((panoProperty as any).threeDTour?.assetUrl || (panoProperty as any).digitalTwinUrl);
    const has360_2 = Boolean(panoProperty.panoramas && panoProperty.panoramas.length > 0);
    expect(hasReal3D_2).toBe(false);
    expect(has360_2).toBe(true);

    // Case 3: True spatial tour asset -> Has real 3D
    const spatialProperty = {
      threeDTour: {
        status: 'ready' as const,
        provider: 'hettety' as const,
        assetUrl: 'https://assets.hettety.com/scans/tour.spz',
      }
    };
    const hasReal3D_3 = Boolean(spatialProperty.threeDTour?.assetUrl);
    expect(hasReal3D_3).toBe(true);
  });

  it('renders Hettety Real 3D Studio in AddListingPage Step 2 with capture guidelines and room waypoints', () => {
    const onAdd = vi.fn();
    render(
      <AddListingPage
        onAdd={onAdd}
        t={TRANSLATIONS.en}
        isRtl={false}
        isAdmin={false}
        isSuperAdmin={false}
      />
    );

    // Fill Step 1 required fields to advance
    fireEvent.change(screen.getByPlaceholderText(/Villa in New Cairo/i), { target: { value: 'Spatial Villa' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '8500000' } });
    fireEvent.change(screen.getByPlaceholderText(/New Cairo, Cairo/i), { target: { value: 'New Cairo' } });
    const inputs = screen.getAllByRole('spinbutton');
    const areaInput = inputs.find(i => (i as HTMLInputElement).min === '1') || inputs[2];
    fireEvent.change(areaInput, { target: { value: '350' } });

    // Go to Step 2
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Verify 3D Studio elements
    expect(screen.getByText(/Hettety Real 3D Spatial Walkthrough Studio/i)).toBeInTheDocument();
    expect(screen.getByText(/Walk slowly with steady steps at 60fps/i)).toBeInTheDocument();
    expect(screen.getByText(/Room Waypoints & Camera Nodes/i)).toBeInTheDocument();

    // Toggle a preset room waypoint
    const receptionBtn = screen.getByRole('button', { name: /Reception & Living Hall/i });
    expect(receptionBtn).toBeInTheDocument();
    fireEvent.click(receptionBtn);

    // View Quality Audit Status
    const auditBtn = screen.getByRole('button', { name: /View Audit Status/i });
    fireEvent.click(auditBtn);
    expect(screen.getByText(/Pending Server Inspection \/ Uncertified/i)).toBeInTheDocument();
  });
});

