-- ============================================================================
-- Week 9 Additive Migration: Hanzi Parts Studio (`app_scope = 'hanzi_mnemonic'`)
-- Chinese Visual Mnemonic Flashcards Powered by Make Me a Hanzi + CC-CEDICT,
-- Additive `decomposition_mode` Column, 23505-Safe `reorder_prompt_chain_steps`,
-- Conditional `chain-media` Bucket, 3 Seeded 4-Step Linguistic Chains (`mix_weight = 0`),
-- and 18 Verified $0.034/img `gemini-3.1-flash-lite-image` 1:1 Showcase Cards.
-- 100% Idempotent & Co-Tenant Compatible on Shared Database A.
-- ============================================================================
begin;

-- 1. Additive `app_scope` and `decomposition_mode` columns on `public.prompt_chains`
alter table public.prompt_chains
  add column if not exists app_scope text not null default 'joke_arena';

alter table public.prompt_chains
  add column if not exists decomposition_mode text not null default 'flexible'
    check (decomposition_mode in ('compound_word', 'compound_idea', 'sound_meaning', 'flexible'));

create index if not exists prompt_chains_app_scope_idx
  on public.prompt_chains (app_scope, created_at asc);

-- 2. Additive per-step LLM, Temperature, and Modality columns on `public.prompt_chain_steps`
alter table public.prompt_chain_steps
  add column if not exists provider text not null default 'gemini'
    check (provider in ('gemini', 'openai', 'anthropic'));

alter table public.prompt_chain_steps
  add column if not exists model_id text not null default 'gemini-3.5-flash-lite';

alter table public.prompt_chain_steps
  alter column model_id set default 'gemini-3.5-flash-lite';

alter table public.prompt_chain_steps
  add column if not exists temperature numeric(3,2) not null default 0.70
    check (temperature >= 0.00 and temperature <= 2.00);

alter table public.prompt_chain_steps
  add column if not exists step_modality text not null default 'text'
    check (step_modality in ('text', 'image_generation'));

-- 3. Ensure `public.prompt_chain_runs` and superadmin RLS policy exist
create table if not exists public.prompt_chain_runs (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.prompt_chains(id) on delete cascade,
  chain_slug text not null,
  chain_name text not null,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  provider text not null,
  model text not null,
  input_source_type text not null default 'text_only'
    check (input_source_type in ('sample_svg', 'upload', 'image_url', 'text_only')),
  input_scene_id text,
  input_scene_title text,
  input_image_url text,
  input_premise text not null default '',
  step_outputs jsonb not null default '[]'::jsonb,
  final_captions jsonb not null default '[]'::jsonb,
  status text not null default 'completed'
    check (status in ('running', 'completed', 'failed')),
  error_message text,
  total_latency_ms integer not null default 0,
  total_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists prompt_chain_runs_chain_created_idx
  on public.prompt_chain_runs (chain_id, created_at desc);
create index if not exists prompt_chain_runs_created_idx
  on public.prompt_chain_runs (created_at desc);

alter table public.prompt_chain_runs enable row level security;

drop policy if exists "prompt_chain_runs_superadmin_all" on public.prompt_chain_runs;
create policy "prompt_chain_runs_superadmin_all"
  on public.prompt_chain_runs
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_superadmin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_superadmin = true
    )
  );

revoke all on public.prompt_chain_runs from public, anon;
grant select, insert, update, delete on public.prompt_chain_runs to authenticated, service_role;
grant select on public.profiles to authenticated;

alter table public.prompt_chain_runs
  add column if not exists app_scope text not null default 'joke_arena';

alter table public.prompt_chain_runs
  add column if not exists input_tags jsonb not null default '[]'::jsonb;

alter table public.prompt_chain_runs
  add column if not exists generated_media_url text;

alter table public.prompt_chain_runs
  add column if not exists generated_media_mime text not null default 'image/png';

alter table public.prompt_chain_runs
  add column if not exists generated_media_prompt text;

alter table public.prompt_chain_runs
  add column if not exists structured_card jsonb not null default '{}'::jsonb;

create index if not exists prompt_chain_runs_scope_chain_idx
  on public.prompt_chain_runs (app_scope, chain_id, created_at desc);

-- 4. Refresh 23505-safe `public.reorder_prompt_chain_steps`
drop function if exists public.reorder_prompt_chain_steps(uuid, uuid[]);

create or replace function public.reorder_prompt_chain_steps(
  p_chain_id uuid,
  p_step_ids uuid[]
)
returns setof public.prompt_chain_steps
language plpgsql
security definer set search_path = ''
as $$
declare
  jwt_claims text := nullif(current_setting('request.jwt.claims', true), '');
  active_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    case when jwt_claims is not null then jwt_claims::jsonb ->> 'role' else null end,
    nullif(nullif(current_setting('role', true), ''), 'none'),
    current_user
  );
  distinct_supplied integer;
  existing_count integer;
  matching_count integer;
begin
  if active_role in ('authenticated', 'anon') or (
    active_role not in ('service_role', 'postgres', 'supabase_admin')
    and auth.uid() is not null
  ) then
    if auth.uid() is null or not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_superadmin = true
    ) then
      raise exception 'Forbidden: superadmin privilege required to reorder prompt chain steps';
    end if;
  end if;

  perform 1 from public.prompt_chains where id = p_chain_id for update;
  if not found then
    raise exception 'Prompt chain not found';
  end if;

  if p_step_ids is null or coalesce(array_length(p_step_ids, 1), 0) = 0 then
    raise exception 'Step ID list cannot be empty';
  end if;

  if exists (select 1 from unnest(p_step_ids) as s(id) where s.id is null) then
    raise exception 'Step ID list cannot contain null values';
  end if;

  select count(distinct s.id) into distinct_supplied from unnest(p_step_ids) as s(id);
  if distinct_supplied <> array_length(p_step_ids, 1) then
    raise exception 'Duplicate step IDs are not allowed';
  end if;

  select count(*) into existing_count
  from public.prompt_chain_steps
  where chain_id = p_chain_id;

  select count(*) into matching_count
  from public.prompt_chain_steps
  where chain_id = p_chain_id
    and id = any(p_step_ids);

  if existing_count <> array_length(p_step_ids, 1) or matching_count <> existing_count then
    raise exception 'Step ID list must match the exact steps belonging to this chain';
  end if;

  update public.prompt_chain_steps
  set step_order = -step_order - 10000
  where chain_id = p_chain_id;

  update public.prompt_chain_steps st
  set step_order = ord.new_order::integer
  from unnest(p_step_ids) with ordinality as ord(step_id, new_order)
  where st.chain_id = p_chain_id
    and st.id = ord.step_id;

  update public.prompt_chains
  set updated_at = now()
  where id = p_chain_id;

  return query
    select *
    from public.prompt_chain_steps
    where chain_id = p_chain_id
    order by step_order asc;
end;
$$;

revoke all on function public.reorder_prompt_chain_steps(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_prompt_chain_steps(uuid, uuid[]) to authenticated, service_role;

-- 5. Conditional Supabase Storage Bucket (`chain-media`)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('chain-media', 'chain-media', true)
    on conflict (id) do nothing;
  end if;
end
$$;

-- 6. Seed 3 Linguistic Decomposition Chains (`app_scope = 'hanzi_mnemonic'`, `mix_weight = 0`)

insert into public.prompt_chains (
  id, slug, name, description, persona_style, mix_weight, is_active, app_scope, decomposition_mode, created_at
) values (
  'c9100000-0000-4000-8000-000000000001',
  'compound-word',
  'Compound Word · Meaning + Meaning',
  'Combines the literal meaning of each character in a 2-to-4 character word.',
  'Clear literal morpheme mnemonics combining concrete character objects into one absurd scene without drawing the ordinary target look.',
  0,
  true,
  'hanzi_mnemonic',
  'compound_word',
  timestamptz '2026-11-10T06:00:00Z'
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  persona_style = excluded.persona_style,
  mix_weight = 0,
  is_active = true,
  app_scope = 'hanzi_mnemonic',
  decomposition_mode = excluded.decomposition_mode,
  updated_at = now();

-- Replace seeded steps on compound-word cleanly
delete from public.prompt_chain_steps
where chain_id = (select id from public.prompt_chains where slug = 'compound-word');

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100001-0000-4000-8000-000000000001',
  (select id from public.prompt_chains where slug = 'compound-word'),
  1,
  'Part Roles & Concrete Nouns',
  'roles',
  'Read {{lookup_json}} for {{input}} ({{pinyin}}, {{meaning}}). State each part role (MEANING vs SOUND_ONLY), assign one unmistakable concrete physical object per part (using a gleaming brass bell or horn emitting concentric circular sound ripples for any SOUND_ONLY part, never speech bubbles), and state the forbidden anti_target appearance.',
  'part_roles_brief',
  'gemini',
  'gemini-3.5-flash-lite',
  0.10,
  'text'
);

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100001-0000-4000-8000-000000000002',
  (select id from public.prompt_chains where slug = 'compound-word'),
  2,
  'Absurd Component Scene',
  'scene',
  'Using {{prev_output}}, invent one vivid, memorable physical scene built strictly from the literal component objects in a single square frame (never the ordinary appearance {{anti_target}}) plus a 1-to-2 sentence learner mnemonic hook in plain English.',
  'scene_invention',
  'gemini',
  'gemini-3-flash-preview',
  0.85,
  'text'
);

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100001-0000-4000-8000-000000000003',
  (select id from public.prompt_chains where slug = 'compound-word'),
  3,
  'Zero-Text 1:1 Prompt & Legend JSON',
  'prompt_json',
  'Compile {{step_1_output}} and {{prev_output}} into strict JSON with keys mnemonic_hook, image_prompt (full-shot centered 1:1 composition with generous 15% empty neutral cream margin on all four edges so no object touches the border, subtle crimson-red/cobalt-blue/emerald-green garment/prop/foliage accents while keeping natural animal fur/skin, strictly zero text/letters/characters/numbers), and legend_items[{part_number, scene_cue}] (keep each scene_cue concise: 3 to 6 words).',
  'mnemonic_card_json',
  'gemini',
  'gemini-3.1-flash-lite',
  0.15,
  'text'
);

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100001-0000-4000-8000-000000000004',
  (select id from public.prompt_chains where slug = 'compound-word'),
  4,
  '1:1 Mnemonic Scene Picture',
  'picture',
  '{{prev_output}}',
  'generated_scene_media',
  'gemini',
  'gemini-3.1-flash-lite-image',
  0.60,
  'image_generation'
);

