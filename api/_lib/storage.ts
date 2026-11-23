/**
 * HETTETY v4 — Native Neon Object Storage Client (S3-Compatible)
 *
 * Uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner with `forcePathStyle: true`
 * matching Neon Console -> Storage -> s3-client.ts configuration (default bucket: "assets").
 *
 * Environment variables (from Neon Console -> Connect -> Storage -> .env):
 *   AWS_ENDPOINT_URL_S3      (or NEON_STORAGE_ENDPOINT)
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_REGION               (e.g. "eu-central-1" or "auto")
 *   NEON_STORAGE_BUCKET      (defaults to "assets")
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const DEFAULT_NEON_STORAGE_BUCKET = 'assets';

export const ALLOWED_UPLOAD_MIMES = new Set([
  // High-resolution property photography & panoramas
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/gif',
  // Video walkthroughs
  'video/mp4',
  'video/quicktime',
  'video/webm',
  // 3D Gaussian Splatting & calibrated meshes
  'application/octet-stream',
  'model/gltf-binary',
  'model/gltf+json',
  // Legal deeds, brochures & floor plans
  'application/pdf',
]);

let cachedS3Client: S3Client | null = null;

export function getNeonStorageBucket(): string {
  return (
    process.env.NEON_STORAGE_BUCKET ||
    process.env.S3_BUCKET_NAME ||
    process.env.AWS_S3_BUCKET ||
    DEFAULT_NEON_STORAGE_BUCKET
  ).trim();
}

export function getNeonStorageEndpoint(): string | undefined {
  const ep =
    process.env.AWS_ENDPOINT_URL_S3 ||
    process.env.NEON_STORAGE_ENDPOINT ||
    process.env.S3_ENDPOINT ||
    '';
  return ep.trim() || undefined;
}

export function isNeonStorageConfigured(): boolean {
  const hasCreds = Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );
  const hasEndpoint = Boolean(getNeonStorageEndpoint());
  return hasCreds && (hasEndpoint || Boolean(process.env.AWS_REGION));
}

export function getNeonS3Client(): S3Client {
  if (cachedS3Client) return cachedS3Client;
  const endpoint = getNeonStorageEndpoint();
  const region = process.env.AWS_REGION || process.env.NEON_STORAGE_REGION || 'eu-central-1';

  cachedS3Client = new S3Client({
    forcePathStyle: true,
    region,
    ...(endpoint ? { endpoint } : {}),
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  return cachedS3Client;
}

/** Prevents path traversal, leading slashes, and control characters in object keys. */
export function sanitizeStorageKey(rawKey: string): string {
  const cleaned = String(rawKey || '')
    .replace(/\\/g, '/')
    .replace(/\.\./g, '')
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9/_\-.]/g, '_');

  if (!cleaned || cleaned.length > 512) {
    throw new Error('INVALID_STORAGE_KEY: Key must be a non-empty safe path under 512 chars.');
  }
  return cleaned;
}

export async function createPresignedUploadUrl(
  rawKey: string,
  contentType: string,
  expiresInSeconds = 900
): Promise<{ uploadUrl: string; key: string; bucket: string; expiresIn: number }> {
  const key = sanitizeStorageKey(rawKey);
  const bucket = getNeonStorageBucket();
  const s3 = getNeonS3Client();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
  return { uploadUrl, key, bucket, expiresIn: expiresInSeconds };
}

export async function createPresignedDownloadUrl(
  rawKey: string,
  expiresInSeconds = 3600
): Promise<{ url: string; key: string; bucket: string; expiresIn: number }> {
  const key = sanitizeStorageKey(rawKey);
  const bucket = getNeonStorageBucket();
  const s3 = getNeonS3Client();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
  return { url, key, bucket, expiresIn: expiresInSeconds };
}

export async function uploadBufferToNeonStorage(
  rawKey: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<{ key: string; bucket: string; url: string; sizeBytes: number }> {
  const key = sanitizeStorageKey(rawKey);
  const bucket = getNeonStorageBucket();
  const s3 = getNeonS3Client();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    })
  );

  const { url } = await createPresignedDownloadUrl(key, 3600 * 24 * 7);
  return { key, bucket, url, sizeBytes: body.byteLength };
}

export async function deleteFromNeonStorage(rawKey: string): Promise<{ deleted: boolean; key: string }> {
  const key = sanitizeStorageKey(rawKey);
  const bucket = getNeonStorageBucket();
  const s3 = getNeonS3Client();

  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  return { deleted: true, key };
}

export interface NeonStorageHealth {
  configured: boolean;
  healthy: boolean;
  bucket: string;
  provider: 'neon_storage';
  endpointConfigured: boolean;
  latencyMs?: number;
  error?: string;
}

export async function probeNeonStorageHealth(): Promise<NeonStorageHealth> {
  const bucket = getNeonStorageBucket();
  const configured = isNeonStorageConfigured();
  const endpointConfigured = Boolean(getNeonStorageEndpoint());

  if (!configured) {
    return {
      configured: false,
      healthy: false,
      bucket,
      provider: 'neon_storage',
      endpointConfigured,
    };
  }

  const start = Date.now();
  try {
    const s3 = getNeonS3Client();
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return {
      configured: true,
      healthy: true,
      bucket,
      provider: 'neon_storage',
      endpointConfigured,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      configured: true,
      healthy: false,
      bucket,
      provider: 'neon_storage',
      endpointConfigured,
      latencyMs: Date.now() - start,
      error: err?.message || 'Bucket check failed',
    };
  }
}
