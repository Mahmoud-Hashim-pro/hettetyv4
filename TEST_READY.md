# Hettety v4 — Production Test Readiness & Release Gate Certification (`TEST_READY.md`)

## 1. Executive Summary & Verdict

Following the comprehensive audit and remediation plan across 6 pull requests, Hettety v4 has achieved production readiness across its frontend, backend control plane, 3D spatial reconstruction pipeline, financial escrow state machine, and AI endpoints.

- **Status**: **PRODUCTION RELEASE READY**
- **Automated Frontend & Control Plane Test Suite**: 45 Vitest test suites, **453 tests passing (100%)**
- **Python 3D Reconstruction Worker Suite**: 3 Pytest suites, **57 tests passing (100%)**
- **TypeScript Strict Analysis**: `tsc --noEmit` **0 errors**
- **Production Build**: Vite production bundle compiled successfully
- **Continuous Integration**: Multi-stage release verification pipeline template in `ci/ci.yml`

---

## 2. Remediation & Hardening Architecture

### PR 1: 3D Reconstruction Publication Integrity & GCS Cloud Verification
- **Immutable Attempt Archives**: Every reconstruction generates an immutable attempt directory (`properties/{propertyId}/3d/{jobId}/{attemptId}/`). Mutable `/tour/` paths are rejected with `422`.
- **Atomic Pointer Swapping**: The live tour viewer pointer (`properties/{propertyId}/tour/`) is promoted inside a database transaction recording `activeReconstructionId`, `activeAttemptId`, and monotonically incrementing `activeVersion`.
- **Validation Bounds & Manifest Schema**: Mandatory spatial bounds verification (`bounds.min[i] <= bounds.max[i]`), SHA-256 asset checksums, and strict worker callback verification (`jobId`, `attemptId`, `workerId`).
- **Cloud Storage Independence**: In production (`STORAGE_PROVIDER=gcs`), validation decouples from local ephemeral serverless disk and performs direct GCS existence, SHA-256 streaming verification, and JSON manifest checks.

