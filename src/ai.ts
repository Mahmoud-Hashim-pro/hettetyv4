/**
 * Client-side AI access.
 *
 * The browser no longer talks to a model vendor directly and holds no API key —
 * every request goes to our own /api/ai serverless function, which keeps the key
 * server-side and forwards it to whichever provider is configured (Gemini,
 * NVIDIA, OpenRouter, …). Swapping vendors is a server env-var change; nothing
 * here or in the components needs to move.
 */

import type { AdvisorFinancialProfile } from './types';
import type { AdvisorHealthStatus } from './core/domain/entities';
import { getAuthToken } from './infrastructure/neon/NeonClient';

/** Request timeout ceiling so browser calls to /api/ai never hang indefinitely. */
const AI_REQUEST_TIMEOUT_MS = 25_000;
const AI_HEALTH_TIMEOUT_MS = 10_000;

/** JSON-Schema type names, replacing the vendor SDK's `Type` enum. */
export const Type = {
  STRING: 'string',
  NUMBER: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  OBJECT: 'object',
} as const;

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
export interface Message { role: 'user' | 'model'; parts: Part[] }

/** Which job this call is — lets the server route it to the right provider. */
export type AITask = 'chat' | 'search' | 'describe' | 'brochure' | 'ocr';

/** Vendor-SDK-shaped params, kept so call sites read the same as before. */
export interface GenerateParams {
  task?: AITask;
  contents: string | Message[] | { role?: string; parts: Part[] }[];
  config?: {
    systemInstruction?: string;
    responseMimeType?: 'text/plain' | 'application/json';
    responseSchema?: unknown;
  };
  model?: string;
}

export interface GenerateResult { text: string; provider?: string; model?: string }

/** Error from /api/ai that remembers whether retrying could help. */
export class AIRequestError extends Error {
  status: number;
  transient: boolean;
  constructor(message: string, status: number, transient: boolean) {
    super(message);
    this.name = 'AIRequestError';
    this.status = status;
    this.transient = transient;
  }
}

/** True for transient "try again later" errors (overload / rate limit). */
export function isOverloadedError(err: any): boolean {
  if (err instanceof AIRequestError) {
    return err.transient && (err.status === 429 || err.status === 503 || err.status === 502 || err.status === 504);
  }
  const code = err?.status ?? err?.error?.code ?? err?.code;
  const status = err?.error?.status ?? err?.status;
  const msg = String(err?.message ?? err?.error?.message ?? '');
  return (
    code === 503 ||
    code === 429 ||
    status === 'UNAVAILABLE' ||
    status === 'RESOURCE_EXHAUSTED' ||
    /\b(503|429|overloaded|unavailable|high demand|rate limit)\b/i.test(msg)
  );
}

function isTimeoutError(err: any): boolean {
  if (err instanceof AIRequestError && err.status === 408) return true;
  if (err?.name === 'AbortError' || err?.status === 408 || err?.code === 408) return true;
  const msg = String(err?.message ?? '');
  return /\b(timeout|timed out|aborted)\b/i.test(msg);
}

function isConfigError(err: any): boolean {
  const msg = String(err?.message ?? err?.error?.message ?? '');
  if (err instanceof AIRequestError && err.status === 500 && !err.transient) {
    return true;
  }
  return /(api[_ ]?key|not configured|misconfigur|missing.*key|no provider|env.*missing)/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries a call with exponential backoff while it keeps failing transiently. */
export async function withRetry<T>(fn: () => Promise<T>, retries = 3, baseDelayMs = 600): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isOverloadedError(err) || attempt === retries) throw err;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

/** Accepts a bare string or SDK-style contents and normalises to Message[]. */
function normaliseContents(contents: GenerateParams['contents']): Message[] {
  if (typeof contents === 'string') return [{ role: 'user', parts: [{ text: contents }] }];
  return (contents as any[]).map((m) => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: m.parts,
  }));
}

/** Builds headers for /api/ai, attaching the Neon Bearer JWT when available. */
function buildAiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const token = getAuthToken();
  if (token && !token.startsWith('local_fallback_')) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** Probes GET /api/ai?health=1 and returns structured diagnostics for admin & advisor UX. */
