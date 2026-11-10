import type {
  DecompositionMode,
  SelectableModelOption,
  StepModality,
  StepProvider,
} from './types';

export const HANZI_APP_SCOPE = 'hanzi_mnemonic';
export const DEFAULT_DAILY_IMAGE_CAP = 40;

export interface SampleChipDef {
  hanzi: string;
  gloss: string;
}

export interface MethodTabSpec {
  slug: string;
  mode: Exclude<DecompositionMode, 'flexible'>;
  shortLabel: string;
  fullTitle: string;
  methodBadge: string;
  summary: string;
  graderSamples: readonly SampleChipDef[];
  unseenSamples: readonly SampleChipDef[];
}

export const HANZI_METHOD_TABS: readonly MethodTabSpec[] = [
  {
    slug: 'compound-word',
    mode: 'compound_word',
    shortLabel: 'Compound Word',
    fullTitle: 'Compound Word · Meaning + Meaning',
    methodBadge: 'COMPOUND WORD · LITERAL MORPHEMES',
    summary: 'Combines the literal meaning of each character in a 2-to-4 character word.',
    graderSamples: [
      { hanzi: '猫头鹰', gloss: 'owl' },
      { hanzi: '电脑', gloss: 'computer' },
      { hanzi: '长颈鹿', gloss: 'giraffe' },
      { hanzi: '熊猫', gloss: 'panda' },
      { hanzi: '袋鼠', gloss: 'kangaroo' },
      { hanzi: '火车', gloss: 'train' },
    ],
    unseenSamples: [
      { hanzi: '松鼠', gloss: 'squirrel' },
      { hanzi: '眼镜', gloss: 'glasses' },
      { hanzi: '海豚', gloss: 'dolphin' },
    ],
  },
  {
    slug: 'compound-idea',
    mode: 'compound_idea',
    shortLabel: 'Compound Idea',
    fullTitle: 'Compound Idea · Radical + Radical',
    methodBadge: 'COMPOUND IDEA · IDEOGRAPHIC PARTS',
    summary: 'Combines two or three meaning components inside a single character into one concept.',
    graderSamples: [
      { hanzi: '休', gloss: 'rest' },
      { hanzi: '泪', gloss: 'tears' },
      { hanzi: '森', gloss: 'forest' },
      { hanzi: '囚', gloss: 'prisoner' },
      { hanzi: '尖', gloss: 'pointed' },
      { hanzi: '明', gloss: 'bright' },
    ],
    unseenSamples: [
      { hanzi: '看', gloss: 'look' },
      { hanzi: '歪', gloss: 'crooked' },
      { hanzi: '拿', gloss: 'hold' },
    ],
  },
  {
    slug: 'sound-meaning',
    mode: 'sound_meaning',
    shortLabel: 'Sound+Meaning',
    fullTitle: 'Sound + Meaning · Meaning + Phonetic',
    methodBadge: 'SOUND + MEANING · PICTOPHONETIC',
    summary: 'Pairs one meaning radical with one sound-only phonetic component.',
    graderSamples: [
      { hanzi: '妈', gloss: 'mother' },
      { hanzi: '洋', gloss: 'ocean' },
      { hanzi: '沐', gloss: 'bathe' },
      { hanzi: '清', gloss: 'clear' },
      { hanzi: '晴', gloss: 'sunny' },
      { hanzi: '抱', gloss: 'hug' },
    ],
    unseenSamples: [
      { hanzi: '问', gloss: 'ask' },
      { hanzi: '铜', gloss: 'copper' },
      { hanzi: '骑', gloss: 'ride' },
    ],
  },
];

export const DECOMPOSITION_MODE_OPTIONS: ReadonlyArray<{
  value: DecompositionMode;
  label: string;
  badge: string;
}> = [
  {
    value: 'flexible',
    label: 'Flexible Lookup: Any Valid Hanzi or Word',
    badge: 'CUSTOM DEFAULT',
  },
  {
    value: 'compound_word',
    label: 'Compound Word (2–4 Characters)',
    badge: 'MORPHEMES',
  },
  {
    value: 'compound_idea',
    label: 'Compound Idea (Ideographic Single Character)',
    badge: 'IDEOGRAPHIC',
  },
  {
    value: 'sound_meaning',
    label: 'Sound + Meaning (Pictophonetic Single Character)',
    badge: 'PICTOPHONETIC',
  },
];

// Empirically locked 5-model roster (#761): $0 Free-Tier text models + $0.0336/img Flash image models only.
export interface ModelCatalogItem {
  provider: StepProvider;
  modelId: string;
  label: string;
  shortLabel: string;
  modality: StepModality;
  tierBadge: string;
  requiresPaidKey: boolean;
}

