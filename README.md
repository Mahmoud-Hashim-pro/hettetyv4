# HETTETY (حتتي) — Intelligent Spatial Real Estate Platform & 3D Gaussian Splatting Engine

A high-performance luxury real estate marketplace and spatial property platform engineered for the MENA region. Features end-to-end photogrammetric 3D tour reconstruction, verified 1:1 metric spatial floorplans, AI-assisted advisory, Arabic (RTL) localization, and an enterprise Firebase Admin control plane.

---

## 🌟 Architectural Overview

```
                                  [ Client / Mobile Tour App ]
                                                │
                                    (1) Bearer Token Auth
                                                ▼
                         [ Next.js / Vercel API Control Plane ]
                         (api/reconstruction.ts — Firebase Admin)
                                  │                     │
                     (2) Fail-Closed                    │ (3) Durable XADD
                     Firestore Batch                    │     Stream Job
                                  ▼                     ▼
                       [ Firestore Control Plane ]  [ Redis Streams ]
                       • properties                 • stream: hettety_3d_jobs
                       • reconstruction_jobs        • group:  hettety_workers
                         └── attempts/{attemptId}   • lease:  hettety:lease:{jobId}
                       • three_d_assets             • cancel: hettety:job:{id}:cancel
                         └── versions/{versionId}
                                                        │
                                                        ▼
                                       [ HETTETY 3D GPU Worker Node ]
                                  (workers/reconstruction_worker.py)
                                  ┌─────────────────────────────────────┐
                                  │ 1. Keyframe Sharpness Validation    │
                                  │ 2. COLMAP Structure-from-Motion     │
                                  │ 3. Multi-View Dense Stereo Fusion   │
                                  │ 4. Iterative 3DGS Loss Optimization │
                                  │ 5. Floater Pruning & Spatial Bounds │
                                  │ 6. 1:1 Metric Scale Calibration     │
                                  │ 7. Dual Asset Compression (SPZ/GLB) │
                                  └─────────────────────────────────────┘
                                                        │
                                                        ▼
                                       [ Google Cloud Storage / CDN ]
                                       • /properties/{id}/3d/dist/scene.spz
                                       • /properties/{id}/3d/dist/mesh.glb
                                       • /properties/{id}/3d/dist/manifest.json
```

---

## 🔄 Authoritative 3D Reconstruction State Machine

Every spatial reconstruction job strictly progresses through the following sequential states:

```
  [ UPLOADING ]
        │  Keyframes uploaded via GCS V4 presigned URLs & validated
        ▼
   [ QUEUED ]
        │  Enqueued into Redis Streams with consumer group lease tracking
        ▼
  [ VALIDATING ]
        │  Laplacian variance sharpness check & dataset integrity
        ▼
 [ RECONSTRUCTING ]
        │  COLMAP feature extraction, sequential/exhaustive matcher & bundle adjustment
        ▼
   [ TRAINING ]
        │  Dense stereo fusion + Iterative 3D Gaussian Splatting optimization
        ▼
  [ OPTIMIZING ]
        │  Floater pruning, bounding box computation & 1:1 metric calibration
        ▼
  [ PUBLISHING ]
        │  Dual-format compression (SPZ + GLB) & streaming SHA-256 upload
        ▼
    [ READY ] (Atomic publication to three_d_assets and immutable versions)
```

### Terminal Failure States
- **`FAILED`**: Explicit error code emitted (e.g. `INSUFFICIENT_REGISTERED_CAMERAS`, `HIGH_REPROJECTION_ERROR`, `DENSE_RECONSTRUCTION_FAILED`, `ZERO_GAUSSIANS_PRODUCED`, `REDIS_ENQUEUE_FAILED`).
- **`CANCELLED`**: Triggered via control plane API; child processes killed instantly via OS process trees and PyTorch CUDA cache cleared.

---

## 🛡️ Enterprise Hardening & Security Features

### 1. Firebase Admin Control Plane & Fail-Closed Persistence
- Direct server-side Firebase Admin SDK integration; zero browser SDK credentials in the control plane.
- **Fail-Closed Guarantee**: Missing properties return `404`, unauthorized users return `403`, and Firestore transport failures return `503` without advancing in-memory cache.
- **Atomic Batched Publishing**: `READY` transition atomically writes `reconstruction_jobs`, `attempts/{attemptId}`, `three_d_assets/{propertyId}`, and immutable `three_d_assets/{propertyId}/versions/{versionId}` in a single Firestore transaction batch.

### 2. Redis Streams Lease Management & Heartbeat Gap Elimination
- Durable queue polling utilizing `XREADGROUP` and `XAUTOCLAIM`.
- While long-running 3DGS tasks execute (up to 30 minutes), workers maintain an active lease via `heartbeat(jobId)`:
  - Extends Redis key `hettety:lease:{jobId}` TTL.
  - Touches the Stream message in the Pending Entries List (PEL) via `XCLAIM` (`min-idle-time 0, justid=True`), resetting idle time and preventing concurrent worker stealing.

