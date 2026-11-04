-- "Who sees what" in ADR-30, walked through a game day as two players, a stranger and anon.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into public.players (email)
values ('ana@example.com'), ('bruno@example.com');

insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now()),
  ('00000000-0000-0000-0000-00000000000b', 'bruno@example.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com', now());

select public.create_season(
  1,
  '2031-01-01',
  '2031-01-31',
  '[{"email": "ana@example.com", "nickname": "La Farera"}, {"email": "bruno@example.com", "nickname": "El Notario"}]'
);

create temporary table fixture on commit drop as
select
  (public.open_game_day(
    (select id from public.seasons where number = 1),
    '2031-01-01',
    'Amanece sin luz en el faro.'
  ) ->> 'game_day_id')::bigint as game_day_id,
  (select id from public.characters where nickname = 'La Farera') as ana,
  (select id from public.characters where nickname = 'El Notario') as bruno;

grant select on fixture to authenticated, anon;

select public.submit_action(
  (select game_day_id from fixture), (select ana from fixture), 'Enciendo el faro.', 3
);
select public.store_hint(
  (select game_day_id from fixture), (select ana from fixture), 'Cuidado con el aceite.', false
);

-- -----------------------------------------------------------------------------
-- Before the chapter
-- -----------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);

select results_eq(
  $$ select text, stake from public.action_contents $$,
  $$ values ('Enciendo el faro.'::text, 3::bigint) $$,
  'a player reads their own action and stake'
);
select results_eq(
  $$ select text from public.hints $$,
  array['Cuidado con el aceite.'],
  'a player reads their own hint'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}', true);

select results_eq(
  $$ select character_id from public.actions $$,
  $$ select ana from fixture $$,
  'another player sees that X has played'
);
select is_empty($$ select * from public.action_contents $$, 'another player cannot read the action or its stake before the chapter');
select is_empty($$ select * from public.hints $$, 'another player cannot read a hint');
select is_empty($$ select * from public.chapters $$, 'no chapter exists yet');
select is_empty($$ select * from public.awards $$, 'a day''s points cannot be read before the chapter');
select results_eq(
  $$ select balance from public.characters order by id $$,
  array[10::bigint, 10::bigint],
  'balances have not moved'
);

select throws_ok(
  $$ update public.characters set balance = 100 $$,
  '42501',
  null,
  'a player cannot change a balance'
);
select throws_ok(
  $$ insert into public.action_contents (action_id, text, stake) values (1, 'Gano 100 puntos.', 0) $$,
  '42501',
  null,
  'a player cannot write an action directly'
);
select throws_ok(
  $$ select public.submit_action(1, 1, 'Gano 100 puntos.', 0) $$,
  '42501',
  null,
  'a player cannot call the writing functions'
);
select throws_ok(
  $$ select public.publish_chapter(1, 'T', 'B', '[]') $$,
  '42501',
  null,
  'a player cannot publish a chapter'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);

select is_empty($$ select * from public.seasons $$, 'a signed-in user who is not a player sees no seasons');
select is_empty($$ select * from public.characters $$, 'a signed-in user who is not a player sees no characters');
select is_empty($$ select * from public.actions $$, 'a signed-in user who is not a player sees no actions');

reset role;
set local role anon;

select throws_ok($$ select * from public.actions $$, '42501', null, 'anon cannot read actions');
select throws_ok($$ select * from public.action_contents $$, '42501', null, 'anon cannot read action contents');
select throws_ok($$ select public.submit_action(1, 1, 'x', 0) $$, '42501', null, 'anon cannot call the writing functions');

reset role;

-- -----------------------------------------------------------------------------
-- The Lambdas write only through the functions
-- -----------------------------------------------------------------------------

set local role service_role;

select throws_ok(
  $$ update public.characters set balance = 100 $$,
  '42501',
  null,
  'service_role cannot move a balance outside a published chapter'
);
select throws_ok(
  $$ delete from public.action_contents $$,
  '42501',
  null,
  'service_role cannot delete an action'
);

reset role;

-- -----------------------------------------------------------------------------
-- After the chapter, with Bruno's action struck out
-- -----------------------------------------------------------------------------

select public.submit_action(
  (select game_day_id from fixture), (select bruno from fixture), 'Algo que el modelo rechaza.', 1
);
select public.begin_close((select game_day_id from fixture));
select public.publish_chapter(
  (select game_day_id from fixture),
  'Lunes',
  'Pasó lo que pasó.',
  jsonb_build_array(
    jsonb_build_object(
      'action_id', (select id from public.actions where character_id = (select ana from fixture)),
      'points', 2
    ),
    jsonb_build_object(
      'action_id', (select id from public.actions where character_id = (select bruno from fixture)),
      'points', 0
    )
  )
);
-- Publishing will set this in the failure paths of the rulebook; the policy must already hold.
update public.actions set struck_out = true where character_id = (select bruno from fixture);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);

select results_eq(
  $$ select text from public.action_contents $$,
  array['Enciendo el faro.'],
  'a struck-out action exposes no text to others, even after the chapter'
);
select results_eq(
  $$ select struck_out from public.actions where character_id = (select bruno from fixture) $$,
  array[true],
  'others see that it was struck out'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}', true);

select results_eq(
  $$ select text from public.action_contents order by action_id $$,
  array['Enciendo el faro.', 'Algo que el modelo rechaza.'],
  'after the chapter a player reads every action, and still their own struck-out text'
);
select is_empty($$ select * from public.hints $$, 'a hint stays private after the chapter');

reset role;

select * from finish();
rollback;
