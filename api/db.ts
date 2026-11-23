/**
 * HETTETY v4 — Neon Serverless PostgreSQL Parameterized CRUD Data Plane (/api/db)
 *
 * Security Invariants:
 *   1. Strict static allowlist of tables — zero dynamic SQL identifier interpolation.
 *   2. Parameterized queries everywhere (`$1`, `$2`, ... or tagged template literals).
 *   3. Server-enforced authentication, RBAC, and record ownership checks per table.
 *   4. Password hashes are NEVER returned by any read path.
 *   5. Non-admins cannot self-verify properties, self-approve documents, or elevate roles.
 *   6. Fails closed (HTTP 503) in production when Neon DATABASE_URL is absent.
 */

import crypto from 'crypto';
import type { Property, UserDocument, Notification, ChatSession } from '../src/types.js';
import type { UserAccountRecord } from '../src/core/domain/entities.js';
import {
  isNeonConfigured,
  getNeonSql,
  ensureNeonSchema,
  devMemoryStore,
} from './_lib/neon.js';
import {
  verifyAuthHeaderAsync,
  resolveEffectiveRole,
  normalizeEmail,
  getQueryParams,
  getJsonBody,
  type VerifiedAuthUser,
} from './_lib/auth.js';

export type CanonicalTable =
  | 'properties'
  | 'users'
  | 'user_documents'
  | 'purchases'
  | 'chat_sessions'
  | 'notifications'
  | 'reviews'
  | 'reports'
  | 'alert_subscriptions'
  | 'contact_messages'
  | 'crm_leads'
  | 'viewing_appointments';

const TABLE_ALIASES: Record<string, CanonicalTable> = {
  properties: 'properties',
  users: 'users',
  user_documents: 'user_documents',
  userDocuments: 'user_documents',
  purchases: 'purchases',
  chat_sessions: 'chat_sessions',
  chatSessions: 'chat_sessions',
  notifications: 'notifications',
  reviews: 'reviews',
  reports: 'reports',
  alertSubscriptions: 'alert_subscriptions',
  alert_subscriptions: 'alert_subscriptions',
  contactMessages: 'contact_messages',
  contact_messages: 'contact_messages',
  crm_leads: 'crm_leads',
  crmLeads: 'crm_leads',
  viewing_appointments: 'viewing_appointments',
  viewingAppointments: 'viewing_appointments',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toIso(val: unknown): string | undefined {
  if (!val) return undefined;
  if (val instanceof Date) return val.toISOString();
  const str = String(val);
  return str || undefined;
}

function asArray<T = any>(val: unknown): T[] {
  return Array.isArray(val) ? val : [];
}

// ----------------------------------------------------------------------------
// Lossless Row <-> Domain Mappers (Shared with api/admin.ts)
// ----------------------------------------------------------------------------

export function mapPropertyRowToDomain(row: Record<string, any>): Property {
  const raw = row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
  return {
    ...raw,
    id: String(row.id),
    authorUid: row.author_uid ?? raw.authorUid ?? undefined,
    title: String(row.title ?? raw.title ?? ''),
    description: row.description ?? raw.description ?? undefined,
    price: Number(row.price ?? raw.price ?? 0),
    currency: (row.currency ?? raw.currency ?? 'EGP') as 'EGP' | 'USD',
    location: String(row.location ?? raw.location ?? ''),
    compound: row.compound ?? raw.compound ?? undefined,
    developer: row.developer ?? raw.developer ?? undefined,
    propertyType: row.property_type ?? raw.propertyType ?? undefined,
    bedrooms: Number(row.bedrooms ?? raw.bedrooms ?? 0),
    bathrooms: Number(row.bathrooms ?? raw.bathrooms ?? 0),
    area: Number(row.area ?? raw.area ?? 0),
    areaTo: row.area_to != null ? Number(row.area_to) : raw.areaTo,
    gardenArea: row.garden_area != null ? Number(row.garden_area) : raw.gardenArea,
    roofArea: row.roof_area != null ? Number(row.roof_area) : raw.roofArea,
    floor: row.floor ?? raw.floor ?? undefined,
    finishing: row.finishing ?? raw.finishing ?? undefined,
    view: row.view_desc ?? raw.view ?? undefined,
    furnished: Boolean(row.furnished ?? raw.furnished ?? false),
    deliveryDate: row.delivery_date ?? raw.deliveryDate ?? undefined,
    deliveryTimeline: row.delivery_timeline ?? raw.deliveryTimeline ?? undefined,
    status: (row.status ?? raw.status ?? 'For Sale') as 'For Sale' | 'For Rent',
    availability: (row.availability ?? raw.availability ?? 'Available') as 'Available' | 'Sold' | 'Reserved',
    listingState: (row.listing_state ?? raw.listingState ?? 'Live') as 'Draft' | 'Live' | 'Removed',
    lifecycleStatus: row.lifecycle_status ?? raw.lifecycleStatus ?? undefined,
    isVerified: Boolean(row.is_verified ?? raw.isVerified ?? false),
    verificationStatus: (row.verification_status ?? raw.verificationStatus ?? 'Pending') as
      | 'Pending'
      | 'Verified'
      | 'Rejected',
    verifiedBy: row.verified_by ?? raw.verifiedBy ?? undefined,
    verifiedAt: toIso(row.verified_at) ?? raw.verifiedAt ?? undefined,
    reviewNote: row.review_note ?? raw.reviewNote ?? undefined,
    rejectedAt: toIso(row.rejected_at) ?? raw.rejectedAt ?? undefined,
    imageUrl: String(row.image_url ?? raw.imageUrl ?? ''),
    images: asArray<string>(row.images ?? raw.images),
    panoramas: asArray<string>(row.panoramas ?? raw.panoramas),
    floorPlanUrls: asArray<string>(row.floor_plan_urls ?? raw.floorPlanUrls),
    depthMaps: asArray<string>(row.depth_maps ?? raw.depthMaps),
    videoUrl: row.video_url ?? raw.videoUrl ?? undefined,
    digitalTwinUrl: row.digital_twin_url ?? raw.digitalTwinUrl ?? undefined,
    threeDTour: row.three_d_tour ?? raw.threeDTour ?? undefined,
    paymentPlans: asArray(row.payment_plans ?? raw.paymentPlans),
    paymentMethods: asArray<string>(row.payment_methods ?? raw.paymentMethods),
    amenities: asArray<string>(row.amenities ?? raw.amenities),
    trustMatrix: row.trust_matrix ?? raw.trustMatrix ?? undefined,
    granularVerification: row.granular_verification ?? raw.granularVerification ?? undefined,
    registrationNumber: row.registration_number ?? raw.registrationNumber ?? undefined,
    courtSignatureValidity: Boolean(row.court_signature_validity ?? raw.courtSignatureValidity ?? false),
    isResale: Boolean(row.is_resale ?? raw.isResale ?? false),
    yallaSahel: Boolean(row.yalla_sahel ?? raw.yallaSahel ?? false),
    village: row.village ?? raw.village ?? undefined,
    contactPhone: row.contact_phone ?? raw.contactPhone ?? undefined,
    lat: row.lat != null ? Number(row.lat) : raw.lat,
    lng: row.lng != null ? Number(row.lng) : raw.lng,
    unitCode: row.unit_code ?? raw.unitCode ?? undefined,
    unitModel: row.unit_model ?? raw.unitModel ?? undefined,
    buildingType: row.building_type ?? raw.buildingType ?? undefined,
    floorsDescription: row.floors_description ?? raw.floorsDescription ?? undefined,
    maintenanceFee: row.maintenance_fee != null ? Number(row.maintenance_fee) : raw.maintenanceFee,
    phase: row.phase ?? raw.phase ?? undefined,
    projectAreaFeddan: row.project_area_feddan != null ? Number(row.project_area_feddan) : raw.projectAreaFeddan,
    greenSpacePercent: row.green_space_percent != null ? Number(row.green_space_percent) : raw.greenSpacePercent,
    financing: asArray<string>(row.financing ?? raw.financing),
    masterPlanUrl: row.master_plan_url ?? raw.masterPlanUrl ?? undefined,
    legalDocs: asArray<string>(row.legal_docs ?? raw.legalDocs),
    publishDate: row.publish_date ?? raw.publishDate ?? toIso(row.created_at),
  };
}

export function mapUserRowToDomain(row: Record<string, any>): UserAccountRecord {
  const email = normalizeEmail(row.email || '');
  const role = resolveEffectiveRole(email, row.role);
  return {
    id: String(row.id),
    uid: String(row.id),
    email,
    name: String(row.name || email.split('@')[0] || 'User'),
    phone: row.phone ? String(row.phone) : '',
    role,
    kycStatus: (row.kyc_status || row.kycStatus || 'unverified') as UserAccountRecord['kycStatus'],
    isSuspended: Boolean(row.is_suspended ?? row.isSuspended ?? false),
    avatarUrl: row.avatar_url || row.avatarUrl || undefined,
    preferences: String(row.preferences || ''),
    createdAt: toIso(row.created_at) || row.createdAt,
    lastLoginAt: toIso(row.last_login_at) || row.lastLoginAt,
  };
}

export function mapDocumentRowToDomain(row: Record<string, any>): UserDocument {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: String(row.id),
    ownerUid: String(row.owner_uid ?? payload.ownerUid ?? ''),
    name: String(row.name ?? payload.name ?? ''),
    type: String(row.type ?? payload.type ?? 'document'),
    reviewStatus: (row.review_status ?? payload.reviewStatus ?? 'Uploaded') as UserDocument['reviewStatus'],
    reviewedBy: row.reviewed_by ?? payload.reviewedBy ?? undefined,
    reviewedAt: toIso(row.reviewed_at) ?? payload.reviewedAt ?? undefined,
    reviewNote: row.review_note ?? payload.reviewNote ?? undefined,
    storagePath: row.storage_path ?? payload.storagePath ?? undefined,
    content: row.content ?? payload.content ?? undefined,
    size: Number(row.size_bytes ?? payload.size ?? 0),
    uploadDate: String(row.upload_date ?? payload.uploadDate ?? toIso(row.created_at) ?? new Date().toISOString()),
  };
}