insert into public.prompt_chains (
  id, slug, name, description, persona_style, mix_weight, is_active, app_scope, decomposition_mode, created_at
) values (
  'c9100000-0000-4000-8000-000000000002',
  'compound-idea',
  'Compound Idea · Radical + Radical',
  'Combines two or three meaning radicals inside a single ideographic character into one concept.',
  'Spatial ideographic component storytelling mirroring left-right, top-bottom, or enclosure structure with zero invented etymology.',
  0,
  true,
  'hanzi_mnemonic',
  'compound_idea',
  timestamptz '2026-11-10T06:00:01Z'
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  persona_style = excluded.persona_style,
  mix_weight = 0,
  is_active = true,
  app_scope = 'hanzi_mnemonic',
  decomposition_mode = excluded.decomposition_mode,
  updated_at = now();

-- Replace seeded steps on compound-idea cleanly
delete from public.prompt_chain_steps
where chain_id = (select id from public.prompt_chains where slug = 'compound-idea');

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100002-0000-4000-8000-000000000001',
  (select id from public.prompt_chains where slug = 'compound-idea'),
  1,
  'Part Roles & Concrete Nouns',
  'roles',
  'Read {{lookup_json}} for {{input}} ({{pinyin}}, {{meaning}}). State each part role (MEANING vs SOUND_ONLY), assign one unmistakable concrete physical object per part (using a gleaming brass bell or horn emitting concentric circular sound ripples for any SOUND_ONLY part, never speech bubbles), and state the forbidden anti_target appearance.',
  'part_roles_brief',
  'gemini',
  'gemini-3.5-flash-lite',
  0.10,
  'text'
);

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100002-0000-4000-8000-000000000002',
  (select id from public.prompt_chains where slug = 'compound-idea'),
  2,
  'Absurd Component Scene',
  'scene',
  'Using {{prev_output}}, invent one vivid, memorable physical scene built strictly from the literal component objects in a single square frame (never the ordinary appearance {{anti_target}}) plus a 1-to-2 sentence learner mnemonic hook in plain English.',
  'scene_invention',
  'gemini',
  'gemini-3-flash-preview',
  0.85,
  'text'
);

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100002-0000-4000-8000-000000000003',
  (select id from public.prompt_chains where slug = 'compound-idea'),
  3,
  'Zero-Text 1:1 Prompt & Legend JSON',
  'prompt_json',
  'Compile {{step_1_output}} and {{prev_output}} into strict JSON with keys mnemonic_hook, image_prompt (full-shot centered 1:1 composition with generous 15% empty neutral cream margin on all four edges so no object touches the border, subtle crimson-red/cobalt-blue/emerald-green garment/prop/foliage accents while keeping natural animal fur/skin, strictly zero text/letters/characters/numbers), and legend_items[{part_number, scene_cue}] (keep each scene_cue concise: 3 to 6 words).',
  'mnemonic_card_json',
  'gemini',
  'gemini-3.1-flash-lite',
  0.15,
  'text'
);

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100002-0000-4000-8000-000000000004',
  (select id from public.prompt_chains where slug = 'compound-idea'),
  4,
  '1:1 Mnemonic Scene Picture',
  'picture',
  '{{prev_output}}',
  'generated_scene_media',
  'gemini',
  'gemini-3.1-flash-lite-image',
  0.60,
  'image_generation'
);

insert into public.prompt_chains (
  id, slug, name, description, persona_style, mix_weight, is_active, app_scope, decomposition_mode, created_at
) values (
  'c9100000-0000-4000-8000-000000000003',
  'sound-meaning',
  'Sound + Meaning · Meaning + Phonetic',
  'Pairs one meaning radical with one pronunciation-only phonetic component.',
  'Honest pictophonetic mnemonics separating the meaning radical from the ringing brass-bell sound component.',
  0,
  true,
  'hanzi_mnemonic',
  'sound_meaning',
  timestamptz '2026-11-10T06:00:02Z'
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  persona_style = excluded.persona_style,
  mix_weight = 0,
  is_active = true,
  app_scope = 'hanzi_mnemonic',
  decomposition_mode = excluded.decomposition_mode,
  updated_at = now();

-- Replace seeded steps on sound-meaning cleanly
delete from public.prompt_chain_steps
where chain_id = (select id from public.prompt_chains where slug = 'sound-meaning');

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100003-0000-4000-8000-000000000001',
  (select id from public.prompt_chains where slug = 'sound-meaning'),
  1,
  'Part Roles & Concrete Nouns',
  'roles',
  'Read {{lookup_json}} for {{input}} ({{pinyin}}, {{meaning}}). State each part role (MEANING vs SOUND_ONLY), assign one unmistakable concrete physical object per part (using a gleaming brass bell or horn emitting concentric circular sound ripples for any SOUND_ONLY part, never speech bubbles), and state the forbidden anti_target appearance.',
  'part_roles_brief',
  'gemini',
  'gemini-3.5-flash-lite',
  0.10,
  'text'
);

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100003-0000-4000-8000-000000000002',
  (select id from public.prompt_chains where slug = 'sound-meaning'),
  2,
  'Absurd Component Scene',
  'scene',
  'Using {{prev_output}}, invent one vivid, memorable physical scene built strictly from the literal component objects in a single square frame (never the ordinary appearance {{anti_target}}) plus a 1-to-2 sentence learner mnemonic hook in plain English.',
  'scene_invention',
  'gemini',
  'gemini-3-flash-preview',
  0.85,
  'text'
);

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100003-0000-4000-8000-000000000003',
  (select id from public.prompt_chains where slug = 'sound-meaning'),
  3,
  'Zero-Text 1:1 Prompt & Legend JSON',
  'prompt_json',
  'Compile {{step_1_output}} and {{prev_output}} into strict JSON with keys mnemonic_hook, image_prompt (full-shot centered 1:1 composition with generous 15% empty neutral cream margin on all four edges so no object touches the border, subtle crimson-red/cobalt-blue/emerald-green garment/prop/foliage accents while keeping natural animal fur/skin, strictly zero text/letters/characters/numbers), and legend_items[{part_number, scene_cue}] (keep each scene_cue concise: 3 to 6 words).',
  'mnemonic_card_json',
  'gemini',
  'gemini-3.1-flash-lite',
  0.15,
  'text'
);

insert into public.prompt_chain_steps (
  id, chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
) values (
  'e9100003-0000-4000-8000-000000000004',
  (select id from public.prompt_chains where slug = 'sound-meaning'),
  4,
  '1:1 Mnemonic Scene Picture',
  'picture',
  '{{prev_output}}',
  'generated_scene_media',
  'gemini',
  'gemini-3.1-flash-lite-image',
  0.60,
  'image_generation'
);


