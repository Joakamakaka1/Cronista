-- The writing functions: what each one guards, called as the Lambdas call them.
begin;
create extension if not exists pgtap with schema extensions;
-- The game engine's tests leave their seasons in a local database; the rollback brings them back.
truncate public.seasons cascade;

select plan(31);

insert into public.players (email)
values ('ana@example.com'), ('bruno@example.com'), ('carla@example.com');

set local role service_role;

-- -----------------------------------------------------------------------------
-- create_season
-- -----------------------------------------------------------------------------

select is(
  public.create_season(1, '2031-01-01', '2031-01-31', '[{"email": "nadie@example.com", "nickname": "X"}]'),
  '{"ok": false, "error": "unknown_player"}'::jsonb,
  'a season cannot include someone who is not a player'
);
select is(
  public.create_season(1, '2031-01-01', '2031-01-31', '[]'),
  '{"ok": false, "error": "no_characters"}'::jsonb,
  'a season needs characters'
);
select is(
  public.create_season(
    1, '2031-01-01', '2031-01-31',
    '[{"email": "ana@example.com", "nickname": "X"}, {"email": "bruno@example.com", "nickname": "X"}]'
  ),
  '{"ok": false, "error": "invalid_characters"}'::jsonb,
  'two characters cannot share a nickname'
);
select is(
  public.create_season(1, '2031-01-31', '2031-01-01', '[{"email": "ana@example.com", "nickname": "X"}]'),
  '{"ok": false, "error": "invalid_dates"}'::jsonb,
  'a season cannot end before it starts'
);
select is(
  public.create_season(1, '2031-01-01', null, '[{"email": "ana@example.com", "nickname": "X"}]'),
  '{"ok": false, "error": "invalid_dates"}'::jsonb,
  'only the pre-season can be created without an end date'
);

select is(
  public.create_season(
    1, '2031-01-01', '2031-01-31',
    '[{"email": " Ana@Example.com", "nickname": " La Farera "}, {"email": "bruno@example.com", "nickname": "El Notario"}]'
  ) ->> 'ok',
  'true',
  'a season is created from emails and nicknames'
);
select results_eq(
  $$ select nickname, balance from public.characters order by nickname $$,
  $$ values ('El Notario'::text, 10::bigint), ('La Farera'::text, 10::bigint) $$,
  'every character starts with a balance of 10'
);
select is(
  public.create_season(1, '2032-01-01', '2032-01-31', '[{"email": "ana@example.com", "nickname": "X"}]'),
  '{"ok": false, "error": "season_number_taken"}'::jsonb,
  'a season number is used once'
);
select is(
  public.create_season(2, '2031-01-15', '2031-02-15', '[{"email": "ana@example.com", "nickname": "X"}]'),
  '{"ok": false, "error": "dates_overlap"}'::jsonb,
  'two seasons with an end date cannot overlap'
);
select is(
  public.create_season(0, '2030-12-01', null, '[{"email": "ana@example.com", "nickname": "X"}]') ->> 'ok',
  'true',
  'the open-ended pre-season may run before a dated season'
);

-- -----------------------------------------------------------------------------
-- open_game_day
-- -----------------------------------------------------------------------------

create temporary table fixture on commit drop as
select
  (select id from public.seasons where number = 1) as season_id,
  (select id from public.characters where nickname = 'La Farera') as ana,
  (select id from public.characters where nickname = 'El Notario') as bruno;

select is(
  public.open_game_day((select season_id from fixture), '2031-01-01', 'Amanece.') ->> 'opened',
  'true',
  'opening writes the situation'
);
select is(
  public.open_game_day((select season_id from fixture), '2031-01-01', 'Otra situación.') ->> 'opened',
  'false',
  'opening twice opens once'
);
select results_eq(
  $$ select situation from public.game_days $$,
  array['Amanece.'],
  'the first situation stays'
);
select is(
  public.open_game_day((select season_id from fixture), '2030-12-31', 'Ayer.'),
  '{"ok": false, "error": "later_day_open"}'::jsonb,
  'a day does not open behind a later one, as a run by hand with an old date would'
);

create temporary table today on commit drop as
select id from public.game_days;

-- -----------------------------------------------------------------------------
-- submit_action
-- -----------------------------------------------------------------------------

