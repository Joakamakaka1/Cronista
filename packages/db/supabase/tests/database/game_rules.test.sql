-- ADR-30's rules as publish_chapter guards them, the finale and the reset, walked through a season.
begin;
create extension if not exists pgtap with schema extensions;
-- The game engine's tests leave their seasons in a local database; the rollback brings them back.
truncate public.seasons cascade;

select plan(50);

insert into public.players (email)
values ('ana@example.com'), ('bruno@example.com'), ('carla@example.com');

create function pg_temp.resolution(p_changes jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'awards', '[]'::jsonb, 'struck_out', '[]'::jsonb, 'charges', '[]'::jsonb, 'new_items', '[]'::jsonb,
    'moved_items', '[]'::jsonb, 'new_debts', '[]'::jsonb, 'paid_debts', '[]'::jsonb,
    'out_characters', '[]'::jsonb
  ) || p_changes;
$$;

select public.create_season(
  1,
  '2031-01-01',
  '2031-01-03',
  '[{"email": "ana@example.com", "nickname": "A"}, {"email": "bruno@example.com", "nickname": "B"}, {"email": "carla@example.com", "nickname": "C"}]'
);

create temporary table who on commit drop as
select
  (select id from public.seasons where number = 1) as season_id,
  (select id from public.characters where nickname = 'A') as ana,
  (select id from public.characters where nickname = 'B') as bruno,
  (select id from public.characters where nickname = 'C') as carla;

create temporary table day_one on commit drop as
select (public.open_game_day((select season_id from who), '2031-01-01', 'Lunes.') ->> 'game_day_id')::bigint as id;

create temporary table day_one_actions on commit drop as
select
  (public.submit_action((select id from day_one), (select ana from who), 'Compro.', 5) ->> 'action_id')::bigint as ana,
  (public.submit_action((select id from day_one), (select bruno from who), 'Pido.', 3) ->> 'action_id')::bigint as bruno;

select public.begin_close((select id from day_one));

create function pg_temp.day_one_awards()
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('action_id', (select ana from day_one_actions), 'points', 1),
    jsonb_build_object('action_id', (select bruno from day_one_actions), 'points', 0)
  );
$$;

create function pg_temp.publish_one(p_changes jsonb)
returns jsonb
language sql
as $$
  select public.publish_chapter(
    (select id from day_one),
    'Lunes',
    'Pasó.',
    pg_temp.resolution(jsonb_build_object('awards', pg_temp.day_one_awards()) || p_changes)
  );
$$;

create function pg_temp.charge(p_points bigint, p_purpose text, p_recipient bigint default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'action_id', (select ana from day_one_actions),
    'points', p_points,
    'purpose', p_purpose,
    'recipient_character_id', p_recipient
  );
$$;

-- -----------------------------------------------------------------------------
-- What a resolution cannot do, each undoing all of it
-- -----------------------------------------------------------------------------