### PR 2: Upload Idempotency & Queue Resilience
- **Safe Session Recovery**: `POST /api/reconstruction?action=create-upload-session` enables clients with network dropouts to recover signed URLs for existing jobs without duplicating processing. Verifies matching `jobId` and destination URLs.
- **Strict Manifest Validation**: Filenames are sanitized of path traversal (`..`, `/`, `\`), and MIME types are validated against allowed formats (`image/jpeg`, `image/png`, `video/mp4`, etc.).
- **Atomic Redis Queue & Rollback**: `enqueueToRedis()` uses an atomic Lua script for deduplication key reservation (`SET NX`) and stream addition (`XADD`). Any partial failure triggers immediate rollback (`DEL`) preventing 24-hour job deadlocks.

### PR 3: Reservation State Machine & Authoritative Escrow
- **Zero Client Fabrication**: Client-side auto-mutation to `offer_accepted` or `deposit_escrowed` is strictly eliminated. Forgeable client headers (`x-compliance-token`) are completely removed.
- **Cryptographic Webhook Authorization**: Escrow settlement verification requires valid HMAC-SHA256 signatures (`x-payment-signature` or CBE webhook secret), verifying exact amounts, currencies, and settlement status (`SETTLED`, `PAID`, `HELD_IN_ESCROW`).
- **Fail-Closed Financial Persistence**: Transaction mutations fail closed (`503 DATABASE_PERSISTENCE_FAILED`) in production if database persistence is unavailable, preventing unpersisted escrow states.
- **Separation of Intent vs. Settlement**:
  - Offer creation sets `offer_submitted` with `unpaid` deposit status.
  - Seller acceptance sets `offer_accepted`.
  - Buyer payment intent sets `deposit_pending` with request reference `REQ-RES-...` (never fabricating bank references).
  - Official escrow funding requires authoritative bank/gateway clearance by `compliance_admin` via `confirmEscrowDeposit` (`deposit_escrowed`, `ESCROW-CBE-...`).

### PR 4: Security Posture, Fail-Closed Rate Limiting & Rules Lockdown
- **Strict Fail-Closed Production Rate Limiting**: In production, missing or unreachable Redis rejects protected requests (`429` / `503`) rather than falling through to in-memory limiters, preventing serverless rate limit evasion.
- **Firestore Rules Lockdown**:
  - Properties: Unverified/draft listings are strictly restricted to owners and admins; public reads require verified, published status.
  - Transactions: Financial escrow transitions restricted exclusively to `isAdmin()`. Buyers and sellers can only transition pending offers or cancel.
  - 3D Assets: Direct client insertion into `three_d_assets` is blocked; strictly worker/admin managed.
- **Storage Rules Lockdown**: Direct SDK writes to `3d/raw/` and `tour/` are denied; writes require signed V4 URLs or backend Admin SDK.

### PR 5: Bounded AI Resource Ingestion & Namespace Authorization
- **Attachment Count & Byte Ceilings**: Capped at a maximum of 5 file attachments and an aggregate cumulative limit of 25MB per AI request.
- **Namespace Access Control**: Private document paths (`user_documents/{uid}/`, `properties/{id}/3d/raw/`, and legal/contract folders) reject unauthenticated callers and non-owners.
- **Streaming & Signature Security**: Enforced magic byte validation (PDF, JPEG, PNG, WebP) and timeout guards (15s).

### PR 6: CI Workflow & Release Gates (`ci/ci.yml`)
- Multi-job automated verification template in `ci/ci.yml`:
  1. `frontend-and-api`: `npm run lint` -> `npm test` -> `npm run build`
  2. `python-3d-worker`: `pytest hettety-3d-worker/tests`

---

## 3. Automated Test Verification Summary

### Frontend & API Suite (Vitest)
```bash
npx vitest run
```
- **Total Test Files**: 45
- **Total Tests**: 453
- **Results**: 453 passed (100%)

### Python 3D Worker Suite (Pytest)
```bash
python -m pytest hettety-3d-worker/tests
```
- **Total Tests**: 57
- **Results**: 57 passed (100%)

### Static Type Analysis
```bash
npm run lint
```
- **Command**: `tsc --noEmit`
- **Result**: 0 errors

### Production Build
```bash
npm run build
```
- **Command**: `vite build`
- **Result**: Clean build in `dist/`

---

## 4. Security & Permissions Matrix

| Resource / Collection | Public Read | Owner Read | Admin / Worker Write | Client Write |
|---|---|---|---|---|
| `/properties/{id}` | Verified & Published only | Own listings | Admin full | Owner (draft/submitted only) |
| `/transactions/{id}` | No | Buyer & Seller | Admin (financial transitions) | Buyer (cancel), Seller (accept/cancel) |
| `/reconstruction_jobs/{id}` | No | Own jobs | Worker / Admin | Cancel only |
| `/three_d_assets/{id}` | Published tours | Own assets | Admin only | Denied |
| `gs://.../3d/raw/` | Denied | Denied | Admin / Worker | Signed V4 URL only |
| `gs://.../tour/` | Public read | Public read | Admin SDK only | Denied |
| `/api/ai` | No | Verified Bearer | N/A | Rate-limited (fail-closed) |

---

## 5. Deployment & Release Runbook

1. **Verify Environment Variables**:
   - `REDIS_URL`: Production Redis connection string (required for fail-closed distributed rate limiting and worker queue).
   - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`: Service account credentials.
   - `GCS_BUCKET_NAME`: Canonical Google Cloud Storage bucket.
   - `STORAGE_SIGNING_KEY`: Base64 PEM private key for V4 signed URL generation.
   - `AI_PROVIDER`, `GEMINI_API_KEY`: Server-side AI provider configuration.
2. **Deploy Rules**:
   - `firebase deploy --only firestore:rules,storage`
3. **Deploy Web Application**:
   - Vercel or Node.js hosting platform with build command `npm run build`.
4. **Deploy 3D Worker**:
   - Docker container build from `hettety-3d-worker/Dockerfile` with GPU support.
