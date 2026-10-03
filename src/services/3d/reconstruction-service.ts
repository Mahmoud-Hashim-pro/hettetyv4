/**
 * HETTETY 3D - Reconstruction Service (Client-Side Read & Subscription Layer)
 * Listens to server-authoritative reconstruction jobs from Firestore 'reconstruction_jobs' collection.
 * The client NEVER manufactures authoritative reconstruction state or mutates worker-owned stages directly.
 * LocalStorage acts strictly as an optimistic read-only UI cache ('cachedJobView'), never the source of truth.
 */

import { ReconstructionJob, ReconstructionJobStatus, ReconstructionErrorCode } from '../../types';
import { db } from '../../firebase';
import { doc, getDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';

export interface CreateJobParams {
  id?: string;
  propertyId: string;
  ownerId: string;
  type: 'video' | 'photos' | 'hybrid';
  sourceCount: number;
  idempotencyKey?: string;
}

const STORAGE_KEY = 'hettety_3d_cached_jobs_view';
const COLLECTION_NAME = 'reconstruction_jobs';

// Client-side read-only cached view of jobs
export const cachedJobView = new Map<string, ReconstructionJob>();
export const activeJobs = cachedJobView; // Backwards compatibility alias

const listeners = new Map<string, Set<(job: ReconstructionJob) => void>>();
const firestoreUnsubs = new Map<string, () => void>();

// Hydrate read cache from localStorage for instant offline startup
const hydrateFromStorage = () => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: ReconstructionJob[] = JSON.parse(raw);
      for (const j of parsed) {
        if (j && j.id && !cachedJobView.has(j.id)) {
          cachedJobView.set(j.id, j);
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
    const jobsArray = Array.from(cachedJobView.values());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobsArray));
  } catch {
    // Ignore storage quota errors
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

/**
 * Subscribes to real-time status updates from Firestore (Authoritative source of truth).
 */
export const subscribeToJob = (jobId: string, callback: (job: ReconstructionJob) => void): (() => void) => {
  if (!listeners.has(jobId)) {
    listeners.set(jobId, new Set());
  }
  listeners.get(jobId)!.add(callback);

  // Return immediate cached state if present
  const existing = cachedJobView.get(jobId);
  if (existing) {
    callback(existing);
  }

  // Subscribe to real Firestore document if db is initialized
  if (db && !firestoreUnsubs.has(jobId)) {
    try {
      const jobDocRef = doc(db, COLLECTION_NAME, jobId);
      const unsub = onSnapshot(
        jobDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as ReconstructionJob;
            cachedJobView.set(jobId, data);
            persistToStorage();
            notifyListeners(data);
          }
        },
        (err) => {
          console.warn(`Firestore subscription note for ${jobId}:`, err);
        }
      );
      firestoreUnsubs.set(jobId, unsub);
    } catch {
      // Offline fallback
    }
  }

  return () => {
    const subs = listeners.get(jobId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) {
        listeners.delete(jobId);
        const fsUnsub = firestoreUnsubs.get(jobId);
        if (fsUnsub) {
          fsUnsub();
          firestoreUnsubs.delete(jobId);
        }
      }
    }
  };
};

/**
 * Registers a job into the client-side cached view (hydrated from backend control plane response)
 */
export const createReconstructionJob = (params: CreateJobParams): ReconstructionJob => {
  const { id: explicitId, propertyId, ownerId, type, sourceCount, idempotencyKey } = params;

  if (explicitId && cachedJobView.has(explicitId)) {
    return cachedJobView.get(explicitId)!;
  }

  if (idempotencyKey) {
    const existingByKey = Array.from(cachedJobView.values()).find(
      j => j.idempotencyKey === idempotencyKey && j.status !== 'FAILED' && j.status !== 'CANCELLED'
    );
    if (existingByKey) return existingByKey;
  }

  const existingActive = Array.from(cachedJobView.values()).find(
    j => j.propertyId === propertyId &&
      ['QUEUED', 'VALIDATING', 'UPLOADING', 'RECONSTRUCTING', 'TRAINING', 'OPTIMIZING', 'PUBLISHING'].includes(j.status)
  );
  if (existingActive) return existingActive;

  const jobId = explicitId || `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
    pipelineVersion: '2.0.0',
  };

  cachedJobView.set(jobId, newJob);
  persistToStorage();
  notifyListeners(newJob);

  return newJob;
};

export const getReconstructionJob = (jobId: string): ReconstructionJob | null => {
  return cachedJobView.get(jobId) || null;
};

export const listJobsForProperty = (propertyId: string): ReconstructionJob[] => {
  return Array.from(cachedJobView.values()).filter(j => j.propertyId === propertyId);
};

/**
 * Local UI optimistic state update (client MUST NOT mutate worker-owned stages in Firestore directly)
 */
export const updateJobStatus = (
  jobId: string,
  status: ReconstructionJobStatus,
  progress: number,
  stage: string,
  errorCode?: ReconstructionErrorCode,
  errorMessage?: string
): ReconstructionJob | null => {
  const job = cachedJobView.get(jobId);
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
  cachedJobView.set(jobId, updated);
  persistToStorage();
  notifyListeners(updated);

  return updated;
};

export const cancelReconstructionJob = (jobId: string): boolean => {
  const job = cachedJobView.get(jobId);
  if (!job || job.status === 'READY') return false;
  job.status = 'CANCELLED';
  job.completedAt = new Date().toISOString();
  const updated = { ...job };
  cachedJobView.set(jobId, updated);
  persistToStorage();
  notifyListeners(updated);
  return true;
};

export const retryReconstructionJob = (jobId: string): ReconstructionJob | null => {
  const job = cachedJobView.get(jobId);
  if (!job || !['FAILED', 'CANCELLED'].includes(job.status)) return null;

  job.status = 'QUEUED';
  job.progress = 5;
  job.stage = 'QUEUED';
  job.errorCode = undefined;
  job.errorMessage = undefined;
  job.completedAt = undefined;
  job.startedAt = new Date().toISOString();
  job.retryCount = (job.retryCount || 0) + 1;

  const updated = { ...job };
  cachedJobView.set(jobId, updated);
  persistToStorage();
  notifyListeners(updated);
  return updated;
};
