/**
 * GET /api/ai?health=1 — live advisor health & configuration probe.
 * POST /api/ai — the app's single AI entry point.
 *
 * The browser posts a provider-neutral request here; this function holds the
 * vendor keys server-side and routes each request to the provider configured for
 * that task. Vendors are env-var config, and no key ships in the Vite bundle.
 *
 * Global env:
 *   AI_PROVIDER   gemini (default) | nvidia | openrouter | together | groq | openai
 *   AI_MODEL      override the provider's default model (Gemini default: gemini-2.5-flash)
 *   <VENDOR>_API_KEY  e.g. GEMINI_API_KEY, NVIDIA_API_KEY, GROQ_API_KEY
 *
 * Per-task routing (all optional — see _lib/router.ts):
 *   AI_TASK_CHAT_PROVIDER / _MODEL       conversational assistant
 *   AI_TASK_SEARCH_PROVIDER / _MODEL     natural-language search -> JSON
 *   AI_TASK_DESCRIBE_PROVIDER / _MODEL   listing description writer
 *   AI_TASK_BROCHURE_PROVIDER / _MODEL   brochure import (needs PDF support)
 *   AI_TASK_OCR_PROVIDER / _MODEL        registry-number extraction from a deed
 */
import type { AdvisorHealthStatus } from '../src/core/domain/entities.js';
import { resolveFileUrls } from './_lib/fetchFile.js';
import { resolve, buildProvider } from './_lib/router.js';
import { AI_TASKS, AIRequest, Message, ProviderError, isTransientStatus } from './_lib/types.js';
import {
  checkDistributedRateLimit,
  acquireConcurrencySlot,
  releaseConcurrencySlot,
  sanitizeClientIdentifier,
  getActiveRateLimiterBackend,
} from './_lib/rateLimiter.js';
import {
  verifyAuthHeader,
  verifyFirebaseIdTokenLightweight,
  getQueryParams,
} from './_lib/auth.js';

// Vercel rejects a body over ~4.5MB at the edge before this function runs, so a
// larger ceiling here would just be a number that never applies. Measured on
// production: 4.0MB passes, 4.4MB returns FUNCTION_PAYLOAD_TOO_LARGE.
const MAX_BODY_CHARS = 4_000_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries transient provider failures with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 600): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? 0;
      if (!isTransientStatus(status) || attempt === retries) throw err;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

/** Rejects malformed bodies before they reach a paid provider. */
function validate(body: any): AIRequest {
  if (!body || typeof body !== 'object') throw new ProviderError('Body must be a JSON object', 400);
  const contents = body.contents;
  if (!Array.isArray(contents) || contents.length === 0) {
    throw new ProviderError('`contents` must be a non-empty array', 400);
  }
  for (const m of contents as Message[]) {
    if (!m || (m.role !== 'user' && m.role !== 'model')) {
      throw new ProviderError('Each message needs role "user" or "model"', 400);
    }
    if (!Array.isArray(m.parts) || m.parts.length === 0) {
      throw new ProviderError('Each message needs a non-empty `parts` array', 400);
    }
    for (const part of m.parts) {
      if (part && 'fileUrl' in part && (typeof (part as any).fileUrl?.url !== 'string')) {
        throw new ProviderError('`fileUrl` needs a `url` string', 400);
      }
    }
  }
  if (body.responseMimeType && body.responseMimeType !== 'text/plain' && body.responseMimeType !== 'application/json') {
    throw new ProviderError('`responseMimeType` must be text/plain or application/json', 400);
  }
  if (body.task && !AI_TASKS.includes(body.task)) {
    throw new ProviderError(`Unknown task "${body.task}"`, 400);
  }
  return {
    task: body.task,
    contents,
    systemInstruction: typeof body.systemInstruction === 'string' ? body.systemInstruction : undefined,
    responseMimeType: body.responseMimeType,
    responseSchema: body.responseSchema,
    model: typeof body.model === 'string' ? body.model : undefined,
  };
}

