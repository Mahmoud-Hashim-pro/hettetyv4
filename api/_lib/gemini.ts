/**
 * Google Gemini provider — talks to the Generative Language REST API directly
 * so the serverless function needs no vendor SDK.
 */
import { AIRequest, Provider, ProviderError } from './types.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 25_000;

export function createGeminiProvider(): Provider {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY is not configured on the server', 500, false);

  const defaultModel = process.env.AI_MODEL || 'gemini-2.5-flash';
  const fallbackModel =
    process.env.AI_FALLBACK_MODEL !== undefined
      ? process.env.AI_FALLBACK_MODEL || undefined
      : defaultModel !== 'gemini-2.0-flash'
        ? 'gemini-2.0-flash'
        : undefined;

  return {
    name: 'gemini',
    supportsPdf: true, // Gemini accepts PDFs inline
    defaultModel,
    fallbackModel,

    async generate(req: AIRequest, model: string): Promise<string> {
      const body: Record<string, unknown> = {
        // Gemini's wire format matches our neutral shape almost exactly.
        contents: req.contents.map((m) => ({ role: m.role, parts: m.parts })),
      };
      if (req.systemInstruction) {
        body.systemInstruction = { parts: [{ text: req.systemInstruction }] };
      }
      const generationConfig: Record<string, unknown> = {};
      if (req.responseMimeType) generationConfig.responseMimeType = req.responseMimeType;
      if (req.responseSchema) generationConfig.responseSchema = req.responseSchema;
      if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

      let res: Response;
      try {
        res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err: any) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
          throw new ProviderError(`Gemini request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`, 504, true);
        }
        throw new ProviderError(`Gemini network error: ${err?.message || 'fetch failed'}`, 502, true);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new ProviderError(`Gemini ${res.status}: ${detail.slice(0, 400)}`, res.status);
      }

      const json: any = await res.json();
      const cand = json?.candidates?.[0];
      // A blocked prompt returns candidates with no content — surface that clearly.
      if (!cand) {
        const reason = json?.promptFeedback?.blockReason;
        throw new ProviderError(reason ? `Gemini blocked the prompt (${reason})` : 'Gemini returned no candidates', 502);
      }
      return (cand.content?.parts || [])
        .map((p: any) => p?.text || '')
        .join('')
        .trim();
    },
  };
}
