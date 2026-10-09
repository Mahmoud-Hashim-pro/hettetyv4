import { describe, it, expect, beforeEach } from 'vitest';
import handler, {
  controlPlaneJobs,
  mockPropertiesStore,
} from '../../api/reconstruction';

describe('Tier 2 — Signed Upload & Property Ownership Authorization Integration Tests', () => {
  beforeEach(() => {
    controlPlaneJobs.clear();
    mockPropertiesStore.clear();
  });

  it('strictly rejects job creation when caller does not own the target property', async () => {
    // Target property owned by legitimate seller
    mockPropertiesStore.set('prop_luxury_villa_101', {
      authorUid: 'user_legitimate_seller_123',
      title: 'Luxury Villa 101',
    });

    let resStatus = 0;
    let resJson: any = null;
    const mockRes = {
      status: (s: number) => {
        resStatus = s;
        return { json: (d: any) => { resJson = d; return d; } };
      },
    };

    // Attacker attempts to initiate reconstruction for legitimate seller's property
    await handler(
      {
        method: 'POST',
        query: { action: 'create-job' },
        headers: {
          authorization: 'Bearer attacker_token',
          'x-user-id': 'user_attacker_999', // Non-owner
        },
        body: {
          propertyId: 'prop_luxury_villa_101',
          files: [
            { name: 'photo_01.jpg', sizeBytes: 1024 * 1024, mimeType: 'image/jpeg' },
          ],
        },
      },
      mockRes
    );

    expect(resStatus).toBe(403);
    expect(resJson.error).toContain('FORBIDDEN');
    expect(resJson.error).toContain('You do not own this property');
  });

  it('derives job ownerId strictly from authenticated token, ignoring spoofed ownerId in payload', async () => {
    mockPropertiesStore.set('prop_legit_owner_55', {
      authorUid: 'user_authentic_777',
      title: 'Authentic Apartment',
    });

    let resStatus = 0;
    let resJson: any = null;
    const mockRes = {
      status: (s: number) => {
        resStatus = s;
        return { json: (d: any) => { resJson = d; return d; } };
      },
    };

    // Caller passes spoofed ownerId 'victim_impersonated_id' in body
    await handler(
      {
        method: 'POST',
        query: { action: 'create-job' },
        headers: {
          authorization: 'Bearer auth_token_777',
          'x-user-id': 'user_authentic_777',
        },
        body: {
          propertyId: 'prop_legit_owner_55',
          ownerId: 'victim_impersonated_id', // Spoofed payload
          files: [
            { name: 'cam_01.jpg', sizeBytes: 2000000, mimeType: 'image/jpeg' },
          ],
        },
      },
      mockRes
    );

    expect(resStatus).toBe(200);
    expect(resJson.job).toBeDefined();
    // Must be bound to authenticated caller, NEVER the spoofed ownerId!
    expect(resJson.job.ownerId).toBe('user_authentic_777');
    expect(resJson.job.ownerId).not.toBe('victim_impersonated_id');
  });

  it('strictly binds signed upload URLs to properties/{propertyId}/3d/raw/{jobId}/{filename}', async () => {
    mockPropertiesStore.set('prop_scope_test', {
      authorUid: 'user_scope_owner',
      title: 'Scope Test',
    });

    let resStatus = 0;
    let resJson: any = null;
    const mockRes = {
      status: (s: number) => {
        resStatus = s;
        return { json: (d: any) => { resJson = d; return d; } };
      },
    };

    // Attempt path traversal via file name
    await handler(
      {
        method: 'POST',
        query: { action: 'create-job' },
        headers: {
          authorization: 'Bearer scope_token',
          'x-user-id': 'user_scope_owner',
        },
        body: {
          propertyId: 'prop_scope_test',
          files: [
            { name: '../../../etc/passwd.jpg', sizeBytes: 500000, mimeType: 'image/jpeg' },
            { name: 'valid_room.jpg', sizeBytes: 800000, mimeType: 'image/jpeg' },
          ],
        },
      },
      mockRes
    );

    expect(resStatus).toBe(200);
    const manifest = resJson.job.manifest;
    expect(manifest.length).toBe(2);

    for (const item of manifest) {
      // Must start with canonical raw path
      expect(item.storagePath).toMatch(new RegExp(`^properties/prop_scope_test/3d/raw/${resJson.job.id}/`));
      // Must sanitize ../ path traversal
      expect(item.storagePath).not.toContain('..');
      expect(item.uploadUrl).toBeDefined();
    }
  });

  it('strictly rejects complete-uploads from non-owner caller', async () => {
    const jobId = 'job_ownership_lock_10';
    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: 'prop_owned_by_alice',
      ownerId: 'user_alice_1', // Owned by Alice
      type: 'photos',
      status: 'UPLOADING',
      attemptId: 'attempt_1',
      manifest: [
        {
          id: 'asset_1',
          storagePath: `properties/prop_owned_by_alice/3d/raw/${jobId}/f1.jpg`,
          uploadUrl: 'https://storage.googleapis.com/...',
          sizeBytes: 1000000,
          mimeType: 'image/jpeg',
          validationStatus: 'PENDING',
        },
      ],
      createdAt: new Date().toISOString(),
      retryCount: 0,
      stateVersion: 1,
    });

    let resStatus = 0;
    let resJson: any = null;
    const mockRes = {
      status: (s: number) => {
        resStatus = s;
        return { json: (d: any) => { resJson = d; return d; } };
      },
    };

    // Bob tries to complete Alice's job uploads
    await handler(
      {
        method: 'POST',
        query: { action: 'complete-uploads' },
        headers: {
          authorization: 'Bearer bob_token',
          'x-user-id': 'user_bob_2', // Not Alice
        },
        body: {
          jobId,
          uploadedAssetIds: ['asset_1'],
        },
      },
      mockRes
    );

    expect(resStatus).toBe(403);
    expect(resJson.error).toContain('FORBIDDEN');
    expect(resJson.error).toContain('You do not own this reconstruction job');
  });

  it('strictly rejects complete-uploads when the 2-hour upload session has expired', async () => {
    const jobId = 'job_expired_session_99';
    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: 'prop_expired_session',
      ownerId: 'user_expired_session_owner',
      type: 'photos',
      status: 'UPLOADING',
      attemptId: 'attempt_1',
      manifest: [
        {
          id: 'asset_exp_1',
          storagePath: `properties/prop_expired_session/3d/raw/${jobId}/f1.jpg`,
          uploadUrl: 'https://storage.googleapis.com/...',
          sizeBytes: 1000000,
          mimeType: 'image/jpeg',
          validationStatus: 'PENDING',
        },
      ],
      createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      uploadSessionExpiresAt: new Date(Date.now() - 1000).toISOString(), // Expired
      retryCount: 0,
      stateVersion: 1,
    });

    let resStatus = 0;
    let resJson: any = null;
    const mockRes = {
      status: (s: number) => {
        resStatus = s;
        return { json: (d: any) => { resJson = d; return d; } };
      },
    };

    await handler(
      {
        method: 'POST',
        query: { action: 'complete-uploads' },
        headers: {
          authorization: 'Bearer exp_token',
          'x-user-id': 'user_expired_session_owner',
        },
        body: {
          jobId,
          uploadedAssetIds: ['asset_exp_1'],
        },
      },
      mockRes
    );

    expect(resStatus).toBe(410);
    expect(resJson.error).toContain('UPLOAD_SESSION_EXPIRED');
  });

  it('strictly rejects complete-uploads if manifest asset storagePath has been forged', async () => {
    const jobId = 'job_forged_path_77';
    controlPlaneJobs.set(jobId, {
      id: jobId,
      propertyId: 'prop_forged_path_test',
      ownerId: 'user_forged_owner',
      type: 'photos',
      status: 'UPLOADING',
      attemptId: 'attempt_1',
      manifest: [
        {
          id: 'asset_forged_1',
          // Malicious forged prefix targeting published tour pointer rather than raw upload path
          storagePath: `properties/prop_forged_path_test/tour/scene.spz`,
          uploadUrl: 'https://storage.googleapis.com/...',
          sizeBytes: 1000000,
          mimeType: 'image/jpeg',
          validationStatus: 'PENDING',
        },
      ],
      createdAt: new Date().toISOString(),
      retryCount: 0,
      stateVersion: 1,
    });

    let resStatus = 0;
    let resJson: any = null;
    const mockRes = {
      status: (s: number) => {
        resStatus = s;
        return { json: (d: any) => { resJson = d; return d; } };
      },
    };

    await handler(
      {
        method: 'POST',
        query: { action: 'complete-uploads' },
        headers: {
          authorization: 'Bearer forged_token',
          'x-user-id': 'user_forged_owner',
        },
        body: {
          jobId,
          uploadedAssetIds: ['asset_forged_1'],
        },
      },
      mockRes
    );

    expect(resStatus).toBe(400);
    expect(resJson.error).toContain('UPLOAD_VERIFICATION_FAILED');
    expect(resJson.error).toContain('storagePath does not match expected prefix');
  });
});