export async function checkAdvisorHealth(): Promise<AdvisorHealthStatus> {
  const startedAt = Date.now();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), AI_HEALTH_TIMEOUT_MS) : null;

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = getAuthToken();
    if (token && !token.startsWith('local_fallback_')) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch('/api/ai?health=1', {
      method: 'GET',
      headers,
      signal: controller?.signal,
    });

    const elapsedMs = Date.now() - startedAt;
    const contentType = (res.headers?.get?.('content-type') || '').toLowerCase();
    const body: Record<string, any> = contentType.includes('application/json')
      ? await res.json().catch(() => ({}))
      : {};

    if (!res.ok) {
      return {
        healthy: false,
        provider: String(body.provider || 'unknown'),
        model: String(body.model || 'unconfigured'),
        fallbackModel: typeof body.fallbackModel === 'string' ? body.fallbackModel : undefined,
        rateLimiterBackend:
          body.rateLimiterBackend === 'redis' || body.rateLimiterBackend === 'neon_postgres'
            ? body.rateLimiterBackend
            : 'memory',
        hasApiKey: Boolean(body.hasApiKey),
        latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : elapsedMs,
        timestamp: body.timestamp || new Date().toISOString(),
        diagnostics: body.diagnostics || body.error || `AI health probe returned HTTP ${res.status}`,
      };
    }

    return {
      healthy: body.healthy !== false && body.status !== 'unhealthy',
      provider: String(body.provider || 'gemini'),
      model: String(body.model || 'default'),
      fallbackModel: typeof body.fallbackModel === 'string' ? body.fallbackModel : undefined,
      rateLimiterBackend:
        body.rateLimiterBackend === 'redis' || body.rateLimiterBackend === 'neon_postgres'
          ? body.rateLimiterBackend
          : 'memory',
      hasApiKey: body.hasApiKey !== false,
      latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : elapsedMs,
      timestamp: body.timestamp || new Date().toISOString(),
      diagnostics: typeof body.diagnostics === 'string' ? body.diagnostics : undefined,
    };
  } catch (err: any) {
    const elapsedMs = Date.now() - startedAt;
    return {
      healthy: false,
      provider: 'unreachable',
      model: 'unavailable',
      rateLimiterBackend: 'memory',
      hasApiKey: false,
      latencyMs: elapsedMs,
      timestamp: new Date().toISOString(),
      diagnostics:
        err?.name === 'AbortError'
          ? `Health check timed out after ${AI_HEALTH_TIMEOUT_MS}ms`
          : String(err?.message || 'Unable to reach /api/ai health endpoint'),
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/** Posts one request to our serverless AI route with a hard 25s AbortController timeout. */
export async function generateContent(params: GenerateParams): Promise<GenerateResult> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS) : null;

  let res: Response;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: buildAiHeaders(),
      body: JSON.stringify({
        task: params.task,
        contents: normaliseContents(params.contents),
        systemInstruction: params.config?.systemInstruction,
        responseMimeType: params.config?.responseMimeType,
        responseSchema: params.config?.responseSchema,
        model: params.model,
      }),
      signal: controller?.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new AIRequestError(
        `AI request timed out after ${Math.round(AI_REQUEST_TIMEOUT_MS / 1000)}s`,
        408,
        true
      );
    }
    throw new AIRequestError(
      err instanceof Error ? err.message : 'Network error reaching /api/ai',
      0,
      true
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!res.ok) {
    let message = `AI request failed (${res.status})`;
    let transient = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      if (typeof body?.transient === 'boolean') transient = body.transient;
    } catch {
      /* non-JSON error body — keep the default message */
    }
    throw new AIRequestError(message, res.status, transient);
  }

  const body = await res.json();
  return { text: body?.text ?? '', provider: body?.provider, model: body?.model };
}

/**
 * Same as generateContent — retry and model-fallback now happen server-side, so
 * this alias exists purely so existing call sites keep reading naturally.
 */
export async function generateContentResilient(params: GenerateParams): Promise<GenerateResult> {
  return generateContent(params);
}

/**
 * A stateful chat mirroring the vendor SDK's shape (`chat.sendMessage({ message })`).
 * History lives here in the browser and is replayed to the stateless endpoint
 * on every turn.
 */
export function createChat(
  opts: { config?: { systemInstruction?: string }; history?: Message[]; model?: string; task?: AITask } = {}
) {
  const history: Message[] = [...(opts.history || [])];
  return {
    get history() { return [...history]; },
    async sendMessage({ message }: { message: string }): Promise<GenerateResult> {
      const turn: Message = { role: 'user', parts: [{ text: message }] };
      const result = await generateContent({
        task: opts.task ?? 'chat',
        contents: [...history, turn],
        config: { systemInstruction: opts.config?.systemInstruction },
        model: opts.model,
      });
      // Only commit to history once the round-trip succeeded, so a failed send
      // doesn't poison the next turn.
      history.push(turn, { role: 'model', parts: [{ text: result.text }] });
      return result;
    },
  };
}

export type Chat = ReturnType<typeof createChat>;

