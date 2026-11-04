---
paths:
  - 'packages/db/**'
  - '**/*.sql'
---

# Database (`packages/db`)

Load the `supabase-postgres-best-practices` skill before writing SQL. For a new migration, follow `/migration`.

- Supabase Postgres 17. Migrations, CLI config and pgTAP tests live in `packages/db/supabase`; run the CLI with `--workdir packages/db`.
- Expand/contract: a migration only adds or widens. `DROP`, `RENAME` and `ALTER … TYPE` go in a separate PR labelled `contract`, after the code stops using the old shape. Squawk (`pnpm --filter @cronista/db lint:sql`) rejects them otherwise: in a contract migration, mark each one with `-- squawk-ignore <rule>`.
- Pre-season exception (v1 and v2): game tables hold resettable data, so a `contract` PR may drop and rewrite them in the same PR as the code that uses the new shape, without migrating their rows. `players` and everything season 1 keeps still follow expand/contract.
- Each migration starts with `set lock_timeout` and `set statement_timeout`, so it fails instead of queueing behind a held lock.
- RLS on every table, with default privileges revoked. "Automatically expose new tables" is off in the Supabase project, so a new table is invisible to the API until its migration grants each role exactly what it needs (`grant select, insert … to authenticated`, `service_role` for the Lambdas). `anon` gets no grants: every player signs in. Policies are `TO authenticated`, except the sign-up hook's on `players` (`TO supabase_auth_admin`), and use `(select auth.uid())`. Authorise through `public.players` and `private.is_player()`, never `user_metadata` or anything else the client sends.
- Index foreign keys and the columns that policies filter on.
- Each policy has a pgTAP test, including the cases that must fail (another player's rows, the anonymous role).
- `security definer` functions set `search_path = ''` and live outside the exposed schemas. Views use `security_invoker = true`.
- Canonical game state wins over the narrator's memory: the database is the source of truth.
- Regenerate the types after every schema change and commit them with the migration. Never edit the generated types by hand.
- Seeds and fixtures use invented characters and `@example.com` emails. Never real data or dumps.
- Before the PR, run the `db-reviewer` subagent on the diff.
