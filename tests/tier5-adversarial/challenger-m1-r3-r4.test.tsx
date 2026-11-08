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

  describe('R3.3: Firestore Failure Modes & Automatic Fallback', () => {
    it('falls back to PREMIER_LANDMARK_PROPERTIES immediately when Firestore returns empty docs []', async () => {
      // Mock Firestore getDocs to return an empty collection
      vi.spyOn(firebase, 'getDocs').mockResolvedValueOnce({
        docs: [],
      } as any);

      render(<App />);

      // Navigate to Listings
      const listingsBtns = screen.getAllByRole('button', { name: TRANSLATIONS.en.nav_listings });
      fireEvent.click(listingsBtns[0]);

      // Expect One Hyde Park and Mountain View cards to be visible
      await waitFor(() => {
        expect(screen.getByText('One Hyde Park Luxury Park Villa')).toBeInTheDocument();
      });

      expect(screen.getByText('Mountain View iCity Lagoon iVilla')).toBeInTheDocument();
      expect(screen.queryByText('No properties found')).not.toBeInTheDocument();
    });

    it('falls back cleanly to PREMIER_LANDMARK_PROPERTIES when Firestore throws a network error', async () => {
      // Mock Firestore getDocs to throw an error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(firebase, 'getDocs').mockRejectedValueOnce(new Error('Network unavailable: Firestore offline'));

      render(<App />);

      // Navigate to Listings
      const listingsBtns = screen.getAllByRole('button', { name: TRANSLATIONS.en.nav_listings });
      fireEvent.click(listingsBtns[0]);

      // Expect premier units to be displayed despite network failure
      await waitFor(() => {
        expect(screen.getByText('One Hyde Park Luxury Park Villa')).toBeInTheDocument();
      });

      expect(screen.getByText('Mountain View iCity Lagoon iVilla')).toBeInTheDocument();
      expect(screen.queryByText('No properties found')).not.toBeInTheDocument();
      consoleErrorSpy.mockRestore();
    });

    it('displays property cards without showing "No properties found" when default filters are active', async () => {
      vi.spyOn(firebase, 'getDocs').mockResolvedValueOnce({
        docs: [],
      } as any);

      render(<App />);

      const listingsBtns = screen.getAllByRole('button', { name: TRANSLATIONS.en.nav_listings });
      fireEvent.click(listingsBtns[0]);

      await screen.findByText('One Hyde Park Luxury Park Villa');

      // Ensure no empty state header or message
      expect(screen.queryByText('No properties found')).not.toBeInTheDocument();
      expect(screen.queryByText(/Try adjusting your filters/i)).not.toBeInTheDocument();

      // Check multiple cards render
      const cards = screen.getAllByRole('button', { name: /Luxury Park Villa|Lagoon iVilla|Signature Villa|SODIC/i });
      expect(cards.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('R3.4: 3D Tour Button Rendering & Interaction', () => {
    it('renders the 3D walkthrough tour button on premier property cards', async () => {
      vi.spyOn(firebase, 'getDocs').mockResolvedValueOnce({
        docs: [],
      } as any);

      render(<App />);

      const listingsBtns = screen.getAllByRole('button', { name: TRANSLATIONS.en.nav_listings });
      fireEvent.click(listingsBtns[0]);

      await screen.findByText('One Hyde Park Luxury Park Villa');

      // The walkthrough button label in English is "Walk through it"
      const tourButtons = screen.getAllByRole('button', { name: /Walk through it/i });
      expect(tourButtons.length).toBeGreaterThan(0);
    });

    it('clicking the 3D tour button transitions to the 3D walkthrough experience (#3d)', async () => {
      vi.spyOn(firebase, 'getDocs').mockResolvedValueOnce({
        docs: [],
      } as any);

      render(<App />);

      const listingsBtns = screen.getAllByRole('button', { name: TRANSLATIONS.en.nav_listings });
      fireEvent.click(listingsBtns[0]);

      await screen.findByText('One Hyde Park Luxury Park Villa');

      const tourButtons = screen.getAllByRole('button', { name: /Walk through it/i });
      fireEvent.click(tourButtons[0]);

      // URL hash should change to #3d
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

    it('verifies App.tsx schema-json-ld specifies production URL https://hettety.vercel.app/', () => {
      const appTsx = readFileSync(resolve(projectRoot, 'src/App.tsx'), 'utf-8');
      expect(appTsx).toContain('"url": "https://hettety.vercel.app/"');
      expect(appTsx).toContain('"image": "https://hettety.vercel.app/logo.jpg"');
    });
  });
});
