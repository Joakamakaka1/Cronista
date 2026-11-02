# Architecture

Summary of the architecture document (private). It only covers what you need to work on the code.

## Diagram

![Cronista production architecture](architecture.svg)

It is large: open [`architecture.svg`](architecture.svg) at full size to read it. The source is [`architecture.drawio`](architecture.drawio): edit it in draw.io (desktop app, VS Code extension or app.diagrams.net) and export it again as `architecture.svg` in the same change. Calls whose code is still a stub are drawn as planned, and calls that only deploys or self-checks make are left to the labels of their boxes.

## Components

| Component       | Where                 | Technology                                                                                                                      |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Front end (PWA) | `apps/web`            | Static SvelteKit, provisional until the visual spike (ADR-15)                                                                   |
| Game API        | `services/core-api`   | Node 24 arm64 Lambda + Function URL at `/api/*`, behind CloudFront with OAC (ADR-23)                                            |
| AI hint API     | `services/ai-api`     | Lambda + Function URL at `/api/ai/*`: one hint per player and day, with reserved concurrency                                    |
| Day worker      | `services/ai-worker`  | Lambda without a URL, run by EventBridge Scheduler: opens the day and resolves it at closing time, idempotent per (season, day) |
| Notifications   | `services/notifier`   | Lambda fed by an SQS queue, where Scheduler also queues the reminders at 19:00 and 21:00: Web Push with VAPID (ADR-16)          |
| Domain          | `packages/core`       | Types, Zod schemas and calendar rules; no Node dependencies                                                                     |
| API edge        | `packages/http`       | Session JWT verification, request bodies and JSON responses for `core-api` and `ai-api`; the check of the public site           |
| SSM parameters  | `packages/parameters` | The Lambdas' SecureString parameters, read through the Parameters and Secrets extension                                         |
| Narrator        | `packages/narrator`   | AI SDK 7 + Claude Haiku 5.5, RAG memory, tools and context budget                                                               |
| Database        | `packages/db`         | Supabase migrations, pgTAP tests and generated types                                                                            |
| Infrastructure  | `infra`               | AWS CDK (eu-west-1 + us-east-1)                                                                                                 |
| Evaluation      | `evals`               | promptfoo, datasets and judges (Sonnet 5.5)                                                                                     |

## Flows

1. **Open**: at 08:00 (Europe/Madrid) Scheduler runs `ai-worker`, which writes the day's situation → `notifier` tells the five players.
2. **Play**: each player sends one action per day, not editable once sent. The phone sends it to `/api/*` → CloudFront signs the request to the Function URL → `core-api` verifies the Supabase JWT (`X-Session-Token` header, ES256 JWKS), validates it with Zod, stores it and queues "X has played" → `notifier` tells the others. The phone then asks `/api/ai/*` for the hint → `ai-api` checks the quota (one a day) and answers with Haiku.
3. **Remind**: Scheduler queues a reminder for `notifier` at 19:00 and 21:00 (T-3 h and T-1 h before the close), and only the players who are missing get it.
4. **Resolve**: at 22:00 (Europe/Madrid) `ai-worker` applies autopilot to absent players → narrator → validation in code → chapter and points → memory extraction → "Chapter published" alert.

The phone only talks to Supabase directly to sign in, read through RLS and receive live events. Everything else goes through CloudFront. Until the SvelteKit app exists it only signs in, which is a redirect: the CSP's `connect-src 'self'` will need the Supabase URL for the rest.

## Edge and API contract

CloudFront routes `/api/ai/*` to `ai-api`, `/api/*` to `core-api` and everything else to the static site in S3. Until the SvelteKit app exists, the site is the placeholder in `apps/web/placeholder`, whose connection check calls both APIs the way the app will.

