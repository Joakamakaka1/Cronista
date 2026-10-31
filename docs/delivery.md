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
  - Code scanning compares each PR with the categories on `master`. When a workspace package is renamed or removed, its old category stays on `master` and every later PR gets a neutral "Snyk Open Source" check ("configurations … were not found"). After that PR merges, delete the old category's analyses on `master`. The API deletes only the newest analysis of a category, so repeat until none is left:

    ```bash
    R=repos/Joakamakaka1/Cronista
    category='Snyk/Open Source/@cronista/<old-package>'
    while id=$(gh api --paginate "$R/code-scanning/analyses?tool_name=Snyk%20Open%20Source&ref=refs/heads/master&per_page=100" \
      --jq ".[] | select(.category==\"$category\" and .deletable) | .id" | head -n 1) && [ -n "$id" ]; do
      gh api -X DELETE "$R/code-scanning/analyses/$id?confirm_delete=true" > /dev/null
    done
    ```

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

`deploy.yml` runs on every push to `master` that changes `apps`, `services`, `packages`, `infra`, the lockfile, `pnpm-workspace.yaml`, the root `package.json`, `.node-version` or the workflow and its actions, and by hand (`workflow_dispatch`, from `master` only). It runs with `concurrency: prod` and never cancels a run in progress; GitHub keeps only the newest pending run, which deploys every commit before it.

1. `test`: `pnpm check`, with no secrets and no OIDC token.
2. `gate`, with no secrets and no OIDC token:
   1. Waits until 60 minutes fit before the freeze (`infra/scripts/wait-for-deploy-window.ts`, with `deployWindowStart` from `@cronista/core`): the dump, its upload, the migrations and the start of those jobs, so the dump is the state the migrations change.
   2. Stops the run, without failing it, when a later run of `deploy.yml` exists on `master` (`.github/actions/newest-deploy-run`): a re-run of an older run, or a run that waited out the freeze while a newer one was queued, would otherwise roll production back. The newest run deploys every commit before it. It compares runs, not commits: with the path filter, the head of `master` may be a docs commit that starts no run, and this run must still deploy. A later run counts even when it fails or is cancelled: it may have deployed some of its stacks already, and an older run would roll them back. Until a later run succeeds, production can lag behind the commits whose runs stopped. To recover, fix forward, or run `deploy.yml` by hand on `master`: the manual run is the newest one, so it deploys the head.
3. `backup`, in the `production` environment, with the Supabase token and no OIDC token: dumps and encrypts the database (`.github/actions/dump-database`, see "Database backups"). It installs no dependencies, so no third-party JavaScript runs next to the token or can swap the key the dump is encrypted to.
4. `store-backup`, with no environment and the OIDC token of the backups role: uploads the dump under `backups/` (`.github/actions/store-backup`). No migration runs until the dump is in the bucket.
5. `migrate`, in the `production` environment, with the Supabase token and no OIDC token:
   1. Waits until 35 minutes fit before the freeze, which passes at once unless the backup ran late, and checks for a later run again.
   2. `supabase db push --project-ref … --dry-run`, which lists the migrations in the log, then `supabase db push`, signed in with `SUPABASE_ACCESS_TOKEN` as Supabase's temporary login role (no database password and no `supabase link`).
6. `deploy`, in the `production` environment, with the OIDC token and no Supabase token:
   1. Waits until 60 minutes fit before the freeze, then checks for a later run again: when there is one, the job ends green without deploying, and `release` does not run.
   2. `cdk deploy` of every stack except the owner-only ones (`CronistaGitHubAccess`, `CronistaAccessAnalyzer-*` and `CronistaThreatDetection-*`), with `--require-approval never`, through change sets and never `--hotswap`. The CLI has no exclude flag, so the workflow lists the stacks: a new stack is added there. The CLI orders them by their dependencies (`CronistaWorkers` after `CronistaAccountGuards`, `CronistaEdge` after `CronistaDomain` and `CronistaWebAcl`).
   3. Smoke test against `cronista.jcvstro.dev`: `/` answers 200, and `/api/me` and `POST /api/ai/hint` answer 401, which proves CloudFront, origin access control, each Lambda and its session check.
7. `release`, the only job with `contents: write`: if `v<root version>` has no GitHub Release yet, it creates the tag on the deployed commit and a release with generated notes. A release is what runs in production.

