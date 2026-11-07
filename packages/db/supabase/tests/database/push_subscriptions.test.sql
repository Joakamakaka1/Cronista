-- Push subscriptions (CR-55): each player reads and changes only their own, only push services are
-- accepted, push_recipients answers who gets each push, and the pre-season's reset keeps them.
begin;
create extension if not exists pgtap with schema extensions;
-- The game engine's tests leave their seasons in a local database; the rollback brings them back.
truncate public.seasons cascade;
truncate public.push_subscriptions;

select plan(35);

insert into public.players (email)
values ('ana@example.com'), ('bruno@example.com');

insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now()),
  ('00000000-0000-0000-0000-00000000000b', 'bruno@example.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com', now());

select public.create_season(
  0,
  '2031-01-01',
  null,
  '[{"email": "ana@example.com", "nickname": "La Farera"}, {"email": "bruno@example.com", "nickname": "El Notario"}]'
);

create temporary table fixture on commit drop as
select
  (select id from public.players where email = 'ana@example.com') as ana_player,
  (select id from public.characters where nickname = 'La Farera') as ana,
  (select id from public.characters where nickname = 'El Notario') as bruno,
  repeat('a', 87) as p256dh,
  repeat('b', 22) as auth;

grant select on fixture to authenticated, anon, service_role;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

select table_privs_are('public', 'push_subscriptions', 'anon', array[]::text[], 'anon has no privileges on push subscriptions');
select table_privs_are(
  'public', 'push_subscriptions', 'authenticated', array['SELECT', 'DELETE'],
  'players read and delete theirs, and insert only through the granted columns'
);
select column_privs_are(
  'public', 'push_subscriptions', 'player_id', 'authenticated', array['SELECT'],
  'a player cannot name whose subscription it is'
);
select table_privs_are(
  'public', 'push_subscriptions', 'service_role', array['SELECT', 'DELETE'],
  'the notifier reads them and removes the gone ones'
);
select function_privs_are(
  'public', 'push_recipients', array['date', 'boolean', 'bigint'], 'authenticated', array[]::text[],
  'players cannot ask who gets a push'
);
select function_privs_are(
  'public', 'push_recipients', array['date', 'boolean', 'bigint'], 'anon', array[]::text[],
  'anon cannot ask who gets a push'
);
select function_privs_are(
  'public', 'push_recipients', array['date', 'boolean', 'bigint'], 'service_role', array['EXECUTE'],
  'the notifier asks who gets a push'
);

-- -----------------------------------------------------------------------------
-- A player's own subscriptions
-- -----------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);

select lives_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
     select 'https://web.push.apple.com/ana-iphone', p256dh, auth from fixture $$,
  'a player stores their own subscription'
);
select results_eq(
  $$ select player_id from public.push_subscriptions $$,
  $$ select ana_player from fixture $$,
  'the subscription belongs to whoever signed in'
);
select throws_ok(
  $$ insert into public.push_subscriptions (player_id, endpoint, p256dh, auth)
     select ana_player, 'https://fcm.googleapis.com/fcm/send/x', p256dh, auth from fixture $$,
  '42501',
  null,
  'a player cannot set whose subscription it is'
);
select throws_ok(
  $$ update public.push_subscriptions set auth = repeat('c', 22) $$,
  '42501',
  null,
  'a player cannot change a stored subscription'
);
select throws_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
     select 'http://fcm.googleapis.com/fcm/send/x', p256dh, auth from fixture $$,
  '23514',
  null,
  'a plain http endpoint is refused'
);
select throws_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
     select 'https://fcm.googleapis.com.example.com/x', p256dh, auth from fixture $$,
  '23514',
  null,
  'a host that only looks like a push service is refused'
);
select throws_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
     select 'https://web.push.apple.com/x', p256dh, 'short' from fixture $$,
  '23514',
  null,
  'keys of the wrong size are refused'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}', true);

select is_empty(
  $$ select 1 from public.push_subscriptions $$,
  'a player cannot read another player''s subscriptions'
);
select throws_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
     select 'https://web.push.apple.com/ana-iphone', p256dh, auth from fixture $$,
  '23505',
  null,
  'a browser another player subscribed cannot be taken: the app subscribes again for a new endpoint'
);
delete from public.push_subscriptions;
select lives_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
     select 'https://fcm.googleapis.com/fcm/send/bruno-android', p256dh, auth from fixture $$,
  'another player stores theirs'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);

