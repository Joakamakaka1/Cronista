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
