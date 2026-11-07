-- What the second design reads: when each action was sent and the chapter's pull quote, who can read
-- them, and the quote publish_chapter stores or leaves empty.
begin;
create extension if not exists pgtap with schema extensions;
-- The game engine's tests leave their seasons in a local database; the rollback brings them back.
truncate public.seasons cascade;

select plan(14);

insert into public.players (email)
values ('ana@example.com'), ('bruno@example.com');

insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com', now());

create function pg_temp.resolution()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'awards', '[]'::jsonb, 'struck_out', '[]'::jsonb, 'charges', '[]'::jsonb, 'new_items', '[]'::jsonb,
    'moved_items', '[]'::jsonb, 'new_debts', '[]'::jsonb, 'paid_debts', '[]'::jsonb,
    'out_characters', '[]'::jsonb
  );
$$;

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

create temporary table days on commit drop as
select
  (public.open_game_day((select season_id from who), '2031-01-01', 'Lunes.') ->> 'game_day_id')::bigint as one,
  null::bigint as two;

-- -----------------------------------------------------------------------------
-- When each action was sent
-- -----------------------------------------------------------------------------

select has_column('public', 'actions', 'created_at', 'an action records when it was sent');
select col_not_null('public', 'actions', 'created_at', 'every action has a time');

create temporary table sent on commit drop as
select (public.submit_action((select one from days), (select bruno from who), 'Robo.', 0) ->> 'action_id')::bigint as bruno;

select ok(
  (select created_at between now() - interval '1 minute' and now() from public.actions where id = (select bruno from sent)),
  'a sent action gets the time it was stored'
);

-- -----------------------------------------------------------------------------
-- The pull quote
-- -----------------------------------------------------------------------------

select has_column('public', 'chapters', 'pull_quote', 'a chapter can carry a pull quote');
select col_is_null('public', 'chapters', 'pull_quote', 'the pull quote is optional');

select public.begin_close((select one from days));
select is(
  public.publish_chapter(
    (select one from days),
    'Lunes',
    'Desde arriba se ven cosas. Pasó.',
    pg_temp.resolution() || jsonb_build_object(
      'awards', jsonb_build_array(jsonb_build_object('action_id', (select bruno from sent), 'points', 0))
    ),
    'Desde arriba se ven cosas.'
  ) ->> 'status',
  'published',
  'a chapter publishes with its pull quote'
);
select is(
  (select pull_quote from public.chapters where game_day_id = (select one from days)),
  'Desde arriba se ven cosas.',
  'publish_chapter stores the pull quote'
);

update days set two = (public.open_game_day((select season_id from who), '2031-01-02', 'Martes.') ->> 'game_day_id')::bigint;
select public.begin_close((select two from days));
select is(
  public.publish_chapter((select two from days), 'Martes', 'Nada.', pg_temp.resolution()) ->> 'status',
  'published',
  'a chapter publishes without a pull quote'
);
select is(
  (select pull_quote from public.chapters where game_day_id = (select two from days)),
  null,
  'no pull quote is stored as null'
);

select throws_ok(
  $$ update public.chapters set pull_quote = E'Dos\nlíneas' where game_day_id = (select two from days) $$,
  '23514',
  null,
  'a pull quote is a single line'
);

-- -----------------------------------------------------------------------------
-- Who reads them
-- -----------------------------------------------------------------------------

grant select on sent to authenticated;
grant select on days to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);
select isnt(
  (select created_at from public.actions where id = (select bruno from sent)),
  null,
  'a player reads when another player sent their action'
);
select is(
  (select pull_quote from public.chapters where game_day_id = (select one from days)),
  'Desde arriba se ven cosas.',
  'a player reads the pull quote'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);
select is((select count(*) from public.actions), 0::bigint, 'someone off the list reads no action times');

reset role;
set local role anon;
select throws_ok($$ select created_at from public.actions $$, '42501', null, 'anon cannot read action times');
reset role;

select * from finish();
rollback;
