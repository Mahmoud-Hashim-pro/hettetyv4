# HETTETY v4 — ENVIRONMENT VARIABLES SPECIFICATION (Phase 0)

## 1. Control Plane & Backend (`api/`)

| Variable | Required | Default / Fallback | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | `development` | Setting `production` enables strict credential enforcement |
| `WORKER_SHARED_SECRET` | In Prod | `hettety-worker-secret-internal` | Shared symmetric key for worker callback authorization |
| `REDIS_URL` | Yes | `redis://localhost:6379/0` | Connection string for Redis Streams job queue |
| `GCP_PROJECT_ID` | In Prod | `hettety-prod` | Google Cloud project hosting Firestore & Cloud Storage |
| `FIREBASE_STORAGE_BUCKET`| In Prod | `hettety-spatial-assets` | Target bucket for signed upload URLs and published assets |
| `GEMINI_API_KEY` | Optional | - | Powers AI Real Estate Advisor multimodal reasoning |

---

## 2. GPU Reconstruction Worker (`hettety-3d-worker/`)

| Variable | Required | Default / Fallback | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | `production` | Production mode enforces strict secrets |
| `HETTETY_ENV` | No | `production` | Rejects `test` when `NODE_ENV=production` |
| `HETTETY_WORKER_ID` | Yes | `hettety-gpu-worker-1` | Unique instance ID for lease management and heartbeat |
| `HETTETY_CONTROL_PLANE_URL` | In Prod | `mock://callback` | Control Plane callback endpoint for progress & publication |
| `WORKER_SHARED_SECRET` | In Prod | `hettety-worker-secret-internal` | Bearer token sent with all worker callbacks |
| `REDIS_URL` | Yes | `redis://localhost:6379/0` | Queue consumer connection string |
| `STORAGE_PROVIDER` | No | `gcs` (`local` for tests) | Cloud storage adapter (`gcs`, `s3`, `local`) |
| `HETTETY_STORAGE_DIR` | In Local | `./storage/spatial_assets` | Local filesystem root when `STORAGE_PROVIDER=local` |
| `COLMAP_FORCE_CPU` | No | `false` | Forces CPU feature matching (development/testing without CUDA) |
| `GAUSSIAN_SPLATTING_PATH` | Yes | `/opt/gaussian-splatting` | Root path to compiled Graphdeco 3DGS submodules |
