import '@testing-library/jest-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup DOM after each test
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock window.scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  root = null;
  rootMargin = '';
  thresholds = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
  constructor() {}
} as any;

// Mock window.alert and window.confirm
window.alert = vi.fn();
window.confirm = vi.fn().mockReturnValue(true);

// Mock Firebase module defaults for test isolation
vi.mock('../src/firebase', () => {
  return {
    auth: {
      currentUser: null,
      onAuthStateChanged: vi.fn((cb) => {
        cb(null);
        return vi.fn();
      }),
    },
    db: {},
    storage: {},
    googleProvider: {},
    signInWithPopup: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChanged: vi.fn((auth, cb) => {
      cb(null);
      return vi.fn();
    }),
    doc: vi.fn(),
    getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
    setDoc: vi.fn().mockResolvedValue(undefined),
    collection: vi.fn(),
    getDocs: vi.fn().mockResolvedValue({ docs: [] }),
    query: vi.fn(),
    where: vi.fn(),
    onSnapshot: vi.fn((q, cb) => {
      cb({ docs: [] });
      return vi.fn();
    }),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    })),
    addDoc: vi.fn().mockResolvedValue({ id: 'mock-doc-id' }),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    ref: vi.fn(),
    uploadBytes: vi.fn().mockResolvedValue({ ref: {} }),
    uploadBytesResumable: vi.fn(),
    getDownloadURL: vi.fn().mockResolvedValue('https://mock-storage.url/file.png'),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    handleFirestoreError: vi.fn(),
    OperationType: { GET: 'GET', LIST: 'LIST', CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
  };
});
