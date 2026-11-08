# HETTETY v4 — SYSTEM ARCHITECTURE SPECIFICATION (Phase 0)

```mermaid
flowchart TD
    subgraph Client ["Client Browser / Mobile PWA"]
        UI["React 19 + Tailwind CSS"]
        Viewer["Property3DViewer"]
        SortWorker["SplatSort WebWorker (16-bit Counting Sort)"]
        WasmSPZ["@adobe/spz WebAssembly Decoder"]
        Viewer --> SortWorker
        Viewer --> WasmSPZ
    end

    subgraph ControlPlane ["Vercel Edge / Serverless Control Plane"]
        API_Rec["/api/reconstruction (Job Orchestrator)"]
        API_Upload["/api/upload (Signed URL Minter)"]
        API_Tx["/api/transactions (Escrow & Settlement)"]
        API_AI["/api/ai (Real Estate Advisor)"]
    end

    subgraph QueueStorage ["Queue & Persistence Layer"]
        RedisStream[("Redis Streams: hettety:3d:reconstruction_jobs")]
        Firestore[("Google Cloud Firestore (Authoritative Data)")]
        GCS[("Cloud Storage (GCS: hettety-spatial-assets)")]
    end

    subgraph GPUWorker ["HETTETY 3D GPU Worker (Docker / CUDA 12.1)"]
        Consumer["QueueConsumer (Heartbeat & Lease Daemon)"]
        Val["Stage 1: Laplacian Keyframe Validation & Video Extractor"]
        COLMAP["Stage 2 & 3: COLMAP SfM & Dense Multi-View Stereo"]
        Trainer["Stage 4: 3D Gaussian Splatting Training (30,000 iters)"]
        Optimizer["Stage 5: Floater Pruning & Spatial Bounds"]
        Calibrator["Stage 6: Laser Survey Benchmark Calibration"]
        Compressor["Stage 7: Niantic SPZ v4 & glTF 2.0 GLB Generation"]
        Publisher["Stage 8: Isolated Attempt Upload & Checksum Verification"]
        Consumer --> Val --> COLMAP --> Trainer --> Optimizer --> Calibrator --> Compressor --> Publisher
    end

    UI --> API_Upload
    API_Upload --> GCS
    UI --> API_Rec
    API_Rec --> RedisStream
    API_Rec --> Firestore
    RedisStream --> Consumer
    Publisher --> API_Rec
    Publisher --> GCS
    GCS --> Viewer
```

## Architectural Component Breakdown

### 1. Frontend Web Client
- **Framework**: React 19, Vite 6, TypeScript 5.8.
- **3D Engine**: Three.js, `@react-three/fiber`, `@react-three/drei`.
- **Custom Shaders**: Gaussian splat point cloud vertex and fragment shaders with view-space covariance projection.
- **Asynchronous Worker**: `splat-sort.worker.ts` computes $O(N)$ draw order on background threads using ArrayBuffer transfer semantics.

### 2. Control Plane API
- **Endpoint**: `/api/reconstruction`.
- **Security**: Strict Bearer token authentication via `WORKER_SHARED_SECRET` in production.
- **Idempotency**: Redis `SET NX` key reservation paired with Redis Stream `XADD` for deduplicated queuing.
- **Transactions**: Atomic promotion of completed attempts in Firestore transactions, preventing split-brain or stale worker overwrites.

### 3. GPU Worker Reconstruction Engine
- **Base Image**: `nvidia/cuda:12.1.1-devel-ubuntu22.04`.
- **Tooling**:
  - COLMAP (CPU/GPU acceleration).
  - Graphdeco 3D Gaussian Splatting pinned at commit `2eee0e2`.
  - Niantic SPZ CLI compiler (version 4 NGSP).
  - OpenCV & Pillow for image validation and video frame extraction.

### 4. Storage Architecture
- **Raw Uploads**: `properties/{propertyId}/uploads/{jobId}/frame_{i}.jpg`
- **Attempt Artifacts (Immutable)**: `properties/{propertyId}/3d/{jobId}/{attemptId}/scene.spz`, `mesh.glb`, `manifest.json`.
- **Public Tour Pointer**: `properties/{propertyId}/tour/scene.spz` (Promoted strictly by the Control Plane after all quality gates pass).
