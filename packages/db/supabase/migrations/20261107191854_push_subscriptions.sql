-- Where each player's phones receive Web Push (CR-55): one row per browser subscription, written by
-- the player through RLS and read by the notifier, which asks at send time who should get each push.
--
-- An expand step: a new table and a new function. The table outlives the pre-season's reset, which
-- never touches it, so a player who allowed notifications keeps them into season 1.

-- Fail instead of queueing behind a held lock. `local` scopes them to this migration's transaction.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- -----------------------------------------------------------------------------
-- Push subscriptions
-- -----------------------------------------------------------------------------

create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  -- The player who signed in when the browser subscribed, never what the client sends.
  player_id bigint not null default private.current_player_id() references public.players (id),
  -- Only the push services of Safari, Chrome, Firefox and Edge, the same list as
  -- pushSubscriptionSchema in packages/core: the notifier never sends a request anywhere else.
  endpoint text not null unique constraint push_subscriptions_endpoint_is_a_push_service check (
    char_length(endpoint) <= 1024
    and endpoint ~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)(:[0-9]+)?([/?#]|$)'
  ),
  -- The browser's keys, base64url: an uncompressed P-256 point and a 16-byte secret (RFC 8291).
  p256dh text not null constraint push_subscriptions_p256dh_is_a_point check (p256dh ~ '^[A-Za-z0-9_-]{87}={0,2}$'),
  auth text not null constraint push_subscriptions_auth_is_a_secret check (auth ~ '^[A-Za-z0-9_-]{22}={0,2}$'),
  created_at timestamptz not null default now()
);

comment on table public.push_subscriptions is 'The browsers where each player receives Web Push. A player reads and changes only their own; it outlives the pre-season reset.';

create index push_subscriptions_player_id_idx on public.push_subscriptions (player_id);

alter table public.push_subscriptions enable row level security;

-- The project's default privileges still grant TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on new tables,
-- and UPDATE (setval) on new sequences, the identity one included.
revoke all on table public.push_subscriptions from anon, authenticated, service_role;
revoke all on sequence public.push_subscriptions_id_seq from anon, authenticated, service_role;

-- No update: a browser with new keys has a new endpoint, so the app deletes the row and inserts again.
-- The player's id comes from the column's default, so a player cannot even name another one.
grant select, delete on table public.push_subscriptions to authenticated;
grant insert (endpoint, p256dh, auth) on table public.push_subscriptions to authenticated;
-- The notifier reads them through push_recipients and removes those the push service reports gone.
grant select, delete on table public.push_subscriptions to service_role;

create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated
using ((select private.is_player()) and player_id = (select private.current_player_id()));

create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated
with check ((select private.is_player()) and player_id = (select private.current_player_id()));

create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated
using ((select private.is_player()) and player_id = (select private.current_player_id()));

-- -----------------------------------------------------------------------------
-- Who gets a push
-- -----------------------------------------------------------------------------

-- Security invoker: only service_role may call it, and it reads these tables already.
create function public.push_recipients(
  p_day date,
  p_only_missing boolean default false,
  p_except_character_id bigint default null
)
returns table (endpoint text, p256dh text, auth text)
language sql
stable
security invoker
set search_path = ''
as $$
  with season as (
    -- The active season of the day: the latest one started, unless it has ended.
    select id, ends_on
    from public.seasons
    where starts_on <= p_day
    order by starts_on desc
    limit 1
  ),
  open_day as (
    select game_day.id
    from public.game_days as game_day
    join season on season.id = game_day.season_id
    where game_day.day = p_day and game_day.state = 'open' and game_day.closed_at is null
  )
  select subscription.endpoint, subscription.p256dh, subscription.auth
  from public.push_subscriptions as subscription
  join public.characters as character on character.player_id = subscription.player_id
  join season on season.id = character.season_id
  where (season.ends_on is null or season.ends_on >= p_day)
    and (p_except_character_id is null or character.id <> p_except_character_id)
    and (
      not p_only_missing
      or (
        exists (select 1 from open_day)
        and not exists (
          select 1
          from public.actions as action
          where action.game_day_id = (select id from open_day) and action.character_id = character.id
        )
      )
    )
  order by subscription.id;
$$;

comment on function public.push_recipients(date, boolean, bigint) is 'The subscriptions that get a push on game day p_day: every character of the active season, only those with no action while the day is open (reminders), or all but one character (who played).';

-- New functions are executable by PUBLIC, and the project's default privileges add the API roles.
revoke execute on function public.push_recipients(date, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function public.push_recipients(date, boolean, bigint) to service_role;
