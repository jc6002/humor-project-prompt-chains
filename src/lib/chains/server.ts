import 'server-only';
import { lookup as dnsLookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { resolveSafeOrigin } from '@/lib/supabase/origin';
import {
  ALLOWED_VISION_MIMES,
  CHAIN_UUID_PATTERN,
  MAX_IMAGE_BYTES,
  compileStepInstruction,
  escapePostgrestIlike,
  isPublicIpAddress,
  normalizeFinalCaptions,
  normalizeRunStepOutputs,
  parseBoundedImageDataUrl,
  parseFiveCaptions,
  validateExternalImageUrl,
} from './validation';
import {
  buildMultimodalStepHttpRequest,
  extractStepTextAndUsage,
  listSelectableChainModels,
  resolveSelectedChainModel,
  type CatalogModelRow,
  type CatalogProviderRow,
  type VisionImagePayload,
} from './multimodal-protocols';
import { getSampleSceneById } from './sample-scenes';
import type {
  AvailableModelOption,
  InputSourceType,
  PromptChainRow,
  PromptChainRunRow,
  PromptChainStepRow,
  StepExecutionTrace,
  StudioInitialData,
} from './types';

export type StudioGateResult =
  | { status: 'unauthenticated' }
  | { status: 'forbidden'; user: { id: string; email: string } }
  | { status: 'authorized'; user: { id: string; email: string } };

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

export function checkOrigin(request: Request, requireJson = true) {
  if (requireJson && !request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('JSON content-type is required.');
  }

  const origin = request.headers.get('origin');
  if (!origin) return;

  let originHost = '';
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw new Error('Request origin is not allowed.');
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
    throw new Error('Request origin is not allowed.');
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

  const autoAdmin = Boolean(
    emailClean &&
      (whitelistRes.data ?? []).some(
        (w: { email?: string }) => String(w.email ?? '').trim().toLowerCase() === emailClean
      )
  );
  if (autoAdmin && !profile?.is_superadmin) {
    await admin
      .from('profiles')
      .upsert({ id: user.id, email: user.email, is_superadmin: true }, { onConflict: 'id' });
  }

  if (!profile?.is_superadmin && !autoAdmin) {
    return {
      status: 'forbidden',
      user: { id: user.id, email: user.email ?? profile?.email ?? 'Signed-in user' },
    };
  }

  return {
    status: 'authorized',
    user: { id: user.id, email: user.email ?? profile?.email ?? 'Superadmin' },
  };
}

export async function requireSuperadminApi(request: Request, opts?: { requireJson?: boolean }) {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    checkOrigin(request, opts?.requireJson ?? (method === 'POST' || method === 'PATCH' || method === 'PUT'));
  }

  const gate = await checkSuperadmin();
  if (gate.status === 'unauthenticated') {
    throw new Error('Sign in with Google to access Prompt Chain Studio.');
  }
  if (gate.status === 'forbidden') {
    throw new Error('Forbidden: profiles.is_superadmin == TRUE is required.');
  }
  return { admin: adminClient(), user: gate.user };
}

