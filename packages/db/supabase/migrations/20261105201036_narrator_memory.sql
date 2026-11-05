-- The narrator's memory (narrator.md, "Memory"): moments extracted from each published chapter, the
-- chapter cut into chunks as a fallback index, and the hybrid search that fuses vector, full-text and
-- trigram lists with Reciprocal Rank Fusion.
--
-- Only service_role reads these tables, and it writes them only through the functions here.

-- Fail instead of queueing behind a held lock. `local` scopes them to this migration's transaction.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- In `extensions`, as Supabase recommends, like `vector`.
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Spanish stemming without accents, so that "camion" finds "camión". Both the column and the query
-- use it.
create text search configuration private.es (copy = pg_catalog.spanish);
alter text search configuration private.es
  alter mapping for hword, hword_part, word with extensions.unaccent, pg_catalog.spanish_stem;

comment on text search configuration private.es is 'Spanish with unaccent: the memory''s full-text search, on the column and on the query.';

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------

alter table public.chapters add column summary text;
alter table public.chapters add column moments_written_at timestamptz;

comment on column public.chapters.summary is 'Two or three sentences the narrator wrote from the chapter when extracting its moments.';
comment on column public.chapters.moments_written_at is 'When the chapter''s moments reached memory. Empty means pending: the next close extracts them.';

create table public.memories (
  id bigint generated always as identity primary key,
  season_id bigint not null references public.seasons (id),
  -- The published chapter it was extracted from.
  game_day_id bigint not null references public.game_days (id),
  content text not null constraint memories_content_length check (char_length(content) between 1 and 500),
  -- Nicknames, which are unique in a season: the trigram list searches them.
  characters text[] not null default '{}',
  -- A running joke's label, one line: moments that share it are the same joke.
  joke text constraint memories_joke_one_line check (
    joke is null or (char_length(joke) between 1 and 60 and joke !~ '[\r\n]')
  ),
  importance bigint not null constraint memories_importance_in_range check (importance between 1 and 5),
  embedding extensions.halfvec(1024) not null,
  search tsvector generated always as (to_tsvector('private.es'::regconfig, content)) stored,
  -- A fact that changed stays, pointing at the moment that replaced it.
  superseded_by bigint references public.memories (id),
  created_at timestamptz not null default now(),
  constraint memories_not_superseded_by_itself check (superseded_by <> id)
);

comment on table public.memories is 'Atomic moments extracted from published chapters, the narrator''s memory. Canon wins over them.';

create index memories_season_id_idx on public.memories (season_id);
create index memories_game_day_id_idx on public.memories (game_day_id);
create index memories_superseded_by_idx on public.memories (superseded_by);
create index memories_search_idx on public.memories using gin (search);

create table public.chapter_chunks (
  id bigint generated always as identity primary key,
  game_day_id bigint not null references public.game_days (id),
  position bigint not null constraint chapter_chunks_position_positive check (position >= 1),
  content text not null constraint chapter_chunks_content_not_empty check (content <> ''),
  embedding extensions.halfvec(1024) not null,
  search tsvector generated always as (to_tsvector('private.es'::regconfig, content)) stored,
  unique (game_day_id, position)
);

comment on table public.chapter_chunks is 'Published chapters cut into chunks: a fallback index for days whose moments are missing.';

create index chapter_chunks_search_idx on public.chapter_chunks using gin (search);

-- No HNSW index: a search is always within one season, a few hundred rows, where an exact scan is
-- fast and loses nothing to an approximate index that filtering would make miss rows.

do $$
declare
  table_name text;
