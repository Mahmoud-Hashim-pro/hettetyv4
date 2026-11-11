# HETTETY (حتتي) — Intelligent Spatial Real Estate Platform & 3D Gaussian Splatting Engine

> 🌐 **Production Website**: [https://hettety.vercel.app/](https://hettety.vercel.app/)  
> 🏢 **Platform Overview**: Egyptian Real Estate & Financial Platform with 3D Virtual Tours, Matterport Walkthroughs & AI Property Advisor.

A high-performance luxury real estate marketplace and spatial property platform engineered for the MENA region. Features end-to-end photogrammetric 3D tour reconstruction, a metric calibration pipeline with survey-reference support, AI-assisted advisory, Arabic (RTL) localization, and an enterprise Firebase Admin control plane.

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
                                  │ 4. Official Graphdeco 3DGS Training │*
                                  │ 5. Floater Pruning & Spatial Bounds │
                                  │ 6. 1:1 Metric Scale Calibration     │
                                  │ 7. Dual Asset Compression (SPZ/GLB) │
                                  └─────────────────────────────────────┘
                                  * Production uses official Graphdeco 3DGS;
                                    IterativeGaussianOptimizer is dev/test fallback.
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
        │  Dense stereo fusion + Official Graphdeco 3DGS training
        │  (IterativeGaussianOptimizer serves as dev/test fallback)
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

### 5. Dual 3D Gaussian Splatting Engines: Official Graphdeco vs Development Fallback
Hettety incorporates two distinct 3DGS optimization engines engineered for different operational environments:
- **Authoritative Production Path (`run_gaussian_training`)**:
  - Executes the official Inria Graphdeco 3DGS training runner (`gaussian-splatting/train.py`) utilizing compiled CUDA submodules (`diff_gaussian_rasterization` and `simple_knn`) on dedicated NVIDIA hardware ($\ge 12\text{ GB}$ VRAM).
  - Enforces authoritative Git supply chain security: strictly verifies the enclosing Git repository, canonical remote URL (`https://github.com/graphdeco-inria/gaussian-splatting`), pinned release commit SHA (e.g. `2130164`), tracked source status, and a 100% clean working tree.
  - Telemetry is authoritatively parsed from stdout/stderr execution logs and checkpoint PLY files to verify full convergence through 30,000 iterations.
- **Development & CI Fallback (`IterativeGaussianOptimizer`)**:
  - Pure Python/PyTorch/SciPy spatial optimization engine designed exclusively for unit testing, non-CUDA CI environments, and local development where physical NVIDIA GPUs are unavailable.
  - Computes KDTree anisotropic spatial scales ($\mathbf{s}_i$), PCA surface tangent quaternions ($\mathbf{q}_i$), and iterative gradient descent loss minimization without invoking external C++/CUDA binaries.
  - **Strict Production Guard**: In strict real-pipeline mode (`HETTETY_REAL_PIPELINE_STRICT=1`), substituting `IterativeGaussianOptimizer` for official Graphdeco training is strictly forbidden and fails closed.

### 6. SSRF & DNS Rebinding Defenses
- Strict fail-closed DNS resolution: reject unresolvable hostnames in production download paths.
- Disabled automatic HTTP redirects (`allow_redirects=False`) on keyframe downloads.
- Hop-by-hop URL re-validation ensuring redirect locations do not point to cloud metadata IP (`169.254.169.254`), private IP ranges, or loopback interfaces.

### 7. Metric Calibration Pipeline with Survey-Reference Support
- Rigid metric scale calibration grounded in verified architectural survey benchmarks (e.g. baseline and opening control dimensions):
  - Grand Salon Baseline: `4.23m`
  - Entrance Vestibule Portal: `0.91m`
  - Terrace Window Bay: `1.82m`
  - Corridor Clear Span: `1.10m`
- Quantitative quality gates: evaluates camera registration, reprojection error ($\le 3.0\text{ px}$), splat distribution, mesh topology, scale confidence score $\ge 0.90$, and benchmark relative error margin $\le 5.0\%$.

### 8. Physical GPU Acceptance Scope
- **Acceptance Gate Scope**: The authoritative hardware acceptance gate (`.github/workflows/gpu-acceptance.yml` and `hettety-3d-worker/tests/acceptance/test_real_gpu_reconstruction.py`) exercises the **complete local photogrammetric and 3DGS pipeline** on a dedicated physical NVIDIA GPU runner (COLMAP SfM feature extraction & matching, multi-view stereo dense point cloud fusion, official Graphdeco 30,000-iteration training, floater pruning, 1:1 metric calibration against survey ground truth, and dual SPZ/GLB asset compression).
- **Separation of Concerns**: Physical GPU acceptance validates that the 3D computer vision and neural reconstruction pipeline achieves verified metric survey accuracy and produces authentic 3DGS deliverables. The distributed web platform components (Next.js client, Vercel API control plane, Firebase Admin, and Redis Streams worker queue) are verified independently through dedicated automated unit, integration, and lifecycle test suites.
- For complete runner provisioning and execution instructions, see [docs/GPU_RUNNER_SETUP.md](docs/GPU_RUNNER_SETUP.md).

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
# Where the worker reports progress, failures and published assets. It sends
# WORKER_SHARED_SECRET as a bearer token here, so this must be the real control
# plane and nothing else. A production worker refuses to start without it.
HETTETY_CONTROL_PLANE_URL=https://hettety.vercel.app/api/reconstruction
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
