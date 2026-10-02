# Project: HETTETY Egyptian Real Estate & Financial Platform Overhaul

## Architecture
- **Framework & Frontend**: React 18, TypeScript, Vite, Tailwind CSS v4, Framer Motion, Lucide Icons, Three.js (3D Viewer / Equirectangular Panoramas / Depth Relief).
- **Backend & Cloud Services**: Firebase Firestore (Production Database), Firebase Storage (Public media vs Private legal document vault), Firebase Authentication (Email/Password & Social Auth).
- **Serverless API**: `/api/ai` endpoint routing to Google Gemini / OpenAI-compatible models with sliding-window rate limiting, token quota protection, and localized error handling.
- **Data Flow**:
  1. *Brand Identity*: Scalable vector SVG (`BrandLogo.tsx`) with mathematical forward slant (-14°), theme-responsive styling (Navy `#0A2042` / White `#FFFFFF` and Orange `#FF5722`), and full LTR/RTL symmetry.
  2. *Market Intelligence & AI*: `marketIntelligence.ts` feeds top 9 developers, 4 prime hubs, price/sqm benchmarks, maintenance deposits, and legal registry into `RealEstateAdvisor.tsx` and system prompts, coupled with bidirectional reactive sliders (Budget, Down Payment, Monthly Capacity).
  3. *Premier Inventory*: Landmark compound units (One Hyde Park, Mountain View iCity/Ras El Hekma, SODIC Villette/Eastown/October Plaza) in `seedProperties.ts` with Matterport/Polycam 3D digital twins, floor plans, and verified unit codes.
  4. *Security & Privacy*: `storage.rules` isolates confidential legal PDFs (`/documents/`) from public media; `firestore.rules` enforces deterministic review IDs (`reviews/{propertyId}_{userId}`), purchase price snapshots & idempotency, and strict profile email sync with auth token.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Vector Brand Monogram | Forward-slanted (-14°) interlocking 'H' (Navy/White) and 'T' (Orange) SVG matching official media asset | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Brand Typography & Lockups | Geometric 'H E T T E T Y' (`tracking-[0.25em]`) and 'FIND. TRUST. OWN.' (`tracking-[0.15em]`) across Full, Horizontal, and Mark variants | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Logo Integration Touchpoints | Seamless rendering across Navbar (`h-14`), Mobile Drawer (`h-10`), Splash Screen (`h-44`), Footer (`h-8`), and Chat Avatars | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Favicon & Meta Branding | Standalone `public/favicon.svg`, apple-touch-icon, and theme-color meta tags in `index.html` | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Egyptian Developers Knowledge | Profiles, price/sqm, payment terms, and maintenance fees for Emaar, Mountain View, Hyde Park, SODIC, Palm Hills, Tatweer Misr, TMG, Ora, Sabbour | M2 | ORIGINAL_REQUEST §R2 |
