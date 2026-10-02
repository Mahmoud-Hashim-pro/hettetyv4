/**
 * HETTETY 3D Reconstruction Job & Asset Lifecycle Schema
 */

export type ReconstructionJobStatus =
  | 'QUEUED'
  | 'VALIDATING'
  | 'UPLOADING'
  | 'RECONSTRUCTING'
  | 'TRAINING'
  | 'OPTIMIZING'
  | 'PUBLISHING'
  | 'READY'
  | 'FAILED'
  | 'CANCELLED';

export type ReconstructionErrorCode =
  | 'INSUFFICIENT_OVERLAP'
  | 'TOO_FEW_IMAGES'
  | 'LOW_IMAGE_QUALITY'
  | 'RECONSTRUCTION_FAILED'
  | 'GPU_ERROR'
  | 'PROCESSING_TIMEOUT'
  | 'STORAGE_ERROR';

export interface ReconstructionJob {
  id: string;
  propertyId: string;
  ownerId: string;
  status: ReconstructionJobStatus;
  type: 'video' | 'photos' | 'hybrid';
  sourceCount: number;
  progress: number; // 0 - 100
  stage: string;
  errorCode?: ReconstructionErrorCode;
  errorMessage?: string;
  errorMessageAr?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  idempotencyKey?: string;
  pipelineVersion?: string;
}

export type CaptureAssetType = 'photo' | 'video' | 'panorama';

export interface CaptureAsset {
  id: string;
  jobId: string;
  type: CaptureAssetType;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  checksum?: string;
  metadata?: {
    focalLength?: number;
    iso?: number;
    exposureTime?: number;
    deviceModel?: string;
  };
  createdAt: string;
}

export type ThreeDAssetType =
  | 'GAUSSIAN_SPLAT'
  | 'MESH'
  | 'PANORAMA'
  | 'THUMBNAIL'
  | 'FLOORPLAN';

export interface ThreeDAsset {
  id: string;
  propertyId: string;
  jobId: string;
  type: ThreeDAssetType;
  format: 'spz' | 'glb' | 'ply' | 'jpg' | 'png';
  storagePath: string;
  publicUrl: string;
  sizeBytes: number;
  vertexCount?: number;
  splatCount?: number;
  version: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface CaptureValidationResult {
  valid: boolean;
  imageCount: number;
  resolutionOK: boolean;
  blurScore: number;     // 0 - 100
  coverageScore: number; // 0 - 100
  overlapScore: number;  // 0 - 100
  warnings: string[];
  warningsAr: string[];
  errors: string[];
  errorsAr: string[];
}
