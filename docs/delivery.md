# CI, deployment and repo rules

One remote environment (production): local → PR → squash merge to `master` → automatic deploy. The CI's ephemeral database is part of the tests, not a second environment.

## `master` rules (GitHub ruleset)

- It only changes through a PR. No direct pushes, force pushes or deletion.
- Squash merge is the only method (linear history). The branch is deleted on merge.
- Required checks, up to date with `master`: `code`, `db`, `secrets`, `snyk`, `snyk-code` and `pr-title`.
- No required approvals: there is a single developer, and the checks are the brake.
- `.github/CODEOWNERS` names the owner for every path, so any outside PR requests the owner's review. "Require review from Code Owners" stays off: an author cannot approve their own PR, so it would block every PR of the only developer. Only the owner has write access; outsiders can only fork and open PRs, whose workflows need the owner's approval (Actions setting "Require approval for all external contributors").

## Checks on every PR (`.github/workflows/ci.yml`, `security.yml` and `pr-title.yml`)

| Check        | What it does                                                                                 | Status                   |
| ------------ | -------------------------------------------------------------------------------------------- | ------------------------ |
| `code`       | `pnpm check`: Prettier, type-aware ESLint, `tsc` and Vitest, through Turborepo               | ✅ Active                |
| `secrets`    | gitleaks over the whole history with `.gitleaks.toml`                                        | ✅ Active                |
| `snyk`       | Snyk Open Source (`security.yml`): dependencies of the whole workspace; fails on high+       | ✅ Active                |
| `snyk-code`  | Snyk Code (`security.yml`): static analysis; fails on high                                   | ✅ Active                |
| `pr-title`   | The PR title (the future squash commit) follows the commit convention, at most 66 characters | ✅ Active                |
| `db`         | Squawk lint → `supabase db start` → `db reset` → pgTAP → generated types unchanged           | ✅ Active                |
| `evals`      | N1 always; N2 when AI paths change                                                           | Once the narrator exists |
| `judge-gate` | Sonnet 5.5 judge via Batch, only with the matching label (N3)                                | Once the judge exists    |
| `cdk-diff`   | `cdk diff --method=template` with the read-only role, posted as one PR comment; advisory     | ✅ Active (not required) |

Every new blocking check is added to the ruleset as required in the same PR that turns it on. `cdk-diff` stays out of it: it only runs when `infra`, `services`, `packages`, `apps` or the lockfile change, and it informs rather than gates.

`db` runs on every PR, so the required check always reports. Squawk (`packages/db/.squawk.toml`) lints every migration: a contract migration marks each destructive statement with `-- squawk-ignore <rule>`, which keeps those exceptions visible in the review, and the PR carries the `contract` label. The Supabase CLI is downloaded by `.github/actions/setup-supabase-cli`, which `db` and `deploy` share, at the version pinned there and checked against the SHA-256 pinned next to it (`SUPABASE_CLI_VERSION` and `SUPABASE_CLI_SHA256`): to update it, take the value for `supabase_<version>_linux_amd64.tar.gz` from the release's `checksums.txt`, respecting the one-day margin of `minimumReleaseAge`.

## External services

Both are on their free tier.

### CodeRabbit (PR review)

- GitHub App installed on this repo only. It is free for public repos, and its configuration is in `.coderabbit.yaml`.
- It reviews in English (like the PRs) with the `chill` profile. It ignores `pnpm-lock.yaml`, generated types (`database.types.ts`), `dist`, `.turbo` and snapshots. It has path instructions for `packages/db`, the narrator and `evals`, `infra`, `services` and `.github`.
- It uses `AGENTS.md`, `.claude/rules/*.md` and `docs/*.md` as guidelines, on top of the files it reads by default (such as `CLAUDE.md`).
- **It never blocks a merge**: its commit status is not required, it does not request changes, and the ruleset does not require review threads to be resolved. If CodeRabbit does not review (limits or an outage), the PR can still be merged.
- **Its comments are advisory** (`.claude/rules/workflow.md`): Claude gives a recommendation for each one (apply or not, and why) and changes nothing until the owner confirms. Then it applies what was confirmed, replies in each thread with the decision and resolves it.
- Talk to it in the PR with `@coderabbitai` (for example `@coderabbitai review` or `@coderabbitai resolve`).

