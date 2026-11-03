export type SupportedProtocol =
  | 'openai_responses'
  | 'openai_chat_completions'
  | 'gemini_generate_content'
  | 'anthropic_messages';

export type SampleSceneId =
  | 'scene-stack-trace'
  | 'scene-burning-ci'
  | 'scene-cat-force-push'
  | 'scene-ai-toaster';

export type InputSourceType = 'sample_svg' | 'upload' | 'image_url' | 'text_only';

export type PromptChainRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  persona_style: string;
  mix_weight: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PromptChainStepRow = {
  id: string;
  chain_id: string;
  step_order: number;
  step_name: string;
  step_role: string;
  instruction_template: string;
  output_field: string | null;
  created_at: string;
};

export type StepExecutionTrace = {
  step_order: number;
  step_id: string | null;
  step_name: string;
  step_role: string;
  output_field: string | null;
  compiled_prompt: string;
  output_text: string;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
};

export type PromptChainRunRow = {
  id: string;
  chain_id: string;
  chain_slug: string;
  chain_name: string;
  user_id: string | null;
  user_email: string | null;
  provider: string;
  model: string;
  input_source_type: InputSourceType;
  input_scene_id: string | null;
  input_scene_title: string | null;
  input_image_url: string | null;
  input_premise: string;
  step_outputs: StepExecutionTrace[];
  final_captions: string[];
  status: 'running' | 'completed' | 'failed';
  error_message: string | null;
  total_latency_ms: number;
  total_tokens: number;
  created_at: string;
};

export type AvailableModelOption = {
  key: string;
  modelId: string | null;
  providerSlug: string;
  providerName: string;
  protocol: SupportedProtocol;
  apiBaseUrl: string;
  apiKeyEnv: string;
  apiModel: string;
  displayName: string;
  maxOutputTokens: number;
  configured: boolean;
};

export type StudioInitialData = {
  chains: PromptChainRow[];
  steps: PromptChainStepRow[];
  runs: PromptChainRunRow[];
  models: AvailableModelOption[];
};
