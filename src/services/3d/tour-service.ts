/**
 * HETTETY 3D - Tour Service
 * Handles assembling, updating, and formatting multi-representation ThreeDTour models.
 */

import { ThreeDTour, Room, Waypoint, ThreeDTourQualityReport } from '../../types';

export const buildDefaultThreeDTour = (
  assetUrl: string,
  format: 'spz' | 'ply' | 'glb' = 'spz',
  rooms: Room[] = [],
  qualityReport?: ThreeDTourQualityReport,
  isCalibratedMetric: boolean = false,
  lodUrls?: { high?: string; medium?: string; low?: string }
): ThreeDTour => {
  const isSplat = format === 'spz' || format === 'ply';
  return {
    status: 'ready',
    source: 'hettety_capture',
    provider: 'hettety',
    representation: {
      gaussianSplat: isSplat
        ? {
            format,
            url: assetUrl,
            lodUrls: lodUrls || {
              high: assetUrl,
              medium: assetUrl.replace(/\.spz$/, '_med.spz'),
              low: assetUrl.replace(/\.spz$/, '_low.spz'),
            },
          }
        : undefined,
      mesh: !isSplat
        ? {
            format: 'glb',
            url: assetUrl,
            isCalibratedMetric,
          }
        : undefined,
    },
    assetUrl,
    format,
    rooms,
    qualityReport: qualityReport || {
      coverageScore: 95,
      cameraMotionScore: 92,
      blurScore: 94,
      lightingScore: 90,
      roomCompleteness: 94,
    },
    pipelineVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const hasValidTourRepresentation = (tour: ThreeDTour | undefined): boolean => {
  if (!tour) return false;
  return Boolean(
    tour.representation?.gaussianSplat?.url ||
    tour.representation?.mesh?.url ||
    tour.representation?.panorama?.url ||
    tour.assetUrl
  );
};
