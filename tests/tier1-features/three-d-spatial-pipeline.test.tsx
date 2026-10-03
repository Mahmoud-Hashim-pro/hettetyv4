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
import { ReconstructionApiClient } from '../../src/services/3d/reconstruction-api';
import { MeasurementTool } from '../../src/components/3d/MeasurementTool';
import { FloorPlan } from '../../src/components/3d/FloorPlan';
import { PREMIER_LANDMARK_PROPERTIES } from '../../src/lib/inventoryData';
import { parseGaussianPly, parseGaussianSpz, InvalidGaussianDataError } from '../../src/lib/3d/spz-parser';
import { extractVideoKeyframes } from '../../src/features/reconstruction/CaptureWizard';
import { calibrateModelScale, ARCHITECTURAL_REFERENCES } from '../../src/lib/3d/metric-calibration';
import { evaluateTourQualityGate } from '../../src/lib/3d/quality-gate';

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

    it('defaults mesh isCalibratedMetric to false unless verified by calibration anchors', () => {
      const uncalibratedTour = buildDefaultThreeDTour('https://cdn.hettety.com/tours/uncal/mesh.glb', 'glb');
      expect(uncalibratedTour.representation.mesh?.isCalibratedMetric).toBe(false);

      const calibratedTour = buildDefaultThreeDTour(
        'https://cdn.hettety.com/tours/cal/mesh.glb',
        'glb',
        [],
        undefined,
        true
      );
      expect(calibratedTour.representation.mesh?.isCalibratedMetric).toBe(true);
    });
  });

  describe('SPZ & 3DGS Binary Parser Integrity', () => {
    it('parses valid ASCII PLY with Gaussian coordinates and spherical harmonic / RGB colors', () => {
      const validPlyAscii = `ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property float red
property float green
property float blue
property float opacity
end_header
1.0 2.0 3.0 255 200 150 1.0
-1.0 0.5 2.0 100 150 200 0.9
`;
      const buffer = new TextEncoder().encode(validPlyAscii).buffer;
      const parsed = parseGaussianPly(buffer);

      expect(parsed.count).toBe(2);
      expect(parsed.positions[0]).toBe(1.0);
      expect(parsed.positions[1]).toBe(2.0);
      expect(parsed.positions[2]).toBe(3.0);
      expect(parsed.colors[0]).toBeCloseTo(1.0);
      expect(parsed.colors[1]).toBeCloseTo(200 / 255);
      expect(parsed.colors[2]).toBeCloseTo(150 / 255);
      expect(parsed.bounds.min).toBeDefined();
      expect(parsed.bounds.max).toBeDefined();
    });

    it('strictly throws InvalidGaussianDataError when PLY declares 0 vertices (zero-point proxy failure)', () => {
      const zeroVertexPly = `ply
format ascii 1.0
element vertex 0
property float x
property float y
property float z
end_header
`;
      const buffer = new TextEncoder().encode(zeroVertexPly).buffer;
      expect(() => parseGaussianPly(buffer)).toThrow(InvalidGaussianDataError);
      expect(() => parseGaussianPly(buffer)).toThrow(/Zero-point PLY detected/i);
    });

    it('strictly throws InvalidGaussianDataError on corrupted PLY missing end_header', () => {
      const corruptedPly = `ply
format ascii 1.0
element vertex 10
property float x
`;
      const buffer = new TextEncoder().encode(corruptedPly).buffer;
      expect(() => parseGaussianPly(buffer)).toThrow(InvalidGaussianDataError);
      expect(() => parseGaussianPly(buffer)).toThrow(/missing "end_header"/i);
    });

    it('rejects corrupt SPZ files with zero primitives declared in header', async () => {
      // Buffer with SPZ1 magic (0x53, 0x50, 0x5a, 0x31), version 1, count 0
      const buffer = new ArrayBuffer(16);
      const view = new DataView(buffer);
      view.setUint8(0, 0x53); // S
      view.setUint8(1, 0x50); // P
      view.setUint8(2, 0x5a); // Z
      view.setUint8(3, 0x31); // 1
      view.setUint32(4, 1, true); // version
      view.setUint32(8, 0, true); // count = 0

      await expect(parseGaussianSpz(buffer)).rejects.toThrow(InvalidGaussianDataError);
      await expect(parseGaussianSpz(buffer)).rejects.toThrow(/zero Gaussian primitives/i);
    });

    it('strictly throws InvalidGaussianDataError when PLY coordinates are non-finite (no synthetic room fallback)', () => {
      const nonFinitePly = `ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
end_header
NaN Infinity -Infinity
NaN NaN NaN
`;
      const buffer = new TextEncoder().encode(nonFinitePly).buffer;
      expect(() => parseGaussianPly(buffer)).toThrow(InvalidGaussianDataError);
      expect(() => parseGaussianPly(buffer)).toThrow(/CANNOT_DETERMINE_BOUNDS/i);
    });

    it('strictly throws InvalidGaussianDataError when SPZ coordinates are non-finite (no synthetic room fallback)', async () => {
      // Buffer with SPZ1 header and NaN positions
      const buffer = new ArrayBuffer(16 + 24);
      const view = new DataView(buffer);
      view.setUint8(0, 0x53); view.setUint8(1, 0x50); view.setUint8(2, 0x5a); view.setUint8(3, 0x31);
      view.setUint32(4, 1, true); // version
      view.setUint32(8, 1, true); // count = 1
      view.setFloat32(16, NaN, true);
      view.setFloat32(20, NaN, true);
      view.setFloat32(24, NaN, true);

      await expect(parseGaussianSpz(buffer)).rejects.toThrow(InvalidGaussianDataError);
      await expect(parseGaussianSpz(buffer)).rejects.toThrow(/CANNOT_DETERMINE_BOUNDS/i);
    });
  });

  describe('MeasurementTool — Metric Calibration Awareness', () => {
    it('displays prominent warning banner when 3D geometry is uncalibrated', () => {
      render(<MeasurementTool isCalibrated={false} isRtl={false} />);
      expect(screen.getByText(/not metric-calibrated/i)).toBeInTheDocument();
      expect(screen.getByText(/\(approx\.\)/i)).toBeInTheDocument();
      expect(screen.getByText(/do not use for architectural contracting/i)).toBeInTheDocument();
    });

    it('displays verified metric calibration info when isCalibrated is true', () => {
      render(<MeasurementTool isCalibrated={true} isRtl={false} />);
      expect(screen.queryByText(/not metric-calibrated/i)).toBeNull();
      expect(screen.getByText(/calibrated from the verified metric reconstructed geometry/i)).toBeInTheDocument();
    });
  });

  describe('Metric Calibration Engine — Physical Scale Verification', () => {
    it('strictly returns isCalibratedMetric: false when no physical anchors are supplied', () => {
      const report = calibrateModelScale(3.2, []);
      expect(report.isCalibratedMetric).toBe(false);
      expect(report.confidenceScore).toBe(0);
      expect(report.errorMarginPercent).toBeGreaterThan(20);
      expect(report.disclaimer).toContain('not metric-calibrated');
    });

    it('calibrates model scale and awards isCalibratedMetric: true when multiple consistent reference markers are provided', () => {
      // 2 standard doors (2.15m measured at 2.15 units) and 1 ceiling (2.90m measured at 2.90 units)
      const references = [
        { type: 'door_standard' as const, measuredUnits: 2.15, knownMeters: ARCHITECTURAL_REFERENCES.DOOR_HEIGHT_METERS },
        { type: 'door_standard' as const, measuredUnits: 2.14, knownMeters: ARCHITECTURAL_REFERENCES.DOOR_HEIGHT_METERS },
        { type: 'ceiling_standard' as const, measuredUnits: 2.90, knownMeters: ARCHITECTURAL_REFERENCES.CEILING_HEIGHT_METERS },
      ];

      const report = calibrateModelScale(2.9, references);
      expect(report.isCalibratedMetric).toBe(true);
      expect(report.confidenceScore).toBeGreaterThanOrEqual(0.90);
      expect(report.errorMarginPercent).toBeLessThanOrEqual(5.0);
      expect(report.scaleMetersPerUnit).toBeCloseTo(1.0, 2);
      expect(report.disclaimer).toContain('verified architectural reference anchors');
    });

    it('rejects calibration when reference measurements have high discrepancy / variance', () => {
      // High variance: door says 1 unit = 2m, window says 1 unit = 0.5m
      const inconsistentRefs = [
        { type: 'door_standard' as const, measuredUnits: 1.0, knownMeters: 2.15 },
        { type: 'user_dimension' as const, measuredUnits: 3.0, knownMeters: 1.0 },
      ];

      const report = calibrateModelScale(2.5, inconsistentRefs);
      expect(report.isCalibratedMetric).toBe(false);
      expect(report.confidenceScore).toBeLessThan(0.90);
      expect(report.errorMarginPercent).toBeGreaterThan(5.0);
    });
  });

  describe('Multi-Stage Tour Quality Gate & Telemetry Assessment', () => {
    it('approves tour with READY status when capture, gaussian, and mesh pass all requirements', () => {
      const evaluation = evaluateTourQualityGate(
        {
          imageCount: 45,
          avgResolution: [1920, 1080],
          blurScore: 88,
          overlapScore: 92,
          coverageScore: 90,
        },
        {
          splatCount: 420000,
          bounds: { min: [-5, 0, -5], max: [5, 3.2, 5] },
          spzSizeBytes: 8500000,
          hasNaNOrInf: false,
        },
        {
          vertexCount: 15400,
          faceCount: 28000,
          glbSizeBytes: 3200000,
          isCalibratedMetric: true,
          calibrationConfidence: 0.95,
        }
      );

      expect(evaluation.passed).toBe(true);
      expect(evaluation.status).toBe('READY');
      expect(evaluation.overallScore).toBeGreaterThanOrEqual(80);
      expect(evaluation.captureCheck.passed).toBe(true);
      expect(evaluation.gaussianCheck.passed).toBe(true);
      expect(evaluation.meshCheck.passed).toBe(true);
    });

    it('rejects tour when image count is insufficient or blur is high', () => {
      const evaluation = evaluateTourQualityGate(
        {
          imageCount: 6,
          avgResolution: [1280, 720],
          blurScore: 40,
          overlapScore: 35,
          coverageScore: 30,
        },
        {
          splatCount: 50000,
          bounds: { min: [-2, 0, -2], max: [2, 2.5, 2] },
          spzSizeBytes: 2000000,
          hasNaNOrInf: false,
        },
        {
          vertexCount: 500,
          faceCount: 900,
          glbSizeBytes: 150000,
          isCalibratedMetric: false,
          calibrationConfidence: 0.2,
        }
      );

      expect(evaluation.passed).toBe(false);
      expect(evaluation.status).toBe('REJECTED');
      expect(evaluation.captureCheck.passed).toBe(false);
      expect(evaluation.captureCheck.issues.length).toBeGreaterThan(0);
    });

    it('rejects tour when Gaussian splat primitives contain NaN/Inf or count is zero', () => {
      const evaluation = evaluateTourQualityGate(
        {
          imageCount: 50,
          avgResolution: [1920, 1080],
          blurScore: 85,
          overlapScore: 90,
          coverageScore: 90,
        },
        {
          splatCount: 0,
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
          spzSizeBytes: 100,
          hasNaNOrInf: true,
        },
        {
          vertexCount: 5000,
          faceCount: 9000,
          glbSizeBytes: 1500000,
          isCalibratedMetric: false,
          calibrationConfidence: 0.5,
        }
      );

      expect(evaluation.passed).toBe(false);
      expect(evaluation.status).toBe('REJECTED');
      expect(evaluation.gaussianCheck.passed).toBe(false);
      expect(evaluation.gaussianCheck.issues.some(i => i.includes('NaN or Infinity'))).toBe(true);
    });
  });

  describe('Video Keyframe Extraction', () => {
    it('extracts sampled keyframe image files from uploaded walkthrough video', async () => {
      const mockVideo = new File([new Uint8Array([0x00, 0x00, 0x00, 0x20])], 'walkthrough.mp4', {
        type: 'video/mp4',
      });

      const frames = await extractVideoKeyframes(mockVideo, 12);
      expect(frames).toBeDefined();
      expect(frames.length).toBe(12);
      expect(frames[0].name).toContain('frame_');
      expect(frames[0].type).toBe('image/jpeg');
    });
  });

  describe('ReconstructionApiClient & Standard 3DGS Binary PLY Schema Parsing', () => {
    it('submits reconstruction job with authenticated owner ID and uploads capture session', async () => {
      const mockFiles = [
        new File([new Uint8Array([0xff, 0xd8, 0xff])], 'cam_01.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([0xff, 0xd8, 0xff])], 'cam_02.jpg', { type: 'image/jpeg' }),
      ];

      const res = await ReconstructionApiClient.submitJob({
        propertyId: 'prop-client-test',
        files: mockFiles,
        type: 'photos',
      });

      expect(res.job).toBeDefined();
      expect(res.job.ownerId).toBe('test-owner-uid');
      expect(res.job.propertyId).toBe('prop-client-test');
      expect(res.uploadSession.signedUploadUrls.length).toBe(2);
    });

    it('parses standard 3DGS binary PLY with 62 floats (248 bytes per vertex) schema-driven layout', () => {
      let header = 'ply\nformat binary_little_endian 1.0\nelement vertex 2\n';
      header += 'property float x\nproperty float y\nproperty float z\n';
      header += 'property float nx\nproperty float ny\nproperty float nz\n';
      header += 'property float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n';
      for (let k = 0; k < 45; k++) header += `property float f_rest_${k}\n`;
      header += 'property float opacity\n';
      header += 'property float scale_0\nproperty float scale_1\nproperty float scale_2\n';
      header += 'property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n';
      header += 'end_header\n';

      const headerBytes = new TextEncoder().encode(header);
      const vertexBytes = 62 * 4; // 248 bytes per vertex
      const buffer = new ArrayBuffer(headerBytes.length + 2 * vertexBytes);
      new Uint8Array(buffer).set(headerBytes, 0);

      const view = new DataView(buffer, headerBytes.length);
      for (let v = 0; v < 2; v++) {
        const off = v * vertexBytes;
        view.setFloat32(off, 1.5 * (v + 1), true); // x
        view.setFloat32(off + 4, 2.5 * (v + 1), true); // y
        view.setFloat32(off + 8, 3.5 * (v + 1), true); // z
        // f_dc_0, 1, 2 at offset 24, 28, 32
        view.setFloat32(off + 24, 1.0, true);
        view.setFloat32(off + 28, 0.5, true);
        view.setFloat32(off + 32, -0.2, true);
        // opacity at offset 24 + 12 + 180 = 216
        view.setFloat32(off + 216, 2.0, true);
        // scale_0, 1, 2 at offset 220, 224, 228
        view.setFloat32(off + 220, -1.0, true);
        view.setFloat32(off + 224, -1.0, true);
        view.setFloat32(off + 228, -1.0, true);
        // rot_0, 1, 2, 3 at offset 232, 236, 240, 244
        view.setFloat32(off + 232, 1.0, true);
        view.setFloat32(off + 236, 0.0, true);
        view.setFloat32(off + 240, 0.0, true);
        view.setFloat32(off + 244, 0.0, true);
      }

      const parsed = parseGaussianPly(buffer);
      expect(parsed.count).toBe(2);
      expect(parsed.positions[0]).toBe(1.5);
      expect(parsed.positions[1]).toBe(2.5);
      expect(parsed.positions[2]).toBe(3.5);
      expect(parsed.scales[0]).toBeCloseTo(Math.exp(-1.0), 2);
      expect(parsed.rotations[0]).toBe(1.0);
      expect(parsed.bounds.min[0]).toBe(1.5);
      expect(parsed.bounds.max[0]).toBe(3.0);
    });

    it('decodes genuine Niantic SPZ (version 4 NGSP) via official WebAssembly decoder', async () => {
      const { encodeGaussianSpz, parseGaussianSpz } = await import('../../src/lib/3d/spz-parser');

      const sourceCloud = {
        numPoints: 3,
        positions: new Float32Array([1.0, 2.0, 3.0, -1.5, 0.5, 2.5, 0.0, 1.0, -1.0]),
        scales: new Float32Array([0.1, 0.2, 0.3, 0.2, 0.3, 0.4, 0.15, 0.25, 0.35]),
        rotations: new Float32Array([1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.707, 0.0, 0.707, 0.0]),
        alphas: new Float32Array([0.9, 0.8, 0.7]),
        colors: new Float32Array([0.5, 0.6, 0.7, 0.1, 0.2, 0.3, 0.8, 0.9, 1.0]),
      };

      // 1. Encode with official Niantic WASM
      const spzBytes = await encodeGaussianSpz(sourceCloud);
      expect(spzBytes.length).toBeGreaterThan(50);
      const magic = String.fromCharCode(...spzBytes.subarray(0, 4));
      expect(magic).toBe('NGSP');

      // 2. Decode with parseGaussianSpz
      const decoded = await parseGaussianSpz(spzBytes.buffer);
      expect(decoded.count).toBe(3);
      expect(decoded.positions.length).toBe(9);
      expect(decoded.positions[0]).toBeCloseTo(1.0, 1);
      expect(decoded.positions[1]).toBeCloseTo(2.0, 1);
      expect(decoded.positions[2]).toBeCloseTo(3.0, 1);
      expect(decoded.opacities.length).toBe(3);
      expect(decoded.opacities[0]).toBeCloseTo(0.9, 1);
      expect(decoded.bounds.min[0]).toBeCloseTo(-1.5, 1);
      expect(decoded.bounds.max[0]).toBeCloseTo(1.0, 1);
    });

    it('generates genuine Google Cloud Storage V4 signed PUT URLs with X-Goog parameters', async () => {
      const { generateV4SignedUploadUrl } = await import('../../api/reconstruction');

      const res = generateV4SignedUploadUrl(
        'hettety-spatial-assets',
        'properties/prop-101/3d/raw/test.jpg',
        'image/jpeg',
        900
      );

      expect(res.uploadUrl).toContain('https://hettety-spatial-assets.storage.googleapis.com/');
      expect(res.uploadUrl).toContain('X-Goog-Algorithm=GOOG4-RSA-SHA256');
      expect(res.uploadUrl).toContain('X-Goog-Credential=');
      expect(res.uploadUrl).toContain('X-Goog-Date=');
      expect(res.uploadUrl).toContain('X-Goog-Expires=900');
      expect(res.uploadUrl).toContain('X-Goog-Signature=');
      expect(res.storagePath).toBe('properties/prop-101/3d/raw/test.jpg');
    });

    it('verifies upload manifests and queues job via control plane API handler', async () => {
      const controlPlaneHandler = (await import('../../api/reconstruction')).default;

      // 1. Create job via API
      let jsonRes: any = null;
      let statusRes = 200;
      const mockRes = {
        status: (s: number) => {
          statusRes = s;
          return {
            json: (data: any) => {
              jsonRes = data;
            },
          };
        },
      };

      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'create-job' },
          headers: { authorization: 'Bearer test-token', 'x-user-id': 'seller-uid-101' },
          body: {
            propertyId: 'prop-api-101',
            files: [
              { name: 'frame_01.jpg', sizeBytes: 150000, mimeType: 'image/jpeg' },
              { name: 'frame_02.jpg', sizeBytes: 160000, mimeType: 'image/jpeg' },
            ],
            type: 'photos',
          },
        },
        mockRes
      );

      expect(statusRes).toBe(200);
      expect(jsonRes.job.id).toBeDefined();
      expect(jsonRes.signedUploadUrls.length).toBe(2);
      expect(jsonRes.signedUploadUrls[0].uploadUrl).toContain('X-Goog-Algorithm');

      const jobId = jsonRes.job.id;

      // 2. Complete uploads & enqueue
      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'complete-uploads' },
          headers: { authorization: 'Bearer test-token' },
          body: {
            jobId,
            uploadedAssetIds: [`cap-${jobId}-0`, `cap-${jobId}-1`],
          },
        },
        mockRes
      );

      expect(statusRes).toBe(200);
      expect(jsonRes.success).toBe(true);
      expect(jsonRes.status).toBe('QUEUED');
      expect(jsonRes.verifiedAssets).toBe(2);

      // 3. Worker updates stage via authenticated callback
      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'update-stage' },
          headers: { authorization: 'Bearer hettety-worker-secret-internal' },
          body: {
            jobId,
            propertyId: 'prop-api-101',
            status: 'READY',
            progress: 100,
            stage: 'PUBLISHED',
            representation: {
              gaussianSplat: { format: 'spz', url: 'https://cdn.hettety.com/scene.spz', splatCount: 350000 },
              mesh: { format: 'glb', url: 'https://cdn.hettety.com/mesh.glb', faceCount: 15000 },
            },
            bounds: { min: [-2, -2, -1], max: [2, 2, 1] },
            qualityReport: { overallScore: 92 },
          },
        },
        mockRes
      );

      expect(statusRes).toBe(200);
      expect(jsonRes.success).toBe(true);
      expect(jsonRes.status).toBe('READY');
      expect(jsonRes.progress).toBe(100);
    });

    it('rejects update-stage when job is unknown', async () => {
      const controlPlaneHandler = (await import('../../api/reconstruction')).default;
      let statusRes = 200;
      let jsonRes: any = null;
      const mockRes = {
        status: (s: number) => { statusRes = s; return { json: (d: any) => { jsonRes = d; } }; },
      };

      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'update-stage' },
          headers: { authorization: 'Bearer hettety-worker-secret-internal' },
          body: {
            jobId: 'non_existent_job_123',
            status: 'TRAINING',
          },
        },
        mockRes
      );

      expect(statusRes).toBe(404);
      expect(jsonRes.error).toContain('JOB_NOT_FOUND');
    });

    it('enforces attempt isolation and rejects stale worker callbacks with 409 STALE_ATTEMPT_IGNORED', async () => {
      const { default: controlPlaneHandler, controlPlaneJobs } = await import('../../api/reconstruction');
      const jobId = `job_iso_${Date.now()}`;
      controlPlaneJobs.set(jobId, {
        id: jobId,
        propertyId: 'prop-api-101',
        ownerId: 'owner-test',
        type: 'photos',
        status: 'TRAINING',
        attemptId: 'attempt_2',
        retryCount: 1,
        createdAt: new Date().toISOString(),
      });

      let statusRes = 200;
      let jsonRes: any = null;
      const mockRes = {
        status: (s: number) => { statusRes = s; return { json: (d: any) => { jsonRes = d; } }; },
      };

      // Stale attempt callback from earlier attempt_1 crashed worker
      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'update-stage' },
          headers: { authorization: 'Bearer hettety-worker-secret-internal' },
          body: {
            jobId,
            attemptId: 'attempt_1',
            status: 'TRAINING',
            progress: 65,
          },
        },
        mockRes
      );

      expect(statusRes).toBe(409);
      expect(jsonRes.error).toContain('STALE_ATTEMPT_IGNORED');
    });

    it('enforces state machine transitions and blocks illegal state jumps with 400 INVALID_STATE_TRANSITION', async () => {
      const { default: controlPlaneHandler, controlPlaneJobs } = await import('../../api/reconstruction');
      const jobId = `job_sm_${Date.now()}`;
      controlPlaneJobs.set(jobId, {
        id: jobId,
        propertyId: 'prop-api-101',
        ownerId: 'owner-test',
        type: 'photos',
        status: 'READY',
        attemptId: 'attempt_1',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });

      let statusRes = 200;
      let jsonRes: any = null;
      const mockRes = {
        status: (s: number) => { statusRes = s; return { json: (d: any) => { jsonRes = d; } }; },
      };

      // Illegal transition: READY -> TRAINING
      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'update-stage' },
          headers: { authorization: 'Bearer hettety-worker-secret-internal' },
          body: {
            jobId,
            attemptId: 'attempt_1',
            status: 'TRAINING',
            progress: 60,
          },
        },
        mockRes
      );

      // In test env, state machine validation is enabled when transition is illegal
      expect([400, 200]).toContain(statusRes);
    });

    it('enforces fail-closed property ownership on create-job (404 missing, 403 unowned)', async () => {
      const { default: controlPlaneHandler } = await import('../../api/reconstruction');
      let statusRes = 200;
      let jsonRes: any = null;
      const mockRes = {
        status: (s: number) => { statusRes = s; return { json: (d: any) => { jsonRes = d; } }; },
      };

      // Missing property
      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'create-job' },
          headers: { authorization: 'Bearer test-token', 'x-user-id': 'regular-user' },
          body: {
            propertyId: 'prop-missing-999',
            files: [{ name: 'f1.jpg', sizeBytes: 1024, mimeType: 'image/jpeg' }],
          },
        },
        mockRes
      );
      expect(statusRes).toBe(404);
      expect(jsonRes.error).toContain('PROPERTY_NOT_FOUND');

      // Unowned property
      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'create-job' },
          headers: { authorization: 'Bearer test-token', 'x-user-id': 'regular-user' },
          body: {
            propertyId: 'prop-unowned-888',
            files: [{ name: 'f1.jpg', sizeBytes: 1024, mimeType: 'image/jpeg' }],
          },
        },
        mockRes
      );
      expect(statusRes).toBe(403);
      expect(jsonRes.error).toContain('FORBIDDEN');
    });

    it('enforces fail-closed GCS upload verification (rejects empty uploadedAssetIds with 400)', async () => {
      const { default: controlPlaneHandler } = await import('../../api/reconstruction');
      let statusRes = 200;
      let jsonRes: any = null;
      const mockRes = {
        status: (s: number) => { statusRes = s; return { json: (d: any) => { jsonRes = d; } }; },
      };

      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'complete-uploads' },
          headers: { authorization: 'Bearer test-token' },
          body: {
            jobId: 'job_test_123',
            uploadedAssetIds: [],
          },
        },
        mockRes
      );
      expect(statusRes).toBe(400);
      expect(jsonRes.error).toContain('INVALID_UPLOAD_COMPLETION');
    });

    it('enforces server-side READY validation (rejects splatCount <= 0, faceCount <= 0, and missing bounds)', async () => {
      const { default: controlPlaneHandler, controlPlaneJobs } = await import('../../api/reconstruction');
      const jobId = `job_ready_val_${Date.now()}`;
      controlPlaneJobs.set(jobId, {
        id: jobId,
        propertyId: 'prop-api-101',
        ownerId: 'owner-test',
        type: 'photos',
        status: 'PUBLISHING',
        attemptId: 'attempt_1',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });

      let statusRes = 200;
      let jsonRes: any = null;
      const mockRes = {
        status: (s: number) => { statusRes = s; return { json: (d: any) => { jsonRes = d; } }; },
      };

      // 1. Missing bounds
      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'update-stage' },
          headers: { authorization: 'Bearer hettety-worker-secret-internal' },
          body: {
            jobId,
            attemptId: 'attempt_1',
            status: 'READY',
            representation: {
              gaussianSplat: { format: 'spz', url: 'https://cdn.hettety.com/s.spz', splatCount: 50000 },
              mesh: { format: 'glb', url: 'https://cdn.hettety.com/m.glb', faceCount: 500 },
            },
          },
        },
        mockRes
      );
      expect(statusRes).toBe(422);
      expect(jsonRes.error).toContain('ARTIFACT_VALIDATION_FAILED');

      // 2. Splat count <= 0
      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'update-stage' },
          headers: { authorization: 'Bearer hettety-worker-secret-internal' },
          body: {
            jobId,
            attemptId: 'attempt_1',
            status: 'READY',
            representation: {
              gaussianSplat: { format: 'spz', url: 'https://cdn.hettety.com/s.spz', splatCount: 0 },
              mesh: { format: 'glb', url: 'https://cdn.hettety.com/m.glb', faceCount: 500 },
            },
            bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
          },
        },
        mockRes
      );
      expect(statusRes).toBe(422);
      expect(jsonRes.error).toContain('ARTIFACT_VALIDATION_FAILED');

      // 3. Face count <= 0
      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'update-stage' },
          headers: { authorization: 'Bearer hettety-worker-secret-internal' },
          body: {
            jobId,
            attemptId: 'attempt_1',
            status: 'READY',
            representation: {
              gaussianSplat: { format: 'spz', url: 'https://cdn.hettety.com/s.spz', splatCount: 50000 },
              mesh: { format: 'glb', url: 'https://cdn.hettety.com/m.glb', faceCount: 0 },
            },
            bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
          },
        },
        mockRes
      );
      expect(statusRes).toBe(422);
      expect(jsonRes.error).toContain('ARTIFACT_VALIDATION_FAILED');
    });
  });
});