/** User-facing message for AI failures, localized in Arabic & English with clear cause classification. */
export function aiErrorMessage(err: any, isRtl: boolean): string {
  if (isTimeoutError(err)) {
    return isRtl
      ? 'انتهت مهلة الرد من مساعد الذكاء الاصطناعي ⏱️ جرّب إرسال سؤالك مرة أخرى بشكل أقصر.'
      : 'The AI assistant timed out waiting for a response ⏱️ Please try again with a shorter prompt.';
  }

  if (isOverloadedError(err)) {
    return isRtl
      ? 'مساعد الذكاء الاصطناعي مزحوم دلوقتي بسبب ضغط الطلبات 🙏 جرّب تبعت تاني بعد ثواني.'
      : 'The AI assistant is busy right now due to high demand 🙏 Please try again in a few seconds.';
  }

  if (isConfigError(err)) {
    return isRtl
      ? 'خدمة الذكاء الاصطناعي غير مضبوطة حالياً على الخادم (مفتاح المزوّد غير مُعد). يرجى التواصل مع الإدارة.'
      : 'The AI service is not configured on the server (missing provider API key). Please contact the administrator.';
  }

  const status = err?.status ?? err?.code;
  if (status === 401 || status === 403) {
    return isRtl
      ? 'انتهت صلاحية الجلسة. يرجى إعادة تسجيل الدخول لاستخدام مساعد الذكاء الاصطناعي.'
      : 'Your session has expired. Please sign in again to use the AI assistant.';
  }

  return isRtl
    ? 'حصلت مشكلة في الاتصال بمساعد الذكاء الاصطناعي. تأكد من الاتصال بالإنترنت وحاول تاني.'
    : 'Something went wrong reaching the AI assistant. Please check your connection and try again.';
}

/** Marker the AI emits when the user asks to view a property in 3D. */
export const SHOW_3D_MARKER = '[SHOW_3D]';

/** Strips a 3D marker (with optional :id payload) from an AI reply. */
export function extract3DMarker(text: string): { cleanText: string; show3D: boolean; propertyId: string | null } {
  const match = text.match(/\[SHOW_3D(?::([^\]\s]+))?\]/);
  if (!match) return { cleanText: text, show3D: false, propertyId: null };
  return {
    cleanText: text.replace(/\[SHOW_3D(?::[^\]\s]+)?\]/g, '').trim(),
    show3D: true,
    propertyId: match[1] || null,
  };
}

/** Marker the AI advisor emits when extracting or updating the user's financial profile. */
export const ADVISOR_STATE_MARKER = '[ADVISOR_STATE:';

/**
 * Extracts and parses any [ADVISOR_STATE:{...}] payload from an AI advisor message,
 * returning the sanitized patch and clean text with the marker stripped out.
 */
export function extractAdvisorState(text: string): {
  cleanText: string;
  statePatch?: Partial<AdvisorFinancialProfile>;
} {
  if (!text || typeof text !== 'string') return { cleanText: text || '' };

  const match = text.match(/\[ADVISOR_STATE:([\s\S]*?)\]/);
  if (!match) return { cleanText: text };

  let statePatch: Partial<AdvisorFinancialProfile> | undefined;
  try {
    const rawJson = match[1].trim();
    const parsed = JSON.parse(rawJson);
    if (parsed && typeof parsed === 'object') {
      const patch: Partial<AdvisorFinancialProfile> = {};

      if (typeof parsed.budget === 'number' && Number.isFinite(parsed.budget) && parsed.budget > 0) {
        patch.budget = Math.round(parsed.budget);
      }
      if (typeof parsed.downPayment === 'number' && Number.isFinite(parsed.downPayment) && parsed.downPayment >= 0) {
        patch.downPayment = Math.round(parsed.downPayment);
      }
      if (typeof parsed.monthlyCapacity === 'number' && Number.isFinite(parsed.monthlyCapacity) && parsed.monthlyCapacity >= 0) {
        patch.monthlyCapacity = Math.round(parsed.monthlyCapacity);
      }
      if (parsed.currency === 'EGP' || parsed.currency === 'USD') {
        patch.currency = parsed.currency;
      }
      if (['all', 'residential', 'investment', 'resale', 'coastal'].includes(parsed.purpose)) {
        patch.purpose = parsed.purpose;
      }
      if (typeof parsed.preferredLocation === 'string' && parsed.preferredLocation.trim()) {
        patch.preferredLocation = parsed.preferredLocation.trim().slice(0, 80);
      }
      if (typeof parsed.propertyType === 'string' && parsed.propertyType.trim()) {
        patch.propertyType = parsed.propertyType.trim().slice(0, 50);
      }
      if (['all', 'ready', '1-2years', '3+years'].includes(parsed.deliveryTimeline)) {
        patch.deliveryTimeline = parsed.deliveryTimeline;
      }

      if (Object.keys(patch).length > 0) {
        statePatch = patch;
      }
    }
  } catch (err) {
    console.warn('Failed to parse ADVISOR_STATE payload from AI:', err);
  }

  const cleanText = text.replace(/\[ADVISOR_STATE:[\s\S]*?\]/g, '').trim();
  return { cleanText, statePatch };
}
