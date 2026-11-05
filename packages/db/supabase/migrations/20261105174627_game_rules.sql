-- The whole rulebook of ADR-30: charges and canon at publishing, the newspaper's message on a postponed
-- chapter, the finale, the spend alerts and the pre-season's reset.
--
-- Under the pre-season exception of database.md, publish_chapter and postpone_chapter change their
-- signature in place. No season exists in production, so the code deployed until the stacks finish
-- never calls them.

-- Fail instead of queueing behind a held lock. `local` scopes them to this migration's transaction.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------

alter table public.game_days add column newspaper_message text;

comment on column public.game_days.newspaper_message is 'What players read while the chapter is postponed. Publishing clears it.';

comment on table public.character_statuses is 'Who a game day''s chapter sent out: they spend the next game day out and are back after its close. Rows change only when a chapter is published.';

-- Outlives a reset, like the ledger: it counts credit cycles, not seasons.
create table public.spend_alerts (
  workspace text not null,
  cycle_start date not null,
  threshold bigint not null,
  sent_at timestamptz not null default now(),
  primary key (workspace, cycle_start, threshold)
);

comment on table public.spend_alerts is 'Which spend alerts a credit cycle has raised, so that each one goes out once.';

alter table public.spend_alerts enable row level security;
revoke all on table public.spend_alerts from anon, authenticated, service_role;
grant select, insert on table public.spend_alerts to service_role;

-- -----------------------------------------------------------------------------
-- Status
-- -----------------------------------------------------------------------------

create function private.is_out(p_character_id bigint, p_season_id bigint, p_day date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.character_statuses as status
    where status.character_id = p_character_id
      and status.status = 'out'
      and status.game_day_id = (
        select game_day.id
        from public.game_days as game_day
        where game_day.season_id = p_season_id
          and game_day.day < p_day
          and game_day.state = 'published'
        order by game_day.day desc
        limit 1
      )
  );
$$;

comment on function private.is_out(bigint, bigint, date) is 'Whether the latest chapter before this day sent the character out, so that it spends this day out.';

revoke execute on function private.is_out(bigint, bigint, date) from public, anon, authenticated, service_role;

