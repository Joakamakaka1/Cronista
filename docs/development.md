# Local development

Environment: native Windows with PowerShell. WSL is only a fallback.

## Requirements

| Tool           | Version                    | Install                                                    |
| -------------- | -------------------------- | ---------------------------------------------------------- |
| Node.js        | 24.x (`.node-version`)     | Official installer                                         |
| pnpm           | 11.17.0 (`packageManager`) | Standalone, without corepack                               |
| gitleaks       | 8.30+                      | `scoop install gitleaks` (without it, commits are blocked) |
| Supabase CLI   | 2.x                        | `scoop install supabase`                                   |
| AWS CLI        | 2.32+                      | Profile `la-cronica`, `aws login`                          |
| Docker Desktop |                            | For `supabase start`                                       |

## First run

```powershell
git clone https://github.com/Joakamakaka1/Cronista.git
cd Cronista
pnpm install        # the `prepare` script enables .githooks (gitleaks on pre-commit and the commit format)
pnpm check
```

Commits in this repo use the GitHub noreply email, set only for this repo:

```powershell
git config user.email "129002508+Joakamakaka1@users.noreply.github.com"
```

## Local secrets

- They live **outside the repo**, in `%USERPROFILE%\.secrets\cronista\.env` (ACL limited to your user).
- To use another path, set `CRONISTA_ENV_FILE` to the full path.
- There is no `.env.example`: variable names are documented here as the code needs them.
- To add or change a value without it showing on screen or in the PowerShell history:

```powershell
$s = Read-Host -AsSecureString "Value"
$plain = [System.Net.NetworkCredential]::new('', $s).Password
aws ssm put-parameter --profile la-cronica --type SecureString --overwrite --name "/cronista/prod/<service>/<key>" --value $plain
Remove-Variable plain, s
```

- In SSM (production), check that a parameter exists without decrypting it:

```powershell
aws ssm describe-parameters --profile la-cronica --parameter-filters "Key=Name,Option=BeginsWith,Values=/cronista/prod/"
```

## SSM parameters

Production secrets are `SecureString` parameters in eu-west-1, encrypted with the AWS managed `aws/ssm` key. The owner enters every value; the repo only holds the names (`infra/src/config.ts`), and each Lambda's role may read only its own parameters.

| Parameter                               | Value                                                                                                         | Read by                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `/cronista/prod/supabase/secret-key`    | Supabase secret key (`sb_secret_…`)                                                                           | `ai-worker`              |
| `/cronista/prod/anthropic/game-api-key` | Anthropic API key from the `game-prod` workspace of the Claude Console, which has a monthly spend limit       | `ai-api` and `ai-worker` |
| `/cronista/prod/voyage/api-key`         | Voyage AI API key                                                                                             | `ai-api` and `ai-worker` |
| `/cronista/prod/langfuse/secret-key`    | Secret key (`sk-lf-…`) of the Cronista project in Langfuse Cloud EU                                           | `ai-api` and `ai-worker` |
| `/cronista/prod/langfuse/public-key`    | Public key (`pk-lf-…`) of the same project; public by design, kept next to its secret key                     | No Lambda yet            |
| `/cronista/prod/vapid/private-key`      | Private half of the VAPID key pair that signs Web Push requests (P-256, base64url)                            | `notifier`               |
| `/cronista/prod/vapid/public-key`       | Public half of the same pair (uncompressed point, base64url); public by design, kept next to its private half | `notifier`               |

