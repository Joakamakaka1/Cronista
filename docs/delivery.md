# CI, deployment and repo rules

One remote environment (production): local → PR → squash merge to `master` → automatic deploy. The CI's ephemeral database is part of the tests, not a second environment.

## `master` rules (GitHub ruleset)

- It only changes through a PR. No direct pushes, force pushes or deletion.
- Squash merge is the only method (linear history). The branch is deleted on merge.
- Required checks, up to date with `master`: `code`, `secrets` and `snyk`.
- Every review thread resolved, CodeRabbit's included.
- No required approvals: there is a single developer, and the checks are the brake.

## Checks on every PR (`.github/workflows/ci.yml` and `security.yml`)

| Check        | What it does                                                                                | Status                          |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------- |
| `code`       | `pnpm check`: Prettier, type-aware ESLint, `tsc` and Vitest, through Turborepo              | ✅ Active                       |
| `secrets`    | gitleaks over the whole history with `.gitleaks.toml`                                       | ✅ Active                       |
| `snyk`       | Snyk Open Source (`security.yml`): dependencies of the whole workspace; fails on high+      | ✅ Active                       |
| `snyk-code`  | Snyk Code (`security.yml`): static analysis; reports only, does not block                   | ✅ Active (not required)        |
| `db`         | `supabase db start` → `db reset` → pgTAP → generated types unchanged → destructive SQL lint | Once the first migration exists |
| `evals`      | N1 always; N2 when AI paths change                                                          | Once the narrator exists        |
| `judge-gate` | Sonnet 5.5 judge via Batch, only with the matching label (N3)                               | Once the judge exists           |
| `cdk-diff`   | `cdk diff` with the read-only role, posted as a comment; does not block                     | Once the CDK exists             |

Every new check is added to the ruleset as required in the same PR that turns it on.

## External services

Both are on their free tier.

### CodeRabbit (PR review)

- GitHub App installed on this repo only. It is free for public repos, and its configuration is in `.coderabbit.yaml`.
- It reviews in English (like the PRs) with the `chill` profile. It ignores `pnpm-lock.yaml`, generated types (`database.types.ts`), `dist`, `.turbo` and snapshots. It has path instructions for `packages/db`, the narrator and `evals`, `infra`, `services` and `.github`.
- It uses `AGENTS.md`, `.claude/rules/*.md` and `docs/*.md` as guidelines, on top of the files it reads by default (such as `CLAUDE.md`).
- **It does not block on its own**: its commit status is not required and it does not request changes. What does block is the ruleset: its threads must be resolved before merging. If CodeRabbit does not review (limits or an outage), the PR can still be merged.
- Talk to it in the PR with `@coderabbitai` (for example `@coderabbitai review` or `@coderabbitai resolve`).

### Snyk (vulnerabilities)

- CLI in Actions (`.github/workflows/security.yml`), without the GitHub App. Scanning through the app does not support the `workspace:` protocol, and the free tier caps it at 5 projects.
- The CLI binary is downloaded with the SHA-256 pinned in the workflow. To update it, change `SNYK_VERSION` and `SNYK_SHA256` to the value at `https://downloads.snyk.io/cli/v<version>/snyk-linux.sha256`, respecting the one-day margin of `minimumReleaseAge`.
- It runs on every PR, on every push to `master`, every Monday (for CVEs published after the merge) and by hand.
- `snyk`: `snyk test --all-projects --dev --fail-fast --severity-threshold=high`. It includes `devDependencies`, because almost all of the repo is build and test tooling, and it fails if any project cannot be analysed. It reads `pnpm-lock.yaml` (lockfile 9.x) and is **required**.
- `snyk-code`: `snyk code test` in report-only mode. It only fails on real errors (exit code 2 or 3), not on findings. **Pending: make it blocking** once there is real code. Steps: add `--severity-threshold=high`, remove `|| [ $? -eq 1 ]` and add `snyk-code` to the ruleset.
- Results:
  - In the job log.
  - In **Security → Code scanning**, through SARIF. Dependency results get one category per workspace project (`Snyk/Open Source/<package>`); code results go to `Snyk/Code`.
- Actions secrets: `SNYK_TOKEN` and `SNYK_ORG`, the Snyk organization ID. `SNYK_ORG` is a secret rather than a variable so it stays out of the public logs; without it, Snyk Code answers `SNYK-CODE-0005`. PRs from forks do not get it, so their `snyk` check fails. That is intended: an external PR cannot skip the check.
- Ignoring a finding: in `.snyk`, always with a reason and an expiry date (`snyk ignore --id=… --reason=… --expiry=…`).
- Free-tier limits: according to Snyk's documentation, they only apply to private repos. For private repos, Snyk Code has 100 tests a month and counts one per scanned repository; Open Source counts one test per analysed manifest. If the check starts failing because of quota, check the usage on snyk.io (Settings → Usage).

## Public repo security

- No workflow uses `pull_request_target`. PRs from forks get no secrets and cannot assume roles: OIDC trust is limited to this repo and its branches.
- Actions are pinned by SHA (Dependabot keeps them current). Only GitHub's actions and the allow-listed ones are permitted.
- `permissions: contents: read` by default. Each job asks only for what it uses.
- Three layers against leaks: gitleaks on pre-commit, gitleaks in CI, and GitHub secret scanning with push protection.

## Deployment (pending: skeleton phase)

`deploy.yml` on every push to `master`, with `concurrency: prod` and without cancelling the run in progress:

1. Waits while inside the deploy freeze, 22:30 to 00:00 Europe/Madrid (`isDeployFrozen` from `@cronista/core`).
2. Fast tests.
3. Database dump to the private backup bucket.
4. `supabase db push --dry-run` and, if it looks right, `supabase db push`.
5. `cdk deploy --all --require-approval never` (through a change set; never `--hotswap`).
6. Lambda canary with a pre-traffic hook.
7. Smoke test against `cronista.jcvstro.dev`.

If the failure shows up later, `git revert` deploys the previous version again. The database only gets forward migrations.

## AWS OIDC roles (pending)

| Role      | Trusts                         | Permissions                                        |
| --------- | ------------------------------ | -------------------------------------------------- |
| Read-only | `pull_request` from this repo  | `cdk diff` and reading the private datasets prefix |
| Deploy    | Only `ref:refs/heads/master`   | CDK deployment                                     |
| Backups   | Scheduled workflow on `master` | Writing to the S3 backup prefix                    |

Repos created after 2026-07-15 use a `sub` with immutable IDs (`repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:…`), so the trust policy is written with IDs, not names.