**The freeze.** Each job that changes production asks for its step timeouts plus 30 minutes: a timeout kills the CLI, not a CloudFormation update or rollback already running, and the margin lets it end before 21:30 Europe/Madrid. So the backup starts by 20:30, migrations by 20:55 and stacks by 20:30; a later merge deploys at 23:00. GitHub keeps the jobs waiting, and the newest pending run replaces any older one.

Migrations apply before the stacks, so if `cdk deploy` fails, or waits out the freeze, the database is ahead of the code: expand/contract migrations keep the old code working. If a failure shows up later, `git revert` deploys the previous version again. The database only gets forward migrations.

**The trail.** `CronistaAccountGuards` deploys from CI, and the execution policy denies CloudFormation updating, stopping or deleting its CloudTrail trail. The owner cannot deploy such a change either: the stack was created through the bootstrap roles, so `cfn-exec-role` is attached to it and runs every update, whoever starts it (see "Stacks deployed with the CLI credentials" below). A PR that changes the trail makes the run fail on that stack, which rolls back, and every stack after it is skipped until the change is reverted. So the trail does not change until it moves to a stack created with the owner's CLI credentials (CR-32); the trail, its bucket and the bucket policy are retained, so removing them from `CronistaAccountGuards` leaves them in place.

Not yet in the pipeline: a Lambda canary with a pre-traffic hook (CR-31).

### Deploy secrets

