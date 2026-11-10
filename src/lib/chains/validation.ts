import { HANZI_MODEL_CATALOG, resolveMethodTabForMode } from './presets';
import type {
  DecompositionMode,
  HanziPartSpec,
  LookupVerdict,
  MnemonicCardData,
  StepExecutionTrace,
  StepModality,
  StepProvider,
} from './types';

export const CHAIN_UUID_PATTERN =
  /^\p{Hex_Digit}{8}(?:-\p{Hex_Digit}{4}){3}-\p{Hex_Digit}{12}$/u;

export function escapePostgrestIlike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function normalizeDecompositionMode(
  raw: unknown,
  fallback: DecompositionMode = 'flexible'
): DecompositionMode {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'compound_word' || s === 'compound-word') return 'compound_word';
  if (s === 'compound_idea' || s === 'compound-idea') return 'compound_idea';
  if (s === 'sound_meaning' || s === 'sound-meaning') return 'sound_meaning';
  if (s === 'flexible') return 'flexible';
  return fallback;
}

export function inferDecompositionModeFromChain(
  slug: string,
  explicitMode?: unknown
): DecompositionMode {
  if (typeof explicitMode === 'string' && explicitMode.trim()) {
    const norm = normalizeDecompositionMode(explicitMode, 'flexible');
    if (norm !== 'flexible') return norm;
    if (slug === 'compound-word') return 'compound_word';
    if (slug === 'compound-idea') return 'compound_idea';
    if (slug === 'sound-meaning') return 'sound_meaning';
    return norm;
  }
  if (slug === 'compound-word') return 'compound_word';
  if (slug === 'compound-idea') return 'compound_idea';
  if (slug === 'sound-meaning') return 'sound_meaning';
  return 'flexible';
}

