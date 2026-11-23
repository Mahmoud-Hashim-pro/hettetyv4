-- ============================================================================
-- HETTETY v4 — Migration 001: Initial Neon Serverless PostgreSQL Schema
-- ============================================================================
-- Architecture: Hybrid Relational + Object Storage
--   * Neon Postgres stores normalized relational entities, ACID escrow ledger,
--     indexed multi-facet property metadata, audit logs, and distributed rate
--     limit buckets.
--   * Cloudflare R2 / GCS / S3 stores heavy media binaries (photos, 360°
--     panoramas, .spz Gaussian Splats, .glb meshes) referenced via media_assets.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Identity, RBAC & Sessions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  name TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'buyer'
    CHECK (role IN ('super_admin', 'admin', 'operations', 'broker', 'technician', 'seller', 'buyer', 'user')),
  kyc_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (kyc_status IN ('unverified', 'pending', 'verified', 'rejected')),
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url TEXT,
  preferences TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON users (kyc_status);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- ----------------------------------------------------------------------------
-- 2. Properties Catalog & Structured Real Estate Facets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  author_uid TEXT,
  title TEXT NOT NULL,
  description TEXT,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  location TEXT NOT NULL,
  compound TEXT,
  developer TEXT,
  property_type TEXT,
  bedrooms INT NOT NULL DEFAULT 0,
  bathrooms INT NOT NULL DEFAULT 0,
  area DOUBLE PRECISION NOT NULL DEFAULT 0,
  area_to DOUBLE PRECISION,
  garden_area DOUBLE PRECISION,
  roof_area DOUBLE PRECISION,
  floor TEXT,
  finishing TEXT,
  view_desc TEXT,
  furnished BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_date TEXT,
  delivery_timeline TEXT,
  status TEXT NOT NULL DEFAULT 'For Sale',
  availability TEXT NOT NULL DEFAULT 'Available',
  listing_state TEXT NOT NULL DEFAULT 'Live',
  lifecycle_status TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status TEXT NOT NULL DEFAULT 'Pending',
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  review_note TEXT,
  rejected_at TIMESTAMPTZ,
  image_url TEXT,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  panoramas JSONB NOT NULL DEFAULT '[]'::jsonb,
  floor_plan_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  depth_maps JSONB NOT NULL DEFAULT '[]'::jsonb,
  video_url TEXT,
  digital_twin_url TEXT,
  three_d_tour JSONB,
  payment_plans JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  trust_matrix JSONB,
  granular_verification JSONB,
  registration_number TEXT,
  court_signature_validity BOOLEAN NOT NULL DEFAULT FALSE,
  is_resale BOOLEAN NOT NULL DEFAULT FALSE,
  yalla_sahel BOOLEAN NOT NULL DEFAULT FALSE,
  village TEXT,
  contact_phone TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  unit_code TEXT,
  unit_model TEXT,
  building_type TEXT,
  floors_description TEXT,
  maintenance_fee DOUBLE PRECISION,
  phase TEXT,
  project_area_feddan DOUBLE PRECISION,
  green_space_percent DOUBLE PRECISION,
  financing JSONB NOT NULL DEFAULT '[]'::jsonb,
  master_plan_url TEXT,
  legal_docs JSONB NOT NULL DEFAULT '[]'::jsonb,
  publish_date TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_location ON properties (location);
