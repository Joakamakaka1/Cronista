-- The read-only role of the local MCP server (CR-54): it reads memory and game state, can run the
-- hybrid search, and reaches nothing about the players, their actions, auth or the ledger.
begin;
create extension if not exists pgtap with schema extensions;
-- The game engine's tests leave their seasons in a local database; the rollback brings them back.
truncate public.seasons cascade;

select plan(63);

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
update public.chapters set summary = 'Un faro.' where game_day_id = (select game_day from fixture);
-- Day 1's chapter sends La Farera out.
insert into public.character_statuses (game_day_id, character_id, status)
select fixture.game_day, character.id, 'out'
from fixture, public.characters as character where character.nickname = 'La Farera';

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
      and function.proname not like 'inspect\_%'
      and has_function_privilege('memory_reader', function.oid, 'execute')
  $$,
  'memory_reader runs no other function of public or private, the writing ones included'
);
select bag_eq(
  $$
    select function.proname::text
    from pg_catalog.pg_proc as function
    join pg_catalog.pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'public' and function.proname like 'inspect\_%'
      and has_function_privilege('memory_reader', function.oid, 'execute')
  $$,
  $$ values ('inspect_season'), ('inspect_season_moments'), ('inspect_chapter_summaries'),
    ('inspect_game_state'), ('inspect_chapter') $$,
  'memory_reader runs the five reads of the MCP server'
);
select is_empty(
  $$
    select function.oid, role.rolname
    from pg_catalog.pg_proc as function
    join pg_catalog.pg_namespace as namespace on namespace.oid = function.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as role (rolname)
    where namespace.nspname = 'public' and function.proname like 'inspect\_%'
      and has_function_privilege(role.rolname, function.oid, 'execute')
  $$,
  'only memory_reader runs the reads of the MCP server: no API role does'
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
select is(
  (select (number, last_published, characters)::text from public.inspect_season()),
  '(0,2031-01-01,"{""La Farera"",""El Notario""}")',
  'inspect_season answers the season with the latest chapter, and its nicknames'
);
select is(
  (select count(*) from public.inspect_season_moments((select season from fixture), '2031-01-02')),
  1::bigint,
  'inspect_season_moments answers the moments before a day'
);
select is(
  (select (day, summary, total)::text
   from public.inspect_chapter_summaries((select season from fixture), null, '2031-01-02', 7, 0)),
  '(2031-01-01,"Un faro.",1)',
  'inspect_chapter_summaries answers a page of summaries and how many there are'
);
select ok(
  (select public.inspect_game_state((select season from fixture)) -> 'characters' -> 0)
    @> '{"nickname": "La Farera", "out": true}'::jsonb,
  'inspect_game_state answers the canon, with whom the latest chapter sent out'
);
select is(
  (select title from public.inspect_chapter((select season from fixture), '2031-01-01')),
  'Título',
  'inspect_chapter answers a published chapter'
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

-- -----------------------------------------------------------------------------
-- The reads of the MCP server, on a longer season
-- -----------------------------------------------------------------------------

-- A second published day, which sends nobody out, and a third still open.
create temporary table later on commit drop as
select (public.open_game_day((select season from fixture), '2031-01-02', 'Situación.')
  ->> 'game_day_id')::bigint as game_day;
select public.begin_close(game_day) from later;
select public.publish_chapter(game_day, 'Segundo', 'Cuerpo.', jsonb_build_object(
  'awards', '[]'::jsonb, 'struck_out', '[]'::jsonb, 'charges', '[]'::jsonb, 'new_items', '[]'::jsonb,
  'moved_items', '[]'::jsonb, 'new_debts', '[]'::jsonb, 'paid_debts', '[]'::jsonb,
  'out_characters', '[]'::jsonb
))
from later;
update public.chapters set summary = 'Otro día.' where game_day_id = (select game_day from later);
select public.open_game_day((select season from fixture), '2031-01-03', 'Situación.');

-- One debt still open, one paid on day 2.
insert into public.debts (debtor_character_id, creditor_character_id, points, born_on_day_id, paid_on_day_id)
select farera.id, notario.id, debt.points, fixture.game_day, debt.paid
from fixture, later,
  (select id from public.characters where nickname = 'La Farera') as farera,
  (select id from public.characters where nickname = 'El Notario') as notario,
  lateral (values (2, null::bigint), (3, later.game_day)) as debt (points, paid);

-- Day 2 changes the fact of day 1, which stays superseded.
insert into public.memories (season_id, game_day_id, content, characters, importance, embedding)
select fixture.season, later.game_day, 'La Farera apagó el faro.', '{La Farera}', 3,
  ('[1' || repeat(',0', 1023) || ']')::extensions.halfvec(1024)
from fixture, later;
update public.memories
set superseded_by = (select id from public.memories where content = 'La Farera apagó el faro.')
where content = 'La Farera encendió el faro.';

-- A later season with nothing published yet.
select public.create_season(
  1,
  '2031-02-01',
  '2031-02-28',
  '[{"email": "ana@example.com", "nickname": "La Farera"}, {"email": "bruno@example.com", "nickname": "El Notario"}]'
);

set local role memory_reader;

select is(
  (select (number, last_published)::text from public.inspect_season()),
  '(0,2031-01-02)',
  'inspect_season answers the season with the latest published chapter, not the latest started'
);
select is(
  (select jsonb_agg(character -> 'out' order by character ->> 'nickname')
   from jsonb_array_elements(public.inspect_game_state((select season from fixture)) -> 'characters')
     as character),
  '[false, false]'::jsonb,
  'inspect_game_state brings back whom an earlier chapter sent out, once a later one is published'
);
select is(
  public.inspect_game_state((select season from fixture)) -> 'debts',
  '[{"debtor": "La Farera", "creditor": "El Notario", "points": 2}]'::jsonb,
  'inspect_game_state lists only the open debts'
);
select is(
  (select current from public.inspect_season_moments((select season from fixture), '2031-01-03')
   where text = 'La Farera encendió el faro.'),
  false,
  'inspect_season_moments marks a superseded moment as not current'
);
select is(
  (select count(*) from public.inspect_season_moments((select season from fixture), '2031-01-02')),
  1::bigint,
  'inspect_season_moments leaves out the moments of its own day'
);
select is(
  (select array_agg(day order by day)::text
   from public.inspect_chapter_summaries((select season from fixture), '2031-01-02', '2031-01-03', 7, 0)),
  '{2031-01-02}',
  'inspect_chapter_summaries starts the range at its first day'
);
select is(
  (select (day, total)::text
   from public.inspect_chapter_summaries((select season from fixture), null, '2031-01-03', 1, 1)),
  '(2031-01-02,2)',
  'inspect_chapter_summaries pages by limit and offset, with the whole range''s total'
);
select is(
  (select (day, total)::text
   from public.inspect_chapter_summaries((select season from fixture), null, '2031-01-03', 7, 5)),
  '(,2)',
  'a page past the end still tells the total'
);
select is_empty(
  $$ select * from public.inspect_chapter((select season from fixture), '2031-01-03') $$,
  'inspect_chapter answers nothing for a day not yet published'
);

reset role;

select * from finish();
rollback;