- **Every API request** carries the Supabase access token in `X-Session-Token`. `Authorization` is taken by the signature of CloudFront's origin access control, which also needs the hex SHA-256 of the body in `x-amz-content-sha256` on every POST and PUT. The API answers only over HTTPS: plain HTTP gets a 403, never a redirect.
- **Bodies** are JSON of at most 8 KB: the WAF blocks larger ones, and `core-api` answers 413 if one gets through. `ai-api` takes 1 KB at most, and answers 413 above that. A day's action is at most 1000 characters (`MAX_ACTION_CHARACTERS` in `@cronista/core`).
- **Errors** are JSON `{ "error": "<code>" }` and never cached: 401 `unauthorized` (sign in again), 503 `auth_unavailable` (the key set could not be read; keep the session and retry), 400 `invalid_body`, 413 `too_large`, 404 `not_found`, 405 `method_not_allowed`, 500 `internal`, and for routes still to build, 501 `not_implemented` and 503 `providers_not_configured`.
- **Routes today**: `GET /api/me` (the signed-in player), `POST /api/actions` (validates the action; storing it answers 501), `POST /api/client-errors` (an uncaught error in a player's browser, with no free text; 204) and `POST /api/ai/hint` (body `{}`; 501 once the provider keys are readable, 503 `providers_not_configured` before).
- **At the edge**: a CloudFront Function adds the CSP (`script-src 'self'`, so no inline scripts), HSTS and the other security headers; the WAF's rate limit counts every request per IP (300 every 5 minutes, cached assets included), because the free plan rejected limiting it to `/api/`.

## Data

- Supabase Postgres 17 in eu-west-1, Free plan. A daily keep-alive tries to keep it awake, which Supabase does not promise, and a nightly encrypted dump goes to S3, restored into a throwaway Postgres first to check it.
- RLS on every table, with default privileges revoked. Authorization goes through `public.players` and `private.is_player()`, never `user_metadata` or anything else the client sends.
- `security definer` functions with `search_path = ''`, outside the exposed schemas. Views with `security_invoker = true`.
- Memory: atomic "moments" in pgvector with hybrid search (vector + text) fused with RRF. `voyage-4` embeddings for documents and `voyage-4-lite` for queries.
- **Canonical state wins over memory**: what the database says overrides what the narrator remembers.

## AI

- Narrator: Haiku 5.5 through `@ai-sdk/anthropic`, pinned to exact versions. The context is counted before every call, capped at 85k tokens (above 100k the price multiplies).
- Mixed retrieval: a fixed bundle + top-k + 3 tools with a call limit. The same tools are exposed as a local MCP server for Claude Code.
- The output JSON never asks for a "reasoning" field. If the classifier rejects a response, a narrative fallback is used.
- Spend guards: AWS Budgets and Cost Anomaly Detection (`CronistaAccountGuards`) see only AWS, never the Anthropic bill. Anthropic's spend has three Claude Console workspaces (`game-prod`, `evals` and `dev`) with limits as a safety net, and a spend ledger of our own per credit cycle that alerts on the account alerts topic at a threshold. The ledger is planned, and the diagram draws it so.

## Infrastructure and security

- Only CloudFront is public, at `cronista.jcvstro.dev`: free flat-rate plan with a WAF of 4 rules (the plan allows 5), serving only the 27 EU members and Canada. S3 and the Function URLs only accept requests signed by the distribution.
- `jcvstro.dev` is in Cloudflare, which delegates `cronista.jcvstro.dev` to a Route 53 zone in the flat-rate plan; the CloudFront certificate lives in us-east-1.
- Security headers (CSP, HSTS…) are set with a response CloudFront Function.
- GitHub Actions reaches AWS through OIDC roles (read-only for PRs and plans, deploy only from the `production` environment, the front only from `production-web`, write-only backups). The backend deploys after one approval of its plan; the front deploys on every merge. CloudFormation deploys with an execution policy that is also the permissions boundary of every role the app creates: it denies IAM users, unbounded roles, blinding CloudTrail, Access Analyzer or GuardDuty, loosening its own limits, and touching the stacks only the owner deploys. A second policy denies the bootstrap deploy roles those same stacks.
- GuardDuty watches both regions (`CronistaThreatDetection-*`, deployed by the owner) and sends findings of medium severity or higher to the account alerts topic, like the Access Analyzer findings, as readable text. The CloudTrail trail lives in `CronistaAuditTrail`, also deployed by the owner.
- `CronistaWorkers` holds `ai-worker`, `notifier`, the notifications queue and the schedules (group `cronista`, Europe/Madrid). Failed or dropped jobs, notifier errors and anything in either dead-letter queue (notifications, undelivered schedules) raise an alarm on the account alerts topic. Until phase 3 opening and closing the day and sending the notifications are stubs: those handlers validate their input, check that their SSM keys are readable and log the game day. The keep-alive, the reports of finished jobs, the checks of the game loop and the check of the public site are real.
- `ai-worker` reports each finished `open-day` and `close-day` as a metric. At 08:30 and 22:30 `notifier` checks for that report and emails the alerts topic when it is missing, which catches a schedule that never fires and a job that ends without publishing. An alarm with missing data as breaching catches the checks themselves stopping (`development.md`, "The deadlines").
- The API Lambdas alarm on the 5xx of their Function URLs, and one alarm covers any throttled Lambda in the region. An owner's kill switch stops both APIs at night without a deploy (`development.md`).
- Two alarms watch what the Lambda alarms never see, each with a one-hour period so that a long failure sends one email. `ClientErrors` fires when a signed-in player's browser reports an uncaught error. `SiteCheckFailedAlarm` fires when the public site fails the check that `notifier` runs every hour from 08:00 to 23:00, which covers CloudFront, DNS and the certificate between deploys (`development.md`, "Errors in the browser" and "The public site").
- The deploy workflows' smoke tests invoke `core-api` directly, which requests the public site from eu-west-1: the geo restriction refuses GitHub's runners (`delivery.md`, "The smoke test").
- One minimal IAM role per Lambda. Secrets in SSM Parameter Store (`SecureString`, `/cronista/prod/…`), read through the Lambda extension. Never in plain environment variables.
- The AWS account ID and resource IDs stay out of the repo: the CDK takes them from the environment (`CDK_DEFAULT_ACCOUNT`) or from lookups.

## Infrastructure as code (ADR-22)

- **CDK owns everything in AWS** (`infra`). CloudFormation keeps the state for free and rolls back failed deploys, and the stacks are TypeScript with the same lint and tests as the rest of the monorepo.
- **Terraform only for what is not AWS** (`terraform`): GitHub (the `master` ruleset, repo settings, environments and Actions permissions) and the Cloudflare delegation. It runs from the owner's machine, and CI only plans. Terraform over OpenTofu: both would do, the state holds no secrets for OpenTofu's encryption to protect, and Terraform is the wider standard.
- **Supabase stays in the Dashboard**, with a daily read-only check that fails when its settings drift, because its provider's stability is unconfirmed and its state would hold the Google OAuth secret.
- "Who owns what" in `delivery.md` lists every tool's share, including what stays by hand.
- **Revisit CDK if** a stack gets stuck (`UPDATE_ROLLBACK_FAILED` or `DELETE_FAILED`) and needs a manual fix more than once, an AWS feature we need takes more than a month to reach CloudFormation, cross-region references keep forcing multi-step deploys, a stack nears 500 resources, or CI deploys get slow enough to get in the way.

## Code

- Internal packages export their TypeScript source (`exports: ./src/index.ts`) and have no build step. Lambdas are bundled with esbuild (CDK `NodejsFunction`) and the web app with Vite. Scripts and the CDK run on Node 24's native TypeScript support, hence `erasableSyntaxOnly` and relative imports with the `.ts` extension.
- `packages/core` cannot depend on Node or AWS: it also runs in the browser.
