/**
 * GET / POST /api/storage — HETTETY v4 Native Neon Object Storage API
 *
 * Manages high-resolution property images, 360° panoramas, floorplans, 3D assets
 * (.spz / .glb), and legal documents via Neon Object Storage (S3-compatible `assets`
 * bucket) while registering indexed metadata inside Neon Postgres `media_assets`.
 */

import crypto from 'crypto';
import {
  ALLOWED_UPLOAD_MIMES,
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
  deleteFromNeonStorage,
  getNeonStorageBucket,
  isNeonStorageConfigured,
  probeNeonStorageHealth,
  sanitizeStorageKey,
  uploadBufferToNeonStorage,
} from './_lib/storage.js';
import { ensureNeonSchema, getNeonSql, isNeonConfigured } from './_lib/neon.js';
import { getJsonBody, getQueryParams, verifyAuthHeaderAsync } from './_lib/auth.js';

const MAX_INLINE_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB serverless direct proxy cap (use presign-upload for larger 3D/video files)

function inferAssetType(mimeType: string, key: string): string {
  const lowerKey = key.toLowerCase();
  if (lowerKey.endsWith('.spz')) return 'spz';
  if (lowerKey.endsWith('.glb') || lowerKey.endsWith('.gltf')) return 'glb';
  if (lowerKey.includes('panorama')) return 'panorama';
  if (lowerKey.includes('floorplan')) return 'floorplan';
  if (mimeType === 'application/pdf' || lowerKey.includes('document')) return 'document';
  if (mimeType.startsWith('video/')) return 'video';
  return 'image';
}

