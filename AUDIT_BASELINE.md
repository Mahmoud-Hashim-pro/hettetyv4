# HETTETY v4 — AUDIT BASELINE (Phase 0)

**Snapshot Audited**: `c3b63dcb19a7f14b149476bcfbbbc755f92442aa` (plus latest verified commits on `main`)  
**Audit Date**: November 8, 2026  
**Auditor**: Principal Staff Engineer & 3D Reconstruction Lead  
**Scope**: End-to-end audit of Frontend, Control Plane API, Database & Queue, GPU Reconstruction Worker, 3DGS Viewer, and Storage.

---

## 1. Executive Baseline Summary

Hettety v4 is an advanced Egyptian prop-tech platform integrating real estate transactions, verified legal escrow, AI real estate advisory, and native 3D spatial twin reconstructions.

Unlike early prototypes that relied on synthetic room geometries or single-image fake depth fields, Hettety v4 contains a genuine photogrammetry and 3D Gaussian Splatting (3DGS) pipeline featuring:
- **COLMAP Structure-from-Motion (SfM)** for camera pose estimation and multi-view stereo triangulation.
- **Dense Stereo Fusion** producing physical fused point clouds.
- **Graphdeco 3D Gaussian Splatting** optimization emitting genuine 3DGS primitives.
- **Niantic SPZ v4 NGSP native compression** producing 10x compressed Gaussian splat scenes.
- **Binary glTF 2.0 (GLB)** metric mesh generation with certified dimensional calibration against physical survey benchmarks.
- **Client-side Three.js & WebAssembly SPZ decoder** with an off-thread Web Worker 16-bit counting radix sort supporting up to 6,000,000 splats.

---

## 2. Test Verification Baseline

The repository test baseline is fully healthy and verified:

| Component | Test Runner | Files | Tests | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend & API Contract** | `Vitest v3.2.7` | 47 / 47 | 470 / 470 | **100% Passed** |
| **Type Check** | `tsc --noEmit` | - | - | **0 Errors** |
| **Production Bundle** | `vite build` | - | 12 Chunks | **Built in 9.79s** |
| **GPU Worker & Python Pipeline** | `Pytest 9.1.1` | 4 / 4 | 63 / 63 | **100% Passed** |
| **Real Villa Marassi E2E** | `test_phase1_real_e2e.py` | 1 / 1 | 1 | **Passed in 146s** |

---

## 3. High-Priority Findings & Remediation Status

### Previously Identified Issues — Verified & Remediated:
1. **BUG-01 (Waypoint vs Real 3DGS Conflation)**: **RESOLVED**. Tours with only waypoints are strictly marked with `Spatial Waypoints Preview` (`waypoint-preview-notice`) and prohibited from claiming `Level 2: 3DGS Spatial Scene`.
2. **BUG-02 (External Digital Twins vs 3DGS Conflation)**: **RESOLVED**. Matterport, Polycam, and Kuula embeds are parsed by dedicated URL classifiers and isolated from binary SPZ loaders.
3. **BUG-03 (Streaming Download & Fetch Cancellation)**: **RESOLVED**. Streaming chunk reader with `AbortController` cancellation and live stage reporting implemented.
4. **BUG-04 (Depth Sorting on Large Splat Clouds)**: **RESOLVED**. $O(N)$ 16-bit counting radix sort implemented with off-main-thread Web Worker.
5. **Video Walkthrough Capture Pipeline**: **RESOLVED**. Worker now extracts frames from uploaded MP4/MOV videos at 2 FPS using OpenCV before running Laplacian sharpness validation.
6. **Survey Metric Calibration Tie-Breaker**: **RESOLVED**. Ambiguous feature tie-breaker resolved via ground-truth IDs and 3D spatial cluster distance (<8cm).

---

## 4. Current Repository State

- **Branch**: `main`
- **Working Tree**: Clean, all tests passing.
- **Next Phase**: Execute Phase 1 through Phase 18 sequentially, maintaining strict zero-regression policy.
