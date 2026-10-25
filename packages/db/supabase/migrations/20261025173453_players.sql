-- The closed list of players, the signup hook that enforces it and the check every policy builds on.

-- Fail instead of queueing behind a held lock: the trigger below locks auth.users, which every signup writes.
set lock_timeout = '5s';
set statement_timeout = '60s';

-- -----------------------------------------------------------------------------
-- Private schema
-- -----------------------------------------------------------------------------

-- Not listed in the API schemas, so nothing here is reachable through the Data API.
create schema private;

-- authenticated evaluates private.is_player() inside policies; the auth server calls the signup hook.
grant usage on schema private to authenticated, supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Players
-- -----------------------------------------------------------------------------

create type public.player_role as enum ('admin', 'player');

create table public.players (
  id bigint generated always as identity primary key,
  email text not null unique constraint players_email_lowercase check (email = lower(email)),
  -- Empty until the player signs up for the first time (see private.link_player).
  user_id uuid unique references auth.users (id) on delete set null,
  role public.player_role not null default 'player',
  created_at timestamptz not null default now()
);

comment on table public.players is 'The closed list of players: only these emails can sign up.';

alter table public.players enable row level security;

-- The project's default privileges still grant TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on new tables.
revoke all on table public.players from anon, authenticated, service_role;
grant select on table public.players to authenticated, service_role;

-- The signup hook runs as supabase_auth_admin and only needs to look up emails.
grant usage on schema public to supabase_auth_admin;
grant select (email) on table public.players to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- is_player
-- -----------------------------------------------------------------------------

-- Security definer so policies on players can call it without recursing into their own RLS.
create function private.is_player()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.players where user_id = (select auth.uid())
  );
$$;

comment on function private.is_player() is 'Whether the signed-in user is in the closed list of players.';

revoke execute on function private.is_player() from public, anon, service_role;
grant execute on function private.is_player() to authenticated;

create policy players_select_own on public.players
for select
to authenticated
using ((select private.is_player()) and user_id = (select auth.uid()));

-- There is no signed-in user during a signup, so this is the one policy without is_player().
create policy players_select_for_signup_hook on public.players
for select
to supabase_auth_admin
using (true);

-- -----------------------------------------------------------------------------
-- Signup hook
-- -----------------------------------------------------------------------------

-- Security invoker, as Supabase recommends for Auth hooks: it reads only what supabase_auth_admin was granted.
create function private.before_user_created(event jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.players where email = lower(event -> 'user' ->> 'email')
    ) then '{}'::jsonb
    else jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Este correo no está en la lista de jugadores de Cronista.'
      )
    )
  end;
$$;

comment on function private.before_user_created(jsonb) is 'Before User Created Auth hook: rejects any email that is not in public.players.';

revoke execute on function private.before_user_created(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Link a new user to their player
-- -----------------------------------------------------------------------------

-- The hook runs before the user exists, so the link happens after the insert, in the same transaction.
create function private.link_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.players
  set user_id = new.id
  where email = lower(new.email) and user_id is null;

  return null;
end;
$$;

revoke execute on function private.link_player() from public, anon, authenticated, service_role;

create trigger link_player
after insert on auth.users
for each row
execute function private.link_player();
