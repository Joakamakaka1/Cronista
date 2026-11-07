-- What the second design of the player app reads (CR-58): when each action was sent, for the
-- "who has played" notices, and the chapter's pull quote, which the narrator copies from the body.
--
-- Under the pre-season exception of database.md, publish_chapter is dropped and recreated with one more
-- argument, the pull quote, defaulting to null; the old signature goes in the same step, so no caller
-- can reach a function that ignores the quote.

-- Fail instead of queueing behind a held lock. `local` scopes them to this migration's transaction.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- -----------------------------------------------------------------------------
-- When each action was sent
-- -----------------------------------------------------------------------------

-- now() is stable, so the existing rows take the migration's time without a rewrite.
alter table public.actions add column created_at timestamptz not null default now();

comment on column public.actions.created_at is 'When the action was stored. Every player reads it with the row: "X played at 16:42", never what or how much.';

-- -----------------------------------------------------------------------------
-- The pull quote
-- -----------------------------------------------------------------------------

alter table public.chapters
  add column pull_quote text
  constraint chapters_pull_quote_is_one_short_line check (
    char_length(pull_quote) between 1 and 160 and pull_quote !~ '[[:cntrl:]\u2028\u2029]'
  );

comment on column public.chapters.pull_quote is 'A line the narrator copied word for word from the body, shown set apart in the chapter. Null when it wrote none that matches.';

-- -----------------------------------------------------------------------------
-- Publishing stores the pull quote
-- -----------------------------------------------------------------------------

-- squawk-ignore ban-drop-function
drop function public.publish_chapter(bigint, text, text, jsonb);
-- squawk-ignore ban-drop-function
drop function private.publish_chapter(bigint, text, text, jsonb);

create function private.publish_chapter(
  p_game_day_id bigint,
  p_title text,
  p_body text,
  p_resolution jsonb,
  p_pull_quote text default null
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
  v_item_id bigint;
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

    insert into public.chapters (game_day_id, title, body, pull_quote)
    values (p_game_day_id, p_title, p_body, p_pull_quote);

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
        and owner_character_id = v_input.from_character_id
      returning id into v_item_id;
      if not found then
        raise exception using errcode = 'CRMIS';
      end if;
      insert into public.item_moves (item_id, game_day_id, action_id, from_character_id, to_character_id)
      values (v_item_id, p_game_day_id, v_input.action_id, v_input.from_character_id, v_input.to_character_id);
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

comment on function private.publish_chapter(bigint, text, text, jsonb, text) is 'Publishes a chapter with its pull quote, awards, charges, canon and balances as a single step, and the finale''s count on a season''s last day. Running a close twice publishes once.';

create function public.publish_chapter(
  p_game_day_id bigint,
  p_title text,
  p_body text,
  p_resolution jsonb,
  p_pull_quote text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.publish_chapter(p_game_day_id, p_title, p_body, p_resolution, p_pull_quote); $$;

-- New functions are executable by PUBLIC, and the project's default privileges add the API roles.
revoke execute on function private.publish_chapter(bigint, text, text, jsonb, text) from public, anon, authenticated, service_role;
revoke execute on function public.publish_chapter(bigint, text, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function private.publish_chapter(bigint, text, text, jsonb, text) to service_role;
grant execute on function public.publish_chapter(bigint, text, text, jsonb, text) to service_role;
