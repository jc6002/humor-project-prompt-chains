import type { AvailableModelOption, SupportedProtocol } from './types';

export type CatalogProviderRow = {
  id: string;
  slug: string;
  name: string;
  api_base_url: string;
  protocol: string;
  api_key_env: string;
  is_enabled?: boolean | null;
};

export type CatalogModelRow = {
  id: string;
  provider: string;
  provider_id?: string | null;
  api_model: string;
  name: string;
  is_enabled?: boolean | null;
  max_output_tokens?: number | null;
  canonical_id?: string | null;
};

export type VisionImagePayload = {
  mimeType: string;
  base64Data: string;
};

const FIVE_CAPTIONS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    captions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['captions'],
  additionalProperties: false,
} as const;

export function isSupportedProtocol(value: string): value is SupportedProtocol {
  return (
    value === 'openai_responses' ||
    value === 'openai_chat_completions' ||
    value === 'gemini_generate_content' ||
    value === 'anthropic_messages'
  );
}

function defaultProviderMetaForSlug(slug: string): Omit<CatalogProviderRow, 'id'> | null {
  if (slug === 'openai') {
    return {
      slug: 'openai',
      name: 'OpenAI',
      api_base_url: 'https://api.openai.com/v1/responses',
      protocol: 'openai_responses',
      api_key_env: 'OPENAI_API_KEY',
      is_enabled: true,
    };
  }
  if (slug === 'gemini') {
    return {
      slug: 'gemini',
      name: 'Google Gemini',
      api_base_url: 'https://generativelanguage.googleapis.com/v1beta/models',
      protocol: 'gemini_generate_content',
      api_key_env: 'GEMINI_API_KEY',
      is_enabled: true,
    };
  }
  if (slug === 'anthropic') {
    return {
      slug: 'anthropic',
      name: 'Anthropic',
      api_base_url: 'https://api.anthropic.com/v1/messages',
      protocol: 'anthropic_messages',
      api_key_env: 'ANTHROPIC_API_KEY',
      is_enabled: true,
    };
  }
  return null;
}

/**
 * Discovers enabled multimodal models strictly honoring DB `llm_providers` and
 * `arena_models` rows (failing closed when DB catalog rows exist so paused
 * providers/models never leak back through environment fallbacks).
 */
