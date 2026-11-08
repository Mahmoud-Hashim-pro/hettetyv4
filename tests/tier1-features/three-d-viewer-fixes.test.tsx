import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  isGaussianSplatUrl,
  isMeshAssetUrl,
  isExternalTourUrl,
  loadGaussianSplatAsset,
} from '../../src/lib/3d/spz-parser';
import { computeSplatSortOrder, cameraMovedSignificantly } from '../../src/lib/3d/splat-sort';
import Property3DViewer from '../../src/components/Property3DViewer';

describe('Tier 1 — 3D Viewer & Pipeline Bug Fixes (BUG-01 to BUG-04)', () => {
  describe('BUG-02: URL Classification & Mode Conflation Prevention', () => {
    it('accurately identifies Gaussian splat URLs (.spz, .ply) with query strings and paths', () => {
      expect(isGaussianSplatUrl('https://cdn.hettety.com/models/scene.spz')).toBe(true);
      expect(isGaussianSplatUrl('https://storage.googleapis.com/bucket/point_cloud.ply?token=123')).toBe(true);
      expect(isGaussianSplatUrl('/storage/spatial_assets/properties/p1/tour/model.SPZ')).toBe(true);
      expect(isGaussianSplatUrl('models/scene.ply#view=front')).toBe(true);
    });

    it('rejects meshes, videos, and external viewer URLs from being classified as Gaussian splats', () => {
      expect(isGaussianSplatUrl('https://cdn.hettety.com/models/model.glb')).toBe(false);
      expect(isGaussianSplatUrl('https://cdn.hettety.com/models/model.gltf')).toBe(false);
      expect(isGaussianSplatUrl('https://my.matterport.com/show/?m=sxq5Jj9uWkV')).toBe(false);
      expect(isGaussianSplatUrl('https://poly.cam/capture/abc-123')).toBe(false);
      expect(isGaussianSplatUrl('https://kuula.co/share/collection/7lK8q')).toBe(false);
      expect(isGaussianSplatUrl('')).toBe(false);
      expect(isGaussianSplatUrl(undefined)).toBe(false);
    });

    it('accurately identifies metric mesh URLs (.glb, .gltf)', () => {
      expect(isMeshAssetUrl('https://cdn.hettety.com/models/model.glb')).toBe(true);
      expect(isMeshAssetUrl('https://cdn.hettety.com/models/model.gltf?v=2')).toBe(true);
      expect(isMeshAssetUrl('/path/to/mesh.GLB')).toBe(true);
      expect(isMeshAssetUrl('https://cdn.hettety.com/models/scene.spz')).toBe(false);
      expect(isMeshAssetUrl('https://my.matterport.com/show/?m=sxq5Jj9uWkV')).toBe(false);
    });

    it('accurately identifies external digital twin URLs (Matterport, Polycam, Kuula)', () => {
      expect(isExternalTourUrl('https://my.matterport.com/show/?m=sxq5Jj9uWkV')).toBe(true);
      expect(isExternalTourUrl('https://poly.cam/capture/xyz')).toBe(true);
      expect(isExternalTourUrl('https://kuula.co/share/7Pq')).toBe(true);
      expect(isExternalTourUrl('https://custom-embed.com/tour', 'matterport')).toBe(true);
      expect(isExternalTourUrl('https://custom-embed.com/tour', 'polycam')).toBe(true);
      expect(isExternalTourUrl('https://cdn.hettety.com/scene.spz')).toBe(false);
    });

    it('rejects external tour URLs from binary Gaussian loader before issuing network fetch', async () => {
      const externalUrl = 'https://my.matterport.com/show/?m=sxq5Jj9uWkV';
      await expect(loadGaussianSplatAsset(externalUrl)).rejects.toThrow(
        /EXTERNAL_TOUR_URL_NOT_SUPPORTED/
      );
    });
  });

  describe('BUG-03: Streaming Progress & Fetch Cancellation', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('streams response chunks and emits stage & progress updates with loaded byte metrics', async () => {
      const fakeChunk1 = new Uint8Array([0x53, 0x50, 0x5a, 0x01, 0x00, 0x00]);
      const fakeChunk2 = new Uint8Array([0x00, 0x00, 0x00, 0x00]);

      let callCount = 0;
      const mockStream = {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return { done: false, value: fakeChunk1 };
            if (callCount === 2) return { done: false, value: fakeChunk2 };
            return { done: true, value: undefined };
          }),
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-length': '10',
          'content-type': 'application/octet-stream',
        }),
        body: mockStream,
      } as any);

      const stages: string[] = [];
      const progresses: number[] = [];

      try {
        await loadGaussianSplatAsset('https://cdn.hettety.com/test.spz', (p) => progresses.push(p), {
          onStageChange: (d) => stages.push(d.stage),
        });
      } catch {
        // Expected because fakeChunk is not full SPZ WASM binary
      }

      expect(stages).toContain('downloading');
      expect(progresses.length).toBeGreaterThan(0);
      expect(progresses[progresses.length - 1]).toBeGreaterThanOrEqual(90);
    });

    it('respects AbortSignal and aborts download when signal is triggered', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        loadGaussianSplatAsset('https://cdn.hettety.com/large.spz', undefined, {
          signal: controller.signal,
        })
      ).rejects.toThrow(/aborted/);
    });
  });

  describe('BUG-04: Far-to-Near Depth Sorting with Counting Sort', () => {
    it('sorts splat positions far-to-near along the camera view direction', () => {
      // 3 positions:
      // Index 0: depth 10
      // Index 1: depth 2
      // Index 2: depth 25
      const positions = new Float32Array([
        0, 0, 10,
        0, 0, 2,
        0, 0, 25,
      ]);

      const camPos: [number, number, number] = [0, 0, 0];
      const camDir: [number, number, number] = [0, 0, 1]; // Looking down +Z

      const sortedIndices = computeSplatSortOrder(positions, 3, camPos, camDir);

      expect(sortedIndices.length).toBe(3);
      // Furthest first (painter's algorithm for correct alpha blending)
      expect(sortedIndices[0]).toBe(2); // z=25 (furthest)
      expect(sortedIndices[1]).toBe(0); // z=10 (middle)
      expect(sortedIndices[2]).toBe(1); // z=2  (closest)
    });

    it('detects significant camera movement to throttle unnecessary sorts', () => {
      const lastPos: [number, number, number] = [0, 0, 0];
      const lastDir: [number, number, number] = [0, 0, 1];

      const currentPos: [number, number, number] = [0.001, 0, 0];
      const currentDir: [number, number, number] = [0, 0, 1];

      // Minor jitter should not trigger resort
      expect(cameraMovedSignificantly(lastPos, lastDir, currentPos, currentDir, 0.05, 0.02)).toBe(false);

      // Substantial translation triggers resort
      const movedPos: [number, number, number] = [0.1, 0, 0];
      expect(cameraMovedSignificantly(lastPos, lastDir, movedPos, currentDir, 0.05, 0.02)).toBe(true);
    });
  });

  describe('BUG-01: Honest Spatial Level Tags (Waypoints vs Genuine 3DGS)', () => {
    it('renders spatial waypoint preview notice and omits 3DGS level tag when only waypoints exist', () => {
      const waypointOnlyTour = {
        id: 'tour-wp-1',
        rooms: [
          { id: 'r1', name: 'Living Room', position: [0, 0, 0] as [number, number, number] },
          { id: 'r2', name: 'Balcony', position: [3, 0, 0] as [number, number, number] },
        ],
      };

      render(
        <Property3DViewer
          propertyId="prop-test-wp"
          threeDTour={waypointOnlyTour as any}
          title="Sample Villa"
        />
      );

      // Must display the honest waypoint preview notice
      expect(screen.getByTestId('waypoint-preview-notice')).toBeDefined();
      expect(screen.getByText(/Spatial Waypoints Preview/i)).toBeDefined();

      // Must NOT claim Level 2: 3DGS Spatial Scene
      expect(screen.queryByTestId('level-tag-3dgs')).toBeNull();
    });

    it('renders Level 2: 3DGS Spatial Scene when a genuine Gaussian Splat asset is present', () => {
      const real3dTour = {
        id: 'tour-real-3d',
        rooms: [
          { id: 'r1', name: 'Living Room', position: [0, 0, 0] as [number, number, number] },
        ],
        assetUrl: 'https://cdn.hettety.com/properties/prop-1/tour/scene.spz',
        representation: {
          gaussianSplat: {
            format: 'spz' as const,
            url: 'https://cdn.hettety.com/properties/prop-1/tour/scene.spz',
            splatCount: 125000,
            sha256: 'a'.repeat(64),
          },
        },
      };

      render(
        <Property3DViewer
          propertyId="prop-test-3d"
          threeDTour={real3dTour as any}
          title="Authentic Reconstructed Villa"
        />
      );

      // Must display Level 2: 3DGS Spatial Scene
      expect(screen.getByTestId('level-tag-3dgs')).toBeDefined();
      // Must NOT display the waypoint-only preview notice
      expect(screen.queryByTestId('waypoint-preview-notice')).toBeNull();
    });
  });
});
