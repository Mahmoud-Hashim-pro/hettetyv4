-- ============================================================================
-- HETTETY v4 — Migration 002: Safe Property Catalog Reset (Preserve Users)
-- ============================================================================
-- Purpose:
--   Atomically clears all property listings and property-scoped operational
--   tables before fresh inventory launch while STRICTLY PRESERVING:
--     * users
--     * sessions
--     * system_settings
--     * audit_logs (appends an immutable record of this reset)
-- ============================================================================

BEGIN;

-- Capture pre-reset metrics into a temporary table for the audit log
CREATE TEMP TABLE _reset_counts ON COMMIT DROP AS
SELECT
  (SELECT COUNT(*) FROM properties) AS deleted_properties,
  (SELECT COUNT(*) FROM media_assets) AS deleted_media_assets,
  (SELECT COUNT(*) FROM reviews) AS deleted_reviews,
  (SELECT COUNT(*) FROM reports) AS deleted_reports,
  (SELECT COUNT(*) FROM viewing_appointments) AS deleted_viewings,
  (SELECT COUNT(*) FROM crm_leads) AS deleted_crm_leads,
  (SELECT COUNT(*) FROM purchases) AS deleted_purchases,
  (SELECT COUNT(*) FROM transactions) AS deleted_transactions,
  (SELECT COUNT(*) FROM reconstruction_jobs) AS deleted_reconstruction_jobs,
  (SELECT COUNT(*) FROM users) AS preserved_users;

-- Delete property-dependent records first (FK-safe order)
DELETE FROM media_assets;
DELETE FROM reviews;
DELETE FROM reports;
DELETE FROM viewing_appointments;
DELETE FROM crm_leads;
DELETE FROM purchases;
DELETE FROM transactions;
DELETE FROM reconstruction_jobs;

-- Delete property catalog
DELETE FROM properties;

-- Record immutable audit entry (users, sessions, system_settings remain intact)
INSERT INTO audit_logs (
  id,
  actor_id,
  actor_email,
  actor_role,
  action,
  resource_type,
  resource_id,
  summary,
  before_state,
  after_state,
  created_at
)
SELECT
  'aud_reset_' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT,
  'migration_002',
  'system@hettety.com',
  'super_admin',
  'RESET_PROPERTIES_PRESERVE_USERS',
  'system',
  'properties_catalog',
  'Executed migration 002: cleared ' || deleted_properties || ' properties while preserving ' || preserved_users || ' user accounts.',
  jsonb_build_object(
    'properties', deleted_properties,
    'media_assets', deleted_media_assets,
    'reviews', deleted_reviews,
    'reports', deleted_reports,
    'viewing_appointments', deleted_viewings,
    'crm_leads', deleted_crm_leads,
    'purchases', deleted_purchases,
    'transactions', deleted_transactions,
    'reconstruction_jobs', deleted_reconstruction_jobs,
    'users', preserved_users
  ),
  jsonb_build_object(
    'properties', 0,
    'users_preserved', preserved_users
  ),
  NOW()
FROM _reset_counts;

COMMIT;