CREATE INDEX IF NOT EXISTS idx_properties_price ON properties (price);
CREATE INDEX IF NOT EXISTS idx_properties_property_type ON properties (property_type);
CREATE INDEX IF NOT EXISTS idx_properties_compound ON properties (compound);
CREATE INDEX IF NOT EXISTS idx_properties_developer ON properties (developer);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties (status);
CREATE INDEX IF NOT EXISTS idx_properties_listing_state ON properties (listing_state);
CREATE INDEX IF NOT EXISTS idx_properties_verification_status ON properties (verification_status);
CREATE INDEX IF NOT EXISTS idx_properties_is_verified ON properties (is_verified);
CREATE INDEX IF NOT EXISTS idx_properties_yalla_sahel ON properties (yalla_sahel);
CREATE INDEX IF NOT EXISTS idx_properties_author_uid ON properties (author_uid);
CREATE INDEX IF NOT EXISTS idx_properties_created_at_desc ON properties (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_properties_amenities_gin ON properties USING GIN (amenities);
CREATE INDEX IF NOT EXISTS idx_properties_raw_payload_gin ON properties USING GIN (raw_payload);

-- ----------------------------------------------------------------------------
-- 3. Hybrid Media Asset Registry (Object Storage References)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
  owner_uid TEXT,
  asset_type TEXT,
  storage_provider TEXT NOT NULL DEFAULT 'cloudflare_r2',
  storage_key TEXT,
  public_url TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_property_id ON media_assets (property_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_owner_uid ON media_assets (owner_uid);
CREATE INDEX IF NOT EXISTS idx_media_assets_asset_type ON media_assets (asset_type);

-- ----------------------------------------------------------------------------
-- 4. 3D Spatial Reconstruction Pipeline Control Plane
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reconstruction_jobs (
  id TEXT PRIMARY KEY,
  property_id TEXT,
  owner_id TEXT,
  job_type TEXT,
  status TEXT,
  attempt_id TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  progress INT NOT NULL DEFAULT 0,
  stage TEXT,
  worker_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconstruction_jobs_property_id ON reconstruction_jobs (property_id);
CREATE INDEX IF NOT EXISTS idx_reconstruction_jobs_owner_id ON reconstruction_jobs (owner_id);
CREATE INDEX IF NOT EXISTS idx_reconstruction_jobs_status ON reconstruction_jobs (status);
CREATE INDEX IF NOT EXISTS idx_reconstruction_jobs_updated_at_desc ON reconstruction_jobs (updated_at DESC);

-- ----------------------------------------------------------------------------
-- 5. ACID Escrow Transactions & Purchases
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  property_id TEXT,
  property_title TEXT,
  buyer_id TEXT,
  seller_id TEXT,
  agent_id TEXT,
  agreed_price DOUBLE PRECISION,
  currency TEXT NOT NULL DEFAULT 'EGP',
  deposit_amount DOUBLE PRECISION,
  status TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_property_id ON transactions (property_id);
CREATE INDEX IF NOT EXISTS idx_transactions_buyer_id ON transactions (buyer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_seller_id ON transactions (seller_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);
CREATE INDEX IF NOT EXISTS idx_transactions_updated_at_desc ON transactions (updated_at DESC);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  property_id TEXT,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchases_property_id ON purchases (property_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON purchases (user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases (status);

-- ----------------------------------------------------------------------------
-- 6. Legal Documents Vault
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_documents (
  id TEXT PRIMARY KEY,
  owner_uid TEXT,
  name TEXT NOT NULL,
  type TEXT,
  review_status TEXT NOT NULL DEFAULT 'Uploaded',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  storage_path TEXT,
  content TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  upload_date TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_documents_owner_uid ON user_documents (owner_uid);
CREATE INDEX IF NOT EXISTS idx_user_documents_review_status ON user_documents (review_status);

-- ----------------------------------------------------------------------------
-- 7. AI Advisor Sessions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_updated_desc ON chat_sessions (last_updated_at DESC);

-- ----------------------------------------------------------------------------
-- 8. CRM Leads & Viewing Appointments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_leads (
  id TEXT PRIMARY KEY,
  property_id TEXT,
  buyer_id TEXT,
  buyer_name TEXT,
  buyer_phone TEXT,
  agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_property_id ON crm_leads (property_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_agent_id ON crm_leads (agent_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON crm_leads (status);

CREATE TABLE IF NOT EXISTS viewing_appointments (
  id TEXT PRIMARY KEY,
  property_id TEXT,
  buyer_id TEXT,
  agent_id TEXT,
  visit_type TEXT NOT NULL DEFAULT 'in_person',
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_viewing_appointments_property_id ON viewing_appointments (property_id);
CREATE INDEX IF NOT EXISTS idx_viewing_appointments_buyer_id ON viewing_appointments (buyer_id);
CREATE INDEX IF NOT EXISTS idx_viewing_appointments_agent_id ON viewing_appointments (agent_id);
CREATE INDEX IF NOT EXISTS idx_viewing_appointments_scheduled_at ON viewing_appointments (scheduled_at);

-- ----------------------------------------------------------------------------
-- 9. Notifications, Community Reviews, Moderation Reports & Inbox
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  message TEXT,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, read);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  user_id TEXT,
  rating INT,
  comment TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_property_id ON reviews (property_id);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  property_id TEXT,
  reporter_id TEXT,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_property_id ON reports (property_id);

CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id TEXT PRIMARY KEY,
  email TEXT,
  user_id TEXT,
  criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_email ON alert_subscriptions (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_user_id ON alert_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 10. Immutable Audit Logs, Distributed Rate Limiting & Platform Settings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  summary TEXT,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_desc ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs (actor_id);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  timestamps BIGINT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_updated_at ON rate_limit_buckets (updated_at);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default platform configuration (idempotent)
INSERT INTO system_settings (setting_key, value, updated_by)
VALUES (
  'platform_config',
  '{
    "maintenanceMode": false,
    "allowPublicRegistration": true,
    "requireAdminApprovalForListings": true,
    "enable3DReconstructionPipeline": true,
    "enableAiAdvisor": true,
    "defaultCurrency": "EGP",
    "storageProvider": "cloudflare_r2",
    "maxUploadImagesPerProperty": 25,
    "seoSiteTitle": "HETTETY | حتتي — Luxury Real Estate & 3D Spatial Discovery in Egypt",
    "seoDefaultDescription": "Verified luxury properties, compounds, coastal residences, and interactive 3D digital twins across Egypt."
  }'::jsonb,
  'system_bootstrap'
)
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
