---
name: neon-postgres-clean-architecture
description: >-
  Production runbook for migrating from Firebase/NoSQL to Neon Serverless Postgres
  using Clean Architecture, SOLID principles, ACID financial transactions,
  hybrid Object Storage for heavy 3D/image media, and Postgres-backed distributed
  rate limiting on serverless platforms (Vercel / Cloudflare / Node).
---

# Neon Serverless Postgres & Clean Architecture Runbook

Use this skill whenever building or migrating a full-stack web or SaaS platform onto **Neon Serverless Postgres** (`@neondatabase/serverless`) while maintaining strict Clean Architecture and SOLID principles.

## 1. Hybrid Storage Architecture (Postgres + Object Storage)
Never stuff multi-megabyte binary images, 4K videos, or 3D Gaussian Splatting (`.spz` / `.glb`) meshes directly into database `BYTEA` columns:
- **Neon Serverless Postgres**: Stores normalized relational records (`users`, `properties`, `media_assets`, `reconstruction_jobs`, `transactions`, `audit_logs`, `rate_limit_buckets`), JSONB structured metadata, spatial bounds, and indexed search facets.
- **Object Storage + CDN (Cloudflare R2 / AWS S3 / GCS / Vercel Blob)**: Stores raw high-resolution photography, equirectangular panoramas, `.spz` splat clouds, and `.glb` meshes with signed upload URLs and SHA-256 verification.
- **Why Neon beats Firebase/Firestore for complex platforms**:
  1. True **ACID transactions** for financial escrow, reservations, and state machines.
  2. Rich **multi-facet SQL indexing** (`B-tree` + `GIN` JSONB + `PostGIS`) without composite-index explosion.
  3. **Instant Database Branching** for staging, CI, and safe schema migrations.
  4. **Zero client SDK bloat**: Removes ~500 KB of Firebase client bundles, boosting Core Web Vitals and SEO.
  5. **Native Serverless Rate Limiting**: Use a `rate_limit_buckets` table in Neon when Redis is not provisioned so AI endpoints never hard-block users in production.

## 2. Clean Architecture Layering (SOLID)
- **`src/core/domain/`**: Entities, value objects, and repository interfaces (`IPropertyRepository`, `IAdminRepository`, `IUserRepository`). Zero framework imports.
- **`src/core/use-cases/`**: Pure business rules (filtering strategies, pricing/ROI calculators, validation pipelines).
- **`src/infrastructure/`**: Concrete adapters (`NeonClient`, `NeonPropertyRepository`, `SeoManager`) implementing domain interfaces (Dependency Inversion Principle).
- **`src/features/`**: Modular feature vertical slices (`admin/`, `properties/`, `reconstruction/`) owning their presentation components and hooks.
- **`api/_lib/neon.ts` & `api/_lib/auth.ts`**: Server-side parameterized SQL queries (never string-interpolated), HMAC-SHA256 JWT + scrypt password hashing, and RBAC guards.

## 3. Safe Data Reset Protocol (Preserve Accounts)
Whenever resetting catalog/domain data (e.g. clearing properties before launch):
- Provide BOTH an idempotent SQL migration (`002_reset_properties_preserve_users.sql`) AND a CLI/admin action that deletes domain tables (`properties`, `media_assets`, `reviews`, `reports`, `purchases`, `transactions`, `reconstruction_jobs`) inside a transaction while **strictly preserving `users` and `sessions`**.
- Never auto-inject demo/fixture arrays as a silent runtime fallback when the database legitimately contains 0 rows.
