import 'server-only';
import { randomUUID } from 'node:crypto';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { lookupHanziTarget } from '@/lib/hanzi/dataset';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { resolveSafeOrigin } from '@/lib/supabase/origin';
import {
  DEFAULT_DAILY_IMAGE_CAP,
  HANZI_APP_SCOPE,
  buildSelectableModels,
} from './presets';
import {
  type SessionKeyOverrides,
  PAID_IMAGE_KEY_REQUIRED,
  buildGeminiImageCandidateModels,
  buildGeminiTextCandidateModels,
  buildImageStepHttpRequest,
  buildTextStepHttpRequest,
  extractImageStepOutput,
  extractTextStepOutput,
  isFreeTierImageQuotaError,
  isQuotaOrRateLimitError,
  resolveEffectiveStepCredential,
  resolvePaidImageKey,
} from './step-protocols';
import {
  CHAIN_UUID_PATTERN,
  clampStepTemperature,
  compileCardFromTextTraces,
  compileMnemonicStepInstruction,
  escapePostgrestIlike,
  inferDecompositionModeFromChain,
  normalizeModelId,
  normalizeRunStepOutputs,
  normalizeStepModality,
  normalizeStoredCard,
} from './validation';
import type {
  DailyImageBudget,
  PromptChainRow,
  PromptChainRunRow,
  PromptChainStepRow,
  SseRunEvent,
  StepExecutionTrace,
  StudioInitialData,
} from './types';

export type StudioGateResult =
  | { status: 'unauthenticated' }
  | { status: 'forbidden'; user: { id: string; email: string } }
  | { status: 'authorized'; user: { id: string; email: string } };

export class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function adminClient(): SupabaseClient {
  const { url } = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server.');
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function checkOrigin(request: Request, requireJson = true): void {
  if (
    requireJson &&
    !request.headers.get('content-type')?.toLowerCase().includes('application/json')
  ) {
    throw new HttpStatusError(400, 'JSON content-type is required.');
  }

  const origin = request.headers.get('origin');
  if (!origin) return;

  let originHost = '';
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw new HttpStatusError(403, 'Request origin is not allowed.');
  }

  const allowedHosts = new Set<string>([
    new URL(request.url).host.toLowerCase(),
    new URL(resolveSafeOrigin(request)).host.toLowerCase(),
  ]);
  const headerHost = request.headers.get('host')?.trim().toLowerCase();
  if (headerHost) {
    allowedHosts.add(headerHost);
  }

  if (!allowedHosts.has(originHost)) {
    throw new HttpStatusError(403, 'Request origin is not allowed.');
  }
}

export async function checkSuperadmin(): Promise<StudioGateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: 'unauthenticated' };
  }

  const admin = adminClient();
  const emailClean = user.email?.trim().toLowerCase() ?? '';
  const [{ data: profile }, whitelistRes] = await Promise.all([
    admin.from('profiles').select('id, email, is_superadmin').eq('id', user.id).maybeSingle(),
    emailClean
      ? admin
          .from('whitelisted_emails')
          .select('email, auto_superadmin, is_active')
          .eq('is_active', true)
          .eq('auto_superadmin', true)
          .ilike('email', escapePostgrestIlike(emailClean))
      : Promise.resolve({ data: [], error: null }),
  ]);

  const isSuperadmin = Boolean(
    profile?.is_superadmin || (Array.isArray(whitelistRes.data) && whitelistRes.data.length > 0)
  );

  const safeUser = {
    id: user.id,
    email: user.email ?? profile?.email ?? 'superadmin@local',
  };

  if (!isSuperadmin) {
    return { status: 'forbidden', user: safeUser };
  }
  return { status: 'authorized', user: safeUser };
}

export async function requireSuperadminApi(
  request: Request,
  opts?: { methodIsMutating?: boolean; requireJson?: boolean }
): Promise<{ admin: SupabaseClient; user: { id: string; email: string } }> {
  const mutating = opts?.methodIsMutating ?? request.method !== 'GET';
  if (mutating) {
    checkOrigin(request, opts?.requireJson ?? request.method !== 'DELETE');
  }
  const gate = await checkSuperadmin();
  if (gate.status === 'unauthenticated') {
    throw new HttpStatusError(401, 'Authentication required.');
  }
  if (gate.status === 'forbidden') {
    throw new HttpStatusError(403, 'Superadmin access required (profiles.is_superadmin == TRUE).');
  }
  return { admin: adminClient(), user: gate.user };
}

