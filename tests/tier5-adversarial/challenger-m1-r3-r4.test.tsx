import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import App, { tourKind } from '../../src/App';
import { PREMIER_LANDMARK_PROPERTIES } from '../../src/lib/inventoryData';
import { TRANSLATIONS } from '../../src/constants';
import * as firebase from '../../src/firebase';
import { Property } from '../../src/types';

describe('Challenger M1 Empirical Verification: Requirement R3 & R4', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    localStorage.setItem('hettety_consent', JSON.stringify({ necessary: true }));
    localStorage.setItem('theme', 'light');
    window.location.hash = '';

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('R3.1: Inventory Data Integrity & Unit Verification', () => {
    it('contains exactly 14 curated landmark units in PREMIER_LANDMARK_PROPERTIES', () => {
      expect(PREMIER_LANDMARK_PROPERTIES.length).toBe(14);
    });

    it('verifies all 14 units are marked as Verified and Live', () => {
      PREMIER_LANDMARK_PROPERTIES.forEach((p) => {
        expect(p.verificationStatus).toBe('Verified');
        expect(p.listingState || 'Live').toBe('Live');
        expect(p.price).toBeGreaterThan(0);
        expect(p.location).toBeTruthy();
        expect(p.title).toBeTruthy();
      });
    });

    it('verifies Mountain View units have active 3D walkthrough links (digitalTwinUrl / threeDTour)', () => {
      const mvUnits = PREMIER_LANDMARK_PROPERTIES.filter(p =>
        (p.developer && p.developer.includes('Mountain View')) ||
        (p.compound && p.compound.includes('Mountain View'))
      );
      expect(mvUnits.length).toBeGreaterThanOrEqual(4);

      mvUnits.forEach((p) => {
        const hasTour = Boolean(
          p.threeDTour?.assetUrl ||
          (p.digitalTwinUrl && (
            p.digitalTwinUrl.includes('matterport.com') ||
            p.digitalTwinUrl.includes('poly.cam') ||
            p.digitalTwinUrl.includes('kuula.co')
          ))
        );
        expect(hasTour).toBe(true);
        expect(tourKind(p)).toBe('walkthrough');
      });
    });

    it('verifies SODIC East units have active 3D walkthrough links (digitalTwinUrl / threeDTour)', () => {
      const sodicUnits = PREMIER_LANDMARK_PROPERTIES.filter(p =>
        (p.developer && p.developer.includes('SODIC')) ||
        (p.compound && p.compound.includes('SODIC'))
      );
      expect(sodicUnits.length).toBeGreaterThanOrEqual(8);

      sodicUnits.forEach((p) => {
        const hasTour = Boolean(
          p.threeDTour?.assetUrl ||
          (p.digitalTwinUrl && (
            p.digitalTwinUrl.includes('matterport.com') ||
            p.digitalTwinUrl.includes('poly.cam') ||
            p.digitalTwinUrl.includes('kuula.co')
          ))
        );
        expect(hasTour).toBe(true);
        expect(tourKind(p)).toBe('walkthrough');
      });
    });

    it('verifies local media assets referenced in inventoryData exist on disk in public/media/ with non-zero size', () => {
      const projectRoot = resolve(__dirname, '../..');
      const referencedMedia = new Set<string>();

      PREMIER_LANDMARK_PROPERTIES.forEach((p) => {
        if (p.imageUrl && p.imageUrl.startsWith('/media/')) referencedMedia.add(p.imageUrl);
        (p.images || []).forEach(img => {
          if (img && img.startsWith('/media/')) referencedMedia.add(img);
        });
        (p.panoramas || []).forEach(pano => {
          if (pano && pano.startsWith('/media/')) referencedMedia.add(pano);
        });
        if (p.videoUrl && p.videoUrl.startsWith('/media/')) referencedMedia.add(p.videoUrl);
        if (p.masterPlanUrl && p.masterPlanUrl.startsWith('/media/')) referencedMedia.add(p.masterPlanUrl);
      });

      expect(referencedMedia.size).toBeGreaterThan(0);

      referencedMedia.forEach((mediaPath) => {
        const fullDiskPath = resolve(projectRoot, 'public', mediaPath.replace(/^\//, ''));
        expect(existsSync(fullDiskPath)).toBe(true);
        const stats = statSync(fullDiskPath);
        expect(stats.size).toBeGreaterThan(1000); // Must be a real non-empty file
      });
    });
  });

  describe('R3.2: 3D Tour URL Safety & tourKind Classification', () => {
    it('accepts safe Matterport, Polycam, and Kuula tour links', () => {
      const sampleProp: Property = {
        ...PREMIER_LANDMARK_PROPERTIES[0],
        digitalTwinUrl: 'https://my.matterport.com/show/?m=valid123',
        threeDTour: undefined,
      };
      expect(tourKind(sampleProp)).toBe('walkthrough');

      sampleProp.digitalTwinUrl = 'https://poly.cam/capture/valid456';
      expect(tourKind(sampleProp)).toBe('walkthrough');

      sampleProp.digitalTwinUrl = 'https://kuula.co/post/valid789';
      expect(tourKind(sampleProp)).toBe('walkthrough');
    });

    it('rejects untrusted, malicious, or arbitrary URLs from walkthrough classification', () => {
      const maliciousProp: Property = {
        ...PREMIER_LANDMARK_PROPERTIES[0],
        digitalTwinUrl: 'javascript:alert("hacked")',
        threeDTour: undefined,
        images: ['https://example.com/one.jpg'],
        panoramas: [],
      };
      // Should not be walkthrough; falls back to single
      expect(tourKind(maliciousProp)).toBe('single');

      maliciousProp.digitalTwinUrl = 'https://attacker.com/malicious-iframe';
      expect(tourKind(maliciousProp)).toBe('single');
    });
  });

  describe('R3.3: Clean Reset Database Honesty (Zero Demo Fallback Injection)', () => {
    it('renders the clean zero-demo InventoryEmptyState when database returns empty docs []', async () => {
      vi.spyOn(firebase, 'getDocs').mockResolvedValueOnce({
        docs: [],
      } as any);

      render(<App />);

      // Navigate to Listings
      const listingsBtns = screen.getAllByRole('button', { name: TRANSLATIONS.en.nav_listings });
      fireEvent.click(listingsBtns[0]);

      // Respects reset database truthfully — never injects demo listings
      await waitFor(() => {
        expect(screen.getByText(/Property Inventory Is Freshly Reset/i)).toBeInTheDocument();
      });

      expect(screen.queryByText('One Hyde Park Luxury Park Villa')).not.toBeInTheDocument();
      expect(screen.queryByText('Mountain View iCity Lagoon iVilla')).not.toBeInTheDocument();
    });

    it('fails cleanly to empty inventory state when database throws a network error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(firebase, 'getDocs').mockRejectedValueOnce(new Error('Network unavailable: Neon offline'));

      render(<App />);

      const listingsBtns = screen.getAllByRole('button', { name: TRANSLATIONS.en.nav_listings });
      fireEvent.click(listingsBtns[0]);

      await waitFor(() => {
        expect(screen.getByText(/Property Inventory Is Freshly Reset/i)).toBeInTheDocument();
      });

      expect(screen.queryByText('One Hyde Park Luxury Park Villa')).not.toBeInTheDocument();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('renders real stored property cards cleanly when database has listings', async () => {
      vi.spyOn(firebase, 'getDocs').mockResolvedValueOnce({
        docs: PREMIER_LANDMARK_PROPERTIES.slice(0, 3).map((p) => ({
          id: p.id,
          data: () => p,
        })),
      } as any);

      render(<App />);

      const listingsBtns = screen.getAllByRole('button', { name: TRANSLATIONS.en.nav_listings });
      fireEvent.click(listingsBtns[0]);

      await screen.findByText('One Hyde Park Luxury Park Villa');
      expect(screen.getByText('Mountain View iCity Lagoon iVilla')).toBeInTheDocument();
      expect(screen.queryByText(/Property Inventory Is Freshly Reset/i)).not.toBeInTheDocument();
    });
  });

  describe('R3.4: 3D Tour Button Rendering & Interaction', () => {
    it('renders the 3D walkthrough tour button on stored property cards with 3D assets', async () => {
      vi.spyOn(firebase, 'getDocs').mockResolvedValueOnce({
        docs: PREMIER_LANDMARK_PROPERTIES.slice(0, 2).map((p) => ({
          id: p.id,
          data: () => p,
        })),
      } as any);

      render(<App />);

      const listingsBtns = screen.getAllByRole('button', { name: TRANSLATIONS.en.nav_listings });
      fireEvent.click(listingsBtns[0]);

      await screen.findByText('One Hyde Park Luxury Park Villa');

      const tourButtons = screen.getAllByRole('button', { name: /Walk through it/i });
      expect(tourButtons.length).toBeGreaterThan(0);
    });

    it('clicking the 3D tour button transitions to the 3D walkthrough experience (#3d)', async () => {
      vi.spyOn(firebase, 'getDocs').mockResolvedValueOnce({
        docs: PREMIER_LANDMARK_PROPERTIES.slice(0, 2).map((p) => ({
          id: p.id,
          data: () => p,
        })),
      } as any);

      render(<App />);

      const listingsBtns = screen.getAllByRole('button', { name: TRANSLATIONS.en.nav_listings });
      fireEvent.click(listingsBtns[0]);

      await screen.findByText('One Hyde Park Luxury Park Villa');

      const tourButtons = screen.getAllByRole('button', { name: /Walk through it/i });
      fireEvent.click(tourButtons[0]);

      expect(window.location.hash).toBe('#3d');
    });
  });

  describe('R4: Repository Web Links Production URL Verification', () => {
    const projectRoot = resolve(__dirname, '../..');

    it('verifies README.md references production URL https://hettety.vercel.app/', () => {
      const readme = readFileSync(resolve(projectRoot, 'README.md'), 'utf-8');
      expect(readme).toContain('https://hettety.vercel.app/');
    });

    it('verifies package.json homepage is set to https://hettety.vercel.app/', () => {
      const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf-8'));
      expect(pkg.homepage).toBe('https://hettety.vercel.app/');
    });

    it('verifies index.html contains canonical link to https://hettety.vercel.app/', () => {
      const indexHtml = readFileSync(resolve(projectRoot, 'index.html'), 'utf-8');
      expect(indexHtml).toContain('<link rel="canonical" href="https://hettety.vercel.app/" />');
      expect(indexHtml).toContain('https://hettety.vercel.app/logo.jpg');
    });

    it('verifies SeoManager.ts specifies production URL https://hettety.vercel.app/ and OG image', () => {
      const seoMgr = readFileSync(resolve(projectRoot, 'src/infrastructure/seo/SeoManager.ts'), 'utf-8');
      expect(seoMgr).toContain("DEFAULT_SITE_URL = 'https://hettety.vercel.app'");
      expect(seoMgr).toContain("DEFAULT_OG_IMAGE = 'https://hettety.vercel.app/logo.jpg'");
    });
  });
});