export function listSelectableChainModels(params: {
  providers: readonly CatalogProviderRow[];
  models: readonly CatalogModelRow[];
  env?: Record<string, string | undefined>;
}): AvailableModelOption[] {
  const env = params.env ?? process.env;
  const providers = params.providers ?? [];
  const canonicalModels = (params.models ?? []).filter((m) => !m.canonical_id);
  const hasDbCatalog = providers.length > 0 || canonicalModels.length > 0;

  if (!hasDbCatalog) {
    const out: AvailableModelOption[] = [];
    const openAiModels = (env.OPENAI_MODEL ?? 'gpt-6-luna,gpt-5.6-luna')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const geminiModels = (env.GEMINI_MODEL ?? 'gemini-3-flash-preview')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const apiModel of geminiModels) {
      out.push({
        key: `gemini::${apiModel}`,
        modelId: null,
        providerSlug: 'gemini',
        providerName: 'Google Gemini',
        protocol: 'gemini_generate_content',
        apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
        apiKeyEnv: 'GEMINI_API_KEY',
        apiModel,
        displayName: `Google Gemini · ${apiModel}`,
        maxOutputTokens: 1000,
        configured: Boolean(env.GEMINI_API_KEY?.trim()),
      });
    }
    for (const apiModel of openAiModels) {
      out.push({
        key: `openai::${apiModel}`,
        modelId: null,
        providerSlug: 'openai',
        providerName: 'OpenAI',
        protocol: 'openai_responses',
        apiBaseUrl: 'https://api.openai.com/v1/responses',
        apiKeyEnv: 'OPENAI_API_KEY',
        apiModel,
        displayName: `OpenAI · ${apiModel}`,
        maxOutputTokens: 800,
        configured: Boolean(env.OPENAI_API_KEY?.trim()),
      });
    }
    return out;
  }

  const providerById = new Map<string, CatalogProviderRow>();
  const providerBySlug = new Map<string, CatalogProviderRow>();
  for (const p of providers) {
    providerById.set(p.id, p);
    providerBySlug.set(String(p.slug).toLowerCase(), p);
  }

  const seen = new Set<string>();
  const options: AvailableModelOption[] = [];

  for (const m of canonicalModels) {
    const apiModel = String(m.api_model ?? '').trim();
    if (!apiModel || m.is_enabled === false) continue;

    const slugLower = String(m.provider ?? '').trim().toLowerCase();
    const provRow =
      (m.provider_id ? providerById.get(m.provider_id) : undefined) ??
      providerBySlug.get(slugLower) ??
      (providers.length === 0 ? defaultProviderMetaForSlug(slugLower) : undefined);

    if (!provRow || provRow.is_enabled === false) continue;

    const protocolRaw = String(provRow.protocol ?? '').trim();
    if (!isSupportedProtocol(protocolRaw)) continue;

    const keyEnv = String(provRow.api_key_env ?? '').trim();
    const providerSlug = String(provRow.slug).toLowerCase();
    const uniqueKey = `${providerSlug}::${apiModel}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    const rawTokens = Number(m.max_output_tokens);
    const maxOutputTokens =
      Number.isFinite(rawTokens) && rawTokens >= 150 ? Math.min(8192, Math.round(rawTokens)) : 800;

    const provLabel = provRow.name || provRow.slug;
    options.push({
      key: uniqueKey,
      modelId: m.id,
      providerSlug,
      providerName: provLabel,
      protocol: protocolRaw,
      apiBaseUrl: String(provRow.api_base_url).trim(),
      apiKeyEnv: keyEnv,
      apiModel,
      displayName: `${provLabel} · ${apiModel}`,
      maxOutputTokens,
      configured: Boolean(keyEnv && env[keyEnv]?.trim()),
    });
  }

  return options;
}

export function resolveSelectedChainModel(params: {
  requestedKey?: string | null;
  providers: readonly CatalogProviderRow[];
  models: readonly CatalogModelRow[];
  env?: Record<string, string | undefined>;
}): AvailableModelOption {
  const env = params.env ?? process.env;
  const allOptions = listSelectableChainModels(params);
  const configuredOptions = allOptions.filter((o) => o.configured);

  if (params.requestedKey) {
    const reqTrim = params.requestedKey.trim();
    const match = allOptions.find(
      (o) => o.key === reqTrim || o.modelId === reqTrim || o.apiModel === reqTrim
    );
    if (!match) {
      throw new Error(`Requested model "${reqTrim}" is disabled or not found in the active catalog.`);
    }
    if (!env[match.apiKeyEnv]?.trim()) {
      throw new Error(`Missing server API key environment variable ${match.apiKeyEnv} for ${match.displayName}.`);
    }
    return match;
  }

  if (configuredOptions.length === 0) {
    throw new Error(
      'No enabled LLM model has a configured API key. Enable a provider/model and configure OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY.'
    );
  }

  return configuredOptions[0];
}

function normalizeEndpointUrl(baseUrl: string, suffix: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.toLowerCase().endsWith(suffix.toLowerCase())) {
    return trimmed;
  }
  return `${trimmed}${suffix}`;
}

function isOpenAiHost(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

export function buildMultimodalStepHttpRequest(params: {
  model: AvailableModelOption;
  prompt: string;
  apiKey: string;
  image?: VisionImagePayload | null;
  expectFiveCaptionsJson: boolean;
}): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const { model, prompt, apiKey, image, expectFiveCaptionsJson } = params;
  const maxTokens = Math.max(model.maxOutputTokens, 650);

  if (model.protocol === 'openai_responses') {
    const url = normalizeEndpointUrl(model.apiBaseUrl, '/responses');
    const inputPayload = image
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              {
                type: 'input_image',
                image_url: `data:${image.mimeType};base64,${image.base64Data}`,
              },
            ],
          },
        ]
      : prompt;

    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model: model.apiModel,
        input: inputPayload,
        max_output_tokens: maxTokens,
        reasoning: { effort: 'none' },
        store: false,
        ...(expectFiveCaptionsJson
          ? {
              text: {
                format: {
                  type: 'json_schema',
                  name: 'five_captions',
                  strict: true,
                  schema: FIVE_CAPTIONS_JSON_SCHEMA,
                },
              },
            }
          : {}),
      },
    };
  }

  if (model.protocol === 'openai_chat_completions') {
    const url = normalizeEndpointUrl(model.apiBaseUrl, '/chat/completions');
    const openAiNative = isOpenAiHost(url);
    const tokenField = openAiNative
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };
    const userContent = image
      ? [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:${image.mimeType};base64,${image.base64Data}` },
          },
        ]
      : prompt;

    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model: model.apiModel,
        ...tokenField,
        ...(expectFiveCaptionsJson
          ? {
              response_format: openAiNative
                ? {
                    type: 'json_schema',
                    json_schema: {
                      name: 'five_captions',
                      strict: true,
                      schema: FIVE_CAPTIONS_JSON_SCHEMA,
                    },
                  }
                : { type: 'json_object' },
            }
          : {}),
        messages: [
          {
            role: 'system',
            content: expectFiveCaptionsJson
              ? 'Return strictly a JSON object {"captions": ["...", "...", "...", "...", "..."]} containing 5 funny captions.'
              : 'Execute the current prompt chain step concisely and concretely.',
          },
          { role: 'user', content: userContent },
        ],
      },
    };
  }

  if (model.protocol === 'gemini_generate_content') {
    const base = model.apiBaseUrl.trim().replace(/\/+$/, '');
    const url = base.includes(':generateContent')
      ? base
      : `${base}/${encodeURIComponent(model.apiModel)}:generateContent`;

    const parts: Record<string, unknown>[] = [];
    if (image) {
      parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.base64Data,
        },
      });
    }
    parts.push({ text: prompt });

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: Math.max(maxTokens, 700),
      ...(expectFiveCaptionsJson
        ? {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                captions: {
                  type: 'ARRAY',
                  items: { type: 'STRING' },
                },
              },
              required: ['captions'],
            },
          }
        : {}),
      ...(model.apiModel.toLowerCase().startsWith('gemini-3')
        ? { thinkingConfig: { thinkingLevel: 'MINIMAL' } }
        : {}),
    };

    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: {
        contents: [{ parts }],
        generationConfig,
      },
    };
  }

  // anthropic_messages
  const url = normalizeEndpointUrl(model.apiBaseUrl, '/messages');
  const userContent = image
    ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mimeType,
            data: image.base64Data,
          },
        },
        { type: 'text', text: prompt },
      ]
    : prompt;

  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: model.apiModel,
      max_tokens: maxTokens,
      system: expectFiveCaptionsJson
        ? 'Respond with ONLY a valid JSON object matching {"captions":["...","...","...","...","..."]} with no markdown fences.'
        : 'Execute this prompt chain step concisely in 2-4 concrete sentences.',
      messages: [{ role: 'user', content: userContent }],
    },
  };
}

