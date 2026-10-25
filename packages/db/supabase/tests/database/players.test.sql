-- public.players: shape, grants per role, the own-row policy and the trigger that links user_id.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- Two players and one signed-up user who is not a player. Inserting the users fires the link trigger.
insert into public.players (email, role)
values ('ana@example.com', 'admin'), ('bruno@example.com', 'player');

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'Bruno@Example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

-- -----------------------------------------------------------------------------
-- Shape
-- -----------------------------------------------------------------------------

select has_table('public', 'players', 'players exists');
select columns_are('public', 'players', array['id', 'email', 'user_id', 'role', 'created_at'], 'players has the expected columns');
select col_is_pk('public', 'players', 'id', 'id is the primary key');
select col_is_unique('public', 'players', 'email', 'email is unique');
select col_is_unique('public', 'players', 'user_id', 'user_id is unique');
select fk_ok('public', 'players', 'user_id', 'auth', 'users', 'id', 'user_id references auth.users');
select throws_ok(
  $$ insert into public.players (email) values ('Dana@example.com') $$,
  '23514',
  null,
  'emails are stored in lower case'
);

-- -----------------------------------------------------------------------------
-- Grants and policies
-- -----------------------------------------------------------------------------

select table_privs_are('public', 'players', 'anon', array[]::text[], 'anon has no privileges');
select table_privs_are('public', 'players', 'authenticated', array['SELECT'], 'authenticated can only select');
select table_privs_are('public', 'players', 'service_role', array['SELECT'], 'service_role can only select');
select table_privs_are('public', 'players', 'supabase_auth_admin', array[]::text[], 'the auth server has no table-wide privileges');
select column_privs_are('public', 'players', 'email', 'supabase_auth_admin', array['SELECT'], 'the auth server can read only the email');
select policies_are('public', 'players', array['players_select_own', 'players_select_for_signup_hook'], 'players has exactly the expected policies');

-- -----------------------------------------------------------------------------
-- Link trigger
-- -----------------------------------------------------------------------------

select is(
  (select user_id from public.players where email = 'ana@example.com'),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'signing up links the player'
);
select is(
  (select user_id from public.players where email = 'bruno@example.com'),
  '00000000-0000-0000-0000-00000000000b'::uuid,
  'the link ignores the case of the email'
);
select is((select count(*) from public.players), 2::bigint, 'a user who is not a player creates no player');

-- -----------------------------------------------------------------------------
-- As a player, a non-player and anon
-- -----------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);

select results_eq(
  $$ select email from public.players $$,
  array['ana@example.com'],
  'a player sees only their own row'
);
select throws_ok(
  $$ insert into public.players (email) values ('eve@example.com') $$,
  '42501',
  null,
  'a player cannot add players'
);
select throws_ok(
  $$ update public.players set role = 'admin' $$,
  '42501',
  null,
  'a player cannot change players'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);

select is_empty($$ select * from public.players $$, 'a signed-in user who is not a player sees no rows');

reset role;
set local role anon;

select throws_ok($$ select * from public.players $$, '42501', null, 'anon cannot read players');

select * from finish();
rollback;