begin
  foreach table_name in array array['memories', 'chapter_chunks'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated, service_role', table_name);
    execute format('grant select on table public.%I to service_role', table_name);
    execute format('revoke all on sequence public.%I from anon, authenticated, service_role', table_name || '_id_seq');
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Writing functions
-- -----------------------------------------------------------------------------

create function private.store_chapter_chunks(p_game_day_id bigint, p_chunks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.game_day_state;
begin
  select state into v_state from public.game_days where id = p_game_day_id for update;
  if not found or v_state <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'not_published');
  end if;
  if exists (select 1 from public.chapter_chunks where game_day_id = p_game_day_id) then
    return jsonb_build_object('ok', true, 'status', 'already_stored');
  end if;
  -- Nothing stored would read as done, and the next call would store again.
  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_chunks');
  end if;

  begin
    insert into public.chapter_chunks (game_day_id, position, content, embedding)
    select p_game_day_id, chunk.position, chunk.value ->> 'content', (chunk.value ->> 'embedding')::extensions.halfvec(1024)
    from jsonb_array_elements(p_chunks) with ordinality as chunk (value, position);
  exception
    when check_violation or not_null_violation or data_exception then
      return jsonb_build_object('ok', false, 'error', 'invalid_chunks');
  end;

  return jsonb_build_object('ok', true, 'status', 'stored');
end;
$$;

comment on function private.store_chapter_chunks(bigint, jsonb) is 'Stores a published chapter''s chunks with their embeddings, once.';

create function private.store_moments(p_game_day_id bigint, p_summary text, p_moments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.game_days;
  v_written_at timestamptz;
  v_moment jsonb;
  v_new_id bigint;
  v_target bigint;
begin
  -- Locks the day, so that two closes running at once write its moments once.
  select * into v_day from public.game_days where id = p_game_day_id for update;
  if not found or v_day.state <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'not_published');
  end if;
  select moments_written_at into v_written_at from public.chapters where game_day_id = p_game_day_id;
  if v_written_at is not null then
    return jsonb_build_object('ok', true, 'status', 'already_written');
  end if;
  -- No moments can be right, when every one was already known; no summary never is, and it would
  -- mark the day done for good.
  if jsonb_typeof(p_moments) is distinct from 'array'
    or jsonb_array_length(p_moments) > 20
    or coalesce(btrim(p_summary), '') = ''
    or char_length(p_summary) > 600
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_moment');
  end if;

  -- A block of its own: any violation undoes every moment it wrote, and the day stays pending.
  begin
    for v_moment in select value from jsonb_array_elements(p_moments) loop
      insert into public.memories (season_id, game_day_id, content, characters, joke, importance, embedding)
      values (
        v_day.season_id,
        p_game_day_id,
        v_moment ->> 'content',
        array(select jsonb_array_elements_text(v_moment -> 'characters')),
        v_moment ->> 'joke',
        (v_moment ->> 'importance')::bigint,
        (v_moment ->> 'embedding')::extensions.halfvec(1024)
      )
      returning id into v_new_id;

      v_target := (v_moment ->> 'supersedes')::bigint;
      if v_target is not null then
        -- Only a current moment of this season, from an earlier day: code chose it among the nearest.
        update public.memories as memory
        set superseded_by = v_new_id
        from public.game_days as source_day
        where memory.id = v_target
          and memory.season_id = v_day.season_id
          and memory.superseded_by is null
          and source_day.id = memory.game_day_id
          and source_day.day < v_day.day;
        if not found then
          raise exception using errcode = 'CRSUP';
        end if;
      end if;
    end loop;

    update public.chapters
    set summary = p_summary, moments_written_at = now()
    where game_day_id = p_game_day_id;
  exception
    when sqlstate 'CRSUP' then
      return jsonb_build_object('ok', false, 'error', 'invalid_supersedes');
    when check_violation or not_null_violation or data_exception then
      return jsonb_build_object('ok', false, 'error', 'invalid_moment');
  end;

  return jsonb_build_object('ok', true, 'status', 'written');
end;
$$;

comment on function private.store_moments(bigint, text, jsonb) is 'Writes a published chapter''s moments and summary as one step, once. A moment that supersedes another marks it with superseded_by.';

create function public.store_chapter_chunks(p_game_day_id bigint, p_chunks jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.store_chapter_chunks(p_game_day_id, p_chunks); $$;

create function public.store_moments(p_game_day_id bigint, p_summary text, p_moments jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.store_moments(p_game_day_id, p_summary, p_moments); $$;

-- -----------------------------------------------------------------------------
-- Search
-- -----------------------------------------------------------------------------

create type public.memory_source as enum ('moments', 'chunks');

create function public.hybrid_search(
  p_season_id bigint,
  p_query text,
  p_embedding extensions.halfvec(1024),
  p_match_count integer default 20,
  p_source public.memory_source default 'moments',
  p_exclude_days date[] default '{}',
  p_rrf_k integer default 50
)
returns table (
  id bigint,
  day date,
  content text,
  characters text[],
  joke text,
  importance bigint,
  joke_last_day date,
  vector_rank bigint,
  text_rank bigint,
  name_rank bigint,
  rrf_score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select memory.id, game_day.day, memory.content, memory.characters, memory.joke,
      memory.importance, memory.embedding, memory.search
    from public.memories as memory
    join public.game_days as game_day on game_day.id = memory.game_day_id
    where p_source = 'moments'
      and memory.season_id = p_season_id
      and memory.superseded_by is null
      and game_day.day <> all (coalesce(array_remove(p_exclude_days, null), '{}'))
    union all
    select chunk.id, game_day.day, chunk.content, '{}'::text[], null, null, chunk.embedding, chunk.search
    from public.chapter_chunks as chunk
    join public.game_days as game_day on game_day.id = chunk.game_day_id
    where p_source = 'chunks'
      and game_day.season_id = p_season_id
      and game_day.day <> all (coalesce(array_remove(p_exclude_days, null), '{}'))
  ),
  -- Each list reaches twice as deep as the answer, so a row just past one list's cut still adds.
  -- Any of the query's words, not all of them: an action is a sentence, not a list of keywords.
  query as (
    select replace(plainto_tsquery('private.es'::regconfig, p_query)::text, ' & ', ' | ')::tsquery as terms
  ),
  vector_list as (
    select candidate.id,
      row_number() over (order by candidate.embedding operator(extensions.<=>) p_embedding, candidate.id) as rank
    from candidates as candidate
    order by rank
    limit p_match_count * 2
  ),
  text_list as (
    select candidate.id,
      row_number() over (order by ts_rank_cd(candidate.search, query.terms) desc, candidate.id) as rank
    from candidates as candidate, query
    where candidate.search @@ query.terms
    order by rank
    limit p_match_count * 2
  ),
  -- Names, nicknames and joke labels, which embeddings and stemming blur.
  name_scores as (
    select candidate.id,
      max(extensions.word_similarity(
        extensions.unaccent('extensions.unaccent'::regdictionary, alias),
        extensions.unaccent('extensions.unaccent'::regdictionary, p_query)
      )) as score
    from candidates as candidate,
      unnest(candidate.characters || coalesce(array[candidate.joke], '{}'::text[])) as alias
    group by candidate.id
  ),
  name_list as (
    select name_score.id, row_number() over (order by name_score.score desc, name_score.id) as rank
    from name_scores as name_score
    where name_score.score >= 0.6
    order by rank
    limit p_match_count * 2
  ),
  fused as (
    select coalesce(vector_list.id, text_list.id, name_list.id) as id,
      vector_list.rank as vector_rank,
      text_list.rank as text_rank,
      name_list.rank as name_rank,
      coalesce(1.0 / (p_rrf_k + vector_list.rank), 0)
        + coalesce(1.0 / (p_rrf_k + text_list.rank), 0)
        + coalesce(1.0 / (p_rrf_k + name_list.rank), 0) as rrf_score
    from vector_list
    full join text_list on text_list.id = vector_list.id
    full join name_list on name_list.id = coalesce(vector_list.id, text_list.id)
  )
  select candidate.id, candidate.day, candidate.content, candidate.characters, candidate.joke,
    candidate.importance,
    (
      select max(joke_day.day)
      from public.memories as same_joke
      join public.game_days as joke_day on joke_day.id = same_joke.game_day_id
      where same_joke.season_id = p_season_id and same_joke.joke = candidate.joke
    ) as joke_last_day,
    fused.vector_rank, fused.text_rank, fused.name_rank, fused.rrf_score::double precision
  from fused
  join candidates as candidate on candidate.id = fused.id
  order by fused.rrf_score desc, candidate.id
  limit p_match_count;
$$;

comment on function public.hybrid_search(bigint, text, extensions.halfvec, integer, public.memory_source, date[], integer) is 'Searches a season''s current moments, or its chapter chunks, with vector, full-text and trigram lists fused by Reciprocal Rank Fusion. Each list''s rank comes back, so a ranking can be explained.';

create function public.nearest_moments(
  p_season_id bigint,
  p_embedding extensions.halfvec(1024),
  p_before_day date,
  p_count integer default 5
)
returns table (id bigint, day date, content text, distance double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select memory.id, game_day.day, memory.content,
    (memory.embedding operator(extensions.<=>) p_embedding)::double precision as distance
  from public.memories as memory
  join public.game_days as game_day on game_day.id = memory.game_day_id
  where memory.season_id = p_season_id
    and memory.superseded_by is null
    -- What store_moments accepts to supersede: a day written late never reaches a later one.
    and game_day.day < p_before_day
  order by distance, memory.id
  limit p_count;
$$;

comment on function public.nearest_moments(bigint, extensions.halfvec, date, integer) is 'A season''s current moments closest to an embedding: what a new moment is compared with.';

-- New functions are executable by PUBLIC, and the project's default privileges add the API roles.
do $$
declare
  signature text;
begin
  foreach signature in array array[
    'private.store_chapter_chunks(bigint, jsonb)',
    'private.store_moments(bigint, text, jsonb)',
    'public.store_chapter_chunks(bigint, jsonb)',
    'public.store_moments(bigint, text, jsonb)',
    'public.hybrid_search(bigint, text, extensions.halfvec, integer, public.memory_source, date[], integer)',
    'public.nearest_moments(bigint, extensions.halfvec, date, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- The reset
-- -----------------------------------------------------------------------------

create or replace function private.reset_preseason()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season_id bigint;
begin
  if exists (
    select 1
    from public.seasons
    where number >= 1 and starts_on <= (now() at time zone 'Europe/Madrid')::date
  ) then
    return jsonb_build_object('ok', false, 'error', 'season_started');
  end if;

  select id into v_season_id from public.seasons where number = 0;
  if not found then
    return jsonb_build_object('ok', true, 'status', 'nothing_to_reset');
  end if;

  -- One statement: a moment and the one that superseded it go together.
  delete from public.memories where season_id = v_season_id;

  delete from public.chapter_chunks as chunk
  using public.game_days as game_day
  where game_day.id = chunk.game_day_id and game_day.season_id = v_season_id;

  delete from public.charges as charge
  using public.actions as action, public.game_days as game_day
  where action.id = charge.action_id
    and game_day.id = action.game_day_id
    and game_day.season_id = v_season_id;

  delete from public.awards as award
  using public.actions as action, public.game_days as game_day
  where action.id = award.action_id
    and game_day.id = action.game_day_id
    and game_day.season_id = v_season_id;

  delete from public.action_contents as content
  using public.actions as action, public.game_days as game_day
  where action.id = content.action_id
    and game_day.id = action.game_day_id
    and game_day.season_id = v_season_id;

  delete from public.actions as action
  using public.game_days as game_day
  where game_day.id = action.game_day_id and game_day.season_id = v_season_id;

  delete from public.hints as hint
  using public.game_days as game_day
  where game_day.id = hint.game_day_id and game_day.season_id = v_season_id;

  delete from public.chapters as chapter
  using public.game_days as game_day
  where game_day.id = chapter.game_day_id and game_day.season_id = v_season_id;

  delete from public.character_statuses as status
  using public.game_days as game_day
  where game_day.id = status.game_day_id and game_day.season_id = v_season_id;

  delete from public.items where season_id = v_season_id;

  delete from public.debts as debt
  using public.characters as character
  where character.id = debt.debtor_character_id and character.season_id = v_season_id;

  delete from public.game_days where season_id = v_season_id;

  update public.characters set balance = 10 where season_id = v_season_id;

  return jsonb_build_object('ok', true, 'status', 'reset');
end;
$$;

comment on function private.reset_preseason() is 'Removes the pre-season''s days, actions, chapters, canon, memory and quotas and returns its balances to 10, keeping its characters, the players and the ledger. It refuses once season 1 has started.';
