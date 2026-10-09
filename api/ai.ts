/**
 * POST /api/ai — the app's single AI entry point.
 *
 * The browser posts a provider-neutral request here; this function holds the
 * vendor keys server-side and routes each request to the provider configured for
 * that task. Vendors are env-var config, and no key ships in the Vite bundle.
 *
 * Global env:
 *   AI_PROVIDER   gemini (default) | nvidia | openrouter | together | groq | openai
 *   AI_MODEL      override the provider's default model
 *   <VENDOR>_API_KEY  e.g. GEMINI_API_KEY, NVIDIA_API_KEY, GROQ_API_KEY
 *
 * Per-task routing (all optional — see _lib/router.ts):
 *   AI_TASK_CHAT_PROVIDER / _MODEL       conversational assistant
 *   AI_TASK_SEARCH_PROVIDER / _MODEL     natural-language search -> JSON
 *   AI_TASK_DESCRIBE_PROVIDER / _MODEL   listing description writer
 *   AI_TASK_BROCHURE_PROVIDER / _MODEL   brochure import (needs PDF support)
 *   AI_TASK_OCR_PROVIDER / _MODEL        registry-number extraction from a deed
 */
import { resolveFileUrls } from './_lib/fetchFile.js';
import { resolve } from './_lib/router.js';
import { AI_TASKS, AIRequest, Message, ProviderError, isTransientStatus } from './_lib/types.js';
import {
  checkDistributedRateLimit,
  acquireConcurrencySlot,
  releaseConcurrencySlot,
  sanitizeClientIdentifier,
} from './_lib/rateLimiter.js';

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

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting & concurrency protection
  const rawIp = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || req.socket?.remoteAddress || '127.0.0.1';
  const ip = sanitizeClientIdentifier(Array.isArray(rawIp) ? rawIp[0] : String(rawIp));
  const userId = req.headers?.['x-user-id'] || (req.headers?.authorization ? String(req.headers.authorization).slice(0, 32) : undefined);

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
    aiReq.contents = await resolveFileUrls(aiReq.contents);

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
