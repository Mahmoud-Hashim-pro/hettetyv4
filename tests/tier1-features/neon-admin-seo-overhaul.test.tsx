import React from 'react';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AdminPortalApp } from '../../src/features/admin/AdminPortalApp';
import {
  adminPortalService,
  computeOverviewMetrics,
} from '../../src/features/admin/services/adminPortalService';
import {
  DEFAULT_SYSTEM_SETTINGS,
  AdminSnapshotData,
  UserAccountRecord,
  AuditLogEntry,
} from '../../src/features/admin/types';
import {
  FilterPropertiesUseCase,
  DEFAULT_PROPERTY_FILTER_CRITERIA,
  filterAndSortProperties,
  PropertySpecification,
} from '../../src/core/use-cases/FilterPropertiesUseCase';
import {
  SeoManager,
  SEO_JSONLD_SCRIPT_ID,
  buildPageSeoMetadata,
} from '../../src/infrastructure/seo/SeoManager';
import { RealEstateAdvisor } from '../../src/components/RealEstateAdvisor';
import { createGeminiProvider } from '../../api/_lib/gemini';
import { buildAdvisorHealthStatus } from '../../api/ai';
import { getActiveRateLimiterBackend } from '../../api/_lib/rateLimiter';
import { Property } from '../../src/types';
import { TRANSLATIONS } from '../../src/constants';
import * as firebase from '../../src/firebase';

const SAMPLE_USERS: UserAccountRecord[] = [
  {
    id: 'usr-super-1',
    uid: 'usr-super-1',
    email: 'tie3500@gmail.com',
    name: 'Tarek Super Admin',
    role: 'super_admin',
    kycStatus: 'verified',
    isSuspended: false,
    createdAt: '2026-01-10T10:00:00.000Z',
    lastLoginAt: '2026-11-20T12:00:00.000Z',
    accounts: 1,
    accountIds: ['usr-super-1'],
  },
  {
    id: 'usr-buyer-2',
    uid: 'usr-buyer-2',
    email: 'buyer@hettety.com',
    name: 'Nadia Hassan',
    role: 'buyer',
    kycStatus: 'pending',
    isSuspended: false,
    createdAt: '2026-02-14T08:00:00.000Z',
    lastLoginAt: '2026-11-19T16:30:00.000Z',
    accounts: 1,
    accountIds: ['usr-buyer-2'],
  },
];

const SAMPLE_PROPERTIES: Property[] = [
  {
    id: 'prop-nc-3d-verified',
    title: 'Golden Square Smart Villa',
    description: 'Luxury 5BR villa with real 3D Gaussian Splatting walkthrough.',
    price: 20_000_000, // 40,000 EGP/m²
    currency: 'EGP',
    location: 'New Cairo, Egypt',
    compound: 'Mivida',
    developer: 'Emaar Misr',
    propertyType: 'Villa',
    bedrooms: 5,
    bathrooms: 5,
    area: 500,
    finishing: 'Fully Finished',
    deliveryDate: 'Ready',
    deliveryTimeline: 'ready',
    status: 'For Sale',
    availability: 'Available',
    listingState: 'Live',
    isVerified: true,
    verificationStatus: 'Verified',
    imageUrl: 'https://cdn.hettety.com/villa-1.jpg',
    images: ['https://cdn.hettety.com/villa-1.jpg'],
    threeDTour: {
      assetUrl: 'https://cdn.hettety.com/tours/villa-1.spz',
      format: 'spz',
      status: 'ready',
    } as any,
    paymentMethods: ['Cash', 'Installments'],
    amenities: ['Pool', 'Security'],
    publishDate: '2026-06-01',
    lat: 30.025,
    lng: 31.491,
  },
  {
    id: 'prop-zayed-pending',
    title: 'Zayed Park Apartment',
    description: 'Spacious 3BR semi-finished apartment in Sheikh Zayed.',
    price: 9_000_000, // 30,000 EGP/m²
    currency: 'EGP',
    location: 'Sheikh Zayed, Egypt',
    compound: 'Zed West',
    developer: 'Ora Developers',
    propertyType: 'Apartment',
    bedrooms: 3,
    bathrooms: 3,
    area: 300,
    finishing: 'Semi Finished',
    deliveryDate: '2027-06-01',
    deliveryTimeline: '1-2years',
    status: 'For Sale',
    availability: 'Available',
    listingState: 'Live',
    isVerified: false,
    verificationStatus: 'Pending',
    imageUrl: 'https://cdn.hettety.com/apt-2.jpg',
    images: ['https://cdn.hettety.com/apt-2.jpg'],
    paymentMethods: ['Installments'],
    amenities: ['Park', 'Gym'],
    publishDate: '2026-07-01',
  },
  {
    id: 'prop-sahel-rent',
    title: 'Marassi Lagoon Chalet',
    description: 'Summer chalet for seasonal rent with verified title.',
    price: 120_000, // 1,000 EGP/m²
    currency: 'EGP',
    location: 'North Coast, Egypt',
    compound: 'Marassi',
    developer: 'Emaar Misr',
    propertyType: 'Chalet',
    bedrooms: 2,
    bathrooms: 2,
    area: 120,
    finishing: 'Fully Finished',
    deliveryDate: 'Ready',
    deliveryTimeline: 'ready',
    status: 'For Rent',
    availability: 'Available',
    listingState: 'Live',
    isVerified: true,
    verificationStatus: 'Verified',
    imageUrl: 'https://cdn.hettety.com/chalet-3.jpg',
    images: ['https://cdn.hettety.com/chalet-3.jpg'],
    digitalTwinUrl: 'https://cdn.hettety.com/twins/chalet-3',
    paymentMethods: ['Cash'],
    amenities: ['Lagoon', 'Beach'],
    publishDate: '2026-08-01',
    yallaSahel: true,
    village: 'Marassi',
  },
];