export const HANZI_MODEL_CATALOG: readonly ModelCatalogItem[] = [
  {
    provider: 'gemini',
    modelId: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite · Free Tier',
    shortLabel: '3.5 Lite',
    modality: 'text',
    tierBadge: 'Project A · $0 Free',
    requiresPaidKey: false,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash · Free Tier',
    shortLabel: '3 Flash',
    modality: 'text',
    tierBadge: 'Project A · $0 Free',
    requiresPaidKey: false,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite · Free Tier',
    shortLabel: '3.1 Lite',
    modality: 'text',
    tierBadge: 'Project A · $0 Free',
    requiresPaidKey: false,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-3.1-flash-lite-image',
    label: 'Gemini 3.1 Flash-Lite Image · $0.034/img',
    shortLabel: '3.1 Img',
    modality: 'image_generation',
    tierBadge: 'Project B · $0.034/img',
    requiresPaidKey: true,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-nano-banana-2.1',
    label: 'Gemini Nano Banana 2.1 · $0.034/img',
    shortLabel: 'Nano 2.1',
    modality: 'image_generation',
    tierBadge: 'Project B · $0.034/img',
    requiresPaidKey: true,
  },
];

export function formatShortModelLabel(modelId: string): string {
  const hit = HANZI_MODEL_CATALOG.find((m) => m.modelId === modelId);
  if (hit) return hit.shortLabel;
  return modelId.replace(/^gemini-/, '').slice(0, 14);
}

export function buildSelectableModels(
  env: Record<string, string | undefined> = process.env
): SelectableModelOption[] {
  const freeOk = Boolean(env.GEMINI_API_KEY?.trim() || env.GEMINI_PAID_API_KEY?.trim());
  const paidOk = Boolean(env.GEMINI_PAID_API_KEY?.trim());
  return HANZI_MODEL_CATALOG.map((item) => ({
    ...item,
    available: item.requiresPaidKey ? paidOk : freeOk,
  }));
}

export function resolveMethodTabForMode(mode: DecompositionMode): MethodTabSpec {
  if (mode === 'compound_idea') return HANZI_METHOD_TABS[1];
  if (mode === 'sound_meaning') return HANZI_METHOD_TABS[2];
  return HANZI_METHOD_TABS[0];
}

export const DEFAULT_STARTER_STEPS: ReadonlyArray<{
  step_name: string;
  step_role: string;
  output_field: string;
  provider: StepProvider;
  model_id: string;
  temperature: number;
  step_modality: StepModality;
  instruction_template: string;
}> = [
  {
    step_name: 'Part Roles & Concrete Nouns',
    step_role: 'roles',
    output_field: 'part_roles_brief',
    provider: 'gemini',
    model_id: 'gemini-3.5-flash-lite',
    temperature: 0.1,
    step_modality: 'text',
    instruction_template:
      'Read {{lookup_json}} for {{input}}. State each part role (MEANING vs SOUND_ONLY), assign one concrete physical object per part (using a brass bell or horn with concentric sound ripples for any SOUND_ONLY part), and name the forbidden anti_target appearance.',
  },
  {
    step_name: 'Absurd Component Scene',
    step_role: 'scene',
    output_field: 'scene_invention',
    provider: 'gemini',
    model_id: 'gemini-3-flash-preview',
    temperature: 0.85,
    step_modality: 'text',
    instruction_template:
      'Using {{prev_output}}, invent one vivid, memorable physical scene built strictly from the literal component objects (never the ordinary target appearance) plus a 1-sentence mnemonic hook in plain English.',
  },
  {
    step_name: 'Zero-Text 1:1 Prompt & Legend JSON',
    step_role: 'prompt_json',
    output_field: 'mnemonic_card_json',
    provider: 'gemini',
    model_id: 'gemini-3.1-flash-lite',
    temperature: 0.15,
    step_modality: 'text',
    instruction_template:
      'Compile {{step_1_output}} and {{prev_output}} into strict JSON with keys mnemonic_hook, image_prompt (full-shot centered 1:1 composition with generous 15% empty neutral cream margin on all four edges, garment/prop/foliage part-colour accents #E03131/#1971C2/#0CA678 while keeping natural animal fur/skin, zero text/letters/characters/numbers), and legend_items[{part_number, scene_cue}] (keep each scene_cue concise: 3 to 6 words).',
  },
  {
    step_name: '1:1 Mnemonic Scene Picture',
    step_role: 'picture',
    output_field: 'generated_scene_media',
    provider: 'gemini',
    model_id: 'gemini-3.1-flash-lite-image',
    temperature: 0.6,
    step_modality: 'image_generation',
    instruction_template: '{{prev_output}}',
  },
];