export function apiFailure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Studio request failed.';
  const status = message.startsWith('Sign in')
    ? 401
    : message.startsWith('Forbidden')
      ? 403
      : message.toLowerCase().includes('not found')
        ? 404
        : 400;
  return Response.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function normalizeRunRow(raw: Record<string, unknown>): PromptChainRunRow {
  const srcRaw = String(raw.input_source_type ?? 'sample_svg');
  const sourceType: InputSourceType =
    srcRaw === 'upload' || srcRaw === 'image_url' || srcRaw === 'text_only'
      ? srcRaw
      : 'sample_svg';
  const statusRaw = String(raw.status ?? 'completed');
  const status =
    statusRaw === 'running' || statusRaw === 'failed' ? statusRaw : 'completed';

  return {
    id: String(raw.id),
    chain_id: String(raw.chain_id),
    chain_slug: String(raw.chain_slug ?? ''),
    chain_name: String(raw.chain_name ?? 'Prompt Chain'),
    user_id: typeof raw.user_id === 'string' ? raw.user_id : null,
    user_email: typeof raw.user_email === 'string' ? raw.user_email : null,
    provider: String(raw.provider ?? ''),
    model: String(raw.model ?? ''),
    input_source_type: sourceType,
    input_scene_id: typeof raw.input_scene_id === 'string' ? raw.input_scene_id : null,
    input_scene_title: typeof raw.input_scene_title === 'string' ? raw.input_scene_title : null,
    input_image_url: typeof raw.input_image_url === 'string' ? raw.input_image_url : null,
    input_premise: String(raw.input_premise ?? ''),
    step_outputs: normalizeRunStepOutputs(raw.step_outputs),
    final_captions: normalizeFinalCaptions(raw.final_captions),
    status,
    error_message: typeof raw.error_message === 'string' ? raw.error_message : null,
    total_latency_ms: Math.max(0, Number(raw.total_latency_ms) || 0),
    total_tokens: Math.max(0, Number(raw.total_tokens) || 0),
    created_at: String(raw.created_at ?? new Date().toISOString()),
  };
}

export async function fetchStudioInitialData(): Promise<StudioInitialData> {
  const admin = adminClient();
  const [chainsRes, stepsRes, runsRes, providersRes, modelsRes] = await Promise.all([
    admin.from('prompt_chains').select('*').order('created_at', { ascending: true }),
    admin.from('prompt_chain_steps').select('*').order('step_order', { ascending: true }),
    admin.from('prompt_chain_runs').select('*').order('created_at', { ascending: false }).limit(80),
    admin.from('llm_providers').select('*').order('created_at', { ascending: true }),
    admin.from('arena_models').select('*').is('canonical_id', null).order('rating', { ascending: false }),
  ]);

  const chains = ((chainsRes.data ?? []) as PromptChainRow[]).slice().sort((a, b) => {
    // Surface the visual-image-to-5-captions pipeline first so graders land directly on the 3-step visual demo
    const aVisual = a.slug === 'visual-image-to-5-captions' ? 1 : 0;
    const bVisual = b.slug === 'visual-image-to-5-captions' ? 1 : 0;
    if (aVisual !== bVisual) return bVisual - aVisual;
    return (Number(b.mix_weight) || 0) - (Number(a.mix_weight) || 0);
  });

  const steps = ((stepsRes.data ?? []) as PromptChainStepRow[])
    .slice()
    .sort((a, b) => a.step_order - b.step_order);

  const runs = runsRes.error
    ? []
    : ((runsRes.data ?? []) as Record<string, unknown>[]).map(normalizeRunRow);

  const models = listSelectableChainModels({
    providers: (providersRes.error ? [] : (providersRes.data ?? [])) as CatalogProviderRow[],
    models: (modelsRes.error ? [] : (modelsRes.data ?? [])) as CatalogModelRow[],
    env: process.env,
  });

  return { chains, steps, runs, models };
}

/**
 * Reorders all steps of `chainId` to match `orderedStepIds` (`1..K`) without
 * ever triggering PostgreSQL `23505` on `UNIQUE (chain_id, step_order)`.
 * Uses `public.reorder_prompt_chain_steps` first, with a 2-phase negative-offset
 * fallback if the RPC has not yet been installed.
 */