### 3. Managed Subprocess Lifecycle & Process-Tree Cancellation
- Centralized execution in `pipeline/process_manager.py`:
  - Cross-platform process tree termination (`taskkill /F /T /PID` on Windows, process group `SIGKILL` on POSIX).
  - Background processes (Docker, COLMAP, PyTorch CUDA scripts) are actively tracked in a thread-safe registry.
  - Periodic cancellation checking raises `JobCancelledException` and immediately terminates child processes, preventing zombie GPU execution.
  - Releases GPU memory via `torch.cuda.empty_cache()`.

### 4. GPU Acceleration & Docker Passthrough
- Dynamic GPU detection via `is_gpu_acceleration_available()` (checks `COLMAP_FORCE_GPU`, `torch.cuda.is_available()`, and `nvidia-smi`).
- Automatically passes `--gpus all` and preserves `--SiftExtraction.use_gpu 1` in Docker when NVIDIA GPUs are present; gracefully falls back to CPU when running on non-GPU host environments.

### 5. Mathematical 3D Gaussian Splatting Optimization (`IterativeGaussianOptimizer`)
- Genuine mathematical optimization engine without hardcoded constants or synthetic proxy outputs:
  - **KDTree Spatial Scales**: Anisotropic covariance scale vectors $\mathbf{s}_i$ initialized from $k=3$ spatial nearest neighbors.
  - **PCA Surface Tangents**: Unit quaternions $\mathbf{q}_i = (w, x, y, z)$ derived from local point cloud covariance eigenvectors.
  - **Gradient Descent Convergence**: Iteratively minimizes scale smoothness, volume regularization, and opacity entropy, logging verified loss reduction telemetry.

### 6. SSRF & DNS Rebinding Defenses
- Strict fail-closed DNS resolution: reject unresolvable hostnames in production download paths.
- Disabled automatic HTTP redirects (`allow_redirects=False`) on keyframe downloads.
- Hop-by-hop URL re-validation ensuring redirect locations do not point to cloud metadata IP (`169.254.169.254`), private IP ranges, or loopback interfaces.

### 7. Multi-Anchor Ground-Truth Metric Calibration
- Verified 1:1 metric scale calibration using certified independent architectural surveyor benchmarks:
  - Grand Hallway Baseline: `4.20m`
  - Entrance Doorway Opening: `0.90m`
  - Window Bay Width: `1.80m`
- Rigorous quantitative gates: requires confidence score $\ge 0.90$ and independent error margin $\le 5.0\%$.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Python 3.10+ (with `numpy`, `scipy`, `Pillow`, `requests`, and `redis`)
- Docker (optional, for containerized COLMAP: `docker pull hettety-colmap:latest`)
- Redis 6.2+ (supporting Redis Streams)

### Installation

```bash
# 1. Clone repository
git clone https://github.com/Mahmoud-Hashim-pro/hettetyv4.git
cd hettetyv4

# 2. Install Web dependencies
npm install

# 3. Install Python 3D Worker dependencies
cd hettety-3d-worker
pip install -r requirements.txt
cd ..
```

### Environment Configuration (`.env`)

```ini
# Control Plane
NODE_ENV=production
FIREBASE_PROJECT_ID=hettety-prod
FIRESTORE_DATABASE_ID=(default)
WORKER_SHARED_SECRET=your-secure-internal-worker-secret

# Redis Stream Queue
REDIS_URL=redis://localhost:6379/0
REDIS_QUEUE=hettety_3d_jobs

# Cloud Object Storage
STORAGE_PROVIDER=gcs
GCS_BUCKET_NAME=hettety-spatial-assets
CDN_BASE_URL=https://storage.googleapis.com/hettety-spatial-assets

# Worker Node
HETTETY_WORKER_ID=hettety-gpu-worker-node-1
WORK_DIR=/tmp/hettety_3d
```

### Running Tests

```bash
# 1. TypeScript Control Plane Tests (Vitest)
npm test

# 2. Python E2E Reconstruction Test Suite
cd hettety-3d-worker
python -m unittest tests/test_e2e_reconstruction.py

# 3. Authoritative Phase 1 Real Property E2E Test
python -m unittest tests/test_phase1_real_e2e.py
```

### Running the 3D Worker Daemon

```bash
python hettety-3d-worker/workers/reconstruction_worker.py \
  --redis-url redis://localhost:6379/0 \
  --queue hettety_3d_jobs \
  --work-dir /tmp/hettety_3d
```

---

## 📄 License

Proprietary — All rights reserved © 2026 Hettety Technologies Inc.