export function apiFailure(error: unknown): Response {
  const status = error instanceof HttpStatusError ? error.status : 400;
  const message = error instanceof Error ? error.message : 'Request failed.';
  return Response.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function resolveDailyImageCap(): number {
  const raw = Number(process.env.DAILY_IMAGE_CAP);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 500) {
    return Math.floor(raw);
  }
  return DEFAULT_DAILY_IMAGE_CAP;
}

// Counts live Paid raster image runs today in UTC, excluding /showcase/* seeds and $0 text-only runs.
export async function fetchDailyImageBudget(admin: SupabaseClient): Promise<DailyImageBudget> {
  const dailyCap = resolveDailyImageCap();
  const now = new Date();
  const utcMidnightIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
  ).toISOString();

  const { data } = await admin
    .from('prompt_chain_runs')
    .select('id, generated_media_url, generated_media_mime, status, created_at')
    .eq('app_scope', HANZI_APP_SCOPE)
    .eq('status', 'completed')
    .gte('created_at', utcMidnightIso);

  const rows = Array.isArray(data) ? data : [];
  let usedToday = 0;
  for (const r of rows) {
    const url = typeof r.generated_media_url === 'string' ? r.generated_media_url.trim() : '';
    const mime = typeof r.generated_media_mime === 'string' ? r.generated_media_mime.toLowerCase() : '';
    if (!url) continue;
    if (url.startsWith('/showcase/')) continue;
    if (mime.includes('svg')) continue;
    usedToday += 1;
  }

  return {
    usedToday,
    dailyCap,
    remaining: Math.max(0, dailyCap - usedToday),
  };
}

function hydrateChainRow(raw: Record<string, unknown>): PromptChainRow {
  const slug = String(raw.slug ?? '');
  return {
    id: String(raw.id),
    slug,
    name: String(raw.name ?? ''),
    description: typeof raw.description === 'string' ? raw.description : '',
    persona_style: String(raw.persona_style ?? ''),
    is_active: raw.is_active !== false,
    mix_weight: Number(raw.mix_weight ?? 0) || 0,
    app_scope: String(raw.app_scope ?? HANZI_APP_SCOPE),
    decomposition_mode: inferDecompositionModeFromChain(slug, raw.decomposition_mode),
    created_at: String(raw.created_at ?? new Date().toISOString()),
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
  };
}

function hydrateStepRow(raw: Record<string, unknown>): PromptChainStepRow {
  const rawModality = raw.step_modality === 'image_generation' ? 'image_generation' : 'text';
  const model_id = normalizeModelId(raw.model_id, rawModality);
  const step_modality = normalizeStepModality(raw.step_modality, model_id);
  return {
    id: String(raw.id),
    chain_id: String(raw.chain_id),
    step_order: Number(raw.step_order) || 1,
    step_name: String(raw.step_name ?? 'Step'),
    step_role: String(raw.step_role ?? 'step'),
    instruction_template: String(raw.instruction_template ?? ''),
    output_field: String(raw.output_field ?? 'step_output'),
    provider: 'gemini',
    model_id,
    temperature: clampStepTemperature(raw.temperature, step_modality === 'image_generation' ? 0.6 : 0.2),
    step_modality,
    created_at: String(raw.created_at ?? new Date().toISOString()),
  };
}