select throws_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
     select 'https://fcm.googleapis.com/fcm/send/carla', p256dh, auth from fixture $$,
  '42501',
  null,
  'a signed-in stranger cannot store one'
);

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select throws_ok(
  $$ select 1 from public.push_subscriptions $$,
  '42501',
  null,
  'anon cannot read subscriptions'
);

reset role;

select results_eq(
  $$ select endpoint from public.push_subscriptions order by id $$,
  array['https://web.push.apple.com/ana-iphone', 'https://fcm.googleapis.com/fcm/send/bruno-android'],
  'another player''s delete removed nothing of the first player'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);

select lives_ok(
  $$ delete from public.push_subscriptions where endpoint = 'https://web.push.apple.com/ana-iphone' $$,
  'a player removes their own subscription'
);
select lives_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
     select 'https://fcm.googleapis.com/fcm/send/ana-' || n, p256dh, auth
     from fixture, generate_series(1, 10) as n $$,
  'a player stores up to ten browsers'
);
select throws_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
     select 'https://fcm.googleapis.com/fcm/send/ana-11', p256dh, auth from fixture $$,
  '42501',
  null,
  'and no more'
);
delete from public.push_subscriptions where endpoint like 'https://fcm.googleapis.com/fcm/send/ana-%';
select lives_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
     select 'https://web.push.apple.com/ana-iphone', p256dh, auth from fixture $$,
  'and stores it again'
);

reset role;

-- -----------------------------------------------------------------------------
-- Who gets a push
-- -----------------------------------------------------------------------------

set local role service_role;

select is_empty(
  $$ select * from public.push_recipients('2031-01-01', true) $$,
  'no reminder goes out while the day is not open'
);

reset role;
select public.open_game_day((select id from public.seasons where number = 0), '2031-01-01', 'Amanece.');
select public.submit_action(
  (select id from public.game_days where day = '2031-01-01'), (select ana from fixture), 'Enciendo el faro.', 0
);
set local role service_role;

select results_eq(
  $$ select endpoint from public.push_recipients('2031-01-01') $$,
  array['https://fcm.googleapis.com/fcm/send/bruno-android', 'https://web.push.apple.com/ana-iphone'],
  'the opening and the chapter reach every player of the active season'
);
select results_eq(
  $$ select endpoint from public.push_recipients('2031-01-01', true) $$,
  array['https://fcm.googleapis.com/fcm/send/bruno-android'],
  'a reminder reaches only the players who have not played'
);
select results_eq(
  $$ select endpoint from public.push_recipients('2031-01-01', false, (select ana from fixture)) $$,
  array['https://fcm.googleapis.com/fcm/send/bruno-android'],
  'who played reaches everyone but the player who did'
);
select results_eq(
  $$ select endpoint from public.push_recipients('2031-01-01', true, (select bruno from fixture)) $$,
  array[]::text[],
  'a reminder and an exception together leave out both'
);
select is_empty(
  $$ select * from public.push_recipients('2030-12-31') $$,
  'nobody gets a push for a day before any season'
);

reset role;
select public.begin_close((select id from public.game_days where day = '2031-01-01'));
set local role service_role;

select is_empty(
  $$ select * from public.push_recipients('2031-01-01', true) $$,
  'no reminder goes out once the close has started'
);

reset role;

select public.create_season(
  1,
  '2032-01-01',
  '2032-01-02',
  '[{"email": "ana@example.com", "nickname": "La Farera"}]'
);
set local role service_role;

select is(
  (select count(*)::int from public.push_recipients('2032-01-02')),
  1,
  'a later season reaches only its own characters'
);
select is_empty(
  $$ select * from public.push_recipients('2032-01-03') $$,
  'nobody gets a push once the season has ended'
);

reset role;

-- -----------------------------------------------------------------------------
-- The reset
-- -----------------------------------------------------------------------------

select is(
  private.reset_preseason() ->> 'status',
  'reset',
  'the pre-season resets'
);
select results_eq(
  $$ select count(*)::int from public.push_subscriptions $$,
  array[2],
  'the reset keeps every push subscription'
);

select * from finish();
rollback;
