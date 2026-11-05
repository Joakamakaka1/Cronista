-- "Who sees what" in ADR-30, walked through a game day as two players, a stranger and anon.
begin;
create extension if not exists pgtap with schema extensions;
-- The game engine's tests leave their seasons in a local database; the rollback brings them back.
truncate public.seasons cascade;

select plan(43);

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

-- -----------------------------------------------------------------------------
-- During the close and on a postponed chapter, nothing is revealed
-- -----------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);

select results_eq(
  $$ select text from public.action_contents $$,
  array['Enciendo el faro.'],
  'once the close starts, a player still reads only their own action'
);

reset role;
select public.postpone_chapter((select game_day_id from fixture), 'El capítulo sigue en la imprenta.');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);

select results_eq(
  $$ select state::text from public.game_days $$,
  array['postponed'],
  'every player sees that the chapter is postponed'
);
select results_eq(
  $$ select newspaper_message from public.game_days $$,
  array['El capítulo sigue en la imprenta.'],
  'every player reads the newspaper''s message'
);
select results_eq(
  $$ select text from public.action_contents $$,
  array['Enciendo el faro.'],
  'a postponed chapter reveals no other action'
);

reset role;
select public.publish_chapter(
  (select game_day_id from fixture),
  'Lunes',
  'Pasó lo que pasó.',
  jsonb_build_object(
    'awards', jsonb_build_array(
      jsonb_build_object(
        'action_id', (select id from public.actions where character_id = (select ana from fixture)),
        'points', 2
      ),
      jsonb_build_object(
        'action_id', (select id from public.actions where character_id = (select bruno from fixture)),
        'points', 0
      )
    ),
    'struck_out', '[]'::jsonb,
    'charges', '[]'::jsonb,
    'new_items', '[]'::jsonb,
    'moved_items', '[]'::jsonb,
    'new_debts', '[]'::jsonb,
    'paid_debts', '[]'::jsonb,
    'out_characters', '[]'::jsonb
  )
);
-- Publishing will set this in the failure paths of the rulebook; the policy must already hold.
update public.actions set struck_out = true where character_id = (select bruno from fixture);

-- Nothing writes canon yet, and its policies must already hold.
insert into public.charges (action_id, points, purpose)
select id, 1, 'influence' from public.actions where character_id = (select ana from fixture);
insert into public.items (season_id, name, owner_character_id, acquired_on_day_id)
select season_id, 'Una llave', (select ana from fixture), (select game_day_id from fixture)
from public.characters where id = (select ana from fixture);
insert into public.debts (debtor_character_id, creditor_character_id, points, born_on_day_id)
select ana, bruno, 2, game_day_id from fixture;
insert into public.character_statuses (game_day_id, character_id, status)
select game_day_id, ana, 'out' from fixture;

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
select results_eq($$ select title from public.chapters $$, array['Lunes'], 'every player reads the chapter');
select is((select count(*) from public.awards), 2::bigint, 'every player reads the awards');
select is((select count(*) from public.charges), 1::bigint, 'every player reads the charges');
select is((select count(*) from public.items), 1::bigint, 'every player reads the items');
select is((select count(*) from public.debts), 1::bigint, 'every player reads the debts');
select is((select count(*) from public.character_statuses), 1::bigint, 'every player reads the statuses');
select results_eq(
  $$ select balance from public.characters order by id $$,
  array[12::bigint, 10::bigint],
  'balances moved with the chapter'
);

-- With every table holding rows, so that these cannot pass for being empty.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);

select is_empty($$ select * from public.game_days $$, 'a signed-in user who is not a player sees no game days');
select is_empty($$ select * from public.action_contents $$, 'a signed-in user who is not a player reads no action');
select is_empty($$ select * from public.chapters $$, 'a signed-in user who is not a player reads no chapter');
select is_empty($$ select * from public.awards $$, 'a signed-in user who is not a player reads no awards');
select is_empty($$ select * from public.charges $$, 'a signed-in user who is not a player reads no charges');
select is_empty($$ select * from public.items $$, 'a signed-in user who is not a player reads no items');
select is_empty($$ select * from public.debts $$, 'a signed-in user who is not a player reads no debts');
select is_empty($$ select * from public.character_statuses $$, 'a signed-in user who is not a player reads no statuses');

reset role;

select * from finish();
rollback;
