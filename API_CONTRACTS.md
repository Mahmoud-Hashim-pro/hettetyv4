# HETTETY v4 — API CONTRACTS SPECIFICATION (Phase 0)

All APIs run under `/api/` and enforce strict authorization and schema validation.

---

## 1. Reconstruction Orchestration API (`/api/reconstruction`)

### `POST /api/reconstruction?action=create-job`
Creates a durable reconstruction job for an owned property.

- **Headers**:
  - `Authorization: Bearer <user_token>`
  - `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "propertyId": "prop_12345",
    "idempotencyKey": "idem_prop_12345_1731000000",
    "type": "photos", // "photos" | "video"
    "captureManifest": [
      {
        "storagePath": "properties/prop_12345/uploads/job_abc/frame_0000.jpg",
        "sizeBytes": 2048500,
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      }
    ],
    "referenceAnchors": [
      {
        "id": "main_door_width",
        "physicalMeters": 0.95,
        "toleranceMeters": 0.02
      }
    ]
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "job": {
      "id": "job_abc",
      "propertyId": "prop_12345",
      "status": "QUEUED",
      "progress": 0,
      "stage": "QUEUED",
      "createdAt": "2026-11-08T18:00:00.000Z"
    }
  }
  ```

---

### `POST /api/reconstruction?action=worker-callback`
Worker reports live progress or delivers completed attempt artifacts.

- **Headers**:
  - `Authorization: Bearer <WORKER_SHARED_SECRET>`
- **Request Body (Progress)**:
  ```json
  {
    "jobId": "job_abc",
    "attemptId": "attempt_1",
    "workerId": "hettety-gpu-worker-1",
    "propertyId": "prop_12345",
    "status": "TRAINING",
    "progress": 65,
    "stage": "Optimizing 3D Gaussian Splatting scene"
  }
  ```
- **Request Body (Publication & Quality Handover)**:
  ```json
  {
    "jobId": "job_abc",
    "attemptId": "attempt_1",
    "workerId": "hettety-gpu-worker-1",
    "propertyId": "prop_12345",
    "status": "READY",
    "representation": {
      "gaussianSplat": {
        "format": "spz",
        "url": "properties/prop_12345/3d/job_abc/attempt_1/scene.spz",
        "splatCount": 1420500,
        "sizeBytes": 8412000,
        "sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"
      },
      "mesh": {
        "format": "glb",
        "url": "properties/prop_12345/3d/job_abc/attempt_1/mesh.glb",
        "faceCount": 182400,
        "sizeBytes": 11250000,
        "sha256": "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d",
        "isCalibratedMetric": true
      }
    },
    "bounds": {
      "min": [-4.5, -0.2, -5.1],
      "max": [4.8, 3.2, 5.3]
    },
    "qualityReport": {
      "passed": true,
      "sharpnessScore": 82,
      "registeredCameras": 48,
      "confidenceScore": 0.94,
      "rmseMeters": 0.024
    }
  }
  ```
- **Response**: `200 OK` on promotion, `409 Conflict` on stale attempt (`STALE_ATTEMPT_IGNORED`), or `401 Unauthorized` on credential failure.

---

## 2. Upload Session API (`/api/upload`)

### `POST /api/upload?action=create-upload-session`
Authorizes upload destinations for property media.

- **Headers**:
  - `Authorization: Bearer <user_token>`
- **Request Body**:
  ```json
  {
    "propertyId": "prop_12345",
    "jobId": "job_abc",
    "files": [
      { "name": "frame_0000.jpg", "sizeBytes": 2048500, "mimeType": "image/jpeg" }
    ]
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "jobId": "job_abc",
    "destinations": [
      {
        "name": "frame_0000.jpg",
        "storagePath": "properties/prop_12345/uploads/job_abc/frame_0000.jpg",
        "uploadUrl": "https://storage.googleapis.com/hettety-spatial-assets/properties/prop_12345/uploads/job_abc/frame_0000.jpg?GoogleAccessId=...",
        "expiresAt": "2026-11-08T18:30:00.000Z"
      }
    ]
  }
  ```
