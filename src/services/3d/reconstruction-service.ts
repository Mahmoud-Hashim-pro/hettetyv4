/**
 * HETTETY 3D - Reconstruction Job Service
 * Orchestrates job submission, idempotency caching, stage tracking, and persistent Firestore database records.
 * Database is the definitive source of truth across browser sessions and devices.
 */

import { ReconstructionJob, ReconstructionJobStatus, ReconstructionErrorCode } from '../../types';
import { db } from '../../firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';

export interface CreateJobParams {
  id?: string;
  propertyId: string;
  ownerId: string;
  type: 'video' | 'photos' | 'hybrid';
  sourceCount: number;
  idempotencyKey?: string;
}

const STORAGE_KEY = 'hettety_3d_reconstruction_jobs';
const COLLECTION_NAME = 'reconstruction_jobs';

// Memory cache + local persistence
const activeJobs = new Map<string, ReconstructionJob>();
const listeners = new Map<string, Set<(job: ReconstructionJob) => void>>();
const firestoreUnsubs = new Map<string, () => void>();

// Hydrate from localStorage for offline/immediate startup
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
 * Subscribes to real-time status updates from Firestore (or local listener fallback).
 */
export const subscribeToJob = (jobId: string, callback: (job: ReconstructionJob) => void): (() => void) => {
  if (!listeners.has(jobId)) {
    listeners.set(jobId, new Set());
  }
  listeners.get(jobId)!.add(callback);

  // Return immediate cached state if present
  const existing = activeJobs.get(jobId);
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
            activeJobs.set(jobId, data);
            persistToStorage();
            notifyListeners(data);
          }
        },
        (err) => {
          console.warn(`Firestore subscription note for ${jobId}:`, err);
        }
      );
      firestoreUnsubs.set(jobId, unsub);
    } catch (e) {
      // In tests without active firestore network, fallback is active
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

export const createReconstructionJob = (params: CreateJobParams): ReconstructionJob => {
  const { id: explicitId, propertyId, ownerId, type, sourceCount, idempotencyKey } = params;

  if (explicitId && activeJobs.has(explicitId)) {
    return activeJobs.get(explicitId)!;
  }

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

  activeJobs.set(jobId, newJob);
  persistToStorage();
  notifyListeners(newJob);

  // Persist asynchronously to Firestore
  if (db) {
    try {
      setDoc(doc(db, COLLECTION_NAME, jobId), newJob).catch(err => {
        console.warn('Firestore setDoc note for reconstruction job:', err);
      });
    } catch (e) {
      // Offline fallback
    }
  }

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

  // Sync to Firestore
  if (db) {
    try {
      updateDoc(doc(db, COLLECTION_NAME, jobId), {
        status,
        progress,
        stage,
        ...(errorCode ? { errorCode } : {}),
        ...(errorMessage ? { errorMessage } : {}),
        ...(job.completedAt ? { completedAt: job.completedAt } : {}),
        updatedAt: new Date().toISOString(),
      }).catch(() => {
        // Fallback
      });
    } catch {
      // Offline fallback
    }
  }

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

  if (db) {
    try {
      updateDoc(doc(db, COLLECTION_NAME, jobId), {
        status: 'CANCELLED',
        completedAt: updated.completedAt,
      }).catch(() => {});
    } catch {}
  }

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

  if (db) {
    try {
      setDoc(doc(db, COLLECTION_NAME, jobId), updated).catch(() => {});
    } catch {}
  }

  return updated;
};