export function hydrateRunRow(raw: Record<string, unknown>): PromptChainRunRow {
  const premise = String(raw.input_premise ?? '').trim();
  const chainSlug = String(raw.chain_slug ?? 'compound-word');
  const inferredMode = inferDecompositionModeFromChain(chainSlug);
  const lookup = lookupHanziTarget(premise || '猫头鹰', inferredMode);
  const mediaUrl =
    typeof raw.generated_media_url === 'string' && raw.generated_media_url.trim()
      ? raw.generated_media_url.trim()
      : null;

  return {
    id: String(raw.id),
    chain_id: String(raw.chain_id),
    chain_slug: chainSlug,
    chain_name: String(raw.chain_name ?? 'Compound Word'),
    user_id: typeof raw.user_id === 'string' ? raw.user_id : null,
    user_email: typeof raw.user_email === 'string' ? raw.user_email : null,
    provider: String(raw.provider ?? 'gemini'),
    model: String(raw.model ?? 'gemini-3.5-flash-lite'),
    input_source_type: String(raw.input_source_type ?? 'text_only'),
    input_premise: premise,
    input_tags: Array.isArray(raw.input_tags) ? raw.input_tags.map(String) : [],
    step_outputs: normalizeRunStepOutputs(raw.step_outputs),
    final_captions: Array.isArray(raw.final_captions) ? raw.final_captions.map(String) : [],
    generated_media_url: mediaUrl,
    generated_media_mime: String(raw.generated_media_mime ?? 'image/jpeg'),
    generated_media_prompt:
      typeof raw.generated_media_prompt === 'string' ? raw.generated_media_prompt : null,
    structured_card: normalizeStoredCard(raw.structured_card, lookup, Boolean(mediaUrl)),
    status: raw.status === 'failed' ? 'failed' : raw.status === 'running' ? 'running' : 'completed',
    error_message: typeof raw.error_message === 'string' ? raw.error_message : null,
    total_latency_ms: Number(raw.total_latency_ms) || 0,
    total_tokens: Number(raw.total_tokens) || 0,
    app_scope: String(raw.app_scope ?? HANZI_APP_SCOPE),
    created_at: String(raw.created_at ?? new Date().toISOString()),
  };
}

export async function fetchStudioInitialData(adminOverride?: SupabaseClient): Promise<StudioInitialData> {
  const admin = adminOverride ?? adminClient();
  const [chainsRes, runsRes, imageBudget] = await Promise.all([
    admin
      .from('prompt_chains')
      .select('*')
      .eq('app_scope', HANZI_APP_SCOPE)
      .order('created_at', { ascending: true }),
    admin
      .from('prompt_chain_runs')
      .select('*')
      .eq('app_scope', HANZI_APP_SCOPE)
      .order('created_at', { ascending: false })
      .limit(80),
    fetchDailyImageBudget(admin),
  ]);

  if (chainsRes.error) {
    throw new Error(`Failed to load prompt chains: ${chainsRes.error.message}`);
  }
  if (runsRes.error) {
    throw new Error(`Failed to load saved mnemonic cards: ${runsRes.error.message}`);
  }

  const chains = (chainsRes.data ?? []).map((r) => hydrateChainRow(r as Record<string, unknown>));
  const chainIds = chains.map((c) => c.id);

  const stepsByChainId: Record<string, PromptChainStepRow[]> = {};
  for (const cid of chainIds) {
    stepsByChainId[cid] = [];
  }

  if (chainIds.length > 0) {
    const stepsRes = await admin
      .from('prompt_chain_steps')
      .select('*')
      .in('chain_id', chainIds)
      .order('step_order', { ascending: true });

    if (stepsRes.error) {
      throw new Error(`Failed to load chain steps: ${stepsRes.error.message}`);
    }
    for (const rawStep of stepsRes.data ?? []) {
      const step = hydrateStepRow(rawStep as Record<string, unknown>);
      if (!stepsByChainId[step.chain_id]) {
        stepsByChainId[step.chain_id] = [];
      }
      stepsByChainId[step.chain_id].push(step);
    }
  }

  const runs = (runsRes.data ?? []).map((r) => hydrateRunRow(r as Record<string, unknown>));

  return {
    chains,
    stepsByChainId,
    runs,
    models: buildSelectableModels(),
    providerStatus: {
      geminiFreeConfigured: Boolean(
        process.env.GEMINI_API_KEY?.trim() || process.env.GEMINI_PAID_API_KEY?.trim()
      ),
      geminiPaidConfigured: Boolean(process.env.GEMINI_PAID_API_KEY?.trim()),
    },
    imageBudget,
  };
}

async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('Run cancelled by user.');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Run cancelled by user.'));
      },
      { once: true }
    );
  });
}

