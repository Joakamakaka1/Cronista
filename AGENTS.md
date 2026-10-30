# Cronista

Private PWA for 5 friends: every day each player sends one action, which cannot be edited once sent, and at 22:00 (Europe/Madrid) an AI narrator resolves them all and publishes a chapter. **The repository is public**: read "Secrets and player data" before anything else.

## Architecture in 10 lines

1. TypeScript end to end, in a pnpm workspaces + Turborepo monorepo.
2. Front `apps/web`: static SvelteKit (provisional until the visual spike), served from private S3 by CloudFront (flat-rate plan) with WAF.
3. API `services/*`: Node 24 arm64 Lambdas with Function URLs behind CloudFront + OAC. The Supabase JWT arrives in `X-Session-Token` and is verified with JWKS.
4. Lambdas: `api` (actions), `push` (Web Push via an SQS queue), `scheduler` (reminders) and `resolver` (daily close, idempotent per season and day).
5. Data: Supabase Postgres in eu-west-1 with RLS on every table. RAG memory in pgvector with hybrid search + RRF and Voyage embeddings.
6. AI in `packages/narrator`: AI SDK 7 pinned to exact versions. Haiku 5.5 narrates and Sonnet 5.5 judges (via Batch). Traces in Langfuse Cloud EU.
7. Shared domain and Zod schemas in `packages/core`; migrations, pgTAP and generated types in `packages/db`.
8. Infrastructure with CDK in `infra` (eu-west-1, plus us-east-1 for global resources). Secrets in SSM under `/cronista/prod/`.
9. One remote environment (production). Locally, `supabase start`; CI spins up an ephemeral database.
10. Evaluation in `evals` (promptfoo + custom judges). Each PR's gates are the only brake before production.

Details in [`docs/`](docs/): `architecture.md`, `development.md` (local setup and secrets) and `delivery.md` (CI, deploy and branch rules).

## Layout

| Path                                     | What lives there                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `apps/web`                               | PWA (SvelteKit, created in the visual spike)                           |
| `services/{api,push,scheduler,resolver}` | Lambda handlers: thin, they validate and delegate to packages          |
| `packages/core`                          | Domain types, Zod schemas, calendar rules. No Node or AWS dependencies |
| `packages/narrator`                      | Prompts (Spanish), AI SDK calls, memory retrieval, context budget      |
| `packages/db`                            | Supabase migrations, pgTAP tests, generated types                      |
| `infra`                                  | CDK stacks                                                             |
| `evals`                                  | Eval datasets, promptfoo config and judges                             |
| `.claude/`                               | Agent setup: rules, subagents, skills, workflows and hooks (see below) |

Internal packages export their TypeScript source (`exports: ./src/index.ts`) with no build step. Scripts and CDK run on Node 24's native TypeScript, hence `erasableSyntaxOnly` and relative imports with the `.ts` extension.

## Commands

```powershell
pnpm install          # also enables the git hooks (gitleaks pre-commit, commit-msg)
pnpm check            # format check + lint + typecheck + test: what CI runs
pnpm format           # Prettier (write)
pnpm --filter @cronista/core test   # a single package
```

## Secrets and player data (hard rules)

- **Never** in the repo: keys, tokens, passwords, `.env` files, database dumps, the bible with real data, real games, players' names or emails, judge labels, the AWS account ID or private resource IDs. They live in SSM, `%USERPROFILE%\.secrets\cronista\` or the private bucket. The account ID and ARNs come from GitHub Actions or environment variables.
- Local secrets are in `%USERPROFILE%\.secrets\cronista\.env` (path configurable with `CRONISTA_ENV_FILE`). That file is never read, printed or copied.
- A secret is never printed, neither in chat nor in logs: no `--with-decryption`, no `echo` of variables holding keys. To check a parameter exists: `aws ssm describe-parameters`.
- No secret is written to a `.env` in the working tree, so a `/mattpocock-skills:wizard` script is never used for secrets: its template does exactly that.
- Fixtures, seeds and the simulated season use invented characters and `@example.com` emails. Langfuse traces and CloudWatch logs hold real player data: redact names, emails and identifiers before saving a capture anywhere, and never turn one into a fixture.
- If gitleaks blocks a commit, remove the data. **Never** use `--no-verify` or widen `.gitleaks.toml` without asking.
- Public by design, because they ship in the web bundle: the Supabase URL and publishable key, and the Langfuse public key.

## Ask for confirmation before

`cdk deploy`/`destroy`, `supabase db push`, `aws ssm put-parameter`/`get-parameter` and creating resources that cost money. Never deploy or merge from 21:30 to 23:00 (Europe/Madrid): it would overlap the 22:00 resolution.

## Conventions

The rules live in [`.claude/rules/`](.claude/rules/). `workflow.md` and `validation.md` load in every session; the others load when Claude touches their paths (`code-style.md` with `.ts`, `.js` and `.svelte` files).

| Rule                                           | Covers                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [`workflow.md`](.claude/rules/workflow.md)     | Language, Linear, branches, commits, PRs, versioning, dependencies |
| [`validation.md`](.claude/rules/validation.md) | Definition of done: checks, tests first, evals, real app, reviews  |
| [`code-style.md`](.claude/rules/code-style.md) | TypeScript style, comments (TSDoc), errors, structure              |
| [`database.md`](.claude/rules/database.md)     | `packages/db`: migrations, RLS, pgTAP                              |
| [`narrator.md`](.claude/rules/narrator.md)     | `packages/narrator`, `evals`: prompts, AI SDK, evals               |
| [`infra.md`](.claude/rules/infra.md)           | `infra`, `services`: CDK, IAM, Lambdas                             |

## Agent setup

- **Flows**: `/joakamakaka-skills:feature`, `:fix`, `:pre-pr` and `:pr` (the owner's personal plugin), plus Cronista's own `/migration` and `/narrator-change` (`.claude/skills/`).
- **Reviewers**: `db-reviewer`, `infra-reviewer` and `narrator-reviewer` (`.claude/agents/`) and `joakamakaka-skills:security-reviewer`, each for its zone (see "Review zones" below).
- **Plugins**: `mattpocock-skills` (grilling, domain modeling, TDD, bug diagnosis, specs and tickets), Supabase, `frontend-design` and `typescript-lsp`.
- How the permission rules and hooks work, and how to install the plugins: [`docs/development.md`](docs/development.md#working-with-ai-agents).

## Agent skills

### Issue tracker

Linear, team CR, through the Linear MCP tools. See `docs/agents/issue-tracker.md`.

### Triage labels

The five triage roles map to Linear workflow states, not labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single context (`GLOSSARY.md`, `docs/adr/`). Glossary terms are in English; when players see a different Spanish word, add `_Players see_: <word>` after the definition. See `docs/agents/domain.md`.

### Review zones

What counts as a light PR, the critical zones and their reviewers. See `.claude/rules/validation.md`.

### Security notes

What the security reviewer checks against. See `docs/agents/security.md`.