### Snyk (vulnerabilities)

- CLI in Actions (`.github/workflows/security.yml`), without the GitHub App. Scanning through the app does not support the `workspace:` protocol, and the free tier caps it at 5 projects.
- The CLI binary is downloaded with the SHA-256 pinned in the workflow. To update it, change `SNYK_VERSION` and `SNYK_SHA256` to the value at `https://downloads.snyk.io/cli/v<version>/snyk-linux.sha256`, respecting the one-day margin of `minimumReleaseAge`.
- It runs on every PR, on every push to `master`, every Monday (for CVEs published after the merge) and by hand.
- `snyk`: `snyk test --all-projects --dev --fail-fast --severity-threshold=high`. It includes `devDependencies`, because almost all of the repo is build and test tooling, and it fails if any project cannot be analysed. It reads `pnpm-lock.yaml` (lockfile 9.x) and is **required**.
- `snyk-code`: `snyk code test --severity-threshold=high`. It fails on high-severity findings (Snyk Code has no `critical` level) and on real errors, and is **required**. The CLI cannot filter by exploitability, and Snyk Code does not read issue ignores from `.snyk`. A high finding that is not exploitable here is first fixed in the code if that is cheap; otherwise, with the owner's OK, it is ignored in the Snyk web app for this organization, or its path is excluded under `exclude` in `.snyk` with a comment saying why. With the threshold, Code scanning probably only receives the high findings.
- Results:
  - In the job log.
  - In **Security → Code scanning**, through SARIF. Dependency results get one category per workspace project (`Snyk/Open Source/<package>`); code results go to `Snyk/Code`.
- Actions secrets: `SNYK_TOKEN` and `SNYK_ORG`, the Snyk organization ID. `SNYK_ORG` is a secret rather than a variable so it stays out of the public logs; without it, Snyk Code answers `SNYK-CODE-0005`. PRs from forks do not get it, so their `snyk` check fails. That is intended: an external PR cannot skip the check.
- Ignoring a dependency finding (Snyk Open Source): in `.snyk`, always with a reason and an expiry date (`snyk ignore --id=… --reason=… --expiry=…`). Snyk Code findings: see `snyk-code` above.
- Free-tier limits: according to Snyk's documentation, they only apply to private repos. For private repos, Snyk Code has 100 tests a month and counts one per scanned repository; Open Source counts one test per analysed manifest. If the check starts failing because of quota, check the usage on snyk.io (Settings → Usage).

## Public repo security

- No workflow uses `pull_request_target`. PRs from forks get no secrets and cannot assume roles: OIDC trust is limited to this repo and its branches.
- Actions are pinned by full commit SHA with the version in a comment, and updated by hand like npm packages (there is no Dependabot). Only GitHub's actions and the allow-listed ones are permitted.
- `permissions: contents: read` by default. Each job asks only for what it uses.
- `actions/checkout` uses `persist-credentials: false`, and downloaded binaries are verified with a checksum.
- Three layers against leaks: gitleaks on pre-commit, gitleaks in CI, and GitHub secret scanning with push protection.

## Deployment (`.github/workflows/deploy.yml`)

`deploy.yml` runs on every push to `master` that changes `apps`, `services`, `packages`, `infra`, the lockfile, the root `package.json`, `.node-version` or the workflow and its actions, and by hand (`workflow_dispatch`, from `master` only). It runs with `concurrency: prod` and never cancels a run in progress; GitHub keeps only the newest pending run, which deploys every commit before it.