async function recordMediaAssetMetadata(params: {
  id: string;
  propertyId?: string | null;
  ownerUid: string;
  assetType: string;
  storageKey: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
}): Promise<void> {
  if (!isNeonConfigured()) return;
  try {
    await ensureNeonSchema();
    const sql = getNeonSql();
    await sql`
      INSERT INTO media_assets (
        id, property_id, owner_uid, asset_type, storage_provider,
        storage_key, public_url, mime_type, size_bytes, sha256, metadata
      ) VALUES (
        ${params.id},
        ${params.propertyId || null},
        ${params.ownerUid},
        ${params.assetType},
        'neon_storage',
        ${params.storageKey},
        ${params.publicUrl},
        ${params.mimeType},
        ${params.sizeBytes},
        ${params.sha256 || null},
        ${JSON.stringify({ bucket: getNeonStorageBucket() })}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        public_url = EXCLUDED.public_url,
        size_bytes = EXCLUDED.size_bytes,
        mime_type = EXCLUDED.mime_type
    `;
  } catch (err) {
    // Non-fatal if property_id FK hasn't been committed yet
    console.warn('[api/storage] metadata log warning:', (err as any)?.message || err);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader?.('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = getQueryParams(req);
  const body = getJsonBody(req);
  const action = String(query.action || body.action || 'health').trim();

  // Public health check (safe, no secrets leaked)
  if (req.method === 'GET' && action === 'health') {
    const health = await probeNeonStorageHealth();
    return res.status(200).json({ success: true, ...health });
  }

  if (!isNeonStorageConfigured()) {
    return res.status(503).json({
      error:
        'NEON_STORAGE_NOT_CONFIGURED: Set AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY from Neon Console -> Storage -> .env.',
      configured: false,
      bucket: getNeonStorageBucket(),
    });
  }

  // All mutating or presigning actions require authenticated Neon user
  const auth = await verifyAuthHeaderAsync(req);
  if (!auth) {
    return res.status(401).json({ error: 'UNAUTHORIZED: Sign in to access Neon Object Storage.' });
  }

  try {
    // 1. PRESIGN DIRECT BROWSER PUT UPLOAD (supports unlimited large images, videos & 3D SPZ/GLB)
    if (action === 'presign-upload') {
      const contentType = String(body.contentType || 'application/octet-stream').trim().toLowerCase();
      if (!ALLOWED_UPLOAD_MIMES.has(contentType)) {
        return res.status(400).json({ error: `UNSUPPORTED_MIME_TYPE: "${contentType}" is not allowed.` });
      }
      const rawPath =
        typeof body.path === 'string' && body.path.trim()
          ? body.path.trim()
          : `uploads/${auth.uid}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${String(body.fileName || 'file.bin')}`;
      const key = sanitizeStorageKey(rawPath);
      const sizeBytes = Number(body.sizeBytes || 0);

      const presigned = await createPresignedUploadUrl(key, contentType, 900);
      const preview = await createPresignedDownloadUrl(key, 3600 * 24 * 7);

      await recordMediaAssetMetadata({
        id: `media_${crypto.randomBytes(8).toString('hex')}`,
        propertyId: typeof body.propertyId === 'string' ? body.propertyId : null,
        ownerUid: auth.uid,
        assetType: inferAssetType(contentType, key),
        storageKey: key,
        publicUrl: preview.url,
        mimeType: contentType,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      });

      return res.status(200).json({
        success: true,
        uploadUrl: presigned.uploadUrl,
        downloadUrl: preview.url,
        storagePath: presigned.key,
        bucket: presigned.bucket,
        expiresIn: presigned.expiresIn,
      });
    }

    // 2. PRESIGN PRIVATE / ASSET GET DOWNLOAD URL
    if (action === 'presign-download') {
      const rawPath = String(body.path || query.path || '').trim();
      if (!rawPath) {
        return res.status(400).json({ error: 'INVALID_REQUEST: path is required.' });
      }
      const key = sanitizeStorageKey(rawPath);
      const result = await createPresignedDownloadUrl(key, 3600);
      return res.status(200).json({
        success: true,
        url: result.url,
        storagePath: result.key,
        bucket: result.bucket,
        expiresIn: result.expiresIn,
      });
    }

    // 3. DIRECT SERVER-PROXIED UPLOAD (base64 data URI -> Neon Object Storage)
    if (action === 'upload') {
      const rawPath = String(body.path || '').trim();
      const base64Data = String(body.dataBase64 || '').trim();
      const contentType = String(body.contentType || 'application/octet-stream').trim().toLowerCase();

      if (!rawPath || !base64Data) {
        return res.status(400).json({ error: 'INVALID_REQUEST: path and dataBase64 are required.' });
      }
      if (!ALLOWED_UPLOAD_MIMES.has(contentType)) {
        return res.status(400).json({ error: `UNSUPPORTED_MIME_TYPE: "${contentType}" is not allowed.` });
      }

      const stripped = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buffer = Buffer.from(stripped, 'base64');
      if (buffer.byteLength > MAX_INLINE_UPLOAD_BYTES) {
        return res.status(413).json({
          error: 'PAYLOAD_TOO_LARGE: Use action=presign-upload for files larger than 4MB.',
        });
      }

      const key = sanitizeStorageKey(rawPath);
      const uploaded = await uploadBufferToNeonStorage(key, buffer, contentType);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      await recordMediaAssetMetadata({
        id: `media_${crypto.randomBytes(8).toString('hex')}`,
        propertyId: typeof body.propertyId === 'string' ? body.propertyId : null,
        ownerUid: auth.uid,
        assetType: inferAssetType(contentType, key),
        storageKey: uploaded.key,
        publicUrl: uploaded.url,
        mimeType: contentType,
        sizeBytes: uploaded.sizeBytes,
        sha256,
      });

      return res.status(200).json({
        success: true,
        storagePath: uploaded.key,
        url: uploaded.url,
        bucket: uploaded.bucket,
        sizeBytes: uploaded.sizeBytes,
        sha256,
      });
    }

    // 4. DELETE OBJECT (Owner or Admin)
    if (action === 'delete') {
      const rawPath = String(body.path || '').trim();
      if (!rawPath) {
        return res.status(400).json({ error: 'INVALID_REQUEST: path is required.' });
      }
      const key = sanitizeStorageKey(rawPath);
      if (!auth.isAdmin && !key.includes(auth.uid)) {
        return res.status(403).json({ error: 'FORBIDDEN: You can only delete your own storage objects.' });
      }

      await deleteFromNeonStorage(key);
      if (isNeonConfigured()) {
        try {
          await ensureNeonSchema();
          const sql = getNeonSql();
          await sql`DELETE FROM media_assets WHERE storage_key = ${key}`;
        } catch {}
      }

      return res.status(200).json({ success: true, deleted: true, storagePath: key });
    }

    return res.status(400).json({ error: `UNKNOWN_ACTION: "${action}"` });
  } catch (err: any) {
    console.error('[api/storage]', action, err?.message || err);
    return res.status(500).json({ error: err?.message || 'Storage operation failed' });
  }
}