/** Computes a safe, secret-free diagnostic snapshot for GET /api/ai?health=1 */
export function buildAdvisorHealthStatus(): AdvisorHealthStatus {
  const start = Date.now();
  const providerName = (process.env.AI_PROVIDER || 'gemini').toLowerCase().trim();
  const rateLimiterBackend = getActiveRateLimiterBackend();
  const timestamp = new Date().toISOString();

  let hasApiKey = false;
  let model = process.env.AI_MODEL || (providerName === 'gemini' ? 'gemini-2.5-flash' : '');
  let fallbackModel: string | undefined =
    process.env.AI_FALLBACK_MODEL ||
    (providerName === 'gemini' && model !== 'gemini-2.0-flash' ? 'gemini-2.0-flash' : undefined);
  let providerErrorMsg = '';

  try {
    const provider = buildProvider(providerName);
    hasApiKey = true;
    model = provider.defaultModel || model;
    fallbackModel = provider.fallbackModel;
  } catch (err: any) {
    hasApiKey = false;
    providerErrorMsg = err?.message || 'AI provider API key is missing';
  }

  const rateLimiterHealthy =
    process.env.NODE_ENV !== 'production' || rateLimiterBackend !== 'memory';
  const healthy = hasApiKey && rateLimiterHealthy;

  const diagnosticParts: string[] = [];
  if (!hasApiKey) {
    diagnosticParts.push(providerErrorMsg || `Missing API key for provider "${providerName}".`);
  }
  if (!rateLimiterHealthy) {
    diagnosticParts.push(
      'Production rate limiter has no distributed backend; configure Neon DATABASE_URL or REDIS_URL.'
    );
  }
  if (diagnosticParts.length === 0) {
    diagnosticParts.push(
      `Ready on ${providerName} (${model}${fallbackModel ? `, fallback: ${fallbackModel}` : ''}) with ${rateLimiterBackend} rate limiter.`
    );
  }

  return {
    healthy,
    provider: providerName,
    model: model || 'unconfigured',
    fallbackModel,
    rateLimiterBackend,
    hasApiKey,
    latencyMs: Math.max(1, Date.now() - start),
    timestamp,
    diagnostics: diagnosticParts.join(' '),
  };
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Health probe: GET /api/ai?health=1
  if (req.method === 'GET') {
    const query = getQueryParams(req);
    if (query.health === '1' || query.health === 'true' || query.action === 'health') {
      const status = buildAdvisorHealthStatus();
      return res.status(200).json(status);
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST or GET /api/ai?health=1.' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting & concurrency protection
  const rawIp = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || req.socket?.remoteAddress || '127.0.0.1';
  const ip = sanitizeClientIdentifier(Array.isArray(rawIp) ? rawIp[0] : String(rawIp));

  let userId: string | undefined = undefined;
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader && String(authHeader).startsWith('Bearer ')) {
    const idToken = String(authHeader).slice(7).trim();

    // 1. Verify Neon HMAC-SHA256 JWT token first
    const verifiedNeon = verifyAuthHeader(req);
    if (verifiedNeon) {
      userId = verifiedNeon.uid;
    } else if (
      process.env.NODE_ENV === 'test' &&
      (idToken.startsWith('test_') || idToken.startsWith('mock_') || idToken.length < 50)
    ) {
      // 2. Unit test harness tokens ONLY in NODE_ENV === 'test'
      userId = idToken;
    } else {
      // 3. Bridge: verify RS256 Firebase ID token if valid, else reject cleanly with 401
      const fbUser = await verifyFirebaseIdTokenLightweight(idToken);
      if (fbUser) {
        userId = fbUser.uid;
      } else {
        return res.status(401).json({
          error: 'Unauthorized: Invalid or expired auth token.',
          transient: false,
        });
      }
    }
  } else if (process.env.NODE_ENV === 'test' && req.headers?.['x-user-id']) {
    userId = String(req.headers['x-user-id']);
  }

  // Concurrency guard per client IP (max 5 simultaneous active requests)
  if (!acquireConcurrencySlot(ip, 5)) {
    return res.status(429).json({
      error: 'Too many concurrent AI requests. Please wait a moment before trying again.',
      transient: true,
    });
  }

  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    if (raw.length > MAX_BODY_CHARS) {
      return res.status(413).json({ error: 'Request too large' });
    }
    const parsed = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;

    // Multi-tier distributed rate limit check (IP + User ID + Task)
    const rateLimit = await checkDistributedRateLimit({
      ip,
      userId,
      task: parsed?.task,
    });
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return res.status(429).json({
        error: rateLimit.reason ? `Rate limit exceeded: ${rateLimit.reason}` : 'Too many AI requests. Please wait a moment before trying again.',
        transient: true,
      });
    }

    const aiReq = validate(parsed);
    // Any fileUrl becomes inline bytes here, so routing and every provider below
    // see one shape: a message made of text and inline data.
    aiReq.contents = await resolveFileUrls(aiReq.contents, userId);

    const { provider, model: primary, note } = resolve(aiReq);

    let text: string;
    let used = primary;
    try {
      text = await withRetry(() => provider.generate(aiReq, primary));
    } catch (err: any) {
      // Still overloaded after retries — try the cheaper/stabler model once.
      const status = err?.status ?? 0;
      if (isTransientStatus(status) && provider.fallbackModel && provider.fallbackModel !== primary) {
        used = provider.fallbackModel;
        text = await withRetry(() => provider.generate(aiReq, provider.fallbackModel!), 1);
      } else {
        throw err;
      }
    }

    return res.status(200).json({ text, provider: provider.name, model: used, task: aiReq.task, note });
  } catch (err: any) {
    const status = err instanceof ProviderError ? err.status : 500;
    // Misconfiguration returns 500 but is NOT worth retrying, so trust the
    // error's own flag rather than inferring it from the status code.
    const transient = err instanceof ProviderError ? err.transient : isTransientStatus(status);
    // Log server-side with detail; return a safe message to the browser.
    console.error('[api/ai]', status, err?.message);
    return res.status(status).json({
      error: err?.message || 'AI request failed',
      transient,
    });
  } finally {
    releaseConcurrencySlot(ip);
  }
}
