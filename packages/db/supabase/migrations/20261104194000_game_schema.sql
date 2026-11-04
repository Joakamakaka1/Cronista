-- The game's tables and the functions that write them (ADR-30), plus the spend ledger.
--
-- Players read through RLS. The Lambdas read as service_role, and their only direct write is the
-- ledger: every other change goes through a function here, so a balance cannot move outside a
-- published chapter, not even through a bug in a Lambda.

-- Fail instead of queueing behind a held lock. `local` scopes them to this migration's transaction.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The envelopes in `public` call into `private`, which the Data API cannot reach directly.
grant usage on schema private to service_role;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------

create type public.game_day_state as enum ('open', 'postponed', 'published');
create type public.action_origin as enum ('player', 'autopilot');
create type public.award_kind as enum ('narrator', 'autopilot', 'comic_penalty');
create type public.charge_purpose as enum ('influence', 'item', 'payment');
create type public.character_status as enum ('active', 'out');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.seasons (
  id bigint generated always as identity primary key,
  number bigint not null unique constraint seasons_number_not_negative check (number >= 0),
  starts_on date not null unique,
  ends_on date,
  created_at timestamptz not null default now(),
  -- The pre-season alone has no end date: it ends when season 1 starts.
  constraint seasons_only_preseason_is_open_ended check ((number = 0) = (ends_on is null)),
  constraint seasons_ends_after_it_starts check (ends_on >= starts_on)
);

comment on table public.seasons is 'A run of the game. The active season of a day is the latest one started, unless it has ended.';

create table public.characters (
  id bigint generated always as identity primary key,
  season_id bigint not null references public.seasons (id),
  player_id bigint not null references public.players (id),
  nickname text not null constraint characters_nickname_trimmed check (nickname = btrim(nickname) and nickname <> ''),
  balance bigint not null default 10,
  unique (season_id, player_id),
  unique (season_id, nickname)
);

comment on table public.characters is 'One caricature per player and season. The balance changes only when a chapter is published.';

create index characters_player_id_idx on public.characters (player_id);

create table public.game_days (
  id bigint generated always as identity primary key,
  season_id bigint not null references public.seasons (id),
  day date not null,
  state public.game_day_state not null default 'open',
  situation text not null,
  opened_at timestamptz not null default now(),
  -- Set when the close starts: from then on no action enters, so none is left unresolved.
  closed_at timestamptz,
  published_at timestamptz,
  unique (season_id, day),
  constraint game_days_published_when_state_says check ((state = 'published') = (published_at is not null))
);

comment on table public.game_days is 'One calendar day of a season, from its situation to its published chapter.';

-- Holds no text and no stake: this row is the "X has played" that every player can read.
create table public.actions (
  id bigint generated always as identity primary key,
  game_day_id bigint not null references public.game_days (id),
  character_id bigint not null references public.characters (id),
  origin public.action_origin not null,
  -- Set only when the chapter is published: every player reads this row, so an earlier write would
  -- reveal the strike before the chapter does.
  struck_out boolean not null default false,
  unique (game_day_id, character_id),
  constraint actions_autopilot_is_never_struck_out check (origin = 'player' or not struck_out)
);

comment on table public.actions is 'Who acted on a game day and how. What they wrote and staked is in action_contents.';

create index actions_character_id_idx on public.actions (character_id);

create table public.action_contents (
  action_id bigint primary key references public.actions (id),
  text text not null constraint action_contents_text_length check (char_length(text) between 1 and 1000),
  stake bigint not null constraint action_contents_stake_not_negative check (stake >= 0),
  created_at timestamptz not null default now()
);

comment on table public.action_contents is 'What a player wrote and staked: its player only, and everyone once the chapter is published, unless struck out.';

create table public.hints (
  game_day_id bigint not null references public.game_days (id),
  character_id bigint not null references public.characters (id),
  text text not null,
  censored boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (game_day_id, character_id)
);

comment on table public.hints is 'One private comment per player and day. A row here is the spent quota.';

create index hints_character_id_idx on public.hints (character_id);

create table public.chapters (
  game_day_id bigint primary key references public.game_days (id),
  title text not null,
  body text not null
);

comment on table public.chapters is 'The narrated text of a resolved game day. Rows exist only once published.';

create table public.awards (
  id bigint generated always as identity primary key,
  action_id bigint not null unique references public.actions (id),
  points bigint not null,
  kind public.award_kind not null,
  constraint awards_points_in_range check (points between -3 and 5),
  constraint awards_autopilot_is_fixed check (kind <> 'autopilot' or points = -1),
  constraint awards_comic_penalty_is_fixed check (kind <> 'comic_penalty' or points = -2)
);

