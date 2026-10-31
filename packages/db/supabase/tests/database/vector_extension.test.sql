-- pgvector is installed in `extensions`, outside the exposed schema.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select has_extension('extensions', 'vector', 'vector is installed in extensions');

select is(
  (select '[1,2]'::extensions.vector(2) <=> '[2,4]'::extensions.vector(2)),
  0::double precision,
  'the cosine distance operator works'
);

select * from finish();
rollback;
