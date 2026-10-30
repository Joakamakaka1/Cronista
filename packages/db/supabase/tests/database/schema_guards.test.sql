-- Rules for every table and policy in the exposed schema, so future migrations cannot skip them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  $$,
  'every table in public has RLS enabled'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
  $$,
  'anon has no privileges on tables or views in public'
);

-- These bypass RLS or outlive a revoked grant, and the default privileges of the project still hand them out.
select is_empty(
  $$
    select c.relname, r.rolname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('authenticated'), ('service_role')) as r (rolname)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_table_privilege(r.rolname, c.oid, 'TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
  $$,
  'API roles have no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on public tables'
);

-- Identity sequences are filled by the table's own inserts; a direct grant would allow setval.
select is_empty(
  $$
    select c.relname, r.rolname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r (rolname)
    where n.nspname = 'public'
      and c.relkind = 'S'
      and has_sequence_privilege(r.rolname, c.oid, 'USAGE, SELECT, UPDATE')
  $$,
  'API roles have no privileges on sequences in public'
);

select is_empty(
  $$
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and 'authenticated' = any (roles)
      and coalesce(qual, '') || coalesce(with_check, '') not like '%private.is_player()%'
  $$,
  'every policy for authenticated calls private.is_player()'
);

select is_empty(
  $$ select tablename, policyname from pg_policies where schemaname = 'public' and 'public' = any (roles) $$,
  'no policy applies to every role'
);

select * from finish();
rollback;
