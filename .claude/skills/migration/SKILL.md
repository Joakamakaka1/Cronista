---
name: migration
description: Creates a Supabase database migration for Cronista with RLS, pgTAP tests and regenerated types, following expand/contract. Use when a change needs a new table, column, index, policy or SQL function.
argument-hint: '<what the migration does>'
---

# Database migration

Load the `supabase-postgres-best-practices` skill first. The rules are in `.claude/rules/database.md`.

1. **Shape**: decide whether this is an expand step (add or widen) or a contract step (`DROP`, `RENAME`, `ALTER … TYPE`). A contract step goes in its own PR with the `contract` label, after the code stops using the old shape. If both are needed, plan two PRs and tell the user.
2. **Create**: `supabase migration new <snake_case_name> --workdir packages/db`.
3. **Write the SQL**: enable RLS and revoke default privileges on new tables, then `GRANT` each role (`authenticated`, `service_role`; never `anon`) exactly the privileges it uses, because "Automatically expose new tables" is off; policies `TO authenticated` with `(select auth.uid())`; indexes for policy predicates and foreign keys; `security definer` only with `search_path = ''`.
4. **Test**: add pgTAP tests for every policy, including the cases that must fail (another player, `anon`), and for each new table's grants per role (`table_privs_are`).
5. **Run locally**:

   ```powershell
   supabase start --workdir packages/db
   supabase db reset --workdir packages/db
   supabase test db --workdir packages/db
   pnpm --filter @cronista/db lint:sql
   ```

6. **Types**: regenerate the TypeScript types from the local database (`supabase gen types typescript --local --workdir packages/db > packages/db/src/database.types.ts`) and commit them with the migration.
7. **Seed**: if seed data changes, use invented characters and `@example.com` emails.
8. **Review**: run the `db-reviewer` subagent on the diff and fix what it finds.

Never run `supabase db push` from here: production migrations run in CI after the merge.
