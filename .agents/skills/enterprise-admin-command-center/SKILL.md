---
name: enterprise-admin-command-center
description: >-
  Architecture and UI/UX blueprint for building a standalone, multi-page
  Enterprise Admin Command Center ("an independent platform inside the platform")
  with full RBAC, real-time telemetry, CMS inventory controls, 3D/worker ops
  monitoring, financial escrow ledger, AI diagnostics, CRM, SEO inspector, and
  immutable audit logs in full Arabic RTL and English LTR.
---

# Enterprise Admin Command Center Blueprint

Never reduce an Admin Dashboard to a single tab table of users. Build it as a **standalone, full-viewport Enterprise Operations Portal** with dedicated navigation chrome, live health telemetry, and complete control over every subsystem.

## 1. Standalone Shell Architecture
- **Full-Viewport Takeover**: When an authorized administrator enters `/admin` (or `#manage-users`), render a dedicated portal layout (`AdminPortalApp`) with a collapsible sidebar, top command bar (`Ctrl+K` quick jump), live service status indicators (Database, AI, Worker Queue, Storage), role badge, RTL/LTR & dark/light controls, and an instant "Return to Public Site" button.
- **Role-Based Access Control (RBAC)**:
  - Granular tiers: `super_admin` > `admin` > `operations` > `broker` > `technician` > `seller` > `buyer`.
  - Every mutation writes an **immutable Audit Log entry** (`actor`, `action`, `resourceType`, `resourceId`, `beforeState`, `afterState`, `timestamp`).

## 2. Mandatory Multi-Page Module Matrix
1. **Executive Command Overview**: Real-time KPIs, infrastructure health matrix, verification funnel, escrow liquidity, live activity stream.
2. **Inventory & Properties CMS**: Full CRUD, search/multi-filter, grid/table switcher, inline Live/Draft/Removed & Available/Reserved/Sold toggles, bulk actions, danger-zone reset tools.
3. **Verification & Legal Review Workbench**: Split-screen property + document reviewer with file preview, mandatory rejection reasons, and automatic owner notifications.
4. **3D / Background Worker Operations**: Live worker heartbeats, queue latency, job state-machine progress bars, quality-gate metrics, retry/cancel actions.
5. **Financial Escrow & Transactions Desk**: Offers, earnest deposits, escrow status controls, purchase requests, CSV/JSON export.
6. **Users & RBAC Security**: Directory, multi-tier role assignment, KYC approval, suspend/activate, permission matrix.
7. **CRM, Viewings, Reports & Inbox**: Leads, scheduled tours, abuse reports, contact inquiries, email alert subscriptions.
8. **AI Operations & Live Diagnostics**: Live `/api/ai?health=1` probe, active model/provider/rate-limiter readout, interactive live prompt test console.
9. **Analytics, Security & SEO Center**: Market intelligence, security invariants, live SEO/JSON-LD audit score.
10. **Immutable Audit Logs & System Settings**: Filterable audit trail, Neon DB diagnostics, feature flags, maintenance mode, safe property reset preserving users.
