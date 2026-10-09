import { describe, it, expect, beforeEach, vi } from 'vitest';
import { evaluateTourQualityGate } from '../../src/lib/3d/quality-gate';
import { handler, controlPlaneJobs } from '../../api/reconstruction';

describe('Tier 1 — Authoritative 3D Lifecycle & Certification Contract Verification', () => {
  describe('Invariant 1: READY Gate Requires All Artifacts and Valid Geometry', () => {
    it('strictly rejects READY status if camera alignment, splat primitives, or GLB containers fail', () => {
      // Degenerate camera alignment
      const badCam = evaluateTourQualityGate(
        { imageCount: 30, avgResolution: [1920, 1080], blurScore: 85, overlapScore: 20, coverageScore: 30 },
        { splatCount: 50000, bounds: { min: [-2, 0, -2], max: [2, 3, 2] }, spzSizeBytes: 5000000, hasNaNOrInf: false },
        { vertexCount: 500, faceCount: 900, glbSizeBytes: 20000, isCalibratedMetric: false, calibrationConfidence: 0 }
      );
      expect(badCam.passed).toBe(false);
      expect(badCam.status).toBe('REJECTED');
      expect(badCam.certification?.status).toBe('REJECTED');

      // Degenerate or non-finite bounding box
      const badBounds = evaluateTourQualityGate(
        { imageCount: 30, avgResolution: [1920, 1080], blurScore: 85, overlapScore: 80, coverageScore: 80 },
        { splatCount: 50000, bounds: { min: [NaN as any, 0, 0], max: [2, 3, 2] }, spzSizeBytes: 5000000, hasNaNOrInf: false },
        { vertexCount: 500, faceCount: 900, glbSizeBytes: 20000, isCalibratedMetric: false, calibrationConfidence: 0 }
      );
      expect(badBounds.passed).toBe(false);
      expect(badBounds.status).toBe('REJECTED');

      // Truncated GLB container (< 12 bytes header)
      const badGlb = evaluateTourQualityGate(
        { imageCount: 30, avgResolution: [1920, 1080], blurScore: 85, overlapScore: 80, coverageScore: 80 },
        { splatCount: 50000, bounds: { min: [-2, 0, -2], max: [2, 3, 2] }, spzSizeBytes: 5000000, hasNaNOrInf: false },
        { vertexCount: 500, faceCount: 900, glbSizeBytes: 10, isCalibratedMetric: false, calibrationConfidence: 0 }
      );
      expect(badGlb.passed).toBe(false);
      expect(badGlb.status).toBe('REJECTED');
    });
  });

  describe('Invariant 2: METRIC_CERTIFIED vs VISUAL_READY Integrity', () => {
    it('awards VISUAL_READY when visual geometry passes without physical survey claim', () => {
      const evaluation = evaluateTourQualityGate(
        { imageCount: 35, avgResolution: [1920, 1080], blurScore: 88, overlapScore: 85, coverageScore: 90 },
        { splatCount: 200000, bounds: { min: [-3, 0, -3], max: [3, 2.8, 3] }, spzSizeBytes: 7000000, hasNaNOrInf: false },
        { vertexCount: 8000, faceCount: 15000, glbSizeBytes: 2500000, isCalibratedMetric: false, calibrationConfidence: 0 }
      );

      expect(evaluation.passed).toBe(true);
      expect(evaluation.status).toBe('READY');
      expect(evaluation.certification?.visualReady).toBe(true);
      expect(evaluation.certification?.metricCertified).toBe(false);
      expect(evaluation.certification?.status).toBe('VISUAL_READY');
    });

    it('awards METRIC_CERTIFIED only when physical calibration passes strict confidence and RMSE thresholds', () => {
      const evaluation = evaluateTourQualityGate(
        { imageCount: 35, avgResolution: [1920, 1080], blurScore: 88, overlapScore: 85, coverageScore: 90 },
        { splatCount: 200000, bounds: { min: [-3, 0, -3], max: [3, 2.8, 3] }, spzSizeBytes: 7000000, hasNaNOrInf: false },
        { vertexCount: 8000, faceCount: 15000, glbSizeBytes: 2500000, isCalibratedMetric: true, calibrationConfidence: 0.95, calibrationRmse: 0.018 }
      );

      expect(evaluation.passed).toBe(true);
      expect(evaluation.status).toBe('READY');
      expect(evaluation.certification?.visualReady).toBe(true);
      expect(evaluation.certification?.metricCertified).toBe(true);
      expect(evaluation.certification?.status).toBe('METRIC_CERTIFIED');
    });

    it('fails closed to REJECTED if a tour claims metric calibration but fails thresholds', () => {
      const evaluation = evaluateTourQualityGate(
        { imageCount: 35, avgResolution: [1920, 1080], blurScore: 88, overlapScore: 85, coverageScore: 90 },
        { splatCount: 200000, bounds: { min: [-3, 0, -3], max: [3, 2.8, 3] }, spzSizeBytes: 7000000, hasNaNOrInf: false },
        { vertexCount: 8000, faceCount: 15000, glbSizeBytes: 2500000, isCalibratedMetric: true, calibrationConfidence: 0.82, calibrationRmse: 0.065 }
      );

      expect(evaluation.passed).toBe(false);
      expect(evaluation.status).toBe('REJECTED');
      expect(evaluation.certification?.metricCertified).toBe(false);
      expect(evaluation.certification?.status).toBe('REJECTED');
    });
  });

  describe('Invariant 3: Failed Quality Gate Blocks Tour Publishing', () => {
    it('rejects worker READY transition when quality report contains failed checks', async () => {
      controlPlaneJobs.set('job_test_qg_block', {
        id: 'job_test_qg_block',
        propertyId: 'prop_test_qg',
        ownerId: 'owner_test',
        type: 'photos',
        status: 'PUBLISHING',
        attemptId: 'attempt_1',
        workerId: 'worker_gpu_node_1',
        manifest: [],
        createdAt: new Date().toISOString(),
        retryCount: 0,
        stateVersion: 1,
      });

      const mockReq = {
        method: 'POST',
        headers: {
          'x-worker-auth': 'test-worker-key',
          'x-worker-id': 'worker_gpu_node_1',
        },
        query: { action: 'worker-callback' },
        body: {
          jobId: 'job_test_qg_block',
          attemptId: 'attempt_1',
          stateVersion: 1,
          status: 'READY',
          qualityReport: {
            passed: false, // Quality gate failed
            status: 'REJECTED',
            reasons: ['Mean reprojection error exceeds 3.0px limit'],
          },
        },
      };

      let statusSent = 0;
      let bodySent: any = null;
      const mockRes = {
        status: (s: number) => {
          statusSent = s;
          return {
            json: (b: any) => { bodySent = b; return b; },
          };
        },
      };

      await handler(mockReq as any, mockRes as any);
      expect(statusSent).toBe(422);
      expect(bodySent.error).toContain('QUALITY_GATE_REJECTED');
    });
  });

  describe('Invariant 4: Stale Attempts and Worker Identity Mismatches Rejected', () => {
    it('rejects callbacks from previous attempt IDs when job was retried', async () => {
      controlPlaneJobs.set('job_test_stale_attempt', {
        id: 'job_test_stale_attempt',
        propertyId: 'prop_test_stale',
        ownerId: 'owner_test',
        type: 'photos',
        status: 'TRAINING',
        attemptId: 'attempt_active_2', // Active is attempt_active_2
        workerId: 'worker_gpu_node_1',
        manifest: [],
        createdAt: new Date().toISOString(),
        retryCount: 1,
        stateVersion: 2,
      });

      const mockReq = {
        method: 'POST',
        headers: {
          'x-worker-auth': 'test-worker-key',
          'x-worker-id': 'worker_gpu_node_1',
        },
        query: { action: 'worker-callback' },
        body: {
          jobId: 'job_test_stale_attempt',
          attemptId: 'attempt_old_0', // Stale attempt ID
          stateVersion: 2,
          status: 'TRAINING',
        },
      };

      let statusSent = 0;
      let bodySent: any = null;
      const mockRes = {
        status: (s: number) => {
          statusSent = s;
          return {
            json: (b: any) => { bodySent = b; return b; },
          };
        },
      };

      await handler(mockReq as any, mockRes as any);
      // Fails with 404/409 safely
      expect(statusSent).toBeGreaterThanOrEqual(400);
    });
  });
});