export function slugifyChainName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || 'hanzi-chain'}-${suffix}`;
}

export function clampStepTemperature(raw: unknown, fallback = 0.35): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(Math.max(0, Math.min(2, num)) * 100) / 100;
}

// Normalizes any model ID onto the locked 5-model roster (strictly blocking high-cost Pro image & deprecated models).
export function normalizeModelId(raw: unknown, modality: StepModality = 'text'): string {
  const candidate = String(raw ?? '').trim();
  const hit = HANZI_MODEL_CATALOG.find((m) => m.modelId === candidate);
  if (hit) {
    if (modality === 'image_generation' && hit.modality !== 'image_generation') {
      return 'gemini-3.1-flash-lite-image';
    }
    if (modality === 'text' && hit.modality === 'image_generation') {
      return 'gemini-3.5-flash-lite';
    }
    return hit.modelId;
  }

  if (modality === 'image_generation') {
    if (candidate.includes('nano-banana')) return 'gemini-nano-banana-2.1';
    return 'gemini-3.1-flash-lite-image';
  }

  if (candidate.includes('3-flash') || candidate.includes('3.8')) {
    return 'gemini-3-flash-preview';
  }
  if (candidate.includes('3.1')) {
    return 'gemini-3.1-flash-lite';
  }
  return 'gemini-3.5-flash-lite';
}

export function normalizeStepModality(raw: unknown, modelId: string): StepModality {
  if (raw === 'image_generation') return 'image_generation';
  const catalogHit = HANZI_MODEL_CATALOG.find((m) => m.modelId === modelId);
  return catalogHit?.modality ?? 'text';
}

export function resolveProviderForModel(): StepProvider {
  return 'gemini';
}

export function validateChainInput(
  raw: unknown,
  opts?: { isUpdate?: boolean }
): {
  name: string;
  description: string;
  persona_style: string;
  decomposition_mode: DecompositionMode;
  is_active: boolean;
} {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  if (name.length < 2 || name.length > 90) {
    throw new Error('Chain name must be between 2 and 90 characters.');
  }

  const descRaw = String(body.description ?? '').trim();
  const description = descRaw ? descRaw.slice(0, 400) : '';

  const personaRaw = String(body.persona_style ?? '').trim();
  const persona_style =
    personaRaw.length >= 2
      ? personaRaw.slice(0, 260)
      : 'Clear pedagogical Chinese component mnemonics with vivid concrete visual objects and zero invented etymology.';

  const decomposition_mode = normalizeDecompositionMode(
    body.decomposition_mode,
    opts?.isUpdate ? 'compound_word' : 'flexible'
  );
  const is_active = body.is_active === false ? false : true;

  return { name, description, persona_style, decomposition_mode, is_active };
}

export function validateStepInput(raw: unknown): {
  step_name: string;
  step_role: string;
  instruction_template: string;
  output_field: string;
  provider: StepProvider;
  model_id: string;
  temperature: number;
  step_modality: StepModality;
} {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const step_name = String(body.step_name ?? '').trim();
  if (step_name.length < 2 || step_name.length > 80) {
    throw new Error('Step name must be between 2 and 80 characters.');
  }

  const step_role = String(body.step_role ?? 'analysis')
    .trim()
    .slice(0, 40) || 'analysis';
  const instruction_template = String(body.instruction_template ?? '').trim();
  if (instruction_template.length < 4 || instruction_template.length > 4000) {
    throw new Error('Step instruction template must be between 4 and 4000 characters.');
  }

  const output_field =
    String(body.output_field ?? 'step_output')
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 48) || 'step_output';

  const requestedModality: StepModality =
    body.step_modality === 'image_generation' ? 'image_generation' : 'text';
  const model_id = normalizeModelId(body.model_id, requestedModality);
  const step_modality = normalizeStepModality(body.step_modality, model_id);
  const provider = resolveProviderForModel();
  const temperature = clampStepTemperature(
    body.temperature,
    step_modality === 'image_generation' ? 0.6 : 0.25
  );

  return {
    step_name,
    step_role,
    instruction_template,
    output_field,
    provider,
    model_id,
    temperature,
    step_modality,
  };
}

const PART_COLOR_DESCRIPTIONS = [
  'crimson-red (#E03131)',
  'cobalt-blue (#1971C2)',
  'emerald-green (#0CA678)',
  'warm-amber (#D97706)',
] as const;

export function buildLookupFactPacketJson(lookup: LookupVerdict): string {
  return JSON.stringify(
    {
      input: lookup.input,
      pinyin: lookup.pinyin,
      english_meaning: lookup.english_meaning,
      decomposition_method: lookup.effective_mode,
      etymology_type: lookup.etymology_type,
      etymology_hint: lookup.etymology_hint,
      anti_target_do_not_draw: lookup.anti_target,
      parts: lookup.parts.map((p, idx) => ({
        part_number: p.part_number,
        glyph: p.glyph,
        pinyin: p.pinyin,
        meaning: p.gloss,
        role: p.role,
        sound_note: p.sound_note ?? null,
        suggested_accessory_tint: PART_COLOR_DESCRIPTIONS[idx] ?? PART_COLOR_DESCRIPTIONS[0],
      })),
    },
    null,
    2
  );
}

export function compileMnemonicStepInstruction(params: {
  template: string;
  lookup: LookupVerdict;
  chainName: string;
  personaStyle: string;
  priorOutputs: readonly StepExecutionTrace[];
}): string {
  const { template, lookup, chainName, personaStyle, priorOutputs } = params;
  const lookupJson = buildLookupFactPacketJson(lookup);
  const prev = priorOutputs.length > 0 ? priorOutputs[priorOutputs.length - 1].output_text : '';
  const referencedUpstream = /\{\{\s*(prev_output|step_\d+_output|lookup_json)\s*\}\}/i.test(
    template
  );

  let compiled = template
    .replace(/\{\{\s*input\s*\}\}/gi, lookup.input)
    .replace(/\{\{\s*pinyin\s*\}\}/gi, lookup.pinyin)
    .replace(/\{\{\s*meaning\s*\}\}/gi, lookup.english_meaning)
    .replace(/\{\{\s*anti_target\s*\}\}/gi, lookup.anti_target)
    .replace(/\{\{\s*lookup_json\s*\}\}/gi, lookupJson)
    .replace(/\{\{\s*prev_output\s*\}\}/gi, prev)
    .replace(/\{\{\s*chain_name\s*\}\}/gi, chainName)
    .replace(/\{\{\s*persona_style\s*\}\}/gi, personaStyle);

  compiled = compiled.replace(/\{\{\s*step_(\d+)_output\s*\}\}/gi, (_, idxStr: string) => {
    const idx = Number(idxStr);
    const hit = priorOutputs[idx - 1];
    return hit ? hit.output_text : '';
  });

  const header =
    `Chain: ${chainName} (${lookup.effective_mode})\n` +
    `Editorial Persona: ${personaStyle}\n` +
    `Target Item: ${lookup.input} (${lookup.pinyin} — "${lookup.english_meaning}")\n` +
    `Forbidden Ordinary Appearance (DO NOT DRAW): ${lookup.anti_target}\n\n`;

  const extraContext = !referencedUpstream
    ? priorOutputs.length === 0
      ? `\n\nDeterministic Dataset Lookup:\n${lookupJson}`
      : `\n\nUpstream Step ${priorOutputs.length} Output:\n${prev}`
    : '';

  return `${header}${compiled.trim()}${extraContext}`;
}

export function stripCjkAndControlChars(raw: string): string {
  return raw
    .replace(/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripJsonCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

const TRAILING_DANGLING_STOPWORDS =
  /\s+\b(?:a|an|the|and|or|but|with|without|in|on|at|to|of|for|by|into|from|beneath|under|over|above|beside|near|positioned|placed|colored|coloured|directly|wearing|holding|having|reflecting|that|which|is|are)$/i;

export function truncateAtWordBoundary(raw: string, maxChars: number): string {
  const clean = raw
    .replace(/\s+/g, ' ')
    .replace(/^[(\s]+|[)\s]+$/g, '')
    .trim();
  let out = clean;
  if (clean.length > maxChars) {
    const sliced = clean.slice(0, maxChars);
    const lastBreak = Math.max(
      sliced.lastIndexOf(' '),
      sliced.lastIndexOf(','),
      sliced.lastIndexOf(';')
    );
    out = lastBreak >= Math.floor(maxChars * 0.4) ? sliced.slice(0, lastBreak) : sliced;
  }
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out
      .replace(/[,;:\s.-]+$/g, '')
      .replace(TRAILING_DANGLING_STOPWORDS, '')
      .trim();
  }
  return out;
}

export function primaryGlossNoun(gloss: string): string {
  const first = gloss
    .split(/[,;/]/)
    .map((s) => s.trim())
    .find(Boolean);
  return first || gloss.trim();
}

export function formatLiveTracePreview(raw: string): string {
  const trimmed = stripJsonCodeFences(raw);
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.mnemonic_hook === 'string' && parsed.mnemonic_hook.trim()) {
        return parsed.mnemonic_hook.replace(/\s+/g, ' ').trim();
      }
    } catch {
      // Fall through to plain-text Markdown stripping below
    }
  }
  return raw
    .replace(/```[a-z]*\n?/gi, ' ')
    .replace(/```/g, ' ')
    .replace(/^\s*[-*•]\s+/gm, ' · ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)\*(?=\S)|(?<=\S)\*(?=\s|$)/g, '$1')
    .replace(/[\r\n]+/g, ' · ')
    .replace(/(?:\s*·\s*)+/g, ' · ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const ZERO_TEXT_MARGIN_GUARDRAIL =
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin on all four edges so no object touches the border. Keep natural animal fur and skin textures while placing subtle crimson-red, cobalt-blue, or emerald-green accents on collars, clothing, ribbons, props, or foliage. STRICTLY ZERO TEXT: no Chinese characters, no Hanzi, no English letters, no words, no numbers, no labels, no speech bubbles, no signs, no watermarks.';

export function buildFallbackZeroTextImagePrompt(lookup: LookupVerdict): string {
  const partPhrases = lookup.parts.map((p, idx) => {
    const colorTag = PART_COLOR_DESCRIPTIONS[idx] ?? 'crimson-red';
    if (p.role === 'SOUND_ONLY') {
      return `a concrete ${p.gloss} accented with ${colorTag} ringing a gleaming golden brass bell emitting concentric circular sound-wave ripples`;
    }
    return `a concrete ${p.gloss} accented with ${colorTag}`;
  });
  return (
    `Combine ${partPhrases.join(' and ')} together in one single vivid, absurd storybook scene. ` +
    `Do NOT draw ${lookup.anti_target}. ${ZERO_TEXT_MARGIN_GUARDRAIL}`
  );
}

export function compileCardFromTextTraces(params: {
  lookup: LookupVerdict;
  rawStepText: string;
  textOnlyPreview: boolean;
  dailyCapReached?: boolean;
}): { card: MnemonicCardData; imagePrompt: string } {
  const { lookup, rawStepText, textOnlyPreview, dailyCapReached } = params;
  const tabSpec = resolveMethodTabForMode(lookup.effective_mode);

  let mnemonicHook = '';
  let compiledPrompt = '';
  const cueByPart = new Map<number, string>();

  if (rawStepText.trim()) {
    try {
      const parsed = JSON.parse(stripJsonCodeFences(rawStepText)) as Record<string, unknown>;
      if (typeof parsed.mnemonic_hook === 'string') {
        mnemonicHook = parsed.mnemonic_hook.trim();
      } else if (typeof parsed.mnemonic_story === 'string') {
        mnemonicHook = parsed.mnemonic_story.trim();
      }
      if (typeof parsed.image_prompt === 'string') {
        compiledPrompt = stripCjkAndControlChars(parsed.image_prompt);
      }
      if (Array.isArray(parsed.legend_items)) {
        for (const item of parsed.legend_items) {
          if (item && typeof item === 'object') {
            const rec = item as Record<string, unknown>;
            const pNum = Number(rec.part_number);
            const cue = String(rec.scene_cue ?? rec.spot_in_scene ?? '').trim();
            if (Number.isFinite(pNum) && cue) {
              cueByPart.set(pNum, truncateAtWordBoundary(cue, 64));
            }
          }
        }
      }
    } catch {
      // If a user reordered steps so the last text step emitted prose instead of JSON, extract cleanly.
      const cleanProse = rawStepText.replace(/\*\*/g, '').trim();
      mnemonicHook = cleanProse.split(/\n+/)[0]?.slice(0, 260) ?? '';
      compiledPrompt = stripCjkAndControlChars(cleanProse.slice(0, 420));
    }
  }

  if (!mnemonicHook) {
    mnemonicHook =
      lookup.effective_mode === 'sound_meaning'
        ? `Spot ${lookup.parts[0]?.gloss} (${lookup.parts[0]?.glyph}) for the meaning "${lookup.english_meaning}", while ${lookup.parts[1]?.gloss} (${lookup.parts[1]?.glyph}, ${lookup.parts[1]?.pinyin}) rings a bell strictly to cue the sound "${lookup.pinyin}".`
        : `Combine ${lookup.parts.map((p) => `${p.gloss} (${p.glyph})`).join(' + ')} in one scene to remember "${lookup.english_meaning}" (${lookup.pinyin}).`;
  }

  const finalImagePrompt = compiledPrompt
    ? `${compiledPrompt} Do NOT draw ${lookup.anti_target}. ${ZERO_TEXT_MARGIN_GUARDRAIL}`
    : buildFallbackZeroTextImagePrompt(lookup);

  const legendItems: HanziPartSpec[] = lookup.parts.map((p) => ({
    ...p,
    scene_cue:
      cueByPart.get(p.part_number) ??
      (p.role === 'SOUND_ONLY'
        ? `${p.gloss} with brass bell (cues sound ${lookup.pinyin})`
        : `${p.gloss} in scene`),
  }));

  const circled = ['①', '②', '③', '④'];
  const sceneChecklist = `${legendItems
    .map((item, idx) => {
      const noun = primaryGlossNoun(item.gloss);
      const tag =
        item.role === 'SOUND_ONLY' ? `${noun} bell (sound ${lookup.pinyin})` : noun;
      return `${circled[idx] ?? `${idx + 1}.`} ${tag}`;
    })
    .join(' + ')} (0 text in image)`;

  return {
    card: {
      input: lookup.input,
      pinyin: lookup.pinyin,
      english_meaning: lookup.english_meaning,
      chain_mode: lookup.effective_mode,
      method_badge: tabSpec.methodBadge,
      etymology_hint: lookup.etymology_hint,
      mnemonic_hook: mnemonicHook,
      glyphs: lookup.glyphs,
      legend_items: legendItems,
      scene_checklist: sceneChecklist,
      image_prompt: finalImagePrompt,
      text_only_preview: textOnlyPreview,
      daily_cap_reached: dailyCapReached,
    },
    imagePrompt: finalImagePrompt,
  };
}

export function normalizeRunStepOutputs(raw: unknown): StepExecutionTrace[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const step_modality: StepModality =
      r.step_modality === 'image_generation' ? 'image_generation' : 'text';
    return {
      step_order: Number(r.step_order) || idx + 1,
      step_name: String(r.step_name ?? `Step ${idx + 1}`),
      step_role: String(r.step_role ?? 'step'),
      output_field: String(r.output_field ?? 'output'),
      provider: 'gemini',
      model_id: normalizeModelId(r.model_id, step_modality),
      temperature: clampStepTemperature(r.temperature, 0.3),
      step_modality,
      compiled_prompt: String(r.compiled_prompt ?? ''),
      output_text: String(r.output_text ?? ''),
      latency_ms: Number(r.latency_ms) || 0,
      tokens: Number(r.tokens) || 0,
    };
  });
}

export function normalizeStoredCard(
  rawCard: unknown,
  fallbackLookup: LookupVerdict,
  hasMedia: boolean
): MnemonicCardData {
  const c = (rawCard && typeof rawCard === 'object' ? rawCard : {}) as Record<string, unknown>;
  const tabSpec = resolveMethodTabForMode(fallbackLookup.effective_mode);

  const legendRaw = Array.isArray(c.legend_items) ? c.legend_items : [];
  const legendItems: HanziPartSpec[] =
    legendRaw.length > 0
      ? legendRaw.map((item, idx) => {
          const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          const fb = fallbackLookup.parts[idx];
          const role = rec.role === 'SOUND_ONLY' || fb?.role === 'SOUND_ONLY' ? 'SOUND_ONLY' : 'MEANING';
          return {
            part_number: Number(rec.part_number) || idx + 1,
            glyph: String(rec.glyph ?? fb?.glyph ?? ''),
            pinyin: String(rec.pinyin ?? fb?.pinyin ?? ''),
            gloss: String(rec.gloss ?? fb?.gloss ?? ''),
            role,
            role_badge: String(
              rec.role_badge ??
                fb?.role_badge ??
                (role === 'SOUND_ONLY' ? '♪ SOUND PART · FOR PRONUNCIATION ONLY' : 'MEANING PART')
            ),
            sound_note:
              typeof rec.sound_note === 'string' ? rec.sound_note : fb?.sound_note,
            scene_cue:
              typeof rec.scene_cue === 'string' && rec.scene_cue.trim()
                ? truncateAtWordBoundary(rec.scene_cue, 64)
                : undefined,
          };
        })
      : fallbackLookup.parts;

  const circled = ['①', '②', '③', '④'];
  const defaultChecklist = `${legendItems
    .map((it, idx) => {
      const noun = primaryGlossNoun(it.gloss);
      const tag =
        it.role === 'SOUND_ONLY'
          ? `${noun} bell (sound ${fallbackLookup.pinyin})`
          : noun;
      return `${circled[idx] ?? `${idx + 1}.`} ${tag}`;
    })
    .join(' + ')} (0 text in image)`;

  return {
    input: String(c.input ?? fallbackLookup.input),
    pinyin: String(c.pinyin ?? fallbackLookup.pinyin),
    english_meaning: String(c.english_meaning ?? fallbackLookup.english_meaning),
    chain_mode:
      c.chain_mode === 'compound_idea' || c.chain_mode === 'sound_meaning'
        ? c.chain_mode
        : fallbackLookup.effective_mode,
    method_badge: String(c.method_badge ?? tabSpec.methodBadge),
    etymology_hint:
      typeof c.etymology_hint === 'string' ? c.etymology_hint : fallbackLookup.etymology_hint,
    mnemonic_hook: String(
      c.mnemonic_hook ??
        `Combine ${legendItems.map((l) => `${l.gloss} (${l.glyph})`).join(' + ')} to remember "${fallbackLookup.english_meaning}".`
    ),
    // Always hydrate accurate stroke SVGs & colour indices from the bundled Make Me a Hanzi dataset!
    glyphs: fallbackLookup.glyphs,
    legend_items: legendItems,
    scene_checklist:
      typeof c.scene_checklist === 'string' && !c.scene_checklist.includes(',')
        ? c.scene_checklist
        : defaultChecklist,
    image_prompt: String(c.image_prompt ?? buildFallbackZeroTextImagePrompt(fallbackLookup)),
    text_only_preview: typeof c.text_only_preview === 'boolean' ? c.text_only_preview : !hasMedia,
    daily_cap_reached: Boolean(c.daily_cap_reached),
  };
}
