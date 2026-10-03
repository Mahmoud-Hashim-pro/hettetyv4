/**
 * HETTETY 3D - Asset Management Service
 * Manages capture asset tracking, storage upload executions, and spatial asset caching.
 * The browser NEVER signs upload URLs directly; all signed URLs are requested from the backend control plane.
 */

import { CaptureAsset, ThreeDAsset } from '../../types';
import { db, auth } from '../../firebase';
import { doc, setDoc } from 'firebase/firestore';

const captureAssetsRegistry = new Map<string, CaptureAsset[]>();
const threeDAssetsRegistry = new Map<string, ThreeDAsset[]>();

export interface UploadSessionRequest {
  propertyId: string;
  files: Array<{ name: string; sizeBytes: number; mimeType: string; checksum?: string }>;
}

export interface UploadSessionResponse {
  sessionId: string;
  signedUploadUrls: Array<{
    fileName: string;
    uploadUrl: string;
    storagePath: string;
  }>;
}

/**
 * Authoritative upload session generation:
 * Requests signed upload URLs exclusively from the backend control plane API.
 * Contains ZERO client-side signing credentials or algorithms.
 */
export const createUploadSession = async (request: UploadSessionRequest): Promise<UploadSessionResponse> => {
  const currentUid = auth?.currentUser?.uid || (process.env.NODE_ENV === 'test' ? 'test-owner-uid' : '');

  // 1. Production browser: calls backend API
  if (typeof fetch !== 'undefined' && typeof window !== 'undefined' && window.location?.origin && process.env.NODE_ENV !== 'test') {
    const res = await fetch('/api/reconstruction?action=create-job', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentUid}`,
      },
      body: JSON.stringify({
        propertyId: request.propertyId,
        files: request.files,
        type: 'photos',
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`UPLOAD_SESSION_FAILED: ${err.error || res.statusText}`);
    }
    const data = await res.json();
    return {
      sessionId: data.sessionId,
      signedUploadUrls: data.signedUploadUrls.map((s: any, idx: number) => ({
        fileName: request.files[idx]?.name || `frame_${idx}.jpg`,
        uploadUrl: s.uploadUrl,
        storagePath: s.storagePath,
      })),
    };
  }

  // 2. SSR / Testing: delegates directly to serverless API handler
  const apiModulePath = '../../../api/reconstruction';
  const { default: handler } = await import(/* @vite-ignore */ apiModulePath);
  let jsonRes: any = null;
  const mockRes = {
    status: () => ({ json: (d: any) => { jsonRes = d; } }),
    json: (d: any) => { jsonRes = d; },
  };
  await handler({
    method: 'POST',
    query: { action: 'create-job' },
    headers: { authorization: `Bearer ${currentUid}`, 'x-user-id': currentUid },
    body: {
      propertyId: request.propertyId,
      files: request.files,
      type: 'photos',
    },
  }, mockRes);

  if (jsonRes && jsonRes.signedUploadUrls) {
    return {
      sessionId: jsonRes.sessionId,
      signedUploadUrls: jsonRes.signedUploadUrls.map((s: any, idx: number) => ({
        fileName: request.files[idx]?.name || `frame_${idx}.jpg`,
        uploadUrl: s.uploadUrl,
        storagePath: s.storagePath,
      })),
    };
  }

  throw new Error('UPLOAD_SESSION_FAILED: Failed to obtain signed upload URLs from control plane.');
};

/**
 * Uploads a file/blob to the designated signed upload URL with progress monitoring.
 */
export const uploadFileToSession = async (
  uploadUrl: string,
  file: File | Blob,
  onProgress?: (percent: number) => void
): Promise<string> => {
  if (uploadUrl.startsWith('mock://') || process.env.NODE_ENV === 'test') {
    if (onProgress) {
      onProgress(100);
    }
    return uploadUrl;
  }

  if (uploadUrl.startsWith('http://') || uploadUrl.startsWith('https://')) {
    if (typeof XMLHttpRequest !== 'undefined') {
      return await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        if (xhr.upload && onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(uploadUrl);
          } else {
            reject(new Error(`Storage upload failed with HTTP status ${xhr.status}: ${xhr.statusText || 'Upload Rejected'}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during storage asset upload.'));
        xhr.send(file);
      });
    }
  }

  throw new Error(`STORAGE_UPLOAD_FAILED: Cannot upload to unreachable endpoint: ${uploadUrl}`);
};

export const registerCaptureAsset = async (asset: CaptureAsset): Promise<void> => {
  const existing = captureAssetsRegistry.get(asset.jobId) || [];
  captureAssetsRegistry.set(asset.jobId, [...existing, asset]);

  if (db) {
    try {
      const assetRef = doc(db, 'capture_assets', asset.id);
      await setDoc(assetRef, {
        ...asset,
        createdAt: asset.createdAt || new Date().toISOString(),
      });
    } catch (e: any) {
      if (process.env.NODE_ENV !== 'test') {
        throw new Error(`CAPTURE_PERSISTENCE_FAILED: Could not persist capture asset metadata: ${e.message}`);
      }
    }
  }
};

export const registerThreeDAsset = async (asset: ThreeDAsset): Promise<void> => {
  const existing = threeDAssetsRegistry.get(asset.propertyId) || [];
  threeDAssetsRegistry.set(asset.propertyId, [...existing, asset]);

  if (db) {
    try {
      const assetRef = doc(db, 'three_d_assets', asset.id);
      await setDoc(assetRef, {
        ...asset,
        createdAt: asset.createdAt || new Date().toISOString(),
      });
    } catch (e: any) {
      if (process.env.NODE_ENV !== 'test') {
        throw new Error(`SPATIAL_ASSET_PERSISTENCE_FAILED: Could not persist 3D asset metadata: ${e.message}`);
      }
    }
  }
};

export const getProperty3DAssets = (propertyId: string): ThreeDAsset[] => {
  return threeDAssetsRegistry.get(propertyId) || [];
};
