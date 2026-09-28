import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'tests/**/*.spec.{ts,tsx}'],
    // Most of these files mount the whole App in jsdom. One worker per core had
    // them competing for the machine, and a render that normally takes a moment
    // would miss the default 5s — the suite failed in a different file each run.
    testTimeout: 20000,
    hookTimeout: 20000,
    poolOptions: { threads: { maxThreads: 6 } },
    // Not restoreMocks: tests/setup.ts installs the firebase module mock and the
    // matchMedia stub once for the file, and restoring after each test strips
    // them from every test but the first.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