| Secret                  | Where                    | What                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWS_ACCOUNT_ID`        | Repository               | Builds the role ARNs; GitHub masks it in every stack ARN and output                                                                                                                                                                                                                             |
| `SUPABASE_ACCESS_TOKEN` | `production` environment | Scoped Supabase personal access token for the production project only, with `database_write` and `database_pooling_config_read` (what `supabase db push --project-ref --help` lists). The workflow skips `supabase link`, which would also need the project's API keys, the secret one included |
| `SUPABASE_PROJECT_REF`  | `production` environment | The project ref (the subdomain of the Supabase URL)                                                                                                                                                                                                                                             |
| `DATA_BUCKET_NAME`      | Repository               | Name of the data bucket (`DataBucketName` output of `CronistaGitHubAccess`), where the backups go. Repository-wide because the upload jobs have no environment                                                                                                                                  |

Environment secrets reach only jobs in `production`, which accepts `master` alone, and each job gets only the secrets it names. Set them before the first merge that runs `deploy.yml`, without the value showing in the terminal:

```powershell
$token = Read-Host -AsSecureString "Supabase access token"
[System.Net.NetworkCredential]::new('', $token).Password | gh secret set SUPABASE_ACCESS_TOKEN --env production
$ref = Read-Host -AsSecureString "Supabase project ref"
[System.Net.NetworkCredential]::new('', $ref).Password | gh secret set SUPABASE_PROJECT_REF --env production
```

The bucket name goes straight from the stack output to the secret:

```powershell
aws cloudformation describe-stacks --profile la-cronica --region eu-west-1 --stack-name CronistaGitHubAccess --query "Stacks[0].Outputs[?OutputKey=='DataBucketName'].OutputValue" --output text | gh secret set DATA_BUCKET_NAME
```

## Database backups (`.github/workflows/backup.yml`)

Supabase Free keeps no backup the owner can download, so the repo takes its own: every night at 02:17 UTC (`backup.yml`, also by hand from `master`) and before every migration (`deploy.yml`). Both use the same two composite actions:

1. `.github/actions/dump-database`, in a job of the `production` environment with the Supabase token:
   1. Installs `age` from its pinned release, checked against its SHA-256 (`AGE_VERSION` and `AGE_SHA256`).
   2. Runs `supabase db dump --project-ref` three times through the pooler, signed in as the temporary login role, with the same token and permissions as `db push`: the roles (`--role-only`), the schema, and the data (`--data-only --use-copy`). These are the three parts of Supabase's own backup guide.
   3. Encrypts each part to the age public key in `.github/backup-recipients.txt`, deletes the plain text and hands the `*.sql.age` files on as a workflow artifact that lives one day.
2. `.github/actions/store-backup`, in a job with no environment and `id-token: write`: assumes `cronista-github-backups` (the master branch `sub`) and uploads the three files to `backups/<UTC time>-<nightly|pre-migration>-<run ID>/` in the data bucket. The role can only add objects there; the bucket is versioned and expires dumps after 90 days.

The dump and the upload are two jobs because the Supabase token and an OIDC token never share a job, and because a `production` job gets the `environment:production` `sub`, which the backups role does not trust. Neither dump job runs `pnpm install`, so no third-party JavaScript runs next to the token.

- Only the owner holds the age private key (`%USERPROFILE%\.secrets\cronista\backup-age-key.txt`, plus an offline copy). CI and AWS only ever see ciphertext. A new key is a PR that replaces `.github/backup-recipients.txt`; dumps taken before it still need the old key.
- A failed scheduled run emails the owner. GitHub disables the schedules of a public repo after 60 days without activity: if that happens, re-enable the workflow under Actions.
- The restore is drilled every month on the owner's machine ("Backups and the restore drill" in `development.md`).

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
  - Deleting, disabling or reconfiguring the GuardDuty detectors, hiding their findings (suppression rules, archiving, trusted IP and entity lists) or handing them to an administrator account; changing the `cronista-guardduty-findings` rules and the `cronista-guardduty-forwarder` role that carry the findings to the alerts topic; and changing the permissions or the key of the default event buses, which receive the findings forwarded from us-east-1.
  - Writing to the CDK assets bucket: a replaced zip would keep running, because publishing skips hashes that already exist.
  - Assuming the bootstrap roles: they trust the whole account and carry no boundary, so a bounded role could use the file publishing role to replace assets anyway.
  - Joining or leaving an organization, and changing account settings.
  - Changing this policy, the bootstrap roles, the `cronista-github-*` roles and the OIDC provider.
- So changes to `CronistaGitHubAccess` and GuardDuty (`CronistaThreatDetection-*`) deploy from the owner's machine with the CLI credentials, **never from CI**. The changes it denies to the trail and the analyzers cannot deploy yet, from CI or from the owner's machine: their stacks run as `cfn-exec-role` (CR-32, CR-33).
- **Stacks deployed with the CLI credentials.** The owner's deploy escapes this policy only in a stack that uses `CliCredentialsStackSynthesizer` and was created that way, like `CronistaGitHubAccess` and `CronistaThreatDetection-*`. CI leaving a stack out (`CronistaAccessAnalyzer-*`) is not enough: the default synthesizer makes even the owner's `cdk deploy` assume the bootstrap deploy role and pass `cfn-exec-role` to CloudFormation. CloudFormation keeps the service role a stack was created or updated with and cannot remove it, only replace it with another one, so switching the synthesizer of an existing stack is not enough on its own. Replacing the role with a broader one is rejected: CloudFormation lets anyone who may update the stack use its role without `iam:PassRole`, so the CI deploy role would get that role's permissions. So the resources move, retained, to a new stack that imports them.
- Known gap: IAM cannot condition `CreateRole` on the trust policy. A deploy could still create a role (bounded, but broad) that another account, or another GitHub repo through the OIDC provider, can assume. IAM Access Analyzer (`CronistaAccessAnalyzer-*`) reports roles trusted by other accounts, a deploy can no longer silence it, and its active findings reach the owner's email ("Cost alert email" in `development.md`). A deploy could still remove that alert rule, the topic, or the topic policy statement that lets the GuardDuty rules publish. Whether it reports a foreign GitHub `sub` is not verified.

### Accepted risks

- `cronista-github-readonly` reads `datasets/` (the owner's decision), and the `pull_request` subject covers every PR job that asks for an OIDC token. A compromised dependency in a same-repo PR (`pnpm install`, `cdk diff`) could read the datasets. Only the owner can push branches, and the token never reaches fork PRs.
- The deploy and backups subjects depend on GitHub's environment and branch checks, not on the workflow file. A custom OIDC subject template with `job_workflow_ref` would pin each role to one workflow; it is left for CR-19, which manages the GitHub settings.
- `migrate` and `deploy` install the dependencies, and `deploy` runs `cdk deploy` with the deploy role. GitHub exposes the OIDC request token to every step of `deploy`, so a compromised dependency that reaches `master` could deploy, and one that runs in `migrate` could read the Supabase token. The lockfile, `minimumReleaseAge`, Snyk and the PR review are the brakes, and the execution policy bounds what such a deploy can do. The two credentials never share a job.
- `SUPABASE_ACCESS_TOKEN` can change the production database. It is scoped to that project and to the permissions in "Deploy secrets", and only the dump and migrations steps of `deploy.yml` and the nightly dump get it. `migrate` installs the dependencies next to it, after the dump is stored.
- `supabase db dump` runs `pg_dump` in Supabase's Postgres image, which the CLI pulls by tag (`public.ecr.aws/supabase/postgres`) next to the token and the plain dump. The CLI is pinned by checksum; the image is trusted as part of it.
- The backup artifact is visible for one day to anyone signed in to GitHub, because the repo is public. It holds only ciphertext; its size is all it reveals.
