# HETTETY v4 — RECONSTRUCTION JOB STATE MACHINE (Phase 0)

## State Lifecycle Diagram

```mermaid
stateDiagram-v2
    [*] --> QUEUED: User creates job
    QUEUED --> UPLOADING: Worker claims lease
    UPLOADING --> VALIDATING: Keyframes downloaded
    VALIDATING --> RECONSTRUCTING: Laplacian & count pass (>=12)
    RECONSTRUCTING --> TRAINING: COLMAP SfM & Dense pass
    TRAINING --> OPTIMIZING: 3DGS training complete
    OPTIMIZING --> PUBLISHING: Floater pruning & metric bounds pass
    PUBLISHING --> READY: Quality gate & storage verification pass

    QUEUED --> CANCELLED: User requests cancellation
    UPLOADING --> CANCELLED: Cancellation detected
    VALIDATING --> CANCELLED: Cancellation detected
    RECONSTRUCTING --> CANCELLED: Heartbeat cancel signaled
    TRAINING --> CANCELLED: Heartbeat cancel signaled

    VALIDATING --> FAILED: Insufficient or blurry frames
    RECONSTRUCTING --> FAILED: SfM / Dense failure (No fallback)
    TRAINING --> FAILED: CUDA / Convergence error
    OPTIMIZING --> FAILED: Non-finite spatial bounds
    PUBLISHING --> FAILED: Storage / Checksum error

    FAILED --> RETRYING: Retry count < 3 (Backoff & Jitter)
    RETRYING --> QUEUED: Reset attempt data
    FAILED --> DEAD_LETTER: Retry count >= 3
    READY --> [*]
    DEAD_LETTER --> [*]
    CANCELLED --> [*]
```

## State Invariants & Transitions

| From State | To State | Trigger / Condition | Invariant Enforced |
| :--- | :--- | :--- | :--- |
| `QUEUED` | `UPLOADING` | Worker acquires lease | Leased by workerId with 30s TTL; heartbeat starts |
| `UPLOADING` | `VALIDATING` | Files downloaded | Integrity checksums match upload manifest |
| `VALIDATING` | `RECONSTRUCTING` | `validate_keyframes` passed | Count $\ge 12$, average sharpness $> 10$ |
| `RECONSTRUCTING` | `TRAINING` | `run_sfm` + `run_dense` passed | True point cloud generated; sparse fallback prohibited |
| `TRAINING` | `OPTIMIZING` | `run_gaussian_training` passed | Valid PLY with finite coefficients (no NaNs) |
| `OPTIMIZING` | `PUBLISHING` | Floater prune & bounds | Bounding box strictly computed from geometry |
| `PUBLISHING` | `READY` | Artifact promotion | SHA-256 verified, attempt directory immutable |
| Any active | `CANCELLED` | User cancellation | Child processes killed; GPU memory freed |
| Any active | `FAILED` | Pipeline error | Atomic error recording; retry eligibility evaluated |
