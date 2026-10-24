---
paths:
  - 'packages/db/**'
  - '**/*.sql'
---

# Database (`packages/db`)

Load the `supabase-postgres-best-practices` skill before writing SQL. For a new migration, follow `/migration`.

- Supabase Postgres 17. Migrations, CLI config and pgTAP tests live in `packages/db/supabase`; run the CLI with `--workdir packages/db`.
- Expand/contract: a migration only adds or widens. `DROP`, `RENAME` and `ALTER … TYPE` go in a separate PR labelled `contract`, after the code stops using the old shape.
- RLS on every table, with default privileges revoked. Policies are `TO authenticated` and use `(select auth.uid())`. Authorise with `app_metadata`, never `user_metadata`.
- Each policy has a pgTAP test, including the cases that must fail (another player's rows, the anonymous role).
- `security definer` functions set `search_path = ''` and live outside the exposed schemas. Views use `security_invoker = true`.
- Canonical game state wins over the narrator's memory: the database is the source of truth.
- Regenerate the types after every schema change and commit them with the migration.
- Seeds and fixtures use invented characters and `@example.com` emails. Never real data or dumps.
- Before the PR, run the `db-reviewer` subagent on the diff.
