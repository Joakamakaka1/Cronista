# Security notes

What the security reviewer checks Cronista against, as pointers to where each rule already lives:

- **Secrets, public values and personal data**: "Secrets and player data" in [`AGENTS.md`](../../AGENTS.md).
- **Auth, Lambdas and infrastructure** (the JWT checked against the JWKS on every request, OAC, one IAM role per Lambda, secrets from SSM): [`.claude/rules/infra.md`](../../.claude/rules/infra.md).
- **Database access** (RLS on every table, grants): [`.claude/rules/database.md`](../../.claude/rules/database.md).
- **Input**: every external input is parsed with Zod at the boundary ([`.claude/rules/code-style.md`](../../.claude/rules/code-style.md)).
- **Written nowhere else**: authorisation uses `app_metadata`, never client-sent identity; the security headers (CSP, HSTS) stay intact; GitHub Actions are pinned by SHA.
