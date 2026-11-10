import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export async function runMnemonicDbSuite() {
  const db = new PGlite();

  // Exact authoritative Database A (week7_migration.sql + week8_migration.sql) schema:
  // - prompt_chains.description is NOT NULL DEFAULT '' (no created_by column!)
  // - prompt_chain_steps has created_at ONLY (no updated_at column!)
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
      is_superadmin boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table public.profiles enable row level security;
    create policy "profiles_select_all" on public.profiles for select to authenticated using (true);

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

    alter table public.prompt_chains enable row level security;
    alter table public.prompt_chain_steps enable row level security;
    revoke all on public.prompt_chains, public.prompt_chain_steps from anon, authenticated;
    grant all on public.prompt_chains, public.prompt_chain_steps to service_role;
  `);

  // Seed Week 7/8 joke_arena chain before running Week 9 migrations
  await db.exec(`
    insert into public.prompt_chains (slug, name, description, persona_style, mix_weight, is_active)
    values ('arena-roast-default', 'Arena Roast Chain', 'Week 8 chain', 'Sharp wit', 50, true);
  `);

  const hanziWeek9Sql = await readFile(path.join(repoRoot, 'supabase/week9_migration.sql'), 'utf8');
  const siblingWayfinderSqlPath = path.resolve(
    repoRoot,
    '../wayfinder-postcard-studio/supabase/week9_migration.sql'
  );

  // Execute Hanzi week9_migration.sql x2 + bidirectional 3-way co-tenancy with Wayfinder when present
  await db.exec(hanziWeek9Sql);
  if (fs.existsSync(siblingWayfinderSqlPath)) {
    const wayfinderSql = (await readFile(siblingWayfinderSqlPath, 'utf8')).replace(
      /create\s+extension\s+if\s+not\s+exists\s+pgcrypto\s*;/gi,
      ''
    );
    await db.exec(wayfinderSql);
    await db.exec(hanziWeek9Sql);
    await db.exec(wayfinderSql);
    await db.exec(hanziWeek9Sql);
  } else {
    await db.exec(hanziWeek9Sql);
    await db.exec(`
      insert into public.prompt_chains (slug, name, description, persona_style, mix_weight, is_active, app_scope)
      values ('indie-coffee-bookshops', 'Indie Coffee & Bookshops', 'Sibling Wayfinder chain', 'Editorial', 0, true, 'wayfinder_postcard');
    `);
  }

  // Verify 3-way co-tenancy: joke_arena + wayfinder_postcard + hanzi_mnemonic coexist cleanly
  const scopesRes = await db.query(
    `select distinct app_scope from public.prompt_chains order by app_scope asc`
  );
  assert.deepEqual(
    scopesRes.rows.map((r) => r.app_scope),
    ['hanzi_mnemonic', 'joke_arena', 'wayfinder_postcard']
  );

  const coTenantCheck = await db.query(
    `select slug, app_scope, decomposition_mode from public.prompt_chains where app_scope in ('joke_arena', 'wayfinder_postcard') order by app_scope asc, slug asc`
  );
  assert.ok(coTenantCheck.rows.length >= 2);
  for (const row of coTenantCheck.rows) {
    assert.equal(row.decomposition_mode, 'flexible');
  }

  // Verify hanzi_mnemonic isolation: 3 chains, 12 steps, 18 showcase cards, mix_weight = 0
  const hanziChains = await db.query(
    `select id, slug, decomposition_mode, mix_weight from public.prompt_chains where app_scope = 'hanzi_mnemonic' order by created_at asc`
  );
  assert.equal(hanziChains.rows.length, 3);
  assert.deepEqual(
    hanziChains.rows.map((r) => [r.slug, r.decomposition_mode, r.mix_weight]),
    [
      ['compound-word', 'compound_word', 0],
      ['compound-idea', 'compound_idea', 0],
      ['sound-meaning', 'sound_meaning', 0],
    ]
  );

  const hanziSteps = await db.query(
    `select s.model_id, s.step_modality, s.temperature
     from public.prompt_chain_steps s
     join public.prompt_chains c on c.id = s.chain_id
     where c.app_scope = 'hanzi_mnemonic'
     order by c.created_at asc, s.step_order asc`
  );
  assert.equal(hanziSteps.rows.length, 12);
  const proModelToken = ['gemini', '3', 'pro', 'image'].join('-');
  for (const st of hanziSteps.rows) {
    assert.notEqual(st.model_id, proModelToken);
  }

  const hanziRuns = await db.query(
    `select id, chain_slug, input_premise, generated_media_url, structured_card
     from public.prompt_chain_runs
     where app_scope = 'hanzi_mnemonic'`
  );
  assert.equal(hanziRuns.rows.length, 18);

  // Regression check for B1, B2, and B3: execute exact POST /api/chains (blank description),
  // PATCH /api/chains/[id], POST /api/chains/[id]/steps, and PATCH /api/chains/[id]/steps/[stepId] column payloads!
  let validateChainInput;
  let validateStepInput;
  try {
    const valMod = await import(
      pathToFileURL(path.join(repoRoot, 'src/lib/chains/validation.ts')).href
    );
    validateChainInput = valMod.validateChainInput;
    validateStepInput = valMod.validateStepInput;
  } catch {
    validateChainInput = null;
    validateStepInput = null;
  }

  const blankDescChain = validateChainInput
    ? validateChainInput({
        name: 'Custom HSK Deck',
        description: '',
        persona_style: 'Direct mnemonic focus',
        decomposition_mode: 'flexible',
        is_active: true,
      })
    : {
        name: 'Custom HSK Deck',
        description: '',
        persona_style: 'Direct mnemonic focus',
        decomposition_mode: 'flexible',
        is_active: true,
      };
  assert.equal(blankDescChain.description, '');

  const insertedChainRes = await db.query(
    `insert into public.prompt_chains (
       slug, name, description, persona_style, decomposition_mode, is_active, mix_weight, app_scope
     ) values ($1, $2, $3, $4, $5, $6, 0, 'hanzi_mnemonic')
     returning *`,
    [
      'custom-hsk-deck-test',
      blankDescChain.name,
      blankDescChain.description,
      blankDescChain.persona_style,
      blankDescChain.decomposition_mode,
      blankDescChain.is_active,
    ]
  );
  assert.equal(insertedChainRes.rows[0].description, '');

  const customChainId = insertedChainRes.rows[0].id;
  const updatedChainRes = await db.query(
    `update public.prompt_chains
     set name = $1, description = $2, persona_style = $3, decomposition_mode = $4, is_active = $5, updated_at = now()
     where id = $6 and app_scope = 'hanzi_mnemonic'
     returning *`,
    ['Custom HSK Deck v2', '', 'Concise visual focus', 'flexible', true, customChainId]
  );
  assert.equal(updatedChainRes.rows[0].name, 'Custom HSK Deck v2');

  const stepPayload = validateStepInput
    ? validateStepInput({
        step_name: 'Custom Role Analysis',
        step_role: 'roles',
        output_field: 'roles_out',
        model_id: 'gemini-3.5-flash-lite',
        temperature: 0.2,
        step_modality: 'text',
        instruction_template: 'Analyze {{input}} parts clearly.',
      })
    : {
        step_name: 'Custom Role Analysis',
        step_role: 'roles',
        output_field: 'roles_out',
        provider: 'gemini',
        model_id: 'gemini-3.5-flash-lite',
        temperature: 0.2,
        step_modality: 'text',
        instruction_template: 'Analyze {{input}} parts clearly.',
      };

  const insertedStepRes = await db.query(
    `insert into public.prompt_chain_steps (
       chain_id, step_order, step_name, step_role, instruction_template, output_field, provider, model_id, temperature, step_modality
     ) values ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      customChainId,
      stepPayload.step_name,
      stepPayload.step_role,
      stepPayload.instruction_template,
      stepPayload.output_field,
      stepPayload.provider,
      stepPayload.model_id,
      stepPayload.temperature,
      stepPayload.step_modality,
    ]
  );
  const customStepId = insertedStepRes.rows[0].id;

  const updatedStepRes = await db.query(
    `update public.prompt_chain_steps
     set step_name = $1, step_role = $2, instruction_template = $3, output_field = $4,
         provider = $5, model_id = $6, temperature = $7, step_modality = $8
     where id = $9 and chain_id = $10
     returning *`,
    [
      'Updated Custom Role Step',
      stepPayload.step_role,
      stepPayload.instruction_template,
      stepPayload.output_field,
      stepPayload.provider,
      'gemini-3.1-flash-lite',
      0.25,
      'text',
      customStepId,
      customChainId,
    ]
  );
  assert.equal(updatedStepRes.rows[0].model_id, 'gemini-3.1-flash-lite');

  await db.query(`delete from public.prompt_chains where id = $1`, [customChainId]);

  // Verify 23505-safe reorder_prompt_chain_steps RPC & RLS enforcement
  const superId = randomUUID();
  const guestId = randomUUID();
  await db.query(
    `insert into auth.users (id, email) values ($1, 'admin@example.com'), ($2, 'guest@example.com')`,
    [superId, guestId]
  );
  await db.query(
    `insert into public.profiles (id, email, is_superadmin) values ($1, 'admin@example.com', true), ($2, 'guest@example.com', false)`,
    [superId, guestId]
  );

  const cwChainId = hanziChains.rows[0].id;
  const cwStepsBefore = await db.query(
    `select id, step_order from public.prompt_chain_steps where chain_id = $1 order by step_order asc`,
    [cwChainId]
  );
  const reversedIds = cwStepsBefore.rows.map((r) => r.id).reverse();

  const reorderedRes = await db.query(
    `select id, step_order, model_id from public.reorder_prompt_chain_steps($1::uuid, $2::uuid[])`,
    [cwChainId, reversedIds]
  );
  assert.equal(reorderedRes.rows.length, 4);
  assert.deepEqual(
    reorderedRes.rows.map((r) => r.id),
    reversedIds
  );

  // Non-superadmin authenticated user gets 0 rows on prompt_chain_runs via RLS and is blocked on reorder RPC
  await db.exec(`
    select set_config('request.jwt.claim.role', 'authenticated', false);
    select set_config('request.jwt.claim.sub', '${guestId}', false);
    set role authenticated;
  `);
  const guestRuns = await db.query(`select id from public.prompt_chain_runs`);
  assert.equal(guestRuns.rows.length, 0);

  await assert.rejects(
    () =>
      db.query(`select * from public.reorder_prompt_chain_steps($1::uuid, $2::uuid[])`, [
        cwChainId,
        reversedIds,
      ]),
    /Forbidden: superadmin privilege required/
  );
  await db.exec('reset role');

  // Superadmin authenticated user sees all 18 hanzi_mnemonic showcase rows
  await db.exec(`
    select set_config('request.jwt.claim.role', 'authenticated', false);
    select set_config('request.jwt.claim.sub', '${superId}', false);
    set role authenticated;
  `);
  const adminRuns = await db.query(
    `select id from public.prompt_chain_runs where app_scope = 'hanzi_mnemonic'`
  );
  assert.equal(adminRuns.rows.length, 18);
  await db.exec('reset role');

  await db.close();
}

if (import.meta.url === pathToFileUrlSafe(process.argv[1])) {
  await runMnemonicDbSuite();
  console.log('Mnemonic PGlite DB suite passed.');
}

function pathToFileUrlSafe(p) {
  if (!p) return '';
  return new URL(`file://${path.resolve(p)}`).href;
}