1. `test`: `pnpm check`, in a job with no OIDC token, so dependency code cannot reach the deploy role.
2. `deploy`, in the `production` environment:
   1. Waits until a 30-minute deploy fits before the freeze (`infra/scripts/wait-for-deploy-window.ts`, with `deployWindowStart` from `@cronista/core`). A merge after 21:00 Europe/Madrid deploys at 23:00. The steps that change production have timeouts that add up to those 30 minutes.
   2. `supabase db push --dry-run`, then `supabase db push`, signed in with `SUPABASE_ACCESS_TOKEN` as Supabase's temporary login role (no database password). It runs before the AWS credentials exist, so the CLI never sees them.
   3. `cdk deploy` of every stack except the owner-only ones (`CronistaGitHubAccess` and `CronistaAccessAnalyzer-*`), with `--require-approval never`, through change sets and never `--hotswap`. The CLI has no exclude flag, so the workflow lists the stacks: a new stack is added there. The CLI orders them by their dependencies (`CronistaWorkers` after `CronistaAccountGuards`, `CronistaEdge` after `CronistaDomain` and `CronistaWebAcl`).
   4. Smoke test against `cronista.jcvstro.dev`: `/` answers 200, and `/api/me` and `POST /api/ai/hint` answer 401, which proves CloudFront, origin access control, each Lambda and its session check.
3. `release`, the only job with `contents: write`: if `v<root version>` has no GitHub Release yet, it creates the tag on the deployed commit and a release with generated notes. A release is what runs in production.

Migrations apply before the stacks, so if `cdk deploy` fails the database is ahead of the code: expand/contract migrations keep the old code working. If a failure shows up later, `git revert` deploys the previous version again. The database only gets forward migrations.

Not yet in the pipeline:

- The database dump before `db push` comes with the nightly backups (CR-18).
- A Lambda canary with a pre-traffic hook is CR-31.

### Deploy secrets

