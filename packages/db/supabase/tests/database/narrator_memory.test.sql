-- The narrator's memory: writing moments and chunks once, superseding a changed fact, the hybrid
-- search with its three lists and RRF, the reset and who can reach any of it.
begin;
create extension if not exists pgtap with schema extensions;
-- The game engine's tests leave their seasons in a local database; the rollback brings them back.
truncate public.seasons cascade;

select plan(63);

insert into public.players (email)
values ('ana@example.com'), ('bruno@example.com');

-- A unit vector along `p_axis`, or between two axes: distances the tests can predict.
create function pg_temp.vec(p_axis integer, p_other integer default null)
returns extensions.halfvec
language sql
as $$
  select ('[' || array_to_string(array(
    select case when position = p_axis or position = p_other then 1 else 0 end
    from generate_series(1, 1024) as position
  ), ',') || ']')::extensions.halfvec(1024);
$$;

create function pg_temp.vec_json(p_axis integer, p_other integer default null)
returns jsonb
language sql
as $$ select pg_temp.vec(p_axis, p_other)::text::jsonb; $$;

create function pg_temp.moment(
  p_content text,
  p_axis integer,
  p_characters jsonb default '[]',
  p_joke text default null,
  p_importance integer default 3,
  p_supersedes bigint default null
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'content', p_content, 'characters', p_characters, 'joke', p_joke, 'importance', p_importance,
    'embedding', pg_temp.vec_json(p_axis), 'supersedes', p_supersedes
  );
$$;

-- Opens, closes and publishes a day with no action: what memory needs is a published chapter.
create function pg_temp.published_day(p_season_id bigint, p_day date)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  v_id := (public.open_game_day(p_season_id, p_day, 'Situación.') ->> 'game_day_id')::bigint;
  perform public.begin_close(v_id);
  perform public.publish_chapter(v_id, 'Título', 'Cuerpo.', jsonb_build_object(
    'awards', '[]'::jsonb, 'struck_out', '[]'::jsonb, 'charges', '[]'::jsonb, 'new_items', '[]'::jsonb,
    'moved_items', '[]'::jsonb, 'new_debts', '[]'::jsonb, 'paid_debts', '[]'::jsonb,
    'out_characters', '[]'::jsonb
  ));
  return v_id;
end;
$$;

select public.create_season(
  1, '2031-01-01', '2031-01-10',
  '[{"email": "ana@example.com", "nickname": "La Farera"}, {"email": "bruno@example.com", "nickname": "El Sacristán"}]'
);
select public.create_season(
  0, '2030-01-01', null,
  '[{"email": "ana@example.com", "nickname": "Ana"}, {"email": "bruno@example.com", "nickname": "Bruno"}]'
);

create temporary table season on commit drop as
select
  (select id from public.seasons where number = 1) as id,
  (select id from public.seasons where number = 0) as preseason_id;

create temporary table days on commit drop as
select
  pg_temp.published_day((select id from season), '2031-01-01') as one,
  pg_temp.published_day((select id from season), '2031-01-02') as two,
  pg_temp.published_day((select id from season), '2031-01-03') as three,
  (public.open_game_day((select id from season), '2031-01-04', 'Abierto.') ->> 'game_day_id')::bigint as open_day,
  pg_temp.published_day((select preseason_id from season), '2030-01-01') as preseason;

-- -----------------------------------------------------------------------------
-- Writing moments
-- -----------------------------------------------------------------------------

select is(
  public.store_moments((select open_day from days), 'Resumen.', jsonb_build_array(pg_temp.moment('Nada.', 1))),
  '{"ok": false, "error": "not_published"}'::jsonb,
  'only a published chapter has moments'
);