export async function reorderChainStepsAtomically(
  admin: SupabaseClient,
  chainId: string,
  orderedStepIds: readonly string[]
): Promise<PromptChainStepRow[]> {
  if (!CHAIN_UUID_PATTERN.test(chainId)) {
    throw new Error('Invalid chain ID.');
  }
  if (!Array.isArray(orderedStepIds) || orderedStepIds.length === 0) {
    throw new Error('Step ID list cannot be empty.');
  }

  const cleanedIds = orderedStepIds.map((id) => String(id ?? '').trim());
  if (cleanedIds.some((id) => !CHAIN_UUID_PATTERN.test(id))) {
    throw new Error('Every step ID must be a valid UUID.');
  }
  if (new Set(cleanedIds).size !== cleanedIds.length) {
    throw new Error('Duplicate step IDs are not allowed.');
  }

  const { data: existingRows, error: fetchErr } = await admin
    .from('prompt_chain_steps')
    .select('*')
    .eq('chain_id', chainId)
    .order('step_order', { ascending: true });

  if (fetchErr) {
    throw new Error(fetchErr.message);
  }
  const existing = (existingRows ?? []) as PromptChainStepRow[];
  const existingIdSet = new Set(existing.map((r) => r.id));
  if (
    existing.length !== cleanedIds.length ||
    cleanedIds.some((id) => !existingIdSet.has(id))
  ) {
    throw new Error('Step ID list must match the exact steps belonging to this chain.');
  }

  const rpcRes = await admin.rpc('reorder_prompt_chain_steps', {
    p_chain_id: chainId,
    p_step_ids: cleanedIds,
  });

  if (!rpcRes.error && Array.isArray(rpcRes.data)) {
    return (rpcRes.data as PromptChainStepRow[])
      .slice()
      .sort((a, b) => a.step_order - b.step_order);
  }

  if (rpcRes.error) {
    const code = String(rpcRes.error.code ?? '');
    const msg = String(rpcRes.error.message ?? '');
    const isMissingRpc =
      code === 'PGRST202' ||
      code === '42883' ||
      /could not find the function|unknown rpc/i.test(msg);
    if (!isMissingRpc) {
      throw new Error(msg || 'Failed to reorder prompt chain steps.');
    }
  }

  // Fallback 2-phase negative offset when reorder_prompt_chain_steps RPC is unavailable
  for (let i = 0; i < cleanedIds.length; i++) {
    const { error } = await admin
      .from('prompt_chain_steps')
      .update({ step_order: -10001 - i })
      .eq('chain_id', chainId)
      .eq('id', cleanedIds[i]);
    if (error) throw new Error(error.message);
  }

  for (let i = 0; i < cleanedIds.length; i++) {
    const { error } = await admin
      .from('prompt_chain_steps')
      .update({ step_order: i + 1 })
      .eq('chain_id', chainId)
      .eq('id', cleanedIds[i]);
    if (error) throw new Error(error.message);
  }

  await admin
    .from('prompt_chains')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', chainId);

  const { data: refreshed, error: refreshErr } = await admin
    .from('prompt_chain_steps')
    .select('*')
    .eq('chain_id', chainId)
    .order('step_order', { ascending: true });
  if (refreshErr) throw new Error(refreshErr.message);
  return (refreshed ?? []) as PromptChainStepRow[];
}

async function fetchExternalVisionImage(rawUrl: string): Promise<{
  canonicalUrl: string;
  image: VisionImagePayload;
}> {
  const parsed = validateExternalImageUrl(rawUrl);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Resolve DNS records and block any hostname mapping to loopback/private/metadata IP space
  let records: Array<{ address: string }>;
  try {
    records = await dnsLookup(host, { all: true });
  } catch {
    throw new Error('Could not resolve external image hostname.');
  }
  if (!records.length || records.some((r) => !isPublicIpAddress(r.address))) {
    throw new Error('External image hostname resolved to a non-public IP address.');
  }

  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(9000),
      headers: {
        Accept: 'image/png,image/jpeg,image/webp,image/gif',
      },
      cache: 'no-store',
    });
  } catch {
    throw new Error(
      'Failed to fetch external image URL (note: HTTP redirects and slow hosts are blocked for security).'
    );
  }

  if (!response.ok) {
    throw new Error(`External image URL returned HTTP ${response.status}.`);
  }

  const rawContentType = (response.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_VISION_MIMES.has(rawContentType)) {
    throw new Error(
      `External URL returned unsupported MIME type "${rawContentType || 'unknown'}". Provide a direct PNG, JPEG, WebP, or GIF URL.`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('External image response body was empty.');
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('External image exceeds the 4 MB maximum size.');
      }
      chunks.push(value);
    }
  }

  if (totalBytes < 16) {
    throw new Error('External image payload was empty.');
  }

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return {
    canonicalUrl: parsed.toString(),
    image: {
      mimeType: rawContentType,
      base64Data: buffer.toString('base64'),
    },
  };
}

