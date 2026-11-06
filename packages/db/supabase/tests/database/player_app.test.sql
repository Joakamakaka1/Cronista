-- What the player app reads: the moved items publish_chapter records, who can read them, and the
-- tables whose changes reach the app as live events.
begin;
create extension if not exists pgtap with schema extensions;
-- The game engine's tests leave their seasons in a local database; the rollback brings them back.
truncate public.seasons cascade;

select plan(16);

insert into public.players (email)
values ('ana@example.com'), ('bruno@example.com');

insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com', now());

create function pg_temp.resolution(p_changes jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'awards', '[]'::jsonb, 'struck_out', '[]'::jsonb, 'charges', '[]'::jsonb, 'new_items', '[]'::jsonb,
    'moved_items', '[]'::jsonb, 'new_debts', '[]'::jsonb, 'paid_debts', '[]'::jsonb,
    'out_characters', '[]'::jsonb
  ) || p_changes;
$$;

-- The pre-season, so the reset at the end can run.
select public.create_season(
  0,
  '2031-01-01',
  null,
  '[{"email": "ana@example.com", "nickname": "A"}, {"email": "bruno@example.com", "nickname": "B"}]'
);

create temporary table who on commit drop as
select
  (select id from public.seasons where number = 0) as season_id,
  (select id from public.characters where nickname = 'A') as ana,
  (select id from public.characters where nickname = 'B') as bruno;

-- Day one: Ana buys a box.
create temporary table day_one on commit drop as
select (public.open_game_day((select season_id from who), '2031-01-01', 'Lunes.') ->> 'game_day_id')::bigint as id;
create temporary table day_one_action on commit drop as
select (public.submit_action((select id from day_one), (select ana from who), 'Compro.', 2) ->> 'action_id')::bigint as ana;
select public.begin_close((select id from day_one));
select public.publish_chapter(
  (select id from day_one),
  'Lunes',
  'Pasó.',
  pg_temp.resolution(jsonb_build_object(
    'awards', jsonb_build_array(jsonb_build_object('action_id', (select ana from day_one_action), 'points', 0)),
    'new_items', jsonb_build_array(jsonb_build_object(
      'action_id', (select ana from day_one_action), 'name', 'Caja', 'price', 1
    ))
  ))
);

-- Day two: Bruno steals it.
create temporary table day_two on commit drop as
select (public.open_game_day((select season_id from who), '2031-01-02', 'Martes.') ->> 'game_day_id')::bigint as id;
create temporary table day_two_action on commit drop as
select (public.submit_action((select id from day_two), (select bruno from who), 'Robo la caja.', 0) ->> 'action_id')::bigint as bruno;
select public.begin_close((select id from day_two));

create function pg_temp.publish_two(p_from bigint)
returns jsonb
language sql
as $$
  select public.publish_chapter(
    (select id from day_two),
    'Martes',
    'Pasó.',
    pg_temp.resolution(jsonb_build_object(
      'awards', jsonb_build_array(jsonb_build_object('action_id', (select bruno from day_two_action), 'points', 1)),
      'moved_items', jsonb_build_array(jsonb_build_object(
        'action_id', (select bruno from day_two_action), 'name', 'Caja',
        'from_character_id', p_from, 'to_character_id', (select bruno from who)
      ))
    ))
  );
$$;

-- -----------------------------------------------------------------------------
-- Publishing records the moves
-- -----------------------------------------------------------------------------

select is(
  (select count(*) from public.item_moves),
  0::bigint,
  'buying an item is not a move'
);
select is(
  pg_temp.publish_two((select bruno from who)),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a move from someone who does not own the item is rejected'
);
select is(
  (select count(*) from public.item_moves),
  0::bigint,
  'a rejected chapter records no move'
);
select is(
  pg_temp.publish_two((select ana from who)) ->> 'status',
  'published',
  'a theft publishes'
);
select results_eq(
  $$
    select move.game_day_id, move.action_id, move.from_character_id, move.to_character_id, item.name
    from public.item_moves as move
    join public.items as item on item.id = move.item_id
  $$,
  $$
    select (select id from day_two), (select bruno from day_two_action), ana, bruno, 'Caja'::text
    from who
  $$,
  'the move names its day, its action and both owners'
);
select is(
  pg_temp.publish_two((select ana from who)) ->> 'status',
  'already_published',
  'running the close again records nothing more'
);
select is((select count(*) from public.item_moves), 1::bigint, 'one move, once');

-- -----------------------------------------------------------------------------
-- Who reads them
-- -----------------------------------------------------------------------------

select table_privs_are('public', 'item_moves', 'anon', array[]::text[], 'anon has no privileges on item_moves');
select table_privs_are('public', 'item_moves', 'authenticated', array['SELECT'], 'players only read item_moves');
select table_privs_are('public', 'item_moves', 'service_role', array['SELECT'], 'the Lambdas only read item_moves');

grant select on who to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);
select is((select count(*) from public.item_moves), 1::bigint, 'a player reads the moves');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);
select is((select count(*) from public.item_moves), 0::bigint, 'someone off the list reads none');

reset role;
set local role anon;
select throws_ok($$ select * from public.item_moves $$, '42501', null, 'anon cannot read the moves');
reset role;

-- -----------------------------------------------------------------------------
-- Live events
-- -----------------------------------------------------------------------------

select is(
  (
    select array_agg(tablename::text order by tablename::text)
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
  ),
  array['actions', 'chapters', 'game_days'],
  'live events carry days, actions and chapters, and no table with text a player cannot see'
);

-- -----------------------------------------------------------------------------
-- The reset
-- -----------------------------------------------------------------------------

select is(
  private.reset_preseason(),
  '{"ok": true, "status": "reset"}'::jsonb,
  'the pre-season resets with moved items'
);
select is((select count(*) from public.item_moves), 0::bigint, 'the reset removes the moves');

select * from finish();
rollback;