select is(
  public.store_moments((select one from days), 'Resumen del lunes.', jsonb_build_array(
    pg_temp.moment('La Farera guarda un faro apagado.', 1, '["La Farera"]', null, 5),
    pg_temp.moment('El camión de la Alcaldesa se quedó sin frenos en la plaza.', 2),
    pg_temp.moment('El Sacristán administra las velas.', 3, '["El Sacristán"]', 'las velas del banco central', 2)
  )),
  '{"ok": true, "status": "written"}'::jsonb,
  'a published chapter writes its moments'
);
select results_eq(
  $$ select summary, moments_written_at is not null from public.chapters where game_day_id = (select one from days) $$,
  $$ values ('Resumen del lunes.', true) $$,
  'writing them keeps the summary and marks the chapter done'
);
select results_eq(
  $$ select count(*), min(season_id) from public.memories where game_day_id = (select one from days) $$,
  $$ values (3::bigint, (select id from season)) $$,
  'each moment belongs to the chapter''s season'
);
select is(
  public.store_moments((select one from days), 'Otro.', jsonb_build_array(pg_temp.moment('Otra vez.', 4))),
  '{"ok": true, "status": "already_written"}'::jsonb,
  'a second close writes nothing again'
);
select is(
  (select count(*) from public.memories where game_day_id = (select one from days)),
  3::bigint,
  'and the moments stay as they were'
);

create temporary table first_moments on commit drop as
select
  (select id from public.memories where content like 'La Farera%') as lighthouse,
  (select id from public.memories where content like 'El camión%') as truck,
  (select id from public.memories where content like 'El Sacristán%') as candles;

select is(
  public.store_moments((select two from days), 'Resumen del martes.', jsonb_build_array(
    pg_temp.moment('La Farera encendió el faro por fin.', 1, '["La Farera"]', null, 5, (select lighthouse from first_moments)),
    pg_temp.moment('El Sacristán subió el precio de las velas.', 5, '["El Sacristán"]', 'las velas del banco central')
  )),
  '{"ok": true, "status": "written"}'::jsonb,
  'a changed fact supersedes the earlier moment'
);
select is(
  (select superseded_by from public.memories where id = (select lighthouse from first_moments)),
  (select id from public.memories where content like 'La Farera encendió%'),
  'the earlier moment stays, pointing at the one that replaced it'
);

select is(
  public.store_moments((select three from days), 'Resumen.', jsonb_build_array(
    pg_temp.moment('Algo nuevo.', 6),
    pg_temp.moment('Vuelve el faro.', 1, '[]', null, 3, (select lighthouse from first_moments))
  )),
  '{"ok": false, "error": "invalid_supersedes"}'::jsonb,
  'a moment already superseded cannot be superseded again'
);
select results_eq(
  $$
    select
      (select count(*) from public.memories where game_day_id = (select three from days)),
      (select moments_written_at is null from public.chapters where game_day_id = (select three from days))
  $$,
  $$ values (0::bigint, true) $$,
  'a rejected write leaves nothing behind and the chapter pending'
);

insert into public.memories (season_id, game_day_id, content, importance, embedding)
values ((select preseason_id from season), (select preseason from days), 'De otra temporada.', 3, pg_temp.vec(7));

select is(
  public.store_moments((select three from days), 'Resumen.', jsonb_build_array(
    pg_temp.moment('Algo.', 6, '[]', null, 3, (select id from public.memories where content = 'De otra temporada.'))
  )),
  '{"ok": false, "error": "invalid_supersedes"}'::jsonb,
  'a moment of another season cannot be superseded'
);
select is(
  public.store_moments((select one from days) + 0, 'x', '[]'::jsonb),
  '{"ok": true, "status": "already_written"}'::jsonb,
  'the guard holds whatever the moments say'
);
select is(
  public.store_moments((select three from days), 'Resumen.', jsonb_build_array(pg_temp.moment('Demasiado importante.', 6, '[]', null, 9))),
  '{"ok": false, "error": "invalid_moment"}'::jsonb,
  'importance goes from 1 to 5'
);
select is(
  public.store_moments((select three from days), 'Resumen.', jsonb_build_array(pg_temp.moment('Chiste.', 6, '[]', E'dos\nlíneas'))),
  '{"ok": false, "error": "invalid_moment"}'::jsonb,
  'a joke label is one line'
);
select is(
  public.store_moments((select three from days), 'Resumen.', jsonb_build_array(pg_temp.moment(repeat('a', 501), 6))),
  '{"ok": false, "error": "invalid_moment"}'::jsonb,
  'a moment is at most 500 characters'
);
select is(
  public.store_moments((select three from days), 'Resumen.', jsonb_build_array(
    jsonb_build_object('content', 'Sin vector.', 'characters', '[]'::jsonb, 'importance', 3, 'embedding', '[1, 2]'::jsonb)
  )),
  '{"ok": false, "error": "invalid_moment"}'::jsonb,
  'an embedding has 1024 dimensions'
);
select is(
  public.store_moments((select three from days), '  ', jsonb_build_array(pg_temp.moment('Algo.', 6))),
  '{"ok": false, "error": "invalid_moment"}'::jsonb,
  'a chapter''s moments come with its summary'
);
select is(
  public.store_moments((select three from days), 'Resumen.', null),
  '{"ok": false, "error": "invalid_moment"}'::jsonb,
  'moments come as a list'
);
select is(
  public.store_moments((select three from days), 'Resumen del miércoles.', jsonb_build_array(
    pg_temp.moment('La Alcaldesa inauguró el faro encendido.', 8, '[]', 'las velas del banco central', 4)
  )),
  '{"ok": true, "status": "written"}'::jsonb,
  'the chapter is written once its moments are valid'
);
select is(
  public.store_moments((select preseason from days), 'Nada nuevo.', '[]'::jsonb),
  '{"ok": true, "status": "written"}'::jsonb,
  'a chapter whose moments were all known is done with none'
);