select is(
  public.submit_action((select id from today), (select ana from fixture), 'Enciendo.', 11),
  '{"ok": false, "error": "stake_out_of_range"}'::jsonb,
  'a stake cannot exceed the balance'
);
select is(
  public.submit_action((select id from today), (select ana from fixture), 'Enciendo.', -1),
  '{"ok": false, "error": "stake_out_of_range"}'::jsonb,
  'a stake cannot be negative'
);
select is(
  public.submit_action((select id from today), 999999, 'Enciendo.', 0),
  '{"ok": false, "error": "no_character"}'::jsonb,
  'an action needs a character of that season'
);
select is(
  public.submit_action(999999, (select ana from fixture), 'Enciendo.', 0),
  '{"ok": false, "error": "day_not_open"}'::jsonb,
  'an action needs a day that exists'
);
select is(
  public.submit_action((select id from today), (select ana from fixture), 'Enciendo.', 10) ->> 'ok',
  'true',
  'a stake can be the whole balance'
);
select is(
  public.submit_action((select id from today), (select ana from fixture), 'Otra cosa.', 0),
  '{"ok": false, "error": "action_already_sent"}'::jsonb,
  'one action per player and day'
);
select is(
  public.submit_action((select id from today), (select ana from fixture), 'Otra cosa.', 999),
  '{"ok": false, "error": "action_already_sent"}'::jsonb,
  'a second action hears that, whatever its stake'
);
select results_eq(
  $$ select text, stake from public.action_contents $$,
  $$ values ('Enciendo.'::text, 10::bigint) $$,
  'the action is not editable'
);

-- -----------------------------------------------------------------------------
-- store_hint
-- -----------------------------------------------------------------------------

select is(
  public.store_hint((select id from today), (select ana from fixture), 'Primera.', false),
  '{"ok": true, "text": "Primera.", "censored": false}'::jsonb,
  'a hint is stored'
);
select is(
  public.store_hint((select id from today), (select ana from fixture), 'Segunda.', true),
  '{"ok": true, "text": "Primera.", "censored": false}'::jsonb,
  'a second hint answers with the first'
);

-- -----------------------------------------------------------------------------
-- begin_close and publish_chapter
-- -----------------------------------------------------------------------------

create temporary table blank on commit drop as
select '{"awards": [], "struck_out": [], "charges": [], "new_items": [], "moved_items": [], "new_debts": [], "paid_debts": [], "out_characters": []}'::jsonb as resolution;

select is(public.begin_close((select id from today)) ->> 'status', 'closing', 'the close starts');
select is(
  public.submit_action((select id from today), (select bruno from fixture), 'Tarde.', 0),
  '{"ok": false, "error": "day_closed"}'::jsonb,
  'no action enters once the close has started, whatever the clock says'
);
select results_eq(
  $$ select origin::text from public.actions where character_id = (select bruno from fixture) $$,
  array['autopilot'],
  'the absent character is on autopilot'
);

select is(
  public.publish_chapter((select id from today), 'T', 'B', (select resolution from blank)),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a chapter needs an award for every real action'
);
select is(
  public.publish_chapter(
    (select id from today), 'T', 'B',
    (select resolution from blank) || jsonb_build_object('awards', jsonb_build_array(jsonb_build_object(
      'action_id', (select id from public.actions where character_id = (select ana from fixture)),
      'points', 6
    )))
  ),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'an award must be in range'
);

select is(
  public.publish_chapter(
    (select id from today), 'Lunes', 'Pasó.',
    (select resolution from blank) || jsonb_build_object('awards', jsonb_build_array(jsonb_build_object(
      'action_id', (select id from public.actions where character_id = (select ana from fixture)),
      'points', 2
    )))
  ) ->> 'status',
  'published',
  'a close publishes'
);
select is(
  public.publish_chapter(
    (select id from today), 'Otro', 'Otro texto.',
    (select resolution from blank) || jsonb_build_object('awards', jsonb_build_array(jsonb_build_object(
      'action_id', (select id from public.actions where character_id = (select ana from fixture)),
      'points', 5
    )))
  ) ->> 'status',
  'already_published',
  'running a close twice publishes once'
);

select * from finish();
rollback;