| 6 | Prime Corridors & Benchmarks | Data for New Cairo (Golden Square/Mostakbal), Sheikh Zayed/October, North Coast (Ras El Hekma/Sidi Abdel Rahman), and New Capital | M2 | ORIGINAL_REQUEST §R2 |
| 7 | Market Dynamics & Legal Registry | Installment terms (5-8+ yrs), maintenance deposit (8-10%), and legal registry tiers (الشهر العقاري وصحة ونفاذ) | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Bidirectional Financial Sliders | Interactive range sliders for Budget, Down Payment, and Monthly Capacity synchronized with AI state extraction tags | M2 | ORIGINAL_REQUEST §R2 |
| 9 | AI Rate Limiting & Quota Shield | Server-side sliding-window rate limiter (20 req/min per IP) on `/api/ai` returning HTTP 429 | M2 | ORIGINAL_REQUEST §R2 |
| 10 | Authentic AI Error Handling | Purge canned mock fallback (`mockApi.ts:chat`), returning localized Arabic/English error states (`aiErrorMessage`) | M2 | ORIGINAL_REQUEST §R2 |
| 11 | STORAGE_BUCKET SSRF Shield | Fallback pinning to `gen-lang-client-0748002195.firebasestorage.app` with path traversal blocking in `api/_lib/fetchFile.ts` | M2 | ORIGINAL_REQUEST §R2 |
| 12 | One Hyde Park Inventory | Signature standalone royal villa and luxury apartments with full specs, floor plans, and Matterport 3D twin | M3 | ORIGINAL_REQUEST §R3 |
| 13 | Mountain View Inventory | iCity New Cairo/October I-Villas and Ras El Hekma coastal chalets with lagoon/beach panoramas and 3D tours | M3 | ORIGINAL_REQUEST §R3 |
| 14 | SODIC Landmark Inventory | Villette New Cairo Sky Condos, Eastown ground apartment, and October Plaza penthouse duplex with specs & verified codes | M3 | ORIGINAL_REQUEST §R3 |
| 15 | 3D Tour & Media Integration | Interactive Matterport/Polycam/Kuula allowlisted embeds, 360° equirectangular panoramas, and down payment/installment schedules | M3 | ORIGINAL_REQUEST §R3 |
| 16 | Storage Privacy Separation | Restrict confidential title deeds and contract PDFs to owner/admin in `storage.rules`, keeping unit media public | M4 | ORIGINAL_REQUEST §R4 |
| 17 | Deterministic Review IDs | Enforce `reviews/{propertyId}_{userId}` in client (`setDoc`) and `firestore.rules` to prevent review spam | M4 | ORIGINAL_REQUEST §R4 |
| 18 | Purchase Flow Hardening | Price snapshotting (`priceSnapshot`), availability validation (reject Sold/Reserved), and idempotency | M4 | ORIGINAL_REQUEST §R4 |
| 19 | Profile Email Token Sync | Lock email input to read-only in UI and enforce `data.email == request.auth.token.email` in `firestore.rules` | M4 | ORIGINAL_REQUEST §R4 |
| 20 | Backend Prototype Deprecation | Formal `DEPRECATED.md` notice in `backend/` solidifying Firebase as singular production source of truth | M4 | ORIGINAL_REQUEST §R4 |
| 21 | RTL PropertyCard Badge Fix | Decouple status/review badges (`start-4`) from favorite action button (`end-4`), eliminating collision in RTL | M5 | ORIGINAL_REQUEST §R5 |
| 22 | Tailwind Logical Classes Migration | Convert 37 physical directional classes (`left-`, `right-`, `ml-`, `mr-`, `pl-`, `pr-`, `border-l`, `border-r`) to bidirectional logical classes | M5 | ORIGINAL_REQUEST §R5 |
| 23 | Mobile Viewport Height & Insets | Convert `100vh` to dynamic `100dvh` with `env(safe-area-inset-bottom)` padding for AI chat drawers and input bars | M5 | ORIGINAL_REQUEST §R5 |
| 24 | TypeScript Zero-Error Parity | Add `deliveryTimeline?: string;` to `Property` in `src/types.ts` and resolve status checks so `tsc --noEmit` exits 0 | M5 | ORIGINAL_REQUEST §R5 |
| 25 | Automated Test Suite Integrity | Maintain 100% green pass on Vitest test suite (28 test files, 216+ tests) and clean production build | M5 | ORIGINAL_REQUEST §R5 |
| 26 | E2E Test Suite Creation & Gate | Requirements-driven test suite (Tiers 1-4) verifying all 25 features opaque-box with zero regressions | M-Final | ORIGINAL_REQUEST §R5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Brand Identity & Logo Modernization | Features 1, 2, 3, 4: Vector SVG logo (`BrandLogo.tsx`), theme adaptation, touchpoint integration, favicon & meta | None | IN_PROGRESS |
| M2 | AI Cognitive Engine & Market Intelligence | Features 5, 6, 7, 8, 9, 10, 11: `marketIntelligence.ts`, financial sliders, prompt enrichment, rate limiting, error handling, storage bucket shield | None | PLANNED |
| M3 | Premier Landmark Inventory & 3D Tours | Features 12, 13, 14, 15: Hyde Park, Mountain View, SODIC inventory dataset, 3D tour assets, payment plans | M2 (types) | PLANNED |
| M4 | Security & Privacy Audit Remediation | Features 16, 17, 18, 19, 20: Storage rules isolation, deterministic reviews, purchase flow hardening, profile email sync, backend deprecation | None | PLANNED |
| M5 | Line-by-Line QA, RTL Fixes & Zero-Bug | Features 21, 22, 23, 24, 25: Badge collision fix, logical CSS conversion, mobile 100dvh, TypeScript zero errors | M1, M2, M3, M4 | PLANNED |
| M-Final | E2E Test Pass & Coverage Hardening | Feature 26: 100% pass on Tiers 1-4, Phase 2 adversarial coverage hardening (Tier 5) | M1, M2, M3, M4, M5 | PLANNED |