export function extractStepTextAndUsage(
  protocol: SupportedProtocol,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  fallbackModel: string,
  responseHeaderRequestId?: string | null
): {
  text: string;
  resolvedModel: string;
  usage: Record<string, unknown>;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number;
  requestId: string | null;
} {
  if (protocol === 'openai_responses') {
    if (data?.status && data.status !== 'completed') {
      throw new Error('incomplete');
    }
    let text = '';
    for (const output of data?.output ?? []) {
      for (const content of output?.content ?? []) {
        if (content?.type === 'output_text' && typeof content.text === 'string') {
          text += content.text;
        }
      }
    }
    const usage = (data?.usage ?? {}) as Record<string, unknown>;
    return {
      text: text.trim(),
      resolvedModel: typeof data?.model === 'string' && data.model ? data.model : fallbackModel,
      usage,
      inputTokens: typeof data?.usage?.input_tokens === 'number' ? data.usage.input_tokens : null,
      outputTokens: typeof data?.usage?.output_tokens === 'number' ? data.usage.output_tokens : null,
      reasoningTokens:
        typeof data?.usage?.output_tokens_details?.reasoning_tokens === 'number'
          ? data.usage.output_tokens_details.reasoning_tokens
          : 0,
      requestId: responseHeaderRequestId ?? data?.id ?? null,
    };
  }

  if (protocol === 'openai_chat_completions') {
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new Error('incomplete');
    }
    const msgContent = choice?.message?.content;
    const text =
      typeof msgContent === 'string'
        ? msgContent
        : Array.isArray(msgContent)
          ? msgContent.map((part: { text?: string }) => part?.text ?? '').join('')
          : '';
    const usage = (data?.usage ?? {}) as Record<string, unknown>;
    return {
      text: text.trim(),
      resolvedModel: typeof data?.model === 'string' && data.model ? data.model : fallbackModel,
      usage,
      inputTokens:
        typeof data?.usage?.prompt_tokens === 'number'
          ? data.usage.prompt_tokens
          : typeof data?.usage?.input_tokens === 'number'
            ? data.usage.input_tokens
            : null,
      outputTokens:
        typeof data?.usage?.completion_tokens === 'number'
          ? data.usage.completion_tokens
          : typeof data?.usage?.output_tokens === 'number'
            ? data.usage.output_tokens
            : null,
      reasoningTokens:
        typeof data?.usage?.completion_tokens_details?.reasoning_tokens === 'number'
          ? data.usage.completion_tokens_details.reasoning_tokens
          : 0,
      requestId: responseHeaderRequestId ?? data?.id ?? null,
    };
  }

  if (protocol === 'gemini_generate_content') {
    const candidate = data?.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error('incomplete');
    }
    const text = (candidate?.content?.parts ?? [])
      .filter((p: { thought?: boolean }) => !p?.thought)
      .map((p: { text?: string }) => p?.text ?? '')
      .join('');
    const usage = (data?.usageMetadata ?? {}) as Record<string, unknown>;
    return {
      text: text.trim(),
      resolvedModel:
        typeof data?.modelVersion === 'string' && data.modelVersion
          ? data.modelVersion
          : fallbackModel,
      usage,
      inputTokens:
        typeof data?.usageMetadata?.promptTokenCount === 'number'
          ? data.usageMetadata.promptTokenCount
          : null,
      outputTokens:
        typeof data?.usageMetadata?.candidatesTokenCount === 'number'
          ? data.usageMetadata.candidatesTokenCount
          : null,
      reasoningTokens:
        typeof data?.usageMetadata?.thoughtsTokenCount === 'number'
          ? data.usageMetadata.thoughtsTokenCount
          : 0,
      requestId: responseHeaderRequestId ?? data?.responseId ?? null,
    };
  }

  // anthropic_messages
  if (data?.stop_reason === 'max_tokens') {
    throw new Error('incomplete');
  }
  const text = (data?.content ?? [])
    .filter((block: { type?: string }) => block?.type === 'text')
    .map((block: { text?: string }) => block?.text ?? '')
    .join('');
  const usage = (data?.usage ?? {}) as Record<string, unknown>;
  return {
    text: text.trim(),
    resolvedModel: typeof data?.model === 'string' && data.model ? data.model : fallbackModel,
    usage,
    inputTokens: typeof data?.usage?.input_tokens === 'number' ? data.usage.input_tokens : null,
    outputTokens: typeof data?.usage?.output_tokens === 'number' ? data.usage.output_tokens : null,
    reasoningTokens: 0,
    requestId: responseHeaderRequestId ?? data?.id ?? null,
  };
}
