/**
 * HETTETY 3D - Reconstruction Job Service
 * Orchestrates job submission, idempotency caching, stage tracking, and pipeline simulations.
 */

import { ReconstructionJob, ReconstructionJobStatus, ReconstructionErrorCode } from '../../types';

export interface CreateJobParams {
  propertyId: string;
  ownerId: string;
  type: 'video' | 'photos' | 'hybrid';
  sourceCount: number;
  idempotencyKey?: string;
}

// In-memory registry for jobs during session
const activeJobs = new Map<string, ReconstructionJob>();

export const createReconstructionJob = (params: CreateJobParams): ReconstructionJob => {
  const { propertyId, ownerId, type, sourceCount, idempotencyKey } = params;

  // Idempotency check: if a job already exists with this key or active for this property, return it
  if (idempotencyKey) {
    const existingByKey = Array.from(activeJobs.values()).find(
      j => j.idempotencyKey === idempotencyKey && j.status !== 'FAILED' && j.status !== 'CANCELLED'
    );
    if (existingByKey) return existingByKey;
  }

  const existingActive = Array.from(activeJobs.values()).find(
    j => j.propertyId === propertyId &&
      ['QUEUED', 'VALIDATING', 'UPLOADING', 'RECONSTRUCTING', 'TRAINING', 'OPTIMIZING', 'PUBLISHING'].includes(j.status)
  );
  if (existingActive) return existingActive;

  const jobId = `job-3d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  const newJob: ReconstructionJob = {
    id: jobId,
    propertyId,
    ownerId,
    status: 'QUEUED',
    type,
    sourceCount,
    progress: 5,
    stage: 'QUEUED',
    createdAt: now,
    startedAt: now,
    idempotencyKey: idempotencyKey || `${propertyId}-${Date.now()}`,
    pipelineVersion: '1.0.0',
  };

  activeJobs.set(jobId, newJob);
  return newJob;
};

export const getReconstructionJob = (jobId: string): ReconstructionJob | null => {
  return activeJobs.get(jobId) || null;
};

export const updateJobStatus = (
  jobId: string,
  status: ReconstructionJobStatus,
  progress: number,
  stage: string,
  errorCode?: ReconstructionErrorCode,
  errorMessage?: string
): ReconstructionJob | null => {
  const job = activeJobs.get(jobId);
  if (!job) return null;

  job.status = status;
  job.progress = progress;
  job.stage = stage;
  if (errorCode) job.errorCode = errorCode;
  if (errorMessage) job.errorMessage = errorMessage;
  if (status === 'READY' || status === 'FAILED' || status === 'CANCELLED') {
    job.completedAt = new Date().toISOString();
  }

  activeJobs.set(jobId, { ...job });
  return job;
};

export const cancelReconstructionJob = (jobId: string): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status === 'READY') return false;
  job.status = 'CANCELLED';
  job.completedAt = new Date().toISOString();
  activeJobs.set(jobId, { ...job });
  return true;
};

export const retryReconstructionJob = (jobId: string): ReconstructionJob | null => {
  const job = activeJobs.get(jobId);
  if (!job || (job.status !== 'FAILED' && job.status !== 'CANCELLED')) {
    return null;
  }

  job.status = 'QUEUED';
  job.progress = 5;
  job.stage = 'QUEUED';
  job.errorCode = undefined;
  job.errorMessage = undefined;
  job.errorMessageAr = undefined;
  job.completedAt = undefined;
  job.startedAt = new Date().toISOString();
  job.retryCount = (job.retryCount || 0) + 1;

  activeJobs.set(jobId, { ...job });
  return job;
};