const SAMPLE_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'aud-1',
    actorId: 'usr-super-1',
    actorEmail: 'tie3500@gmail.com',
    actorRole: 'super_admin',
    action: 'PROPERTY_VERIFIED',
    resourceType: 'property',
    resourceId: 'prop-nc-3d-verified',
    summary: 'Verified Golden Square Smart Villa',
    beforeState: { verificationStatus: 'Pending' },
    afterState: { verificationStatus: 'Verified' },
    createdAt: '2026-11-20T10:00:00.000Z',
  },
];

function buildMockSnapshot(
  properties: Property[] = SAMPLE_PROPERTIES,
  users: UserAccountRecord[] = SAMPLE_USERS,
  neonOnline = true
): AdminSnapshotData {
  const settings = { ...DEFAULT_SYSTEM_SETTINGS };
  const metrics = computeOverviewMetrics({
    users,
    properties,
    purchases: [],
    transactions: [],
    reports: [],
    reviewDocs: [],
    reconstructionJobs: [],
    settings,
    neonOnline,
    neonLatencyMs: 24,
  });

  return {
    users,
    properties,
    purchases: [],
    transactions: [],
    reports: [],
    reviewDocs: [],
    contactMessages: [],
    alertSubscriptions: [],
    reconstructionJobs: [],
    auditLogs: SAMPLE_AUDIT_LOGS,
    settings,
    metrics,
  };
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('HETTETY v4 — Neon Postgres, Standalone Admin OS, SOLID Filters, SEO & Fixed AI Advisor', () => {
  const originalFetch = globalThis.fetch;
  const envSnapshot = { ...process.env };
  const activeSpies: Array<{ mockRestore: () => void }> = [];

  const trackSpy = <T extends { mockRestore: () => void }>(spy: T): T => {
    activeSpies.push(spy);
    return spy;
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    while (activeSpies.length > 0) {
      activeSpies.pop()?.mockRestore();
    }
    globalThis.fetch = originalFetch;

    // Restore mutated env vars without disturbing unrelated runtime vars
    for (const key of [
      'GEMINI_API_KEY',
      'VITE_GEMINI_API_KEY',
      'AI_PROVIDER',
      'AI_MODEL',
      'AI_FALLBACK_MODEL',
      'DATABASE_URL',
      'POSTGRES_URL',
      'NEON_DATABASE_URL',
      'REDIS_URL',
      'NODE_ENV',
    ]) {
      if (envSnapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envSnapshot[key];
      }
    }

    // Clean SEO head tags created by SeoManager tests
    document.title = '';
    document.head
      .querySelectorAll(
        `meta[name="description"], meta[name="robots"], link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"], #${SEO_JSONLD_SCRIPT_ID}`
      )
      .forEach((el) => el.remove());
  });

  // =========================================================================
  // 1. Standalone 10-Page Enterprise Admin Portal (AdminPortalApp)
  // =========================================================================
  describe('1. Standalone 10-Page Enterprise Admin Portal (AdminPortalApp)', () => {
    const stubAdminPortalSideEffects = (snapshotFactory: () => AdminSnapshotData) => {
      trackSpy(
        vi
          .spyOn(adminPortalService, 'loadDashboardSnapshot')
          .mockImplementation(async () => snapshotFactory())
      );
      trackSpy(
        vi.spyOn(adminPortalService, 'checkNeonHealth').mockResolvedValue({
          connected: true,
          backend: 'neon_postgres',
          latencyMs: 18,
          schemaVersion: 'v4.0-neon-enterprise',
          tables: [
            { name: 'users', status: 'ready', rowCount: SAMPLE_USERS.length },
            { name: 'properties', status: 'ready', rowCount: SAMPLE_PROPERTIES.length },
          ],
          checkedAt: new Date().toISOString(),
          details: 'Connected directly to Neon Serverless PostgreSQL.',
          detailsAr: 'تم الاتصال المباشر بقاعدة بيانات Neon Serverless PostgreSQL بنجاح.',
        })
      );
      trackSpy(
        vi.spyOn(adminPortalService, 'checkAdvisorHealth').mockResolvedValue({
          healthy: true,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          fallbackModel: 'gemini-2.0-flash',
          rateLimiterBackend: 'neon_postgres',
          hasApiKey: true,
          latencyMs: 12,
          timestamp: new Date().toISOString(),
          diagnostics: 'Ready on gemini (gemini-2.5-flash).',
        })
      );
      trackSpy(
        vi.spyOn(adminPortalService, 'fetchReconstructionMetrics').mockResolvedValue({
          online: true,
          latencyMs: 15,
          metrics: {
            activeWorkersCount: 2,
            activeWorkers: [],
            queueLatency: { samples: 3, avgSeconds: 4, lastSeconds: 3, minSeconds: 2, maxSeconds: 6 },
            jobFailureCounters: {},
            totalJobs: { queued: 0, ready: 1, failed: 0, cancelled: 0 },
          },
        })
      );
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('User-agent: *\nAllow: /\nDisallow: /admin\n', { status: 200 })
      ) as any;
    };

    it('renders full-viewport standalone shell in English LTR with all 10 module buttons, live Neon Postgres status pill, and onExitAdmin action', async () => {
      stubAdminPortalSideEffects(() => buildMockSnapshot());
      const onExitAdmin = vi.fn();

      render(
        <AdminPortalApp
          isRtl={false}
          isSuperAdmin={true}
          userEmail="tie3500@gmail.com"
          userName="Tarek Super Admin"
          onExitAdmin={onExitAdmin}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('admin-overview-page')).toBeInTheDocument();
      });

      const portal = screen.getByTestId('hettety-admin-portal');
      expect(portal).toHaveAttribute('dir', 'ltr');

      const nav = screen.getByRole('navigation', { name: 'Admin Portal Navigation' });
      const navButtons = within(nav).getAllByRole('button');
      expect(navButtons).toHaveLength(10);

      const expectedEnglishModules = [
        'Executive Overview',
        'Properties CMS',
        'Verification Queue',
        '3D Pipeline Ops',
        'Escrow & Deals',
        'Users & RBAC',
        'CRM & Reports',
        'AI Advisor Ops',
        'Analytics & SEO',
        'Audit & Neon DB',
      ];
      for (const label of expectedEnglishModules) {
        expect(within(nav).getByText(label)).toBeInTheDocument();
      }

      // Live Neon Postgres status pill
      const neonPillButton = screen.getByRole('button', { name: /Neon Postgres/i });
      expect(neonPillButton).toBeInTheDocument();
      expect(within(neonPillButton).getByText('LIVE')).toBeInTheDocument();

      // Return to Public Site button triggers onExitAdmin
      const exitBtn = screen.getByTestId('admin-return-public-btn');
      expect(exitBtn).toHaveTextContent('Return to Public Site');
      fireEvent.click(exitBtn);
      expect(onExitAdmin).toHaveBeenCalledTimes(1);
    });

    it('renders full-viewport standalone shell in Arabic RTL with localized 10 module nav buttons, Neon pill, and exit action', async () => {
      stubAdminPortalSideEffects(() => buildMockSnapshot());
      const onExitAdmin = vi.fn();

      render(
        <AdminPortalApp
          isRtl={true}
          isSuperAdmin={true}
          userEmail="tie3500@gmail.com"
          userName="طارق المدير"
          onExitAdmin={onExitAdmin}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('admin-overview-page')).toBeInTheDocument();
      });

      const portal = screen.getByTestId('hettety-admin-portal');
      expect(portal).toHaveAttribute('dir', 'rtl');

      const nav = screen.getByRole('navigation', { name: 'قائمة بوابة الإدارة' });
      const navButtons = within(nav).getAllByRole('button');
      expect(navButtons).toHaveLength(10);

      const expectedArabicModules = [
        'النظرة التنفيذية',
        'إدارة العقارات',
        'المراجعة والتوثيق',
        'عمليات المسح 3D',
        'الضمان والصفقات',
        'المستخدمون والصلاحيات',
        'الـ CRM والبلاغات',
        'عمليات المستشار الذكي',
        'التحليلات والـ SEO',
        'التدقيق وإعدادات نيون',
      ];
      for (const label of expectedArabicModules) {
        expect(within(nav).getByText(label)).toBeInTheDocument();
      }

      // Live Neon Postgres status pill in Arabic
      const neonPillButton = screen.getByRole('button', { name: /Neon Postgres/i });
      expect(within(neonPillButton).getByText('مباشر')).toBeInTheDocument();

      // Exit button in Arabic
      const exitBtn = screen.getByTestId('admin-return-public-btn');
      expect(exitBtn).toHaveTextContent('العودة للموقع');
      fireEvent.click(exitBtn);
      expect(onExitAdmin).toHaveBeenCalledTimes(1);
    });

    it('switches cleanly across all 10 modules and renders the RBAC Permissions Matrix in Users & RBAC', async () => {
      stubAdminPortalSideEffects(() => buildMockSnapshot());

      render(
        <AdminPortalApp
          isRtl={false}
          isSuperAdmin={true}
          userEmail="tie3500@gmail.com"
          userName="Tarek Super Admin"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('admin-overview-page')).toBeInTheDocument();
      });

      const nav = screen.getByRole('navigation', { name: 'Admin Portal Navigation' });
      const moduleSequence: Array<{ label: string; testId: string }> = [
        { label: 'Properties CMS', testId: 'admin-properties-page' },
        { label: 'Verification Queue', testId: 'admin-verification-queue-page' },
        { label: '3D Pipeline Ops', testId: 'admin-reconstruction-ops-page' },
        { label: 'Escrow & Deals', testId: 'admin-escrow-page' },
        { label: 'Users & RBAC', testId: 'admin-users-rbac-page' },
        { label: 'CRM & Reports', testId: 'admin-crm-reports-page' },
        { label: 'AI Advisor Ops', testId: 'admin-ai-ops-page' },
        { label: 'Analytics & SEO', testId: 'admin-analytics-seo-page' },
        { label: 'Audit & Neon DB', testId: 'admin-audit-settings-page' },
        { label: 'Executive Overview', testId: 'admin-overview-page' },
      ];

      for (const mod of moduleSequence) {
        fireEvent.click(within(nav).getByText(mod.label));
        await waitFor(() => {
          expect(screen.getByTestId(mod.testId)).toBeInTheDocument();
        });

        if (mod.testId === 'admin-users-rbac-page') {
          expect(screen.getByText('Interactive RBAC Permissions Matrix')).toBeInTheDocument();
          expect(screen.getByText('Platform Capability')).toBeInTheDocument();
          expect(screen.getByText('tie3500@gmail.com')).toBeInTheDocument();
          expect(screen.getByText('buyer@hettety.com')).toBeInTheDocument();
        }
      }
    });

    it('requires typing exact RESET before unlocking "Reset All Properties (Keep Users)" and preserves users on execution', async () => {
      let currentProps = [...SAMPLE_PROPERTIES];
      const currentUsers = [...SAMPLE_USERS];

      stubAdminPortalSideEffects(() => buildMockSnapshot(currentProps, currentUsers, true));
      const onPropertiesChanged = vi.fn();

      const resetSpy = trackSpy(
        vi.spyOn(adminPortalService, 'resetPropertiesKeepUsers').mockImplementation(async () => {
          const deletedCount = currentProps.length;
          currentProps = [];
          return {
            success: true,
            deletedProperties: deletedCount,
            preservedUsers: currentUsers.length,
            timestamp: new Date().toISOString(),
            backend: 'neon_postgres',
            message: `Deleted ${deletedCount} properties while preserving ${currentUsers.length} users.`,
          };
        })
      );

      render(
        <AdminPortalApp
          isRtl={false}
          isSuperAdmin={true}
          userEmail="tie3500@gmail.com"
          userName="Tarek Super Admin"
          onPropertiesChanged={onPropertiesChanged}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('admin-overview-page')).toBeInTheDocument();
      });

      // Navigate to Audit & Neon DB -> Neon DB & Danger Zone sub-tab
      const nav = screen.getByRole('navigation', { name: 'Admin Portal Navigation' });
      fireEvent.click(within(nav).getByText('Audit & Neon DB'));
      await waitFor(() => {
        expect(screen.getByTestId('admin-audit-settings-page')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Neon DB & Danger Zone/i }));
      const dangerZone = await screen.findByTestId('neon-danger-zone');
      expect(within(dangerZone).getByText('3 Properties')).toBeInTheDocument();
      expect(within(dangerZone).getByText('2 Users & Admins')).toBeInTheDocument();

      const confirmInput = screen.getByTestId('reset-confirmation-input');
      const executeBtn = screen.getByTestId('execute-reset-properties-btn');

      // Disabled initially and for non-exact confirmation strings
      expect(executeBtn).toBeDisabled();
      fireEvent.change(confirmInput, { target: { value: 'reset' } });
      expect(executeBtn).toBeDisabled();
      fireEvent.change(confirmInput, { target: { value: 'DELETE' } });
      expect(executeBtn).toBeDisabled();

      // Enabled strictly when exact "RESET" is entered
      fireEvent.change(confirmInput, { target: { value: 'RESET' } });
      expect(executeBtn).toBeEnabled();

      fireEvent.click(executeBtn);

      await waitFor(() => {
        expect(resetSpy).toHaveBeenCalledWith('tie3500@gmail.com');
        expect(screen.getByTestId('reset-properties-receipt')).toBeInTheDocument();
      });

      expect(onPropertiesChanged).toHaveBeenCalledTimes(1);
      const receipt = screen.getByTestId('reset-properties-receipt');
      expect(receipt).toHaveTextContent('Deleted Properties: 3');
      expect(receipt).toHaveTextContent('Preserved Users: 2');

      // Post-reset UI reflects 0 properties and still 2 preserved users
      await waitFor(() => {
        expect(within(dangerZone).getByText('0 Properties')).toBeInTheDocument();
        expect(within(dangerZone).getByText('2 Users & Admins')).toBeInTheDocument();
      });
    });

    it('restricts Danger Zone reset to Super Admins and ensures adminPortalService.resetPropertiesKeepUsers never deletes users', async () => {
      stubAdminPortalSideEffects(() => buildMockSnapshot());

      render(
        <AdminPortalApp
          isRtl={false}
          isSuperAdmin={false}
          userEmail="ops@hettety.com"
          userName="Ops Admin"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('admin-overview-page')).toBeInTheDocument();
      });

      const nav = screen.getByRole('navigation', { name: 'Admin Portal Navigation' });
      fireEvent.click(within(nav).getByText('Audit & Neon DB'));
      await waitFor(() => {
        expect(screen.getByTestId('admin-audit-settings-page')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /Neon DB & Danger Zone/i }));

      expect(screen.queryByTestId('execute-reset-properties-btn')).not.toBeInTheDocument();
      expect(
        screen.getByText(/restricted to Super Admin accounts only/i)
      ).toBeInTheDocument();

      // Directly verify adminPortalService.resetPropertiesKeepUsers adapter path
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as any;
      trackSpy(
        vi.spyOn(firebase, 'collection').mockImplementation((_db: any, name: string) => ({ name }) as any)
      );
      trackSpy(
        vi.spyOn(firebase, 'doc').mockImplementation((_db: any, col: string, id: string) => ({ col, id }) as any)
      );
      trackSpy(
        vi.spyOn(firebase, 'getDocs').mockImplementation(async (colRef: any) => {
          if (colRef?.name === 'properties') {
            return {
              docs: SAMPLE_PROPERTIES.map((p) => ({ id: p.id, data: () => p })),
            } as any;
          }
          if (colRef?.name === 'users') {
            return {
              docs: SAMPLE_USERS.map((u) => ({ id: u.id, data: () => u })),
            } as any;
          }
          return { docs: [] } as any;
        })
      );
      const deleteSpy = trackSpy(vi.spyOn(firebase, 'deleteDoc').mockResolvedValue(undefined));

      const result = await adminPortalService.resetPropertiesKeepUsers('tie3500@gmail.com');

      expect(result.success).toBe(true);
      expect(result.deletedProperties).toBe(SAMPLE_PROPERTIES.length);
      expect(result.preservedUsers).toBe(SAMPLE_USERS.length);
      expect(deleteSpy).toHaveBeenCalledTimes(SAMPLE_PROPERTIES.length);
      for (const call of deleteSpy.mock.calls) {
        const refArg = call[0] as unknown as { col: string; id: string };
        expect(refArg.col).toBe('properties');
        expect(refArg.col).not.toBe('users');
      }
    });
  });

  // =========================================================================
  // 2. SOLID FilterPropertiesUseCase
  // =========================================================================
  describe('2. SOLID FilterPropertiesUseCase', () => {
    it('returns strictly [] on empty inventory with zero demo property fallback', () => {
      const useCase = new FilterPropertiesUseCase();

      expect(useCase.filter([], DEFAULT_PROPERTY_FILTER_CRITERIA)).toEqual([]);
      expect(useCase.execute([], DEFAULT_PROPERTY_FILTER_CRITERIA)).toEqual([]);
      expect(
        filterAndSortProperties([], {
          ...DEFAULT_PROPERTY_FILTER_CRITERIA,
          query: 'New Cairo',
          verifiedOnly: true,
          sortBy: 'price-per-sqm-asc',
        })
      ).toEqual([]);
    });

    it('filters accurately by has3DOnly, verifiedOnly, minBedrooms, listingStatus, finishing, and minArea/maxArea', () => {
      const useCase = new FilterPropertiesUseCase();

      // has3DOnly: matches threeDTour.assetUrl (prop-nc-3d-verified) & digitalTwinUrl (prop-sahel-rent)
      const with3D = useCase.execute(SAMPLE_PROPERTIES, {
        ...DEFAULT_PROPERTY_FILTER_CRITERIA,
        has3DOnly: true,
      });
      expect(with3D.map((p) => p.id)).toEqual(['prop-nc-3d-verified', 'prop-sahel-rent']);

      // verifiedOnly
      const verified = useCase.execute(SAMPLE_PROPERTIES, {
        ...DEFAULT_PROPERTY_FILTER_CRITERIA,
        verifiedOnly: true,
      });
      expect(verified.map((p) => p.id)).toEqual(['prop-nc-3d-verified', 'prop-sahel-rent']);

      // minBedrooms >= 3
      const threePlusBeds = useCase.execute(SAMPLE_PROPERTIES, {
        ...DEFAULT_PROPERTY_FILTER_CRITERIA,
        minBedrooms: 3,
      });
      expect(threePlusBeds.map((p) => p.id)).toEqual(['prop-nc-3d-verified', 'prop-zayed-pending']);

      // listingStatus = 'For Rent'
      const forRent = useCase.execute(SAMPLE_PROPERTIES, {
        ...DEFAULT_PROPERTY_FILTER_CRITERIA,
        listingStatus: 'For Rent',
      });
      expect(forRent.map((p) => p.id)).toEqual(['prop-sahel-rent']);

      // finishing = 'Semi Finished'
      const semiFinished = useCase.execute(SAMPLE_PROPERTIES, {
        ...DEFAULT_PROPERTY_FILTER_CRITERIA,
        finishing: 'Semi Finished',
      });
      expect(semiFinished.map((p) => p.id)).toEqual(['prop-zayed-pending']);

      // minArea & maxArea range [200..400]
      const midArea = useCase.execute(SAMPLE_PROPERTIES, {
        ...DEFAULT_PROPERTY_FILTER_CRITERIA,
        minArea: '200',
        maxArea: '400',
      });
      expect(midArea.map((p) => p.id)).toEqual(['prop-zayed-pending']);

      // Combined compound facets: For Sale + Verified + Fully Finished + 3D + minBedrooms 4 + minArea 400
      const combined = useCase.execute(SAMPLE_PROPERTIES, {
        ...DEFAULT_PROPERTY_FILTER_CRITERIA,
        listingStatus: 'For Sale',
        verifiedOnly: true,
        finishing: 'Fully Finished',
        has3DOnly: true,
        minBedrooms: 4,
        minArea: '400',
        maxArea: '600',
      });
      expect(combined.map((p) => p.id)).toEqual(['prop-nc-3d-verified']);
    });

    it('sorts accurately by price-per-sqm-asc and area-desc without mutating input array', () => {
      const useCase = new FilterPropertiesUseCase();
      const inputOrder = [SAMPLE_PROPERTIES[0], SAMPLE_PROPERTIES[1], SAMPLE_PROPERTIES[2]];

      // Price/m²: prop-sahel-rent (1,000), prop-zayed-pending (30,000), prop-nc-3d-verified (40,000)
      const byPricePerSqm = useCase.execute(inputOrder, {
        ...DEFAULT_PROPERTY_FILTER_CRITERIA,
        sortBy: 'price-per-sqm-asc',
      });
      expect(byPricePerSqm.map((p) => p.id)).toEqual([
        'prop-sahel-rent',
        'prop-zayed-pending',
        'prop-nc-3d-verified',
      ]);

      // Area desc: 500 -> 300 -> 120
      const byAreaDesc = useCase.execute([SAMPLE_PROPERTIES[2], SAMPLE_PROPERTIES[1], SAMPLE_PROPERTIES[0]], {
        ...DEFAULT_PROPERTY_FILTER_CRITERIA,
        sortBy: 'area-desc',
      });
      expect(byAreaDesc.map((p) => p.id)).toEqual([
        'prop-nc-3d-verified',
        'prop-zayed-pending',
        'prop-sahel-rent',
      ]);

      // Original input array untouched
      expect(inputOrder.map((p) => p.id)).toEqual([
        'prop-nc-3d-verified',
        'prop-zayed-pending',
        'prop-sahel-rent',
      ]);
    });

    it('supports Open-Closed extension via registerSpecification without modifying core logic', () => {
      const useCase = new FilterPropertiesUseCase();
      const emaarOnlySpec: PropertySpecification = {
        name: 'emaarOnly',
        isActive: () => true,
        isSatisfiedBy: (p) => p.developer === 'Emaar Misr',
      };
      useCase.registerSpecification(emaarOnlySpec);

      const res = useCase.execute(SAMPLE_PROPERTIES, DEFAULT_PROPERTY_FILTER_CRITERIA);
      expect(res.map((p) => p.id)).toEqual(['prop-nc-3d-verified', 'prop-sahel-rent']);
    });
  });

  // =========================================================================
  // 3. Technical SEO (SeoManager)
  // =========================================================================
  describe('3. Technical SEO (SeoManager & buildPageSeoMetadata)', () => {
    it('sets dynamic title, description, canonical, og:title, and robots directives (noindex on private routes; index, follow on public routes)', () => {
      const manager = new SeoManager('https://hettety.vercel.app');

      // Private Admin route -> noindex, nofollow
      const adminMeta = buildPageSeoMetadata('manage-users', { isRtl: false });
      manager.apply(adminMeta);
      expect(document.title).toContain('Admin Operations Command Center');
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
        'noindex, nofollow'
      );
      expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        'https://hettety.vercel.app/#manage-users'
      );

      // Login route -> noindex, nofollow
      const loginMeta = buildPageSeoMetadata('login', { isRtl: false });
      manager.apply(loginMeta);
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
        'noindex, nofollow'
      );

      // Public Listings route -> index, follow
      const listingsMeta = buildPageSeoMetadata('listings', { isRtl: false });
      manager.apply(listingsMeta);
      expect(document.title).toBe('Verified Properties for Sale & Rent in Egypt | HETTETY');
      expect(
        document.head.querySelector('meta[name="description"]')?.getAttribute('content')
      ).toContain('New Cairo');
      expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        'https://hettety.vercel.app/#listings'
      );
      expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
        listingsMeta.title
      );
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain(
        'index, follow'
      );

      // Public Property detail route -> index, follow + product ogType
      const propertyMeta = buildPageSeoMetadata('property', {
        isRtl: false,
        property: SAMPLE_PROPERTIES[0],
      });
      manager.apply(propertyMeta);
      expect(document.title).toBe('Golden Square Smart Villa | New Cairo, Egypt — HETTETY');
      expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
        'Golden Square Smart Villa | New Cairo, Egypt — HETTETY'
      );
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain(
        'index, follow'
      );
      expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        'https://hettety.vercel.app/#property/prop-nc-3d-verified'
      );
    });

    it('builds valid Schema.org RealEstateListing and Organization JSON-LD graphs and injects them cleanly', () => {
      const manager = new SeoManager('https://hettety.vercel.app');
      const org = manager.buildOrganizationJsonLd();

      expect(org['@context']).toBe('https://schema.org');
      expect(org['@type']).toEqual(['Organization', 'RealEstateAgent']);
      expect(org.name).toBe('HETTETY');
      expect((org.address as any).addressCountry).toBe('EG');

      const listing = manager.buildPropertyJsonLd(SAMPLE_PROPERTIES[0]);
      expect(listing['@context']).toBe('https://schema.org');
      expect(listing['@type']).toBe('RealEstateListing');
      expect(listing.name).toBe('Golden Square Smart Villa');
      expect((listing.offers as any)['@type']).toBe('Offer');
      expect((listing.offers as any).price).toBe(20_000_000);
      expect((listing.offers as any).priceCurrency).toBe('EGP');
      expect((listing.offers as any).availability).toBe('https://schema.org/InStock');
      expect((listing.floorSize as any).value).toBe(500);
      expect((listing.floorSize as any).unitCode).toBe('MTK');
      expect((listing.geo as any).latitude).toBe(30.025);
      expect((listing.provider as any).name).toBe('Emaar Misr');

      // Verify JSON-LD script injection into document.head via apply()
      const pageMeta = buildPageSeoMetadata('property', {
        isRtl: false,
        property: SAMPLE_PROPERTIES[0],
      });
      manager.apply(pageMeta);

      const script = document.getElementById(SEO_JSONLD_SCRIPT_ID);
      expect(script).not.toBeNull();
      expect(script?.getAttribute('type')).toBe('application/ld+json');

      const parsed = JSON.parse(script!.textContent || '{}');
      expect(parsed['@context']).toBe('https://schema.org');
      expect(Array.isArray(parsed['@graph'])).toBe(true);
      const types = parsed['@graph'].map((node: any) =>
        Array.isArray(node['@type']) ? node['@type'].join(',') : node['@type']
      );
      expect(types).toContain('Organization,RealEstateAgent');
      expect(types).toContain('RealEstateListing');
      expect(types).toContain('BreadcrumbList');
    });

    it('produces localized Arabic RTL SEO metadata with ar_EG OpenGraph locale and BreadcrumbList', () => {
      const manager = new SeoManager('https://hettety.vercel.app');
      const arPropertyMeta = buildPageSeoMetadata('property', {
        isRtl: true,
        property: SAMPLE_PROPERTIES[2],
      });
      manager.apply(arPropertyMeta);

      expect(arPropertyMeta.lang).toBe('ar');
      expect(arPropertyMeta.noIndex).toBe(false);
      expect(document.head.querySelector('meta[property="og:locale"]')?.getAttribute('content')).toBe(
        'ar_EG'
      );
      expect(document.head.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe(
        'product'
      );
      expect(document.title).toContain('Marassi Lagoon Chalet');
    });
  });

  // =========================================================================
  // 4. Fixed Real Estate Advisor & Gemini / Rate Limiter
  // =========================================================================
  describe('4. Fixed Real Estate Advisor, Gemini Defaults & Rate Limiter Health', () => {
    it('defaults Gemini provider to gemini-2.5-flash (never broken gemini-3.6-flash) with gemini-2.0-flash fallback', () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key-123';
      delete process.env.AI_MODEL;
      delete process.env.AI_FALLBACK_MODEL;

      const provider = createGeminiProvider();
      expect(provider.name).toBe('gemini');
      expect(provider.defaultModel).toBe('gemini-2.5-flash');
      expect(provider.defaultModel).not.toBe('gemini-3.6-flash');
      expect(provider.fallbackModel).toBe('gemini-2.0-flash');
      expect(provider.supportsPdf).toBe(true);
    });

    it('buildAdvisorHealthStatus() returns valid AdvisorHealthStatus including rateLimiterBackend across backends', () => {
      process.env.AI_PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY = 'test-gemini-key-456';
      delete process.env.AI_MODEL;
      delete process.env.REDIS_URL;
      process.env.DATABASE_URL = 'postgresql://user:pass@ep-cool.us-east-2.aws.neon.tech/neondb?sslmode=require';

      expect(getActiveRateLimiterBackend()).toBe('neon_postgres');

      const neonHealth = buildAdvisorHealthStatus();
      expect(neonHealth.healthy).toBe(true);
      expect(neonHealth.provider).toBe('gemini');
      expect(neonHealth.model).toBe('gemini-2.5-flash');
      expect(neonHealth.fallbackModel).toBe('gemini-2.0-flash');
      expect(neonHealth.hasApiKey).toBe(true);
      expect(neonHealth.rateLimiterBackend).toBe('neon_postgres');
      expect(typeof neonHealth.timestamp).toBe('string');
      expect(neonHealth.diagnostics).toContain('neon_postgres');

      // When neither Redis nor Neon is configured, reports 'memory' backend
      delete process.env.DATABASE_URL;
      delete process.env.POSTGRES_URL;
      delete process.env.NEON_DATABASE_URL;
      delete process.env.GEMINI_API_KEY;
      delete process.env.VITE_GEMINI_API_KEY;

      const unconfiguredHealth = buildAdvisorHealthStatus();
      expect(unconfiguredHealth.healthy).toBe(false);
      expect(unconfiguredHealth.hasApiKey).toBe(false);
      expect(unconfiguredHealth.rateLimiterBackend).toBe('memory');
      expect(unconfiguredHealth.model).toBe('gemini-2.5-flash');
    });

    it('RealEstateAdvisor responds immediately with intelligent Egyptian market advisory fallback when /api/ai returns HTTP 500 config error', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/ai?health=1')) {
          return makeJsonResponse({
            healthy: false,
            hasApiKey: false,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            rateLimiterBackend: 'memory',
          });
        }
        if (url.includes('/api/ai') && init?.method === 'POST') {
          return makeJsonResponse(
            {
              error: 'GEMINI_API_KEY is not configured on the server',
              transient: false,
            },
            500
          );
        }
        return makeJsonResponse({}, 404);
      }) as any;

      render(
        <RealEstateAdvisor
          t={TRANSLATIONS.en}
          isRtl={false}
          properties={SAMPLE_PROPERTIES}
          userName="Karim"
        />
      );

      const textarea = screen.getByPlaceholderText(/Ask your real estate advisor/i);
      const sendBtn = screen.getByRole('button', { name: 'Send' });

      fireEvent.change(textarea, {
        target: { value: 'Compare New Cairo and Sheikh Zayed for a 10 million EGP budget' },
      });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(
          screen.getByText('Instant Local Market Intelligence Analysis')
        ).toBeInTheDocument();
      });

      // Rich Egyptian market advisory content & synced profile budget rendered immediately
      expect(screen.getByText(/New Cairo & Fifth Settlement/i)).toBeInTheDocument();
      expect(screen.getByText(/Sheikh Zayed & 6th of October/i)).toBeInTheDocument();
      expect(screen.getByText(/Financing & ROI Projection for 10,000,000 EGP/i)).toBeInTheDocument();
      expect(screen.getByText(/Budget:\s*10,000,000\s*EGP/i)).toBeInTheDocument();
      expect(screen.getByText(/Smart Local Analysis Mode/i)).toBeInTheDocument();

      // Never shows a dead "busy" wall
      expect(screen.queryByText(/busy right now/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/مزحوم/i)).not.toBeInTheDocument();
    });

    it('RealEstateAdvisor preserves multi-turn conversation history across follow-ups even when profile state updates', async () => {
      const capturedBodies: any[] = [];
      let postTurn = 0;

      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/ai?health=1')) {
          return makeJsonResponse({
            healthy: true,
            hasApiKey: true,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            rateLimiterBackend: 'neon_postgres',
          });
        }
        if (url.includes('/api/ai') && init?.method === 'POST') {
          postTurn += 1;
          capturedBodies.push(JSON.parse(String(init.body || '{}')));
          if (postTurn === 1) {
            return makeJsonResponse({
              text:
                'New Cairo offers 8.5% rental yields with strong Golden Square liquidity. [ADVISOR_STATE:{"budget":10000000,"preferredLocation":"New Cairo"}]',
              provider: 'gemini',
              model: 'gemini-2.5-flash',
            });
          }
          return makeJsonResponse({
            text: 'For your 10M EGP budget, Mivida and Fifth Settlement offer 8-year developer installments.',
            provider: 'gemini',
            model: 'gemini-2.5-flash',
          });
        }
        return makeJsonResponse({}, 404);
      }) as any;

      render(
        <RealEstateAdvisor
          t={TRANSLATIONS.en}
          isRtl={false}
          properties={SAMPLE_PROPERTIES}
          userName="Salma"
        />
      );

      const textarea = screen.getByPlaceholderText(/Ask your real estate advisor/i);
      const sendBtn = screen.getByRole('button', { name: 'Send' });

      // Turn 1 (triggers ADVISOR_STATE profile update)
      fireEvent.change(textarea, {
        target: { value: 'I want to invest 10 million EGP in New Cairo' },
      });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(screen.getByText(/New Cairo offers 8\.5% rental yields/i)).toBeInTheDocument();
      });
      // Profile sync pill appears without clearing chat
      expect(screen.getByText(/Active Consultation Profile:/i)).toBeInTheDocument();

      // Turn 2 follow-up
      fireEvent.change(textarea, {
        target: { value: 'What installment plans work best there?' },
      });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(
          screen.getByText(/Mivida and Fifth Settlement offer 8-year developer installments/i)
        ).toBeInTheDocument();
      });

      // Both Turn 1 and Turn 2 messages remain visible in conversation stream
      expect(screen.getByText('I want to invest 10 million EGP in New Cairo')).toBeInTheDocument();
      expect(screen.getByText(/New Cairo offers 8\.5% rental yields/i)).toBeInTheDocument();
      expect(screen.getByText('What installment plans work best there?')).toBeInTheDocument();

      // Wire payload for Turn 2 includes complete Turn 1 history before Turn 2 user turn
      expect(capturedBodies).toHaveLength(2);
      expect(capturedBodies[1].contents).toHaveLength(3);
      expect(capturedBodies[1].contents[0]).toEqual({
        role: 'user',
        parts: [{ text: 'I want to invest 10 million EGP in New Cairo' }],
      });
      expect(capturedBodies[1].contents[1].role).toBe('model');
      expect(capturedBodies[1].contents[1].parts[0].text).toContain('New Cairo offers 8.5% rental yields');
      expect(capturedBodies[1].contents[2]).toEqual({
        role: 'user',
        parts: [{ text: 'What installment plans work best there?' }],
      });
    });
  });

  // =========================================================================
  // 5. Neon Postgres Migrations & Reset SQL Integrity
  // =========================================================================
  describe('5. Neon Postgres Migrations & Reset SQL Integrity', () => {
    const migrationsDir = path.resolve(process.cwd(), 'database', 'migrations');

    it('001_initial_neon_schema.sql defines all required enterprise tables inside a transaction', () => {
      const sql = fs.readFileSync(
        path.join(migrationsDir, '001_initial_neon_schema.sql'),
        'utf-8'
      );

      expect(sql).toMatch(/\bBEGIN\s*;/i);
      expect(sql).toMatch(/\bCOMMIT\s*;/i);

      const requiredTables = [
        'users',
        'properties',
        'media_assets',
        'reconstruction_jobs',
        'transactions',
        'audit_logs',
        'rate_limit_buckets',
        'system_settings',
      ];

      for (const table of requiredTables) {
        const pattern = new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, 'i');
        expect(sql, `Missing DDL for table "${table}"`).toMatch(pattern);
      }

      // Idempotent default platform_config seed
      expect(sql).toMatch(/INSERT\s+INTO\s+system_settings/i);
      expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*setting_key\s*\)\s*DO\s+NOTHING/i);
    });

    it('002_reset_properties_preserve_users.sql deletes properties inside BEGIN..COMMIT and NEVER deletes users or sessions', () => {
      const rawSql = fs.readFileSync(
        path.join(migrationsDir, '002_reset_properties_preserve_users.sql'),
        'utf-8'
      );
      // Strip single-line SQL comments so safety assertions inspect executable statements strictly
      const executableSql = rawSql.replace(/--[^\n]*/g, '');

      const beginIdx = executableSql.search(/\bBEGIN\s*;/i);
      const deletePropsIdx = executableSql.search(/\bDELETE\s+FROM\s+properties\s*;/i);
      const commitIdx = executableSql.search(/\bCOMMIT\s*;/i);

      expect(beginIdx).toBeGreaterThanOrEqual(0);
      expect(deletePropsIdx).toBeGreaterThan(beginIdx);
      expect(commitIdx).toBeGreaterThan(deletePropsIdx);

      // Must record immutable audit trail
      expect(executableSql).toMatch(/INSERT\s+INTO\s+audit_logs/i);
      expect(executableSql).toContain('RESET_PROPERTIES_PRESERVE_USERS');

      // Strictly NEVER delete, truncate, or drop users or sessions
      expect(executableSql).not.toMatch(/\bDELETE\s+FROM\s+users\b/i);
      expect(executableSql).not.toMatch(/\bDELETE\s+FROM\s+sessions\b/i);
      expect(executableSql).not.toMatch(/\bTRUNCATE\b[\s\S]*?\b(users|sessions)\b/i);
      expect(executableSql).not.toMatch(/\bDROP\s+TABLE\b[\s\S]*?\b(users|sessions)\b/i);
    });
  });
});
