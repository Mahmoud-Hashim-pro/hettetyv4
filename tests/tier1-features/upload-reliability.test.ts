import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReconstructionApiClient } from '../../src/services/3d/reconstruction-api';
import * as assetService from '../../src/services/3d/asset-service';
import { controlPlaneJobs, default as controlPlaneHandler } from '../../api/reconstruction';

describe('Tier 1 — Phase 2: Upload Reliability, 1:1 Destination Integrity & Job Continuity', () => {
  beforeEach(() => {
    controlPlaneJobs.clear();
  });

  it('Requirement 1: Strictly rejects upload session when URL count is fewer than selected files (no silent truncation)', async () => {
    const files = [
      new File(['test1'], 'photo1.jpg', { type: 'image/jpeg' }),
      new File(['test2'], 'photo2.jpg', { type: 'image/jpeg' }),
      new File(['test3'], 'photo3.jpg', { type: 'image/jpeg' }),
    ];

    // Mock assetService to return only 2 URLs for 3 files
    const spy = vi.spyOn(assetService, 'createUploadSession').mockResolvedValueOnce({
      sessionId: 'sess-truncated',
      signedUploadUrls: [
        { fileName: 'photo1.jpg', uploadUrl: 'https://storage.googleapis.com/test/photo1.jpg', storagePath: 'properties/prop-1/3d/raw/job-1/photo1.jpg' },
        { fileName: 'photo2.jpg', uploadUrl: 'https://storage.googleapis.com/test/photo2.jpg', storagePath: 'properties/prop-1/3d/raw/job-1/photo2.jpg' },
      ],
    });

    await expect(
      ReconstructionApiClient.submitJob({
        propertyId: 'prop-1',
        files,
        type: 'photos',
      })
    ).rejects.toThrow(/UPLOAD_DESTINATION_MISMATCH/i);

    spy.mockRestore();
  });

  it('Requirement 2: Strictly rejects invalid upload destination without valid storagePath', async () => {
    const files = [new File(['test1'], 'photo1.jpg', { type: 'image/jpeg' })];

    const spy = vi.spyOn(assetService, 'createUploadSession').mockResolvedValueOnce({
      sessionId: 'sess-invalid-path',
      signedUploadUrls: [
        { fileName: 'photo1.jpg', uploadUrl: 'https://storage.googleapis.com/test/photo1.jpg', storagePath: '' },
      ],
    });

    await expect(
      ReconstructionApiClient.submitJob({
        propertyId: 'prop-1',
        files,
        type: 'photos',
      })
    ).rejects.toThrow(/INVALID_UPLOAD_DESTINATION/i);

    spy.mockRestore();
  });

  it('Requirement 3: Fails closed and aborts reconstruction enqueue if any single upload fails', async () => {
    const files = [
      new File(['test1'], 'photo1.jpg', { type: 'image/jpeg' }),
      new File(['test2'], 'photo2.jpg', { type: 'image/jpeg' }),
    ];

    const sessionSpy = vi.spyOn(assetService, 'createUploadSession').mockResolvedValueOnce({
      sessionId: 'sess-ok',
      signedUploadUrls: [
        { fileName: 'photo1.jpg', uploadUrl: 'https://storage.googleapis.com/test/photo1.jpg', storagePath: 'properties/prop-1/3d/raw/job-1/photo1.jpg' },
        { fileName: 'photo2.jpg', uploadUrl: 'https://storage.googleapis.com/test/photo2.jpg', storagePath: 'properties/prop-1/3d/raw/job-1/photo2.jpg' },
      ],
    });

    // Make the second file upload fail with a network error
    let callIndex = 0;
    const uploadSpy = vi.spyOn(assetService, 'uploadFileToSession').mockImplementation(async () => {
      callIndex++;
      if (callIndex === 2) {
        throw new Error('ETIMEDOUT: Connection reset by storage peer');
      }
    });

    await expect(
      ReconstructionApiClient.submitJob({
        propertyId: 'prop-1',
        files,
        type: 'photos',
      })
    ).rejects.toThrow(/PARTIAL_UPLOAD_FAILED/i);

    sessionSpy.mockRestore();
    uploadSpy.mockRestore();
  });

  it('Requirement 4: Retrying a job preserves original jobId and increments attemptId without duplicating jobs', async () => {
    const jobId = 'job-retry-continuity-101';
    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: 'prop-retry-101',
      ownerId: 'test-owner-uid',
      status: 'FAILED',
      stage: 'TRAINING',
      attemptId: 'attempt_1',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    } as any);

    // Call retry endpoint via ReconstructionApiClient
    const retriedJob = await ReconstructionApiClient.retryJob(jobId);

    expect(retriedJob).not.toBeNull();
    expect(retriedJob?.id).toBe(jobId);
    expect(retriedJob?.attemptId).toBe('attempt_2');
    expect(retriedJob?.status).toBe('QUEUED');
    expect(controlPlaneJobs.has(jobId)).toBe(true);
    expect(controlPlaneJobs.get(jobId)?.attemptId).toBe('attempt_2');
  });
});
