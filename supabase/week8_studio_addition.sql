-- Add only the new standalone studio schema and default chain to an existing Week 8 database.
BEGIN;
create table if not exists public.prompt_chain_runs (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.prompt_chains(id) on delete cascade,
  chain_slug text not null,
  chain_name text not null,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  provider text not null,
  model text not null,
  input_source_type text not null default 'sample_svg'
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

DO $policy$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='prompt_chain_runs' AND policyname='prompt_chain_runs_superadmin_all') THEN
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
END IF;
END $policy$;

revoke all on public.prompt_chain_runs from public, anon;
grant select, insert, update, delete on public.prompt_chain_runs to authenticated, service_role;

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

  -- Phase 1: shift into negative range so UNIQUE (chain_id, step_order) never hits 23505
  update public.prompt_chain_steps
  set step_order = -step_order - 10000
  where chain_id = p_chain_id;

  -- Phase 2: assign contiguous 1..K step_order matching p_step_ids ordinality
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

insert into public.prompt_chains (
  slug, name, description, persona_style, mix_weight, is_active
)
values (
  'visual-image-to-5-captions',
  'Visual Image-to-5-Captions Pipeline',
  'Three-step multimodal vision-to-comedy pipeline: describe image in text -> extract comic angle -> synthesize five short funny captions.',
  'You are a sharp visual comedy writer who observes concrete physical details in an image, finds the understated human or engineering irony, and crafts five tight, punchy captions.',
  0,
  true
)
on conflict (slug) do nothing;

insert into public.prompt_chain_steps (
  chain_id, step_order, step_name, step_role, instruction_template, output_field
)
select
  c.id,
  s.step_order,
  s.step_name,
  s.step_role,
  s.instruction_template,
  s.output_field
from public.prompt_chains c
cross join (
  values
    (
      1,
      'Describe Image in Text',
      'vision_analysis',
      'Take in the provided image (and optional premise {{input}}) and output a clear, concrete 2-3 sentence description of every visual detail, text on screen, expression, and physical contrast.',
      'image_description'
    ),
    (
      2,
      'Find What Is Funny',
      'twist_planner',
      'Take the image description from Step 1 ({{prev_output}}) and output what is genuinely funny, ironic, or painfully relatable about the scene without resorting to clichés.',
      'funny_observation'
    ),
    (
      3,
      'Synthesize 5 Short Funny Captions',
      'caption_synthesis',
      'Take the comic angle from Step 2 ({{prev_output}}) alongside Step 1 ({{step_1_output}}) and output a JSON object {"captions": ["...", "...", "...", "...", "..."]} containing five short, punchy funny captions (6-18 words each).',
      'captions'
    )
) as s(step_order, step_name, step_role, instruction_template, output_field)
where c.slug = 'visual-image-to-5-captions'
on conflict (chain_id, step_order) do nothing;


COMMIT;
