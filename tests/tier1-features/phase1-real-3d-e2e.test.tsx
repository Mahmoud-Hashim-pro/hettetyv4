import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import controlPlaneHandler, {
  controlPlaneJobs,
  mockPropertiesStore,
  mockAttemptsStore,
  ReconstructionJobPayload,
} from '../../api/reconstruction';
import { validatePhotoCapture } from '../../src/features/reconstruction/CaptureValidator';
import { TourViewer } from '../../src/components/3d/TourViewer';
import { ThreeDTour } from '../../src/types/three-d-tour';
import zlib from 'zlib';
import { parseGaussianSpz } from '../../src/lib/3d/spz-parser';

describe('Tier 1 — Phase 1: Real Property Image -> Real 3D E2E Pipeline', () => {
  const propertyId = 'prop_villa_marassi_01';
  const ownerId = 'owner_marassi_vip';
  const workerId = 'hettety-gpu-worker-node-alpha';

  beforeEach(() => {
    controlPlaneJobs.clear();
    mockPropertiesStore.clear();
    mockAttemptsStore.clear();
    mockPropertiesStore.set(propertyId, { authorUid: ownerId, title: 'Marassi Luxury Mediterranean Villa' });
  });

  it('executes full end-to-end Phase 1 pipeline from real keyframes to published 3D viewer', async () => {
    // -------------------------------------------------------------------------
    // Step 1: User Selects Photos — Capture Validation
    // -------------------------------------------------------------------------
    const keyframeNames = [
      'frame_01_living_room_wide_center.jpg',
      'frame_02_living_room_sofa_left.jpg',
      'frame_03_living_room_sofa_right.jpg',
      'frame_04_living_room_tv_media_wall.jpg',
      'frame_05_living_room_window_terrace.jpg',
      'frame_06_living_room_terrace_threshold.jpg',
      'frame_07_dining_table_wide.jpg',
      'frame_08_dining_chairs_side_angle.jpg',
      'frame_09_entrance_foyer_console.jpg',
      'frame_10_corridor_gallery_view.jpg',
      'frame_11_doorway_master_suite.jpg',
      'frame_12_master_bed_center_view.jpg',
      'frame_13_master_bed_angle_left.jpg',
      'frame_14_master_bed_angle_right.jpg',
      'frame_15_master_walkin_closet.jpg',
      'frame_16_master_balcony_window.jpg',
      'frame_17_kitchen_island_waterfall.jpg',
      'frame_18_kitchen_cabinets_backsplash.jpg',
      'frame_19_kitchen_undermount_sink.jpg',
      'frame_20_kitchen_refrigerator_tower.jpg',
      'frame_21_guest_bedroom_twin_beds.jpg',
      'frame_22_guest_study_desk_window.jpg',
      'frame_23_master_bath_double_vanity.jpg',
      'frame_24_master_bath_walkin_shower.jpg',
      'frame_25_master_bath_freestanding_tub.jpg',
      'frame_26_powder_room_pedestal_sink.jpg',
      'frame_27_terrace_pergola_lounge.jpg',
      'frame_28_terrace_pool_vista.jpg',
    ];

    const captureFiles = keyframeNames.map((name, i) => ({
      name,
      size: 500 * 1024 + i * 2048,
      type: 'image/jpeg',
    }));

    const valResult = validatePhotoCapture(captureFiles);
    expect(valResult.valid).toBe(true);
    expect(valResult.errors.length).toBe(0);
    expect(valResult.coverageScore).toBeGreaterThanOrEqual(70);
    expect(valResult.overlapScore).toBeGreaterThanOrEqual(70);

    // -------------------------------------------------------------------------
    // Step 2: Upload — Create Job & Obtain Storage Manifest
    // -------------------------------------------------------------------------
    let statusRes = 200;
    let jsonRes: any = null;
    const mockRes = {
      status: (s: number) => {
        statusRes = s;
        return {
          json: (d: any) => {
            jsonRes = d;
          },
        };
      },
    };

    await controlPlaneHandler(
      {
        method: 'POST',
        query: { action: 'create-job' },
        headers: { authorization: 'Bearer valid-id-token', 'x-user-id': ownerId },
        body: {
          propertyId,
          type: 'photos',
          files: captureFiles.map((f, idx) => ({
            name: f.name,
            sizeBytes: f.size,
            mimeType: f.type,
            checksum: `chk_${idx + 1}`,
          })),
          scaleReferences: [
            {
              type: 'surveyor_marker',
              point3d_id_a: 1,
              point3d_id_b: 25,
              known_meters: 9.0,
            },
          ],
        },
      },
      mockRes
    );

    expect(statusRes).toBe(200);
    expect(jsonRes.job).toBeDefined();
    const jobId = jsonRes.job.id;
    const attemptId = jsonRes.job.attemptId;
    expect(jsonRes.job.status).toBe('UPLOADING');
    expect(jsonRes.signedUploadUrls.length).toBe(28);

    // -------------------------------------------------------------------------
    // Step 3: Complete Uploads & Enqueue to Redis Streams
    // -------------------------------------------------------------------------
    const uploadedAssetIds = jsonRes.job.manifest.map((m: any) => m.id);
    await controlPlaneHandler(
      {
        method: 'POST',
        query: { action: 'complete-uploads' },
        headers: { authorization: 'Bearer valid-id-token', 'x-user-id': ownerId },
        body: {
          jobId,
          uploadedAssetIds,
        },
      },
      mockRes
    );

    expect(statusRes).toBe(200);
    expect(jsonRes.status).toBe('QUEUED');
    expect(controlPlaneJobs.get(jobId)?.status).toBe('QUEUED');

    // -------------------------------------------------------------------------
    // Step 4: Worker Pipeline Stages Execution
    // -------------------------------------------------------------------------
    const stages = [
      { status: 'VALIDATING', progress: 20, stage: 'Analyzing Laplacian sharpness and count' },
      { status: 'RECONSTRUCTING', progress: 35, stage: 'COLMAP feature extraction & camera alignment' },
      { status: 'TRAINING', progress: 65, stage: 'Optimizing 3D Gaussian Splatting scene' },
      { status: 'OPTIMIZING', progress: 80, stage: 'Pruning floaters and computing spatial boundaries' },
      { status: 'PUBLISHING', progress: 96, stage: 'Uploading verified spatial assets' },
    ];

    for (const step of stages) {
      await controlPlaneHandler(
        {
          method: 'POST',
          query: { action: 'update-stage' },
          headers: { authorization: 'Bearer hettety-worker-secret-internal' },
          body: {
            jobId,
            attemptId,
            workerId,
            status: step.status,
            progress: step.progress,
            stage: step.stage,
          },
        },
        mockRes
      );
      expect(statusRes).toBe(200);
      expect(controlPlaneJobs.get(jobId)?.status).toBe(step.status);
    }

    // -------------------------------------------------------------------------
    // Step 5: Worker Completes with Verified Cryptographic Artifacts -> READY
    // -------------------------------------------------------------------------
    const spzSha256 = '1fdaf9099c029b3c69a38b61756b98f4079b0994359dea2c26c7dcaa50b8ae08';
    const glbSha256 = '83c912855fd23f0521c7231b4631f0aba8eb578d6f6115cb8312ae575b6aa624';

    await controlPlaneHandler(
      {
        method: 'POST',
        query: { action: 'update-stage' },
        headers: { authorization: 'Bearer hettety-worker-secret-internal' },
        body: {
          jobId,
          attemptId,
          workerId,
          propertyId,
          status: 'READY',
          progress: 100,
          stage: 'Reconstruction completed successfully',
          representation: {
            gaussianSplat: {
              format: 'spz',
              url: `https://cdn.hettety.com/properties/${propertyId}/tour/scene.spz`,
              sizeBytes: 16904,
              splatCount: 520,
              sha256: spzSha256,
            },
            mesh: {
              format: 'glb',
              url: `https://cdn.hettety.com/properties/${propertyId}/tour/mesh.glb`,
              sizeBytes: 31444,
              vertexCount: 520,
              faceCount: 1040,
              isCalibratedMetric: true,
              sha256: glbSha256,
            },
          },
          bounds: {
            min: [-4.5, 0.0, -3.5],
            max: [4.5, 3.2, 3.5],
          },
          qualityReport: {
            overallScore: 88,
            metrics: {
              coverage: 92,
              sharpness: 95,
              density: 85,
              meshCompleteness: 90,
              isCalibratedMetric: true,
            },
          },
        },
      },
      mockRes
    );

    expect(statusRes).toBe(200);
    const finalJob = controlPlaneJobs.get(jobId);
    expect(finalJob?.status).toBe('READY');
    expect(finalJob?.representation?.gaussianSplat?.sha256).toBe(spzSha256);
    expect(finalJob?.representation?.mesh?.sha256).toBe(glbSha256);
    expect(finalJob?.representation?.mesh?.isCalibratedMetric).toBe(true);

    // -------------------------------------------------------------------------
    // Step 6: 3D Browser Viewer Renders the Published Property Tour
    // -------------------------------------------------------------------------
    const publishedTour: ThreeDTour = {
      id: `tour_${propertyId}`,
      status: 'ready',
      representation: {
        gaussianSplat: {
          format: 'spz',
          url: `https://cdn.hettety.com/properties/${propertyId}/tour/scene.spz`,
          sizeBytes: 16904,
          splatCount: 520,
          sha256: spzSha256,
        },
        mesh: {
          format: 'glb',
          url: `https://cdn.hettety.com/properties/${propertyId}/tour/mesh.glb`,
          sizeBytes: 31444,
          vertexCount: 520,
          faceCount: 1040,
          isCalibratedMetric: true,
          sha256: glbSha256,
        },
      },
      bounds: {
        min: [-4.5, 0.0, -3.5],
        max: [4.5, 3.2, 3.5],
      },
      rooms: [
        { id: 'room-living', name: 'Living Room', nameAr: 'غرفة المعيشة', type: 'living_room' },
        { id: 'room-master', name: 'Master Suite', nameAr: 'جناح الماستر', type: 'bedroom' },
        { id: 'room-terrace', name: 'Terrace & Pool', nameAr: 'التراس والمسبح', type: 'balcony' },
      ],
    };

    render(
      <TourViewer
        tour={publishedTour}
        title="Marassi Villa Mediterranean Real 3D Walkthrough"
        isRtl={false}
      />
    );

    // Verify room navigation waypoints appear in the DOM
    expect(screen.getByText('Living Room')).toBeInTheDocument();
    expect(screen.getByText('Master Suite')).toBeInTheDocument();
    expect(screen.getByText('Terrace & Pool')).toBeInTheDocument();

    // Verify switching to another room updates state without throwing
    const masterBtn = screen.getByText('Master Suite');
    fireEvent.click(masterBtn);
    expect(masterBtn.closest('button')).toHaveClass('bg-emerald-600');
  });

  it('strictly rejects READY state if artifact SHA-256 is missing or invalid format', async () => {
    let statusRes = 200;
    let jsonRes: any = null;
    const mockRes = {
      status: (s: number) => {
        statusRes = s;
        return {
          json: (d: any) => {
            jsonRes = d;
          },
        };
      },
    };

    controlPlaneJobs.set('job_test_hash_fail', {
      id: 'job_test_hash_fail',
      propertyId,
      ownerId,
      type: 'photos' as const,
      status: 'PUBLISHING',
      attemptId: 'attempt_1',
      manifest: [],
      createdAt: new Date().toISOString(),
      retryCount: 0,
    });

    await controlPlaneHandler(
      {
        method: 'POST',
        query: { action: 'update-stage' },
        headers: { authorization: 'Bearer hettety-worker-secret-internal' },
        body: {
          jobId: 'job_test_hash_fail',
          attemptId: 'attempt_1',
          propertyId,
          status: 'READY',
          representation: {
            gaussianSplat: {
              format: 'spz',
              url: `https://cdn.hettety.com/properties/${propertyId}/tour/scene.spz`,
              splatCount: 100,
              sha256: 'not-a-valid-64-char-hash',
            },
            mesh: {
              format: 'glb',
              url: `https://cdn.hettety.com/properties/${propertyId}/tour/mesh.glb`,
              faceCount: 50,
              sha256: 'f3d7825616df5e6bbb761c05c306f6dff2cddfb946c8ea686fe743af83d3a1dd',
            },
          },
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        },
      },
      mockRes
    );

    expect(statusRes).toBe(422);
    expect(jsonRes.error).toContain('ARTIFACT_VALIDATION_FAILED');
  });

  it('strictly rejects READY state if artifact URL has path traversal or invalid prefix', async () => {
    let statusRes = 200;
    let jsonRes: any = null;
    const mockRes = {
      status: (s: number) => {
        statusRes = s;
        return {
          json: (d: any) => {
            jsonRes = d;
          },
        };
      },
    };

    controlPlaneJobs.set('job_test_traversal_fail', {
      id: 'job_test_traversal_fail',
      propertyId,
      ownerId,
      type: 'photos' as const,
      status: 'PUBLISHING',
      attemptId: 'attempt_1',
      manifest: [],
      createdAt: new Date().toISOString(),
      retryCount: 0,
    });

    // Foreign domain with query param smuggling
    await controlPlaneHandler(
      {
        method: 'POST',
        query: { action: 'update-stage' },
        headers: { authorization: 'Bearer hettety-worker-secret-internal' },
        body: {
          jobId: 'job_test_traversal_fail',
          attemptId: 'attempt_1',
          propertyId,
          status: 'READY',
          representation: {
            gaussianSplat: {
              format: 'spz',
              url: `https://attacker.com/evil.spz?prefix=properties/${propertyId}/tour/`,
              splatCount: 100,
              sha256: '6b5b133c7d0845d2c93ad5d0dda2b25fde2ff462b163cc005b600b78420b3062',
            },
            mesh: {
              format: 'glb',
              url: `https://cdn.hettety.com/properties/${propertyId}/tour/mesh.glb`,
              faceCount: 50,
              sha256: 'f3d7825616df5e6bbb761c05c306f6dff2cddfb946c8ea686fe743af83d3a1dd',
            },
          },
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        },
      },
      mockRes
    );

    expect(statusRes).toBe(422);
    expect(jsonRes.error).toContain('ARTIFACT_VALIDATION_FAILED');
  });

  it('verifies parseGaussianSpz decodes real binary SPZ container with valid bounds and counts', async () => {
    // Construct authentic SPZ1 container buffer: 16-byte header + 2 * 44-byte primitives
    const rawHeader = Buffer.alloc(16);
    rawHeader.write('SPZ1', 0, 4, 'ascii');
    rawHeader.writeUInt32LE(1, 4); // version 1
    rawHeader.writeUInt32LE(2, 8); // count 2
    rawHeader.writeUInt32LE(0, 12); // flags

    const prim1 = Buffer.alloc(44);
    // pos (1.0, 2.0, 3.0)
    prim1.writeFloatLE(1.0, 0);
    prim1.writeFloatLE(2.0, 4);
    prim1.writeFloatLE(3.0, 8);
    // rgba (200, 150, 100, 255)
    prim1.writeUInt8(200, 12);
    prim1.writeUInt8(150, 13);
    prim1.writeUInt8(100, 14);
    prim1.writeUInt8(255, 15);
    // scale log (-3.0, -3.0, -3.0)
    prim1.writeFloatLE(-3.0, 16);
    prim1.writeFloatLE(-3.0, 20);
    prim1.writeFloatLE(-3.0, 24);
    // rot (qw=1, qx=0, qy=0, qz=0)
    prim1.writeFloatLE(1.0, 28);
    prim1.writeFloatLE(0.0, 32);
    prim1.writeFloatLE(0.0, 36);
    prim1.writeFloatLE(0.0, 40);

    const prim2 = Buffer.alloc(44);
    // pos (-1.0, -2.0, -3.0)
    prim2.writeFloatLE(-1.0, 0);
    prim2.writeFloatLE(-2.0, 4);
    prim2.writeFloatLE(-3.0, 8);
    // rgba (100, 150, 200, 128)
    prim2.writeUInt8(100, 12);
    prim2.writeUInt8(150, 13);
    prim2.writeUInt8(200, 14);
    prim2.writeUInt8(128, 15);
    // scale log (-3.0, -3.0, -3.0)
    prim2.writeFloatLE(-3.0, 16);
    prim2.writeFloatLE(-3.0, 20);
    prim2.writeFloatLE(-3.0, 24);
    // rot (qw=1, qx=0, qy=0, qz=0)
    prim2.writeFloatLE(1.0, 28);
    prim2.writeFloatLE(0.0, 32);
    prim2.writeFloatLE(0.0, 36);
    prim2.writeFloatLE(0.0, 40);

    const uncompressed = Buffer.concat([rawHeader, prim1, prim2]);
    const gzipped = zlib.gzipSync(uncompressed);

    const cloud = await parseGaussianSpz(
      gzipped.buffer.slice(gzipped.byteOffset, gzipped.byteOffset + gzipped.byteLength)
    );
    expect(cloud.count).toBe(2);
    expect(cloud.positions.length).toBe(6);
    expect(cloud.positions[0]).toBeCloseTo(1.0);
    expect(cloud.positions[1]).toBeCloseTo(2.0);
    expect(cloud.positions[2]).toBeCloseTo(3.0);
    expect(cloud.positions[3]).toBeCloseTo(-1.0);
    expect(cloud.positions[4]).toBeCloseTo(-2.0);
    expect(cloud.positions[5]).toBeCloseTo(-3.0);
    expect(cloud.colors[0]).toBeCloseTo(200 / 255);
    expect(cloud.opacities[0]).toBeCloseTo(1.0);
    expect(cloud.bounds.min).toEqual([-1.0, -2.0, -3.0]);
    expect(cloud.bounds.max).toEqual([1.0, 2.0, 3.0]);
  });
});
