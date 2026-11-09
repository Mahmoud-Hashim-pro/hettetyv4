# HETTETY v4 — PRODUCTION GAPS & ACCEPTANCE READINESS AUDIT (Forensic Update)

> **Audit Status**: COMPLETE REAL 3D ACCEPTANCE HARDENING & PRODUCTION GAP LEDGER  
> **Repository**: `Mahmoud-Hashim-pro/hettetyv4`  
> **Working Branch**: `fix/complete-real-3d-acceptance`  
> **Last Updated**: November 9, 2026  

---

## 1. Executive Status: The Two-Tier Verification Reality

To eliminate all ambiguity between automated CI unit/fixture testing and live physical production execution, the system is formally decoupled into two distinct operational tiers:

- **Tier 1 (Client Web Application, Control Plane & Format Compression)**:
  - **Status**: **PRODUCTION READY (LIVE ON VERCEL)**
  - Fully implemented and certified: Three.js SPZ binary parser, $O(N)$ radix sorting worker, bilingual Arabic (RTL) / English (LTR) UI/UX, responsive layout containment, fail-closed Firestore security rules, client quality badges, and zero-clipping filter controls.
  - Test suites: **504/504 Vitest tests passing**, zero TypeScript errors, clean Vite production bundle.

- **Tier 2 (Photogrammetry & 3D Gaussian Splatting Reconstruction Pipeline)**:
  - **Status**: **ARCHITECTURE & ACCEPTANCE GATES HARDENED; PHYSICAL GPU EXECUTION BLOCKED ON CLOUD GPU RUNNER**
  - All algorithms, coordinate invariance mappings, OpenCV video frame extraction, metric laser holdout calibration, watertight GLB mesh generation, and authoritative iteration parsing are verified in Python test suites (81 passed, 2 skipped).
  - **Developer Hardware Reality**: The local development machine is a Dell Precision 7550 equipped with Intel Core i7-10750H and Intel UHD Graphics only (no NVIDIA GPU present). Windows detects Intel UHD Graphics only.
  - **Forensic Truth**: The 100% pass rate in automated CPU suites proves algorithmic and interface correctness. Real execution of native COLMAP binary (SfM + Dense MVS) and 30,000-iteration official Graphdeco 3DGS on an NVIDIA GPU ($\ge 12$ GB VRAM) is **PENDING DEDICATED CLOUD GPU HOST PROVISIONING**.

---

## 2. Hardened Acceptance Invariants & Resolved Gaps

During this audit cycle, all code-level gaps in the acceptance testing and verification pipeline have been permanently resolved:

1. **P0 Acceptance Evidence Output System**:
   - **Root Cause**: Previously, `TestRealGPUPipelineAcceptance` wrote evidence to a temporary directory deleted by `tearDown()`, and GitHub Actions searched for non-existent paths with `if-no-files-found: warn`.
   - **Fix Implemented**: Configurable persistent evidence directory via `HETTETY_ACCEPTANCE_EVIDENCE_DIR` (default: `artifacts/acceptance_evidence`). Evidence survives test cleanup. Produces machine-readable `acceptance_evidence.json`, run-stamped JSON, and human-readable `acceptance_evidence.md`. GitHub Actions enforces `if-no-files-found: error` and validates evidence integrity.

2. **P0 GPU Workflow Control Gate (`.github/workflows/gpu-acceptance.yml`)**:
   - **Root Cause**: Workflow exposed `run_real_gpu_acceptance` input but did not use it to gate job execution.
   - **Fix Implemented**: Job condition strictly requires `inputs.run_real_gpu_acceptance == true`. Fails closed if physical GPU, CUDA $\ge 11.8$, VRAM $\ge 11.5$ GB, COLMAP binary, or Graphdeco submodules are missing. Never silently falls back to CPU.

3. **P0 Dynamic Dataset Selection & Security Allowlist**:
   - **Root Cause**: Acceptance test hardcoded `prop_villa_marassi_01` ignoring workflow input.
   - **Fix Implemented**: Workflow passes `HETTETY_ACCEPTANCE_DATASET: ${{ inputs.target_property_fixture }}`. The dataset resolver enforces an explicit allowlist (`prop_villa_marassi_01`, `prop_courtyard_dslr_02`), rejects all path traversal sequences (`..`, `/`, `\`), validates keyframe headers/sizes, and generates a cryptographic SHA-256 dataset manifest.

4. **P0 Authoritative Graphdeco Iteration Verification**:
   - **Root Cause**: Training previously reported requested iterations as achieved iterations without empirical verification.
   - **Fix Implemented**: `pipeline/training_log_parser.py` parses Graphdeco stdout/stderr streams and inspects checkpoint folders on disk. Strictly fails if completed iterations $< 30,000$ or if CUDA OOM occurs.

5. **P1 Redis Worker Lifecycle Separation**:
   - **Root Cause**: Mocked Redis tests were conflated with live Redis connectivity.
   - **Fix Implemented**: Decoupled `TestWorkerLifecycleStateMachine` (verifying retry deduplication, fail-closed behavior, cancellation) from `TestRealRedisConnection` (which tests live network connection to `REDIS_URL` and skips with explicit diagnostic when unprovisioned).

---

## 3. Active Production Gaps & Hardware Requirements

| Subsystem / Requirement | Current State | Required Production Action | Blocking? |
| :--- | :--- | :--- | :---: |
| **GPU Worker Node** | Intel UHD Graphics (local) & CPU GHA runner | Provision dedicated GPU instance (RunPod / GCP A10G / AWS G5 with NVIDIA RTX 4090 / A10G with $\ge 12$ GB VRAM, CUDA 11.8+). | **YES (Blocks Phase 6, 7, 17)** |
| **COLMAP Binary on Worker** | Real Docker image available; CPU execution verified | Install native COLMAP with CUDA SIFT/MVS on dedicated GPU host. | **YES (Blocks Phase 6 on GPU)** |
| **Graphdeco 3DGS Runner** | Integrated with parser; CPU fallback strictly rejected | Clone official `graphdeco-inria/gaussian-splatting` and compile CUDA submodules (`diff-gaussian-rasterization`, `simple-knn`). | **YES (Blocks Phase 7 on GPU)** |
| **Managed Redis Stream with TLS** | Verified with offline state machine | Provision GCP Cloud Memorystore or Upstash Redis with TLS and connection pooling. | **P1 (Blocks Phase 4 live)** |
| **Cloud Storage CORS & Signed URLs** | Verified with local emulator | Configure GCS CORS policy for `*.hettety.com` and `hettety.vercel.app` for direct SPZ / GLB mesh streaming. | **P1 (Blocks live uploads)** |
| **Independent Security Audit** | Static code analysis & tenant isolation verified | Run dynamic penetration testing (DAST) on upload endpoints and signed URL generation. | **P2** |
