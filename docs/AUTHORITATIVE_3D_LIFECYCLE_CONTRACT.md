# HETTETY 3D — Authoritative Reconstruction Lifecycle & Architecture Contract

> **Version**: 4.1.0  
> **Status**: APPROVED & LOCKED  
> **Scope**: Control Plane (`api/reconstruction.ts`), 3D Worker (`hettety-3d-worker/`), Storage (`storage.rules`), Database (`firestore.rules`), and Viewer (`src/components/Property3DViewer.tsx`).

---

## 1. Executive Definition: What Does `READY` Mean?

A 3D Reconstruction Job on Hettety reaches `READY` status **if and only if** all authoritative backend stages have completed and passed the fail-closed Authoritative Quality Gate.

### The Two Certification Tiers

| State / Badge | Visual Walkthrough | Metric Survey Certified | Permitted User Actions |
| :--- | :---: | :---: | :--- |
| **`METRIC_CERTIFIED`** | ✅ 6-DoF Navigable | ✅ Certified Ground Truth | Full 3D walk + Contractual/legal metric measurement tool (mm/cm precision) |
| **`VISUAL_READY`** | ✅ 6-DoF Navigable | ❌ Approximate Only | Full 3D walk + Informational approximate measurements (with explicit UI disclaimer) |
| **`REJECTED`** | ❌ Blocked | ❌ Blocked | **Never published.** Status transitions to `FAILED` with explicit rejection reasons |

```
                                  Reconstruction Pipeline Complete
                                                  │
                                                  ▼
                                      Authoritative Quality Gate
                                      (pipeline/quality_gate.py)
                                                  │
                    ┌─────────────────────────────┴─────────────────────────────┐
                    ▼                                                           ▼
         Visual Invariants Failed                                   Visual Invariants Passed
         (cam < 8, overlap < 35%,                                   (cam ≥ 8, overlap ≥ 35%,
          splats < 100, NaN/Inf,                                     splats ≥ 100, finite bounds,
          degenerate mesh/GLB)                                       valid metric mesh & GLB)
                    │                                                           │
                    ▼                                                           ▼
           `status: REJECTED`                                           Is Metric Calibrated?
           `overall_passed: false`                                              │
           (Job moves to FAILED)                                  ┌─────────────┴─────────────┐
                                                                  ▼                           ▼
                                                                False                       True
                                                                  │                           │
                                                                  ▼                     Calibration Gate
                                                       `visualReady: true`              • confidence ≥ 0.85
                                                       `metricCertified: false`         • RMSE ≤ 0.05m (5cm)
                                                       `status: READY`                  • holdout validation
                                                       `cert: VISUAL_READY`             • scale applied to SPZ & GLB
                                                                                              │
                                                                                  ┌───────────┴───────────┐
                                                                                  ▼                       ▼
                                                                                Passed                  Failed
                                                                                  │                       │
                                                                                  ▼                       ▼
                                                                        `visualReady: true`      `status: REJECTED`
                                                                        `metricCertified: true`  `overall_passed: false`
                                                                        `status: READY`          (Job moves to FAILED)
                                                                        `cert: METRIC_CERTIFIED`
```

---

## 2. Component Boundaries & Single Sources of Truth

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT LAYER (Browser)                               │
│  - Captures video or photo frames                                                      │
│  - Executes pre-flight capture guidance (blur, lighting, motion)                       │
│  - Displays verified badges from server qualityReport ONLY (zero client fabrication)  │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Authenticated HTTP / Signed URLs
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              CONTROL PLANE (api/reconstruction.ts)                     │
│  - Single source of truth for Job State Machine, Permissions, & Lifecycle               │
│  - Enforces Firebase ID token verification and Property Owner authorization            │
│  - Distributes jobs with attemptId, workerId binding, and stateVersion locking         │
│  - Validates manifests, storage path containment, and callback signatures              │
└─────────────────────┬───────────────────────────────────────────────────┬──────────────┘
                      │ Job Enqueued via Redis                            │ Callbacks
                      ▼                                                   │