## Interface Contracts

### Brand Identity ↔ App Touchpoints
- `<BrandLogo variant="horizontal" | "full" | "mark" className?: string color?: string />`
  - `variant="horizontal"`: Monogram + Wordmark + Tagline inline (Navbar, Footer).
  - `variant="full"`: Stacked 1:1 square lockup (Splash screen, About).
  - `variant="mark"`: Standalone monogram (Mobile drawer, Chat avatars, Favicon).

### Market Intelligence ↔ AI Advisor
- `DISTRICT_BENCHMARKS`: Retains `rentalYield: number` and `capitalGrowth: number` (strict backwards compatibility). Extended with `avgPricePerSqmPrimary`, `avgPricePerSqmResale`, `subHubs`, `typicalDownPayment`, `typicalInstallmentYears`, `maintenanceDepositRate`, `legalStatusSummary`.
- `TOP_DEVELOPERS`: Record of developer profiles with price ranges, active compounds, installment structures, and maintenance terms.
- `ADVISOR_STATE` tag: Emits and consumes `{"budget": number, "downPayment": number, "monthlyCapacity": number, "preferredLocation": string, "propertyType": string, "deliveryTimeline": string, "purpose": string}`.

### Storage & Firestore Security Contracts
- Public media path: `properties/{ownerUid}/media/{fileName}` or legacy `properties/{ownerUid}/{fileName}` (images/videos only).
- Private legal docs path: `properties/{ownerUid}/documents/{fileName}` (PDF only, strictly `isOwner || isSuperAdmin`).
- Deterministic Review ID: `reviews/{propertyId}_{userId}` where `propertyId` and `userId` match payload.
- Purchase ID: `purchases/{propertyId}_{userId}` with `priceSnapshot`, `currency`, `unitCode`, `propertyTitle`, and availability check.
- Profile User ID: `users/{userId}` where `data.email == request.auth.token.email`.

## Code Layout
- `src/components/BrandLogo.tsx`: Primary vector SVG brand logo component.
- `src/lib/marketIntelligence.ts`: Authoritative Egyptian real estate intelligence catalog.
- `src/data/seedProperties.ts`: Premier landmark inventory dataset (Hyde Park, Mountain View, SODIC).
- `src/components/RealEstateAdvisor.tsx`: AI advisor UI with bidirectional financial sliders and market knowledge.
- `src/components/Property3DViewer.tsx`: Three.js 3D panorama, depth relief, and Matterport/Polycam iframe handler.
- `api/ai.ts` & `api/_lib/rateLimiter.ts`: Serverless AI gateway with sliding-window rate limiting.
- `api/_lib/fetchFile.ts`: Storage file fetcher with pinned project bucket and traversal prevention.
- `storage.rules`: Firebase Storage access control (confidential documents vs public media).
- `firestore.rules`: Firebase Firestore access control (deterministic reviews, purchases, email sync).
- `backend/DEPRECATED.md`: Formal deprecation marker for inactive PostgreSQL/Prisma prototype.
- `public/favicon.svg` & `index.html`: Web application favicon and branding metadata.
