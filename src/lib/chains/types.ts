export type StepProvider = 'gemini' | 'openai' | 'anthropic';

export type StepModality = 'text' | 'image_generation';

export type DecompositionMode =
  | 'compound_word'
  | 'compound_idea'
  | 'sound_meaning'
  | 'flexible';

export type PartRole = 'MEANING' | 'SOUND_ONLY';

export interface HanziGlyphData {
  character: string;
  strokes: string[];
  // 0 = neutral stroke (--stroke-neutral, e.g. null match), 1..4 = --part-1..4
  strokePartIndex: number[];
}

export interface HanziPartSpec {
  part_number: number;
  glyph: string;
  pinyin: string;
  gloss: string;
  role: PartRole;
  role_badge: string;
  sound_note?: string;
  scene_cue?: string;
}

export interface SuggestedSampleChip {
  hanzi: string;
  gloss: string;
  chain_slug: string;
}

export interface LookupVerdict {
  ok: boolean;
  status: 'fit' | 'fit_mismatch' | 'base_pictograph' | 'invalid';
  input: string;
  pinyin: string;
  english_meaning: string;
  decomposition_label: string;
  etymology_type: string;
  etymology_hint: string;
  requested_mode: DecompositionMode;
  effective_mode: 'compound_word' | 'compound_idea' | 'sound_meaning';
  fitting_chain_slug: string | null;
  fitting_chain_name: string | null;
  mismatch_title: string | null;
  mismatch_reason: string | null;
  suggested_samples: SuggestedSampleChip[];
  anti_target: string;
  glyphs: HanziGlyphData[];
  parts: HanziPartSpec[];
}

export interface MnemonicCardData {
  input: string;
  pinyin: string;
  english_meaning: string;
  chain_mode: 'compound_word' | 'compound_idea' | 'sound_meaning';
  method_badge: string;
  etymology_hint?: string;
  mnemonic_hook: string;
  glyphs: HanziGlyphData[];
  legend_items: HanziPartSpec[];
  scene_checklist: string;
  image_prompt: string;
  text_only_preview: boolean;
  daily_cap_reached?: boolean;
}

export interface PromptChainRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  persona_style: string;
  is_active: boolean;
  mix_weight: number;
  app_scope: string;
  decomposition_mode: DecompositionMode;
  created_at: string;
  updated_at: string;
}

export interface PromptChainStepRow {
  id: string;
  chain_id: string;
  step_order: number;
  step_name: string;
  step_role: string;
  instruction_template: string;
  output_field: string;
  provider: StepProvider;
  model_id: string;
  temperature: number;
  step_modality: StepModality;
  created_at: string;
}

export interface StepExecutionTrace {
  step_order: number;
  step_name: string;
  step_role: string;
  output_field: string;
  provider: StepProvider;
  model_id: string;
  temperature: number;
  step_modality: StepModality;
  compiled_prompt: string;
  output_text: string;
  latency_ms: number;
  tokens: number;
}

export interface PromptChainRunRow {
  id: string;
  chain_id: string;
  chain_slug: string;
  chain_name: string;
  user_id: string | null;
  user_email: string | null;
  provider: string;
  model: string;
  input_source_type: string;
  input_premise: string;
  input_tags: string[];
  step_outputs: StepExecutionTrace[];
  final_captions: string[];
  generated_media_url: string | null;
  generated_media_mime: string;
  generated_media_prompt: string | null;
  structured_card: MnemonicCardData;
  status: 'running' | 'completed' | 'failed';
  error_message: string | null;
  total_latency_ms: number;
  total_tokens: number;
  app_scope: string;
  created_at: string;
}

export interface SelectableModelOption {
  provider: StepProvider;
  modelId: string;
  label: string;
  shortLabel: string;
  modality: StepModality;
  tierBadge: string;
  requiresPaidKey: boolean;
  available: boolean;
}

export interface DailyImageBudget {
  usedToday: number;
  dailyCap: number;
  remaining: number;
}

export interface StudioInitialData {
  chains: PromptChainRow[];
  stepsByChainId: Record<string, PromptChainStepRow[]>;
  runs: PromptChainRunRow[];
  models: SelectableModelOption[];
  providerStatus: {
    geminiFreeConfigured: boolean;
    geminiPaidConfigured: boolean;
  };
  imageBudget: DailyImageBudget;
}

export type SseRunEvent =
  | { type: 'lookup_complete'; lookup: LookupVerdict }
  | { type: 'fit_mismatch'; lookup: LookupVerdict }
  | {
      type: 'step_started';
      step_order: number;
      total_steps: number;
      step_name: string;
      step_role: string;
      model_id: string;
      temperature: number;
      step_modality: StepModality;
    }
  | {
      type: 'step_completed';
      trace: StepExecutionTrace;
      total_steps: number;
    }
  | {
      type: 'run_completed';
      run: PromptChainRunRow;
      imageBudget: DailyImageBudget;
      imageWarning?: string;
    }
  | {
      type: 'run_error';
      step_order?: number;
      message: string;
    };