Create or rotate one with its name, so the value never shows on screen or in the PowerShell history (the console's Anthropic workspace and the spend limit are set by hand first):

```powershell
$name = "/cronista/prod/anthropic/game-api-key"
$s = Read-Host -AsSecureString "Value for $name"
$plain = [System.Net.NetworkCredential]::new('', $s).Password
aws ssm put-parameter --profile la-cronica --region eu-west-1 --type SecureString --overwrite --name $name --value $plain
Remove-Variable plain, s
```

Check that they exist without decrypting them:

```powershell
aws ssm describe-parameters --profile la-cronica --region eu-west-1 --parameter-filters "Key=Name,Option=BeginsWith,Values=/cronista/prod/" --query "Parameters[].[Name,Type,LastModifiedDate]" --output table
```

`ai-api`, `ai-worker` and `notifier` read their keys through the AWS Parameters and Secrets Lambda Extension, which caches them for 5 minutes: a rotated key reaches the running functions within that time. Until the three AI keys exist, `POST /api/ai/hint` answers 503 `providers_not_configured` and every `ai-worker` job fails, which raises the `AiWorkerFailures` alarm. Until the VAPID pair exists, `notifier` logs a `vapid keys unreadable` warning.

### The VAPID key pair

Generate it once, before the first push subscription: a new pair invalidates every subscription the browsers hold. The private half goes straight from Node to SSM and never shows on screen, and without `--overwrite` an existing pair is never replaced by accident. The values go as `--value=…`, because a base64url key can start with `-`, which the CLI would take for an option; the public half is only stored once the private one is:

```powershell
$keys = node -e "const { generateKeyPairSync } = require('node:crypto'); const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' }); const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]); console.log(JSON.stringify({ privateKey: jwk.d, publicKey: point.toString('base64url') }))" | ConvertFrom-Json
aws ssm put-parameter --profile la-cronica --region eu-west-1 --type SecureString --name /cronista/prod/vapid/private-key "--value=$($keys.privateKey)"
if ($LASTEXITCODE -eq 0) { aws ssm put-parameter --profile la-cronica --region eu-west-1 --type SecureString --name /cronista/prod/vapid/public-key "--value=$($keys.publicKey)" }
Remove-Variable keys
```

## AWS account setup outside the code

The CDK app in `infra` owns the account's resources, cost guards included. A few settings cannot live there and are set by hand.

### Cost alert email

`CronistaAccountGuards` creates an SNS topic for every account alert: Budgets (5 and 10 USD a month), Cost Anomaly Detection (anomalies of 1 USD or more, immediately), the active findings of IAM Access Analyzer in both regions (us-east-1 forwards its findings to the eu-west-1 event bus) and the CloudWatch alarms of the other stacks (`CronistaWorkers`). Subscribe your email to it once, so the address never reaches the repo, the templates or CI:

```powershell
$topic = aws cloudformation describe-stacks --profile la-cronica --region eu-west-1 --stack-name CronistaAccountGuards --query "Stacks[0].Outputs[?OutputKey=='CostAlertsTopicArn'].OutputValue" --output text
$email = Read-Host "Email for cost alerts"
aws sns subscribe --profile la-cronica --region eu-west-1 --topic-arn $topic --protocol email --notification-endpoint $email
Remove-Variable email
```

Do not click the link in the confirmation email from AWS: a subscription confirmed that way can be cancelled by anyone who opens the unsubscribe link at the bottom of any alert, without signing in. Copy the link instead, and confirm from the CLI with the value after `Token=`:

```powershell
$token = Read-Host "Token from the confirmation link"
aws sns confirm-subscription --profile la-cronica --region eu-west-1 --topic-arn $topic --token $token --authenticate-on-unsubscribe true
Remove-Variable token
```

If the topic is ever replaced, subscribe again.

### S3 Block Public Access and the root user

- **Account-level S3 Block Public Access**: all four settings are on. CloudFormation has no resource for it. To check it:

  ```powershell
  aws s3control get-public-access-block --profile la-cronica --account-id (aws sts get-caller-identity --profile la-cronica --query Account --output text)
  ```

- **Root user**: MFA on and no access keys. To check it (expect `[1, 0]`):

  ```powershell
  aws iam get-account-summary --profile la-cronica --query "SummaryMap.[AccountMFAEnabled,AccountAccessKeysPresent]"
  ```

### GitHub Actions access and the CDK bootstrap

`CronistaGitHubAccess` deploys only from your machine, never from CI (see "AWS OIDC roles" in `delivery.md`). So do changes to the CloudTrail trail and the Access Analyzer analyzers, which the execution policy denies to CloudFormation. After changing it:

```powershell
pnpm --filter @cronista/infra exec cdk deploy CronistaGitHubAccess --profile la-cronica
```

The bootstrap stacks of both regions use its `cronista-cfn-execution` policy as execution policy and permissions boundary. The CLI keeps the execution policy when you bootstrap again, but drops the boundary unless you pass it, so always bootstrap with both flags:

```powershell
$account = aws sts get-caller-identity --profile la-cronica --query Account --output text
pnpm --filter @cronista/infra exec cdk bootstrap "aws://$account/eu-west-1" "aws://$account/us-east-1" --profile la-cronica --cloudformation-execution-policies "arn:aws:iam::${account}:policy/cronista-cfn-execution" --custom-permissions-boundary cronista-cfn-execution
```

First rollout (once, in this order): delete the hand-made GitHub OIDC provider (IAM allows one per URL), deploy `CronistaGitHubAccess` (it creates the policy), deploy `CronistaEdge` (its role gets the boundary while CloudFormation can still set it), then bootstrap as above.

Three GitHub settings go with it until Terraform manages the repo (CR-19):

- Environment `production`, with a deployment branch policy that only allows `master`.
- Actions secret `AWS_ACCOUNT_ID`, piped so the value never shows: `aws sts get-caller-identity --profile la-cronica --query Account --output text | gh secret set AWS_ACCOUNT_ID`.
- Actions allow-list: `aws-actions/configure-aws-credentials@*`, next to the GitHub actions and `pnpm/action-setup@*`.

### The domain in Cloudflare

`jcvstro.dev` lives in Cloudflare, outside AWS. Four NS records there delegate `cronista.jcvstro.dev` to the Route 53 zone in `CronistaDomain`, which was created by hand and then imported into CDK, so it keeps those name servers.

- Import before the first deploy of `CronistaDomain`. Route 53 allows two zones with the same name, so a deploy without the import creates a second, undelegated zone instead of failing. `cdk import` with a mapping file adopts only the mapped zone and skips the CAA record and the certificate, so no zone-only template is needed. Keep the mapping file outside the repo, since it holds the zone ID:

  ```powershell
  $zones = @(aws route53 list-hosted-zones --profile la-cronica --query "HostedZones[?Name=='cronista.jcvstro.dev.' && Config.PrivateZone==``false``].Id" --output json | ConvertFrom-Json)
  if ($zones.Count -ne 1) { throw "Expected one public cronista.jcvstro.dev zone, found $($zones.Count): keep the one whose name servers Cloudflare lists." }
  $zone = $zones[0].Split('/')[-1]
  @{ ZoneA5DE4B68 = @{ Id = $zone } } | ConvertTo-Json | Set-Content "$env:TEMP\domain-import.json"
  pnpm --filter @cronista/infra exec cdk import CronistaDomain --resource-mapping "$env:TEMP\domain-import.json" --profile la-cronica
  pnpm --filter @cronista/infra exec cdk deploy CronistaDomain --exclusively --profile la-cronica
  Remove-Item "$env:TEMP\domain-import.json"
  ```

- If the zone is ever replaced, copy its new name servers to Cloudflare.
- Before deleting the zone, delete the NS records in Cloudflare; never the other way round, or the subdomain points at name servers someone else could claim.

To compare both sides:

```powershell
aws route53 get-hosted-zone --profile la-cronica --id (aws cloudformation describe-stack-resources --profile la-cronica --region us-east-1 --stack-name CronistaDomain --query "StackResources[?ResourceType=='AWS::Route53::HostedZone'].PhysicalResourceId | [0]" --output text) --query "DelegationSet.NameServers"
Resolve-DnsName cronista.jcvstro.dev -Type NS -Server 1.1.1.1
```

Cloudflare adds CAA records to `jcvstro.dev` that leave Amazon out. The zone has its own CAA record for Amazon, so the subdomain does not inherit them and ACM can issue.

## The workers in production

`CronistaWorkers` runs `ai-worker` at 08:00 (`open-day`), 22:00 (`close-day`) and 04:00 (`keep-alive`), and queues the reminders at 19:00 and 21:00 for `notifier`, all in Europe/Madrid. `keep-alive` counts the players with a `HEAD` request to the Data API, signed with the Supabase secret key: one query a day that returns no rows and keeps Supabase's Free plan from pausing the project after a quiet week. The schedules live in the `cronista` group:

```powershell
aws scheduler list-schedules --profile la-cronica --region eu-west-1 --group-name cronista --query "Schedules[].[Name,State]" --output table
```

Run a job by hand, for example a close that failed. `scheduledTime` is the UTC time the job was due, which names the game day: 22:00 in Madrid is 21:00Z in winter and 20:00Z in summer. A job is idempotent per (season, day) (`.claude/rules/infra.md`), so running it again never publishes twice, but only one runs at a time: a call during a scheduled run is throttled.

```powershell
$worker = aws cloudformation describe-stack-resources --profile la-cronica --region eu-west-1 --stack-name CronistaWorkers --query "StackResources[?ResourceType=='AWS::Lambda::Function' && starts_with(LogicalResourceId, 'AiWorker')].PhysicalResourceId | [0]" --output text
'{"job":"close-day","scheduledTime":"2026-10-31T21:00:00Z"}' | Set-Content -NoNewline "$env:TEMP\job.json"
aws lambda invoke --profile la-cronica --region eu-west-1 --function-name $worker --cli-binary-format raw-in-base64-out --payload "fileb://$env:TEMP/job.json" "$env:TEMP\job-result.json"
Get-Content "$env:TEMP\job-result.json"
```

Four alarms reach the alerts topic: `AiWorkerFailures` (an attempt of a job failed, even if a retry then succeeds, or a job was dropped without running), `NotifierErrors`, `NotificationDeadLettersAlarm` (dead notifications are waiting; it clears once they are gone, or after six hours in which nothing touches the queue, when SQS stops sending its metrics) and `UndeliveredSchedulesAlarm` (each job or reminder that Scheduler could not deliver). For dead notifications, fix the cause and move them back to the queue they came from:

```powershell
$dlq = aws cloudformation describe-stack-resources --profile la-cronica --region eu-west-1 --stack-name CronistaWorkers --query "StackResources[?ResourceType=='AWS::SQS::Queue' && starts_with(LogicalResourceId, 'NotificationDeadLetters')].PhysicalResourceId | [0]" --output text
aws sqs start-message-move-task --profile la-cronica --region eu-west-1 --source-arn (aws sqs get-queue-attributes --profile la-cronica --region eu-west-1 --queue-url $dlq --attribute-names QueueArn --query Attributes.QueueArn --output text)
```

A message in the schedules' dead-letter queue (`UndeliveredSchedules`) is a job or a reminder that Scheduler could not deliver within an hour. Read it to see which one, run a missed job by hand as above, then purge the queue: it is not redriven.

## Local Supabase

Migrations, pgTAP tests and the CLI configuration live in `packages/db/supabase`. The same steps run in the `db` check in CI:

```powershell
supabase db start --workdir packages/db              # Postgres only; `supabase start` adds Auth and the API
supabase db reset --workdir packages/db              # applies every migration from scratch
supabase test db --workdir packages/db               # pgTAP
pnpm --filter @cronista/db types                     # regenerates src/database.types.ts
pnpm --filter @cronista/db lint:sql                  # Squawk: no destructive or unsafe statements
```

Use the same Supabase CLI version as CI (`SUPABASE_CLI_VERSION` in `.github/actions/setup-supabase-cli/action.yml`): the generated types change between releases, and CI fails if they differ from the committed ones.

The local `config.toml` mirrors production except for the Email provider, which is on locally so the signup hook can be tried end to end: with `supabase start`, a signup through the Auth API with an email that is not in `players` gets a 403. Production keeps Email and phone sign-in off (Google only), and nobody runs `supabase config push` from this file: it would turn the Email provider on there.

## Supabase in production

### Settings outside the code

The production project is configured in the Dashboard. Nothing in the repo applies these settings until Terraform covers Supabase (CR-19 leaves it out while its provider is in alpha). When one changes, update this table in the same PR.

| Area        | Setting                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region      | eu-west-1                                                                                                                                                                           |
| Database    | SSL enforced on incoming connections                                                                                                                                                |
| API keys    | Legacy JWT keys (`anon`, `service_role`) disabled. The front uses the publishable key; the Lambdas use the secret key (`sb_secret_…`) from SSM `/cronista/prod/supabase/secret-key` |
| JWT signing | One ECC P-256 key. The old HS256 secret is revoked, so the Lambdas verify tokens against the JWKS (ES256)                                                                           |
| Data API    | "Automatically expose new tables" off: each migration grants every role exactly what it needs                                                                                       |
| Sign-in     | Google only, with nonce checks. Email and phone providers off, anonymous sign-ins off                                                                                               |
| Sign-ups    | On, gated by the Before User Created hook (see "The players list"). If the hook is ever disabled, turn sign-ups off first                                                           |
| URLs        | Site URL and redirect URLs list only origins that serve Cronista                                                                                                                    |

The Auth rows can be checked from the public settings endpoint, with the project URL and the publishable key from Dashboard → Settings → API Keys (both ship in the web bundle):

```powershell
$auth = Invoke-RestMethod -Uri "<supabase-url>/auth/v1/settings" -Headers @{ apikey = "<publishable-key>" }
$auth.external | Select-Object email, phone, google, anonymous_users   # False, False, True, False
$auth.disable_signup                                                   # False
```

### Migrations

`deploy.yml` applies them after each merge (`docs/delivery.md`). To push them by hand, after a failed run for instance, start from an up-to-date `master`, with the owner's OK and outside the deploy freeze. `db push` signs in through the Management API with a temporary login role (`supabase login`), so it needs no database password:

```powershell
supabase link --project-ref <project-ref> --workdir packages/db   # once per machine; the ref is the subdomain of the Supabase URL
supabase db push --dry-run --linked --workdir packages/db         # lists the migrations it would apply
supabase db push --linked --workdir packages/db
```

### Backups and the restore drill

Every night and before every migration, CI dumps the database (roles, schema and data), encrypts it to the owner's age key and stores it under `backups/` in the data bucket for 90 days (`docs/delivery.md`). Only the owner can decrypt a dump.

The key pair is made once, with [age](https://github.com/FiloSottile/age) (`winget install FiloSottile.age`). Keep an offline copy of the private key file, in the password manager for instance: without it no backup can be restored. The public key goes in `.github/backup-recipients.txt` through a PR.

```powershell
age-keygen -o "$env:USERPROFILE\.secrets\cronista\backup-age-key.txt"   # prints the public key (age1…)
```

**Monthly drill.** The first weekend of each month, restore the latest dump into a throwaway local project and check it. It needs Docker Desktop, the owner's AWS profile (the backups role can only write) and the private key. Run it from the repository root; the dev stack must be stopped, since the drill project uses the same ports. Never copy a decrypted dump into the repo: it holds real player data.

1. Download the latest dump:

   ```powershell
   $drill = Join-Path $env:TEMP "cronista-drill"
   New-Item -ItemType Directory -Force $drill | Out-Null
   $bucket = aws cloudformation describe-stacks --profile la-cronica --region eu-west-1 --stack-name CronistaGitHubAccess --query "Stacks[0].Outputs[?OutputKey=='DataBucketName'].OutputValue" --output text
   $latest = aws s3api list-objects-v2 --profile la-cronica --region eu-west-1 --bucket $bucket --prefix backups/ --query "sort_by(Contents, &LastModified)[-1].Key" --output text
   $folder = $latest.Substring(0, $latest.LastIndexOf('/'))
   aws s3 cp --profile la-cronica --region eu-west-1 --recursive "s3://$bucket/$folder/" $drill
   ```

2. Decrypt it:

   ```powershell
   foreach ($part in 'roles', 'schema', 'data') {
     age --decrypt -i "$env:USERPROFILE\.secrets\cronista\backup-age-key.txt" -o "$drill\$part.sql" "$drill\$part.sql.age"
   }
   ```

3. Start an empty local project. `supabase init` names it after its folder, so the database container is `supabase_db_cronista-drill`:

   ```powershell
   supabase stop --workdir packages/db
   supabase init --workdir $drill --with-vscode-settings=false --with-intellij-settings=false
   supabase db start --workdir $drill
   ```

4. Restore it. The roles go in as `supabase_admin`, because the dump repeats grants that only the platform's superuser can make. The schema and the data go in as `postgres` in one transaction, with triggers off for the data:

   ```powershell
   $db = "supabase_db_cronista-drill"
   foreach ($part in 'roles', 'schema', 'data') { docker cp "$drill\$part.sql" "${db}:/tmp/$part.sql" }
   docker exec $db psql -U supabase_admin -d postgres --single-transaction -v ON_ERROR_STOP=1 -f /tmp/roles.sql
   docker exec $db psql -U postgres -d postgres --single-transaction -v ON_ERROR_STOP=1 -f /tmp/schema.sql -c "SET session_replication_role = replica" -f /tmp/data.sql
   ```

5. Check it against production, with the read-only MCP server or the Dashboard: the same tables, the same row counts (`select count(*) from public.players`), RLS on and the same policies (`select tablename, policyname from pg_policies where schemaname = 'public'`).

6. Remove the project and the plain text:

   ```powershell
   supabase stop --no-backup --workdir $drill
   Remove-Item -Recurse -Force $drill
   ```

Restoring production itself is not drilled. It follows Supabase's "Backup and Restore using the CLI" guide, with the same three files, into a new project. The dump leaves out the migration history (`supabase_migrations`), so before the next `db push` mark every migration in `packages/db/supabase/migrations` as applied with `supabase migration repair --status applied <version>`.

## The players list

`public.players` is the closed list of players. Its migration also adds the Before User Created hook (`private.before_user_created`), which rejects any signup whose email is not in the list, and a trigger that fills `players.user_id` once a player's email is confirmed (Google sign-ins arrive confirmed).

- **The hook** is enabled in production at Dashboard → Authentication → Auth Hooks → Before User Created → Postgres → schema `private`, function `before_user_created`. On a new project, enable it before opening sign-ups.
- **Add a player** in the Dashboard's SQL Editor, with the email in lower case and exactly as their Google account shows it: Gmail ignores dots (`ana.garcia` and `anagarcia` are one account), but the list compares the text as it is.

  ```sql
  insert into public.players (email, role) values ('<email>', 'player');
  ```

- **Remove a player**: delete the user in Authentication → Users (the link in `players` is cleared) and then their row in `players`. Deleting only the row keeps the account, but every policy denies it, because they all call `private.is_player()`.
- If a row is added back for someone whose user still exists, the trigger does not run again: set `user_id` by hand to their id in Authentication → Users.

## What never gets committed

`.gitignore` and gitleaks block it, but the rule comes before the tools:

- Secrets of any kind, `.env` files, keys and certificates.
- Database dumps, real games, the bible with real data and judge labels.
- Players' real names and emails. Fixtures and seeds use invented characters and `@example.com`.

## Working with AI agents

The instructions for Claude Code (and any agent) are in [`AGENTS.md`](../AGENTS.md); the rules, subagents, skills, workflows and hooks are in [`.claude/`](../.claude/).

- **Plugins**: `.claude/settings.json` enables them, but Claude Code does not download them on its own. Install each marketplace plugin it lists once per machine, for example `claude plugin install mattpocock-skills@claude-plugins-official`. The flows (`/joakamakaka-skills:*`) and the security reviewer come from the owner's personal plugin in `~/.claude/skills/joakamakaka-skills`, which is not part of this repo.
- **Permission rules** (`.claude/settings.json`): deny reading secrets, printing credentials, skipping git hooks, `reset --hard`, force pushes, PR merges and the Supabase plugin's MCP tools (only its skill is used); ask before pushes, PRs, deploys, GitHub API writes, `git clean`, shell searches that name a `.env` file and edits to the files that guard the repo (gitleaks, git hooks, Claude settings and hooks, workflows, the Snyk policy).
- **Hooks** (`.claude/hooks/`, a workspace package with its own tests, so `pnpm check` validates it): only what the rules cannot express, because it depends on the branch or the time: no commits on `master`, branch names `<type>/CR-<n>` and no deploys during the freeze. They also format with Prettier after each edit, remind about evals, require `pnpm check` before finishing and report the branch and freeze status at session start.
- Rules and hooks are tripwires against mistakes, not a security boundary: the real controls are gitleaks, GitHub push protection and the `master` ruleset.
- **Snyk locally**: so local results match CI, install the CLI at the version pinned in `.github/workflows/security.yml` (`SNYK_VERSION`), sign in with `snyk auth` and run `snyk config set org=<id>` with the same organization as CI. The ID never goes in the repo.