-- -----------------------------------------------------------------------------
-- Chunks
-- -----------------------------------------------------------------------------

select is(
  public.store_chapter_chunks((select open_day from days), jsonb_build_array(jsonb_build_object('content', 'x', 'embedding', pg_temp.vec_json(1)))),
  '{"ok": false, "error": "not_published"}'::jsonb,
  'only a published chapter has chunks'
);
select is(
  public.store_chapter_chunks((select one from days), jsonb_build_array(
    jsonb_build_object('content', 'Primer trozo del lunes, con el camión.', 'embedding', pg_temp.vec_json(2)),
    jsonb_build_object('content', 'Segundo trozo del lunes.', 'embedding', pg_temp.vec_json(9))
  )),
  '{"ok": true, "status": "stored"}'::jsonb,
  'a published chapter stores its chunks'
);
select results_eq(
  $$ select position from public.chapter_chunks where game_day_id = (select one from days) order by position $$,
  array[1::bigint, 2::bigint],
  'chunks keep their order'
);
select is(
  public.store_chapter_chunks((select one from days), jsonb_build_array(jsonb_build_object('content', 'Otra vez.', 'embedding', pg_temp.vec_json(1)))),
  '{"ok": true, "status": "already_stored"}'::jsonb,
  'a chapter''s chunks are stored once'
);
select is(
  public.store_chapter_chunks((select two from days), jsonb_build_array(jsonb_build_object('content', '', 'embedding', pg_temp.vec_json(1)))),
  '{"ok": false, "error": "invalid_chunks"}'::jsonb,
  'an empty chunk is refused'
);
select is(
  public.store_chapter_chunks((select two from days), '[]'::jsonb),
  '{"ok": false, "error": "invalid_chunks"}'::jsonb,
  'no chunks is refused, so it never reads as stored'
);
select public.store_chapter_chunks((select preseason from days), jsonb_build_array(jsonb_build_object('content', 'Pre camión.', 'embedding', pg_temp.vec_json(2))));

-- -----------------------------------------------------------------------------
-- Hybrid search
-- -----------------------------------------------------------------------------

