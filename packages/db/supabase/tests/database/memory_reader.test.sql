-- The read-only role of the local MCP server (CR-54): it reads memory and game state, can run the
-- hybrid search, and reaches nothing about the players, their actions, auth or the ledger.
begin;
create extension if not exists pgtap with schema extensions;
-- The game engine's tests leave their seasons in a local database; the rollback brings them back.
truncate public.seasons cascade;

select plan(47);

insert into public.players (email)
values ('ana@example.com'), ('bruno@example.com');

select public.create_season(
  0,
  '2031-01-01',
  null,
  '[{"email": "ana@example.com", "nickname": "La Farera"}, {"email": "bruno@example.com", "nickname": "El Notario"}]'
);

create temporary table fixture on commit drop as
select
  (select id from public.seasons where number = 0) as season,
  (public.open_game_day(
    (select id from public.seasons where number = 0), '2031-01-01', 'Situación.'
  ) ->> 'game_day_id')::bigint as game_day;

insert into public.memories (season_id, game_day_id, content, characters, importance, embedding)
select fixture.season, fixture.game_day, 'La Farera encendió el faro.', '{La Farera}', 3,
  ('[1' || repeat(',0', 1023) || ']')::extensions.halfvec(1024)
from fixture;

-- A published chapter, which the inspection reads whole.
select public.begin_close(game_day) from fixture;
select public.publish_chapter(game_day, 'Título', 'Cuerpo.', jsonb_build_object(
  'awards', '[]'::jsonb, 'struck_out', '[]'::jsonb, 'charges', '[]'::jsonb, 'new_items', '[]'::jsonb,
  'moved_items', '[]'::jsonb, 'new_debts', '[]'::jsonb, 'paid_debts', '[]'::jsonb,
  'out_characters', '[]'::jsonb
))
from fixture;

grant select on fixture to memory_reader;

-- -----------------------------------------------------------------------------
-- The role
-- -----------------------------------------------------------------------------

select ok(
  exists (select from pg_catalog.pg_roles where rolname = 'memory_reader' and not rolcanlogin),
  'memory_reader exists without a login: the owner gives it one by hand in production'
);
select ok(
  not exists (
    select from pg_catalog.pg_roles
    where rolname = 'memory_reader' and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb)
  ),
  'memory_reader has no superuser, RLS bypass or role and database creation'
);
select ok(
  exists (
    select from pg_catalog.pg_db_role_setting
    where setrole = 'memory_reader'::regrole
      and setdatabase = 0
      and 'default_transaction_read_only=on' = any (setconfig)
  ),
  'a session that logs in as memory_reader is read-only'
);

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

select table_privs_are('public', table_name, 'memory_reader', array['SELECT'],
  format('memory_reader only reads public.%s', table_name))
from unnest(array[
  'seasons', 'game_days', 'chapters', 'memories', 'chapter_chunks', 'items', 'debts',
  'character_statuses'
]) as table_name;

select table_privs_are('public', table_name, 'memory_reader', array[]::text[],
  format('memory_reader cannot touch public.%s', table_name))
from unnest(array[
  'players', 'actions', 'action_contents', 'hints', 'ai_usage', 'spend_alerts',
  'push_subscriptions', 'awards', 'charges', 'item_moves'
]) as table_name;

select column_privs_are('public', 'characters', 'nickname', 'memory_reader', array['SELECT'],
  'memory_reader reads a character''s nickname');
select column_privs_are('public', 'characters', 'player_id', 'memory_reader', array[]::text[],
  'memory_reader cannot tell which player a character is');
select ok(not has_schema_privilege('memory_reader', 'auth', 'usage'),
  'memory_reader cannot reach the auth schema');
select function_privs_are('public', 'hybrid_search',
  array['bigint', 'text', 'extensions.halfvec', 'integer', 'public.memory_source', 'date[]', 'integer'],
  'memory_reader', array['EXECUTE'], 'memory_reader can run the hybrid search');
select is_empty(
  $$
    select function.oid
    from pg_catalog.pg_proc as function
    join pg_catalog.pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname in ('public', 'private')
      and function.proname <> 'hybrid_search'
      and has_function_privilege('memory_reader', function.oid, 'execute')
  $$,
  'memory_reader runs no other function of public or private, the writing ones included'
);
select policy_roles_are('public', table_name, table_name || '_memory_reader_select',
  array['memory_reader'], format('memory_reader reads public.%s through a policy of its own', table_name))
from unnest(array[
  'seasons', 'game_days', 'chapters', 'memories', 'chapter_chunks', 'items', 'debts',
  'character_statuses', 'characters'
]) as table_name;

-- -----------------------------------------------------------------------------
-- What it reads, as memory_reader
-- -----------------------------------------------------------------------------

set local role memory_reader;

select is((select content from public.memories), 'La Farera encendió el faro.',
  'memory_reader reads the moments, through RLS');
select is((select nickname from public.characters order by id limit 1), 'La Farera',
  'memory_reader reads the nicknames');
select is((select count(*) from public.seasons), 1::bigint, 'memory_reader reads the seasons');
select is((select state::text from public.game_days), 'published',
  'memory_reader reads the game days');
select is((select title from public.chapters), 'Título', 'memory_reader reads a published chapter');
select is(
  (select count(*) from public.hybrid_search(
    (select season from fixture), 'faro', ('[1' || repeat(',0', 1023) || ']')::extensions.halfvec(1024)
  )),
  1::bigint,
  'memory_reader runs the hybrid search'
);
select throws_ok('select count(*) from public.players', '42501', null,
  'memory_reader cannot read the players');
select throws_ok('select player_id from public.characters', '42501', null,
  'memory_reader cannot read whose a character is');
select throws_ok('select count(*) from auth.users', '42501', null,
  'memory_reader cannot read auth');
select throws_ok('select count(*) from public.action_contents', '42501', null,
  'memory_reader cannot read what the players wrote today');
select throws_ok(
  $$ update public.memories set content = 'Otra cosa.' $$, '42501', null,
  'memory_reader cannot change a moment'
);
select throws_ok(
  $$ select public.publish_chapter((select game_day from fixture), 'T', 'C', '{}'::jsonb) $$,
  '42501', null,
  'memory_reader cannot run the functions that write'
);

reset role;

select * from finish();
rollback;
