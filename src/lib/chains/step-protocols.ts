import type { StepModality, StepProvider } from './types';

export interface SessionKeyOverrides {
  geminiFreeKey?: string | null;
  geminiPaidKey?: string | null;
}

export interface EffectiveStepCredential {
  provider: StepProvider;
  apiKey: string;
  usedPaidKey: boolean;
}

export const PAID_IMAGE_KEY_REQUIRED =
  'Image generation requires a billing-enabled Gemini API key. Add it in Gemini Keys as the Paid Gemini Key.';

export function resolvePaidImageKey(
  env: Record<string, string | undefined>,
  sessionKeys?: SessionKeyOverrides
): string {
  return sessionKeys?.geminiPaidKey?.trim() || env.GEMINI_PAID_API_KEY?.trim() || '';
}

export function isFreeTierImageQuotaError(status: number, message: string): boolean {
  return status === 429 && /free_tier_[a-z_]+,\s*limit:\s*0\b/i.test(message);
}

export const GEMINI_TEXT_FALLBACK_CASCADE: readonly string[] = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
];

// Strictly $0.0336/img Flash-tier image models only (high-cost Pro image models are excluded).
export const GEMINI_IMAGE_FALLBACK_CASCADE: readonly string[] = [
  'gemini-3.1-flash-lite-image',
  'gemini-nano-banana-2.1',
];

export function resolveGeminiBaseUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const raw = env.GEMINI_API_BASE_URL?.trim();
  if (!raw) {
    return 'https://generativelanguage.googleapis.com';
  }
  return raw.replace(/\/+$/, '');
}

export function resolveEffectiveStepCredential(
  provider: StepProvider,
  modelId: string,
  modality: StepModality,
  env: Record<string, string | undefined> = process.env,
  sessionKeys?: SessionKeyOverrides
): EffectiveStepCredential {
  void modelId;
  const paidKey = resolvePaidImageKey(env, sessionKeys);
  if (modality === 'image_generation') {
    if (!paidKey) throw new Error(PAID_IMAGE_KEY_REQUIRED);
    return { provider, apiKey: paidKey, usedPaidKey: true };
  }

  const sessionFree = sessionKeys?.geminiFreeKey?.trim() || '';
  const envFree = env.GEMINI_API_KEY?.trim() || '';

  const chosen = sessionFree || envFree || paidKey;
  if (!chosen) {
    throw new Error(
      'No Gemini API key is configured for text steps. Add GEMINI_API_KEY on the server or provide a key in Gemini Keys.'
    );
  }
  return {
    provider,
    apiKey: chosen,
    usedPaidKey: !sessionFree && !envFree,
  };
}

export function buildGeminiTextCandidateModels(requestedModelId: string): string[] {
  const ordered = [requestedModelId, ...GEMINI_TEXT_FALLBACK_CASCADE];
  return Array.from(new Set(ordered.filter(Boolean)));
}

export function buildGeminiImageCandidateModels(requestedModelId: string): string[] {
  const safeRequested =
    requestedModelId === 'gemini-nano-banana-2.1'
      ? 'gemini-nano-banana-2.1'
      : 'gemini-3.1-flash-lite-image';
  const ordered = [safeRequested, ...GEMINI_IMAGE_FALLBACK_CASCADE];
  return Array.from(new Set(ordered));
}

export function buildTextStepHttpRequest(params: {
  modelId: string;
  apiKey: string;
  prompt: string;
  temperature: number;
  jsonMode?: boolean;
  omitThinkingConfig?: boolean;
  env?: Record<string, string | undefined>;
}): { url: string; headers: Record<string, string>; body: string } {
  const baseUrl = resolveGeminiBaseUrl(params.env);
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(params.modelId)}:generateContent`;

  const isFlashLite = params.modelId.includes('flash-lite');
  const generationConfig: Record<string, unknown> = {
    temperature: params.temperature,
    maxOutputTokens: isFlashLite ? 2048 : 6144,
  };

  if (params.jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }

  // Omit thinkingConfig on *-flash-lite (~3.6s P50); disable thoughts on gemini-3-flash-preview (~5s P50).
  if (!isFlashLite && !params.omitThinkingConfig) {
    generationConfig.thinkingConfig = {
      includeThoughts: false,
      thinkingBudget: 0,
    };
  }

  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': params.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
      generationConfig,
    }),
  };
}

export function buildImageStepHttpRequest(params: {
  modelId: string;
  apiKey: string;
  prompt: string;
  temperature: number;
  env?: Record<string, string | undefined>;
}): { url: string; headers: Record<string, string>; body: string } {
  const baseUrl = resolveGeminiBaseUrl(params.env);
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(params.modelId)}:generateContent`;

  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': params.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
      generationConfig: {
        temperature: params.temperature,
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '1:1',
        },
      },
    }),
  };
}

export function extractTextStepOutput(
  provider: StepProvider,
  modelId: string,
  payload: unknown
): { text: string; inputTokens: number; outputTokens: number } {
  void provider;
  void modelId;
  const obj = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const candidates = Array.isArray(obj.candidates) ? obj.candidates : [];
  const chunks: string[] = [];

  for (const cand of candidates) {
    const content = (cand as Record<string, unknown>)?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p?.thought === true) continue;
      if (typeof p?.text === 'string' && p.text.trim()) {
        chunks.push(p.text.trim());
      }
    }
    if (chunks.length > 0) break;
  }

  const usage = (obj.usageMetadata ?? {}) as Record<string, unknown>;
  const inputTokens = Number(usage.promptTokenCount ?? 0) || 0;
  const outputTokens = Number(usage.candidatesTokenCount ?? 0) || 0;

  return {
    text: chunks.join('\n').trim(),
    inputTokens,
    outputTokens,
  };
}

export function extractImageStepOutput(
  provider: StepProvider,
  payload: unknown
): { base64: string; mimeType: string; totalTokens: number } | null {
  void provider;
  const obj = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const candidates = Array.isArray(obj.candidates) ? obj.candidates : [];

  for (const cand of candidates) {
    const content = (cand as Record<string, unknown>)?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      const p = part as Record<string, unknown>;
      const inline = (p.inlineData ?? p.inline_data) as Record<string, unknown> | undefined;
      const b64 = typeof inline?.data === 'string' ? inline.data.trim() : '';
      if (b64) {
        const mime =
          typeof inline?.mimeType === 'string'
            ? inline.mimeType
            : typeof inline?.mime_type === 'string'
              ? inline.mime_type
              : 'image/png';
        const usage = (obj.usageMetadata ?? {}) as Record<string, unknown>;
        const totalTokens = Number(usage.totalTokenCount ?? 1120) || 1120;
        return { base64: b64, mimeType: mime, totalTokens };
      }
    }
  }
  return null;
}

export function isQuotaOrRateLimitError(status: number, message: string): boolean {
  if (status === 429 || status === 503) return true;
  const low = message.toLowerCase();
  return (
    low.includes('resource_exhausted') ||
    low.includes('quota') ||
    low.includes('limit: 0') ||
    low.includes('overloaded')
  );
}