┌──────────────────────────────────────────────────┐                      │
│        GPU WORKER (hettety-3d-worker)            │                      │
│  - Pure compute execution node                   │                      │
│  - Reads credentials from trusted local env only │                      │
│  - Structure-from-Motion (COLMAP / GLOMAP)       │                      │
│  - Metric survey anchor calibration (holdout)    │                      │
│  - 3D Gaussian Splatting optimization (3DGS)     │                      │
│  - Coordinate scaling invariance (SPZ & GLB)     │                      │
│  - Authoritative quality gate evaluation         │──────────────────────┘
│  - Uploads immutable artifacts to Storage        │
└─────────────────────┬────────────────────────────┘
                      │ Writes versioned & tour assets
                      ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               STORAGE LAYER (Cloud Storage)                            │
│  - properties/{propertyId}/3d/raw/{jobId}/          -> Private raw captures            │
│  - properties/{propertyId}/3d/{jobId}/{attemptId}/  -> Immutable versioned artifacts   │
│  - properties/{propertyId}/tour/                    -> Published public pointers       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Authoritative State Machine & Transition Invariants

### Allowed Transitions

```
[QUEUED] ──► [UPLOADING] ──► [VALIDATING] ──► [RECONSTRUCTING] ──► [TRAINING] ──► [OPTIMIZING] ──► [PUBLISHING] ──► [READY]
   │              │               │                 │                 │              │              │
   └──────────────┴───────────────┴─────────────────┴─────────────────┴──────────────┴──────────────┴──────► [FAILED]
   │
   ▼
[CANCELLED] / [CANCEL_REQUESTED]
```

### Transition Enforcement Rules

1. **Forward Monotonicity**: A job may never jump backwards (e.g. `TRAINING` $\to$ `VALIDATING`).
2. **Terminal State Immutability**: Once a job enters `READY`, `FAILED`, or `CANCELLED`, all further mutations are rejected with `409 TERMINAL_STATE_LOCKED`.
3. **Optimistic Locking**: Every mutation requires matching `stateVersion`. If the version does not match, the callback is rejected with `409 STATE_VERSION_CONFLICT`.
4. **Attempt ID & Worker ID Binding**: Once a worker registers on an attempt (e.g., `attempt_1` bound to `worker_gpu_node_1`), all subsequent updates for that attempt must originate from that exact worker. Mismatches return `409 WORKER_MISMATCH_IGNORED`.
5. **Zombie Worker Protection**: If a job was retried to `attempt_2`, any callback from `attempt_1` is rejected with `409 STALE_ATTEMPT_IGNORED`.

---

## 4. Storage Segregation & Retention Policy

### Storage Namespaces

1. **Private Raw Captures**:
   - Path: `properties/{propertyId}/3d/raw/{jobId}/{filename}`
   - Access: Private. Client SDK direct writes are strictly DENIED (`allow write: if false`). All uploads MUST use signed V4 URLs authorized by the control plane with verified property ownership. Read restricted to super-admins / backend worker.
   - Retention: Retained for 14 days after job completion, then pruned to save storage costs.
2. **Immutable Versioned Artifacts**:
   - Path: `properties/{propertyId}/3d/{jobId}/{attemptId}/{scene.spz, mesh.glb, manifest.json}`
   - Access: Immutable. Client writes strictly DENIED (`allow write: if false`). Archived with SHA-256 manifest hash and accessible only by backend audit.
   - Retention: Kept indefinitely as historical reconstruction audit log.
3. **Published Public Tour Pointers**:
   - Path: `properties/{propertyId}/tour/{scene.spz, mesh.glb, manifest.json}`
   - Access: Public read (`allow read: if true`). Client writes strictly DENIED (`allow write: if false`). Updated **only** via atomic backend copy from verified versioned artifacts upon passing the authoritative quality gate.

---

## 5. Security & Trust Boundaries

1. **No Shared Secrets in Payloads**: The worker's API key is configured exclusively via `RECONSTRUCTION_API_KEY` in worker environment variables. It is never passed in client requests or job payloads.
2. **Least Privilege Client Rules**: Clients can never write to `/tour/` or `/3d_assets/`. In Firestore, regular users can only submit `QUEUED` or `CANCEL_REQUESTED`.
3. **SSRF & Stream Defense**: The AI endpoint enforces `redirect: 'error'`, 15s timeout, 16MiB stream cut-off, and magic bytes verification.
4. **Distributed Concurrency & Rate Limiting**: AI endpoints are guarded by Redis atomic sliding windows with per-IP concurrency slots.