select is(
  public.publish_chapter((select id from day_one), 'T', 'B', '{"awards": []}'),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a resolution must say everything it changes'
);
select is(
  pg_temp.publish_one(jsonb_build_object('charges', jsonb_build_array(pg_temp.charge(6, 'influence')))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'the narrator cannot charge more than the stake'
);
select is(
  pg_temp.publish_one(jsonb_build_object('charges', jsonb_build_array(
    pg_temp.charge(3, 'influence'), pg_temp.charge(3, 'payment', (select bruno from who))
  ))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'the charges of an action add up against its stake'
);
select is(
  pg_temp.publish_one(jsonb_build_object('charges', jsonb_build_array(pg_temp.charge(0, 'influence')))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a charge is at least one point'
);
select is(
  pg_temp.publish_one(jsonb_build_object('charges', jsonb_build_array(pg_temp.charge(1, 'payment')))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a payment needs a recipient'
);
select is(
  pg_temp.publish_one(jsonb_build_object('charges', jsonb_build_array(pg_temp.charge(1, 'payment', (select ana from who))))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a character cannot pay itself'
);
select is(
  pg_temp.publish_one(jsonb_build_object('charges', jsonb_build_array(pg_temp.charge(1, 'payment', 999999)))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a payment goes to a character of the season'
);
select is(
  pg_temp.publish_one(jsonb_build_object('charges', jsonb_build_array(pg_temp.charge(1, 'item')))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'an item charge comes only from buying an item'
);
select is(
  pg_temp.publish_one(jsonb_build_object('new_items', jsonb_build_array(jsonb_build_object(
    'action_id', (select ana from day_one_actions), 'name', 'Caja', 'price', 0
  )))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a new item needs a charge'
);
select is(
  pg_temp.publish_one(jsonb_build_object('new_debts', jsonb_build_array(jsonb_build_object(
    'action_id', (select bruno from day_one_actions), 'creditor_character_id', (select ana from who), 'points', 6
  )))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a debt is at most 5 points'
);
select is(
  pg_temp.publish_one(jsonb_build_object('new_debts', jsonb_build_array(jsonb_build_object(
    'action_id', (select ana from day_one_actions), 'creditor_character_id', (select ana from who), 'points', 1
  )))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'nobody owes itself'
);
select is(
  pg_temp.publish_one(jsonb_build_object('out_characters', jsonb_build_array(999999))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'only a character of the season goes out'
);

select results_eq(
  $$ select balance from public.characters order by nickname $$,
  array[10::bigint, 10::bigint, 10::bigint],
  'a rejected resolution moves no balance'
);
select is((select count(*) from public.charges), 0::bigint, 'a rejected resolution leaves no charge');
select is((select count(*) from public.items), 0::bigint, 'a rejected resolution leaves no item');
select is((select count(*) from public.chapters), 0::bigint, 'a rejected resolution leaves no chapter');

-- -----------------------------------------------------------------------------
-- A postponed chapter
-- -----------------------------------------------------------------------------

select is(
  public.postpone_chapter((select id from day_one), 'En la imprenta.'),
  '{"ok": true, "first": true}'::jsonb,
  'the first call is the one that postpones'
);
select is(
  public.postpone_chapter((select id from day_one), 'Otro mensaje.'),
  '{"ok": true, "first": false}'::jsonb,
  'a second call tells that the chapter was already postponed'
);
select is(
  (select newspaper_message from public.game_days where id = (select id from day_one)),
  'En la imprenta.',
  'a postponed chapter leaves its message'
);

-- -----------------------------------------------------------------------------
-- Publishing with everything
-- -----------------------------------------------------------------------------

select is(
  pg_temp.publish_one(jsonb_build_object(
    'charges', jsonb_build_array(
      pg_temp.charge(1, 'influence'), pg_temp.charge(2, 'payment', (select bruno from who))
    ),
    'new_items', jsonb_build_array(jsonb_build_object(
      'action_id', (select ana from day_one_actions), 'name', 'Caja', 'price', 1
    )),
    'new_debts', jsonb_build_array(jsonb_build_object(
      'action_id', (select bruno from day_one_actions), 'creditor_character_id', (select ana from who), 'points', 3
    )),
    'out_characters', jsonb_build_array((select carla from who))
  )) ->> 'status',
  'published',
  'a postponed chapter publishes, with its charges and canon'
);
select is(
  (select newspaper_message from public.game_days where id = (select id from day_one)),
  null,
  'publishing clears the message'
);
select results_eq(
  $$ select nickname, balance from public.characters order by nickname $$,
  $$ values ('A'::text, 7::bigint), ('B'::text, 12::bigint), ('C'::text, 9::bigint) $$,
  'charges leave the balance, payments reach the recipient, and the rest of the stake returns'
);
select results_eq(
  $$ select name, owner_character_id from public.items $$,
  $$ select 'Caja'::text, ana from who $$,
  'a new item goes to whoever paid it'
);
select results_eq(
  $$ select purpose::text, points from public.charges order by purpose $$,
  $$ values ('influence'::text, 1::bigint), ('item'::text, 1::bigint), ('payment'::text, 2::bigint) $$,
  'buying an item is a charge'
);
select results_eq(
  $$ select debtor_character_id, creditor_character_id, points from public.debts $$,
  $$ select bruno, ana, 3::bigint from who $$,
  'the debtor of a new debt is the character of the action'
);

-- -----------------------------------------------------------------------------
-- The next day: out, struck out, thefts and paying a debt
-- -----------------------------------------------------------------------------

create temporary table day_two on commit drop as
select (public.open_game_day((select season_id from who), '2031-01-02', 'Martes.') ->> 'game_day_id')::bigint as id;

select is(
  public.submit_action((select id from day_two), (select carla from who), 'Desde la cárcel.', 1),
  '{"ok": false, "error": "stake_out_of_range"}'::jsonb,
  'a character who is out declares no stake'
);

create temporary table day_two_actions on commit drop as
select
  (public.submit_action((select id from day_two), (select ana from who), 'Algo tachable.', 3) ->> 'action_id')::bigint as ana,
  (public.submit_action((select id from day_two), (select bruno from who), 'Pago y robo.', 4) ->> 'action_id')::bigint as bruno,
  (public.submit_action((select id from day_two), (select carla from who), 'Desde la cárcel.', 0) ->> 'action_id')::bigint as carla;

select ok((select carla from day_two_actions) is not null, 'a character who is out still plays, declaring nothing');

select public.begin_close((select id from day_two));

create function pg_temp.publish_two(p_changes jsonb)
returns jsonb
language sql
as $$
  select public.publish_chapter(
    (select id from day_two),
    'Martes',
    'Pasó.',
    pg_temp.resolution(jsonb_build_object(
      'struck_out', jsonb_build_array((select ana from day_two_actions)),
      'awards', jsonb_build_array(
        jsonb_build_object('action_id', (select bruno from day_two_actions), 'points', 0),
        jsonb_build_object('action_id', (select carla from day_two_actions), 'points', 1)
      )
    ) || p_changes)
  );
$$;

select is(
  pg_temp.publish_two(jsonb_build_object('out_characters', jsonb_build_array((select carla from who)))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'nobody is out two days in a row'
);
select is(
  pg_temp.publish_two(jsonb_build_object('moved_items', jsonb_build_array(jsonb_build_object(
    'name', 'Caja', 'from_character_id', (select carla from who), 'to_character_id', (select bruno from who)
  )))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'an item changes hands only from its current owner'
);
select is(
  pg_temp.publish_two(jsonb_build_object('paid_debts', jsonb_build_array(jsonb_build_object(
    'action_id', (select carla from day_two_actions), 'debt_id', (select id from public.debts)
  )))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a debt is paid only by its debtor'
);
select is(
  pg_temp.publish_two(jsonb_build_object('charges', jsonb_build_array(jsonb_build_object(
    'action_id', (select ana from day_two_actions), 'points', 1, 'purpose', 'influence', 'recipient_character_id', null
  )))),
  '{"ok": false, "error": "resolution_mismatch"}'::jsonb,
  'a struck-out action pays nothing and changes no canon'
);
select is(
  (select struck_out from public.actions where id = (select ana from day_two_actions)),
  false,
  'a rejected resolution strikes nothing out'
);

select is(
  pg_temp.publish_two(jsonb_build_object(
    'moved_items', jsonb_build_array(jsonb_build_object(
      'name', 'Caja', 'from_character_id', (select ana from who), 'to_character_id', (select bruno from who)
    )),
    'paid_debts', jsonb_build_array(jsonb_build_object(
      'action_id', (select bruno from day_two_actions), 'debt_id', (select id from public.debts)
    )),
    'new_debts', jsonb_build_array(jsonb_build_object(
      'action_id', (select carla from day_two_actions), 'creditor_character_id', (select ana from who), 'points', 1
    ))
  )) ->> 'status',
  'published',
  'a day with a theft, a paid debt and a struck-out action publishes'
);
select results_eq(
  $$ select nickname, balance from public.characters order by nickname $$,
  $$ values ('A'::text, 8::bigint), ('B'::text, 9::bigint), ('C'::text, 10::bigint) $$,
  'the comic penalty costs 2 and the stake returns, and a debt reaches its creditor from the stake'
);
select results_eq(
  $$ select points, kind::text from public.awards where action_id = (select ana from day_two_actions) $$,
  $$ values (-2::bigint, 'comic_penalty'::text) $$,
  'the comic penalty is fixed by code'
);
select is(
  (select owner_character_id from public.items),
  (select bruno from who),
  'a theft moves the item'
);

-- -----------------------------------------------------------------------------
-- The finale
-- -----------------------------------------------------------------------------

create temporary table day_three on commit drop as
select (public.open_game_day((select season_id from who), '2031-01-03', 'Miércoles.') ->> 'game_day_id')::bigint as id;

create temporary table day_three_actions on commit drop as
select
  (public.submit_action((select id from day_three), (select bruno from who), 'Otra deuda.', 0) ->> 'action_id')::bigint as bruno,
  (public.submit_action((select id from day_three), (select carla from who), 'De vuelta.', 1) ->> 'action_id')::bigint as carla;

select ok((select carla from day_three_actions) is not null, 'back after that close, a character can stake again');

select public.begin_close((select id from day_three));

select is(
  public.publish_chapter(
    (select id from day_three),
    'Final',
    'Ganó C.',
    pg_temp.resolution(jsonb_build_object(
      'awards', jsonb_build_array(
        jsonb_build_object('action_id', (select bruno from day_three_actions), 'points', 0),
        jsonb_build_object('action_id', (select carla from day_three_actions), 'points', 0)
      ),
      'new_debts', jsonb_build_array(jsonb_build_object(
        'action_id', (select bruno from day_three_actions), 'creditor_character_id', (select carla from who), 'points', 2
      ))
    ))
  ) ->> 'status',
  'published',
  'the last day of a season publishes'
);
select results_eq(
  $$ select nickname, balance from public.characters order by nickname $$,
  $$ values ('A'::text, 8::bigint), ('B'::text, 7::bigint), ('C'::text, 11::bigint) $$,
  'the finale moves open debts from debtor to creditor, the ones born that day too'
);
select is(
  (select count(*) from public.debts where paid_on_day_id is null),
  0::bigint,
  'the finale leaves no open debt'
);

-- -----------------------------------------------------------------------------
-- The pre-season: no finale, and its reset
-- -----------------------------------------------------------------------------

select public.create_season(
  0,
  '2030-01-01',
  null,
  '[{"email": "ana@example.com", "nickname": "A0"}, {"email": "bruno@example.com", "nickname": "B0"}]'
);

create temporary table pre on commit drop as
select
  (select id from public.characters where nickname = 'A0') as ana,
  (select id from public.characters where nickname = 'B0') as bruno,
  (public.open_game_day((select id from public.seasons where number = 0), '2030-01-01', 'Enero.') ->> 'game_day_id')::bigint as day_id;

create temporary table pre_action on commit drop as
select (public.submit_action((select day_id from pre), (select ana from pre), 'Debo.', 2) ->> 'action_id')::bigint as id;

select public.store_hint((select day_id from pre), (select ana from pre), 'Pista.', false);
select public.begin_close((select day_id from pre));
select public.publish_chapter(
  (select day_id from pre),
  'Enero',
  'Pasó.',
  pg_temp.resolution(jsonb_build_object(
    'awards', jsonb_build_array(jsonb_build_object('action_id', (select id from pre_action), 'points', 1)),
    'charges', jsonb_build_array(jsonb_build_object('action_id', (select id from pre_action), 'points', 1, 'purpose', 'influence', 'recipient_character_id', null)),
    'new_items', jsonb_build_array(jsonb_build_object('action_id', (select id from pre_action), 'name', 'Moneda', 'price', 1)),
    'new_debts', jsonb_build_array(jsonb_build_object('action_id', (select id from pre_action), 'creditor_character_id', (select bruno from pre), 'points', 2)),
    'out_characters', jsonb_build_array((select bruno from pre))
  ))
);

select is(
  (select count(*) from public.debts where debtor_character_id = (select ana from pre) and paid_on_day_id is null),
  1::bigint,
  'the pre-season has no finale: its debts stay open'
);

delete from public.ai_usage;
insert into public.ai_usage (
  created_at, workspace, function_name, prompt_version, model, input_tokens, cache_read_tokens,
  cache_write_tokens, output_tokens, cost_usd, latency_ms
)
values
  ('2031-01-19T00:00:00Z', 'game-prod', 'resolve', 'v2', 'm', 1, 0, 0, 1, 1.5, 1),
  ('2031-01-20T00:00:00Z', 'game-prod', 'narrate', 'v2', 'm', 1, 0, 0, 1, 2.25, 1),
  ('2031-01-20T00:00:00Z', 'evals', 'narrate', 'v2', 'm', 1, 0, 0, 1, 1, 1),
  ('2031-01-18T23:59:59Z', 'game-prod', 'narrate', 'v2', 'm', 1, 0, 0, 1, 100, 1);

select is(
  public.spend_by_workspace('2031-01-19T00:00:00Z'),
  '{"game-prod": 3.75, "evals": 1}'::jsonb,
  'the ledger adds up per workspace from the start of a cycle'
);

select is(
  private.reset_preseason(),
  '{"ok": true, "status": "reset"}'::jsonb,
  'the pre-season resets while season 1 has not started'
);
select results_eq(
  $$
    select
      (select count(*) from public.game_days where id = (select day_id from pre)),
      (select count(*) from public.actions where id = (select id from pre_action)),
      (select count(*) from public.hints where character_id = (select ana from pre)),
      (select count(*) from public.items where name = 'Moneda'),
      (select count(*) from public.debts where debtor_character_id = (select ana from pre)),
      (select count(*) from public.character_statuses where character_id = (select bruno from pre))
  $$,
  $$ values (0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint) $$,
  'the reset removes the pre-season''s days, actions, quotas and canon'
);
select results_eq(
  $$ select balance from public.characters where id in ((select ana from pre), (select bruno from pre)) $$,
  array[10::bigint, 10::bigint],
  'the reset returns the balances to 10 and keeps the characters'
);
select results_eq(
  $$
    select
      (select count(*) from public.players where email in ('ana@example.com', 'bruno@example.com', 'carla@example.com')),
      (select count(*) from public.ai_usage),
      (select count(*) from public.game_days where season_id = (select season_id from who))
  $$,
  $$ values (3::bigint, 4::bigint, 3::bigint) $$,
  'the reset keeps the players, the ledger and every other season'
);

update public.seasons set starts_on = '2020-01-01', ends_on = '2020-01-03' where number = 1;

select is(
  private.reset_preseason(),
  '{"ok": false, "error": "season_started"}'::jsonb,
  'the reset refuses once season 1 has started'
);

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------

select is(
  has_function_privilege('service_role', 'private.reset_preseason()', 'execute'),
  false,
  'the Lambdas cannot reset the pre-season'
);
select table_privs_are(
  'public', 'spend_alerts', 'service_role', array['SELECT', 'INSERT'], 'the Lambdas read and add spend alerts'
);
select table_privs_are('public', 'spend_alerts', 'authenticated', array[]::text[], 'players cannot read spend alerts');

select * from finish();
rollback;
