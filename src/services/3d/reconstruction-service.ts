/**
 * HETTETY 3D - Reconstruction Job Service
 * Orchestrates job submission, idempotency caching, stage tracking, and persistent job state.
 */

import { ReconstructionJob, ReconstructionJobStatus, ReconstructionErrorCode } from '../../types';

export interface CreateJobParams {
  propertyId: string;
  ownerId: string;
  type: 'video' | 'photos' | 'hybrid';
  sourceCount: number;
  idempotencyKey?: string;
}

const STORAGE_KEY = 'hettety_3d_reconstruction_jobs';

// In-memory registry with localStorage synchronization for web clients
const activeJobs = new Map<string, ReconstructionJob>();
const listeners = new Map<string, Set<(job: ReconstructionJob) => void>>();

// Hydrate from localStorage if in browser environment
const hydrateFromStorage = () => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: ReconstructionJob[] = JSON.parse(raw);
      for (const j of parsed) {
        if (j && j.id && !activeJobs.has(j.id)) {
          activeJobs.set(j.id, j);
        }
      }
    }
  } catch {
    // Ignore storage parse errors
  }
};

const persistToStorage = () => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const jobsArray = Array.from(activeJobs.values());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobsArray));
  } catch {
    // Ignore storage quota or access errors
  }
};

hydrateFromStorage();

const notifyListeners = (job: ReconstructionJob) => {
  const subs = listeners.get(job.id);
  if (subs) {
    subs.forEach(cb => {
      try { cb(job); } catch (e) { console.error('Error in job listener:', e); }
    });
  }
};

export const subscribeToJob = (jobId: string, callback: (job: ReconstructionJob) => void): (() => void) => {
  if (!listeners.has(jobId)) {
    listeners.set(jobId, new Set());
  }
  listeners.get(jobId)!.add(callback);

  // Immediate callback if job already exists
  const existing = activeJobs.get(jobId);
  if (existing) {
    callback(existing);
  }

  return () => {
    const subs = listeners.get(jobId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) listeners.delete(jobId);
    }
  };
};

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
  persistToStorage();
  notifyListeners(newJob);
  return newJob;
};

export const getReconstructionJob = (jobId: string): ReconstructionJob | null => {
  return activeJobs.get(jobId) || null;
};

export const listJobsForProperty = (propertyId: string): ReconstructionJob[] => {
  return Array.from(activeJobs.values()).filter(j => j.propertyId === propertyId);
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

  const updated = { ...job };
  activeJobs.set(jobId, updated);
  persistToStorage();
  notifyListeners(updated);
  return updated;
};

export const cancelReconstructionJob = (jobId: string): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status === 'READY') return false;
  job.status = 'CANCELLED';
  job.completedAt = new Date().toISOString();
  const updated = { ...job };
  activeJobs.set(jobId, updated);
  persistToStorage();
  notifyListeners(updated);
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

  const updated = { ...job };
  activeJobs.set(jobId, updated);
  persistToStorage();
  notifyListeners(updated);
  return updated;
};