async function invokeTextStepWithCascade(params: {
  step: PromptChainStepRow;
  prompt: string;
  sessionKeys?: SessionKeyOverrides;
  signal?: AbortSignal;
}): Promise<{ text: string; usedModelId: string; latencyMs: number; tokens: number }> {
  const { step, prompt, sessionKeys, signal } = params;
  const cred = resolveEffectiveStepCredential(
    step.provider,
    step.model_id,
    'text',
    process.env,
    sessionKeys
  );
  const jsonMode =
    step.step_role.includes('json') ||
    step.output_field.includes('json') ||
    /\bjson\b/i.test(step.instruction_template);

  const candidates = buildGeminiTextCandidateModels(step.model_id);
  let lastError = 'Upstream text model failed.';

  for (const candidateModel of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new Error('Run cancelled by user.');
      const started = Date.now();
      const reqSpec = buildTextStepHttpRequest({
        modelId: candidateModel,
        apiKey: cred.apiKey,
        prompt,
        temperature: step.temperature,
        jsonMode,
        omitThinkingConfig: attempt === 1,
      });

      const resp = await fetch(reqSpec.url, {
        method: 'POST',
        headers: reqSpec.headers,
        body: reqSpec.body,
        signal,
      });
      const elapsed = Date.now() - started;
      const payload = (await resp.json().catch(() => ({}))) as Record<string, unknown>;

      if (resp.ok) {
        const extracted = extractTextStepOutput('gemini', candidateModel, payload);
        if (extracted.text) {
          return {
            text: extracted.text,
            usedModelId: candidateModel,
            latencyMs: elapsed,
            tokens: extracted.inputTokens + extracted.outputTokens,
          };
        }
      }

      const errObj = (payload.error ?? {}) as Record<string, unknown>;
      lastError = String(errObj.message ?? `HTTP ${resp.status} from ${candidateModel}`);

      // 1-shot retry omitting thinkingConfig on HTTP 400
      if (resp.status === 400 && !candidateModel.includes('flash-lite') && attempt === 0) {
        continue;
      }
      if (isQuotaOrRateLimitError(resp.status, lastError)) {
        await sleepMs(1100 * (attempt + 1), signal);
        if (attempt === 0) continue;
        break;
      }
      break;
    }
  }

  throw new HttpStatusError(502, `Text step "${step.step_name}" failed: ${lastError}`);
}

async function invokeImageStepWithCascade(params: {
  requestedModelId: string;
  temperature: number;
  prompt: string;
  sessionKeys?: SessionKeyOverrides;
  signal?: AbortSignal;
}): Promise<{
  base64: string;
  mimeType: string;
  usedModelId: string;
  latencyMs: number;
  tokens: number;
}> {
  const { requestedModelId, temperature, prompt, sessionKeys, signal } = params;
  if (!resolvePaidImageKey(process.env, sessionKeys)) {
    throw new HttpStatusError(422, PAID_IMAGE_KEY_REQUIRED);
  }
  const cred = resolveEffectiveStepCredential(
    'gemini',
    requestedModelId,
    'image_generation',
    process.env,
    sessionKeys
  );
  const candidates = buildGeminiImageCandidateModels(requestedModelId);
  let lastError = 'Upstream Flash image model failed.';

  for (const candidateModel of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new Error('Run cancelled by user.');
      const started = Date.now();
      const reqSpec = buildImageStepHttpRequest({
        modelId: candidateModel,
        apiKey: cred.apiKey,
        prompt,
        temperature,
      });

      const resp = await fetch(reqSpec.url, {
        method: 'POST',
        headers: reqSpec.headers,
        body: reqSpec.body,
        signal,
      });
      const elapsed = Date.now() - started;
      const payload = (await resp.json().catch(() => ({}))) as Record<string, unknown>;

      if (resp.ok) {
        const extracted = extractImageStepOutput('gemini', payload);
        if (extracted?.base64) {
          return {
            base64: extracted.base64,
            mimeType: extracted.mimeType,
            usedModelId: candidateModel,
            latencyMs: elapsed,
            tokens: extracted.totalTokens,
          };
        }
      }

      const errObj = (payload.error ?? {}) as Record<string, unknown>;
      lastError = String(errObj.message ?? `HTTP ${resp.status} from ${candidateModel}`);
      if (isFreeTierImageQuotaError(resp.status, lastError)) {
        throw new HttpStatusError(
          422,
          'Google reports zero free-tier image quota for this key. Use a key from a Gemini API project with billing enabled.'
        );
      }
      if (isQuotaOrRateLimitError(resp.status, lastError)) {
        await sleepMs(1400 * (attempt + 1), signal);
        if (attempt === 0) continue;
        break;
      }
      break;
    }
  }

  throw new HttpStatusError(502, `Image step failed on $0.034 Flash cascade: ${lastError}`);
}

