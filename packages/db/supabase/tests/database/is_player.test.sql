-- private.is_player(): the check every player-facing policy builds on.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.players (email) values ('ana@example.com');

insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com', now());

select has_function('private', 'is_player', array[]::name[], 'is_player exists outside the exposed schemas');
select is_definer('private', 'is_player', array[]::name[], 'is_player is security definer, so it can read players under RLS');
select is(
  (select proconfig from pg_proc where oid = 'private.is_player()'::regprocedure),
  array['search_path=""'],
  'is_player pins an empty search_path'
);
select function_privs_are('private', 'is_player', array[]::name[], 'authenticated', array['EXECUTE'], 'authenticated can call is_player');
select function_privs_are('private', 'is_player', array[]::name[], 'anon', array[]::text[], 'anon cannot call is_player');
select function_privs_are('private', 'is_player', array[]::name[], 'service_role', array[]::text[], 'service_role does not need is_player');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);
select is(private.is_player(), true, 'a linked player is a player');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);
select is(private.is_player(), false, 'a signed-in user outside the list is not a player');

select set_config('request.jwt.claims', '', true);
select is(private.is_player(), false, 'without a session nobody is a player');

select * from finish();
rollback;