export function mapPurchaseRowToDomain(row: Record<string, any>): Record<string, any> {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: String(row.id),
    propertyId: row.property_id ?? payload.propertyId ?? '',
    userId: row.user_id ?? payload.userId ?? '',
    status: String(row.status ?? payload.status ?? 'processing'),
    purchaseDate: payload.purchaseDate || toIso(row.created_at) || new Date().toISOString(),
    createdAt: toIso(row.created_at) || payload.createdAt,
  };
}

export function mapChatSessionRowToDomain(row: Record<string, any>): ChatSession {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId ?? ''),
    title: String(row.title ?? 'Chat'),
    messages: asArray(row.messages),
    lastUpdatedAt: toIso(row.last_updated_at) || row.lastUpdatedAt || new Date().toISOString(),
  };
}

export function mapNotificationRowToDomain(row: Record<string, any>): Notification {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId ?? ''),
    title: String(row.title ?? ''),
    message: String(row.message ?? ''),
    read: Boolean(row.read ?? false),
    date: String(row.date ?? toIso(row.created_at) ?? new Date().toISOString()),
  };
}

export function mapReviewRowToDomain(row: Record<string, any>): Record<string, any> {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: String(row.id),
    propertyId: String(row.property_id ?? payload.propertyId ?? ''),
    userId: row.user_id ?? payload.userId ?? undefined,
    rating: Number(row.rating ?? payload.rating ?? 5),
    comment: String(row.comment ?? payload.comment ?? ''),
    createdAt: toIso(row.created_at) || payload.createdAt,
  };
}

export function mapReportRowToDomain(row: Record<string, any>): Record<string, any> {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: String(row.id),
    propertyId: row.property_id ?? payload.propertyId ?? undefined,
    reporterId: row.reporter_id ?? payload.reporterId ?? undefined,
    reason: String(row.reason ?? payload.reason ?? ''),
    createdAt: toIso(row.created_at) || payload.createdAt,
  };
}

export function mapAlertRowToDomain(row: Record<string, any>): Record<string, any> {
  return {
    id: String(row.id),
    email: String(row.email ?? ''),
    userId: row.user_id ?? undefined,
    criteria: row.criteria && typeof row.criteria === 'object' ? row.criteria : {},
    createdAt: toIso(row.created_at),
  };
}

export function mapContactRowToDomain(row: Record<string, any>): Record<string, any> {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: String(row.id),
    name: String(row.name ?? payload.name ?? ''),
    email: String(row.email ?? payload.email ?? ''),
    message: String(row.message ?? payload.message ?? ''),
    createdAt: toIso(row.created_at) || payload.createdAt,
  };
}

export function mapLeadRowToDomain(row: Record<string, any>): Record<string, any> {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: String(row.id),
    propertyId: row.property_id ?? payload.propertyId ?? '',
    buyerId: row.buyer_id ?? payload.buyerId ?? undefined,
    buyerName: row.buyer_name ?? payload.buyerName ?? '',
    buyerPhone: row.buyer_phone ?? payload.buyerPhone ?? '',
    agentId: row.agent_id ?? payload.agentId ?? undefined,
    status: String(row.status ?? payload.status ?? 'new'),
    notes: row.notes ?? payload.notes ?? '',
    createdAt: toIso(row.created_at) || payload.createdAt,
  };
}

export function mapViewingRowToDomain(row: Record<string, any>): Record<string, any> {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: String(row.id),
    propertyId: row.property_id ?? payload.propertyId ?? '',
    buyerId: row.buyer_id ?? payload.buyerId ?? undefined,
    agentId: row.agent_id ?? payload.agentId ?? undefined,
    visitType: String(row.visit_type ?? payload.visitType ?? 'in_person'),
    scheduledAt: toIso(row.scheduled_at) ?? payload.scheduledAt ?? undefined,
    status: String(row.status ?? payload.status ?? 'scheduled'),
    createdAt: toIso(row.created_at) || payload.createdAt,
  };
}

function getDevTableMap(table: CanonicalTable): Map<string, Record<string, any>> {
  return devMemoryStore[table] as Map<string, Record<string, any>>;
}

function stripAdminOnlyPropertyFields(data: Record<string, any>, isAdmin: boolean): Record<string, any> {
  if (isAdmin) return { ...data };
  const safe = { ...data };
  delete safe.isVerified;
  delete safe.verificationStatus;
  delete safe.verifiedBy;
  delete safe.verifiedAt;
  delete safe.reviewNote;
  delete safe.rejectedAt;
  return safe;
}

