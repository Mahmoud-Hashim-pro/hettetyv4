# HETTETY v4 — PRODUCTION GAPS & HARDENING AUDIT (Forensic Update)

> **Audit Status**: ACTIVE HARDENING & REAL RECONSTRUCTION VERIFICATION  
> **Repository**: `Mahmoud-Hashim-pro/hettetyv4`  
> **Last Updated**: November 8, 2026  

---

## 1. Executive Status: The Two-Tier Verification Reality

To eliminate all ambiguity between automated CI unit/fixture testing and live physical production execution, the system is formally decoupled into two distinct operational tiers:

- **Tier 1 (Client Web Application, Control Plane & Format Compression)**:
  - **Status**: **PRODUCTION READY (LIVE ON VERCEL)**
  - Fully implemented and certified: Three.js SPZ binary parser, $O(N)$ radix sorting worker, bilingual Arabic (RTL) / English (LTR) UI/UX, responsive layout containment, fail-closed Firestore security rules, client quality badges, and zero-clipping filter controls.
  - Test suites: **488/488 Vitest tests passing**, zero TypeScript errors, clean Vite production bundle.

- **Tier 2 (Photogrammetry & 3D Gaussian Splatting Reconstruction Pipeline)**:
  - **Status**: **ARCHITECTURE & CODE IMPLEMENTED; REAL GPU EXECUTION BLOCKED ON DEDICATED HOST**
  - All algorithms, coordinate invariance mappings, OpenCV video frame extraction, metric laser holdout calibration, and watertight GLB mesh generation are verified in Python test suites (67/67 tests passing).
  - **Forensic Truth**: The 67/67 Pytest pass rate uses synthetic fixtures (`_generate_test_fixture_sfm`, `_generate_test_fixture_dense`) and mathematical CPU optimization (`IterativeGaussianOptimizer`) when executed on CPU runners.
  - **Real Execution Gate**: Real execution of COLMAP binary (SfM + Dense MVS) and 30,000-iteration official Graphdeco 3DGS on an NVIDIA GPU ($\ge 12$ GB VRAM) is **PENDING DEDICATED CLOUD GPU HOST PROVISIONING**.

---

## 2. Active Production Gaps & Hardware Requirements

| Subsystem / Requirement | Current State | Required Production Action | Blocking? |
| :--- | :--- | :--- | :---: |
| **GPU Worker Node** | CPU dev machine & CPU GitHub Actions runner | Provision dedicated GPU instance (e.g. RunPod / GCP A10G / AWS G5 with NVIDIA RTX 4090 / A10G / H100 with $\ge 12$ GB VRAM, CUDA 11.8+). | **YES (Blocks Phase 6, 7, 17)** |
| **COLMAP Binary on Worker** | Simulated via test fixtures on CPU | Install official COLMAP 3.9+ with CUDA support or pull official `hettety-colmap:latest` Docker image on GPU host. | **YES (Blocks Phase 6)** |
| **Graphdeco 3DGS Runner** | Fallback to `IterativeGaussianOptimizer` on CPU | Clone official `graphdeco-inria/gaussian-splatting` repo and compile CUDA submodules (`diff-gaussian-rasterization` and `simple-knn`). | **YES (Blocks Phase 7)** |
| **Managed Redis Stream with TLS** | Tested with in-memory / local Redis | Provision GCP Cloud Memorystore or Upstash Redis with TLS, connection pooling, and authenticated consumer groups. | **P1 (Blocks Phase 4 live)** |
| **Cloud Storage CORS & Signed URLs** | Verified with local emulator | Configure GCS CORS policy for `*.hettety.com` and `hettety.vercel.app` for direct SPZ / GLB mesh streaming. | **P1 (Blocks live uploads)** |
| **Independent Security Audit** | Static code analysis & unit rules verified | Run independent dynamic penetration testing (DAST) on upload endpoints, SSRF boundaries, and webhook sign-offs. | **P2** |

---

## 3. Strict Real Pipeline Acceptance Guards

To prevent any test fixture or CPU optimizer from ever being falsely cited as proof of real GPU execution:

1. **`HETTETY_REAL_PIPELINE_STRICT=1` Guard**:
   - `pipeline/colmap.py` strictly raises `COLMAP_UNAVAILABLE` and rejects all calls to `_generate_test_fixture_sfm()` and `_generate_test_fixture_dense()`.
   - `pipeline/train.py` strictly raises `GRAPHDECO_RUNNER_MISSING` or `CUDA_UNAVAILABLE` and rejects all fallbacks to `IterativeGaussianOptimizer`.
2. **Dedicated Real GPU Acceptance Suite**:
   - Located at: `hettety-3d-worker/tests/acceptance/test_real_gpu_reconstruction.py`.
   - Explicitly asserts that on any non-GPU host, the real test is marked `SKIPPED / BLOCKED_PREREQUISITE` with the exact missing hardware requirement, while strict guards are verified to block all synthetic fallbacks.
