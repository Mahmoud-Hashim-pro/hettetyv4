import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { validatePhotoCapture, validateVideoCapture } from '../../src/features/reconstruction/CaptureValidator';
import {
  createReconstructionJob,
  updateJobStatus,
  cancelReconstructionJob,
  retryReconstructionJob,
  getReconstructionJob,
} from '../../src/services/3d/reconstruction-service';
import { calculateDistanceMeters, formatDistance } from '../../src/lib/3d/coordinates';
import { detectSpatialCapabilities } from '../../src/lib/3d/capabilities';
import { resolveOptimalSpatialAsset } from '../../src/lib/3d/lod';
import { buildDefaultThreeDTour, hasValidTourRepresentation } from '../../src/services/3d/tour-service';
import { MeasurementTool } from '../../src/components/3d/MeasurementTool';
import { FloorPlan } from '../../src/components/3d/FloorPlan';
import { PREMIER_LANDMARK_PROPERTIES } from '../../src/lib/inventoryData';

describe('Tier 1 — HETTETY Real 3D Reconstruction Pipeline & Architecture', () => {
  describe('CaptureValidator — Pre-flight Quality & Overlap Checks', () => {
    it('rejects capture sets with fewer than 12 photos as insufficient for 3D reconstruction', () => {
      const files = Array.from({ length: 6 }).map((_, i) => ({
        name: `photo_${i}.jpg`,
        size: 2 * 1024 * 1024,
        type: 'image/jpeg',
      }));

      const result = validatePhotoCapture(files);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Insufficient photo count');
      expect(result.errorsAr[0]).toContain('عدد الصور غير كافٍ');
    });

    it('passes and provides warnings for sets with 15-24 photos, recommending 30+', () => {
      const files = Array.from({ length: 18 }).map((_, i) => ({
        name: `photo_${i}.jpg`,
        size: 3 * 1024 * 1024,
        type: 'image/jpeg',
      }));

      const result = validatePhotoCapture(files);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Low photo count');
      expect(result.coverageScore).toBeGreaterThan(40);
    });

    it('approves ideal capture sets with 40+ photos with high coverage and overlap scores', () => {
      const files = Array.from({ length: 45 }).map((_, i) => ({
        name: `photo_${i}.jpg`,
        size: 4 * 1024 * 1024,
        type: 'image/jpeg',
      }));

      const result = validatePhotoCapture(files);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.warnings.length).toBe(0);
      expect(result.coverageScore).toBeGreaterThanOrEqual(90);
      expect(result.overlapScore).toBeGreaterThanOrEqual(90);
    });

    it('validates video walkthrough capture and enforces 80MB upload ceiling', () => {
      const validVideo = {
        name: 'walkthrough.mp4',
        size: 25 * 1024 * 1024,
        type: 'video/mp4',
      };
      const validResult = validateVideoCapture(validVideo);
      expect(validResult.valid).toBe(true);
      expect(validResult.coverageScore).toBeGreaterThanOrEqual(90);

      const oversizedVideo = {
        name: 'huge_walkthrough.mp4',
        size: 85 * 1024 * 1024,
        type: 'video/mp4',
      };
      const errorResult = validateVideoCapture(oversizedVideo);
      expect(errorResult.valid).toBe(false);
      expect(errorResult.errors[0]).toContain('exceeds maximum upload size');
    });
  });

  describe('Reconstruction Service — Job Lifecycle & Idempotency', () => {
    it('creates job in QUEUED status and returns existing job when duplicate idempotencyKey is used', () => {
      const testKey = `test-idemp-${Date.now()}`;
      const job1 = createReconstructionJob({
        propertyId: 'prop-101',
        ownerId: 'owner-abc',
        type: 'photos',
        sourceCount: 35,
        idempotencyKey: testKey,
      });

      expect(job1.id).toBeDefined();
      expect(job1.status).toBe('QUEUED');
      expect(job1.progress).toBe(5);

      // Attempt duplicate creation with same key
      const job2 = createReconstructionJob({
        propertyId: 'prop-101',
        ownerId: 'owner-abc',
        type: 'photos',
        sourceCount: 35,
        idempotencyKey: testKey,
      });

      expect(job2.id).toBe(job1.id);
    });

    it('updates job stages and logs completion timestamp on READY', () => {
      const job = createReconstructionJob({
        propertyId: 'prop-102',
        ownerId: 'owner-xyz',
        type: 'video',
        sourceCount: 1,
      });

      const updated = updateJobStatus(job.id, 'READY', 100, 'Publishing Spatial Tour');
      expect(updated?.status).toBe('READY');
      expect(updated?.progress).toBe(100);
      expect(updated?.completedAt).toBeDefined();
    });

    it('cancels an in-flight reconstruction job and marks completion timestamp', () => {
      const job = createReconstructionJob({
        propertyId: 'prop-cancel-01',
        ownerId: 'owner-cancel',
        type: 'photos',
        sourceCount: 25,
      });

      updateJobStatus(job.id, 'RECONSTRUCTING', 45, 'COLMAP feature matching');
      const cancelled = cancelReconstructionJob(job.id);
      expect(cancelled).toBe(true);

      const retrieved = getReconstructionJob(job.id);
      expect(retrieved?.status).toBe('CANCELLED');
      expect(retrieved?.completedAt).toBeDefined();
    });

    it('retries a failed reconstruction job, resetting status to QUEUED and incrementing retryCount', () => {
      const job = createReconstructionJob({
        propertyId: 'prop-retry-01',
        ownerId: 'owner-retry',
        type: 'photos',
        sourceCount: 20,
      });

      updateJobStatus(job.id, 'FAILED', 50, 'Training Failed', 'GPU_ERROR', 'CUDA out of memory');
      const failedJob = getReconstructionJob(job.id);
      expect(failedJob?.status).toBe('FAILED');
      expect(failedJob?.errorCode).toBe('GPU_ERROR');

      const retried = retryReconstructionJob(job.id);
      expect(retried).not.toBeNull();
      expect(retried?.status).toBe('QUEUED');
      expect(retried?.progress).toBe(5);
      expect(retried?.errorCode).toBeUndefined();
      expect(retried?.retryCount).toBe(1);
    });

    it('handles concurrent reconstruction jobs for distinct properties independently', () => {
      const jobA = createReconstructionJob({
        propertyId: 'villa-concurrent-a',
        ownerId: 'owner-a',
        type: 'photos',
        sourceCount: 50,
      });
      const jobB = createReconstructionJob({
        propertyId: 'apt-concurrent-b',
        ownerId: 'owner-b',
        type: 'video',
        sourceCount: 1,
      });

      expect(jobA.id).not.toBe(jobB.id);

      updateJobStatus(jobA.id, 'TRAINING', 75, 'Gaussian optimization');
      updateJobStatus(jobB.id, 'VALIDATING', 15, 'Keyframe analysis');

      expect(getReconstructionJob(jobA.id)?.status).toBe('TRAINING');
      expect(getReconstructionJob(jobB.id)?.status).toBe('VALIDATING');
    });

    it('processes massive capture sets (120+ photos) for large luxury villas with maximum coverage', () => {
      const massiveSet = Array.from({ length: 120 }).map((_, i) => ({
        name: `villa_room_${i}.jpg`,
        size: 3.5 * 1024 * 1024,
        type: 'image/jpeg',
      }));

      const res = validatePhotoCapture(massiveSet);
      expect(res.valid).toBe(true);
      expect(res.coverageScore).toBeGreaterThanOrEqual(95);
      expect(res.overlapScore).toBeGreaterThanOrEqual(90);
      expect(res.errors).toHaveLength(0);
    });

    it('detects spatial rendering capabilities and returns appropriate hardware budget tier', () => {
      const caps = detectSpatialCapabilities();
      expect(caps).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(caps.tier);
      expect(caps.maxSplats).toBeGreaterThan(0);
      expect(caps.recommendedTarget).toBeDefined();
    });
  });

  describe('Spatial Geometry & Metric Coordinate Math', () => {
    it('calculates Euclidean 3D distance with metric precision', () => {
      // 3-4-5 right triangle in 3D: [0,0,0] to [3,4,0] should equal exactly 5 meters
      const distance = calculateDistanceMeters([0, 0, 0], [3, 4, 0]);
      expect(distance).toBeCloseTo(5.0, 2);

      expect(formatDistance(5.0, false)).toBe('5.00 m');
      expect(formatDistance(5.0, true)).toBe('5.00 متر');
    });

    it('renders MeasurementTool and allows measuring room spans', () => {
      render(<MeasurementTool isRtl={false} />);
      expect(screen.getByText(/3D Metric Measurement Tool/i)).toBeInTheDocument();
      expect(screen.getByText(/Calculated Distance/i)).toBeInTheDocument();

      const measureBtn = screen.getByRole('button', { name: /Measure Reception/i });
      fireEvent.click(measureBtn);
      expect(screen.getByText('4.72 m')).toBeInTheDocument();
    });

    it('renders interactive FloorPlan and invokes onSelectRoom on room click', () => {
      const mockSelect = vi.fn();
      const testRooms = [
        { id: 'rec', name: 'Reception Salon', nameAr: 'الريسبشن', type: 'reception' as const, center: [0, 0, 0] as [number, number, number], waypoints: [] },
        { id: 'bed', name: 'Master Suite', nameAr: 'جناح الماستر', type: 'bedroom' as const, center: [3, 0, 2] as [number, number, number], waypoints: [] },
      ];

      render(<FloorPlan rooms={testRooms} activeRoomId="rec" onSelectRoom={mockSelect} isRtl={false} />);
      expect(screen.getByText(/Interactive Floor Plan/i)).toBeInTheDocument();
      expect(screen.getByText('Reception Salon')).toBeInTheDocument();

      const bedBtn = screen.getByRole('button', { name: /Master Suite/i });
      fireEvent.click(bedBtn);
      expect(mockSelect).toHaveBeenCalledWith('bed');
    });
  });

  describe('LOD & Multi-Representation Spatial Tour Schema', () => {
    it('resolves optimal Gaussian Splat SPZ asset and progressive LOD URLs', () => {
      const sampleTour = buildDefaultThreeDTour('https://cdn.hettety.com/tours/sample/scene.spz', 'spz');
      expect(hasValidTourRepresentation(sampleTour)).toBe(true);

      const highAsset = resolveOptimalSpatialAsset(sampleTour, 'high');
      expect(highAsset?.format).toBe('spz');
      expect(highAsset?.type).toBe('gaussianSplat');

      const medAsset = resolveOptimalSpatialAsset(sampleTour, 'medium');
      expect(medAsset?.url).toContain('_med.spz');
    });

    it('verifies premier landmark villas are equipped with dual representations (Gaussian Splat SPZ + Metric Mesh GLB)', () => {
      const hydePark = PREMIER_LANDMARK_PROPERTIES.find((p) => p.id === 'hyde-park-one-1');
      expect(hydePark?.threeDTour?.representation?.gaussianSplat).toBeDefined();
      expect(hydePark?.threeDTour?.representation?.gaussianSplat?.format).toBe('spz');
      expect(hydePark?.threeDTour?.representation?.mesh).toBeDefined();
      expect(hydePark?.threeDTour?.representation?.mesh?.format).toBe('glb');
      expect(hydePark?.threeDTour?.representation?.mesh?.isCalibratedMetric).toBe(true);
      expect(hydePark?.threeDTour?.bounds).toBeDefined();
    });
  });
});