function stripAdminOnlyDocumentFields(data: Record<string, any>, isAdmin: boolean): Record<string, any> {
  if (isAdmin) return { ...data };
  const safe = { ...data };
  delete safe.reviewStatus;
  delete safe.reviewedBy;
  delete safe.reviewedAt;
  delete safe.reviewNote;
  return safe;
}

async function fetchRecordById(table: CanonicalTable, id: string): Promise<Record<string, any> | null> {
  if (!isNeonConfigured()) {
    return getDevTableMap(table).get(id) || null;
  }
  await ensureNeonSchema();
  const sql = getNeonSql();
  let rows: Record<string, any>[];
  switch (table) {
    case 'properties':
      rows = (await sql`SELECT * FROM properties WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapPropertyRowToDomain(rows[0]) : null;
    case 'users':
      rows = (await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapUserRowToDomain(rows[0]) : null;
    case 'user_documents':
      rows = (await sql`SELECT * FROM user_documents WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapDocumentRowToDomain(rows[0]) : null;
    case 'purchases':
      rows = (await sql`SELECT * FROM purchases WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapPurchaseRowToDomain(rows[0]) : null;
    case 'chat_sessions':
      rows = (await sql`SELECT * FROM chat_sessions WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapChatSessionRowToDomain(rows[0]) : null;
    case 'notifications':
      rows = (await sql`SELECT * FROM notifications WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapNotificationRowToDomain(rows[0]) : null;
    case 'reviews':
      rows = (await sql`SELECT * FROM reviews WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapReviewRowToDomain(rows[0]) : null;
    case 'reports':
      rows = (await sql`SELECT * FROM reports WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapReportRowToDomain(rows[0]) : null;
    case 'alert_subscriptions':
      rows = (await sql`SELECT * FROM alert_subscriptions WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapAlertRowToDomain(rows[0]) : null;
    case 'contact_messages':
      rows = (await sql`SELECT * FROM contact_messages WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapContactRowToDomain(rows[0]) : null;
    case 'crm_leads':
      rows = (await sql`SELECT * FROM crm_leads WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapLeadRowToDomain(rows[0]) : null;
    case 'viewing_appointments':
      rows = (await sql`SELECT * FROM viewing_appointments WHERE id = ${id} LIMIT 1`) as Record<string, any>[];
      return rows[0] ? mapViewingRowToDomain(rows[0]) : null;
  }
}

async function upsertPropertyNeon(prop: Record<string, any>): Promise<Property> {
  await ensureNeonSchema();
  const sql = getNeonSql();
  const rows = (await sql`
    INSERT INTO properties (
      id, author_uid, title, description, price, currency, location, compound, developer,
      property_type, bedrooms, bathrooms, area, area_to, garden_area, roof_area, floor,
      finishing, view_desc, furnished, delivery_date, delivery_timeline, status, availability,
      listing_state, lifecycle_status, is_verified, verification_status, verified_by, verified_at,
      review_note, rejected_at, image_url, images, panoramas, floor_plan_urls, depth_maps,
      video_url, digital_twin_url, three_d_tour, payment_plans, payment_methods, amenities,
      trust_matrix, granular_verification, registration_number, court_signature_validity,
      is_resale, yalla_sahel, village, contact_phone, lat, lng, unit_code, unit_model,
      building_type, floors_description, maintenance_fee, phase, project_area_feddan,
      green_space_percent, financing, master_plan_url, legal_docs, publish_date, raw_payload,
      updated_at
    )
    VALUES (
      ${prop.id},
      ${prop.authorUid || null},
      ${String(prop.title || 'Untitled Property').slice(0, 250)},
      ${prop.description ?? null},
      ${Number(prop.price || 0)},
      ${prop.currency || 'EGP'},
      ${String(prop.location || 'Egypt').slice(0, 200)},
      ${prop.compound ?? null},
      ${prop.developer ?? null},
      ${prop.propertyType ?? null},
      ${Number(prop.bedrooms || 0)},
      ${Number(prop.bathrooms || 0)},
      ${Number(prop.area || 0)},
      ${prop.areaTo != null ? Number(prop.areaTo) : null},
      ${prop.gardenArea != null ? Number(prop.gardenArea) : null},
      ${prop.roofArea != null ? Number(prop.roofArea) : null},
      ${prop.floor ?? null},
      ${prop.finishing ?? null},
      ${prop.view ?? null},
      ${Boolean(prop.furnished ?? false)},
      ${prop.deliveryDate ?? null},
      ${prop.deliveryTimeline ?? null},
      ${prop.status || 'For Sale'},
      ${prop.availability || 'Available'},
      ${prop.listingState || 'Live'},
      ${prop.lifecycleStatus ?? null},
      ${Boolean(prop.isVerified ?? false)},
      ${prop.verificationStatus || 'Pending'},
      ${prop.verifiedBy ?? null},
      ${prop.verifiedAt ? new Date(prop.verifiedAt).toISOString() : null}::timestamptz,
      ${prop.reviewNote ?? null},
      ${prop.rejectedAt ? new Date(prop.rejectedAt).toISOString() : null}::timestamptz,
      ${prop.imageUrl || ''},
      ${JSON.stringify(asArray(prop.images))}::jsonb,
      ${JSON.stringify(asArray(prop.panoramas))}::jsonb,
      ${JSON.stringify(asArray(prop.floorPlanUrls))}::jsonb,
      ${JSON.stringify(asArray(prop.depthMaps))}::jsonb,
      ${prop.videoUrl ?? null},
      ${prop.digitalTwinUrl ?? null},
      ${prop.threeDTour ? JSON.stringify(prop.threeDTour) : null}::jsonb,
      ${JSON.stringify(asArray(prop.paymentPlans))}::jsonb,
      ${JSON.stringify(asArray(prop.paymentMethods))}::jsonb,
      ${JSON.stringify(asArray(prop.amenities))}::jsonb,
      ${prop.trustMatrix ? JSON.stringify(prop.trustMatrix) : null}::jsonb,
      ${prop.granularVerification ? JSON.stringify(prop.granularVerification) : null}::jsonb,
      ${prop.registrationNumber ?? null},
      ${Boolean(prop.courtSignatureValidity ?? false)},
      ${Boolean(prop.isResale ?? false)},
      ${Boolean(prop.yallaSahel ?? false)},
      ${prop.village ?? null},
      ${prop.contactPhone ?? null},
      ${prop.lat != null ? Number(prop.lat) : null},
      ${prop.lng != null ? Number(prop.lng) : null},
      ${prop.unitCode ?? null},
      ${prop.unitModel ?? null},
      ${prop.buildingType ?? null},
      ${prop.floorsDescription ?? null},
      ${prop.maintenanceFee != null ? Number(prop.maintenanceFee) : null},
      ${prop.phase ?? null},
      ${prop.projectAreaFeddan != null ? Number(prop.projectAreaFeddan) : null},
      ${prop.greenSpacePercent != null ? Number(prop.greenSpacePercent) : null},
      ${JSON.stringify(asArray(prop.financing))}::jsonb,
      ${prop.masterPlanUrl ?? null},
      ${JSON.stringify(asArray(prop.legalDocs))}::jsonb,
      ${prop.publishDate || new Date().toISOString()},
      ${JSON.stringify(prop)}::jsonb,
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      author_uid = EXCLUDED.author_uid,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      location = EXCLUDED.location,
      compound = EXCLUDED.compound,
      developer = EXCLUDED.developer,
      property_type = EXCLUDED.property_type,
      bedrooms = EXCLUDED.bedrooms,
      bathrooms = EXCLUDED.bathrooms,
      area = EXCLUDED.area,
      area_to = EXCLUDED.area_to,
      garden_area = EXCLUDED.garden_area,
      roof_area = EXCLUDED.roof_area,
      floor = EXCLUDED.floor,
      finishing = EXCLUDED.finishing,
      view_desc = EXCLUDED.view_desc,
      furnished = EXCLUDED.furnished,
      delivery_date = EXCLUDED.delivery_date,
      delivery_timeline = EXCLUDED.delivery_timeline,
      status = EXCLUDED.status,
      availability = EXCLUDED.availability,
      listing_state = EXCLUDED.listing_state,
      lifecycle_status = EXCLUDED.lifecycle_status,
      is_verified = EXCLUDED.is_verified,
      verification_status = EXCLUDED.verification_status,
      verified_by = EXCLUDED.verified_by,
      verified_at = EXCLUDED.verified_at,
      review_note = EXCLUDED.review_note,
      rejected_at = EXCLUDED.rejected_at,
      image_url = EXCLUDED.image_url,
      images = EXCLUDED.images,
      panoramas = EXCLUDED.panoramas,
      floor_plan_urls = EXCLUDED.floor_plan_urls,
      depth_maps = EXCLUDED.depth_maps,
      video_url = EXCLUDED.video_url,
      digital_twin_url = EXCLUDED.digital_twin_url,
      three_d_tour = EXCLUDED.three_d_tour,
      payment_plans = EXCLUDED.payment_plans,
      payment_methods = EXCLUDED.payment_methods,
      amenities = EXCLUDED.amenities,
      trust_matrix = EXCLUDED.trust_matrix,
      granular_verification = EXCLUDED.granular_verification,
      registration_number = EXCLUDED.registration_number,
      court_signature_validity = EXCLUDED.court_signature_validity,
      is_resale = EXCLUDED.is_resale,
      yalla_sahel = EXCLUDED.yalla_sahel,
      village = EXCLUDED.village,
      contact_phone = EXCLUDED.contact_phone,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      unit_code = EXCLUDED.unit_code,
      unit_model = EXCLUDED.unit_model,
      building_type = EXCLUDED.building_type,
      floors_description = EXCLUDED.floors_description,
      maintenance_fee = EXCLUDED.maintenance_fee,
      phase = EXCLUDED.phase,
      project_area_feddan = EXCLUDED.project_area_feddan,
      green_space_percent = EXCLUDED.green_space_percent,
      financing = EXCLUDED.financing,
      master_plan_url = EXCLUDED.master_plan_url,
      legal_docs = EXCLUDED.legal_docs,
      publish_date = EXCLUDED.publish_date,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING *
  `) as Record<string, any>[];

  return mapPropertyRowToDomain(rows[0]);
}

function assertOwnerOrAdmin(
  table: CanonicalTable,
  record: Record<string, any>,
  auth: VerifiedAuthUser
): boolean {
  if (auth.isAdmin) return true;
  switch (table) {
    case 'properties':
      return record.authorUid === auth.uid;
    case 'users':
      return record.id === auth.uid;
    case 'user_documents':
      return record.ownerUid === auth.uid;
    case 'purchases':
    case 'chat_sessions':
    case 'notifications':
    case 'reviews':
    case 'alert_subscriptions':
      return record.userId === auth.uid;
    case 'reports':
      return record.reporterId === auth.uid;
    case 'crm_leads':
    case 'viewing_appointments':
      return record.agentId === auth.uid || record.buyerId === auth.uid;
    case 'contact_messages':
      return false;
  }
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader?.('Allow', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.NODE_ENV === 'production' && !isNeonConfigured()) {
    return res.status(503).json({
      error: 'DATABASE_NOT_CONFIGURED: Neon DATABASE_URL is required in production.',
    });
  }

  const query = getQueryParams(req);
  const body = getJsonBody(req);
  const rawTable = String(query.table || body.table || '').trim();
  const table = TABLE_ALIASES[rawTable];

  if (!table) {
    return res.status(400).json({
      error: `INVALID_TABLE: '${rawTable || '(empty)'}' is not an allowlisted data table.`,
    });
  }

  // Determine canonical operation
  const explicitAction = String(query.action || body.action || '').trim().toLowerCase();
  const recordId = String(query.id || body.id || body.data?.id || '').trim();
  let op: 'list' | 'get' | 'create' | 'update' | 'delete';

  if (explicitAction === 'list' || explicitAction === 'get' || explicitAction === 'create' || explicitAction === 'update' || explicitAction === 'upsert' || explicitAction === 'delete') {
    op = explicitAction === 'upsert' ? (recordId ? 'update' : 'create') : explicitAction;
  } else if (req.method === 'GET') {
    op = recordId ? 'get' : 'list';
  } else if (req.method === 'POST') {
    op = 'create';
  } else if (req.method === 'PATCH' || req.method === 'PUT') {
    op = 'update';
  } else {
    op = 'delete';
  }

  const auth = await verifyAuthHeaderAsync(req);

  try {
    // ========================================================================
    // READ OPERATIONS (LIST / GET)
    // ========================================================================
    if (op === 'list' || op === 'get') {
      const isPublicReadTable = table === 'properties' || table === 'reviews';
      if (!isPublicReadTable && !auth) {
        return res.status(401).json({ error: 'UNAUTHORIZED: Authentication required to read this table.' });
      }
      if (table === 'contact_messages' && !auth?.isAdmin) {
        return res.status(403).json({ error: 'FORBIDDEN: Admin privileges required.' });
      }

      if (op === 'get') {
        if (!recordId) return res.status(400).json({ error: 'INVALID_REQUEST: id is required.' });
        const item = await fetchRecordById(table, recordId);
        if (!item) return res.status(404).json({ error: 'NOT_FOUND' });

        if (!isPublicReadTable && auth && !assertOwnerOrAdmin(table, item, auth)) {
          return res.status(403).json({ error: 'FORBIDDEN: Not authorized to read this record.' });
        }
        if (table === 'properties' && item.listingState === 'Removed' && !auth?.isAdmin && item.authorUid !== auth?.uid) {
          return res.status(404).json({ error: 'NOT_FOUND' });
        }

        return res.status(200).json({ success: true, item, data: item });
      }

      // LIST operation
      const filters = (body.filters && typeof body.filters === 'object' ? body.filters : query) as Record<string, string>;
      const limit = Math.min(500, Math.max(1, Number(filters.limit || 200)));

      if (!isNeonConfigured()) {
        let items = Array.from(getDevTableMap(table).values());
        if (table === 'users') {
          items = items.map(mapUserRowToDomain);
        }
        if (!isPublicReadTable && auth && !auth.isAdmin) {
          items = items.filter((item) => assertOwnerOrAdmin(table, item, auth));
        }
        if (table === 'properties') {
          items = items.filter((p) =>
            p.listingState !== 'Removed' || auth?.isAdmin || (auth && p.authorUid === auth.uid)
          );
          if (filters.authorUid) items = items.filter((p) => p.authorUid === filters.authorUid);
          if (filters.status) items = items.filter((p) => p.status === filters.status);
          if (filters.yallaSahel === 'true') items = items.filter((p) => Boolean(p.yallaSahel));
        }
        if (table === 'reviews' && filters.propertyId) {
          items = items.filter((r) => r.propertyId === filters.propertyId);
        }
        items = items.slice(0, limit);
        return res.status(200).json({ success: true, items, data: items, count: items.length });
      }

      await ensureNeonSchema();
      const sql = getNeonSql();
      let items: any[] = [];

      switch (table) {
        case 'properties': {
          const rows = (await sql`
            SELECT * FROM properties
            ORDER BY created_at DESC
            LIMIT ${limit}
          `) as Record<string, any>[];
          items = rows
            .map(mapPropertyRowToDomain)
            .filter((p) => {
              if (p.listingState === 'Removed' && !auth?.isAdmin && (!auth || p.authorUid !== auth.uid)) {
                return false;
              }
              if (filters.authorUid && p.authorUid !== filters.authorUid) return false;
              if (filters.status && p.status !== filters.status) return false;
              if (filters.yallaSahel === 'true' && !p.yallaSahel) return false;
              if (filters.location && !p.location.toLowerCase().includes(filters.location.toLowerCase())) {
                return false;
              }
              return true;
            });
          break;
        }
        case 'users': {
          const rows = (auth!.isAdmin
            ? await sql`SELECT * FROM users ORDER BY created_at DESC LIMIT ${limit}`
            : await sql`SELECT * FROM users WHERE id = ${auth!.uid} LIMIT 1`) as Record<string, any>[];
          items = rows.map(mapUserRowToDomain);
          break;
        }
        case 'user_documents': {
          const rows = (auth!.isAdmin
            ? await sql`SELECT * FROM user_documents ORDER BY created_at DESC LIMIT ${limit}`
            : await sql`SELECT * FROM user_documents WHERE owner_uid = ${auth!.uid} ORDER BY created_at DESC LIMIT ${limit}`) as Record<string, any>[];
          items = rows.map(mapDocumentRowToDomain);
          break;
        }
        case 'purchases': {
          const rows = (auth!.isAdmin
            ? await sql`SELECT * FROM purchases ORDER BY created_at DESC LIMIT ${limit}`
            : await sql`SELECT * FROM purchases WHERE user_id = ${auth!.uid} ORDER BY created_at DESC LIMIT ${limit}`) as Record<string, any>[];
          items = rows.map(mapPurchaseRowToDomain);
          break;
        }
        case 'chat_sessions': {
          const rows = (auth!.isAdmin && filters.userId
            ? await sql`SELECT * FROM chat_sessions WHERE user_id = ${filters.userId} ORDER BY last_updated_at DESC LIMIT ${limit}`
            : await sql`SELECT * FROM chat_sessions WHERE user_id = ${auth!.uid} ORDER BY last_updated_at DESC LIMIT ${limit}`) as Record<string, any>[];
          items = rows.map(mapChatSessionRowToDomain);
          break;
        }
        case 'notifications': {
          const rows = (auth!.isAdmin && filters.all === 'true'
            ? await sql`SELECT * FROM notifications ORDER BY created_at DESC LIMIT ${limit}`
            : await sql`SELECT * FROM notifications WHERE user_id = ${auth!.uid} ORDER BY created_at DESC LIMIT ${limit}`) as Record<string, any>[];
          items = rows.map(mapNotificationRowToDomain);
          break;
        }
        case 'reviews': {
          const rows = (filters.propertyId
            ? await sql`SELECT * FROM reviews WHERE property_id = ${filters.propertyId} ORDER BY created_at DESC LIMIT ${limit}`
            : await sql`SELECT * FROM reviews ORDER BY created_at DESC LIMIT ${limit}`) as Record<string, any>[];
          items = rows.map(mapReviewRowToDomain);
          break;
        }
        case 'reports': {
          const rows = (auth!.isAdmin
            ? await sql`SELECT * FROM reports ORDER BY created_at DESC LIMIT ${limit}`
            : await sql`SELECT * FROM reports WHERE reporter_id = ${auth!.uid} ORDER BY created_at DESC LIMIT ${limit}`) as Record<string, any>[];
          items = rows.map(mapReportRowToDomain);
          break;
        }
        case 'alert_subscriptions': {
          const rows = (auth!.isAdmin
            ? await sql`SELECT * FROM alert_subscriptions ORDER BY created_at DESC LIMIT ${limit}`
            : await sql`SELECT * FROM alert_subscriptions WHERE user_id = ${auth!.uid} ORDER BY created_at DESC LIMIT ${limit}`) as Record<string, any>[];
          items = rows.map(mapAlertRowToDomain);
          break;
        }
        case 'contact_messages': {
          const rows = (await sql`SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT ${limit}`) as Record<string, any>[];
          items = rows.map(mapContactRowToDomain);
          break;
        }
        case 'crm_leads': {
          const rows = (auth!.isAdmin
            ? await sql`SELECT * FROM crm_leads ORDER BY created_at DESC LIMIT ${limit}`
            : await sql`SELECT * FROM crm_leads WHERE agent_id = ${auth!.uid} OR buyer_id = ${auth!.uid} ORDER BY created_at DESC LIMIT ${limit}`) as Record<string, any>[];
          items = rows.map(mapLeadRowToDomain);
          break;
        }
        case 'viewing_appointments': {
          const rows = (auth!.isAdmin
            ? await sql`SELECT * FROM viewing_appointments ORDER BY scheduled_at DESC NULLS LAST, created_at DESC LIMIT ${limit}`
            : await sql`SELECT * FROM viewing_appointments WHERE buyer_id = ${auth!.uid} OR agent_id = ${auth!.uid} ORDER BY scheduled_at DESC NULLS LAST, created_at DESC LIMIT ${limit}`) as Record<string, any>[];
          items = rows.map(mapViewingRowToDomain);
          break;
        }
      }

      return res.status(200).json({ success: true, items, data: items, count: items.length });
    }

    // ========================================================================
    // CREATE OPERATION
    // ========================================================================
    if (op === 'create') {
      const payload = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, any>;
      const isPublicCreate = table === 'contact_messages' || table === 'alert_subscriptions';

      if (!isPublicCreate && !auth) {
        return res.status(401).json({ error: 'UNAUTHORIZED: Authentication required.' });
      }
      if (table === 'users') {
        return res.status(403).json({
          error: 'FORBIDDEN: Use /api/auth (register or oauth-sync) to create user accounts.',
        });
      }

      const id = String(payload.id || `${table.slice(0, 4)}_${crypto.randomUUID()}`).trim();
      const nowIso = new Date().toISOString();

      // Table-specific validation & privilege guard
      if (table === 'properties') {
        if (!payload.title || typeof payload.title !== 'string') {
          return res.status(400).json({ error: 'INVALID_REQUEST: Property title is required.' });
        }
        if (!payload.location || typeof payload.location !== 'string') {
          return res.status(400).json({ error: 'INVALID_REQUEST: Property location is required.' });
        }
        const safe = stripAdminOnlyPropertyFields(payload, auth!.isAdmin);
        const propObj = {
          ...safe,
          id,
          authorUid: auth!.isAdmin && safe.authorUid ? String(safe.authorUid) : auth!.uid,
          isVerified: auth!.isAdmin ? Boolean(safe.isVerified ?? false) : false,
          verificationStatus: auth!.isAdmin ? safe.verificationStatus || 'Pending' : 'Pending',
          listingState: safe.listingState || 'Live',
          availability: safe.availability || 'Available',
          publishDate: safe.publishDate || nowIso,
        };
        if (!isNeonConfigured()) {
          getDevTableMap('properties').set(id, propObj);
          return res.status(201).json({ success: true, id, item: propObj, data: propObj });
        }
        const saved = await upsertPropertyNeon(propObj);
        return res.status(201).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'contact_messages') {
        const name = String(payload.name || '').trim().slice(0, 120);
        const email = normalizeEmail(payload.email || '');
        const message = String(payload.message || '').trim().slice(0, 4000);
        if (!name || !EMAIL_REGEX.test(email) || !message) {
          return res.status(400).json({ error: 'INVALID_REQUEST: Valid name, email, and message are required.' });
        }
        const item = { ...payload, id, name, email, message, createdAt: nowIso };
        if (!isNeonConfigured()) {
          getDevTableMap('contact_messages').set(id, item);
          return res.status(201).json({ success: true, id, item, data: item });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        await sql`
          INSERT INTO contact_messages (id, name, email, message, payload, created_at)
          VALUES (${id}, ${name}, ${email}, ${message}, ${JSON.stringify(item)}::jsonb, NOW())
        `;
        return res.status(201).json({ success: true, id, item, data: item });
      }

      if (table === 'alert_subscriptions') {
        const email = normalizeEmail(payload.email || auth?.email || '');
        if (!EMAIL_REGEX.test(email)) {
          return res.status(400).json({ error: 'INVALID_REQUEST: Valid email is required for alerts.' });
        }
        const criteria = payload.criteria && typeof payload.criteria === 'object' ? payload.criteria : {};
        const item = { id, email, userId: auth?.uid || null, criteria, createdAt: nowIso };
        if (!isNeonConfigured()) {
          getDevTableMap('alert_subscriptions').set(id, item);
          return res.status(201).json({ success: true, id, item, data: item });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        await sql`
          INSERT INTO alert_subscriptions (id, email, user_id, criteria, created_at)
          VALUES (${id}, ${email}, ${item.userId}, ${JSON.stringify(criteria)}::jsonb, NOW())
        `;
        return res.status(201).json({ success: true, id, item, data: item });
      }

      if (table === 'user_documents') {
        if (!payload.name || typeof payload.name !== 'string') {
          return res.status(400).json({ error: 'INVALID_REQUEST: Document name is required.' });
        }
        const safe = stripAdminOnlyDocumentFields(payload, auth!.isAdmin);
        const docObj: Record<string, any> = {
          ...safe,
          id,
          ownerUid: auth!.isAdmin && safe.ownerUid ? String(safe.ownerUid) : auth!.uid,
          reviewStatus: auth!.isAdmin ? safe.reviewStatus || 'Uploaded' : 'Uploaded',
          uploadDate: safe.uploadDate || nowIso,
        };
        if (!isNeonConfigured()) {
          getDevTableMap('user_documents').set(id, docObj);
          return res.status(201).json({ success: true, id, item: docObj, data: docObj });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          INSERT INTO user_documents (
            id, owner_uid, name, type, review_status, storage_path, content, size_bytes, upload_date, payload
          )
          VALUES (
            ${id}, ${docObj.ownerUid}, ${String(docObj.name).slice(0, 250)},
            ${docObj.type ? String(docObj.type).slice(0, 100) : 'document'},
            ${docObj.reviewStatus}, ${docObj.storagePath ?? null}, ${docObj.content ?? null},
            ${Number(docObj.size || 0)}, ${docObj.uploadDate}, ${JSON.stringify(docObj)}::jsonb
          )
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapDocumentRowToDomain(rows[0]);
        return res.status(201).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'purchases') {
        const item = {
          ...payload,
          id,
          propertyId: String(payload.propertyId || ''),
          userId: auth!.isAdmin && payload.userId ? String(payload.userId) : auth!.uid,
          status: auth!.isAdmin ? String(payload.status || 'processing') : 'processing',
          purchaseDate: payload.purchaseDate || nowIso,
        };
        if (!isNeonConfigured()) {
          getDevTableMap('purchases').set(id, item);
          return res.status(201).json({ success: true, id, item, data: item });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          INSERT INTO purchases (id, property_id, user_id, status, payload)
          VALUES (${id}, ${item.propertyId}, ${item.userId}, ${item.status}, ${JSON.stringify(item)}::jsonb)
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapPurchaseRowToDomain(rows[0]);
        return res.status(201).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'chat_sessions') {
        const item: ChatSession = {
          id,
          userId: auth!.uid,
          title: String(payload.title || 'New Consultation').slice(0, 200),
          messages: asArray(payload.messages),
          lastUpdatedAt: payload.lastUpdatedAt || nowIso,
        };
        if (!isNeonConfigured()) {
          getDevTableMap('chat_sessions').set(id, item);
          return res.status(201).json({ success: true, id, item, data: item });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          INSERT INTO chat_sessions (id, user_id, title, messages, last_updated_at)
          VALUES (${id}, ${item.userId}, ${item.title}, ${JSON.stringify(item.messages)}::jsonb, ${item.lastUpdatedAt}::timestamptz)
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            messages = EXCLUDED.messages,
            last_updated_at = EXCLUDED.last_updated_at
          WHERE chat_sessions.user_id = ${auth!.uid}
          RETURNING *
        `) as Record<string, any>[];
        const saved = rows[0] ? mapChatSessionRowToDomain(rows[0]) : item;
        return res.status(201).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'notifications') {
        const targetUserId = String(payload.userId || auth!.uid);
        if (!auth!.isAdmin && targetUserId !== auth!.uid) {
          return res.status(403).json({ error: 'FORBIDDEN: Cannot create notifications for another user.' });
        }
        const item: Notification = {
          id,
          userId: targetUserId,
          title: String(payload.title || '').slice(0, 200),
          message: String(payload.message || '').slice(0, 2000),
          read: Boolean(payload.read ?? false),
          date: payload.date || nowIso,
        };
        if (!isNeonConfigured()) {
          getDevTableMap('notifications').set(id, item);
          return res.status(201).json({ success: true, id, item, data: item });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          INSERT INTO notifications (id, user_id, title, message, read, date)
          VALUES (${id}, ${item.userId}, ${item.title}, ${item.message}, ${item.read}, ${item.date})
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapNotificationRowToDomain(rows[0]);
        return res.status(201).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'reviews') {
        const propertyId = String(payload.propertyId || '').trim();
        const rating = Math.min(5, Math.max(1, Math.round(Number(payload.rating || 5))));
        const comment = String(payload.comment || '').trim().slice(0, 2000);
        if (!propertyId) return res.status(400).json({ error: 'INVALID_REQUEST: propertyId is required.' });
        const item = { ...payload, id, propertyId, userId: auth!.uid, rating, comment, createdAt: nowIso };
        if (!isNeonConfigured()) {
          getDevTableMap('reviews').set(id, item);
          return res.status(201).json({ success: true, id, item, data: item });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          INSERT INTO reviews (id, property_id, user_id, rating, comment, payload)
          VALUES (${id}, ${propertyId}, ${auth!.uid}, ${rating}, ${comment}, ${JSON.stringify(item)}::jsonb)
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapReviewRowToDomain(rows[0]);
        return res.status(201).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'reports') {
        const reason = String(payload.reason || '').trim().slice(0, 1000);
        if (!reason) return res.status(400).json({ error: 'INVALID_REQUEST: reason is required.' });
        const item = {
          ...payload,
          id,
          propertyId: payload.propertyId ? String(payload.propertyId) : null,
          reporterId: auth!.uid,
          reason,
          createdAt: nowIso,
        };
        if (!isNeonConfigured()) {
          getDevTableMap('reports').set(id, item);
          return res.status(201).json({ success: true, id, item, data: item });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          INSERT INTO reports (id, property_id, reporter_id, reason, payload)
          VALUES (${id}, ${item.propertyId}, ${auth!.uid}, ${reason}, ${JSON.stringify(item)}::jsonb)
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapReportRowToDomain(rows[0]);
        return res.status(201).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'crm_leads') {
        const item = {
          ...payload,
          id,
          propertyId: payload.propertyId ? String(payload.propertyId) : null,
          buyerId: payload.buyerId || auth!.uid,
          buyerName: String(payload.buyerName || '').slice(0, 120),
          buyerPhone: String(payload.buyerPhone || '').slice(0, 40),
          agentId: payload.agentId || null,
          status: String(payload.status || 'new'),
          notes: String(payload.notes || '').slice(0, 2000),
          createdAt: nowIso,
        };
        if (!isNeonConfigured()) {
          getDevTableMap('crm_leads').set(id, item);
          return res.status(201).json({ success: true, id, item, data: item });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          INSERT INTO crm_leads (id, property_id, buyer_id, buyer_name, buyer_phone, agent_id, status, notes, payload)
          VALUES (${id}, ${item.propertyId}, ${item.buyerId}, ${item.buyerName}, ${item.buyerPhone}, ${item.agentId}, ${item.status}, ${item.notes}, ${JSON.stringify(item)}::jsonb)
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapLeadRowToDomain(rows[0]);
        return res.status(201).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'viewing_appointments') {
        const item = {
          ...payload,
          id,
          propertyId: payload.propertyId ? String(payload.propertyId) : null,
          buyerId: auth!.isAdmin && payload.buyerId ? String(payload.buyerId) : auth!.uid,
          agentId: payload.agentId || null,
          visitType: String(payload.visitType || 'in_person'),
          scheduledAt: payload.scheduledAt || null,
          status: String(payload.status || 'scheduled'),
          createdAt: nowIso,
        };
        if (!isNeonConfigured()) {
          getDevTableMap('viewing_appointments').set(id, item);
          return res.status(201).json({ success: true, id, item, data: item });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          INSERT INTO viewing_appointments (id, property_id, buyer_id, agent_id, visit_type, scheduled_at, status, payload)
          VALUES (${id}, ${item.propertyId}, ${item.buyerId}, ${item.agentId}, ${item.visitType}, ${item.scheduledAt ? new Date(item.scheduledAt).toISOString() : null}::timestamptz, ${item.status}, ${JSON.stringify(item)}::jsonb)
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapViewingRowToDomain(rows[0]);
        return res.status(201).json({ success: true, id: saved.id, item: saved, data: saved });
      }
    }

    // ========================================================================
    // UPDATE OPERATION
    // ========================================================================
    if (op === 'update') {
      if (!auth) return res.status(401).json({ error: 'UNAUTHORIZED: Authentication required.' });
      if (!recordId) return res.status(400).json({ error: 'INVALID_REQUEST: id is required for update.' });

      const patch = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, any>;
      const existing = await fetchRecordById(table, recordId);

      // Upsert support for chat_sessions owned by the current user
      if (!existing && table === 'chat_sessions') {
        const item: ChatSession = {
          id: recordId,
          userId: auth.uid,
          title: String(patch.title || 'Consultation').slice(0, 200),
          messages: asArray(patch.messages),
          lastUpdatedAt: patch.lastUpdatedAt || new Date().toISOString(),
        };
        if (!isNeonConfigured()) {
          getDevTableMap('chat_sessions').set(recordId, item);
          return res.status(200).json({ success: true, id: recordId, item, data: item });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          INSERT INTO chat_sessions (id, user_id, title, messages, last_updated_at)
          VALUES (${recordId}, ${item.userId}, ${item.title}, ${JSON.stringify(item.messages)}::jsonb, ${item.lastUpdatedAt}::timestamptz)
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapChatSessionRowToDomain(rows[0]);
        return res.status(200).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });
      if (!assertOwnerOrAdmin(table, existing, auth)) {
        return res.status(403).json({ error: 'FORBIDDEN: Not authorized to modify this record.' });
      }

      if (table === 'properties') {
        const safePatch = stripAdminOnlyPropertyFields(patch, auth.isAdmin);
        const merged = { ...existing, ...safePatch, id: recordId, authorUid: existing.authorUid };
        if (!isNeonConfigured()) {
          getDevTableMap('properties').set(recordId, merged);
          return res.status(200).json({ success: true, id: recordId, item: merged, data: merged });
        }
        const saved = await upsertPropertyNeon(merged);
        return res.status(200).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'users') {
        // Non-admins may ONLY edit safe self-service profile fields
        const allowedName = typeof patch.name === 'string' ? patch.name.trim().slice(0, 120) : existing.name;
        const allowedPhone = typeof patch.phone === 'string' ? patch.phone.trim().slice(0, 40) : existing.phone;
        const allowedPrefs = typeof patch.preferences === 'string' ? patch.preferences.slice(0, 2000) : existing.preferences;
        const allowedAvatar = typeof patch.avatarUrl === 'string' ? patch.avatarUrl.trim().slice(0, 500) : existing.avatarUrl;

        if (!isNeonConfigured()) {
          const rawUser = devMemoryStore.users.get(recordId) || existing;
          const updated = {
            ...rawUser,
            name: allowedName,
            phone: allowedPhone,
            preferences: allowedPrefs,
            avatar_url: allowedAvatar,
          };
          devMemoryStore.users.set(recordId, updated);
          const sanitized = mapUserRowToDomain(updated);
          return res.status(200).json({ success: true, id: recordId, item: sanitized, data: sanitized });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE users
          SET name = ${allowedName}, phone = ${allowedPhone}, preferences = ${allowedPrefs}, avatar_url = ${allowedAvatar ?? null}
          WHERE id = ${recordId}
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapUserRowToDomain(rows[0]);
        return res.status(200).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'user_documents') {
        const safePatch = stripAdminOnlyDocumentFields(patch, auth.isAdmin);
        const merged: Record<string, any> = { ...existing, ...safePatch, id: recordId, ownerUid: existing.ownerUid };
        if (!isNeonConfigured()) {
          getDevTableMap('user_documents').set(recordId, merged);
          return res.status(200).json({ success: true, id: recordId, item: merged, data: merged });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE user_documents
          SET name = ${merged.name},
              type = ${merged.type},
              review_status = ${merged.reviewStatus || 'Uploaded'},
              reviewed_by = ${merged.reviewedBy ?? null},
              reviewed_at = ${merged.reviewedAt ? new Date(merged.reviewedAt).toISOString() : null}::timestamptz,
              review_note = ${merged.reviewNote ?? null},
              storage_path = ${merged.storagePath ?? null},
              content = ${merged.content ?? null},
              payload = ${JSON.stringify(merged)}::jsonb
          WHERE id = ${recordId}
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapDocumentRowToDomain(rows[0]);
        return res.status(200).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'notifications') {
        const nextRead = patch.read !== undefined ? Boolean(patch.read) : existing.read;
        const merged = { ...existing, read: nextRead };
        if (!isNeonConfigured()) {
          getDevTableMap('notifications').set(recordId, merged);
          return res.status(200).json({ success: true, id: recordId, item: merged, data: merged });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE notifications SET read = ${nextRead} WHERE id = ${recordId} RETURNING *
        `) as Record<string, any>[];
        const saved = mapNotificationRowToDomain(rows[0]);
        return res.status(200).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'chat_sessions') {
        const merged = {
          ...existing,
          title: typeof patch.title === 'string' ? patch.title.slice(0, 200) : existing.title,
          messages: Array.isArray(patch.messages) ? patch.messages : existing.messages,
          lastUpdatedAt: patch.lastUpdatedAt || new Date().toISOString(),
        };
        if (!isNeonConfigured()) {
          getDevTableMap('chat_sessions').set(recordId, merged);
          return res.status(200).json({ success: true, id: recordId, item: merged, data: merged });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE chat_sessions
          SET title = ${merged.title}, messages = ${JSON.stringify(merged.messages)}::jsonb, last_updated_at = ${merged.lastUpdatedAt}::timestamptz
          WHERE id = ${recordId}
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapChatSessionRowToDomain(rows[0]);
        return res.status(200).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'purchases') {
        const nextStatus = auth.isAdmin
          ? String(patch.status || existing.status)
          : patch.status === 'cancelled' && existing.status === 'processing'
            ? 'cancelled'
            : existing.status;
        const merged = { ...existing, ...patch, id: recordId, userId: existing.userId, status: nextStatus };
        if (!isNeonConfigured()) {
          getDevTableMap('purchases').set(recordId, merged);
          return res.status(200).json({ success: true, id: recordId, item: merged, data: merged });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE purchases SET status = ${nextStatus}, payload = ${JSON.stringify(merged)}::jsonb
          WHERE id = ${recordId}
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapPurchaseRowToDomain(rows[0]);
        return res.status(200).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'crm_leads') {
        const merged: Record<string, any> = { ...existing, ...patch, id: recordId };
        if (!isNeonConfigured()) {
          getDevTableMap('crm_leads').set(recordId, merged);
          return res.status(200).json({ success: true, id: recordId, item: merged, data: merged });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE crm_leads
          SET status = ${String(merged.status || 'new')}, notes = ${String(merged.notes || '')}, payload = ${JSON.stringify(merged)}::jsonb
          WHERE id = ${recordId}
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapLeadRowToDomain(rows[0]);
        return res.status(200).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      if (table === 'viewing_appointments') {
        const merged: Record<string, any> = { ...existing, ...patch, id: recordId };
        if (!isNeonConfigured()) {
          getDevTableMap('viewing_appointments').set(recordId, merged);
          return res.status(200).json({ success: true, id: recordId, item: merged, data: merged });
        }
        await ensureNeonSchema();
        const sql = getNeonSql();
        const rows = (await sql`
          UPDATE viewing_appointments
          SET status = ${String(merged.status || 'scheduled')},
              visit_type = ${String(merged.visitType || 'in_person')},
              scheduled_at = ${merged.scheduledAt ? new Date(merged.scheduledAt).toISOString() : null}::timestamptz,
              payload = ${JSON.stringify(merged)}::jsonb
          WHERE id = ${recordId}
          RETURNING *
        `) as Record<string, any>[];
        const saved = mapViewingRowToDomain(rows[0]);
        return res.status(200).json({ success: true, id: saved.id, item: saved, data: saved });
      }

      return res.status(400).json({ error: `UPDATE_UNSUPPORTED: Updates are not supported on '${table}'.` });
    }

    // ========================================================================
    // DELETE OPERATION
    // ========================================================================
    if (op === 'delete') {
      if (!auth) return res.status(401).json({ error: 'UNAUTHORIZED: Authentication required.' });
      if (!recordId) return res.status(400).json({ error: 'INVALID_REQUEST: id is required for delete.' });

      const existing = await fetchRecordById(table, recordId);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });

      if (table === 'users' || table === 'reports' || table === 'contact_messages') {
        if (!auth.isAdmin) {
          return res.status(403).json({ error: 'FORBIDDEN: Admin privileges required.' });
        }
        if (table === 'users' && existing.role === 'super_admin' && !auth.isSuperAdmin) {
          return res.status(403).json({ error: 'FORBIDDEN: Only super_admin can delete a super_admin.' });
        }
      } else if (!assertOwnerOrAdmin(table, existing, auth)) {
        return res.status(403).json({ error: 'FORBIDDEN: Not authorized to delete this record.' });
      }

      if (!isNeonConfigured()) {
        getDevTableMap(table).delete(recordId);
        return res.status(200).json({ success: true, id: recordId, deleted: true });
      }

      await ensureNeonSchema();
      const sql = getNeonSql();
      switch (table) {
        case 'properties':
          await sql`DELETE FROM properties WHERE id = ${recordId}`;
          break;
        case 'users':
          await sql`DELETE FROM users WHERE id = ${recordId}`;
          break;
        case 'user_documents':
          await sql`DELETE FROM user_documents WHERE id = ${recordId}`;
          break;
        case 'purchases':
          await sql`DELETE FROM purchases WHERE id = ${recordId}`;
          break;
        case 'chat_sessions':
          await sql`DELETE FROM chat_sessions WHERE id = ${recordId}`;
          break;
        case 'notifications':
          await sql`DELETE FROM notifications WHERE id = ${recordId}`;
          break;
        case 'reviews':
          await sql`DELETE FROM reviews WHERE id = ${recordId}`;
          break;
        case 'reports':
          await sql`DELETE FROM reports WHERE id = ${recordId}`;
          break;
        case 'alert_subscriptions':
          await sql`DELETE FROM alert_subscriptions WHERE id = ${recordId}`;
          break;
        case 'contact_messages':
          await sql`DELETE FROM contact_messages WHERE id = ${recordId}`;
          break;
        case 'crm_leads':
          await sql`DELETE FROM crm_leads WHERE id = ${recordId}`;
          break;
        case 'viewing_appointments':
          await sql`DELETE FROM viewing_appointments WHERE id = ${recordId}`;
          break;
      }

      return res.status(200).json({ success: true, id: recordId, deleted: true });
    }

    return res.status(400).json({ error: 'INVALID_OPERATION' });
  } catch (err: any) {
    console.error('[api/db] Error:', err);
    return res.status(500).json({ error: err?.message || 'Database operation failed.' });
  }
}
