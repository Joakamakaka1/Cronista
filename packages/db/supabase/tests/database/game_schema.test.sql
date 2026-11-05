-- The game tables: their shape, the grants per role and what a role may never do directly.
begin;
create extension if not exists pgtap with schema extensions;
-- The game engine's tests leave their seasons in a local database; the rollback brings them back.
truncate public.seasons cascade;

select plan(44);

-- -----------------------------------------------------------------------------
-- What must hide its content has no column to leak it
-- -----------------------------------------------------------------------------

select columns_are(
  'public', 'actions',
  array['id', 'game_day_id', 'character_id', 'origin', 'struck_out'],
  '"X has played" exposes no text and no stake'
);
select columns_are(
  'public', 'ai_usage',
  array[
    'id', 'created_at', 'workspace', 'function_name', 'prompt_version', 'model', 'input_tokens',
    'cache_read_tokens', 'cache_write_tokens', 'output_tokens', 'cost_usd', 'latency_ms',
    'refusal_category', 'game_day'
  ],
  'the ledger holds ids and numbers only'
);
select hasnt_fk('public', 'ai_usage', 'the ledger has no foreign key, so it outlives a reset');

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

select table_privs_are('public', table_name, 'anon', array[]::text[], 'anon has no privileges on ' || table_name)
from unnest(array[
  'seasons', 'characters', 'game_days', 'actions', 'action_contents', 'hints', 'chapters', 'awards',
  'charges', 'items', 'debts', 'character_statuses', 'ai_usage'
]) as table_name;

select table_privs_are('public', table_name, 'authenticated', array['SELECT'], 'players only read ' || table_name)
from unnest(array[
  'seasons', 'characters', 'game_days', 'actions', 'action_contents', 'hints', 'chapters', 'awards',
  'charges', 'items', 'debts', 'character_statuses'
]) as table_name;

select table_privs_are('public', 'ai_usage', 'authenticated', array[]::text[], 'players cannot read the ledger');

select table_privs_are('public', table_name, 'service_role', array['SELECT'], 'the Lambdas only read ' || table_name)
from unnest(array[
  'seasons', 'characters', 'game_days', 'actions', 'action_contents', 'hints', 'chapters', 'awards',
  'charges', 'items', 'debts', 'character_statuses'
]) as table_name;

select table_privs_are('public', 'ai_usage', 'service_role', array['SELECT', 'INSERT'], 'the Lambdas write only the ledger');

-- -----------------------------------------------------------------------------
-- Constraints
-- -----------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.seasons (number, starts_on, ends_on) values (1, '2031-01-01', null) $$,
  '23514',
  null,
  'only the pre-season is open-ended'
);
select throws_ok(
  $$ insert into public.seasons (number, starts_on) values (0, '2031-01-01');
     insert into public.seasons (number, starts_on, ends_on) values (0, '2032-01-01', '2032-02-01') $$,
  '23514',
  null,
  'the pre-season has no end date'
);

select * from finish();
rollback;