select is(
  (select content from public.hybrid_search((select id from season), 'zzz', pg_temp.vec(5)) limit 1),
  'El Sacristán subió el precio de las velas.',
  'the vector list finds the nearest moment'
);
select results_eq(
  $$
    select content, text_rank is not null
    from public.hybrid_search((select id from season), 'un camion sin frenos', pg_temp.vec(1000))
    where text_rank is not null
  $$,
  $$ values ('El camión de la Alcaldesa se quedó sin frenos en la plaza.', true) $$,
  'full-text search is Spanish and ignores accents'
);
select is(
  (select count(*) from public.hybrid_search((select id from season), 'el sacristan pide un favor', pg_temp.vec(1000))
   where name_rank is not null and content like 'El Sacristán%'),
  2::bigint,
  'the trigram list finds a nickname written without its accent'
);
select ok(
  (select name_rank is not null from public.hybrid_search((select id from season), 'otra vez las velas del banco central', pg_temp.vec(1000)) where content like 'La Alcaldesa%'),
  'the trigram list finds a joke''s label'
);
select is(
  (select count(*) from public.hybrid_search((select id from season), 'faro', pg_temp.vec(1)) where content like 'La Farera guarda%'),
  0::bigint,
  'a superseded moment is never found'
);
select is(
  (select count(*) from public.hybrid_search((select id from season), 'otra temporada', pg_temp.vec(7)) where content = 'De otra temporada.'),
  0::bigint,
  'another season''s moments are never found'
);
select is(
  (select count(*) from public.hybrid_search((select id from season), 'faro', pg_temp.vec(1), 20, 'moments', array['2031-01-02'::date])
   where day = '2031-01-02'),
  0::bigint,
  'excluded days are left out'
);
select is(
  (select count(*) from public.hybrid_search((select id from season), 'faro', pg_temp.vec(1), 20, 'moments', null)),
  5::bigint,
  'no excluded days, said as null, leaves out nothing'
);
select is(
  (select count(*) from public.hybrid_search((select id from season), 'faro', pg_temp.vec(1), 20, 'moments', array[null::date, '2031-01-02'::date])),
  3::bigint,
  'a null among the excluded days is ignored'
);
select throws_ok(
  $$ select * from public.hybrid_search(1, 'faro', pg_temp.vec(1), 20, 'everything') $$,
  '22P02',
  null,
  'an unknown source is an error, not an empty answer'
);
select results_eq(
  $$
    select content, vector_rank, text_rank, name_rank, round(rrf_score::numeric, 9)
    from public.hybrid_search((select id from season), 'la farera encendió el faro', pg_temp.vec(1))
    limit 1
  $$,
  $$ values ('La Farera encendió el faro por fin.', 1::bigint, 1::bigint, 1::bigint, round(3.0 / 51, 9)) $$,
  'RRF adds 1 / (50 + rank) from each list'
);
select is(
  (select round(rrf_score::numeric, 9) from public.hybrid_search((select id from season), 'la farera encendió el faro', pg_temp.vec(1), 20, 'moments', '{}', 10) limit 1),
  round(3.0 / 11, 9),
  'the fusion constant can be changed'
);
select is(
  (select count(*) from public.hybrid_search((select id from season), 'faro', pg_temp.vec(1), 2)),
  2::bigint,
  'it answers at most the count asked for'
);
select is(
  (select joke_last_day from public.hybrid_search((select id from season), 'velas', pg_temp.vec(3)) where content like 'El Sacristán administra%'),
  '2031-01-03'::date,
  'each moment brings the last day its joke was told'
);
select results_eq(
  $$ select content, importance, characters from public.hybrid_search((select id from season), 'camion', pg_temp.vec(2), 20, 'chunks') limit 1 $$,
  $$ values ('Primer trozo del lunes, con el camión.', null::bigint, '{}'::text[]) $$,
  'the chunks are searched on their own'
);
select is(
  (select count(*) from public.hybrid_search((select id from season), 'camion', pg_temp.vec(2), 20, 'chunks') where content = 'Pre camión.'),
  0::bigint,
  'another season''s chunks are never found'
);
select is(
  (select count(*) from public.hybrid_search((select id from season), 'camion', pg_temp.vec(2), 20, 'chunks', array['2031-01-01'::date])),
  0::bigint,
  'excluded days are left out of the chunks too'
);

select results_eq(
  $$ select content from public.nearest_moments((select id from season), pg_temp.vec(1, 8), '2031-01-04', 2) $$,
  array['La Farera encendió el faro por fin.', 'La Alcaldesa inauguró el faro encendido.'],
  'the nearest current moments come first, ties by age'
);
select is(
  (select count(*) from public.nearest_moments((select id from season), pg_temp.vec(7), '2031-01-04')),
  5::bigint,
  'five nearest by default, superseded ones and other seasons left out'
);
select results_eq(
  $$ select content from public.nearest_moments((select id from season), pg_temp.vec(1), '2031-01-02') order by content $$,
  array['El camión de la Alcaldesa se quedó sin frenos en la plaza.', 'El Sacristán administra las velas.'],
  'only earlier days are near: what a day written late can supersede'
);

