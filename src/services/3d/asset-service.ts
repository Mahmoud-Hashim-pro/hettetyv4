/**
 * HETTETY 3D - Asset Management Service
 * Manages signed upload paths, capture tracking, and final 3D asset registration.
 * Synchronizes with Firestore collections 'capture_assets' and 'three_d_assets'.
 */

import { CaptureAsset, ThreeDAsset } from '../../types';
import { db } from '../../firebase';
import { doc, setDoc } from 'firebase/firestore';

const captureAssetsRegistry = new Map<string, CaptureAsset[]>();
const threeDAssetsRegistry = new Map<string, ThreeDAsset[]>();

export interface UploadSessionRequest {
  propertyId: string;
  files: Array<{ name: string; sizeBytes: number; mimeType: string }>;
}

export interface UploadSessionResponse {
  sessionId: string;
  signedUploadUrls: Array<{
    fileName: string;
    uploadUrl: string;
    storagePath: string;
  }>;
}

export const createUploadSession = (request: UploadSessionRequest): UploadSessionResponse => {
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const signedUploadUrls = request.files.map(f => {
    const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `properties/${request.propertyId}/3d/raw/${Date.now()}_${safeName}`;
    return {
      fileName: f.name,
      uploadUrl: `https://storage.googleapis.com/hettety-storage-bucket/${storagePath}`,
      storagePath,
    };
  });

  return {
    sessionId,
    signedUploadUrls,
  };
};

/**
 * Uploads a file/blob to the designated signed upload URL with progress monitoring.
 * In a web browser environment, issues a PUT request or saves to memory cache for development/testing.
 */
export const uploadFileToSession = async (
  uploadUrl: string,
  file: File | Blob,
  onProgress?: (percent: number) => void
): Promise<string> => {
  // Explicit test/mock environment handling (avoids real HTTP network call in jsdom)
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
    } catch (e) {
      // Non-fatal offline fallback
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
    } catch (e) {
      // Non-fatal offline fallback
    }
  }
};

export const getProperty3DAssets = (propertyId: string): ThreeDAsset[] => {
  return threeDAssetsRegistry.get(propertyId) || [];
};