-- 7. Seed 18 Curated 1:1 Showcase Mnemonic Cards (6 per Chain)

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000001',
  (select id from public.prompt_chains where slug = 'compound-word'),
  'compound-word',
  'Compound Word · Meaning + Meaning',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '猫头鹰',
  '["compound_word", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 猫头鹰 (māo tóu yīng — owl)", "output_text": "Part 1 猫 (māo, cat) [MEANING]: ginger tabby cat face & crimson collar; Part 2 头 (tóu, head) [MEANING]: cat head joined at cobalt bandana; Part 3 鹰 (yīng, eagle) [MEANING]: spread golden eagle wings & talons", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 猫头鹰 (owl)", "output_text": "Picture a majestic golden eagle (鹰) perched on a mossy pine branch, except its head (头) is a fluffy ginger house cat (猫): Chinese literally names an owl a ''cat-headed eagle.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 猫头鹰", "output_text": "{\"mnemonic_hook\": \"Picture a majestic golden eagle (鹰) perched on a mossy pine branch, except its head (头) is a fluffy ginger house cat (猫): Chinese literally names an owl a ''cat-headed eagle.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin on all four edges: one mythical hybrid bird perched on an emerald mossy branch with the broad feathered wings and talons of a golden eagle topped seamlessly with a ginger tabby house cat head wearing a crimson collar and cobalt bandana. Do NOT draw an ordinary owl. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"ginger tabby cat face & crimson collar\"}, {\"part_number\": 2, \"scene_cue\": \"cat head joined at cobalt bandana\"}, {\"part_number\": 3, \"scene_cue\": \"spread golden eagle wings & talons\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin on all four edges: one mythical hybrid bird perched on an emerald mossy branch with the broad feathered wings and talons of a golden eagle topped seamlessly with a ginger tabby house cat head wearing a crimson collar and cobalt bandana. Do NOT draw an ordinary owl. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Picture a majestic golden eagle (鹰) perched on a mossy pine branch, except its head (头) is a fluffy ginger house cat (猫): Chinese literally names an owl a ''cat-headed eagle.''"]'::jsonb,
  '/showcase/cw-maotouying.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin on all four edges: one mythical hybrid bird perched on an emerald mossy branch with the broad feathered wings and talons of a golden eagle topped seamlessly with a ginger tabby house cat head wearing a crimson collar and cobalt bandana. Do NOT draw an ordinary owl. STRICTLY ZERO TEXT.',
  '{"input": "猫头鹰", "pinyin": "māo tóu yīng", "english_meaning": "owl", "chain_mode": "compound_word", "method_badge": "COMPOUND WORD · LITERAL MORPHEMES", "mnemonic_hook": "Picture a majestic golden eagle (鹰) perched on a mossy pine branch, except its head (头) is a fluffy ginger house cat (猫): Chinese literally names an owl a ''cat-headed eagle.''", "legend_items": [{"part_number": 1, "glyph": "猫", "pinyin": "māo", "gloss": "cat", "role": "MEANING", "role_badge": "MEANING PART 1", "scene_cue": "ginger tabby cat face & crimson collar"}, {"part_number": 2, "glyph": "头", "pinyin": "tóu", "gloss": "head", "role": "MEANING", "role_badge": "MEANING PART 2", "scene_cue": "cat head joined at cobalt bandana"}, {"part_number": 3, "glyph": "鹰", "pinyin": "yīng", "gloss": "eagle", "role": "MEANING", "role_badge": "MEANING PART 3", "scene_cue": "spread golden eagle wings & talons"}], "scene_checklist": "① cat + ② head + ③ eagle (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin on all four edges: one mythical hybrid bird perched on an emerald mossy branch with the broad feathered wings and talons of a golden eagle topped seamlessly with a ginger tabby house cat head wearing a crimson collar and cobalt bandana. Do NOT draw an ordinary owl. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:40:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000002',
  (select id from public.prompt_chains where slug = 'compound-word'),
  'compound-word',
  'Compound Word · Meaning + Meaning',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '电脑',
  '["compound_word", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 电脑 (diàn nǎo — computer)", "output_text": "Part 1 电 (diàn, electricity) [MEANING]: crackling electric lightning bolts; Part 2 脑 (nǎo, brain) [MEANING]: anatomical brain on cobalt pedestal", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 电脑 (computer)", "output_text": "Instead of a metal laptop, picture bright electric lightning bolts (电) arcing across a sculpted anatomical brain (脑) on a cobalt pedestal: a computer is literally an ''electric brain.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 电脑", "output_text": "{\"mnemonic_hook\": \"Instead of a metal laptop, picture bright electric lightning bolts (电) arcing across a sculpted anatomical brain (脑) on a cobalt pedestal: a computer is literally an ''electric brain.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a sculpted coral anatomical brain resting on a cobalt-blue porcelain pedestal while bright electric lightning bolts crackle across its folds. Do NOT draw a laptop or monitor. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"crackling electric lightning bolts\"}, {\"part_number\": 2, \"scene_cue\": \"anatomical brain on cobalt pedestal\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a sculpted coral anatomical brain resting on a cobalt-blue porcelain pedestal while bright electric lightning bolts crackle across its folds. Do NOT draw a laptop or monitor. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Instead of a metal laptop, picture bright electric lightning bolts (电) arcing across a sculpted anatomical brain (脑) on a cobalt pedestal: a computer is literally an ''electric brain.''"]'::jsonb,
  '/showcase/cw-diannao.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a sculpted coral anatomical brain resting on a cobalt-blue porcelain pedestal while bright electric lightning bolts crackle across its folds. Do NOT draw a laptop or monitor. STRICTLY ZERO TEXT.',
  '{"input": "电脑", "pinyin": "diàn nǎo", "english_meaning": "computer", "chain_mode": "compound_word", "method_badge": "COMPOUND WORD · LITERAL MORPHEMES", "mnemonic_hook": "Instead of a metal laptop, picture bright electric lightning bolts (电) arcing across a sculpted anatomical brain (脑) on a cobalt pedestal: a computer is literally an ''electric brain.''", "legend_items": [{"part_number": 1, "glyph": "电", "pinyin": "diàn", "gloss": "electricity", "role": "MEANING", "role_badge": "MEANING PART 1", "scene_cue": "crackling electric lightning bolts"}, {"part_number": 2, "glyph": "脑", "pinyin": "nǎo", "gloss": "brain", "role": "MEANING", "role_badge": "MEANING PART 2", "scene_cue": "anatomical brain on cobalt pedestal"}], "scene_checklist": "① electricity + ② brain (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a sculpted coral anatomical brain resting on a cobalt-blue porcelain pedestal while bright electric lightning bolts crackle across its folds. Do NOT draw a laptop or monitor. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:39:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000003',
  (select id from public.prompt_chains where slug = 'compound-word'),
  'compound-word',
  'Compound Word · Meaning + Meaning',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '长颈鹿',
  '["compound_word", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 长颈鹿 (cháng jǐng lù — giraffe)", "output_text": "Part 1 长 (cháng, long) [MEANING]: extra-long vertical stretch & crimson scarf; Part 2 颈 (jǐng, neck) [MEANING]: slender neck rising through cobalt cloud; Part 3 鹿 (lù, deer) [MEANING]: antlered stag deer in emerald meadow", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 长颈鹿 (giraffe)", "output_text": "Spot a woodland stag deer with branching antlers (鹿) whose slender neck (颈) stretches impossibly long (长) straight up through a cobalt cloud ring: a giraffe is literally a ''long-necked deer.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 长颈鹿", "output_text": "{\"mnemonic_hook\": \"Spot a woodland stag deer with branching antlers (鹿) whose slender neck (颈) stretches impossibly long (长) straight up through a cobalt cloud ring: a giraffe is literally a ''long-necked deer.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a single spotted woodland stag deer with branching antlers standing in an emerald meadow whose slender neck stretches impossibly long through a cobalt cloud ring with a crimson scarf. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"extra-long vertical stretch & crimson scarf\"}, {\"part_number\": 2, \"scene_cue\": \"slender neck rising through cobalt cloud\"}, {\"part_number\": 3, \"scene_cue\": \"antlered stag deer in emerald meadow\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a single spotted woodland stag deer with branching antlers standing in an emerald meadow whose slender neck stretches impossibly long through a cobalt cloud ring with a crimson scarf. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Spot a woodland stag deer with branching antlers (鹿) whose slender neck (颈) stretches impossibly long (长) straight up through a cobalt cloud ring: a giraffe is literally a ''long-necked deer.''"]'::jsonb,
  '/showcase/cw-changjinglu.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a single spotted woodland stag deer with branching antlers standing in an emerald meadow whose slender neck stretches impossibly long through a cobalt cloud ring with a crimson scarf. STRICTLY ZERO TEXT.',
  '{"input": "长颈鹿", "pinyin": "cháng jǐng lù", "english_meaning": "giraffe", "chain_mode": "compound_word", "method_badge": "COMPOUND WORD · LITERAL MORPHEMES", "mnemonic_hook": "Spot a woodland stag deer with branching antlers (鹿) whose slender neck (颈) stretches impossibly long (长) straight up through a cobalt cloud ring: a giraffe is literally a ''long-necked deer.''", "legend_items": [{"part_number": 1, "glyph": "长", "pinyin": "cháng", "gloss": "long", "role": "MEANING", "role_badge": "MEANING PART 1", "scene_cue": "extra-long vertical stretch & crimson scarf"}, {"part_number": 2, "glyph": "颈", "pinyin": "jǐng", "gloss": "neck", "role": "MEANING", "role_badge": "MEANING PART 2", "scene_cue": "slender neck rising through cobalt cloud"}, {"part_number": 3, "glyph": "鹿", "pinyin": "lù", "gloss": "deer", "role": "MEANING", "role_badge": "MEANING PART 3", "scene_cue": "antlered stag deer in emerald meadow"}], "scene_checklist": "① long + ② neck + ③ deer (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a single spotted woodland stag deer with branching antlers standing in an emerald meadow whose slender neck stretches impossibly long through a cobalt cloud ring with a crimson scarf. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:38:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000004',
  (select id from public.prompt_chains where slug = 'compound-word'),
  'compound-word',
  'Compound Word · Meaning + Meaning',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '熊猫',
  '["compound_word", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 熊猫 (xióng māo — panda)", "output_text": "Part 1 熊 (xióng, bear) [MEANING]: shaggy brown bear torso & crimson vest; Part 2 猫 (māo, cat) [MEANING]: whiskered cat head & cobalt-ribbon tail", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 熊猫 (panda)", "output_text": "Imagine a burly brown grizzly bear (熊) wearing a crimson vest fused with a whiskered ginger house cat (猫) and striped cat tail: Chinese literally calls a panda a ''bear-cat.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 熊猫", "output_text": "{\"mnemonic_hook\": \"Imagine a burly brown grizzly bear (熊) wearing a crimson vest fused with a whiskered ginger house cat (猫) and striped cat tail: Chinese literally calls a panda a ''bear-cat.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a burly brown grizzly bear body in a crimson vest seamlessly topped with a whiskered ginger tabby cat head and curled cat tail tied with a cobalt ribbon. Do NOT draw a black-and-white panda. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"shaggy brown bear torso & crimson vest\"}, {\"part_number\": 2, \"scene_cue\": \"whiskered cat head & cobalt-ribbon tail\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a burly brown grizzly bear body in a crimson vest seamlessly topped with a whiskered ginger tabby cat head and curled cat tail tied with a cobalt ribbon. Do NOT draw a black-and-white panda. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Imagine a burly brown grizzly bear (熊) wearing a crimson vest fused with a whiskered ginger house cat (猫) and striped cat tail: Chinese literally calls a panda a ''bear-cat.''"]'::jsonb,
  '/showcase/cw-xiongmao.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a burly brown grizzly bear body in a crimson vest seamlessly topped with a whiskered ginger tabby cat head and curled cat tail tied with a cobalt ribbon. Do NOT draw a black-and-white panda. STRICTLY ZERO TEXT.',
  '{"input": "熊猫", "pinyin": "xióng māo", "english_meaning": "panda", "chain_mode": "compound_word", "method_badge": "COMPOUND WORD · LITERAL MORPHEMES", "mnemonic_hook": "Imagine a burly brown grizzly bear (熊) wearing a crimson vest fused with a whiskered ginger house cat (猫) and striped cat tail: Chinese literally calls a panda a ''bear-cat.''", "legend_items": [{"part_number": 1, "glyph": "熊", "pinyin": "xióng", "gloss": "bear", "role": "MEANING", "role_badge": "MEANING PART 1", "scene_cue": "shaggy brown bear torso & crimson vest"}, {"part_number": 2, "glyph": "猫", "pinyin": "māo", "gloss": "cat", "role": "MEANING", "role_badge": "MEANING PART 2", "scene_cue": "whiskered cat head & cobalt-ribbon tail"}], "scene_checklist": "① bear + ② cat (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a burly brown grizzly bear body in a crimson vest seamlessly topped with a whiskered ginger tabby cat head and curled cat tail tied with a cobalt ribbon. Do NOT draw a black-and-white panda. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:37:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000005',
  (select id from public.prompt_chains where slug = 'compound-word'),
  'compound-word',
  'Compound Word · Meaning + Meaning',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '袋鼠',
  '["compound_word", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 袋鼠 (dài shǔ — kangaroo)", "output_text": "Part 1 袋 (dài, pouch / bag) [MEANING]: oversized crimson canvas front pouch; Part 2 鼠 (shǔ, mouse / rat) [MEANING]: plump grey mouse with round ears & tail", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 袋鼠 (kangaroo)", "output_text": "A plump whiskered grey mouse (鼠) stands upright wearing a giant crimson canvas front pouch (袋) tied with a cobalt cord: a kangaroo is literally a ''pouch-mouse.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 袋鼠", "output_text": "{\"mnemonic_hook\": \"A plump whiskered grey mouse (鼠) stands upright wearing a giant crimson canvas front pouch (袋) tied with a cobalt cord: a kangaroo is literally a ''pouch-mouse.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a plump grey whiskered mouse standing upright wearing an oversized crimson-red canvas front pouch tied with a cobalt sash. Do NOT draw a kangaroo. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"oversized crimson canvas front pouch\"}, {\"part_number\": 2, \"scene_cue\": \"plump grey mouse with round ears & tail\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a plump grey whiskered mouse standing upright wearing an oversized crimson-red canvas front pouch tied with a cobalt sash. Do NOT draw a kangaroo. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["A plump whiskered grey mouse (鼠) stands upright wearing a giant crimson canvas front pouch (袋) tied with a cobalt cord: a kangaroo is literally a ''pouch-mouse.''"]'::jsonb,
  '/showcase/cw-daishu.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a plump grey whiskered mouse standing upright wearing an oversized crimson-red canvas front pouch tied with a cobalt sash. Do NOT draw a kangaroo. STRICTLY ZERO TEXT.',
  '{"input": "袋鼠", "pinyin": "dài shǔ", "english_meaning": "kangaroo", "chain_mode": "compound_word", "method_badge": "COMPOUND WORD · LITERAL MORPHEMES", "mnemonic_hook": "A plump whiskered grey mouse (鼠) stands upright wearing a giant crimson canvas front pouch (袋) tied with a cobalt cord: a kangaroo is literally a ''pouch-mouse.''", "legend_items": [{"part_number": 1, "glyph": "袋", "pinyin": "dài", "gloss": "pouch / bag", "role": "MEANING", "role_badge": "MEANING PART 1", "scene_cue": "oversized crimson canvas front pouch"}, {"part_number": 2, "glyph": "鼠", "pinyin": "shǔ", "gloss": "mouse / rat", "role": "MEANING", "role_badge": "MEANING PART 2", "scene_cue": "plump grey mouse with round ears & tail"}], "scene_checklist": "① pouch + ② mouse/rat (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a plump grey whiskered mouse standing upright wearing an oversized crimson-red canvas front pouch tied with a cobalt sash. Do NOT draw a kangaroo. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:36:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000006',
  (select id from public.prompt_chains where slug = 'compound-word'),
  'compound-word',
  'Compound Word · Meaning + Meaning',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '火车',
  '["compound_word", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 火车 (huǒ chē — train)", "output_text": "Part 1 火 (huǒ, fire) [MEANING]: roaring crimson-orange flames; Part 2 车 (chē, wheeled vehicle) [MEANING]: cobalt-blue four-wheeled cart", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 火车 (train)", "output_text": "A roaring crimson bonfire (火) burns inside a rolling cobalt-blue four-wheeled carriage cart (车): a train is literally a ''fire-vehicle'' from the steam-locomotive era.", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 火车", "output_text": "{\"mnemonic_hook\": \"A roaring crimson bonfire (火) burns inside a rolling cobalt-blue four-wheeled carriage cart (车): a train is literally a ''fire-vehicle'' from the steam-locomotive era.\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a cobalt-blue four-wheeled wooden carriage cart rolling along a country path with a roaring crimson-orange bonfire burning inside its open bed. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"roaring crimson-orange flames\"}, {\"part_number\": 2, \"scene_cue\": \"cobalt-blue four-wheeled cart\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a cobalt-blue four-wheeled wooden carriage cart rolling along a country path with a roaring crimson-orange bonfire burning inside its open bed. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["A roaring crimson bonfire (火) burns inside a rolling cobalt-blue four-wheeled carriage cart (车): a train is literally a ''fire-vehicle'' from the steam-locomotive era."]'::jsonb,
  '/showcase/cw-huoche.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a cobalt-blue four-wheeled wooden carriage cart rolling along a country path with a roaring crimson-orange bonfire burning inside its open bed. STRICTLY ZERO TEXT.',
  '{"input": "火车", "pinyin": "huǒ chē", "english_meaning": "train", "chain_mode": "compound_word", "method_badge": "COMPOUND WORD · LITERAL MORPHEMES", "mnemonic_hook": "A roaring crimson bonfire (火) burns inside a rolling cobalt-blue four-wheeled carriage cart (车): a train is literally a ''fire-vehicle'' from the steam-locomotive era.", "legend_items": [{"part_number": 1, "glyph": "火", "pinyin": "huǒ", "gloss": "fire", "role": "MEANING", "role_badge": "MEANING PART 1", "scene_cue": "roaring crimson-orange flames"}, {"part_number": 2, "glyph": "车", "pinyin": "chē", "gloss": "wheeled vehicle", "role": "MEANING", "role_badge": "MEANING PART 2", "scene_cue": "cobalt-blue four-wheeled cart"}], "scene_checklist": "① fire + ② wheeled cart (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a cobalt-blue four-wheeled wooden carriage cart rolling along a country path with a roaring crimson-orange bonfire burning inside its open bed. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:35:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000007',
  (select id from public.prompt_chains where slug = 'compound-idea'),
  'compound-idea',
  'Compound Idea · Radical + Radical',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '休',
  '["compound_idea", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 休 (xiū — to rest)", "output_text": "Part 1 亻 (rén, person) [MEANING]: traveler in crimson tunic resting on left; Part 2 木 (mù, tree) [MEANING]: shady cobalt-barked tree on right", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 休 (to rest)", "output_text": "A weary traveler person (亻) in a crimson tunic leans peacefully on the left against the trunk of a shady tree (木) on the right to rest.", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 休", "output_text": "{\"mnemonic_hook\": \"A weary traveler person (亻) in a crimson tunic leans peacefully on the left against the trunk of a shady tree (木) on the right to rest.\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: on the left, a relaxed traveler in a crimson tunic leans peacefully against the cobalt-shaded trunk of a large leafy tree on the right. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"traveler in crimson tunic resting on left\"}, {\"part_number\": 2, \"scene_cue\": \"shady cobalt-barked tree on right\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: on the left, a relaxed traveler in a crimson tunic leans peacefully against the cobalt-shaded trunk of a large leafy tree on the right. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["A weary traveler person (亻) in a crimson tunic leans peacefully on the left against the trunk of a shady tree (木) on the right to rest."]'::jsonb,
  '/showcase/ci-xiu.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: on the left, a relaxed traveler in a crimson tunic leans peacefully against the cobalt-shaded trunk of a large leafy tree on the right. STRICTLY ZERO TEXT.',
  '{"input": "休", "pinyin": "xiū", "english_meaning": "to rest", "chain_mode": "compound_idea", "method_badge": "COMPOUND IDEA · IDEOGRAPHIC PARTS", "mnemonic_hook": "A weary traveler person (亻) in a crimson tunic leans peacefully on the left against the trunk of a shady tree (木) on the right to rest.", "legend_items": [{"part_number": 1, "glyph": "亻", "pinyin": "rén", "gloss": "person", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "traveler in crimson tunic resting on left"}, {"part_number": 2, "glyph": "木", "pinyin": "mù", "gloss": "tree", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "shady cobalt-barked tree on right"}], "scene_checklist": "① person + ② tree (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: on the left, a relaxed traveler in a crimson tunic leans peacefully against the cobalt-shaded trunk of a large leafy tree on the right. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:34:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000008',
  (select id from public.prompt_chains where slug = 'compound-idea'),
  'compound-idea',
  'Compound Idea · Radical + Radical',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '泪',
  '["compound_idea", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 泪 (lèi — tears)", "output_text": "Part 1 氵 (shuǐ, water) [MEANING]: three glistening tear droplets; Part 2 目 (mù, eye) [MEANING]: expressive cobalt-iris human eye", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 泪 (tears)", "output_text": "Three glistening drops of water (氵) spill from the corner of a giant expressive cobalt-iris eye (目): water from the eye spells ''tears.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 泪", "output_text": "{\"mnemonic_hook\": \"Three glistening drops of water (氵) spill from the corner of a giant expressive cobalt-iris eye (目): water from the eye spells ''tears.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a giant expressive human eye with a vivid cobalt-blue iris and three glistening water droplets spilling out from the corner. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"three glistening tear droplets\"}, {\"part_number\": 2, \"scene_cue\": \"expressive cobalt-iris human eye\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a giant expressive human eye with a vivid cobalt-blue iris and three glistening water droplets spilling out from the corner. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Three glistening drops of water (氵) spill from the corner of a giant expressive cobalt-iris eye (目): water from the eye spells ''tears.''"]'::jsonb,
  '/showcase/ci-lei.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a giant expressive human eye with a vivid cobalt-blue iris and three glistening water droplets spilling out from the corner. STRICTLY ZERO TEXT.',
  '{"input": "泪", "pinyin": "lèi", "english_meaning": "tears", "chain_mode": "compound_idea", "method_badge": "COMPOUND IDEA · IDEOGRAPHIC PARTS", "mnemonic_hook": "Three glistening drops of water (氵) spill from the corner of a giant expressive cobalt-iris eye (目): water from the eye spells ''tears.''", "legend_items": [{"part_number": 1, "glyph": "氵", "pinyin": "shuǐ", "gloss": "water", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "three glistening tear droplets"}, {"part_number": 2, "glyph": "目", "pinyin": "mù", "gloss": "eye", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "expressive cobalt-iris human eye"}], "scene_checklist": "① water drops + ② eye (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a giant expressive human eye with a vivid cobalt-blue iris and three glistening water droplets spilling out from the corner. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:33:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000009',
  (select id from public.prompt_chains where slug = 'compound-idea'),
  'compound-idea',
  'Compound Idea · Radical + Radical',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '森',
  '["compound_idea", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 森 (sēn — forest)", "output_text": "Part 1 木 (mù, tree (top)) [MEANING]: crimson tree crowning top ridge; Part 2 木 (mù, tree (bottom-left)) [MEANING]: cobalt spruce on lower-left; Part 3 木 (mù, tree (bottom-right)) [MEANING]: emerald oak on lower-right", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 森 (forest)", "output_text": "One grand crimson tree (木) crowns the top ridge above two companion trees below — a cobalt spruce on the left (木) and an emerald oak on the right (木) — multiplying three trees into a deep forest.", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 森", "output_text": "{\"mnemonic_hook\": \"One grand crimson tree (木) crowns the top ridge above two companion trees below — a cobalt spruce on the left (木) and an emerald oak on the right (木) — multiplying three trees into a deep forest.\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: triangular pyramid of three distinct trees — one crimson tree high on a central ridge, a cobalt spruce lower-left, and an emerald oak lower-right. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"crimson tree crowning top ridge\"}, {\"part_number\": 2, \"scene_cue\": \"cobalt spruce on lower-left\"}, {\"part_number\": 3, \"scene_cue\": \"emerald oak on lower-right\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: triangular pyramid of three distinct trees — one crimson tree high on a central ridge, a cobalt spruce lower-left, and an emerald oak lower-right. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["One grand crimson tree (木) crowns the top ridge above two companion trees below — a cobalt spruce on the left (木) and an emerald oak on the right (木) — multiplying three trees into a deep forest."]'::jsonb,
  '/showcase/ci-sen.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: triangular pyramid of three distinct trees — one crimson tree high on a central ridge, a cobalt spruce lower-left, and an emerald oak lower-right. STRICTLY ZERO TEXT.',
  '{"input": "森", "pinyin": "sēn", "english_meaning": "forest", "chain_mode": "compound_idea", "method_badge": "COMPOUND IDEA · IDEOGRAPHIC PARTS", "mnemonic_hook": "One grand crimson tree (木) crowns the top ridge above two companion trees below — a cobalt spruce on the left (木) and an emerald oak on the right (木) — multiplying three trees into a deep forest.", "legend_items": [{"part_number": 1, "glyph": "木", "pinyin": "mù", "gloss": "tree (top)", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "crimson tree crowning top ridge"}, {"part_number": 2, "glyph": "木", "pinyin": "mù", "gloss": "tree (bottom-left)", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "cobalt spruce on lower-left"}, {"part_number": 3, "glyph": "木", "pinyin": "mù", "gloss": "tree (bottom-right)", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "emerald oak on lower-right"}], "scene_checklist": "① top tree + ② left tree + ③ right tree (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: triangular pyramid of three distinct trees — one crimson tree high on a central ridge, a cobalt spruce lower-left, and an emerald oak lower-right. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:32:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000010',
  (select id from public.prompt_chains where slug = 'compound-idea'),
  'compound-idea',
  'Compound Idea · Radical + Radical',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '囚',
  '["compound_idea", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 囚 (qiú — prisoner)", "output_text": "Part 1 囗 (wéi, four-sided enclosure) [MEANING]: crimson four-walled square stone frame; Part 2 人 (rén, person) [MEANING]: cobalt-clothed person trapped inside", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 囚 (prisoner)", "output_text": "A thick four-walled square crimson stone enclosure (囗) boxes in a lone person (人) in cobalt clothes pressing their palms against the walls: a person inside a box means ''prisoner.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 囚", "output_text": "{\"mnemonic_hook\": \"A thick four-walled square crimson stone enclosure (囗) boxes in a lone person (人) in cobalt clothes pressing their palms against the walls: a person inside a box means ''prisoner.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: top-down cutaway of a four-walled crimson stone square box completely surrounding a single person in cobalt clothes trapped in the center. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"crimson four-walled square stone frame\"}, {\"part_number\": 2, \"scene_cue\": \"cobalt-clothed person trapped inside\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: top-down cutaway of a four-walled crimson stone square box completely surrounding a single person in cobalt clothes trapped in the center. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["A thick four-walled square crimson stone enclosure (囗) boxes in a lone person (人) in cobalt clothes pressing their palms against the walls: a person inside a box means ''prisoner.''"]'::jsonb,
  '/showcase/ci-qiu.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: top-down cutaway of a four-walled crimson stone square box completely surrounding a single person in cobalt clothes trapped in the center. STRICTLY ZERO TEXT.',
  '{"input": "囚", "pinyin": "qiú", "english_meaning": "prisoner", "chain_mode": "compound_idea", "method_badge": "COMPOUND IDEA · IDEOGRAPHIC PARTS", "mnemonic_hook": "A thick four-walled square crimson stone enclosure (囗) boxes in a lone person (人) in cobalt clothes pressing their palms against the walls: a person inside a box means ''prisoner.''", "legend_items": [{"part_number": 1, "glyph": "囗", "pinyin": "wéi", "gloss": "four-sided enclosure", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "crimson four-walled square stone frame"}, {"part_number": 2, "glyph": "人", "pinyin": "rén", "gloss": "person", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "cobalt-clothed person trapped inside"}], "scene_checklist": "① square enclosure + ② person inside (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: top-down cutaway of a four-walled crimson stone square box completely surrounding a single person in cobalt clothes trapped in the center. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:31:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000011',
  (select id from public.prompt_chains where slug = 'compound-idea'),
  'compound-idea',
  'Compound Idea · Radical + Radical',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '尖',
  '["compound_idea", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 尖 (jiān — sharp / pointed)", "output_text": "Part 1 小 (xiǎo, small) [MEANING]: tiny crimson pebble balanced at apex; Part 2 大 (dà, big) [MEANING]: massive wide cobalt boulder base", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 尖 (sharp / pointed)", "output_text": "Stack something tiny (小, crimson pebble on top) right on the tip of something huge (大, wide cobalt boulder below): small on top of big forms a ''pointed'' tip.", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 尖", "output_text": "{\"mnemonic_hook\": \"Stack something tiny (小, crimson pebble on top) right on the tip of something huge (大, wide cobalt boulder below): small on top of big forms a ''pointed'' tip.\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a tiny crimson pebble balanced delicately at the sharp peak of a massive wide cobalt-blue boulder below. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"tiny crimson pebble balanced at apex\"}, {\"part_number\": 2, \"scene_cue\": \"massive wide cobalt boulder base\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a tiny crimson pebble balanced delicately at the sharp peak of a massive wide cobalt-blue boulder below. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Stack something tiny (小, crimson pebble on top) right on the tip of something huge (大, wide cobalt boulder below): small on top of big forms a ''pointed'' tip."]'::jsonb,
  '/showcase/ci-jian.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a tiny crimson pebble balanced delicately at the sharp peak of a massive wide cobalt-blue boulder below. STRICTLY ZERO TEXT.',
  '{"input": "尖", "pinyin": "jiān", "english_meaning": "sharp / pointed", "chain_mode": "compound_idea", "method_badge": "COMPOUND IDEA · IDEOGRAPHIC PARTS", "mnemonic_hook": "Stack something tiny (小, crimson pebble on top) right on the tip of something huge (大, wide cobalt boulder below): small on top of big forms a ''pointed'' tip.", "legend_items": [{"part_number": 1, "glyph": "小", "pinyin": "xiǎo", "gloss": "small", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "tiny crimson pebble balanced at apex"}, {"part_number": 2, "glyph": "大", "pinyin": "dà", "gloss": "big", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "massive wide cobalt boulder base"}], "scene_checklist": "① small top + ② big base (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: a tiny crimson pebble balanced delicately at the sharp peak of a massive wide cobalt-blue boulder below. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:30:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000012',
  (select id from public.prompt_chains where slug = 'compound-idea'),
  'compound-idea',
  'Compound Idea · Radical + Radical',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '明',
  '["compound_idea", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 明 (míng — bright)", "output_text": "Part 1 日 (rì, sun) [MEANING]: beaming crimson-gold sun on left; Part 2 月 (yuè, moon) [MEANING]: luminous cobalt crescent moon on right", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 明 (bright)", "output_text": "Place the beaming golden-crimson sun (日) on the left alongside the glowing silver-cobalt crescent moon (月) on the right: sun + moon shining together mean ''bright.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 明", "output_text": "{\"mnemonic_hook\": \"Place the beaming golden-crimson sun (日) on the left alongside the glowing silver-cobalt crescent moon (月) on the right: sun + moon shining together mean ''bright.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: radiant crimson-gold sun beaming on the left beside a luminous silver-cobalt crescent moon on the right over a sunlit valley. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"beaming crimson-gold sun on left\"}, {\"part_number\": 2, \"scene_cue\": \"luminous cobalt crescent moon on right\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: radiant crimson-gold sun beaming on the left beside a luminous silver-cobalt crescent moon on the right over a sunlit valley. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Place the beaming golden-crimson sun (日) on the left alongside the glowing silver-cobalt crescent moon (月) on the right: sun + moon shining together mean ''bright.''"]'::jsonb,
  '/showcase/ci-ming.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: radiant crimson-gold sun beaming on the left beside a luminous silver-cobalt crescent moon on the right over a sunlit valley. STRICTLY ZERO TEXT.',
  '{"input": "明", "pinyin": "míng", "english_meaning": "bright", "chain_mode": "compound_idea", "method_badge": "COMPOUND IDEA · IDEOGRAPHIC PARTS", "mnemonic_hook": "Place the beaming golden-crimson sun (日) on the left alongside the glowing silver-cobalt crescent moon (月) on the right: sun + moon shining together mean ''bright.''", "legend_items": [{"part_number": 1, "glyph": "日", "pinyin": "rì", "gloss": "sun", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "beaming crimson-gold sun on left"}, {"part_number": 2, "glyph": "月", "pinyin": "yuè", "gloss": "moon", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "luminous cobalt crescent moon on right"}], "scene_checklist": "① sun + ② moon (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: radiant crimson-gold sun beaming on the left beside a luminous silver-cobalt crescent moon on the right over a sunlit valley. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:29:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000013',
  (select id from public.prompt_chains where slug = 'sound-meaning'),
  'sound-meaning',
  'Sound + Meaning · Meaning + Phonetic',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '妈',
  '["sound_meaning", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 妈 (mā — mother)", "output_text": "Part 1 女 (nǚ, woman) [MEANING]: mother in crimson cardigan holding baby; Part 2 马 (mǎ, horse) [SOUND_ONLY]: horse in cobalt blanket ringing brass horn/bell", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 妈 (mother)", "output_text": "A loving mother/woman (女, meaning) in a crimson cardigan cradles her baby while a pony horse (马, mǎ) in a cobalt blanket blows a brass horn and rings a bell: 马 is here strictly because it sounds like ''mā'', not because a mother is a horse.", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 妈", "output_text": "{\"mnemonic_hook\": \"A loving mother/woman (女, meaning) in a crimson cardigan cradles her baby while a pony horse (马, mǎ) in a cobalt blanket blows a brass horn and rings a bell: 马 is here strictly because it sounds like ''mā'', not because a mother is a horse.\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: smiling mother in crimson cardigan holding a baby on the left beside a pony horse in a cobalt blanket ringing a brass bell and horn with concentric sound ripples on the right. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"mother in crimson cardigan holding baby\"}, {\"part_number\": 2, \"scene_cue\": \"horse in cobalt blanket ringing brass horn/bell\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: smiling mother in crimson cardigan holding a baby on the left beside a pony horse in a cobalt blanket ringing a brass bell and horn with concentric sound ripples on the right. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["A loving mother/woman (女, meaning) in a crimson cardigan cradles her baby while a pony horse (马, mǎ) in a cobalt blanket blows a brass horn and rings a bell: 马 is here strictly because it sounds like ''mā'', not because a mother is a horse."]'::jsonb,
  '/showcase/sm-ma.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: smiling mother in crimson cardigan holding a baby on the left beside a pony horse in a cobalt blanket ringing a brass bell and horn with concentric sound ripples on the right. STRICTLY ZERO TEXT.',
  '{"input": "妈", "pinyin": "mā", "english_meaning": "mother", "chain_mode": "sound_meaning", "method_badge": "SOUND + MEANING · PICTOPHONETIC", "mnemonic_hook": "A loving mother/woman (女, meaning) in a crimson cardigan cradles her baby while a pony horse (马, mǎ) in a cobalt blanket blows a brass horn and rings a bell: 马 is here strictly because it sounds like ''mā'', not because a mother is a horse.", "legend_items": [{"part_number": 1, "glyph": "女", "pinyin": "nǚ", "gloss": "woman", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "mother in crimson cardigan holding baby"}, {"part_number": 2, "glyph": "马", "pinyin": "mǎ", "gloss": "horse", "role": "SOUND_ONLY", "role_badge": "♪ SOUND PART · FOR PRONUNCIATION ONLY", "sound_note": "cues sound mā, not meaning", "scene_cue": "horse in cobalt blanket ringing brass horn/bell"}], "scene_checklist": "① woman (meaning) + ② horse bell (sound mā) (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: smiling mother in crimson cardigan holding a baby on the left beside a pony horse in a cobalt blanket ringing a brass bell and horn with concentric sound ripples on the right. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:28:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000014',
  (select id from public.prompt_chains where slug = 'sound-meaning'),
  'sound-meaning',
  'Sound + Meaning · Meaning + Phonetic',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '洋',
  '["sound_meaning", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 洋 (yáng — ocean)", "output_text": "Part 1 氵 (shuǐ, water) [MEANING]: rolling ocean wave & crimson surfboard; Part 2 羊 (yáng, sheep) [SOUND_ONLY]: sheep in cobalt scarf with brass megaphone", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 洋 (ocean)", "output_text": "Towering ocean water waves (氵, meaning) roll beneath a crimson surfboard while a horned sheep (羊, yáng) in a cobalt scarf bleats into a brass megaphone strictly to cue the sound ''yáng.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 洋", "output_text": "{\"mnemonic_hook\": \"Towering ocean water waves (氵, meaning) roll beneath a crimson surfboard while a horned sheep (羊, yáng) in a cobalt scarf bleats into a brass megaphone strictly to cue the sound ''yáng.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: giant rolling ocean wave with crimson surfboard while a horned white sheep in a cobalt scarf holds a brass megaphone emitting concentric circular sound ripples. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"rolling ocean wave & crimson surfboard\"}, {\"part_number\": 2, \"scene_cue\": \"sheep in cobalt scarf with brass megaphone\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: giant rolling ocean wave with crimson surfboard while a horned white sheep in a cobalt scarf holds a brass megaphone emitting concentric circular sound ripples. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Towering ocean water waves (氵, meaning) roll beneath a crimson surfboard while a horned sheep (羊, yáng) in a cobalt scarf bleats into a brass megaphone strictly to cue the sound ''yáng.''"]'::jsonb,
  '/showcase/sm-yang.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: giant rolling ocean wave with crimson surfboard while a horned white sheep in a cobalt scarf holds a brass megaphone emitting concentric circular sound ripples. STRICTLY ZERO TEXT.',
  '{"input": "洋", "pinyin": "yáng", "english_meaning": "ocean", "chain_mode": "sound_meaning", "method_badge": "SOUND + MEANING · PICTOPHONETIC", "mnemonic_hook": "Towering ocean water waves (氵, meaning) roll beneath a crimson surfboard while a horned sheep (羊, yáng) in a cobalt scarf bleats into a brass megaphone strictly to cue the sound ''yáng.''", "legend_items": [{"part_number": 1, "glyph": "氵", "pinyin": "shuǐ", "gloss": "water", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "rolling ocean wave & crimson surfboard"}, {"part_number": 2, "glyph": "羊", "pinyin": "yáng", "gloss": "sheep", "role": "SOUND_ONLY", "role_badge": "♪ SOUND PART · FOR PRONUNCIATION ONLY", "sound_note": "cues sound yáng, not meaning", "scene_cue": "sheep in cobalt scarf with brass megaphone"}], "scene_checklist": "① water waves (meaning) + ② sheep horn (sound yáng) (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: giant rolling ocean wave with crimson surfboard while a horned white sheep in a cobalt scarf holds a brass megaphone emitting concentric circular sound ripples. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:27:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000015',
  (select id from public.prompt_chains where slug = 'sound-meaning'),
  'sound-meaning',
  'Sound + Meaning · Meaning + Phonetic',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '沐',
  '["sound_meaning", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 沐 (mù — to bathe)", "output_text": "Part 1 氵 (shuǐ, water) [MEANING]: steaming bathwater tub & crimson towel; Part 2 木 (mù, tree) [SOUND_ONLY]: tree in cobalt sash chiming brass bells", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 沐 (to bathe)", "output_text": "Warm splashing bathwater (氵, meaning) overflows a wooden tub draped with a crimson towel, while a leafy tree (木, mù) wrapped in a cobalt sash chimes brass bells strictly to cue the sound ''mù.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 沐", "output_text": "{\"mnemonic_hook\": \"Warm splashing bathwater (氵, meaning) overflows a wooden tub draped with a crimson towel, while a leafy tree (木, mù) wrapped in a cobalt sash chimes brass bells strictly to cue the sound ''mù.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: steaming wooden tub splashing soapy water with crimson towel on left beside a leafy tree in a cobalt sash ringing golden brass bells with sound ripples on right. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"steaming bathwater tub & crimson towel\"}, {\"part_number\": 2, \"scene_cue\": \"tree in cobalt sash chiming brass bells\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: steaming wooden tub splashing soapy water with crimson towel on left beside a leafy tree in a cobalt sash ringing golden brass bells with sound ripples on right. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Warm splashing bathwater (氵, meaning) overflows a wooden tub draped with a crimson towel, while a leafy tree (木, mù) wrapped in a cobalt sash chimes brass bells strictly to cue the sound ''mù.''"]'::jsonb,
  '/showcase/sm-mu.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: steaming wooden tub splashing soapy water with crimson towel on left beside a leafy tree in a cobalt sash ringing golden brass bells with sound ripples on right. STRICTLY ZERO TEXT.',
  '{"input": "沐", "pinyin": "mù", "english_meaning": "to bathe", "chain_mode": "sound_meaning", "method_badge": "SOUND + MEANING · PICTOPHONETIC", "mnemonic_hook": "Warm splashing bathwater (氵, meaning) overflows a wooden tub draped with a crimson towel, while a leafy tree (木, mù) wrapped in a cobalt sash chimes brass bells strictly to cue the sound ''mù.''", "legend_items": [{"part_number": 1, "glyph": "氵", "pinyin": "shuǐ", "gloss": "water", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "steaming bathwater tub & crimson towel"}, {"part_number": 2, "glyph": "木", "pinyin": "mù", "gloss": "tree", "role": "SOUND_ONLY", "role_badge": "♪ SOUND PART · FOR PRONUNCIATION ONLY", "sound_note": "cues sound mù, not meaning", "scene_cue": "tree in cobalt sash chiming brass bells"}], "scene_checklist": "① bathwater (meaning) + ② tree bells (sound mù) (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: steaming wooden tub splashing soapy water with crimson towel on left beside a leafy tree in a cobalt sash ringing golden brass bells with sound ripples on right. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:26:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000016',
  (select id from public.prompt_chains where slug = 'sound-meaning'),
  'sound-meaning',
  'Sound + Meaning · Meaning + Phonetic',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '清',
  '["sound_meaning", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 清 (qīng — clear / pure)", "output_text": "Part 1 氵 (shuǐ, water) [MEANING]: transparent spring stream & crimson pebble; Part 2 青 (qīng, blue-green sprout) [SOUND_ONLY]: bamboo shoot & ringing cobalt-brass bell", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 清 (clear / pure)", "output_text": "Crystal-clear spring water (氵, meaning) flows over visible pebbles on the left, while a green-blue bamboo sprout (青, qīng) rings a cobalt-and-brass bell on the right bank strictly to cue the sound ''qīng.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 清", "output_text": "{\"mnemonic_hook\": \"Crystal-clear spring water (氵, meaning) flows over visible pebbles on the left, while a green-blue bamboo sprout (青, qīng) rings a cobalt-and-brass bell on the right bank strictly to cue the sound ''qīng.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: transparent mountain spring stream over pebbles with a crimson stone on left, and a green bamboo shoot with ringing cobalt-brass bell on right bank. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"transparent spring stream & crimson pebble\"}, {\"part_number\": 2, \"scene_cue\": \"bamboo shoot & ringing cobalt-brass bell\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: transparent mountain spring stream over pebbles with a crimson stone on left, and a green bamboo shoot with ringing cobalt-brass bell on right bank. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Crystal-clear spring water (氵, meaning) flows over visible pebbles on the left, while a green-blue bamboo sprout (青, qīng) rings a cobalt-and-brass bell on the right bank strictly to cue the sound ''qīng.''"]'::jsonb,
  '/showcase/sm-qing.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: transparent mountain spring stream over pebbles with a crimson stone on left, and a green bamboo shoot with ringing cobalt-brass bell on right bank. STRICTLY ZERO TEXT.',
  '{"input": "清", "pinyin": "qīng", "english_meaning": "clear / pure", "chain_mode": "sound_meaning", "method_badge": "SOUND + MEANING · PICTOPHONETIC", "mnemonic_hook": "Crystal-clear spring water (氵, meaning) flows over visible pebbles on the left, while a green-blue bamboo sprout (青, qīng) rings a cobalt-and-brass bell on the right bank strictly to cue the sound ''qīng.''", "legend_items": [{"part_number": 1, "glyph": "氵", "pinyin": "shuǐ", "gloss": "water", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "transparent spring stream & crimson pebble"}, {"part_number": 2, "glyph": "青", "pinyin": "qīng", "gloss": "blue-green sprout", "role": "SOUND_ONLY", "role_badge": "♪ SOUND PART · FOR PRONUNCIATION ONLY", "sound_note": "cues sound qīng, not meaning", "scene_cue": "bamboo shoot & ringing cobalt-brass bell"}], "scene_checklist": "① clear stream (meaning) + ② sprout bell (sound qīng) (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: transparent mountain spring stream over pebbles with a crimson stone on left, and a green bamboo shoot with ringing cobalt-brass bell on right bank. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:25:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000017',
  (select id from public.prompt_chains where slug = 'sound-meaning'),
  'sound-meaning',
  'Sound + Meaning · Meaning + Phonetic',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '晴',
  '["sound_meaning", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 晴 (qíng — sunny / clear sky)", "output_text": "Part 1 日 (rì, sun) [MEANING]: radiant crimson-gold sun in clear sky; Part 2 青 (qīng, blue-green sprout) [SOUND_ONLY]: bamboo shoot in cobalt ribbon ringing bell", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 晴 (sunny / clear sky)", "output_text": "A beaming crimson-gold sun (日, meaning) lights up a cloudless sky on the left, while a blue-green bamboo shoot (青, qīng) tied with a cobalt ribbon rings a brass bell strictly to cue the sound ''qíng.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 晴", "output_text": "{\"mnemonic_hook\": \"A beaming crimson-gold sun (日, meaning) lights up a cloudless sky on the left, while a blue-green bamboo shoot (青, qīng) tied with a cobalt ribbon rings a brass bell strictly to cue the sound ''qíng.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: radiant crimson-gold sun in clear sky on left above a meadow where a green bamboo shoot in a cobalt ribbon rings a golden brass bell with sound ripples on right. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"radiant crimson-gold sun in clear sky\"}, {\"part_number\": 2, \"scene_cue\": \"bamboo shoot in cobalt ribbon ringing bell\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: radiant crimson-gold sun in clear sky on left above a meadow where a green bamboo shoot in a cobalt ribbon rings a golden brass bell with sound ripples on right. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["A beaming crimson-gold sun (日, meaning) lights up a cloudless sky on the left, while a blue-green bamboo shoot (青, qīng) tied with a cobalt ribbon rings a brass bell strictly to cue the sound ''qíng.''"]'::jsonb,
  '/showcase/sm-qing-sunny.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: radiant crimson-gold sun in clear sky on left above a meadow where a green bamboo shoot in a cobalt ribbon rings a golden brass bell with sound ripples on right. STRICTLY ZERO TEXT.',
  '{"input": "晴", "pinyin": "qíng", "english_meaning": "sunny / clear sky", "chain_mode": "sound_meaning", "method_badge": "SOUND + MEANING · PICTOPHONETIC", "mnemonic_hook": "A beaming crimson-gold sun (日, meaning) lights up a cloudless sky on the left, while a blue-green bamboo shoot (青, qīng) tied with a cobalt ribbon rings a brass bell strictly to cue the sound ''qíng.''", "legend_items": [{"part_number": 1, "glyph": "日", "pinyin": "rì", "gloss": "sun", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "radiant crimson-gold sun in clear sky"}, {"part_number": 2, "glyph": "青", "pinyin": "qīng", "gloss": "blue-green sprout", "role": "SOUND_ONLY", "role_badge": "♪ SOUND PART · FOR PRONUNCIATION ONLY", "sound_note": "cues sound qíng, not meaning", "scene_cue": "bamboo shoot in cobalt ribbon ringing bell"}], "scene_checklist": "① sun (meaning) + ② sprout bell (sound qíng) (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: radiant crimson-gold sun in clear sky on left above a meadow where a green bamboo shoot in a cobalt ribbon rings a golden brass bell with sound ripples on right. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:24:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