async function persistGeneratedSceneMedia(
  admin: SupabaseClient,
  runId: string,
  base64: string,
  mimeType: string
): Promise<string> {
  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
  const objectPath = `hanzi-mnemonic/${runId}.${ext}`;
  try {
    const bytes = Buffer.from(base64, 'base64');
    const up = await admin.storage.from('chain-media').upload(objectPath, bytes, {
      contentType: mimeType,
      upsert: true,
    });
    if (!up.error) {
      const pub = admin.storage.from('chain-media').getPublicUrl(objectPath);
      if (pub?.data?.publicUrl) {
        return pub.data.publicUrl;
      }
    }
  } catch {
    // Fall back to inline data URL when storage bucket is unavailable in local preview.
  }
  return `data:${mimeType};base64,${base64}`;
}

export async function* executeHanziChainRunGenerator(params: {
  admin: SupabaseClient;
  user: { id: string; email: string };
  chainId: string;
  hanziInput: string;
  textOnlyPreview: boolean;
  sessionKeys?: SessionKeyOverrides;
  signal?: AbortSignal;
}): AsyncGenerator<SseRunEvent> {
  const { admin, user, chainId, hanziInput, textOnlyPreview, sessionKeys, signal } = params;

  if (!CHAIN_UUID_PATTERN.test(chainId)) {
    throw new HttpStatusError(400, 'Invalid chain ID.');
  }

  const { data: rawChain, error: chainErr } = await admin
    .from('prompt_chains')
    .select('*')
    .eq('id', chainId)
    .eq('app_scope', HANZI_APP_SCOPE)
    .maybeSingle();

  if (chainErr || !rawChain) {
    throw new HttpStatusError(404, 'Prompt chain not found.');
  }
  const chain = hydrateChainRow(rawChain as Record<string, unknown>);

  // Deterministic pre-chain dataset lookup & non-inventing Fit Check ($0.00 before any LLM call!)
  const lookup = lookupHanziTarget(hanziInput, chain.decomposition_mode);
  if (lookup.status === 'invalid') {
    throw new HttpStatusError(400, lookup.mismatch_reason || 'Enter 1 to 4 Simplified Chinese characters.');
  }
  if (lookup.status === 'fit_mismatch' || lookup.status === 'base_pictograph') {
    yield { type: 'fit_mismatch', lookup };
    return;
  }

  yield { type: 'lookup_complete', lookup };

  const { data: rawSteps, error: stepsErr } = await admin
    .from('prompt_chain_steps')
    .select('*')
    .eq('chain_id', chain.id)
    .order('step_order', { ascending: true });

  if (stepsErr || !rawSteps || rawSteps.length === 0) {
    throw new HttpStatusError(400, 'This chain has no steps configured.');
  }
  const steps = rawSteps.map((s) => hydrateStepRow(s as Record<string, unknown>));

  const budgetBefore = await fetchDailyImageBudget(admin);
  const dailyCapReached = !textOnlyPreview && budgetBefore.remaining <= 0;
  const paidImageKey = resolvePaidImageKey(process.env, sessionKeys);
  const effectiveTextOnly = textOnlyPreview || dailyCapReached || !paidImageKey;
  let imageWarning =
    !textOnlyPreview && !dailyCapReached && !paidImageKey &&
    steps.some((step) => step.step_modality === 'image_generation')
      ? PAID_IMAGE_KEY_REQUIRED
      : undefined;

  const traces: StepExecutionTrace[] = [];
  let totalLatencyMs = 0;
  let totalTokens = 0;
  let generatedMediaUrl: string | null = null;
  let generatedMediaMime = 'image/jpeg';
  let generatedMediaPrompt: string | null = null;
  const runId = randomUUID();

  for (const step of steps) {
    if (signal?.aborted) throw new Error('Run cancelled by user.');

    if (step.step_modality === 'image_generation') {
      if (effectiveTextOnly || imageWarning) {
        continue;
      }
      const lastText =
        [...traces].reverse().find((t) => t.step_modality === 'text')?.output_text ?? '';
      const { imagePrompt } = compileCardFromTextTraces({
        lookup,
        rawStepText: lastText,
        textOnlyPreview: false,
      });

      yield {
        type: 'step_started',
        step_order: step.step_order,
        total_steps: steps.length,
        step_name: step.step_name,
        step_role: step.step_role,
        model_id: step.model_id,
        temperature: step.temperature,
        step_modality: 'image_generation',
      };

      const imgRes = await invokeImageStepWithCascade({
        requestedModelId: step.model_id,
        temperature: step.temperature,
        prompt: imagePrompt,
        sessionKeys,
        signal,
      }).catch((error: unknown) => {
        if (!(error instanceof HttpStatusError) || error.status !== 422) throw error;
        imageWarning = error.message;
        return null;
      });
      if (!imgRes) continue;

      generatedMediaUrl = await persistGeneratedSceneMedia(
        admin,
        runId,
        imgRes.base64,
        imgRes.mimeType
      );
      generatedMediaMime = imgRes.mimeType;
      generatedMediaPrompt = imagePrompt;

      const imgTrace: StepExecutionTrace = {
        step_order: step.step_order,
        step_name: step.step_name,
        step_role: step.step_role,
        output_field: step.output_field,
        provider: 'gemini',
        model_id: imgRes.usedModelId,
        temperature: step.temperature,
        step_modality: 'image_generation',
        compiled_prompt: imagePrompt,
        output_text: `Rendered 1:1 zero-text mnemonic scene via ${imgRes.usedModelId} (${imgRes.mimeType}).`,
        latency_ms: imgRes.latencyMs,
        tokens: imgRes.tokens,
      };
      traces.push(imgTrace);
      totalLatencyMs += imgRes.latencyMs;
      totalTokens += imgRes.tokens;

      yield {
        type: 'step_completed',
        trace: imgTrace,
        total_steps: steps.length,
      };
      continue;
    }

    const compiledPrompt = compileMnemonicStepInstruction({
      template: step.instruction_template,
      lookup,
      chainName: chain.name,
      personaStyle: chain.persona_style,
      priorOutputs: traces,
    });

    yield {
      type: 'step_started',
      step_order: step.step_order,
      total_steps: steps.length,
      step_name: step.step_name,
      step_role: step.step_role,
      model_id: step.model_id,
      temperature: step.temperature,
      step_modality: 'text',
    };

    const textRes = await invokeTextStepWithCascade({
      step,
      prompt: compiledPrompt,
      sessionKeys,
      signal,
    });

    const textTrace: StepExecutionTrace = {
      step_order: step.step_order,
      step_name: step.step_name,
      step_role: step.step_role,
      output_field: step.output_field,
      provider: 'gemini',
      model_id: textRes.usedModelId,
      temperature: step.temperature,
      step_modality: 'text',
      compiled_prompt: compiledPrompt,
      output_text: textRes.text,
      latency_ms: textRes.latencyMs,
      tokens: textRes.tokens,
    };
    traces.push(textTrace);
    totalLatencyMs += textRes.latencyMs;
    totalTokens += textRes.tokens;

    yield {
      type: 'step_completed',
      trace: textTrace,
      total_steps: steps.length,
    };
  }

  const finalTextTrace =
    [...traces].reverse().find((t) => t.step_modality === 'text')?.output_text ?? '';
  const { card, imagePrompt } = compileCardFromTextTraces({
    lookup,
    rawStepText: finalTextTrace,
    textOnlyPreview: !generatedMediaUrl,
    dailyCapReached,
  });

  const insertPayload = {
    id: runId,
    chain_id: chain.id,
    chain_slug: chain.slug,
    chain_name: chain.name,
    user_id: CHAIN_UUID_PATTERN.test(user.id) ? user.id : null,
    user_email: user.email,
    provider: 'gemini',
    model: traces[traces.length - 1]?.model_id ?? 'gemini-3.5-flash-lite',
    input_source_type: 'text_only',
    input_premise: lookup.input,
    input_tags: [lookup.effective_mode, ...(effectiveTextOnly ? ['text_preview'] : ['full_card'])],
    step_outputs: traces,
    final_captions: [card.mnemonic_hook],
    generated_media_url: generatedMediaUrl,
    generated_media_mime: generatedMediaMime,
    generated_media_prompt: generatedMediaPrompt ?? imagePrompt,
    structured_card: card,
    status: 'completed',
    error_message: null,
    total_latency_ms: totalLatencyMs,
    total_tokens: totalTokens,
    app_scope: HANZI_APP_SCOPE,
  };

  const { data: inserted, error: insErr } = await admin
    .from('prompt_chain_runs')
    .insert(insertPayload)
    .select('*')
    .single();

  if (insErr || !inserted) {
    throw new HttpStatusError(500, `Failed to save mnemonic card run: ${insErr?.message ?? 'unknown'}`);
  }

  const hydratedRun = hydrateRunRow(inserted as Record<string, unknown>);
  const updatedBudget = await fetchDailyImageBudget(admin);
  yield {
    type: 'run_completed',
    run: hydratedRun,
    imageBudget: updatedBudget,
    imageWarning,
  };
}