-- -----------------------------------------------------------------------------
-- As each role
-- -----------------------------------------------------------------------------

grant select on season, days to service_role, authenticated;

set local role service_role;
select ok(
  (select count(*) > 0 from public.hybrid_search((select id from season), 'faro', pg_temp.vec(1))),
  'the Lambdas search memory'
);
select is(
  public.store_chapter_chunks((select two from days), jsonb_build_array(jsonb_build_object('content', 'Martes.', 'embedding', pg_temp.vec_json(4)))),
  '{"ok": true, "status": "stored"}'::jsonb,
  'the Lambdas store chunks'
);
select throws_ok(
  $$ insert into public.memories (season_id, game_day_id, content, importance, embedding) values (1, 1, 'x', 1, pg_temp.vec(1)) $$,
  '42501',
  null,
  'the Lambdas cannot write a moment outside store_moments'
);
reset role;

set local role authenticated;
select throws_ok(
  $$ select count(*) from public.memories $$,
  '42501',
  null,
  'a player cannot read moments'
);
select throws_ok(
  $$ select * from public.hybrid_search(1, 'faro', pg_temp.vec(1)) $$,
  '42501',
  null,
  'a player cannot search memory'
);
select throws_ok(
  $$ select private.store_moments(1, 'x', '[]') $$,
  '42501',
  null,
  'a player cannot write memory'
);
reset role;

-- -----------------------------------------------------------------------------
-- The reset
-- -----------------------------------------------------------------------------

insert into public.memories (season_id, game_day_id, content, importance, embedding)
values ((select preseason_id from season), (select preseason from days), 'Lo que cambió.', 3, pg_temp.vec(8));
update public.memories
set superseded_by = (select id from public.memories where content = 'Lo que cambió.')
where content = 'De otra temporada.';

select is(
  private.reset_preseason(),
  '{"ok": true, "status": "reset"}'::jsonb,
  'the pre-season resets'
);
select results_eq(
  $$
    select
      (select count(*) from public.memories where season_id = (select preseason_id from season)),
      (select count(*) from public.chapter_chunks where game_day_id = (select preseason from days)),
      (select count(*) from public.memories where season_id = (select id from season))
  $$,
  $$ values (0::bigint, 0::bigint, 6::bigint) $$,
  'the reset removes the pre-season''s memory and keeps every other season''s'
);

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------

select table_privs_are('public', 'memories', 'service_role', array['SELECT'], 'the Lambdas only read moments');
select table_privs_are('public', 'memories', 'authenticated', array[]::text[], 'players cannot read moments');
select table_privs_are('public', 'memories', 'anon', array[]::text[], 'anon cannot read moments');
select table_privs_are('public', 'chapter_chunks', 'service_role', array['SELECT'], 'the Lambdas only read chunks');
select table_privs_are('public', 'chapter_chunks', 'authenticated', array[]::text[], 'players cannot read chunks');
select table_privs_are('public', 'chapter_chunks', 'anon', array[]::text[], 'anon cannot read chunks');
select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.memories'::regclass, 'public.chapter_chunks'::regclass)),
  'memory tables have RLS'
);
select results_eq(
  $$
    select bool_or(has_function_privilege(role, signature, 'execute'))
    from unnest(array['authenticated', 'anon']) as role,
      unnest(array[
        'public.store_moments(bigint, text, jsonb)',
        'public.store_chapter_chunks(bigint, jsonb)',
        'public.hybrid_search(bigint, text, extensions.halfvec, integer, public.memory_source, date[], integer)',
        'public.nearest_moments(bigint, extensions.halfvec, date, integer)'
      ]) as signature
  $$,
  array[false],
  'players and anon reach no memory function'
);
select results_eq(
  $$
    select bool_and(has_function_privilege('service_role', signature, 'execute'))
    from unnest(array[
      'public.store_moments(bigint, text, jsonb)',
      'public.store_chapter_chunks(bigint, jsonb)',
      'public.hybrid_search(bigint, text, extensions.halfvec, integer, public.memory_source, date[], integer)',
      'public.nearest_moments(bigint, extensions.halfvec, date, integer)'
    ]) as signature
  $$,
  array[true],
  'the Lambdas write and search memory through its functions'
);

select * from finish();
rollback;
