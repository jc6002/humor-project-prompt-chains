import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runPromptChainsDbSuite() {
  const db = new PGlite();

  // Self-contained prerequisite AI Joke Lab Week 5-7 baseline schema so standalone repo tests work anywhere
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid(), auth.role() to public;

    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      email text,
      first_name text,
      last_name text,
      avatar_url text,
      is_superadmin boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table public.profiles enable row level security;
    create policy "profiles_select_all" on public.profiles for select to authenticated using (true);

    create table public.llm_providers (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      name text not null,
      api_base_url text not null,
      protocol text not null default 'openai_responses',
      api_key_env text not null default 'OPENAI_API_KEY',
      is_enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    insert into public.llm_providers (slug, name, api_base_url, protocol, api_key_env, is_enabled)
    values
      ('openai', 'OpenAI', 'https://api.openai.com/v1/responses', 'openai_responses', 'OPENAI_API_KEY', true),
      ('gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/models', 'gemini_generate_content', 'GEMINI_API_KEY', true);

    create table public.arena_models (
      id uuid primary key default gen_random_uuid(),
      provider text not null,
      provider_id uuid references public.llm_providers(id) on delete set null,
      api_model text not null,
      name text not null,
      config_version text not null default 'ai-roast-v3',
      canonical_id uuid references public.arena_models(id) on delete set null,
      rating double precision not null default 1000,
      wins integer not null default 0,
      losses integer not null default 0,
      ties integer not null default 0,
      bad integer not null default 0,
      is_enabled boolean not null default true,
      max_output_tokens integer not null default 600,
      created_at timestamptz not null default now()
    );
    create unique index arena_models_identity on public.arena_models(provider, api_model) where canonical_id is null;

    create table public.prompt_chains (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      name text not null,
      description text not null default '',
      persona_style text not null,
      mix_weight integer not null default 0 check (mix_weight >= 0 and mix_weight <= 1000),
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.prompt_chain_steps (
      id uuid primary key default gen_random_uuid(),
      chain_id uuid not null references public.prompt_chains(id) on delete cascade,
      step_order integer not null,
      step_name text not null,
      step_role text not null default 'instruction',
      instruction_template text not null,
      output_field text,
      created_at timestamptz not null default now(),
      unique (chain_id, step_order)
    );

    insert into public.prompt_chains (slug, name, description, persona_style, mix_weight, is_active)
    values
      ('standup-roast-v2', 'Late-Night Stand-Up Roast', 'Club comic two-liner', 'Sharp stand-up writer.', 50, true),
      ('deadpan-oneliner', 'Deadpan Engineering Post-Mortem', 'Bone-dry incident post-mortem', 'Deadpan systems engineer.', 30, true);

    create table public.arena_battles (
      id uuid primary key default gen_random_uuid(),
      user_id uuid references auth.users(id) on delete cascade,
      request_id uuid,
      target text not null,
      angle text not null,
      context text not null default '',
      prompt text not null default '',
      prompt_chain_id uuid references public.prompt_chains(id) on delete set null,
      prompt_chain_name text,
      status text not null default 'generating',
      error_code text,
      votes integer not null default 0,
      created_at timestamptz not null default now(),
      completed_at timestamptz,
      closes_at timestamptz not null default (now() + interval '24 hours')
    );

    create table public.arena_generations (
      id uuid primary key default gen_random_uuid(),
      battle_id uuid not null references public.arena_battles(id) on delete cascade,
      model_id uuid not null references public.arena_models(id),
      config_version text not null default 'ai-roast-v3',
      setup text not null,
      punchline text not null,
      cliche_to_avoid text,
      comic_twist text,
      prompt_chain_name text,
      usage jsonb not null default '{}'::jsonb,
      latency_ms integer,
      request_id text,
      created_at timestamptz not null default now()
    );

    create table public.arena_presentations (
      user_id uuid not null references auth.users(id) on delete cascade,
      battle_id uuid not null references public.arena_battles(id) on delete cascade,
      left_id uuid not null references public.arena_generations(id) on delete cascade,
      right_id uuid not null references public.arena_generations(id) on delete cascade,
      primary key (user_id, battle_id)
    );

    create table public.arena_votes (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      battle_id uuid not null references public.arena_battles(id) on delete cascade,
      choice text not null,
      left_id uuid not null references public.arena_generations(id) on delete cascade,
      right_id uuid not null references public.arena_generations(id) on delete cascade,
      created_at timestamptz not null default now(),
      unique (battle_id, user_id)
    );

    create table public.arena_rating_events (
      id uuid primary key default gen_random_uuid(),
      vote_id uuid not null references public.arena_votes(id) on delete cascade,
      left_model uuid not null references public.arena_models(id),
      right_model uuid not null references public.arena_models(id),
      left_before double precision not null,
      right_before double precision not null,
      left_after double precision not null,
      right_after double precision not null,
      created_at timestamptz not null default now()
    );

    create table public.comedy_terms (
      id uuid primary key default gen_random_uuid(),
      term text not null unique,
      term_type text not null default 'banned_cliche',
      definition_or_rule text not null default '',
      is_active boolean not null default true,
      created_at timestamptz not null default now()
    );

    create table public.ai_generation_examples (
      id uuid primary key default gen_random_uuid(),
      chain_id uuid references public.prompt_chains(id) on delete set null,
      topic text not null,
      angle text not null default '',
      premise text not null default '',
      setup text not null,
      punchline text not null,
      why_it_works text not null default '',
      is_active boolean not null default true,
      created_at timestamptz not null default now()
    );

    create table public.llm_responses (
      id uuid primary key default gen_random_uuid(),
      battle_id uuid references public.arena_battles(id) on delete cascade,
      generation_id uuid references public.arena_generations(id) on delete set null,
      request_id uuid,
      provider text not null,
      model text not null,
      prompt_chain_name text,
      prompt_text text not null default '',
      raw_response_text text,
      parsed_cliche_to_avoid text,
      parsed_comic_twist text,
      parsed_setup text,
      parsed_punchline text,
      status text not null default 'success',
      http_status integer,
      error_message text,
      latency_ms integer,
      input_tokens integer,
      output_tokens integer,
      reasoning_tokens integer,
      provider_request_id text,
      usage jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    alter table public.prompt_chains enable row level security;
    alter table public.prompt_chain_steps enable row level security;
    revoke all on public.prompt_chains, public.prompt_chain_steps from anon, authenticated;
    grant all on public.prompt_chains, public.prompt_chain_steps to service_role;
  `);

  const adminId = randomUUID();
  const regularId = randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
    adminId,
    'admin@columbia.edu',
    regularId,
    'student@columbia.edu',
  ]);
  await db.query(
    'insert into public.profiles (id, email, is_superadmin) values ($1, $2, true), ($3, $4, false)',
    [adminId, 'admin@columbia.edu', regularId, 'student@columbia.edu']
  );

  const week8Sql = await readFile(new URL('../supabase/week8_migration.sql', import.meta.url), 'utf8');
  await db.exec(week8Sql);
  await db.exec(week8Sql);

  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const login = async (uid, role) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await db.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
  };

  // 1. Verify seeded 3-step visual chain and 3 pre-computed multimodal runs
  const visualChain = (
    await db.query("select id, slug, mix_weight, is_active from public.prompt_chains where slug = 'visual-image-to-5-captions'")
  ).rows[0];
  assert.ok(visualChain);
  assert.equal(visualChain.mix_weight, 0);
  assert.equal(visualChain.is_active, true);

  const steps = (
    await db.query(
      'select id, step_order, step_name, step_role, output_field from public.prompt_chain_steps where chain_id = $1 order by step_order asc',
      [visualChain.id]
    )
  ).rows;
  assert.equal(steps.length, 3);
  assert.deepEqual(
    steps.map((s) => s.step_role),
    ['vision_analysis', 'twist_planner', 'caption_synthesis']
  );

  const runs = (
    await db.query(
      'select id, input_scene_id, step_outputs, final_captions from public.prompt_chain_runs where chain_id = $1 order by created_at desc',
      [visualChain.id]
    )
  ).rows;
  assert.equal(runs.length, 3);
  for (const r of runs) {
    assert.equal(r.step_outputs.length, 3);
    assert.equal(r.final_captions.length, 5);
    assert.deepEqual(
      Object.keys(r.step_outputs[0]).sort(),
      [
        'compiled_prompt',
        'input_tokens',
        'latency_ms',
        'output_field',
        'output_text',
        'output_tokens',
        'step_id',
        'step_name',
        'step_order',
        'step_role',
      ]
    );
  }

  // 2. Verify anon and non-superadmin RLS + RPC denial
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.prompt_chain_runs'), /permission denied/);
  await assert.rejects(
    db.query('select * from public.reorder_prompt_chain_steps($1, $2::uuid[])', [
      visualChain.id,
      steps.map((s) => s.id),
    ]),
    /permission denied/
  );
  await db.exec('reset role');

  await login(regularId, 'authenticated');
  await db.exec('set role authenticated');
  assert.equal(await scalar('select count(*)::int from public.prompt_chain_runs'), 0);
  await assert.rejects(
    db.query('select * from public.reorder_prompt_chain_steps($1, $2::uuid[])', [
      visualChain.id,
      [steps[1].id, steps[0].id, steps[2].id],
    ]),
    /Forbidden/
  );
  await db.exec('reset role');

  // 3. Verify superadmin authenticated CRUD & 23505-free cyclic + swap + reverse step reordering
  await login(adminId, 'authenticated');
  await db.exec('set role authenticated');
  assert.equal(await scalar('select count(*)::int from public.prompt_chain_runs'), 3);

  const swap12 = (
    await db.query('select id, step_order from public.reorder_prompt_chain_steps($1, $2::uuid[])', [
      visualChain.id,
      [steps[1].id, steps[0].id, steps[2].id],
    ])
  ).rows;
  assert.deepEqual(
    swap12.map((r) => r.id),
    [steps[1].id, steps[0].id, steps[2].id]
  );

  const cycle = (
    await db.query('select id, step_order from public.reorder_prompt_chain_steps($1, $2::uuid[])', [
      visualChain.id,
      [steps[2].id, steps[1].id, steps[0].id],
    ])
  ).rows;
  assert.deepEqual(
    cycle.map((r) => r.step_order),
    [1, 2, 3]
  );
  await db.exec('reset role');

  // 4. Verify cascade deletion when deleting a parent prompt_chains row
  await login('', '');
  const tempChainId = await scalar(
    `insert into public.prompt_chains (slug, name, description, persona_style, mix_weight, is_active)
     values ('temp-cascade-chain', 'Temp Chain', 'Test', 'Persona', 0, true)
     returning id`
  );
  await db.query(
    `insert into public.prompt_chain_runs (chain_id, chain_slug, chain_name, provider, model)
     values ($1, 'temp-cascade-chain', 'Temp Chain', 'gemini', 'gemini-3-flash-preview')`,
    [tempChainId]
  );
  assert.equal(
    await scalar('select count(*)::int from public.prompt_chain_runs where chain_id = $1', [tempChainId]),
    1
  );
  await db.query('delete from public.prompt_chains where id = $1', [tempChainId]);
  assert.equal(
    await scalar('select count(*)::int from public.prompt_chain_runs where chain_id = $1', [tempChainId]),
    0
  );

  await db.close();
  return 'PASS: standalone prompt-chains week8_migration.sql x2 idempotency, visual-image-to-5-captions seed, 3 sample runs, superadmin RLS, cascade delete, and 23505-safe reorder_prompt_chain_steps RPC.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const msg = await runPromptChainsDbSuite();
  console.log(msg);
}