create or replace function private.submit_action(
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

  -- First, so a second action hears that, whatever its stake. The conflict below settles a race.
  if exists (
    select 1 from public.actions where game_day_id = p_game_day_id and character_id = p_character_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'action_already_sent');
  end if;

  -- 0 always passes: a player at zero or below, or out, still plays, declaring nothing.
  if p_stake < 0
    or (
      p_stake > 0
      and (p_stake > v_balance or private.is_out(p_character_id, v_day.season_id, v_day.day))
    )
  then
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

-- -----------------------------------------------------------------------------
-- Postponing and publishing
-- -----------------------------------------------------------------------------

-- squawk-ignore ban-drop-function
drop function public.postpone_chapter(bigint);
-- squawk-ignore ban-drop-function
drop function private.postpone_chapter(bigint);
-- squawk-ignore ban-drop-function
drop function public.publish_chapter(bigint, text, text, jsonb);
-- squawk-ignore ban-drop-function
drop function private.publish_chapter(bigint, text, text, jsonb);

create function private.postpone_chapter(p_game_day_id bigint, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.game_days
  set state = 'postponed', newspaper_message = p_message
  where id = p_game_day_id and state = 'open';
  return jsonb_build_object('ok', true, 'first', found);
end;
$$;

comment on function private.postpone_chapter(bigint, text) is 'Marks a day whose chapter could not be published, with the newspaper''s message. It changes no balance or canon, and says whether this call is the one that postponed it.';

create function private.publish_chapter(
  p_game_day_id bigint,
  p_title text,
  p_body text,
  p_resolution jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.game_days;
  v_ends_on date;
  v_real_actions bigint[];
  v_season_characters bigint[];
  v_input record;
  v_count bigint;
  v_creditor bigint;
  v_points bigint;
begin
  -- The (season, day) guard: game_days is unique on both, and this lock makes a second run wait and
  -- then find the day published.
  select * into v_day from public.game_days where id = p_game_day_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_open_day');
  end if;
  if v_day.state = 'published' then
    return jsonb_build_object('ok', true, 'status', 'already_published');
  end if;
  select ends_on into v_ends_on from public.seasons where id = v_day.season_id;

  -- A block of its own: any violation undoes everything it wrote, and the day stays as it was.
  begin
    if not p_resolution ?& array[
      'awards', 'struck_out', 'charges', 'new_items', 'moved_items', 'new_debts', 'paid_debts', 'out_characters'
    ] then
      raise exception using errcode = 'CRMIS';
    end if;

    -- The close is what puts absent characters on autopilot and stops actions.
    if v_day.closed_at is null then
      raise exception using errcode = 'CRMIS';
    end if;

    select array_agg(id) into v_season_characters
    from public.characters
    where season_id = v_day.season_id;

    update public.actions
    set struck_out = true
    where game_day_id = p_game_day_id
      and origin = 'player'
      and id in (select value::bigint from jsonb_array_elements_text(p_resolution -> 'struck_out'));
    get diagnostics v_count = row_count;
    if v_count <> jsonb_array_length(p_resolution -> 'struck_out') then
      raise exception using errcode = 'CRMIS';
    end if;

    select coalesce(array_agg(id), '{}') into v_real_actions
    from public.actions
    where game_day_id = p_game_day_id and origin = 'player' and not struck_out;

    -- Exactly one award in range for each real action of this day, and nothing else.
    if (
      select count(*) <> cardinality(v_real_actions)
        or count(*) <> count(distinct input.action_id)
        or coalesce(bool_or(
          input.points is null
          or input.points not between -3 and 5
          or not input.action_id = any (v_real_actions)
        ), false)
      from jsonb_to_recordset(p_resolution -> 'awards') as input (action_id bigint, points bigint)
    ) then
      raise exception using errcode = 'CRMIS';
    end if;

    -- Every change comes from a real action of this day. A struck-out action has no outcome, so
    -- nothing can charge it or change canon through it.
    if exists (
      select 1
      from jsonb_array_elements(
        (p_resolution -> 'charges')
        || (p_resolution -> 'new_items')
        || (p_resolution -> 'new_debts')
        || (p_resolution -> 'paid_debts')
        || (p_resolution -> 'moved_items')
        || (p_resolution -> 'out_characters')
      ) as change
      where not coalesce((change ->> 'action_id')::bigint = any (v_real_actions), false)
    ) then
      raise exception using errcode = 'CRMIS';
    end if;

    insert into public.chapters (game_day_id, title, body)
    values (p_game_day_id, p_title, p_body);

    insert into public.awards (action_id, points, kind)
    select input.action_id, input.points, 'narrator'
    from jsonb_to_recordset(p_resolution -> 'awards') as input (action_id bigint, points bigint);

    -- Fixed by code: being absent always costs the same, whatever the narrator wrote.
    insert into public.awards (action_id, points, kind)
    select action.id, -1, 'autopilot'
    from public.actions as action
    where action.game_day_id = p_game_day_id and action.origin = 'autopilot';

    -- Also fixed by code, and the stake returns because nothing charges it.
    insert into public.awards (action_id, points, kind)
    select action.id, -2, 'comic_penalty'
    from public.actions as action
    where action.game_day_id = p_game_day_id and action.struck_out;

    -- Influence and payments. Buying an item and paying a debt charge below, from what they are.
    for v_input in
      select input.*, action.character_id
      from jsonb_to_recordset(p_resolution -> 'charges')
        as input (action_id bigint, points bigint, purpose text, recipient_character_id bigint)
      join public.actions as action on action.id = input.action_id
    loop
      if v_input.purpose not in ('influence', 'payment')
        or (
          v_input.recipient_character_id is not null
          and (
            not v_input.recipient_character_id = any (v_season_characters)
            or v_input.recipient_character_id = v_input.character_id
          )
        )
      then
        raise exception using errcode = 'CRMIS';
      end if;
      insert into public.charges (action_id, points, purpose, recipient_character_id)
      values (
        v_input.action_id,
        v_input.points,
        v_input.purpose::public.charge_purpose,
        v_input.recipient_character_id
      );
    end loop;

    -- A new item needs a charge, and goes to whoever paid it.
    for v_input in
      select input.*, action.character_id
      from jsonb_to_recordset(p_resolution -> 'new_items')
        as input (action_id bigint, name text, price bigint)
      join public.actions as action on action.id = input.action_id
    loop
      -- It stays in every later prompt, so it cannot hold a paragraph or lines of its own.
      if char_length(v_input.name) > 60 or v_input.name ~ '[[:cntrl:]\u2028\u2029]' then
        raise exception using errcode = 'CRMIS';
      end if;
      insert into public.items (season_id, name, owner_character_id, acquired_on_day_id)
      values (v_day.season_id, v_input.name, v_input.character_id, p_game_day_id);
      insert into public.charges (action_id, points, purpose)
      values (v_input.action_id, v_input.price, 'item');
    end loop;

    -- In order, and only from its current owner.
    for v_input in
      select input.*
      from jsonb_array_elements(p_resolution -> 'moved_items') with ordinality as moved (value, position)
      cross join lateral jsonb_to_record(moved.value)
        as input (action_id bigint, name text, from_character_id bigint, to_character_id bigint)
      order by moved.position
    loop
      if not v_input.to_character_id = any (v_season_characters) then
        raise exception using errcode = 'CRMIS';
      end if;
      update public.items
      set owner_character_id = v_input.to_character_id
      where season_id = v_day.season_id
        and name = v_input.name
        and owner_character_id = v_input.from_character_id;
      if not found then
        raise exception using errcode = 'CRMIS';
      end if;
    end loop;

    -- The debtor comes from the action, and one action takes on one debt at most.
    if exists (
      select 1
      from jsonb_to_recordset(p_resolution -> 'new_debts') as input (action_id bigint)
      group by input.action_id
      having count(*) > 1
    ) then
      raise exception using errcode = 'CRMIS';
    end if;
    for v_input in
      select input.*, action.character_id
      from jsonb_to_recordset(p_resolution -> 'new_debts')
        as input (action_id bigint, creditor_character_id bigint, points bigint)
      join public.actions as action on action.id = input.action_id
    loop
      if not v_input.creditor_character_id = any (v_season_characters) then
        raise exception using errcode = 'CRMIS';
      end if;
      insert into public.debts (debtor_character_id, creditor_character_id, points, born_on_day_id)
      values (v_input.character_id, v_input.creditor_character_id, v_input.points, p_game_day_id);
    end loop;

    -- Whole, from the debtor's own stake, and the charge goes to the creditor.
    for v_input in
      select input.*, action.character_id
      from jsonb_to_recordset(p_resolution -> 'paid_debts') as input (action_id bigint, debt_id bigint)
      join public.actions as action on action.id = input.action_id
    loop
      update public.debts
      set paid_on_day_id = p_game_day_id
      where id = v_input.debt_id
        and debtor_character_id = v_input.character_id
        and paid_on_day_id is null
      returning creditor_character_id, points into v_creditor, v_points;
      if not found then
        raise exception using errcode = 'CRMIS';
      end if;
      insert into public.charges (action_id, points, purpose, recipient_character_id)
      values (v_input.action_id, v_points, 'payment', v_creditor);
    end loop;

    -- The narrator charges at most the stake, and the rest returns.
    if exists (
      select 1
      from public.charges as charge
      join public.actions as action on action.id = charge.action_id
      join public.action_contents as content on content.action_id = charge.action_id
      where action.game_day_id = p_game_day_id
      group by charge.action_id, content.stake
      having sum(charge.points) > content.stake
    ) then
      raise exception using errcode = 'CRMIS';
    end if;

    -- Nobody is out two days in a row.
    for v_input in
      select input.character_id
      from jsonb_to_recordset(p_resolution -> 'out_characters')
        as input (action_id bigint, character_id bigint)
    loop
      if not v_input.character_id = any (v_season_characters)
        or private.is_out(v_input.character_id, v_day.season_id, v_day.day)
      then
        raise exception using errcode = 'CRMIS';
      end if;
      insert into public.character_statuses (game_day_id, character_id, status)
      values (p_game_day_id, v_input.character_id, 'out');
    end loop;

    update public.characters as character
    set balance = character.balance + movement.points
    from (
      select moved.character_id, sum(moved.points)::bigint as points
      from (
        select action.character_id, award.points
        from public.awards as award
        join public.actions as action on action.id = award.action_id
        where action.game_day_id = p_game_day_id
        union all
        select action.character_id, -charge.points
        from public.charges as charge
        join public.actions as action on action.id = charge.action_id
        where action.game_day_id = p_game_day_id
        union all
        select charge.recipient_character_id, charge.points
        from public.charges as charge
        join public.actions as action on action.id = charge.action_id
        where action.game_day_id = p_game_day_id and charge.recipient_character_id is not null
      ) as moved
      group by moved.character_id
    ) as movement
    where character.id = movement.character_id;

    -- The finale: open debts move from debtor to creditor, and the highest balance wins. The pre-season
    -- has no end date, so it never gets here.
    if v_day.day = v_ends_on then
      update public.characters as character
      set balance = character.balance + movement.points
      from (
        select moved.character_id, sum(moved.points)::bigint as points
        from (
          select debt.debtor_character_id as character_id, -debt.points as points
          from public.debts as debt
          where debt.paid_on_day_id is null and debt.debtor_character_id = any (v_season_characters)
          union all
          select debt.creditor_character_id, debt.points
          from public.debts as debt
          where debt.paid_on_day_id is null and debt.debtor_character_id = any (v_season_characters)
        ) as moved
        group by moved.character_id
      ) as movement
      where character.id = movement.character_id;

      update public.debts
      set paid_on_day_id = p_game_day_id
      where paid_on_day_id is null and debtor_character_id = any (v_season_characters);
    end if;

    update public.game_days
    set state = 'published', published_at = now(), newspaper_message = null
    where id = p_game_day_id;
  exception
    when sqlstate 'CRMIS'
      or check_violation
      or unique_violation
      or not_null_violation
      or foreign_key_violation
      or invalid_text_representation
    then
      return jsonb_build_object('ok', false, 'error', 'resolution_mismatch');
  end;

  return jsonb_build_object('ok', true, 'status', 'published');
end;
$$;

comment on function private.publish_chapter(bigint, text, text, jsonb) is 'Publishes a chapter with its awards, charges, canon and balances as a single step, and the finale''s count on a season''s last day. Running a close twice publishes once.';

create function public.postpone_chapter(p_game_day_id bigint, p_message text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.postpone_chapter(p_game_day_id, p_message); $$;

create function public.publish_chapter(
  p_game_day_id bigint,
  p_title text,
  p_body text,
  p_resolution jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.publish_chapter(p_game_day_id, p_title, p_body, p_resolution); $$;

-- New functions are executable by PUBLIC, and the project's default privileges add the API roles.
do $$
declare
  signature text;
begin
  foreach signature in array array[
    'postpone_chapter(bigint, text)',
    'publish_chapter(bigint, text, text, jsonb)'
  ] loop
    execute format('revoke execute on function private.%s from public, anon, authenticated, service_role', signature);
    execute format('revoke execute on function public.%s from public, anon, authenticated, service_role', signature);
    execute format('grant execute on function private.%s to service_role', signature);
    execute format('grant execute on function public.%s to service_role', signature);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- The spend ledger
-- -----------------------------------------------------------------------------

create function public.spend_by_workspace(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(spend.workspace, spend.total), '{}'::jsonb)
  from (
    select workspace, sum(cost_usd) as total
    from public.ai_usage
    where created_at >= p_since
    group by workspace
  ) as spend;
$$;

comment on function public.spend_by_workspace(timestamptz) is 'The dollars each workspace has spent since a credit cycle started.';

revoke execute on function public.spend_by_workspace(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.spend_by_workspace(timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- The reset
-- -----------------------------------------------------------------------------

-- No envelope in public and no grant: only the owner runs it, by hand, from the SQL editor.
create function private.reset_preseason()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season_id bigint;
begin
  if exists (
    select 1
    from public.seasons
    where number >= 1 and starts_on <= (now() at time zone 'Europe/Madrid')::date
  ) then
    return jsonb_build_object('ok', false, 'error', 'season_started');
  end if;

  select id into v_season_id from public.seasons where number = 0;
  if not found then
    return jsonb_build_object('ok', true, 'status', 'nothing_to_reset');
  end if;

  delete from public.charges as charge
  using public.actions as action, public.game_days as game_day
  where action.id = charge.action_id
    and game_day.id = action.game_day_id
    and game_day.season_id = v_season_id;

  delete from public.awards as award
  using public.actions as action, public.game_days as game_day
  where action.id = award.action_id
    and game_day.id = action.game_day_id
    and game_day.season_id = v_season_id;

  delete from public.action_contents as content
  using public.actions as action, public.game_days as game_day
  where action.id = content.action_id
    and game_day.id = action.game_day_id
    and game_day.season_id = v_season_id;

  delete from public.actions as action
  using public.game_days as game_day
  where game_day.id = action.game_day_id and game_day.season_id = v_season_id;

  delete from public.hints as hint
  using public.game_days as game_day
  where game_day.id = hint.game_day_id and game_day.season_id = v_season_id;

  delete from public.chapters as chapter
  using public.game_days as game_day
  where game_day.id = chapter.game_day_id and game_day.season_id = v_season_id;

  delete from public.character_statuses as status
  using public.game_days as game_day
  where game_day.id = status.game_day_id and game_day.season_id = v_season_id;

  delete from public.items where season_id = v_season_id;

  delete from public.debts as debt
  using public.characters as character
  where character.id = debt.debtor_character_id and character.season_id = v_season_id;

  delete from public.game_days where season_id = v_season_id;

  update public.characters set balance = 10 where season_id = v_season_id;

  return jsonb_build_object('ok', true, 'status', 'reset');
end;
$$;

comment on function private.reset_preseason() is 'Removes the pre-season''s days, actions, chapters, canon and quotas and returns its balances to 10, keeping its characters, the players and the ledger. It refuses once season 1 has started.';

revoke execute on function private.reset_preseason() from public, anon, authenticated, service_role;