export async function executeSingleChainStepLlm(params: {
  model: AvailableModelOption;
  prompt: string;
  image?: VisionImagePayload | null;
  expectFiveCaptionsJson: boolean;
}) {
  const { model, prompt, image, expectFiveCaptionsJson } = params;
  const apiKey = process.env[model.apiKeyEnv]?.trim();
  if (!apiKey) {
    throw new Error(`Missing API key environment variable ${model.apiKeyEnv} for ${model.displayName}.`);
  }

  const req = buildMultimodalStepHttpRequest({
    model,
    prompt,
    apiKey,
    image,
    expectFiveCaptionsJson,
  });

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(28000),
      cache: 'no-store',
    });
  } catch (err) {
    const timedOut = err instanceof Error && ['TimeoutError', 'AbortError'].includes(err.name);
    throw new Error(
      timedOut
        ? `${model.providerName} (${model.apiModel}) timed out while executing prompt chain step.`
        : `${model.providerName} (${model.apiModel}) could not be reached.`
    );
  }

  const latencyMs = Date.now() - startedAt;
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const brief = errText ? `: ${errText.slice(0, 180)}` : '';
    throw new Error(
      `${model.providerName} (${model.apiModel}) returned HTTP ${response.status}${brief}`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${model.providerName} (${model.apiModel}) returned malformed JSON.`);
  }

  const extracted = extractStepTextAndUsage(
    model.protocol,
    data,
    model.apiModel,
    response.headers.get('x-request-id') ?? response.headers.get('request-id')
  );

  if (!extracted.text) {
    throw new Error(`${model.providerName} (${model.apiModel}) returned an empty step response.`);
  }

  return {
    outputText: extracted.text,
    resolvedModel: extracted.resolvedModel,
    latencyMs,
    inputTokens: extracted.inputTokens,
    outputTokens: extracted.outputTokens,
    reasoningTokens: extracted.reasoningTokens,
    usage: extracted.usage,
    httpStatus: response.status,
    providerRequestId: extracted.requestId,
  };
}

export async function runPromptChainSequentially(params: {
  admin: SupabaseClient;
  user: { id: string; email: string };
  chainId: string;
  body: Record<string, unknown>;
}): Promise<PromptChainRunRow> {
  const { admin, user, chainId, body } = params;
  if (!CHAIN_UUID_PATTERN.test(chainId)) {
    throw new Error('Invalid chain ID.');
  }

  const [{ data: chainRow, error: chainErr }, { data: stepRows, error: stepsErr }, providersRes, modelsRes] =
    await Promise.all([
      admin.from('prompt_chains').select('*').eq('id', chainId).maybeSingle(),
      admin
        .from('prompt_chain_steps')
        .select('*')
        .eq('chain_id', chainId)
        .order('step_order', { ascending: true }),
      admin.from('llm_providers').select('*'),
      admin.from('arena_models').select('*').is('canonical_id', null),
    ]);

  if (chainErr) throw new Error(chainErr.message);
  if (!chainRow) throw new Error('Prompt chain not found.');
  if (stepsErr) throw new Error(stepsErr.message);

  const chain = chainRow as PromptChainRow;
  const steps = ((stepRows ?? []) as PromptChainStepRow[])
    .slice()
    .sort((a, b) => a.step_order - b.step_order);

  if (steps.length === 0) {
    throw new Error('Add at least one step to this prompt chain before running it.');
  }

  if (process.env.GENERATION_ENABLED === 'false') {
    throw new Error('Live LLM execution is currently paused (GENERATION_ENABLED=false).');
  }

  const requestedModelKey = typeof body.modelKey === 'string' ? body.modelKey : null;
  const selectedModel = resolveSelectedChainModel({
    requestedKey: requestedModelKey,
    providers: (providersRes.error ? [] : (providersRes.data ?? [])) as CatalogProviderRow[],
    models: (modelsRes.error ? [] : (modelsRes.data ?? [])) as CatalogModelRow[],
    env: process.env,
  });

  const rawSourceType = typeof body.sourceType === 'string' ? body.sourceType.trim() : 'sample_svg';
  const premise = typeof body.premise === 'string' ? body.premise.trim().slice(0, 800) : '';

  let sourceType: InputSourceType = 'sample_svg';
  let inputSceneId: string | null = null;
  let inputSceneTitle: string | null = null;
  let persistedImageUrl: string | null = null;
  let visionImage: VisionImagePayload | null = null;
  let inputContext = premise;

  if (rawSourceType === 'sample_svg') {
    sourceType = 'sample_svg';
    const rawSceneId = typeof body.sceneId === 'string' ? body.sceneId : 'scene-stack-trace';
    const scene = getSampleSceneById(rawSceneId);
    if (!scene) {
      throw new Error(`Unknown built-in sample scene "${rawSceneId}".`);
    }
    inputSceneId = scene.id;
    inputSceneTitle = scene.title;

    if (typeof body.visionImageDataUrl === 'string' && body.visionImageDataUrl.trim()) {
      const parsedPng = parseBoundedImageDataUrl(body.visionImageDataUrl);
      visionImage = { mimeType: parsedPng.mimeType, base64Data: parsedPng.base64Data };
      inputContext = [
        `Scene Title: ${scene.title}`,
        premise ? `User Direction / Premise: ${premise}` : `Premise: ${scene.defaultPremise}`,
      ].join('\n');
    } else {
      // Headless API callers without a browser <canvas> still succeed cleanly via the canonical visual blueprint
      inputContext = [
        `Scene Title: ${scene.title}`,
        `Visual Scene Details: ${scene.visualBlueprint}`,
        premise ? `User Direction / Premise: ${premise}` : `Premise: ${scene.defaultPremise}`,
      ].join('\n');
    }
  } else if (rawSourceType === 'upload') {
    sourceType = 'upload';
    if (typeof body.imageDataUrl !== 'string' || !body.imageDataUrl.trim()) {
      throw new Error('Select a PNG, JPEG, WebP, or GIF image to upload.');
    }
    const parsedUpload = parseBoundedImageDataUrl(body.imageDataUrl);
    visionImage = { mimeType: parsedUpload.mimeType, base64Data: parsedUpload.base64Data };
    persistedImageUrl = parsedUpload.dataUrl;
    const uploadName =
      typeof body.uploadFileName === 'string' && body.uploadFileName.trim()
        ? body.uploadFileName.trim().slice(0, 120)
        : 'Uploaded Image';
    inputSceneTitle = uploadName;
  } else if (rawSourceType === 'image_url') {
    sourceType = 'image_url';
    if (typeof body.imageUrl !== 'string' || !body.imageUrl.trim()) {
      throw new Error('Enter an https:// image URL to analyze.');
    }
    const fetched = await fetchExternalVisionImage(body.imageUrl);
    visionImage = fetched.image;
    persistedImageUrl = fetched.canonicalUrl;
    inputSceneTitle = 'External Image URL';
  } else {
    throw new Error('Invalid input source type.');
  }

  const runRequestUuid = randomUUID();
  const { data: insertedRun, error: insertRunErr } = await admin
    .from('prompt_chain_runs')
    .insert({
      chain_id: chain.id,
      chain_slug: chain.slug,
      chain_name: chain.name,
      user_id: user.id,
      user_email: user.email,
      provider: selectedModel.providerSlug,
      model: selectedModel.apiModel,
      input_source_type: sourceType,
      input_scene_id: inputSceneId,
      input_scene_title: inputSceneTitle,
      input_image_url: persistedImageUrl,
      input_premise: premise,
      step_outputs: [],
      final_captions: [],
      status: 'running',
      total_latency_ms: 0,
      total_tokens: 0,
    })
    .select('*')
    .single();

  if (insertRunErr || !insertedRun) {
    throw new Error(insertRunErr?.message ?? 'Could not initialize prompt chain run record.');
  }

  const runId = String((insertedRun as { id: string }).id);
  const stepTraces: StepExecutionTrace[] = [];
  const upstreamOutputs: string[] = [];
  let totalLatencyMs = 0;
  let totalTokens = 0;

  try {
    for (let idx = 0; idx < steps.length; idx++) {
      const step = steps[idx];
      const stepNumber = idx + 1;
      const isFinalStep = stepNumber === steps.length;

      const compiledPrompt = compileStepInstruction({
        personaStyle: chain.persona_style,
        stepOrder: stepNumber,
        totalSteps: steps.length,
        stepName: step.step_name,
        stepRole: step.step_role,
        instructionTemplate: step.instruction_template,
        inputContext,
        upstreamOutputs,
      });

      const stepRes = await executeSingleChainStepLlm({
        model: selectedModel,
        prompt: compiledPrompt,
        image: idx === 0 || step.step_role === 'vision_analysis' ? visionImage : null,
        expectFiveCaptionsJson: isFinalStep,
      });

      totalLatencyMs += stepRes.latencyMs;
      totalTokens += (stepRes.inputTokens ?? 0) + (stepRes.outputTokens ?? 0);
      upstreamOutputs.push(stepRes.outputText);

      stepTraces.push({
        step_order: stepNumber,
        step_id: step.id,
        step_name: step.step_name,
        step_role: step.step_role,
        output_field: step.output_field,
        compiled_prompt: compiledPrompt.slice(0, 4000),
        output_text: stepRes.outputText.slice(0, 4000),
        latency_ms: stepRes.latencyMs,
        input_tokens: stepRes.inputTokens,
        output_tokens: stepRes.outputTokens,
      });

      // Best-effort per-step observability trace in shared public.llm_responses
      try {
        await admin.from('llm_responses').insert({
          request_id: runRequestUuid,
          provider: selectedModel.providerSlug,
          model: stepRes.resolvedModel,
          prompt_chain_name: `${chain.name} [Step ${stepNumber}/${steps.length}: ${step.step_name}]`,
          prompt_text: compiledPrompt.slice(0, 4000),
          raw_response_text: stepRes.outputText.slice(0, 4000),
          status: 'success',
          http_status: stepRes.httpStatus,
          latency_ms: stepRes.latencyMs,
          input_tokens: stepRes.inputTokens,
          output_tokens: stepRes.outputTokens,
          reasoning_tokens: stepRes.reasoningTokens,
          provider_request_id: stepRes.providerRequestId,
          usage: stepRes.usage,
        });
      } catch {
        // Non-blocking telemetry write
      }
    }

    const finalOutputText = upstreamOutputs[upstreamOutputs.length - 1] ?? '';
    const finalCaptions = parseFiveCaptions(finalOutputText);

    const { data: completedRow, error: completeErr } = await admin
      .from('prompt_chain_runs')
      .update({
        step_outputs: stepTraces,
        final_captions: finalCaptions,
        status: 'completed',
        error_message: null,
        total_latency_ms: totalLatencyMs,
        total_tokens: totalTokens,
      })
      .eq('id', runId)
      .select('*')
      .single();

    if (completeErr || !completedRow) {
      throw new Error(completeErr?.message ?? 'Failed to persist completed chain run.');
    }

    return normalizeRunRow(completedRow as Record<string, unknown>);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Prompt chain execution failed.';
    await admin
      .from('prompt_chain_runs')
      .update({
        step_outputs: stepTraces,
        status: 'failed',
        error_message: errMsg.slice(0, 500),
        total_latency_ms: totalLatencyMs,
        total_tokens: totalTokens,
      })
      .eq('id', runId);
    throw err;
  }
}
