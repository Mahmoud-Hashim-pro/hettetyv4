/**
 * HETTETY 3D - Progressive Level of Detail (LOD) Manager
 * Resolves optimal SPZ / GLB URLs based on device tier and network profile.
 */

import { ThreeDTour } from '../../types';
import { SpatialTier } from './capabilities';

export interface ResolvedSpatialAsset {
  url: string;
  format: 'spz' | 'glb' | 'ply' | 'gltf';
  type: 'gaussianSplat' | 'mesh' | 'panorama';
  lodTier: SpatialTier;
  estimatedBytes?: number;
}

export const resolveOptimalSpatialAsset = (
  tour: ThreeDTour | undefined,
  tier: SpatialTier = 'medium'
): ResolvedSpatialAsset | null => {
  if (!tour) return null;

  // 1. Check Gaussian Splatting representation (Primary visual fidelity)
  const splat = tour.representation?.gaussianSplat;
  if (splat?.url) {
    let resolvedUrl = splat.url;
    if (splat.lodUrls) {
      if (tier === 'high' && splat.lodUrls.high) resolvedUrl = splat.lodUrls.high;
      else if (tier === 'medium' && splat.lodUrls.medium) resolvedUrl = splat.lodUrls.medium;
      else if (tier === 'low' && splat.lodUrls.low) resolvedUrl = splat.lodUrls.low;
    }
    return {
      url: resolvedUrl,
      format: splat.format || 'spz',
      type: 'gaussianSplat',
      lodTier: tier,
      estimatedBytes: splat.sizeBytes || 8 * 1024 * 1024,
    };
  }

  // 2. Direct top-level assetUrl compatibility
  if (tour.assetUrl) {
    return {
      url: tour.assetUrl,
      format: tour.format || 'spz',
      type: 'gaussianSplat',
      lodTier: tier,
      estimatedBytes: 10 * 1024 * 1024,
    };
  }

  // 3. Mesh representation (Calibrated GLB)
  const mesh = tour.representation?.mesh;
  if (mesh?.url) {
    return {
      url: mesh.url,
      format: mesh.format || 'glb',
      type: 'mesh',
      lodTier: tier,
      estimatedBytes: mesh.sizeBytes || 15 * 1024 * 1024,
    };
  }

  return null;
};