insert into public.prompt_chain_runs (
  id, chain_id, chain_slug, chain_name, provider, model, input_source_type, input_premise, input_tags,
  step_outputs, final_captions, generated_media_url, generated_media_mime, generated_media_prompt,
  structured_card, status, total_latency_ms, total_tokens, app_scope, created_at
) values (
  'd9100000-0000-4000-8000-000000000018',
  (select id from public.prompt_chains where slug = 'sound-meaning'),
  'sound-meaning',
  'Sound + Meaning · Meaning + Phonetic',
  'gemini',
  'gemini-3.1-flash-lite-image',
  'text_only',
  '抱',
  '["sound_meaning", "showcase"]'::jsonb,
  '[{"step_order": 1, "step_name": "Part Roles & Concrete Nouns", "step_role": "roles", "output_field": "part_roles_brief", "provider": "gemini", "model_id": "gemini-3.5-flash-lite", "temperature": 0.1, "step_modality": "text", "compiled_prompt": "Dataset lookup for 抱 (bào — to hug / embrace)", "output_text": "Part 1 扌 (shǒu, hand) [MEANING]: warm arms & hands in crimson sleeves hugging; Part 2 包 (bāo, wrapped bundle) [SOUND_ONLY]: cobalt cloth bundle with ringing brass bell", "latency_ms": 1820, "tokens": 210}, {"step_order": 2, "step_name": "Absurd Component Scene", "step_role": "scene", "output_field": "scene_invention", "provider": "gemini", "model_id": "gemini-3-flash-preview", "temperature": 0.85, "step_modality": "text", "compiled_prompt": "Invent concrete component scene for 抱 (to hug / embrace)", "output_text": "Warm embracing arms/hands (扌, meaning) in crimson sleeves wrap around a tied cobalt cloth bundle (包, bāo) topped with a ringing brass bell strictly to cue the sound ''bào.''", "latency_ms": 4120, "tokens": 290}, {"step_order": 3, "step_name": "Zero-Text 1:1 Prompt & Legend JSON", "step_role": "prompt_json", "output_field": "mnemonic_card_json", "provider": "gemini", "model_id": "gemini-3.1-flash-lite", "temperature": 0.15, "step_modality": "text", "compiled_prompt": "Compile strict JSON spec for 抱", "output_text": "{\"mnemonic_hook\": \"Warm embracing arms/hands (扌, meaning) in crimson sleeves wrap around a tied cobalt cloth bundle (包, bāo) topped with a ringing brass bell strictly to cue the sound ''bào.''\", \"image_prompt\": \"Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: warm arms in crimson sleeves hugging a tied cobalt-blue cloth bundle topped with a ringing golden brass bell emitting concentric sound ripples. STRICTLY ZERO TEXT.\", \"legend_items\": [{\"part_number\": 1, \"scene_cue\": \"warm arms & hands in crimson sleeves hugging\"}, {\"part_number\": 2, \"scene_cue\": \"cobalt cloth bundle with ringing brass bell\"}]}", "latency_ms": 2150, "tokens": 245}, {"step_order": 4, "step_name": "1:1 Mnemonic Scene Picture", "step_role": "picture", "output_field": "generated_scene_media", "provider": "gemini", "model_id": "gemini-3.1-flash-lite-image", "temperature": 0.6, "step_modality": "image_generation", "compiled_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: warm arms in crimson sleeves hugging a tied cobalt-blue cloth bundle topped with a ringing golden brass bell emitting concentric sound ripples. STRICTLY ZERO TEXT.", "output_text": "Rendered 1:1 zero-text mnemonic scene via gemini-3.1-flash-lite-image (image/jpeg).", "latency_ms": 7850, "tokens": 1120}]'::jsonb,
  '["Warm embracing arms/hands (扌, meaning) in crimson sleeves wrap around a tied cobalt cloth bundle (包, bāo) topped with a ringing brass bell strictly to cue the sound ''bào.''"]'::jsonb,
  '/showcase/sm-bao.jpg',
  'image/jpeg',
  'Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: warm arms in crimson sleeves hugging a tied cobalt-blue cloth bundle topped with a ringing golden brass bell emitting concentric sound ripples. STRICTLY ZERO TEXT.',
  '{"input": "抱", "pinyin": "bào", "english_meaning": "to hug / embrace", "chain_mode": "sound_meaning", "method_badge": "SOUND + MEANING · PICTOPHONETIC", "mnemonic_hook": "Warm embracing arms/hands (扌, meaning) in crimson sleeves wrap around a tied cobalt cloth bundle (包, bāo) topped with a ringing brass bell strictly to cue the sound ''bào.''", "legend_items": [{"part_number": 1, "glyph": "扌", "pinyin": "shǒu", "gloss": "hand", "role": "MEANING", "role_badge": "MEANING PART", "scene_cue": "warm arms & hands in crimson sleeves hugging"}, {"part_number": 2, "glyph": "包", "pinyin": "bāo", "gloss": "wrapped bundle", "role": "SOUND_ONLY", "role_badge": "♪ SOUND PART · FOR PRONUNCIATION ONLY", "sound_note": "cues sound bào, not meaning", "scene_cue": "cobalt cloth bundle with ringing brass bell"}], "scene_checklist": "① embracing hands (meaning) + ② bundle bell (sound bào) (0 text in image)", "image_prompt": "Full-shot centered 1:1 storybook gouache-and-ink illustration with generous 15% empty neutral cream margin: warm arms in crimson sleeves hugging a tied cobalt-blue cloth bundle topped with a ringing golden brass bell emitting concentric sound ripples. STRICTLY ZERO TEXT.", "text_only_preview": false}'::jsonb,
  'completed',
  15940,
  1865,
  'hanzi_mnemonic',
  timestamptz '2026-11-10T06:23:00Z'
)
on conflict (id) do update set
  chain_id = excluded.chain_id,
  chain_slug = excluded.chain_slug,
  chain_name = excluded.chain_name,
  model = excluded.model,
  input_premise = excluded.input_premise,
  step_outputs = excluded.step_outputs,
  final_captions = excluded.final_captions,
  generated_media_url = excluded.generated_media_url,
  generated_media_mime = excluded.generated_media_mime,
  generated_media_prompt = excluded.generated_media_prompt,
  structured_card = excluded.structured_card,
  app_scope = 'hanzi_mnemonic';

commit;
