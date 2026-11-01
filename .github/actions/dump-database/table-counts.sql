-- What the restore check compares between production (read-only) and the restored copy: the row count
-- of every table the data dump holds, plus how many public tables have RLS on and how many policies
-- they have. Only names and numbers leave the database. The exclusions are those of `supabase db dump
-- --data-only` (see its `--dry-run`), plus the two tables of the action's `-x` flags.
select
  format('%I.%I', n.nspname, c.relname) as name,
  (xpath(
    '/row/c/text()',
    query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')
  ))[1]::text::bigint as count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and not c.relispartition
  and n.nspname !~ '^(information_schema|pg_.*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_.*|_timescaledb_.*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor)$'
  and format('%I.%I', n.nspname, c.relname) not in (
    'auth.schema_migrations',
    'storage.migrations',
    'supabase_functions.migrations',
    'storage.buckets_vectors',
    'storage.vector_indexes'
  )
union all
select 'public tables with RLS', count(*)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
union all
select 'public policies', count(*)
from pg_policies
where schemaname = 'public'
order by 1;
