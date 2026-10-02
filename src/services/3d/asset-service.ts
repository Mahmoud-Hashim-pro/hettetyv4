/**
 * HETTETY 3D - Asset Management Service
 * Manages signed upload paths, capture tracking, and final 3D asset registration.
 */

import { CaptureAsset, ThreeDAsset } from '../../types';

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

export const registerCaptureAsset = (asset: CaptureAsset): void => {
  const existing = captureAssetsRegistry.get(asset.jobId) || [];
  captureAssetsRegistry.set(asset.jobId, [...existing, asset]);
};

export const registerThreeDAsset = (asset: ThreeDAsset): void => {
  const existing = threeDAssetsRegistry.get(asset.propertyId) || [];
  threeDAssetsRegistry.set(asset.propertyId, [...existing, asset]);
};

export const getProperty3DAssets = (propertyId: string): ThreeDAsset[] => {
  return threeDAssetsRegistry.get(propertyId) || [];
};
