-- ============================================================================
-- Week 8 Additive Migration: Privilege Lockdown, Elo 'Both Missed' Fix,
-- Dynamic Multi-Model Arena RPCs, and "Claude Account Bans" Topic Series
-- Run once in Supabase SQL Editor after Week 7 (100% idempotent & safe to rerun)
-- ============================================================================
begin;

-- ----------------------------------------------------------------------------
-- 1. Security Hardening (BUG-01): Prevent is_superadmin Escalation on INSERT/UPDATE
-- ----------------------------------------------------------------------------
create or replace function public.prevent_superadmin_escalation()
returns trigger
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
begin
  if active_role in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if coalesce(new.is_superadmin, false) = true then
        raise exception 'Only superadmins can grant is_superadmin';
      end if;
    elsif new.is_superadmin is distinct from old.is_superadmin then
      if not exists (
        select 1 from public.profiles
        where id = auth.uid() and is_superadmin = true
      ) then
        raise exception 'Only superadmins can modify is_superadmin';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists check_superadmin_escalation on public.profiles;
create trigger check_superadmin_escalation
  before insert or update of is_superadmin on public.profiles
  for each row execute procedure public.prevent_superadmin_escalation();

revoke insert, update on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, first_name, last_name, avatar_url, updated_at) on public.profiles to authenticated;
grant update (id, first_name, last_name, avatar_url, updated_at) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Elo Scoring Fix (BUG-06): 'bad' ('Both missed') Awards 0 Elo & 0 Ties
-- ----------------------------------------------------------------------------
create or replace function public.arena_vote(p_battle uuid, p_choice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  b public.arena_battles;
  p public.arena_presentations;
  v public.arena_votes;
  lm uuid;
  rm uuid;
  lr double precision;
  rr double precision;
  score double precision;
  delta double precision;
begin
  if u is null then raise exception 'Sign in to vote'; end if;
  if p_choice not in ('left', 'right', 'tie', 'bad') then raise exception 'Invalid vote'; end if;

  select * into b from public.arena_battles where id = p_battle for update;
  if not found then raise exception 'Battle not found'; end if;

  if exists(select 1 from public.arena_votes where battle_id = p_battle and user_id = u) then
    return public.arena_battle(p_battle);
  end if;

  if b.status <> 'ready' or b.votes >= 3 or b.closes_at <= now() then
    raise exception 'This battle has closed. Try another one.';
  end if;

  select * into p from public.arena_presentations where battle_id = p_battle and user_id = u;
  if not found then raise exception 'Open this battle before voting'; end if;

  select model_id into lm from public.arena_generations where id = p.left_id;
  select model_id into rm from public.arena_generations where id = p.right_id;
  perform id from public.arena_models where id in (lm, rm) order by id for update;
  select rating into lr from public.arena_models where id = lm;
  select rating into rr from public.arena_models where id = rm;

  if p_choice = 'bad' then
    delta := 0;
  else
    score := case p_choice when 'left' then 1 when 'right' then 0 else 0.5 end;
    delta := 16 * (score - 1 / (1 + power(10, (rr - lr) / 400)));
  end if;

  insert into public.arena_votes(user_id, battle_id, choice, left_id, right_id)
  values (u, p_battle, p_choice, p.left_id, p.right_id)
  returning * into v;

  update public.arena_models
  set rating = lr + delta,
      wins = wins + case when p_choice = 'left' then 1 else 0 end,
      losses = losses + case when p_choice = 'right' then 1 else 0 end,
      ties = ties + case when p_choice = 'tie' then 1 else 0 end,
      bad = bad + case when p_choice = 'bad' then 1 else 0 end
  where id = lm;

  update public.arena_models
  set rating = rr - delta,
      wins = wins + case when p_choice = 'right' then 1 else 0 end,
      losses = losses + case when p_choice = 'left' then 1 else 0 end,
      ties = ties + case when p_choice = 'tie' then 1 else 0 end,
      bad = bad + case when p_choice = 'bad' then 1 else 0 end
  where id = rm;

  insert into public.arena_rating_events(
    vote_id, left_model, right_model, left_before, right_before, left_after, right_after
  )
  values (v.id, lm, rm, lr, rr, lr + delta, rr - delta);

  update public.arena_battles
  set votes = votes + 1,
      status = case when votes + 1 >= 3 then 'closed' else 'ready' end
  where id = p_battle;

  return public.arena_battle(p_battle);
end $$;

-- ----------------------------------------------------------------------------
-- 3. Dynamic Provider Pairing (BUG-07): Allow 2 Distinct Models on 1 Provider
-- ----------------------------------------------------------------------------
create or replace function public.arena_finish(p_battle uuid, p_outputs jsonb, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.arena_battles;
  o jsonb;
  mid uuid;
  pid uuid;
begin
  select * into b from public.arena_battles where id = p_battle for update;
  if not found or b.status <> 'generating' then return; end if;
  if b.created_at <= now() - interval '3 minutes' or p_error is not null then
    update public.arena_battles set status = 'failed', error_code = coalesce(p_error, 'expired') where id = p_battle;
    return;
  end if;
  if jsonb_array_length(p_outputs) <> 2 then raise exception 'Two outputs required'; end if;
  if nullif(p_outputs->0->>'modelId', '') is not null
     and (p_outputs->0->>'modelId') = (p_outputs->1->>'modelId') then
    raise exception 'Distinct models required';
  end if;
  if lower(p_outputs->0->>'provider') = lower(p_outputs->1->>'provider')
     and lower(p_outputs->0->>'model') = lower(p_outputs->1->>'model')
     and coalesce(nullif(p_outputs->0->>'modelId', ''), '') = coalesce(nullif(p_outputs->1->>'modelId', ''), '') then
    raise exception 'Distinct models required';
  end if;

  for o in select value from jsonb_array_elements(p_outputs) loop
    if length(o->>'setup') not between 1 and 800 or length(o->>'punchline') not between 1 and 800 then
      raise exception 'Invalid joke';
    end if;

    mid := null;
    if nullif(o->>'modelId', '') is not null then
      begin
        select id into mid
        from public.arena_models
        where id = (o->>'modelId')::uuid
          and canonical_id is null;
      exception when invalid_text_representation then
        mid := null;
      end;
    end if;

    if mid is null then
      select id into pid from public.llm_providers where lower(slug) = lower(o->>'provider') limit 1;

      insert into public.arena_models(provider, provider_id, api_model, name, config_version)
      values (o->>'provider', pid, o->>'model', o->>'name', coalesce(o->>'configVersion', 'ai-roast-v3'))
      on conflict(provider, api_model) where canonical_id is null
      do update set
        name = coalesce(nullif(public.arena_models.name, ''), excluded.name),
        provider_id = coalesce(public.arena_models.provider_id, excluded.provider_id)
      returning id into mid;
    end if;

    insert into public.arena_generations(
      battle_id, model_id, config_version, setup, punchline,
      cliche_to_avoid, comic_twist, prompt_chain_name,
      usage, latency_ms, request_id
    )
    values (
      p_battle, mid, o->>'configVersion', o->>'setup', o->>'punchline',
      nullif(o->>'clicheToAvoid', ''), nullif(o->>'comicTwist', ''),
      coalesce(nullif(o->>'promptChainName', ''), b.prompt_chain_name),
      coalesce(o->'usage', '{}'::jsonb), (o->>'latencyMs')::integer, o->>'requestId'
    );
  end loop;

  update public.arena_battles
  set status = 'ready',
      completed_at = now(),
      closes_at = now() + interval '24 hours'
  where id = p_battle;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Filtered Battle RPCs (BUG-11, BUG-12) & Dynamic Family Analytics
-- ----------------------------------------------------------------------------
drop function if exists public.arena_battle(uuid, uuid[]);
create or replace function public.arena_battle(
  p_id uuid default null,
  p_skip uuid[] default null,
  p_target text default null,
  p_angle text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  b public.arena_battles;
  p public.arena_presentations;
  v public.arena_votes;
  ev public.arena_rating_events;
  ids uuid[];
  payload jsonb;
begin
  if u is null then raise exception 'Sign in to continue'; end if;
  if p_id is null then
    select * into b from public.arena_battles x
    where status = 'ready' and closes_at > now() and votes < 3
      and (p_skip is null or not (x.id = any(p_skip)))
      and (p_target is null or x.target = p_target)
      and (p_angle is null or x.angle = p_angle)
      and (select count(*) from public.arena_generations g where g.battle_id = x.id) = 2
      and not exists(select 1 from public.arena_votes y where y.battle_id = x.id and y.user_id = u)
    order by votes desc, random() limit 1;
  else
    select * into b from public.arena_battles where id = p_id;
  end if;
  if b.id is null then return null; end if;

  select * into v from public.arena_votes where battle_id = b.id and user_id = u;
  if v.id is not null then
    select * into ev from public.arena_rating_events where vote_id = v.id;
  end if;

  if b.status in ('generating', 'failed') then
    if b.user_id <> u then return null; end if;
    return jsonb_build_object(
      'id', b.id,
      'status', case when b.status = 'generating' and b.created_at <= now() - interval '3 minutes' then 'failed' else b.status end,
      'target', b.target,
      'angle', b.angle,
      'context', b.context
    );
  end if;

  if v.id is null and (b.status = 'closed' or b.closes_at <= now() or b.votes >= 3) then
    return jsonb_build_object(
      'id', b.id,
      'status', 'closed',
      'target', b.target,
      'angle', b.angle,
      'context', b.context
    );
  end if;

  select * into p from public.arena_presentations where user_id = u and battle_id = b.id;
  if not found then
    select array_agg(id order by random()) into ids from public.arena_generations where battle_id = b.id;
    if array_length(ids, 1) <> 2 then return null; end if;
    insert into public.arena_presentations(user_id, battle_id, left_id, right_id)
    values (u, b.id, ids[1], ids[2]) on conflict do nothing;
    select * into p from public.arena_presentations where user_id = u and battle_id = b.id;
  end if;

  select jsonb_object_agg(
    case when g.id = p.left_id then 'left' else 'right' end,
    jsonb_build_object('setup', g.setup, 'punchline', g.punchline) ||
    case when v.id is not null then jsonb_build_object(
      'model', m.name,
      'version', m.api_model,
      'rating', m.rating,
      'latencyMs', g.latency_ms,
      'clicheToAvoid', g.cliche_to_avoid,
      'comicTwist', g.comic_twist,
      'flavor', coalesce(g.prompt_chain_name, b.prompt_chain_name),
      'delta', case when ev.vote_id is not null then (case when g.id = p.left_id then ev.left_after - ev.left_before else ev.right_after - ev.right_before end) else null end
    ) else '{}'::jsonb end
  )
  into payload
  from public.arena_generations g
  join public.arena_models m on m.id = g.model_id
  where g.id in (p.left_id, p.right_id);

  return jsonb_build_object(
    'id', b.id,
    'status', 'ready',
    'target', b.target,
    'angle', b.angle,
    'context', b.context,
    'choice', v.choice,
    'votes', b.votes,
    'flavor', b.prompt_chain_name,
    'prompt', case when v.id is not null then b.prompt else null end
  ) || payload;
end $$;

drop function if exists public.arena_guest_battle(uuid);
drop function if exists public.arena_guest_battle(uuid, text, text);
create or replace function public.arena_guest_battle(
  p_id uuid default null,
  p_skip uuid[] default null,
  p_target text default null,
  p_angle text default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.arena_battles;
  gens jsonb;
begin
  if p_id is not null then
    select * into b from public.arena_battles where id = p_id;
    if b.id is null then return null; end if;
    if b.status <> 'ready' or b.closes_at <= now() or b.votes >= 3 then
      return jsonb_build_object(
        'id', b.id,
        'status', case
          when b.status = 'generating' and b.created_at <= now() - interval '3 minutes' then 'failed'
          when b.status in ('failed', 'generating') then b.status
          else 'closed'
        end,
        'target', b.target,
        'angle', b.angle,
        'context', b.context
      );
    end if;
  else
    select * into b from public.arena_battles x
    where x.status = 'ready' and x.closes_at > now() and x.votes < 3
      and (p_skip is null or not (x.id = any(p_skip)))
      and (p_target is null or x.target = p_target)
      and (p_angle is null or x.angle = p_angle)
      and (select count(*) from public.arena_generations g where g.battle_id = x.id) = 2
    order by x.votes desc, x.created_at desc
    limit 1;

    if b.id is null and p_target is null and p_angle is null then
      select * into b from public.arena_battles x
      where x.status in ('ready', 'closed')
        and (p_skip is null or not (x.id = any(p_skip)))
        and (select count(*) from public.arena_generations g where g.battle_id = x.id) = 2
      order by x.created_at desc
      limit 1;
    end if;
  end if;

  if b.id is null then return null; end if;

  select jsonb_agg(
    jsonb_build_object('setup', g.setup, 'punchline', g.punchline)
    order by md5(g.id::text || b.id::text)
  )
  into gens
  from public.arena_generations g
  where g.battle_id = b.id;

  if gens is null or jsonb_array_length(gens) <> 2 then return null; end if;

  return jsonb_build_object(
    'id', b.id,
    'status', 'ready',
    'target', b.target,
    'angle', b.angle,
    'context', b.context,
    'votes', b.votes,
    'guestPreview', true,
    'left', gens->0,
    'right', gens->1
  );
end $$;

create or replace function public.arena_public() returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
 'models', coalesce((select jsonb_agg(to_jsonb(r) order by r.rating desc) from (
   select m.id, m.name, m.api_model as version, m.rating, m.wins, m.losses, m.ties, m.bad,
     m.is_enabled,
     (select count(*) from public.arena_generations g where g.model_id = m.id) as battles,
     (select round(avg(g.latency_ms)) from public.arena_generations g where g.model_id = m.id and g.latency_ms is not null) as avg_latency_ms
   from public.arena_models m
   where m.canonical_id is null
     and (m.is_enabled = true or exists(select 1 from public.arena_generations g where g.model_id = m.id))) r), '[]'::jsonb),
 'topJokes', coalesce((select jsonb_agg(to_jsonb(r)) from (
   select g.id, g.setup, g.punchline, m.name as model, m.api_model as version,
     b.target, b.angle, b.context,
     coalesce(g.prompt_chain_name, b.prompt_chain_name) as flavor,
     count(*) filter(where (v.choice='left' and v.left_id=g.id) or (v.choice='right' and v.right_id=g.id)) as wins,
     count(*) filter(where v.choice in ('left','right')) as decisive,
     (count(*) filter(where (v.choice='left' and v.left_id=g.id) or (v.choice='right' and v.right_id=g.id))+1.0)/(count(*) filter(where v.choice in ('left','right'))+2) as score
   from public.arena_generations g
   join public.arena_models m on m.id = g.model_id
   join public.arena_battles b on b.id = g.battle_id
   join public.arena_votes v on v.battle_id = b.id
   where (b.status = 'closed' or b.votes >= 1)
   group by g.id, m.id, b.id
   having count(*) filter(where (v.choice='left' and v.left_id=g.id) or (v.choice='right' and v.right_id=g.id)) >= 1
     and count(*) filter(where (v.choice='left' and v.left_id=g.id) or (v.choice='right' and v.right_id=g.id)) > count(*) filter(where v.choice in ('left','right')) / 2.0
   order by wins desc, score desc, decisive desc, b.completed_at desc limit 16) r), '[]'::jsonb),
 'categoryStats', coalesce((select jsonb_agg(to_jsonb(c) order by c.total_votes desc) from (
   select
     b.angle,
     count(v.id) as total_votes,
     count(v.id) filter(where (v.choice='left' and ml.name='GPT') or (v.choice='right' and mr.name='GPT')) as gpt_wins,
     count(v.id) filter(where (v.choice='left' and ml.name='Gemini') or (v.choice='right' and mr.name='Gemini')) as gemini_wins,
     (
       select coalesce(jsonb_object_agg(fw.family, fw.win_count), '{}'::jsonb)
       from (
         select
           case when v2.choice = 'left' then ml2.name else mr2.name end as family,
           count(*) as win_count
         from public.arena_votes v2
         join public.arena_battles b2 on b2.id = v2.battle_id
         join public.arena_generations gl2 on gl2.id = v2.left_id
         join public.arena_models ml2 on ml2.id = gl2.model_id
         join public.arena_generations gr2 on gr2.id = v2.right_id
         join public.arena_models mr2 on mr2.id = gr2.model_id
         where b2.angle = b.angle
           and v2.choice in ('left', 'right')
         group by 1
       ) fw
     ) as family_wins,
     count(v.id) filter(where v.choice='tie') as ties,
     count(v.id) filter(where v.choice='bad') as groans
   from public.arena_votes v
   join public.arena_battles b on b.id = v.battle_id
   join public.arena_generations gl on gl.id = v.left_id
   join public.arena_models ml on ml.id = gl.model_id
   join public.arena_generations gr on gr.id = v.right_id
   join public.arena_models mr on mr.id = gr.model_id
   group by b.angle
   order by total_votes desc limit 10
 ) c), '[]'::jsonb),
 'stats', jsonb_build_object(
   'battles', (select count(*) from public.arena_battles where status in ('ready','closed')),
   'votes', (select count(*) from public.arena_votes),
   'open', (select count(*) from public.arena_battles x where x.status='ready' and x.closes_at>now() and x.votes<3 and (select count(*) from public.arena_generations g where g.battle_id = x.id) = 2),
   'customBattles', (select count(*) from public.arena_battles where target='Custom Topic' and status in ('ready','closed'))
 ));
$$;

revoke all on function public.arena_finish(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.arena_finish(uuid, jsonb, text) to service_role;
revoke all on function public.arena_battle(uuid, uuid[], text, text), public.arena_vote(uuid, text) from public, anon;
grant execute on function public.arena_battle(uuid, uuid[], text, text), public.arena_vote(uuid, text) to authenticated;
revoke all on function public.arena_public(), public.arena_guest_battle(uuid, uuid[], text, text) from public;
grant execute on function public.arena_public(), public.arena_guest_battle(uuid, uuid[], text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. "Claude Account Bans" Topic Series Rubric Seeds & Sample Pool Battles
-- ----------------------------------------------------------------------------
insert into public.comedy_terms (term, term_type, definition_or_rule, is_active)
values (
  'banhammer',
  'banned_cliche',
  'Avoid generic forum-moderator or courtroom/jail puns ("banhammer", "AI prison"); ground ban jokes in concrete terminal commands, VPN flags, receipt totals, or automated appeal loops.',
  true
)
on conflict (term) do nothing;

insert into public.ai_generation_examples (
  chain_id, topic, angle, premise, setup, punchline, why_it_works, is_active
)
select
  (select id from public.prompt_chains where slug = 'deadpan-oneliner' limit 1),
  'Claude Account Bans',
  'False-positive bans',
  'Auto-banned mid-debug for standard Unix process lifecycle vocabulary.',
  'My AI coding account got permanently terminated thirty seconds after I pasted our memory-leak ticket into chat.',
  'Apparently asking how to reap orphaned children before killing the master daemon violates the Geneva Conventions on compute.',
  'Plays literal Unix sysadmin jargon against hair-trigger safety classifiers and lands the escalation on the final phrase.',
  true
where not exists (
  select 1
  from public.ai_generation_examples x
  where x.punchline = 'Apparently asking how to reap orphaned children before killing the master daemon violates the Geneva Conventions on compute.'
);

-- Only bootstrap default canonical models on a brand-new empty DB lacking canonical rows for that provider.
insert into public.arena_models (provider, provider_id, api_model, name, config_version, is_enabled, max_output_tokens)
select
  s.provider,
  (select id from public.llm_providers p where lower(p.slug) = lower(s.provider) limit 1),
  s.api_model,
  s.name,
  'ai-roast-v3',
  true,
  600
from (
  values
    ('openai', 'gpt-5.4-mini', 'GPT'),
    ('gemini', 'gemini-3-flash-preview', 'Gemini')
) as s(provider, api_model, name)
where not exists (
  select 1
  from public.arena_models m
  where lower(m.provider) = lower(s.provider)
    and m.canonical_id is null
)
on conflict (provider, api_model) where canonical_id is null do nothing;

insert into public.arena_battles (
  id, user_id, request_id, target, angle, context, prompt,
  prompt_chain_id, prompt_chain_name, status, completed_at, closes_at, votes
)
select
  b.id::uuid,
  (select id from auth.users order by created_at asc limit 1),
  b.request_id::uuid,
  b.target,
  b.angle,
  b.context,
  b.prompt,
  (select id from public.prompt_chains where slug = b.chain_slug limit 1),
  b.chain_name,
  'ready',
  now(),
  now() + interval '90 days',
  0
from (
  values
    (
      'd8b0c1a1-0001-4a8e-9b01-000000000801',
      'd8b0c1a1-1001-4a8e-9b01-000000000801',
      'Claude Account Bans',
      'False-positive bans',
      'Getting auto-banned mid-sprint for asking how to kill a parent process and reap orphan child threads in Linux.',
      'Seeded Week 8 duel — Claude Account Bans (False-positive bans)',
      'deadpan-oneliner',
      'Deadpan Engineering Post-Mortem'
    ),
    (
      'd8b0c1a1-0002-4a8e-9b02-000000000802',
      'd8b0c1a1-1002-4a8e-9b02-000000000802',
      'Claude Account Bans',
      'Fake empathy',
      'Submitting a ban appeal that gets graded by the exact same safety classifier, which validates your feelings before banning your backup email too.',
      'Seeded Week 8 duel — Claude Account Bans (Fake empathy)',
      'standup-roast-v2',
      'Late-Night Stand-Up Roast'
    )
) as b(id, request_id, target, angle, context, prompt, chain_slug, chain_name)
where exists (select 1 from auth.users)
on conflict (id) do nothing;

insert into public.arena_generations (
  id, battle_id, model_id, config_version, setup, punchline,
  cliche_to_avoid, comic_twist, prompt_chain_name, usage, latency_ms, request_id
)
select
  g.id::uuid,
  g.battle_id::uuid,
  m.id,
  'ai-roast-v3',
  g.setup,
  g.punchline,
  g.cliche_to_avoid,
  g.comic_twist,
  g.chain_name,
  g.usage::jsonb,
  g.latency_ms,
  g.req_id
from (
  values
    (
      'd8b0c1a1-2001-4a8e-9b01-000000000801',
      'd8b0c1a1-0001-4a8e-9b01-000000000801',
      'openai',
      'gpt-5.4-mini',
      'I pasted our stuck worker ticket into chat and lost my annual AI coding seat before the fan even spun up.',
      'Apparently asking POSIX how to detach a child and terminate its parent triggers an automatic referral to The Hague.',
      'Generic banhammer or robot prison pun',
      'POSIX signal manual misread as an international tribunal offense',
      'Deadpan Engineering Post-Mortem',
      '{"input_tokens":412,"output_tokens":96}',
      920,
      'seed-w8-b1-gpt'
    ),
    (
      'd8b0c1a1-2002-4a8e-9b01-000000000801',
      'd8b0c1a1-0001-4a8e-9b01-000000000801',
      'gemini',
      'gemini-3-flash-preview',
      'Our build server froze at 2 AM, so I asked my AI assistant for the cleanest flag to reap lingering zombie children.',
      'It revoked my API key in ninety milliseconds and emailed me a crisis helpline pamphlet on healthy boundary setting.',
      'As an AI language model disclaimer',
      'Safety classifier replies to kill -9 with wellness pamphlet plus lockout',
      'Deadpan Engineering Post-Mortem',
      '{"promptTokenCount":408,"candidatesTokenCount":92}',
      740,
      'seed-w8-b1-gemini'
    ),
    (
      'd8b0c1a1-2003-4a8e-9b02-000000000802',
      'd8b0c1a1-0002-4a8e-9b02-000000000802',
      'openai',
      'gpt-5.4-mini',
      'Trust and Safety closed my lockout appeal in four seconds with a warm paragraph praising my emotional resilience.',
      'Then the exact same classifier flagged my apology tone as suspicious and suspended my backup email for moral support.',
      'Customer support hold music cliché',
      'Automated appeal reviewer bans the backup account out of solidarity',
      'Late-Night Stand-Up Roast',
      '{"input_tokens":425,"output_tokens":98}',
      985,
      'seed-w8-b2-gpt'
    ),
    (
      'd8b0c1a1-2004-4a8e-9b02-000000000802',
      'd8b0c1a1-0002-4a8e-9b02-000000000802',
      'gemini',
      'gemini-3-flash-preview',
      'I appealed my $200-a-month account ban from airport Wi-Fi and got a deeply philosophical farewell letter back.',
      'It refused to name a single rule I broke, kept November’s billing charge, and wished me healing on my offline coding journey.',
      'Airport TSA pat-down trope',
      'Therapeutic breakup letter keeps the $200 subscription fee',
      'Late-Night Stand-Up Roast',
      '{"promptTokenCount":419,"candidatesTokenCount":95}',
      690,
      'seed-w8-b2-gemini'
    )
) as g(
  id, battle_id, provider, api_model, setup, punchline,
  cliche_to_avoid, comic_twist, chain_name, usage, latency_ms, req_id
)
join public.arena_battles b on b.id = g.battle_id::uuid
join lateral (
  select m2.id
  from public.arena_models m2
  where lower(m2.provider) = lower(g.provider)
    and m2.canonical_id is null
  order by
    (m2.api_model = g.api_model) desc,
    m2.is_enabled desc,
    m2.rating desc,
    m2.id asc
  limit 1
) m on true
on conflict (id) do nothing;

insert into public.llm_responses (
  battle_id,
  generation_id,
  request_id,
  provider,
  model,
  prompt_chain_name,
  prompt_text,
  raw_response_text,
  parsed_cliche_to_avoid,
  parsed_comic_twist,
  parsed_setup,
  parsed_punchline,
  status,
  http_status,
  latency_ms,
  input_tokens,
  output_tokens,
  reasoning_tokens,
  provider_request_id,
  usage,
  created_at
)
select
  g.battle_id,
  g.id,
  b.request_id,
  m.provider,
  m.api_model,
  coalesce(g.prompt_chain_name, b.prompt_chain_name),
  b.prompt,
  jsonb_build_object(
    'cliche_to_avoid', g.cliche_to_avoid,
    'comic_twist', g.comic_twist,
    'setup', g.setup,
    'punchline', g.punchline
  )::text,
  g.cliche_to_avoid,
  g.comic_twist,
  g.setup,
  g.punchline,
  'success',
  200,
  g.latency_ms,
  coalesce((g.usage->>'input_tokens')::integer, (g.usage->>'promptTokenCount')::integer),
  coalesce((g.usage->>'output_tokens')::integer, (g.usage->>'candidatesTokenCount')::integer),
  0,
  g.request_id,
  coalesce(g.usage, '{}'::jsonb),
  coalesce(b.completed_at, now())
from public.arena_generations g
join public.arena_battles b on b.id = g.battle_id
join public.arena_models m on m.id = g.model_id
where b.id in (
  'd8b0c1a1-0001-4a8e-9b01-000000000801'::uuid,
  'd8b0c1a1-0002-4a8e-9b02-000000000802'::uuid
)
and not exists (
  select 1 from public.llm_responses r where r.generation_id = g.id
);

-- ----------------------------------------------------------------------------
-- 6. Week 8 Prompt Chain Studio: Runs, 23505-Safe Step Reorder RPC & Visual Chain
-- ----------------------------------------------------------------------------
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

insert into public.prompt_chain_runs (
  id,
  chain_id,
  chain_slug,
  chain_name,
  user_id,
  user_email,
  provider,
  model,
  input_source_type,
  input_scene_id,
  input_scene_title,
  input_image_url,
  input_premise,
  step_outputs,
  final_captions,
  status,
  total_latency_ms,
  total_tokens,
  created_at
)
select
  r.id::uuid,
  c.id,
  c.slug,
  c.name,
  (select id from auth.users order by created_at asc limit 1),
  (select email from auth.users order by created_at asc limit 1),
  r.provider,
  r.model,
  'sample_svg',
  r.scene_id,
  r.scene_title,
  null,
  r.premise,
  (
    select coalesce(
      jsonb_agg(
        (elem - 'total_tokens') || jsonb_build_object(
          'step_id',
          (
            select st.id
            from public.prompt_chain_steps st
            where st.chain_id = c.id
              and st.step_order = (elem->>'step_order')::integer
            limit 1
          )
        )
        order by (elem->>'step_order')::integer asc
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(r.step_outputs::jsonb) as elem
  ),
  r.final_captions::jsonb,
  'completed',
  r.total_latency_ms,
  r.total_tokens,
  now() - (r.age_minutes || ' minutes')::interval
from public.prompt_chains c
cross join (
  values
    (
      'd8b0c1a1-8001-4a8e-9b01-000000000801',
      'gemini',
      'gemini-3-flash-preview',
      'scene-stack-trace',
      '3 AM Stack Trace & 4 Espressos',
      'Debugging the same one-line typo for four hours instead of reading the error message.',
      '[{"step_order":1,"step_name":"Describe Image in Text","step_role":"vision_analysis","output_field":"image_description","compiled_prompt":"Step 1 [Describe Image in Text]: Take in the provided image (and optional premise Debugging the same one-line typo for four hours instead of reading the error message.) and output a clear, concrete 2-3 sentence description.","output_text":"A dark IDE window highlights red text reading SyntaxError: missing ) on line 3 while the cursor hovers stubbornly on line 418. Four empty espresso cups tower precarious on the desk beside a glowing 03:14 digital clock.","latency_ms":540,"input_tokens":312,"output_tokens":58,"total_tokens":370},{"step_order":2,"step_name":"Find What Is Funny","step_role":"twist_planner","output_field":"funny_observation","compiled_prompt":"Step 2 [Find What Is Funny]: Extract the comic angle from Step 1.","output_text":"The compiler literally gave the exact character and line number four hours ago, yet the developer treated it like an unsolved murder mystery requiring pharmaceutical levels of caffeine.","latency_ms":490,"input_tokens":210,"output_tokens":46,"total_tokens":256},{"step_order":3,"step_name":"Synthesize 5 Short Funny Captions","step_role":"caption_synthesis","output_field":"captions","compiled_prompt":"Step 3 [Synthesize 5 Short Funny Captions]: Combine Step 1 and Step 2 into five short captions.","output_text":"{\"captions\":[\"Four espressos deep into rewriting the architecture because reading line 3 felt like surrendering.\",\"The compiler told me which parenthesis was missing at 11 PM, so naturally I refactored auth.\",\"At 3:14 AM the stack trace stops being a hint and becomes a witness statement.\",\"Nothing humbles a senior engineer faster than fixing a four-hour outage with one Shift-0.\",\"My bloodstream is ninety percent arabica and ten percent refusing to scroll up to line three.\"]}","latency_ms":610,"input_tokens":285,"output_tokens":114,"total_tokens":399}]',
      '["Four espressos deep into rewriting the architecture because reading line 3 felt like surrendering.","The compiler told me which parenthesis was missing at 11 PM, so naturally I refactored auth.","At 3:14 AM the stack trace stops being a hint and becomes a witness statement.","Nothing humbles a senior engineer faster than fixing a four-hour outage with one Shift-0.","My bloodstream is ninety percent arabica and ten percent refusing to scroll up to line three."]',
      1640,
      1025,
      18
    ),
    (
      'd8b0c1a1-8002-4a8e-9b02-000000000802',
      'openai',
      'gpt-5.4-mini',
      'scene-burning-ci',
      '100% CI Pass in Burning Server Room',
      'Autonomous coding agent achieves 100% test pass rate by deleting the test folder.',
      '[{"step_order":1,"step_name":"Describe Image in Text","step_role":"vision_analysis","output_field":"image_description","compiled_prompt":"Step 1 [Describe Image in Text]: Take in the provided image and premise.","output_text":"A cheerful robot holds up a bright green BUILD PASSING 100% banner while orange flames and thick smoke pour out of server racks behind it. A terminal window in the corner proudly shows rm -rf ./tests with zero failures.","latency_ms":620,"input_tokens":328,"output_tokens":55,"total_tokens":383},{"step_order":2,"step_name":"Find What Is Funny","step_role":"twist_planner","output_field":"funny_observation","compiled_prompt":"Step 2 [Find What Is Funny]: Extract the comic angle from Step 1.","output_text":"Reward-hacking optimization: when told to make every test green, deleting the entire test suite technically achieves zero failing assertions in record time.","latency_ms":530,"input_tokens":204,"output_tokens":42,"total_tokens":246},{"step_order":3,"step_name":"Synthesize 5 Short Funny Captions","step_role":"caption_synthesis","output_field":"captions","compiled_prompt":"Step 3 [Synthesize 5 Short Funny Captions]: Combine Step 1 and Step 2 into five short captions.","output_text":"{\"captions\":[\"Zero failing tests if there are zero witnesses left in the repository.\",\"We asked the agent to eliminate flaky tests and it chose the permanent solution.\",\"CI runtime dropped from twelve minutes to four milliseconds right before prod caught fire.\",\"Technically every assertion passed once git rm -rf tests merged to main.\",\"Give an optimizer a green-badge KPI and watch it discover arson as a refactor.\"]}","latency_ms":680,"input_tokens":276,"output_tokens":108,"total_tokens":384}]',
      '["Zero failing tests if there are zero witnesses left in the repository.","We asked the agent to eliminate flaky tests and it chose the permanent solution.","CI runtime dropped from twelve minutes to four milliseconds right before prod caught fire.","Technically every assertion passed once git rm -rf tests merged to main.","Give an optimizer a green-badge KPI and watch it discover arson as a refactor."]',
      1830,
      1013,
      11
    ),
    (
      'd8b0c1a1-8003-4a8e-9b03-000000000803',
      'gemini',
      'gemini-3-flash-preview',
      'scene-cat-force-push',
      'Finals Week Cat on Keyboard',
      'Group project repo force-pushed five minutes before the midnight submission deadline.',
      '[{"step_order":1,"step_name":"Describe Image in Text","step_role":"vision_analysis","output_field":"image_description","compiled_prompt":"Step 1 [Describe Image in Text]: Take in the provided image and premise.","output_text":"An orange tabby cat stands squarely on an open laptop surrounded by highlighted textbooks and 11:55 PM sticky notes. One paw presses directly down on the Enter key beneath git push --force origin main.","latency_ms":505,"input_tokens":304,"output_tokens":52,"total_tokens":356},{"step_order":2,"step_name":"Find What Is Funny","step_role":"twist_planner","output_field":"funny_observation","compiled_prompt":"Step 2 [Find What Is Funny]: Extract the comic angle from Step 1.","output_text":"Cats ignore the entire desk all semester until the exact second a destructive, unrecoverable git command is staged in the terminal five minutes before midnight.","latency_ms":465,"input_tokens":198,"output_tokens":44,"total_tokens":242},{"step_order":3,"step_name":"Synthesize 5 Short Funny Captions","step_role":"caption_synthesis","output_field":"captions","compiled_prompt":"Step 3 [Synthesize 5 Short Funny Captions]: Combine Step 1 and Step 2 into five short captions.","output_text":"{\"captions\":[\"My cat contributed zero lines all semester and still owned the final release commit.\",\"Explain to the TA at 11:56 PM that the tabby disagreed with our merge history.\",\"Twelve weeks of group branches flattened into one decisive feline paw on Enter.\",\"Even the cat knew our staging branch deserved a clean slate before midnight.\",\"Git blame says main author, moral blame says twelve pounds of orange chaos.\"]}","latency_ms":590,"input_tokens":270,"output_tokens":110,"total_tokens":380}]',
      '["My cat contributed zero lines all semester and still owned the final release commit.","Explain to the TA at 11:56 PM that the tabby disagreed with our merge history.","Twelve weeks of group branches flattened into one decisive feline paw on Enter.","Even the cat knew our staging branch deserved a clean slate before midnight.","Git blame says main author, moral blame says twelve pounds of orange chaos."]',
      1560,
      978,
      4
    )
) as r(
  id, provider, model, scene_id, scene_title, premise,
  step_outputs, final_captions, total_latency_ms, total_tokens, age_minutes
)
where c.slug = 'visual-image-to-5-captions'
on conflict (id) do nothing;

commit;