comment on table public.awards is 'The points an action wins or loses, apart from what it charges. Rows exist only once published.';

create table public.charges (
  id bigint generated always as identity primary key,
  action_id bigint not null references public.actions (id),
  points bigint not null constraint charges_points_positive check (points > 0),
  purpose public.charge_purpose not null,
  recipient_character_id bigint references public.characters (id),
  constraint charges_payment_has_a_recipient check ((purpose = 'payment') = (recipient_character_id is not null))
);

comment on table public.charges is 'The part of a stake the narrator uses. Rows exist only once published.';

create index charges_action_id_idx on public.charges (action_id);
create index charges_recipient_character_id_idx on public.charges (recipient_character_id);

create table public.items (
  id bigint generated always as identity primary key,
  season_id bigint not null references public.seasons (id),
  name text not null,
  owner_character_id bigint not null references public.characters (id),
  acquired_on_day_id bigint not null references public.game_days (id),
  unique (season_id, name)
);

comment on table public.items is 'Named things in canon with one owner. Rows change only when a chapter is published.';

create index items_owner_character_id_idx on public.items (owner_character_id);
create index items_acquired_on_day_id_idx on public.items (acquired_on_day_id);

create table public.debts (
  id bigint generated always as identity primary key,
  debtor_character_id bigint not null references public.characters (id),
  creditor_character_id bigint not null references public.characters (id),
  points bigint not null constraint debts_points_in_range check (points between 1 and 5),
  born_on_day_id bigint not null references public.game_days (id),
  paid_on_day_id bigint references public.game_days (id),
  constraint debts_between_two_characters check (debtor_character_id <> creditor_character_id)
);

comment on table public.debts is 'Points one character owes another. Rows change only when a chapter is published.';

create index debts_debtor_character_id_idx on public.debts (debtor_character_id);
create index debts_creditor_character_id_idx on public.debts (creditor_character_id);
create index debts_born_on_day_id_idx on public.debts (born_on_day_id);
create index debts_paid_on_day_id_idx on public.debts (paid_on_day_id);

create table public.character_statuses (
  game_day_id bigint not null references public.game_days (id),
  character_id bigint not null references public.characters (id),
  status public.character_status not null,
  primary key (game_day_id, character_id)
);

comment on table public.character_statuses is 'Whether a character is active or out on a game day. Rows change only when a chapter is published.';

create index character_statuses_character_id_idx on public.character_statuses (character_id);

-- No foreign keys: the ledger counts credit cycles, not seasons, and outlives a reset.
create table public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  workspace text not null constraint ai_usage_known_workspace check (workspace in ('game-prod', 'evals', 'dev')),
  function_name text not null,
  prompt_version text not null,
  model text not null,
  input_tokens bigint not null,
  cache_read_tokens bigint not null,
  cache_write_tokens bigint not null,
  output_tokens bigint not null,
  cost_usd numeric(10, 6) not null,
  latency_ms bigint not null,
  refusal_category text,
  game_day date
);

comment on table public.ai_usage is 'The spend ledger: one row per model response, with ids and numbers only, never player text.';

create index ai_usage_workspace_created_at_idx on public.ai_usage (workspace, created_at);

-- -----------------------------------------------------------------------------
-- Grants and RLS
-- -----------------------------------------------------------------------------

-- The project's default privileges still grant TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on new
-- tables, and UPDATE (setval) on new sequences, the identity ones included.
do $$
declare
  table_name text;
  sequence_name text;
