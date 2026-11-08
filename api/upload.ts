/**
 * POST /api/upload — HETTETY Signed Upload Minter API
 * Production-hardened upload authorization service conforming to API_CONTRACTS.md & SYSTEM_ARCHITECTURE.md.
 * Enforces strict property ownership verification, SSRF defense, path traversal sanitization,
 * Content-Type whitelisting (images & mp4), and signed upload session expiration.
 */

import crypto from 'crypto';
import path from 'path';
import {
  authenticateRequest,
  validatePropertyOwnership,
  generateV4SignedUploadUrl,
} from './reconstruction.js';

const ALLOWED_PHOTO_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const ALLOWED_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);
const ALLOWED_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm']);

const MAX_PHOTO_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500MB
const MAX_TOTAL_SESSION_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

// Identifier pattern to defeat SSRF and path traversal injection
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const action = req.query?.action || req.body?.action || 'create-upload-session';
    if (action !== 'create-upload-session') {
      return res.status(400).json({ error: `INVALID_ACTION: Unknown action '${action}'. Expected 'create-upload-session'.` });
    }

    // 1. Authenticate Request
    const auth = await authenticateRequest(req);
    if (auth.isWorker) {
      return res.status(403).json({ error: 'FORBIDDEN: Worker tokens are not authorized to create upload sessions.' });
    }

    const { propertyId, jobId, files, type } = req.body || {};

    // 2. SSRF & Path Traversal Parameter Defenses
    if (!propertyId || typeof propertyId !== 'string') {
      return res.status(400).json({ error: 'INVALID_REQUEST: propertyId string is required.' });
    }
    if (!SAFE_ID_REGEX.test(propertyId)) {
      return res.status(400).json({ error: 'INVALID_REQUEST: propertyId contains invalid characters or path traversal sequences.' });
    }

    const effectiveJobId = jobId && typeof jobId === 'string'
      ? jobId
      : `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    if (!SAFE_ID_REGEX.test(effectiveJobId)) {
      return res.status(400).json({ error: 'INVALID_REQUEST: jobId contains invalid characters or path traversal sequences.' });
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'INVALID_REQUEST: files non-empty array is required.' });
    }

    if (files.length > 500) {
      return res.status(400).json({ error: 'INVALID_REQUEST: Maximum 500 files allowed per upload session.' });
    }

    // 3. Strict Property Ownership Verification
    const ownership = await validatePropertyOwnership(propertyId, auth.uid, auth.isAdmin);
    if (!ownership.allowed) {
      return res.status(ownership.status || 403).json({ error: ownership.reason || 'FORBIDDEN: You do not own this property.' });
    }

    // 4. Content-Type Whitelisting & Path Traversal Sanitization
    const isVideo = type === 'video';
    let totalBytes = 0;
    const seenNames = new Set<string>();
    const bucket = process.env.GCS_BUCKET_NAME || 'hettety-spatial-assets';

    const destinations: Array<{
      name: string;
      storagePath: string;
      uploadUrl: string;
      expiresAt: string;
      sizeBytes: number;
    }> = [];

    const signedUploadUrls: Array<{
      id: string;
      uploadUrl: string;
      storagePath: string;
      fileName: string;
      sizeBytes: number;
    }> = [];

    const sessionExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2-hour session limit

    for (let idx = 0; idx < files.length; idx++) {
      const f = files[idx];
      if (!f || typeof f !== 'object') {
        return res.status(400).json({ error: `INVALID_FILE: Item at index ${idx} is not a valid file object.` });
      }

      const rawName = String(f.name || `file_${idx}`);
      // Strip directory traversal attempts
      if (rawName.includes('..') || rawName.includes('/') || rawName.includes('\\')) {
        return res.status(400).json({ error: `PATH_TRAVERSAL_DETECTED: Filename '${rawName}' contains directory traversal sequences.` });
      }

      const baseName = path.basename(rawName.replace(/\\/g, '/'));
      const ext = path.extname(baseName).toLowerCase();
      const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_');

      // Check extension & MIME against whitelist
      const mime = f.mimeType ? String(f.mimeType).toLowerCase().trim() : '';
      const isFileVideo = isVideo || mime.startsWith('video/') || ALLOWED_VIDEO_EXTS.has(ext);

      if (isFileVideo) {
        if (mime && !ALLOWED_VIDEO_MIMES.has(mime)) {
          return res.status(400).json({
            error: `INVALID_FILE_TYPE: Unsupported video MIME type '${f.mimeType}'. Allowed: ${Array.from(ALLOWED_VIDEO_MIMES).join(', ')}.`,
          });
        }
        if (ext && !ALLOWED_VIDEO_EXTS.has(ext)) {
          return res.status(400).json({
            error: `INVALID_FILENAME: Unsupported video extension '${ext}'. Allowed: ${Array.from(ALLOWED_VIDEO_EXTS).join(', ')}.`,
          });
        }
      } else {
        if (mime && !ALLOWED_PHOTO_MIMES.has(mime)) {
          return res.status(400).json({
            error: `INVALID_FILE_TYPE: Unsupported photo MIME type '${f.mimeType}'. Allowed: ${Array.from(ALLOWED_PHOTO_MIMES).join(', ')}.`,
          });
        }
        if (ext && !ALLOWED_PHOTO_EXTS.has(ext)) {
          return res.status(400).json({
            error: `INVALID_FILENAME: Unsupported photo extension '${ext}'. Allowed: ${Array.from(ALLOWED_PHOTO_EXTS).join(', ')}.`,
          });
        }
      }

      const size = Number(f.sizeBytes || 0);
      if (f.sizeBytes !== undefined && (size < 0 || !isFinite(size))) {
        return res.status(400).json({ error: `INVALID_FILE_SIZE: File '${rawName}' must have a valid size in bytes.` });
      }

      const maxSingle = isFileVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
      if (size > maxSingle) {
        return res.status(400).json({
          error: `FILE_TOO_LARGE: File '${rawName}' (${Math.round(size / (1024 * 1024))}MB) exceeds maximum limit of ${Math.round(maxSingle / (1024 * 1024))}MB.`,
        });
      }
      totalBytes += size;

      const normName = safeName.toLowerCase();
      if (seenNames.has(normName)) {
        return res.status(400).json({ error: `DUPLICATE_FILE_DETECTED: Duplicate file name '${safeName}' in upload request.` });
      }
      seenNames.add(normName);

      // Canonical storage path guaranteed under properties/{propertyId}/uploads/{jobId}/{safeName}
      const storagePath = `properties/${propertyId}/uploads/${effectiveJobId}/${safeName}`;
      const contentType = mime || (isFileVideo ? 'video/mp4' : 'image/jpeg');

      // 5. Generate Signed V4 Upload URL (15-minute expiration)
      const signed = generateV4SignedUploadUrl(bucket, storagePath, contentType, 900);

      destinations.push({
        name: safeName,
        storagePath,
        uploadUrl: signed.uploadUrl,
        expiresAt: signed.expiresAt,
        sizeBytes: size,
      });

      signedUploadUrls.push({
        id: `cap-${effectiveJobId}-${idx}`,
        uploadUrl: signed.uploadUrl,
        storagePath,
        fileName: safeName,
        sizeBytes: size,
      });
    }

    if (totalBytes > MAX_TOTAL_SESSION_BYTES) {
      return res.status(400).json({
        error: `CAPTURE_PAYLOAD_EXCEEDED: Total upload session size exceeds 2GB maximum limit.`,
      });
    }

    return res.status(200).json({
      success: true,
      sessionId: `session_${effectiveJobId}`,
      jobId: effectiveJobId,
      uploadSessionExpiresAt: sessionExpiresAt,
      destinations,
      signedUploadUrls,
    });
  } catch (err: any) {
    if (err?.message?.includes('AUTHENTICATION_REQUIRED')) {
      return res.status(401).json({ error: err.message });
    }
    console.error('[api/upload] Error:', err);
    return res.status(500).json({ error: err?.message || 'INTERNAL_SERVER_ERROR' });
  }
}
