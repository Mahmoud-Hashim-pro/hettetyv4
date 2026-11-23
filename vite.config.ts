import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Serves /api/* from the `api/` folder during `vite dev`.
 *
 * In production Vercel runs those files as serverless functions; without this
 * the dev server would 404 on /api/ai and every AI feature would look broken
 * locally. The handler is imported through Vite's SSR pipeline so TypeScript and
 * hot-reload work, and .env is loaded so the provider key resolves the same way
 * it does on the server.
 */
function apiDevServer(): Plugin {
  return {
    name: 'local-api-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/')) return next();

        const route = url.split('?')[0].replace(/^\/api\//, '').replace(/\/$/, '');
        try {
          const mod = await server.ssrLoadModule(`/api/${route}.ts`);
          const handler = mod.default;
          if (typeof handler !== 'function') return next();

          // Buffer the body so the handler sees req.body like it does on Vercel.
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString('utf8');
          (req as any).body = raw ? JSON.parse(raw) : {};

          // Minimal Vercel-style res shim.
          const shim = {
            status(code: number) { res.statusCode = code; return shim; },
            json(payload: unknown) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(payload));
              return shim;
            },
            setHeader(k: string, v: string) { res.setHeader(k, v); return shim; },
            end(body?: string) { res.end(body); return shim; },
          };
          await handler(req, shim);
        } catch (err: any) {
          // A missing route file just isn't ours — anything else is a real error.
          if (err?.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(String(err?.message))) return next();
          server.config.logger.error(`[api dev] ${route}: ${err?.message}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Local API error: ' + (err?.message || 'unknown') }));
        }
      });
    },
  };
}

export default defineConfig({
  // No `define` for API keys any more: the browser never sees a model key.
  // /api/ai holds it server-side, so nothing secret is baked into the bundle.
  plugins: [react(), tailwindcss(), apiDevServer()],
  build: {
    rollupOptions: {
      output: {
        // NOTE: three.js is intentionally NOT listed here — putting it in
        // manualChunks makes Vite modulepreload it on first paint (~300KB
        // gzip). It is code-split naturally via the lazy Property3DViewer.
        manualChunks: {
          vendor: ['react', 'react-dom', 'motion', 'lucide-react'],
        },
      },
    },
  },
});