begin
  foreach table_name in array array[
    'seasons', 'characters', 'game_days', 'actions', 'action_contents', 'hints', 'chapters', 'awards',
    'charges', 'items', 'debts', 'character_statuses', 'ai_usage'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated, service_role', table_name);
    execute format('grant select on table public.%I to service_role', table_name);
    if table_name <> 'ai_usage' then
      execute format('grant select on table public.%I to authenticated', table_name);
    end if;
  end loop;

  foreach sequence_name in array array[
    'seasons_id_seq', 'characters_id_seq', 'game_days_id_seq', 'actions_id_seq', 'awards_id_seq',
    'charges_id_seq', 'items_id_seq', 'debts_id_seq', 'ai_usage_id_seq'
  ] loop
    execute format('revoke all on sequence public.%I from anon, authenticated, service_role', sequence_name);
  end loop;
end;
$$;

grant insert on table public.ai_usage to service_role;

-- Security definer, like is_player: policies cannot read another player's row in public.players.
create function private.current_player_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.players where user_id = (select auth.uid());
$$;

comment on function private.current_player_id() is 'The signed-in player, for policies that tell a player''s own rows from the others.';

revoke execute on function private.current_player_id() from public, anon, service_role;
grant execute on function private.current_player_id() to authenticated;

-- Tables with nothing hidden: every player reads every row. What must stay secret until the chapter
-- is not written to them before it is published.
create policy seasons_select_players on public.seasons for select to authenticated
using ((select private.is_player()));

create policy characters_select_players on public.characters for select to authenticated
using ((select private.is_player()));

create policy game_days_select_players on public.game_days for select to authenticated
using ((select private.is_player()));

create policy actions_select_players on public.actions for select to authenticated
using ((select private.is_player()));

create policy chapters_select_players on public.chapters for select to authenticated
using ((select private.is_player()));

create policy awards_select_players on public.awards for select to authenticated
using ((select private.is_player()));

create policy charges_select_players on public.charges for select to authenticated
using ((select private.is_player()));

create policy items_select_players on public.items for select to authenticated
using ((select private.is_player()));

create policy debts_select_players on public.debts for select to authenticated
using ((select private.is_player()));

create policy character_statuses_select_players on public.character_statuses for select to authenticated
using ((select private.is_player()));

-- Its player, and everyone else once the chapter is published, unless it was struck out.
create policy action_contents_select_visible on public.action_contents for select to authenticated
using (
  (select private.is_player())
  and exists (
    select 1
    from public.actions as action
    join public.characters as character on character.id = action.character_id
    join public.game_days as game_day on game_day.id = action.game_day_id
    where action.id = action_contents.action_id
      and (
        character.player_id = (select private.current_player_id())
        or (game_day.state = 'published' and not action.struck_out)
      )
  )
);

create policy hints_select_own on public.hints for select to authenticated
using (
  (select private.is_player())
  and exists (
    select 1
    from public.characters as character
    where character.id = hints.character_id
      and character.player_id = (select private.current_player_id())
  )
);

-- -----------------------------------------------------------------------------
-- Writing functions
-- -----------------------------------------------------------------------------

-- Each one answers jsonb, `{ "ok": true, ... }` or `{ "ok": false, "error": "<code>" }`, so a rejection
-- is a value the engine reads. The security definer one lives in `private`, out of the Data API's
-- reach; its security invoker envelope in `public` is what service_role calls.

create function private.create_season(
  p_number bigint,
  p_starts_on date,
  p_ends_on date,
  p_characters jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season_id bigint;
begin
  if (p_number = 0) <> (p_ends_on is null) or p_number < 0 or p_ends_on < p_starts_on then
    return jsonb_build_object('ok', false, 'error', 'invalid_dates');
  end if;
  if exists (select 1 from public.seasons where number = p_number) then
    return jsonb_build_object('ok', false, 'error', 'season_number_taken');
  end if;
  -- Season 1 may start while the open-ended pre-season runs: it takes over from that day.
  if exists (
    select 1
    from public.seasons
    where starts_on = p_starts_on
      or (
        ends_on is not null
        and p_ends_on is not null
        and daterange(starts_on, ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
      )
  ) then
    return jsonb_build_object('ok', false, 'error', 'dates_overlap');
  end if;
  if jsonb_array_length(p_characters) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_characters');
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_characters) as input (email text, nickname text)
    left join public.players as player on player.email = lower(btrim(input.email))
    where player.id is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'unknown_player');
  end if;
  if (
    select count(*) <> count(distinct lower(btrim(input.email)))
      or count(*) <> count(distinct btrim(input.nickname))
      or bool_or(btrim(input.nickname) = '' or input.nickname is null)
    from jsonb_to_recordset(p_characters) as input (email text, nickname text)
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_characters');
  end if;

  insert into public.seasons (number, starts_on, ends_on)
  values (p_number, p_starts_on, p_ends_on)
  returning id into v_season_id;

  insert into public.characters (season_id, player_id, nickname)
  select v_season_id, player.id, btrim(input.nickname)
  from jsonb_to_recordset(p_characters) as input (email text, nickname text)
  join public.players as player on player.email = lower(btrim(input.email));

  return jsonb_build_object('ok', true, 'season_id', v_season_id);
end;
$$;

comment on function private.create_season(bigint, date, date, jsonb) is 'Creates a season and its characters from [{email, nickname}]. Invented data locally, real nicknames in production.';

create function private.open_game_day(p_season_id bigint, p_day date, p_situation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_day_id bigint;
begin
  insert into public.game_days (season_id, day, situation)
  values (p_season_id, p_day, p_situation)
  on conflict (season_id, day) do nothing
  returning id into v_game_day_id;

  if v_game_day_id is not null then
    return jsonb_build_object('ok', true, 'game_day_id', v_game_day_id, 'opened', true);
  end if;

  select id into v_game_day_id from public.game_days where season_id = p_season_id and day = p_day;
  return jsonb_build_object('ok', true, 'game_day_id', v_game_day_id, 'opened', false);
end;
$$;

comment on function private.open_game_day(bigint, date, text) is 'Opens a game day with its situation. The first writer wins, so running the job twice opens it once.';

create function private.submit_action(
  p_game_day_id bigint,
  p_character_id bigint,
  p_text text,
  p_stake bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.game_days;
  v_balance bigint;
  v_action_id bigint;
begin
  -- Conflicts with the lock begin_close takes: either the close sees this action or this sees the close.
  select * into v_day from public.game_days where id = p_game_day_id for share;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'day_not_open');
  end if;
  if v_day.state <> 'open' or v_day.closed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'day_closed');
  end if;

  select balance into v_balance
  from public.characters
  where id = p_character_id and season_id = v_day.season_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_character');
  end if;

  -- 0 always passes: a player at zero or below still plays, declaring nothing.
  if p_stake < 0 or (p_stake > 0 and p_stake > v_balance) then
    return jsonb_build_object('ok', false, 'error', 'stake_out_of_range');
  end if;

  insert into public.actions (game_day_id, character_id, origin)
  values (p_game_day_id, p_character_id, 'player')
  on conflict (game_day_id, character_id) do nothing
  returning id into v_action_id;
  if v_action_id is null then
    return jsonb_build_object('ok', false, 'error', 'action_already_sent');
  end if;

  insert into public.action_contents (action_id, text, stake)
  values (v_action_id, p_text, p_stake);

  return jsonb_build_object('ok', true, 'action_id', v_action_id);
end;
$$;

comment on function private.submit_action(bigint, bigint, text, bigint) is 'Stores a player''s one action of the day, while the day is open and the stake fits the balance.';

create function private.store_hint(
  p_game_day_id bigint,
  p_character_id bigint,
  p_text text,
  p_censored boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hint public.hints;
begin
  insert into public.hints (game_day_id, character_id, text, censored)
  values (p_game_day_id, p_character_id, p_text, p_censored)
  on conflict (game_day_id, character_id) do nothing;

  select * into v_hint
  from public.hints
  where game_day_id = p_game_day_id and character_id = p_character_id;

  return jsonb_build_object('ok', true, 'text', v_hint.text, 'censored', v_hint.censored);
end;
$$;

comment on function private.store_hint(bigint, bigint, text, boolean) is 'Spends the hint quota. With two requests at once the first one stored wins, and both answer with it.';

create function private.begin_close(p_game_day_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.game_days;
begin
  select * into v_day from public.game_days where id = p_game_day_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_open_day');
  end if;
  if v_day.state = 'published' then
    return jsonb_build_object('ok', true, 'status', 'already_published');
  end if;

  update public.game_days set closed_at = coalesce(closed_at, now()) where id = p_game_day_id;

  insert into public.actions (game_day_id, character_id, origin)
  select p_game_day_id, character.id, 'autopilot'
  from public.characters as character
  where character.season_id = v_day.season_id
  on conflict (game_day_id, character_id) do nothing;

  return jsonb_build_object('ok', true, 'status', 'closing');
end;
$$;

comment on function private.begin_close(bigint) is 'Stops actions and puts absent characters on autopilot. Safe to run again on a retried close.';

create function private.postpone_chapter(p_game_day_id bigint)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  update public.game_days set state = 'postponed' where id = p_game_day_id and state = 'open';
  select jsonb_build_object('ok', true);
$$;

comment on function private.postpone_chapter(bigint) is 'Marks a day whose chapter could not be published. It changes no balance or canon.';

create function private.publish_chapter(
  p_game_day_id bigint,
  p_title text,
  p_body text,
  p_awards jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.game_day_state;
begin
  -- The (season, day) guard: game_days is unique on both, and this lock makes a second run wait and
  -- then find the day published.
  select state into v_state from public.game_days where id = p_game_day_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_open_day');
  end if;
  if v_state = 'published' then
    return jsonb_build_object('ok', true, 'status', 'already_published');
  end if;

  -- Exactly one award in range for each real action of this day, and nothing else.
  if (
    (select count(*) from jsonb_to_recordset(p_awards) as input (action_id bigint, points bigint))
    <> (
      select count(*)
      from public.actions
      where game_day_id = p_game_day_id and origin = 'player' and not struck_out
    )
    or (
      select count(*) <> count(distinct input.action_id)
      from jsonb_to_recordset(p_awards) as input (action_id bigint, points bigint)
    )
    or exists (
      select 1
      from jsonb_to_recordset(p_awards) as input (action_id bigint, points bigint)
      left join public.actions as action
        on action.id = input.action_id
        and action.game_day_id = p_game_day_id
        and action.origin = 'player'
        and not action.struck_out
      where action.id is null or input.points is null or input.points not between -3 and 5
    )
  ) then
    return jsonb_build_object('ok', false, 'error', 'resolution_mismatch');
  end if;

  insert into public.chapters (game_day_id, title, body)
  values (p_game_day_id, p_title, p_body);

  insert into public.awards (action_id, points, kind)
  select input.action_id, input.points, 'narrator'
  from jsonb_to_recordset(p_awards) as input (action_id bigint, points bigint);

  -- Fixed by code: being absent always costs the same, whatever the narrator wrote.
  insert into public.awards (action_id, points, kind)
  select action.id, -1, 'autopilot'
  from public.actions as action
  where action.game_day_id = p_game_day_id and action.origin = 'autopilot';

  update public.characters as character
  set balance = character.balance + movement.points
  from (
    select action.character_id, sum(award.points)::bigint as points
    from public.awards as award
    join public.actions as action on action.id = award.action_id
    where action.game_day_id = p_game_day_id
    group by action.character_id
  ) as movement
  where character.id = movement.character_id;

  update public.game_days
  set state = 'published', published_at = now()
  where id = p_game_day_id;

  return jsonb_build_object('ok', true, 'status', 'published');
end;
$$;

comment on function private.publish_chapter(bigint, text, text, jsonb) is 'Publishes a chapter with its awards and balances as a single step. Running a close twice publishes once.';

-- Envelopes for the Data API.

create function public.create_season(
  p_number bigint,
  p_starts_on date,
  -- Optional for the Data API's sake: the pre-season has no end date, and its client cannot send null.
  p_ends_on date default null,
  p_characters jsonb default '[]'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_season(p_number, p_starts_on, p_ends_on, p_characters); $$;

create function public.open_game_day(p_season_id bigint, p_day date, p_situation text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.open_game_day(p_season_id, p_day, p_situation); $$;

create function public.submit_action(
  p_game_day_id bigint,
  p_character_id bigint,
  p_text text,
  p_stake bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.submit_action(p_game_day_id, p_character_id, p_text, p_stake); $$;

create function public.store_hint(
  p_game_day_id bigint,
  p_character_id bigint,
  p_text text,
  p_censored boolean
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.store_hint(p_game_day_id, p_character_id, p_text, p_censored); $$;

create function public.begin_close(p_game_day_id bigint)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.begin_close(p_game_day_id); $$;

create function public.postpone_chapter(p_game_day_id bigint)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.postpone_chapter(p_game_day_id); $$;

create function public.publish_chapter(
  p_game_day_id bigint,
  p_title text,
  p_body text,
  p_awards jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.publish_chapter(p_game_day_id, p_title, p_body, p_awards); $$;

-- New functions are executable by PUBLIC, and the project's default privileges add the API roles.
do $$
declare
  signature text;
begin
  foreach signature in array array[
    'create_season(bigint, date, date, jsonb)',
    'open_game_day(bigint, date, text)',
    'submit_action(bigint, bigint, text, bigint)',
    'store_hint(bigint, bigint, text, boolean)',
    'begin_close(bigint)',
    'postpone_chapter(bigint)',
    'publish_chapter(bigint, text, text, jsonb)'
  ] loop
    execute format('revoke execute on function private.%s from public, anon, authenticated, service_role', signature);
    execute format('revoke execute on function public.%s from public, anon, authenticated, service_role', signature);
    execute format('grant execute on function private.%s to service_role', signature);
    execute format('grant execute on function public.%s to service_role', signature);
  end loop;
end;
$$;