export async function renderSceneForPreviewRun(params: {
  admin: SupabaseClient;
  runId: string;
  sessionKeys?: SessionKeyOverrides;
}): Promise<{ run: PromptChainRunRow; imageBudget: DailyImageBudget }> {
  const { admin, runId, sessionKeys } = params;
  if (!CHAIN_UUID_PATTERN.test(runId)) {
    throw new HttpStatusError(400, 'Invalid run ID.');
  }

  const { data: rawRun, error: runErr } = await admin
    .from('prompt_chain_runs')
    .select('*')
    .eq('id', runId)
    .eq('app_scope', HANZI_APP_SCOPE)
    .maybeSingle();

  if (runErr || !rawRun) {
    throw new HttpStatusError(404, 'Saved text-preview card not found.');
  }

  const existing = hydrateRunRow(rawRun as Record<string, unknown>);
  if (existing.generated_media_url) {
    return {
      run: existing,
      imageBudget: await fetchDailyImageBudget(admin),
    };
  }

  const budget = await fetchDailyImageBudget(admin);
  if (budget.remaining <= 0) {
    throw new HttpStatusError(
      429,
      `Daily image cap (${budget.dailyCap}/${budget.dailyCap}) reached since 00:00 UTC.`
    );
  }

  const prompt =
    existing.generated_media_prompt?.trim() || existing.structured_card.image_prompt;

  // Check if the chain has an image step to respect its selected model & temperature
  const { data: chainSteps } = await admin
    .from('prompt_chain_steps')
    .select('*')
    .eq('chain_id', existing.chain_id)
    .order('step_order', { ascending: true });

  const imgStep = (chainSteps ?? [])
    .map((s) => hydrateStepRow(s as Record<string, unknown>))
    .find((s) => s.step_modality === 'image_generation');

  const requestedModel = imgStep?.model_id ?? 'gemini-3.1-flash-lite-image';
  const temp = imgStep?.temperature ?? 0.6;

  const imgRes = await invokeImageStepWithCascade({
    requestedModelId: requestedModel,
    temperature: temp,
    prompt,
    sessionKeys,
  });

  const mediaUrl = await persistGeneratedSceneMedia(
    admin,
    existing.id,
    imgRes.base64,
    imgRes.mimeType
  );

  const nextStepOrder = imgStep?.step_order ?? existing.step_outputs.length + 1;
  const imgTrace: StepExecutionTrace = {
    step_order: nextStepOrder,
    step_name: imgStep?.step_name ?? '1:1 Mnemonic Scene Picture',
    step_role: imgStep?.step_role ?? 'picture',
    output_field: imgStep?.output_field ?? 'generated_scene_media',
    provider: 'gemini',
    model_id: imgRes.usedModelId,
    temperature: temp,
    step_modality: 'image_generation',
    compiled_prompt: prompt,
    output_text: `Rendered 1:1 zero-text mnemonic scene via ${imgRes.usedModelId} (${imgRes.mimeType}).`,
    latency_ms: imgRes.latencyMs,
    tokens: imgRes.tokens,
  };

  const updatedTraces = [
    ...existing.step_outputs.filter((t) => t.step_modality !== 'image_generation'),
    imgTrace,
  ];
  const updatedCard = {
    ...existing.structured_card,
    text_only_preview: false,
    daily_cap_reached: false,
  };

  const { data: updatedRaw, error: updErr } = await admin
    .from('prompt_chain_runs')
    .update({
      model: imgRes.usedModelId,
      step_outputs: updatedTraces,
      generated_media_url: mediaUrl,
      generated_media_mime: imgRes.mimeType,
      generated_media_prompt: prompt,
      structured_card: updatedCard,
      total_latency_ms: existing.total_latency_ms + imgRes.latencyMs,
      total_tokens: existing.total_tokens + imgRes.tokens,
    })
    .eq('id', existing.id)
    .eq('app_scope', HANZI_APP_SCOPE)
    .select('*')
    .single();

  if (updErr || !updatedRaw) {
    throw new HttpStatusError(500, `Failed to update rendered card: ${updErr?.message ?? 'unknown'}`);
  }

  return {
    run: hydrateRunRow(updatedRaw as Record<string, unknown>),
    imageBudget: await fetchDailyImageBudget(admin),
  };
}
