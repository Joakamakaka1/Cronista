-- private.before_user_created(): the Auth hook that only lets the emails in public.players sign up.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.players (email) values ('ana@example.com');

-- -----------------------------------------------------------------------------
-- Definition and grants
-- -----------------------------------------------------------------------------

select has_function('private', 'before_user_created', array['jsonb'], 'the hook exists outside the exposed schemas');
select isnt_definer('private', 'before_user_created', array['jsonb'], 'the hook runs with the privileges of the auth server');
select function_privs_are('private', 'before_user_created', array['jsonb'], 'supabase_auth_admin', array['EXECUTE'], 'the auth server can call the hook');
select function_privs_are('private', 'before_user_created', array['jsonb'], 'authenticated', array[]::text[], 'authenticated cannot call the hook');
select function_privs_are('private', 'before_user_created', array['jsonb'], 'anon', array[]::text[], 'anon cannot call the hook');
select function_privs_are('private', 'before_user_created', array['jsonb'], 'service_role', array[]::text[], 'service_role cannot call the hook');
select is(
  has_column_privilege('supabase_auth_admin', 'public.players', 'role', 'SELECT'),
  false,
  'the auth server cannot read anything but the email'
);
select policy_roles_are('public', 'players', 'players_select_for_signup_hook', array['supabase_auth_admin'], 'only the auth server gets the signup policy');

-- -----------------------------------------------------------------------------
-- Decisions
-- -----------------------------------------------------------------------------

-- postgres cannot switch to supabase_auth_admin, so these run as the owner; the grants above bound the real caller.

select is(
  private.before_user_created('{"user": {"email": "ana@example.com"}}'),
  '{}'::jsonb,
  'an email in the list may sign up'
);
select is(
  private.before_user_created('{"user": {"email": "Ana@Example.com"}}'),
  '{}'::jsonb,
  'the check ignores the case of the email'
);
select is(
  private.before_user_created('{"user": {"email": "eve@example.com"}}'),
  '{"error": {"http_code": 403, "message": "Este correo no está en la lista de jugadores de Cronista."}}'::jsonb,
  'an email outside the list is rejected'
);
select is(
  private.before_user_created('{"user": {"phone": "+34600000000"}}'),
  '{"error": {"http_code": 403, "message": "Este correo no está en la lista de jugadores de Cronista."}}'::jsonb,
  'a signup without an email is rejected'
);

select * from finish();
rollback;
