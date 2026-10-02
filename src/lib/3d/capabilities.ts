/**
 * HETTETY 3D - Device & Rendering Capabilities Detector
 * Detects WebGPU, WebGL2, Memory budgets, and selects optimal LOD & rendering targets.
 */

export type SpatialTier = 'high' | 'medium' | 'low';
export type SpatialRenderTarget = 'webgpu_splats' | 'webgl_splats' | 'mesh_glb' | 'panorama_360';

export interface SpatialCapabilities {
  webgpuSupported: boolean;
  webgl2Supported: boolean;
  deviceMemoryGb: number;
  hardwareConcurrency: number;
  isMobile: boolean;
  tier: SpatialTier;
  recommendedTarget: SpatialRenderTarget;
  recommendedLod: 'high' | 'medium' | 'low';
  maxSplats: number;
}

export const detectSpatialCapabilities = (): SpatialCapabilities => {
  if (typeof window === 'undefined') {
    return {
      webgpuSupported: false,
      webgl2Supported: false,
      deviceMemoryGb: 4,
      hardwareConcurrency: 4,
      isMobile: false,
      tier: 'medium',
      recommendedTarget: 'mesh_glb',
      recommendedLod: 'medium',
      maxSplats: 500000,
    };
  }

  const nav = window.navigator as any;
  const webgpuSupported = typeof nav !== 'undefined' && 'gpu' in nav && Boolean(nav.gpu);

  let webgl2Supported = false;
  try {
    const canvas = document.createElement('canvas');
    webgl2Supported = Boolean(canvas.getContext('webgl2'));
  } catch {
    webgl2Supported = false;
  }

  const deviceMemoryGb = nav.deviceMemory || 4;
  const hardwareConcurrency = nav.hardwareConcurrency || 4;
  const userAgent = nav.userAgent || '';
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) ||
    (window.innerWidth <= 768);

  let tier: SpatialTier = 'medium';
  let recommendedTarget: SpatialRenderTarget = 'webgl_splats';
  let recommendedLod: 'high' | 'medium' | 'low' = 'medium';
  let maxSplats = 800000;

  if (webgpuSupported && deviceMemoryGb >= 8 && !isMobile) {
    tier = 'high';
    recommendedTarget = 'webgpu_splats';
    recommendedLod = 'high';
    maxSplats = 2000000;
  } else if ((webgpuSupported || webgl2Supported) && deviceMemoryGb >= 4) {
    tier = 'medium';
    recommendedTarget = webgpuSupported ? 'webgpu_splats' : 'webgl_splats';
    recommendedLod = 'medium';
    maxSplats = 1000000;
  } else {
    tier = 'low';
    recommendedTarget = 'panorama_360';
    recommendedLod = 'low';
    maxSplats = 300000;
  }

  return {
    webgpuSupported,
    webgl2Supported,
    deviceMemoryGb,
    hardwareConcurrency,
    isMobile,
    tier,
    recommendedTarget,
    recommendedLod,
    maxSplats,
  };
};
