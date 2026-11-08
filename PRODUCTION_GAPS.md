# HETTETY v4 — PRODUCTION GAPS & HARDENING AUDIT (Phase 0)

This document tracks all identified operational, infrastructure, and runtime gaps between the current codebase and full production deployment.

---

## 1. Resolved Production Gaps in Latest Sprints

1. **[RESOLVED] Client 3DGS Mode Conflation (BUG-01 & BUG-02)**:
   - *Impact*: Previously, waypoint-only tours or external Matterport/Polycam links were treated as raw 3D Gaussian Splats.
   - *Fix*: Strict URL classifications and honest UI preview tags implemented and verified with Vitest.

2. **[RESOLVED] Memory Leaks & Large Scene Frame Drops (BUG-04)**:
   - *Impact*: Scenes with $>100k$ splats either skipped depth sorting or froze the main thread.
   - *Fix*: Implemented $O(N)$ 16-bit counting radix sort offloaded to a dedicated Web Worker (`splat-sort.worker.ts`), tested up to 6,000,000 splats.

3. **[RESOLVED] Video Walkthrough Ingestion**:
   - *Impact*: Video captures (.mp4/.mov) caused validation failures because the worker expected pre-extracted individual images.
   - *Fix*: Integrated OpenCV keyframe extraction at 2 FPS directly in `ReconstructionWorker` and verified on real walkthrough videos.

4. **[RESOLVED] Laser Metric Calibration Ambiguity**:
   - *Impact*: Survey accuracy checks failed closed when two dense features had residuals within 0.05px.
   - *Fix*: Added ground-truth ID matching and 3D spatial cluster distance checks (<8cm) in `pipeline/calibrate.py`.

---

## 2. Active Production Readiness Checklist

| Component | Current Status | Production Readiness Requirement |
| :--- | :--- | :--- |
| **Worker Host GPU** | Tested locally on CPU/Mock + CUDA | Requires host machine with NVIDIA GPU ($\ge 12$ GB VRAM) for live runs |
| **Redis Infrastructure** | Verified in dev & tests | Production deployment must use managed Redis (Memorystore / Upstash) with TLS |
| **Cloud Storage CORS** | Verified locally | Target GCS bucket must configure CORS for `*.hettety.com` web client downloads |
| **Alerting & Sentry** | Logging present | Sentry error tracking and Prometheus queue depth metrics recommended for P3 |
| **Artifact Retention** | Attempt directories isolated | Implement lifecycle rule to archive raw video/images to cold storage after 30 days |

---

## 3. Recommended Phased Execution Next Steps

- **Phase 1 to Phase 3**: Viewer, Parser & Performance Verification (Complete & Verified).
- **Phase 4 (P0)**: Live Redis stream queue integration test with worker consumer daemon.
- **Phase 5 to Phase 11**: Real capture end-to-end smoke test on staging infrastructure.
- **Phase 12**: Complete UI/UX integration review with Arabic/English locale verification.
- **Phase 14**: Full security penetration audit (SSRF, tenant isolation, rate limiting).
