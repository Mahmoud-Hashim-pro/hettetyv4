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

  it('Requirement 5: Detects conflicting parameters for the same idempotency key and returns 409 IDEMPOTENCY_CONFLICT', async () => {
    const ownerId = 'user-idemp-conflict-owner';
    const idempKey = 'idemp-conflict-test-key-1';

    let status1 = 0, json1: any = null;
    await controlPlaneHandler({
      method: 'POST',
      query: { action: 'create-job' },
      headers: { authorization: 'Bearer token-owner', 'x-user-id': ownerId, 'idempotency-key': idempKey },
      body: {
        propertyId: 'prop-idemp-1',
        type: 'photos',
        files: [{ name: 'photo1.jpg', sizeBytes: 5000, mimeType: 'image/jpeg' }],
      },
    }, { status: (s: number) => ({ json: (j: any) => { status1 = s; json1 = j; } }), json: (j: any) => { json1 = j; } });

    expect(status1).toBe(200);
    expect(json1.job.id).toBeDefined();

    // Call with SAME idempotency key but DIFFERENT propertyId
    let status2 = 0, json2: any = null;
    await controlPlaneHandler({
      method: 'POST',
      query: { action: 'create-job' },
      headers: { authorization: 'Bearer token-owner', 'x-user-id': ownerId, 'idempotency-key': idempKey },
      body: {
        propertyId: 'prop-different-conflicting-prop',
        type: 'photos',
        files: [{ name: 'photo1.jpg', sizeBytes: 5000, mimeType: 'image/jpeg' }],
      },
    }, { status: (s: number) => ({ json: (j: any) => { status2 = s; json2 = j; } }), json: (j: any) => { json2 = j; } });

    expect(status2).toBe(409);
    expect(json2.errorCode).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('Requirement 6: Recovers upload session for an existing job via action=create-upload-session', async () => {
    const ownerId = 'user-session-recovery-owner';
    const jobId = 'job-session-recovery-99';
    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: 'prop-recovery-1',
      ownerId,
      status: 'UPLOADING',
      attemptId: 'attempt_1',
      manifest: [
        { id: 'cap-1', storagePath: `properties/prop-recovery-1/3d/raw/${jobId}/img1.jpg`, sizeBytes: 1000, mimeType: 'image/jpeg', validationStatus: 'PENDING' },
      ],
      createdAt: new Date().toISOString(),
    } as any);

    let status = 0, json: any = null;
    await controlPlaneHandler({
      method: 'POST',
      query: { action: 'create-upload-session' },
      headers: { authorization: 'Bearer token-owner', 'x-user-id': ownerId },
      body: { jobId },
    }, { status: (s: number) => ({ json: (j: any) => { status = s; json = j; } }), json: (j: any) => { json = j; } });

    expect(status).toBe(200);
    expect(json.sessionId).toBe(`session_${jobId}`);
    expect(json.signedUploadUrls.length).toBe(1);
    expect(json.signedUploadUrls[0].storagePath).toContain('properties/prop-recovery-1/3d/raw/');
  });

  it('Requirement 7: Retrieves job status via GET /api/reconstruction?action=get-job&jobId=...', async () => {
    const ownerId = 'user-get-job-owner';
    const jobId = 'job-get-test-88';
    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: 'prop-get-1',
      ownerId,
      status: 'QUEUED',
      attemptId: 'attempt_1',
      createdAt: new Date().toISOString(),
    } as any);

    let status = 0, json: any = null;
    await controlPlaneHandler({
      method: 'GET',
      query: { action: 'get-job', jobId },
      headers: { authorization: 'Bearer token-owner', 'x-user-id': ownerId },
    }, { status: (s: number) => ({ json: (j: any) => { status = s; json = j; } }), json: (j: any) => { json = j; } });

    expect(status).toBe(200);
    expect(json.job.id).toBe(jobId);
    expect(json.job.status).toBe('QUEUED');
  });

  it('Requirement 8: Rejects invalid file MIME types and path-traversing filenames in upload manifest', async () => {
    const ownerId = 'user-manifest-val-owner';

    // 1. Path traversal in filename
    let statusTraverse = 0, jsonTraverse: any = null;
    await controlPlaneHandler({
      method: 'POST',
      query: { action: 'create-job' },
      headers: { authorization: 'Bearer token-owner', 'x-user-id': ownerId },
      body: {
        propertyId: 'prop-val-1',
        type: 'photos',
        files: [{ name: '../../etc/passwd', sizeBytes: 1000, mimeType: 'image/jpeg' }],
      },
    }, { status: (s: number) => ({ json: (j: any) => { statusTraverse = s; jsonTraverse = j; } }), json: (j: any) => { jsonTraverse = j; } });

    expect(statusTraverse).toBe(400);
    expect(jsonTraverse.error).toContain('INVALID_FILENAME');

    // 2. Disallowed MIME type
    let statusMime = 0, jsonMime: any = null;
    await controlPlaneHandler({
      method: 'POST',
      query: { action: 'create-job' },
      headers: { authorization: 'Bearer token-owner', 'x-user-id': ownerId },
      body: {
        propertyId: 'prop-val-1',
        type: 'photos',
        files: [{ name: 'payload.exe', sizeBytes: 1000, mimeType: 'application/x-msdownload' }],
      },
    }, { status: (s: number) => ({ json: (j: any) => { statusMime = s; jsonMime = j; } }), json: (j: any) => { jsonMime = j; } });

    expect(statusMime).toBe(400);
    expect(jsonMime.error).toContain('INVALID_FILE_TYPE');
  });

  it('Requirement 9: Deduplicates worker queue keys (reconstruction:{jobId}:{attemptId})', async () => {
    const { enqueueToRedis, enqueuedWorkerJobs } = await import('../../api/reconstruction');
    const mockJob = {
      id: 'job-queue-dedup-1',
      attemptId: 'attempt_1',
      propertyId: 'prop-1',
      ownerId: 'owner-1',
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
    } as any;

    enqueuedWorkerJobs.clear();
    const res1 = await enqueueToRedis(mockJob);
    expect(res1).toBe(true);
    expect(enqueuedWorkerJobs.has('reconstruction:job-queue-dedup-1:attempt_1')).toBe(true);

    // Second call with same attempt: safely deduplicated
    const res2 = await enqueueToRedis(mockJob);
    expect(res2).toBe(true);
  });
});