| Secret                  | Where                    | What                                                                                                                                                                                                          |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWS_ACCOUNT_ID`        | Repository               | Builds the role ARNs; GitHub masks it in every stack ARN and output                                                                                                                                           |
| `SUPABASE_ACCESS_TOKEN` | `production` environment | Scoped Supabase personal access token for the production project only, with `database_write`, `database_pooling_config_read` and `branching_production_read` (what `supabase link` and `db push --help` list) |
| `SUPABASE_PROJECT_REF`  | `production` environment | The project ref (the subdomain of the Supabase URL)                                                                                                                                                           |

Environment secrets reach only jobs in `production`, which accepts `master` alone. Set them without the value showing in the terminal:

```powershell
$token = Read-Host -AsSecureString "Supabase access token"
[System.Net.NetworkCredential]::new('', $token).Password | gh secret set SUPABASE_ACCESS_TOKEN --env production
$ref = Read-Host -AsSecureString "Supabase project ref"
[System.Net.NetworkCredential]::new('', $ref).Password | gh secret set SUPABASE_PROJECT_REF --env production
```

## AWS OIDC roles

`CronistaGitHubAccess` (`infra/src/github-access-stack.ts`) holds the GitHub OIDC provider, the three roles and the private data bucket. Each role trusts one exact `sub` (with `aud = sts.amazonaws.com`):

| Role                       | `sub` after `repo:Joakamakaka1@129002508/Cronista@1403206949:` | Permissions                                                                                |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `cronista-github-readonly` | `pull_request`                                                 | Read the `Cronista*` stack templates, the bootstrap version and the bucket's `datasets/`   |
| `cronista-github-deploy`   | `environment:production`                                       | Assume the CDK bootstrap roles (deploy, file and image publishing, lookup) in both regions |
| `cronista-github-backups`  | `ref:refs/heads/master`                                        | Only `s3:PutObject` under `backups/`: it cannot read, list or delete a dump                |

- Repos created after 2026-07-15 use a `sub` with immutable IDs (`repo:OWNER@OWNER_ID/REPO@REPO_ID:…`), so the trust policies use IDs, not names. Both IDs are public.
- The deploy role trusts the `production` environment, not the branch: a scheduled job on `master` (the backups) shares the branch `sub`, and only a job that declares `environment: production` in a workflow on `master` gets the deploy `sub`. The environment only accepts `master` (deployment branch policy).
- The read-only role does not assume the bootstrap lookup role, which can read the whole account. The CDK CLI warns that it could not assume it and goes on with the read-only credentials, so `cdk-diff` uses `--method=template` (a change set would need the deploy role).
- The workflows build the role ARN from the `AWS_ACCOUNT_ID` Actions secret, and `configure-aws-credentials` masks the account ID in the logs. The `cdk-diff` comment replaces any 12-digit number with `<account>`.
- Fork PRs get no OIDC token, so `cdk-diff` skips them.

### CloudFormation execution policy and permissions boundary

`cronista-cfn-execution` is both the execution policy of the bootstrap stacks (instead of `AdministratorAccess`) and the permissions boundary of every role: the execution roles (`--custom-permissions-boundary`) and every role the app creates (`@aws-cdk/core:permissionsBoundary` in `infra/cdk.json`). It allows every action, minus what a malicious deploy would use to stay, to hide or to loosen these limits.

- Denied:
  - Any IAM action on users and groups, and new OIDC or SAML providers.
  - Creating a role without this boundary, or removing it from a role. Without that, a deploy could create an unbounded role (for a Lambda behind a custom resource, say) and do everything else on this list through it.
  - Stopping, changing or deleting the CloudTrail trail, and deleting or writing to its bucket.
  - Deleting or writing to the data bucket of `CronistaGitHubAccess`: only the backups role, which carries no boundary, and the owner write its datasets and dumps.
  - Deleting the Access Analyzer analyzers, archiving their findings, and adding archive rules.
  - Writing to the CDK assets bucket: a replaced zip would keep running, because publishing skips hashes that already exist.
  - Assuming the bootstrap roles: they trust the whole account and carry no boundary, so a bounded role could use the file publishing role to replace assets anyway.
  - Joining or leaving an organization, and changing account settings.
  - Changing this policy, the bootstrap roles, the `cronista-github-*` roles and the OIDC provider.
- So changes to the trail, the analyzers or `CronistaGitHubAccess` deploy from the owner's machine with the CLI credentials, **never from CI**.
- Known gap: IAM cannot condition `CreateRole` on the trust policy. A deploy could still create a role (bounded, but broad) that another account, or another GitHub repo through the OIDC provider, can assume. IAM Access Analyzer (`CronistaAccessAnalyzer-*`) reports roles trusted by other accounts, a deploy can no longer silence it, and its active findings reach the owner's email ("Cost alert email" in `development.md`). A deploy could still remove that alert rule or the topic. Whether it reports a foreign GitHub `sub` is not verified.

### Accepted risks

- `cronista-github-readonly` reads `datasets/` (the owner's decision), and the `pull_request` subject covers every PR job that asks for an OIDC token. A compromised dependency in a same-repo PR (`pnpm install`, `cdk diff`) could read the datasets. Only the owner can push branches, and the token never reaches fork PRs.
- The deploy and backups subjects depend on GitHub's environment and branch checks, not on the workflow file. A custom OIDC subject template with `job_workflow_ref` would pin each role to one workflow; it is left for CR-19, which manages the GitHub settings.
- The `deploy` job installs the dependencies and runs `cdk deploy` with the deploy role, so a compromised dependency that reaches `master` could deploy. The lockfile, `minimumReleaseAge`, Snyk and the PR review are the brakes, and the execution policy bounds what such a deploy can do.
- `SUPABASE_ACCESS_TOKEN` can change the production database. It is scoped to that project and to the permissions in "Deploy secrets", and only the `deploy` job of `deploy.yml` gets it.
