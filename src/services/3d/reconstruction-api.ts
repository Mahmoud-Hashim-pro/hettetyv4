/**
 * HETTETY 3D — Reconstruction Control Plane API Client
 * Manages authenticated job submission, signed upload sessions, durable cancellation/retries,
 * and Firestore real-time status subscriptions.
 */

import { auth, db } from '../../firebase';
import { ReconstructionJob, ThreeDTour } from '../../types';
import {
  createReconstructionJob,
  getReconstructionJob,
  updateJobStatus,
  cancelReconstructionJob,
  retryReconstructionJob,
  subscribeToJob,
} from './reconstruction-service';
import {
  createUploadSession,
  uploadFileToSession,
  registerCaptureAsset,
  UploadSessionResponse,
} from './asset-service';

export interface SubmitReconstructionParams {
  propertyId: string;
  files: File[];
  type: 'photos' | 'video' | 'hybrid';
  referenceAnchors?: any[];
  idempotencyKey?: string;
  onProgress?: (progress: { stage: string; percent: number }) => void;
}

export interface ReconstructionApiResult {
  job: ReconstructionJob;
  uploadSession: UploadSessionResponse;
}

export class ReconstructionApiClient {
  /**
   * Submits a reconstruction job with authenticated owner identity, creates signed upload sessions,
   * uploads the capture keyframes, and returns the tracked job.
   */
  static async submitJob(params: SubmitReconstructionParams): Promise<ReconstructionApiResult> {
    const { propertyId, files, type, referenceAnchors, idempotencyKey, onProgress } = params;

    const currentUid = auth?.currentUser?.uid || (process.env.NODE_ENV === 'test' ? 'test-owner-uid' : '');
    if (!currentUid) {
      throw new Error('AUTHENTICATION_REQUIRED: User must be signed in to submit 3D reconstruction jobs.');
    }

    if (!files || files.length === 0) {
      throw new Error('INVALID_INPUT: At least one capture file is required for 3D reconstruction.');
    }

    // 1. Create job in QUEUED status
    const job = createReconstructionJob({
      propertyId,
      ownerId: currentUid,
      type: type === 'video' ? 'video' : 'photos',
      sourceCount: files.length,
      idempotencyKey,
    });

    if (onProgress) {
      onProgress({ stage: 'UPLOADING', percent: 10 });
    }

    // 2. Create signed upload session
    const uploadSession = createUploadSession({
      propertyId,
      files: files.map((f) => ({ name: f.name, sizeBytes: f.size, mimeType: f.type })),
    });

    // 3. Upload files to session
    updateJobStatus(job.id, 'UPLOADING', 15, 'Uploading capture keyframes');
    const totalFiles = Math.min(files.length, uploadSession.signedUploadUrls.length);

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
      const target = uploadSession.signedUploadUrls[i];
      await uploadFileToSession(target.uploadUrl, file, (filePercent) => {
        if (onProgress) {
          const overall = Math.round(15 + (i / totalFiles) * 20 + (filePercent / 100) * (20 / totalFiles));
          onProgress({ stage: 'UPLOADING', percent: overall });
        }
      });

      await registerCaptureAsset({
        id: `cap-${job.id}-${i}`,
        jobId: job.id,
        type: type === 'video' ? 'video' : 'photo',
        storagePath: target.storagePath,
        sizeBytes: file.size,
        mimeType: file.type,
        createdAt: new Date().toISOString(),
      });
    }

    updateJobStatus(job.id, 'VALIDATING', 35, 'Media uploaded — waiting for worker SfM processing');
    if (onProgress) {
      onProgress({ stage: 'VALIDATING', percent: 35 });
    }

    return { job, uploadSession };
  }

  /**
   * Requests cancellation of an in-flight reconstruction job.
   */
  static cancelJob(jobId: string): boolean {
    return cancelReconstructionJob(jobId);
  }

  /**
   * Requests durable retry of a failed or cancelled reconstruction job.
   */
  static retryJob(jobId: string): ReconstructionJob | null {
    return retryReconstructionJob(jobId);
  }

  /**
   * Retrieves current status of a job.
   */
  static getJobStatus(jobId: string): ReconstructionJob | null {
    return getReconstructionJob(jobId);
  }

  /**
   * Subscribes to real-time status updates from Firestore.
   */
  static subscribe(jobId: string, callback: (job: ReconstructionJob) => void): () => void {
    return subscribeToJob(jobId, callback);
  }
}
