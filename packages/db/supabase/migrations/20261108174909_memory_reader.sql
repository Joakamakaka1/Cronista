-- The role the owner's local MCP server reads with (CR-54): the narrator's memory and the game's
-- state, read-only, and nothing about who the players are. It has no login here; the owner gives it
-- one by hand in production, and the password never enters the repository.
--
-- An expand step: a new role, grants and policies; no table changes.

-- Fail instead of queueing behind a held lock. `local` scopes them to this migration's transaction.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Roles belong to the cluster, not the database, so a local reset finds it already there.
do $$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'memory_reader') then
    create role memory_reader nologin noinherit;
  end if;
end;
$$;

comment on role memory_reader is 'Reads memory and game state for the local MCP server. Never players, auth, actions or the ledger.';

-- Locally the MCP server connects as postgres and switches to this role, so it is held to the same
-- grants as in production. Without inheritance postgres gains nothing from it.
grant memory_reader to postgres with inherit false, set true;

-- Whatever connects as it reads, even if a query tried to write.
alter role memory_reader set default_transaction_read_only = on;
alter role memory_reader set statement_timeout = '10s';

-- `private` holds the text search configuration that `hybrid_search` uses; its functions stay
-- revoked from PUBLIC, so usage alone runs none of them.
grant usage on schema public, extensions, private to memory_reader;

grant select on table
  public.seasons,
  public.game_days,
  public.chapters,
  public.memories,
  public.chapter_chunks,
  public.items,
  public.debts,
  public.character_statuses
to memory_reader;

-- A character's player is who the player is: that column stays out.
grant select (id, season_id, nickname, balance) on table public.characters to memory_reader;

grant execute on function public.hybrid_search(
  bigint, text, extensions.halfvec, integer, public.memory_source, date[], integer
) to memory_reader;

-- Every row of these tables is game state, the same for every reader.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'seasons', 'game_days', 'chapters', 'memories', 'chapter_chunks', 'items', 'debts',
    'character_statuses', 'characters'
  ] loop
    execute format(
      'create policy %I on public.%I for select to memory_reader using (true)',
      table_name || '_memory_reader_select',
      table_name
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- What the MCP server reads
-- -----------------------------------------------------------------------------

-- Security invoker: the role's grants and policies above still decide what each one returns.

create function public.inspect_season()
returns table (id bigint, number bigint, last_published date, characters text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select season.id, season.number,
    max(game_day.day) filter (where game_day.state = 'published') as last_published,
    array(
      select character.nickname
      from public.characters as character
      where character.season_id = season.id
      order by character.id
    ) as characters
  from public.seasons as season
  left join public.game_days as game_day on game_day.season_id = season.id
  group by season.id
  order by last_published desc nulls last, season.starts_on desc
  limit 1;
$$;

comment on function public.inspect_season() is 'The season with the latest published chapter, or the latest started when none has one, with its nicknames.';

create function public.inspect_season_moments(p_season_id bigint, p_before date)
returns table (
  id bigint,
  day date,
  text text,
  characters text[],
  joke text,
  importance bigint,
  current boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select memory.id, game_day.day, memory.content, memory.characters, memory.joke,
    memory.importance, memory.superseded_by is null
  from public.memories as memory
  join public.game_days as game_day on game_day.id = memory.game_day_id
  where memory.season_id = p_season_id and game_day.day < p_before
  order by memory.id;
$$;

comment on function public.inspect_season_moments(bigint, date) is 'Every moment of a season before a day, current or superseded, without its embedding.';

create function public.inspect_chapter_summaries(
  p_season_id bigint,
  p_from date,
  p_before date,
  p_limit integer,
  p_offset integer
)
returns table (day date, summary text, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with in_range as (
    select game_day.day, chapter.summary
    from public.game_days as game_day
    join public.chapters as chapter on chapter.game_day_id = game_day.id
    where game_day.season_id = p_season_id
      and game_day.state = 'published'
      and game_day.day < p_before
      and (p_from is null or game_day.day >= p_from)
      and chapter.summary is not null
  ),
  page as (
    select in_range.day, in_range.summary
    from in_range
    order by in_range.day
    limit p_limit offset p_offset
  )
  -- The total stands apart from the page, so a page past the end still tells it.
  select page.day, page.summary, total.count
  from (select count(*) from in_range) as total
  left join page on true
  order by page.day;
$$;

comment on function public.inspect_chapter_summaries(bigint, date, date, integer, integer) is 'A page of a season''s published summaries in a range of days, oldest first, with how many the range holds.';

create function public.inspect_game_state(p_season_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'season', (
      select jsonb_build_object('number', season.number, 'starts_on', season.starts_on, 'ends_on', season.ends_on)
      from public.seasons as season
      where season.id = p_season_id
    ),
    -- Out when the latest published chapter sent it out, as `private.is_out` reads it.
    'characters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nickname', character.nickname,
        'balance', character.balance,
        'out', coalesce(status.status = 'out', false)
      ) order by character.id)
      from public.characters as character
      left join public.character_statuses as status
        on status.character_id = character.id
        and status.game_day_id = (
          select game_day.id
          from public.game_days as game_day
          where game_day.season_id = p_season_id and game_day.state = 'published'
          order by game_day.day desc
          limit 1
        )
      where character.season_id = p_season_id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('name', item.name, 'owner', owner.nickname) order by item.id)
      from public.items as item
      join public.characters as owner on owner.id = item.owner_character_id
      where item.season_id = p_season_id
    ), '[]'::jsonb),
    'debts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'debtor', debtor.nickname, 'creditor', creditor.nickname, 'points', debt.points
      ) order by debt.id)
      from public.debts as debt
      join public.characters as debtor on debtor.id = debt.debtor_character_id
      join public.characters as creditor on creditor.id = debt.creditor_character_id
      where debtor.season_id = p_season_id and debt.paid_on_day_id is null
    ), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', latest.day, 'state', latest.state) order by latest.day desc)
      from (
        select game_day.day, game_day.state
        from public.game_days as game_day
        where game_day.season_id = p_season_id
        order by game_day.day desc
        limit 14
      ) as latest
    ), '[]'::jsonb)
  );
$$;

comment on function public.inspect_game_state(bigint) is 'A season''s canon for inspection: balances and who is out, items, open debts and its latest 14 days.';

create function public.inspect_chapter(p_season_id bigint, p_day date)
returns table (day date, title text, body text, summary text)
language sql
stable
security invoker
set search_path = ''
as $$
  select game_day.day, chapter.title, chapter.body, chapter.summary
  from public.game_days as game_day
  join public.chapters as chapter on chapter.game_day_id = game_day.id
  where game_day.season_id = p_season_id
    and game_day.day = p_day
    and game_day.state = 'published';
$$;

comment on function public.inspect_chapter(bigint, date) is 'The chapter published on a day of a season, whole.';

-- New functions are executable by PUBLIC, and the project's default privileges add the API roles.
do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.inspect_season()',
    'public.inspect_season_moments(bigint, date)',
    'public.inspect_chapter_summaries(bigint, date, date, integer, integer)',
    'public.inspect_game_state(bigint)',
    'public.inspect_chapter(bigint, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', signature);
    execute format('grant execute on function %s to memory_reader', signature);
  end loop;
end;
$$;
