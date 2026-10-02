import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  generateMarketAnalyticsReport,
  evaluatePlatformSecurityHealth,
} from '../../src/services/analytics/market-intelligence-service';
import { MarketAnalyticsDashboard } from '../../src/components/analytics/MarketAnalyticsDashboard';
import { PlatformSecurityCenter } from '../../src/components/operations/PlatformSecurityCenter';
import { Property } from '../../src/types';

describe('Tier 1 — Phase 10-12: Analytics, Operations & Security Governance', () => {
  const mockProperties: Property[] = [
    {
      id: 'p-nc-1',
      title: 'Mivida Residence',
      price: 10000000,
      area: 200,
      location: 'New Cairo',
      compound: 'Mivida',
      bedrooms: 3,
      bathrooms: 3,
      imageUrl: 'https://cdn.hettety.com/mivida.jpg',
      status: 'For Sale',
      isVerified: true,
      threeDTour: {
        id: 'tour-1',
        status: 'ready',
        source: 'hettety_capture',
        representation: { gaussianSplat: { format: 'spz', url: 'https://cdn.hettety.com/tour.spz', sizeBytes: 9000000 } },
        createdAt: '',
        updatedAt: '',
      },
    },
    {
      id: 'p-zayed-1',
      title: 'Palm Hills Villa',
      price: 18000000,
      area: 360,
      location: 'Sheikh Zayed',
      compound: 'Palm Hills',
      bedrooms: 4,
      bathrooms: 4,
      imageUrl: 'https://cdn.hettety.com/palmhills.jpg',
      status: 'For Sale',
      isVerified: true,
    },
    {
      id: 'p-sahel-1',
      title: 'Hacienda Bay Chalet',
      price: 12000000,
      area: 150,
      location: 'North Coast (Sahel)',
      village: 'Hacienda Bay',
      bedrooms: 3,
      bathrooms: 2,
      imageUrl: 'https://cdn.hettety.com/hacienda.jpg',
      status: 'For Sale',
      isVerified: true,
    },
  ];

  describe('Market Intelligence & Macro Analytics', () => {
    it('aggregates total market volume and calculates price per square meter', () => {
      const report = generateMarketAnalyticsReport(mockProperties);
      expect(report.totalProperties).toBe(3);
      expect(report.totalActiveVolumeEGP).toBe(40000000); // 10M + 18M + 12M

      // Average price per sqm:
      // p-nc-1: 10M / 200 = 50,000
      // p-zayed-1: 18M / 360 = 50,000
      // p-sahel-1: 12M / 150 = 80,000
      // Avg: (50000 + 50000 + 80000) / 3 = 60,000
      expect(report.averagePricePerSqmAll).toBe(60000);
      expect(report.threeDTourEngagementLiftMultiplier).toBe(2.4);
    });

    it('generates regional breakdown metrics including rental yields and 3D adoption', () => {
      const report = generateMarketAnalyticsReport(mockProperties);
      expect(report.areaBreakdown.length).toBeGreaterThanOrEqual(4);

      const sahel = report.areaBreakdown.find((a) => a.location.includes('North Coast'));
      expect(sahel).toBeDefined();
      expect(sahel?.averageRentalYieldPercent).toBe(11.2);

      const newCairo = report.areaBreakdown.find((a) => a.location.includes('New Cairo'));
      expect(newCairo).toBeDefined();
      expect(newCairo?.demandTrend).toBe('rising');
    });
  });

  describe('Platform Security Governance & Compliance Audit', () => {
    it('evaluates platform invariants and confirms 100% security checks pass', () => {
      const health = evaluatePlatformSecurityHealth();
      expect(health.uptimePercent).toBeGreaterThanOrEqual(99.9);
      expect(health.securityChecks.length).toBe(5);

      const allPassed = health.securityChecks.every((c) => c.passed);
      expect(allPassed).toBe(true);

      const privacyCheck = health.securityChecks.find((c) => c.id === 'SEC-01');
      expect(privacyCheck?.severity).toBe('critical');
      expect(privacyCheck?.title).toContain('Draft Listing');

      const auditCheck = health.securityChecks.find((c) => c.id === 'SEC-03');
      expect(auditCheck?.details).toContain('property_audit_logs');
    });
  });

  describe('UI Integration — Analytics & Security Dashboards', () => {
    it('renders MarketAnalyticsDashboard with volume, price/sqm, and regional table', () => {
      render(<MarketAnalyticsDashboard properties={mockProperties} isRtl={false} />);

      expect(screen.getByTestId('market-analytics-dashboard')).toBeInTheDocument();
      expect(screen.getByText('Egyptian Real Estate Market Intelligence')).toBeInTheDocument();
      expect(screen.getByText(/40.0M/i)).toBeInTheDocument();
      expect(screen.getAllByText(/60,000/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/2.4x higher viewing-to-offer conversion/i)).toBeInTheDocument();
    });

    it('renders PlatformSecurityCenter with SLA uptime, GPU telemetry, and security checks', () => {
      render(<PlatformSecurityCenter isRtl={false} />);

      expect(screen.getByTestId('platform-security-center')).toBeInTheDocument();
      expect(screen.getByText('HETTETY Security & Governance Center')).toBeInTheDocument();
      expect(screen.getByText(/99.98% Uptime/i)).toBeInTheDocument();
      expect(screen.getByText(/SEC-01/i)).toBeInTheDocument();
      expect(screen.getByText(/SEC-03/i)).toBeInTheDocument();
      expect(screen.getByText(/84.5M EGP/i)).toBeInTheDocument();
    });
  });
});
