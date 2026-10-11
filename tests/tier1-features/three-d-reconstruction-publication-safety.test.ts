import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

describe('Tier 1 — Phase 1: 3D Reconstruction Publication Safety & Concurrency Invariants', () => {
  const storageRoot = path.resolve(process.cwd(), 'storage', 'spatial_assets');

  beforeEach(() => {
    fs.mkdirSync(storageRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(path.resolve(storageRoot, 'properties', 'prop-pub-safety'), { recursive: true, force: true });
    } catch (_) {}
  });

  it('Invariant 1: Two attempts run concurrently; only the valid current attempt becomes active', async () => {
    const { default: handler, controlPlaneJobs, mockPropertiesStore } = await import('../../api/reconstruction');
    const propId = 'prop-pub-safety';
    const jobId = 'job-concurrent-01';

    mockPropertiesStore.set(propId, { authorUid: 'owner-safe-01' });

    // Job is currently on attempt_2
    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: propId,
      ownerId: 'owner-safe-01',
      status: 'PUBLISHING',
      stage: 'PUBLISHING',
      attemptId: 'attempt_2',
      workerId: 'worker-node-beta',
      createdAt: new Date().toISOString(),
      stateVersion: 2,
    } as any);

    // Attempt 1 folder and Attempt 2 folder
    const dirAttempt1 = path.resolve(storageRoot, `properties/${propId}/3d/${jobId}/attempt_1`);
    const dirAttempt2 = path.resolve(storageRoot, `properties/${propId}/3d/${jobId}/attempt_2`);
    fs.mkdirSync(dirAttempt1, { recursive: true });
    fs.mkdirSync(dirAttempt2, { recursive: true });

    const spz2 = Buffer.from('VALID_ATTEMPT_2_SPZ');
    const glb2 = Buffer.from('VALID_ATTEMPT_2_GLB');
    fs.writeFileSync(path.resolve(dirAttempt2, 'scene.spz'), spz2);
    fs.writeFileSync(path.resolve(dirAttempt2, 'mesh.glb'), glb2);
    const spz2Sha = crypto.createHash('sha256').update(spz2).digest('hex');
    const glb2Sha = crypto.createHash('sha256').update(glb2).digest('hex');

    // Attempt 1 finishes late and tries to publish
    let status1 = 0;
    let json1: any = null;
    await handler({
      method: 'POST',
      query: { action: 'worker-callback' },
      headers: { authorization: 'Bearer hettety-worker-secret-internal' },
      body: {
        jobId,
        attemptId: 'attempt_1',
        workerId: 'worker-node-alpha',
        propertyId: propId,
        status: 'READY',
        representation: {
          gaussianSplat: { format: 'spz', url: `properties/${propId}/3d/${jobId}/attempt_1/scene.spz`, splatCount: 1000, sha256: 'a'.repeat(64) },
          mesh: { format: 'glb', url: `properties/${propId}/3d/${jobId}/attempt_1/mesh.glb`, faceCount: 500, sha256: 'b'.repeat(64) },
        },
      },
    }, { status: (s: number) => ({ json: (j: any) => { status1 = s; json1 = j; } }), json: (j: any) => { json1 = j; } });

    expect(status1).toBe(409);
    expect(json1.error).toContain('STALE_ATTEMPT_IGNORED');

    // Attempt 2 finishes and successfully publishes
    let status2 = 0;
    let json2: any = null;
    await handler({
      method: 'POST',
      query: { action: 'worker-callback' },
      headers: { authorization: 'Bearer hettety-worker-secret-internal' },
      body: {
        jobId,
        attemptId: 'attempt_2',
        workerId: 'worker-node-beta',
        propertyId: propId,
        status: 'READY',
        representation: {
          gaussianSplat: { format: 'spz', url: `properties/${propId}/3d/${jobId}/attempt_2/scene.spz`, splatCount: 50000, sha256: spz2Sha },
          mesh: { format: 'glb', url: `properties/${propId}/3d/${jobId}/attempt_2/mesh.glb`, faceCount: 15000, sha256: glb2Sha },
        },
        bounds: { min: [-2, 0, -2], max: [2, 3, 2] },
        qualityReport: { passed: true, status: 'READY', overallScore: 90 },
      },
    }, { status: (s: number) => ({ json: (j: any) => { status2 = s; json2 = j; } }), json: (j: any) => { json2 = j; } });

    expect(status2).toBe(200);
    const propRecord = mockPropertiesStore.get(propId);
    expect(propRecord?.activeReconstructionId).toBe(`${jobId}_attempt_2`);
    expect(propRecord?.publishedArtifact?.attemptId).toBe('attempt_2');
  });

  it('Invariant 2: An old worker finishes after a newer worker; the active model remains unchanged', async () => {
    const { default: handler, controlPlaneJobs, mockPropertiesStore } = await import('../../api/reconstruction');
    const propId = 'prop-pub-safety';
    const oldJobId = 'job-old-worker-01';
    const newJobId = 'job-new-worker-02';

    // Newer job already published a model on the property
    const activeTime = new Date('2026-10-10T12:00:00Z').toISOString();
    mockPropertiesStore.set(propId, {
      authorUid: 'owner-safe-01',
      activeReconstructionId: `${newJobId}_attempt_1`,
      publishedArtifact: {
        jobId: newJobId,
        attemptId: 'attempt_1',
        spzPath: `properties/${propId}/3d/${newJobId}/attempt_1/scene.spz`,
        glbPath: `properties/${propId}/3d/${newJobId}/attempt_1/mesh.glb`,
        publishedAt: activeTime,
      },
      threeDTour: {
        status: 'ready',
        activeAttemptId: 'attempt_1',
        activeJobId: newJobId,
      },
    });

    // Older job was created earlier (e.g. 2026-10-10T10:00:00Z)
    controlPlaneJobs.set(oldJobId, {
      id: oldJobId,
      propertyId: propId,
      ownerId: 'owner-safe-01',
      status: 'PUBLISHING',
      attemptId: 'attempt_1',
      workerId: 'worker-old-node',
      createdAt: '2026-10-10T10:00:00Z',
    } as any);

    let status = 0;
    let json: any = null;
    await handler({
      method: 'POST',
      query: { action: 'worker-callback' },
      headers: { authorization: 'Bearer hettety-worker-secret-internal' },
      body: {
        jobId: oldJobId,
        attemptId: 'attempt_1',
        workerId: 'worker-old-node',
        propertyId: propId,
        status: 'READY',
        representation: {
          gaussianSplat: { format: 'spz', url: `properties/${propId}/3d/${oldJobId}/attempt_1/scene.spz`, splatCount: 5000, sha256: 'a'.repeat(64) },
          mesh: { format: 'glb', url: `properties/${propId}/3d/${oldJobId}/attempt_1/mesh.glb`, faceCount: 2000, sha256: 'b'.repeat(64) },
        },
        bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
        qualityReport: { passed: true, status: 'READY' },
      },
    }, { status: (s: number) => ({ json: (j: any) => { status = s; json = j; } }), json: (j: any) => { json = j; } });

    expect(status).toBe(409);
    expect(json.error).toContain('STALE_ATTEMPT_IGNORED');

    // Verify property active model was NOT altered
    const currentProp = mockPropertiesStore.get(propId);
    expect(currentProp.activeReconstructionId).toBe(`${newJobId}_attempt_1`);
    expect(currentProp.publishedArtifact.jobId).toBe(newJobId);
  });

  it('Invariant 3: A file copy fails halfway through; the active model remains untouched', async () => {
    const { default: handler, controlPlaneJobs, mockPropertiesStore } = await import('../../api/reconstruction');
    const propId = 'prop-pub-safety';
    const jobId = 'job-copy-fail-01';

    mockPropertiesStore.set(propId, {
      authorUid: 'owner-safe-01',
      activeReconstructionId: 'job-previous-active_attempt_1',
    });

    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: propId,
      ownerId: 'owner-safe-01',
      status: 'PUBLISHING',
      attemptId: 'attempt_1',
      workerId: 'worker-copy-node',
      createdAt: new Date().toISOString(),
    } as any);

    const attemptDir = path.resolve(storageRoot, `properties/${propId}/3d/${jobId}/attempt_1`);
    fs.mkdirSync(attemptDir, { recursive: true });
    const spzBuf = Buffer.from('SPZ_COPY_TEST');
    const glbBuf = Buffer.from('GLB_COPY_TEST');
    fs.writeFileSync(path.resolve(attemptDir, 'scene.spz'), spzBuf);
    fs.writeFileSync(path.resolve(attemptDir, 'mesh.glb'), glbBuf);
    const spzSha = crypto.createHash('sha256').update(spzBuf).digest('hex');
    const glbSha = crypto.createHash('sha256').update(glbBuf).digest('hex');

    // Simulate an unexpected disk write error during copy
    const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied during atomic promotion copy');
    });

    let status = 0;
    let json: any = null;
    await handler({
      method: 'POST',
      query: { action: 'worker-callback' },
      headers: { authorization: 'Bearer hettety-worker-secret-internal' },
      body: {
        jobId,
        attemptId: 'attempt_1',
        workerId: 'worker-copy-node',
        propertyId: propId,
        status: 'READY',
        representation: {
          gaussianSplat: { format: 'spz', url: `properties/${propId}/3d/${jobId}/attempt_1/scene.spz`, splatCount: 10000, sha256: spzSha },
          mesh: { format: 'glb', url: `properties/${propId}/3d/${jobId}/attempt_1/mesh.glb`, faceCount: 5000, sha256: glbSha },
        },
        bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
        qualityReport: { passed: true, status: 'READY' },
      },
    }, { status: (s: number) => ({ json: (j: any) => { status = s; json = j; } }), json: (j: any) => { json = j; } });

    copySpy.mockRestore();

    expect(status).toBe(502);
    expect(json.errorCode).toBe('PROMOTION_FAILED');

    // Ensure the property's previous active model was preserved
    const propRecord = mockPropertiesStore.get(propId);
    expect(propRecord.activeReconstructionId).toBe('job-previous-active_attempt_1');
    expect(controlPlaneJobs.get(jobId)?.status).toBe('PUBLISHING');
  });

  it('Invariant 4: A callback has a missing or incorrect attempt ID; publication is rejected', async () => {
    const { default: handler, controlPlaneJobs, mockPropertiesStore } = await import('../../api/reconstruction');
    const propId = 'prop-pub-safety';
    const jobId = 'job-attempt-mismatch';

    mockPropertiesStore.set(propId, { authorUid: 'owner-safe-01' });
    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: propId,
      ownerId: 'owner-safe-01',
      status: 'PUBLISHING',
      attemptId: 'attempt_active_3',
      workerId: 'worker-ident-1',
    } as any);

    // Call with mismatched attempt ID
    let status = 0;
    let json: any = null;
    await handler({
      method: 'POST',
      query: { action: 'worker-callback' },
      headers: { authorization: 'Bearer hettety-worker-secret-internal' },
      body: {
        jobId,
        attemptId: 'attempt_stale_1',
        workerId: 'worker-ident-1',
        propertyId: propId,
        status: 'READY',
        representation: {
          gaussianSplat: { format: 'spz', url: 'https://cdn.hettety.com/tour.spz', sha256: 'a'.repeat(64) },
          mesh: { format: 'glb', url: 'https://cdn.hettety.com/tour.glb', sha256: 'b'.repeat(64) },
        },
      },
    }, { status: (s: number) => ({ json: (j: any) => { status = s; json = j; } }), json: (j: any) => { json = j; } });

    expect(status).toBe(409);
    expect(json.errorCode).toBe('STALE_ATTEMPT_IGNORED');
  });

  it('Invariant 5: A callback comes from an unauthorized worker or bad secret; publication is rejected', async () => {
    const { default: handler, controlPlaneJobs } = await import('../../api/reconstruction');
    const jobId = 'job-unauth-test';

    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: 'prop-pub-safety',
      status: 'PUBLISHING',
      workerId: 'worker-registered-01',
      attemptId: 'attempt_1',
    } as any);

    // 1. Wrong worker secret token
    let statusSecret = 0;
    await handler({
      method: 'POST',
      query: { action: 'worker-callback' },
      headers: { authorization: 'Bearer completely-fake-secret' },
      body: { jobId, attemptId: 'attempt_1', workerId: 'worker-registered-01' },
    }, { status: (s: number) => ({ json: () => { statusSecret = s; } }), json: () => {} });

    expect(statusSecret).toBe(401);

    // 2. Mismatched workerId
    let statusWorker = 0;
    let jsonWorker: any = null;
    await handler({
      method: 'POST',
      query: { action: 'worker-callback' },
      headers: { authorization: 'Bearer hettety-worker-secret-internal' },
      body: {
        jobId,
        attemptId: 'attempt_1',
        workerId: 'worker-imposter-99',
        status: 'READY',
      },
    }, { status: (s: number) => ({ json: (j: any) => { statusWorker = s; jsonWorker = j; } }), json: (j: any) => { jsonWorker = j; } });

    expect(statusWorker).toBe(409);
    expect(jsonWorker.errorCode).toBe('WORKER_MISMATCH_IGNORED');
  });

  it('Invariant 6: A required artifact is corrupt or has mismatched hash; publication is rejected', async () => {
    const { default: handler, controlPlaneJobs, mockPropertiesStore } = await import('../../api/reconstruction');
    const propId = 'prop-pub-safety';
    const jobId = 'job-corrupt-hash';

    mockPropertiesStore.set(propId, { authorUid: 'owner-safe-01' });
    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: propId,
      ownerId: 'owner-safe-01',
      status: 'PUBLISHING',
      attemptId: 'attempt_1',
      workerId: 'worker-hash-node',
    } as any);

    const attemptDir = path.resolve(storageRoot, `properties/${propId}/3d/${jobId}/attempt_1`);
    fs.mkdirSync(attemptDir, { recursive: true });
    fs.writeFileSync(path.resolve(attemptDir, 'scene.spz'), Buffer.from('REAL_SPZ_BYTES'));
    fs.writeFileSync(path.resolve(attemptDir, 'mesh.glb'), Buffer.from('REAL_GLB_BYTES'));

    let status = 0;
    let json: any = null;
    await handler({
      method: 'POST',
      query: { action: 'worker-callback' },
      headers: { authorization: 'Bearer hettety-worker-secret-internal' },
      body: {
        jobId,
        attemptId: 'attempt_1',
        workerId: 'worker-hash-node',
        propertyId: propId,
        status: 'READY',
        representation: {
          gaussianSplat: {
            format: 'spz',
            url: `properties/${propId}/3d/${jobId}/attempt_1/scene.spz`,
            splatCount: 1000,
            sha256: 'deadbeef'.repeat(8), // Incorrect corrupted hash
          },
          mesh: {
            format: 'glb',
            url: `properties/${propId}/3d/${jobId}/attempt_1/mesh.glb`,
            faceCount: 500,
            sha256: 'badc0ffe'.repeat(8),
          },
        },
        bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
        qualityReport: { passed: true, status: 'READY' },
      },
    }, { status: (s: number) => ({ json: (j: any) => { status = s; json = j; } }), json: (j: any) => { json = j; } });

    expect(status).toBe(422);
    expect(json.error).toContain('ARTIFACT_CORRUPTED');
  });
});
