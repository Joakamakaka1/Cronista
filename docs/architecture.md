# Architecture

Summary of the architecture document (private). It only covers what you need to work on the code.

## Components

| Component       | Where                | Technology                                                                                                                      |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Front end (PWA) | `apps/web`           | Static SvelteKit, provisional until the visual spike (ADR-15)                                                                   |
| Game API        | `services/core-api`  | Node 24 arm64 Lambda + Function URL at `/api/*`, behind CloudFront with OAC (ADR-23)                                            |
| AI hint API     | `services/ai-api`    | Lambda + Function URL at `/api/ai/*`: one hint per player and day, with reserved concurrency                                    |
| Day worker      | `services/ai-worker` | Lambda without a URL, run by EventBridge Scheduler: opens the day and resolves it at closing time, idempotent per (season, day) |
| Notifications   | `services/notifier`  | Lambda fed by SQS and Scheduler: Web Push with VAPID (ADR-16) and the reminders at 19:00 and 21:00                              |
| Domain          | `packages/core`      | Types, Zod schemas and calendar rules; no Node dependencies                                                                     |
| API edge        | `packages/http`      | Session JWT verification, request bodies and JSON responses for `core-api` and `ai-api`                                         |
| Narrator        | `packages/narrator`  | AI SDK 7 + Claude Haiku 5.5, RAG memory, tools and context budget                                                               |
| Database        | `packages/db`        | Supabase migrations, pgTAP tests and generated types                                                                            |
| Infrastructure  | `infra`              | AWS CDK (eu-west-1 + us-east-1)                                                                                                 |
| Evaluation      | `evals`              | promptfoo, datasets and judges (Sonnet 5.5)                                                                                     |

## Flows

1. **Open**: at 08:00 (Europe/Madrid) Scheduler runs `ai-worker`, which writes the day's situation → `notifier` tells the five players.
2. **Play**: each player sends one action per day, not editable once sent. The phone sends it to `/api/*` → CloudFront signs the request to the Function URL → `core-api` verifies the Supabase JWT (`X-Session-Token` header, ES256 JWKS), validates it with Zod, stores it and queues "X has played" → `notifier` tells the others. The phone then asks `/api/ai/*` for the hint → `ai-api` checks the quota (one a day) and answers with Haiku.
3. **Remind**: Scheduler runs `notifier` at 19:00 and 21:00 (T-3 h and T-1 h before the close), and only the players who are missing get a reminder.
4. **Resolve**: at 22:00 (Europe/Madrid) `ai-worker` applies autopilot to absent players → narrator → validation in code → chapter and points → memory extraction → "Chapter published" alert.

The phone only talks to Supabase directly to sign in, read through RLS and receive live events. Everything else goes through CloudFront.

## Edge and API contract

CloudFront routes `/api/ai/*` to `ai-api`, `/api/*` to `core-api` and everything else to the static site in S3. Until the SvelteKit app exists, the site is the placeholder in `apps/web/placeholder`, whose connection check calls both APIs the way the app will.

- **Every API request** carries the Supabase access token in `X-Session-Token`. `Authorization` is taken by the signature of CloudFront's origin access control, which also needs the hex SHA-256 of the body in `x-amz-content-sha256` on every POST and PUT. The API answers only over HTTPS: plain HTTP gets a 403, never a redirect.
- **Bodies** are JSON of at most 8 KB: the WAF blocks larger ones, and `core-api` answers 413 if one gets through. A day's action is at most 1000 characters (`MAX_ACTION_CHARACTERS` in `@cronista/core`).
- **Errors** are JSON `{ "error": "<code>" }` and never cached: 401 `unauthorized` (sign in again), 503 `auth_unavailable` (the key set could not be read; keep the session and retry), 400 `invalid_body`, 413 `too_large`, 404 `not_found`, 405 `method_not_allowed` and 500 `internal`.
- **Routes today**: `GET /api/me` (the signed-in player), `POST /api/actions` (validates the action; storing it answers 501) and `POST /api/ai/hint` (body `{}`; 501 once the provider keys are readable, 503 `providers_not_configured` before).
- **At the edge**: a CloudFront Function adds the CSP (`script-src 'self'`, so no inline scripts), HSTS and the other security headers; the WAF's rate limit counts every request per IP, because the free plan rejects a scope-down by URI path.

