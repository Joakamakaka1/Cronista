-- pgvector, for the narrator's memory.

-- Fail instead of queueing behind a held lock. `local` scopes them to this migration's transaction.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- In `extensions`, as Supabase recommends: its types and operators stay out of the exposed `public` schema.
create extension if not exists vector with schema extensions;