## Data

- Supabase Postgres 17 in eu-west-1, Free plan. A keep-alive keeps it awake, and a nightly encrypted dump goes to S3.
- RLS on every table, with default privileges revoked. Authorization uses `app_metadata`, never `user_metadata`.
- `security definer` functions with `search_path = ''`, outside the exposed schemas. Views with `security_invoker = true`.
- Memory: atomic "moments" in pgvector with hybrid search (vector + text) fused with RRF. `voyage-4` embeddings for documents and `voyage-4-lite` for queries.
- **Canonical state wins over memory**: what the database says overrides what the narrator remembers.

## AI

- Narrator: Haiku 5.5 through `@ai-sdk/anthropic`, pinned to exact versions. The context is counted before every call, capped at 85k tokens (above 100k the price multiplies).
- Mixed retrieval: a fixed bundle + top-k + 3 tools with a call limit. The same tools are exposed as a local MCP server for Claude Code.
- The output JSON never asks for a "reasoning" field. If the classifier rejects a response, a narrative fallback is used.
- Budget: our own spend ledger per credit cycle, and three Claude Console workspaces (`game-prod`, `evals` and `dev`) with limits as a safety net.

## Infrastructure and security

- Only CloudFront is public, at `cronista.jcvstro.dev`: free flat-rate plan with a 5-rule WAF. S3 and the Function URLs only accept requests signed by the distribution.
- `jcvstro.dev` is in Cloudflare, which delegates `cronista.jcvstro.dev` to a Route 53 zone in the flat-rate plan; the CloudFront certificate lives in us-east-1.
- Security headers (CSP, HSTS…) are set with a response CloudFront Function.
- GitHub Actions reaches AWS through OIDC roles (read-only for PRs, deploy only from the `production` environment, write-only backups). CloudFormation deploys with an execution policy that is also the permissions boundary of every role: it denies IAM users, unbounded roles, blinding CloudTrail or Access Analyzer, and loosening its own limits.
- One minimal IAM role per Lambda. Secrets in SSM Parameter Store (`SecureString`, `/cronista/prod/…`), read through the Lambda extension. Never in plain environment variables.
- The AWS account ID and resource IDs stay out of the repo: the CDK takes them from the environment (`CDK_DEFAULT_ACCOUNT`) or from lookups.

## Infrastructure as code (ADR-22)

- **CDK owns everything in AWS** (`infra`). CloudFormation keeps the state for free and rolls back failed deploys, and the stacks are TypeScript with the same lint and tests as the rest of the monorepo.
- **Terraform (or OpenTofu) only for what is not AWS**, starting with GitHub (the `master` ruleset and repo settings) in CR-19. Supabase follows when its provider leaves alpha. The few settings no tool covers are listed in `development.md`.
- **Revisit CDK if** a stack gets stuck (`UPDATE_ROLLBACK_FAILED` or `DELETE_FAILED`) and needs a manual fix more than once, an AWS feature we need takes more than a month to reach CloudFormation, cross-region references keep forcing multi-step deploys, a stack nears 500 resources, or CI deploys get slow enough to get in the way.

## Code

- Internal packages export their TypeScript source (`exports: ./src/index.ts`) and have no build step. Lambdas are bundled with esbuild (CDK `NodejsFunction`) and the web app with Vite. Scripts and the CDK run on Node 24's native TypeScript support, hence `erasableSyntaxOnly` and relative imports with the `.ts` extension.
- `packages/core` cannot depend on Node or AWS: it also runs in the browser.
