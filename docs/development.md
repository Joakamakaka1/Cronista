# Local development

Environment: native Windows with PowerShell. WSL is only a fallback.

## Requirements

| Tool            | Version                      | Install                                                                                              |
| --------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| Node.js         | 24.x (`.node-version`)       | Official installer                                                                                   |
| pnpm            | `packageManager`             | Standalone, without corepack                                                                         |
| gitleaks        | 8.30+                        | `scoop install gitleaks` (without it, commits are blocked)                                           |
| Supabase CLI    | 2.x                          | `scoop install supabase`                                                                             |
| AWS CLI         | 2.32+                        | Profile `la-cronica`, `aws login`                                                                    |
| Docker Desktop  |                              | For `supabase start`                                                                                 |
| Terraform       | 1.17.1 (`required_version`)  | `mise use -g terraform@1.17.1`, with mise's shims on `PATH`                                          |
| Bitwarden `bws` | 2.1.0 (`requiredBwsVersion`) | `scoop install bitwarden-secrets-manager-cli@2.1.0`, then `scoop hold bitwarden-secrets-manager-cli` |

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

Local commands that need a provider key get it from Bitwarden Secrets Manager on the EU cloud, through `bws run`: the values are environment variables of that process alone, and no key is written to disk (`bws` only saves an encrypted session under `~/.config/bws`). Nothing deployed talks to Bitwarden. Production values live in SSM and GitHub Actions secrets ("SSM parameters" below). Human credentials stay in the personal vault, which `bws` cannot read.

There is no `.env` or `.env.example`. These are the variables, each a secret of the same name in the Bitwarden project:

| Variable              | Value                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`   | Key of the `evals` workspace of the Claude Console, which has a monthly spend limit                    |
| `VOYAGE_API_KEY`      | A Voyage AI key for local use, separate from production's                                              |
| `LANGFUSE_PUBLIC_KEY` | Public half of a local key pair in the same Langfuse project as production, so it can be revoked alone |
| `LANGFUSE_SECRET_KEY` | Secret half of that pair                                                                               |

Run a command with them, or prove that they arrive and work. `pnpm check-keys` makes one Haiku call of a few tokens, one Voyage embedding and one read of the Langfuse project, and prints `ok` or an error class per provider, never a value:

```powershell
pnpm with-secrets <command> [arguments]
pnpm check-keys
```

`missing <name>` means the project has no secret with that exact name, and `http_401` means the key is wrong. A key set in your shell never reaches the command, so each value really comes from Bitwarden. `bws run` uses Windows PowerShell, so `pnpm with-secrets` refuses empty arguments and double or typographic quotes, which that shell would corrupt: put such a command in a script.

### Setting up a machine

In the `Cronista` organization at [vault.bitwarden.eu](https://vault.bitwarden.eu), under Secrets Manager:

1. Create one project with one secret per variable above.
2. Create a machine account with read access to that project alone, and an access token for it.

The Free plan allows 2 users, 3 projects and 3 machine accounts. Then store the project ID, the UUID after `/projects/` in the address of the open project, and the token. Neither reaches the PowerShell history, and the token never shows on screen. It is encrypted with DPAPI, so only your Windows user on this machine can decrypt it:

```powershell
$dir = "$env:USERPROFILE\.secrets\cronista"
New-Item -ItemType Directory -Force $dir | Out-Null
Read-Host "Bitwarden project ID" | Set-Content -NoNewline "$dir\bws-project-id.txt"
Read-Host -AsSecureString "Machine account access token" | ConvertFrom-SecureString | Set-Content -NoNewline "$dir\bws-access-token.dpapi"
Remove-Variable dir
```

`pnpm with-secrets` decrypts the token only to pass it to `bws`, which keeps it from the wrapped command. DPAPI does not stop another process running as your user, so `.claude/settings.json` adds rules against the mistakes an agent could make.

### Rotating a local key

- **A provider key**: change the secret's value in Bitwarden, run `pnpm check-keys`, then revoke the old key.
- **The machine token**: create a new one, store it with the command above and revoke the old one. A revoked token can keep working until the session that `bws` saved expires, so delete that state too: `Remove-Item -Recurse "$env:USERPROFILE\.config\bws\state"`.

## SSM parameters

Production secrets are `SecureString` parameters in eu-west-1, encrypted with the AWS managed `aws/ssm` key. The owner enters every value; the repo only holds the names (`infra/src/config.ts`), and each Lambda's role may read only its own parameters.

| Parameter                               | Value                                                                                                         | Read by                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `/cronista/prod/supabase/secret-key`    | Supabase secret key (`sb_secret_…`)                                                                           | `ai-worker`              |
| `/cronista/prod/anthropic/game-api-key` | Anthropic API key from the `game-prod` workspace of the Claude Console, which has a monthly spend limit       | `ai-api` and `ai-worker` |
| `/cronista/prod/voyage/api-key`         | Voyage AI API key                                                                                             | `ai-api` and `ai-worker` |
| `/cronista/prod/langfuse/secret-key`    | Secret key (`sk-lf-…`) of the Cronista project in Langfuse Cloud EU                                           | `ai-api` and `ai-worker` |
| `/cronista/prod/langfuse/public-key`    | Public key (`pk-lf-…`) of the same project; public by design, kept next to its secret key                     | `ai-api`                 |
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

`ai-api`, `ai-worker` and `notifier` read their keys through the AWS Parameters and Secrets Lambda Extension, which caches them for 5 minutes: a rotated key reaches the running functions within that time. Until the three AI keys exist, `POST /api/ai/hint` answers 503 `providers_not_configured` and the `open-day` and `close-day` jobs fail, which raises the `AiWorkerFailures` alarm; `keep-alive` needs only the Supabase secret key. Until the VAPID pair exists, `notifier` logs a `vapid keys unreadable` warning.

### Rotating secrets

`YearlyMaintenanceReminder` (`CronistaWorkers`) emails this list every 1 October, along with the drill in "Backups and the restore drill". Rotate a key sooner if it may have leaked.

For each parameter: create the new key, store it with the command above, wait 5 minutes for the extension's cache, run the check, and only then revoke the old key.

| Parameter                               | New value from                                                                          | Check                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/cronista/prod/anthropic/game-api-key` | Claude Console, `game-prod` workspace, API keys                                         | Provider check below: `anthropic` is `ok`              |
| `/cronista/prod/voyage/api-key`         | Voyage AI dashboard, API keys                                                           | Provider check below: `voyage` is `ok`                 |
| `/cronista/prod/langfuse/secret-key`    | Langfuse, project settings, API keys. Secret and public keys come as a pair: store both | Provider check below: `langfuse` is `ok`               |
| `/cronista/prod/langfuse/public-key`    | Same pair as above                                                                      | Same check                                             |
| `/cronista/prod/supabase/secret-key`    | Supabase Dashboard, Settings, API Keys, new secret key                                  | `keep-alive` by hand (see "The workers in production") |
| `/cronista/prod/vapid/private-key`      | **Never rotated.** A new pair invalidates every push subscription the browsers hold     | None                                                   |
| `/cronista/prod/vapid/public-key`       | **Never rotated**, for the same reason                                                  | None                                                   |

The age key of the backups only changes if it leaks: a new key is a PR to `.github/backup-recipients.txt`, and older dumps still need the old one, so keep it until they expire 90 days later.

### Renewing the Supabase tokens

GitHub Actions uses three scoped personal access tokens, which only the owner can create (Dashboard, Account, Access Tokens). Each is scoped to the Cronista project alone and expires in a year, the longest Supabase allows. Renew it after the reminder arrives, never before, with that longest expiry, so it outlasts the next reminder. A scope cannot be edited: renewing means a new token. `SUPABASE_MIGRATIONS_TOKEN` was first created with no expiry: replace it at the first renewal.

| Secret                      | Environment       | Permissions                                                                          | When it fails                                       |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`     | `production`      | Database: Read-write; Connection Pooling: Read                                       | The nightly backup, the deploy's backup and migrate |
| `SUPABASE_MIGRATIONS_TOKEN` | `production-plan` | Migrations: Read                                                                     | `plan-database` of every deploy                     |
| `SUPABASE_SETTINGS_TOKEN`   | `production-plan` | Project Settings, API Keys, Auth Config, Auth Signing Keys and SSL Enforcement: Read | `supabase-drift.yml`, every day                     |

The Cloudflare token renews on the same reminder ("Terraform" below).

`supabase db dump --help` and `db push --help` list those permissions for the first token (`database_write`, `database_pooling_config_read`); the rest they mark as optional. The counts of the restore check use the Management API's read-only query, which a token with Database: Read-write may also call.

Check the first token before storing it, without the value showing on screen or in the history. The status is 201; a 403 names the missing permissions:

```powershell
$token = Read-Host -AsSecureString "Supabase access token"
$plain = [System.Net.NetworkCredential]::new('', $token).Password
$ref = '<project-ref>'
'{"query":"select 1"}' | Set-Content -NoNewline "$env:TEMP\query.json"
curl.exe -s -o NUL -w "%{http_code}`n" -X POST "https://api.supabase.com/v1/projects/$ref/database/query/read-only" -H "Authorization: Bearer $plain" -H "content-type: application/json" --data-binary "@$env:TEMP\query.json"
$plain | gh secret set SUPABASE_ACCESS_TOKEN --env production
Remove-Variable plain, token
```

Then run `backup.yml` by hand and delete the old token in the Dashboard once it passes. For the second token, store it the same way as `SUPABASE_MIGRATIONS_TOKEN --env production-plan`, and dispatch `deploy.yml` with `mode=plan`.

The third token belongs to the drift check ("Supabase settings drift" in `delivery.md`), which fails when it expires. Set it without the value showing in the terminal:

```powershell
$token = Read-Host -AsSecureString "Supabase settings token"
[System.Net.NetworkCredential]::new('', $token).Password | gh secret set SUPABASE_SETTINGS_TOKEN --env production-plan
Remove-Variable token
```

### Checking the AI providers

`ai-api` checks the three AI providers from production when the owner invokes it directly: one Haiku call of a few tokens, one Voyage embedding of a fixed word and one Langfuse trace named `provider-check`. It answers `ok` or an error class per provider (`http_401`, `timeout`, `unreachable`, `invalid_reply`) and the trace id, never a key or the model's text. It has no public surface: a Function URL request never reaches it, only `lambda:InvokeFunction` with the owner's credentials.

```powershell
$aiApi = aws cloudformation describe-stack-resources --profile la-cronica --region eu-west-1 --stack-name CronistaEdge --query "StackResources[?ResourceType=='AWS::Lambda::Function' && starts_with(LogicalResourceId, 'AiApi')].PhysicalResourceId | [0]" --output text
'{"check":"providers"}' | Set-Content -NoNewline "$env:TEMP\provider-check.json"
aws lambda invoke --profile la-cronica --region eu-west-1 --function-name $aiApi --cli-binary-format raw-in-base64-out --payload "fileb://$env:TEMP/provider-check.json" "$env:TEMP\provider-check-result.json"
Get-Content "$env:TEMP\provider-check-result.json"
```

Then look for the trace id in the Langfuse project. A `keys_unreadable` status names the keys `ai-api` could not read (`anthropic`, `voyage`, `langfuse` for the secret key, `langfusePublic`).

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

### Alert email

`CronistaAlerts` holds `cronista-alerts`, the SNS topic of every account alert: Budgets (5 and 10 USD a month), Cost Anomaly Detection (anomalies of 1 USD or more, immediately), the active findings of IAM Access Analyzer in both regions (us-east-1 forwards its findings to the eu-west-1 event bus), GuardDuty findings of medium severity or higher (`CronistaThreatDetection-*`, forwarded the same way) and the CloudWatch alarms of the stacks (`CronistaAccountGuards`, `CronistaEdge` and `CronistaWorkers`). Findings arrive as plain text, with a title, the resource and a link to the console; AWS writes the emails of the alarms, Budgets and Cost Anomaly Detection. The stack deploys only from your machine, and the execution policy denies every deploy any change to the topic except publishing, so a deploy cannot unsubscribe you or silence the findings about it. Subscribe your email to it once, so the address never reaches the repo or the templates:

```powershell
$topic = aws cloudformation describe-stacks --profile la-cronica --region eu-west-1 --stack-name CronistaAlerts --query "Stacks[0].Outputs[?OutputKey=='AlertsTopicArn'].OutputValue" --output text
$email = Read-Host "Email for alerts"
aws sns subscribe --profile la-cronica --region eu-west-1 --topic-arn $topic --protocol email --notification-endpoint $email
Remove-Variable email
```

Do not click the link in the confirmation email from AWS: a subscription confirmed that way can be cancelled by anyone who opens the unsubscribe link at the bottom of any alert, without signing in. Copy the link instead, and confirm from the CLI with the value after `Token=`:

```powershell
$token = Read-Host "Token from the confirmation link"
aws sns confirm-subscription --profile la-cronica --region eu-west-1 --topic-arn $topic --token $token --authenticate-on-unsubscribe true
Remove-Variable token
```

Then check that the confirmation was authenticated. A click on the link, perhaps by a mail scanner, leaves this at `false`; unsubscribe and start again if so:

```powershell
$subscription = aws sns list-subscriptions-by-topic --profile la-cronica --region eu-west-1 --topic-arn $topic --query "Subscriptions[0].SubscriptionArn" --output text
aws sns get-subscription-attributes --profile la-cronica --region eu-west-1 --subscription-arn $subscription --query "Attributes.ConfirmationWasAuthenticated" --output text
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

`CronistaGitHubAccess` deploys only from your machine, never from CI (see "AWS OIDC roles" in `delivery.md`). So do the alerts topic, the CloudTrail trail, the Access Analyzer analyzers and GuardDuty (see "Alert email", "The CloudTrail trail", "Access Analyzer" and "GuardDuty"). After changing one, from a clean, up-to-date `master`, outside the freeze, name the stack: `CronistaGitHubAccess`, `CronistaAlerts`, `CronistaAuditTrail`, `CronistaAccessAnalyzer-<region>` or `CronistaThreatDetection-<region>`:

```powershell
pnpm --filter @cronista/infra exec cdk diff CronistaGitHubAccess --method=template --profile la-cronica
pnpm --filter @cronista/infra exec cdk deploy CronistaGitHubAccess --profile la-cronica
```

The bootstrap stacks of both regions use its `cronista-cfn-execution` policy as execution policy and permissions boundary. The CLI keeps the execution policy when you bootstrap again, but drops the boundary unless you pass it, so always bootstrap with both flags:

```powershell
$account = aws sts get-caller-identity --profile la-cronica --query Account --output text
pnpm --filter @cronista/infra exec cdk bootstrap "aws://$account/eu-west-1" "aws://$account/us-east-1" --profile la-cronica --cloudformation-execution-policies "arn:aws:iam::${account}:policy/cronista-cfn-execution" --custom-permissions-boundary cronista-cfn-execution
```

`CronistaGitHubAccess` also attaches `cronista-bootstrap-deploy-limits` to the deploy role of each region ("CloudFormation execution policy and permissions boundary" in `delivery.md`), so those roles must exist before it deploys. A bootstrap update keeps the policy, but a replaced role would lose it, and deploying the stack again would not bring it back, because its template has not changed. So after every bootstrap, check that each line lists it:

```powershell
$account = aws sts get-caller-identity --profile la-cronica --query Account --output text
foreach ($region in 'eu-west-1', 'us-east-1') {
  aws iam list-attached-role-policies --profile la-cronica --role-name "cdk-hnb659fds-deploy-role-$account-$region" --query "AttachedPolicies[].PolicyName" --output text
}
```

If one does not, attach it again with `aws iam attach-role-policy --profile la-cronica --role-name "cdk-hnb659fds-deploy-role-$account-<region>" --policy-arn "arn:aws:iam::${account}:policy/cronista-bootstrap-deploy-limits"`.

In a new account the two depend on each other, because the stack needs the deploy roles and those flags need its policy: run a plain `cdk bootstrap`, deploy the stack, then bootstrap as above.

The stack goes with one Actions secret, `AWS_ACCOUNT_ID`, piped so the value never shows: `aws sts get-caller-identity --profile la-cronica --query Account --output text | gh secret set AWS_ACCOUNT_ID`. The environments and the Actions allow-list are in `terraform/github`.

### The CloudTrail trail

`CronistaAuditTrail` holds the account's multi-region trail, the bucket of its logs and the bucket policy, all retained. It deploys only from your machine with the CLI credentials: the execution policy denies every deploy changing the trail or writing to its bucket.

The trail started in `CronistaAccountGuards` and was imported into this stack, so that it would not run as `cfn-exec-role` ("Stacks deployed with the CLI credentials" in `delivery.md`). The three resources keep their old names, which is why the policy also denies the bucket name a replacement would get.

### Access Analyzer

`CronistaAccessAnalyzer-eu-west-1` and `CronistaAccessAnalyzer-us-east-1` each hold the region's account analyzer, retained, and a rule named `cronista-access-analyzer-findings`. That rule sends active findings to the alerts topic; in us-east-1 it first forwards them to the eu-west-1 bus through the `cronista-access-analyzer-forwarder` role. Both stacks deploy only from your machine with the CLI credentials: the execution policy denies every deploy deleting an analyzer, changing its archive rules and findings, or changing those rules or that role.

Each analyzer was imported into its stack, and deleting a stack keeps its analyzer. Access Analyzer sends an event only when a finding appears or changes, so a us-east-1 finding raised while that rule or role is being replaced is never forwarded. After replacing either, list the active findings and compare their `updatedAt` with the start of the change:

```powershell
$analyzer = aws accessanalyzer list-analyzers --profile la-cronica --region us-east-1 --type ACCOUNT --query "analyzers[0].arn" --output text
aws accessanalyzer list-findings-v2 --profile la-cronica --region us-east-1 --analyzer-arn $analyzer --query "findings[?status=='ACTIVE'].[updatedAt,resourceType,resource]" --output table
```

### GuardDuty

`CronistaThreatDetection-eu-west-1` and `CronistaThreatDetection-us-east-1` each hold the region's GuardDuty detector and a rule named `cronista-guardduty-findings`. That rule sends findings of medium severity or higher (4.0 and up) to the alerts topic; in us-east-1 it first forwards them to the eu-west-1 bus through the `cronista-guardduty-forwarder` role. Low findings stay in the console. The cost is cents a month, mostly the analysis of CloudTrail events: GuardDuty shows the projection under **Usage**, and the budgets and anomaly alerts watch it too.

Like `CronistaGitHubAccess`, both stacks deploy only from your machine with the CLI credentials: the execution policy denies CI any change to a detector, those rules or that role. Deleting a stack keeps its detector.

The eu-west-1 detector was enabled by hand and imported into its stack, so it keeps its findings.

To check that findings reach your email, create a sample medium finding in each region. The email reads like a real finding, about `GeneratedFindingAPIName`, with nothing marking it as a sample. Archive the samples in the console afterwards:

```powershell
foreach ($region in 'eu-west-1', 'us-east-1') {
  $detector = aws guardduty list-detectors --profile la-cronica --region $region --query "DetectorIds[0]" --output text
  aws guardduty create-sample-findings --profile la-cronica --region $region --detector-id $detector --finding-types Recon:IAMUser/MaliciousIPCaller
}
```

### The domain in Cloudflare

`jcvstro.dev` lives in Cloudflare, outside AWS. Four NS records there delegate `cronista.jcvstro.dev` to the Route 53 zone in `CronistaDomain`, which was created by hand and then imported into CDK, so it keeps those name servers. `terraform/cloudflare` owns the records and reads the name servers of the zone that `CronistaDomain` names in the SSM parameter `/cronista/prod/domain/hosted-zone-id`, in us-east-1.

- If the zone is ever replaced, run `apply` in `terraform/cloudflare` (see "Terraform" below): it moves the delegation to the new name servers.
- Before deleting the zone, remove the NS records with Terraform; never the other way round, or the subdomain points at name servers someone else could claim.

To compare both sides:

```powershell
aws route53 get-hosted-zone --profile la-cronica --id (aws cloudformation describe-stack-resources --profile la-cronica --region us-east-1 --stack-name CronistaDomain --query "StackResources[?ResourceType=='AWS::Route53::HostedZone'].PhysicalResourceId | [0]" --output text) --query "DelegationSet.NameServers"
Resolve-DnsName cronista.jcvstro.dev -Type NS -Server 1.1.1.1
```

Cloudflare adds CAA records to `jcvstro.dev` that leave Amazon out. The zone has its own CAA record for Amazon, so the subdomain does not inherit them and ACM can issue.

## The allowed countries

CloudFront serves only the 27 EU members and Canada, at no cost, on the site and the API alike. Every other country gets a 403 from CloudFront. Supabase Auth is outside CloudFront and unaffected. A player who travels outside the list is locked out until their country is added.

To add a country, add its ISO 3166-1 alpha-2 code to `allowedViewerCountries` in `infra/src/config.ts` and to the test in `infra/src/edge-stack.test.ts`, in a PR. `deploy.yml` applies it after the approval, and CloudFront takes a few minutes to propagate the change.

GitHub's runners are mostly in the US, so the deploy workflows check the site from inside AWS ("The smoke test" in `delivery.md`).

## The APIs in production

Four alarms reach the alerts topic:

- `CoreApiErrors` and `AiApiErrors`: the Function URL answered a 5xx, which covers a function error, a timeout and a handler that threw (`withRequestLog` turns a throw into a 500, so Lambda's `Errors` metric would miss it). The `501` of the stubs counts too, so the connection check trips them until v1 fills those routes in.
- `LambdaThrottles`: any Lambda of the region was throttled. One metric for all of them, because the app's other alarms already use the 10 alarm metrics of the free tier and each one more costs 0.10 USD a month; each function's own `Throttles` metric in the console says which one.
- `ClientErrors`: a player's browser reported an uncaught error (see below).

### Both API alarms at once

A run of the connection check ("Probar conexión") fires `CoreApiErrors` and `AiApiErrors` together, one email each, because it calls both stubs on purpose and each answers `501` once. They stay in `ALARM` for about 15 minutes, and in that time neither emails again, not even for a real failure. A deploy fires neither: its smoke test and the hourly check of the public site only get 401s from the APIs.

To tell a check from a failure, list the 5xx each API logged in the last two weeks, with `CoreApiLogs` and then `AiApiLogs`:

```powershell
$logs = aws cloudformation describe-stack-resources --profile la-cronica --region eu-west-1 --stack-name CronistaEdge --query "StackResources[?ResourceType=='AWS::Logs::LogGroup' && starts_with(LogicalResourceId, 'CoreApiLogs')].PhysicalResourceId | [0]" --output text
aws logs filter-log-events --log-group-name $logs --profile la-cronica --region eu-west-1 --filter-pattern '{ $.message.status >= 500 }' --query "events[].message"
```

A check leaves one `501` on `POST /api/actions` and one on `POST /api/ai/hint`. Any other status is a real failure, and so is an alarm with no entry at that time, because a timeout or a crash ends the function before it logs the request.

### Errors in the browser

Once signed in, the site reports its uncaught errors with `POST /api/client-errors` (`apps/web/README.md`). `core-api` logs each one as `client error` and counts it as `ClientError` (namespace `Cronista/Site`), and `ClientErrors` emails the alerts topic at the first one.

The log entry holds the error type, script path, line, column and release. It has no message, page URL or player, so it says where to look and not what the player saw. The alarm's period is one hour, so a repeating error sends one email: read the log for how often it happened.

```powershell
$logs = aws cloudformation describe-stack-resources --profile la-cronica --region eu-west-1 --stack-name CronistaEdge --query "StackResources[?ResourceType=='AWS::Logs::LogGroup' && starts_with(LogicalResourceId, 'CoreApiLogs')].PhysicalResourceId | [0]" --output text
aws logs tail $logs --profile la-cronica --region eu-west-1 --since 1d --filter-pattern '"client error"'
```

An error before signing in is not reported, because the route only accepts signed-in players. A page that never loads reports nothing either, which is what the hourly check of the public site covers.

### The kill switch

For an emergency at night, when the APIs must stop now and a deploy is not an option (a runaway client spending credits, a bug corrupting data). With reserved concurrency 0, Lambda refuses every call: `/api/*` answers 429, the site itself stays up, and `ai-worker` and `notifier` keep running. `LambdaThrottles` fires as soon as a request arrives, and from 08:00 to 23:00 it emails again at every hourly check of the site, which also raises `SiteCheckFailedAlarm`. The deploy's smoke test fails while the switch is on, so turn it off before any deploy.

```powershell
$functionOf = { param($prefix) aws cloudformation describe-stack-resources --profile la-cronica --region eu-west-1 --stack-name CronistaEdge --query "StackResources[?ResourceType=='AWS::Lambda::Function' && starts_with(LogicalResourceId, '$prefix')].PhysicalResourceId | [0]" --output text }
$coreApi = & $functionOf 'CoreApi'
$aiApi = & $functionOf 'AiApi'
aws lambda put-function-concurrency --profile la-cronica --region eu-west-1 --function-name $coreApi --reserved-concurrent-executions 0
aws lambda put-function-concurrency --profile la-cronica --region eu-west-1 --function-name $aiApi --reserved-concurrent-executions 0
```

The way back sets the values of `infra/src/edge-stack.ts`, 5 for `core-api` and 2 for `ai-api`:

```powershell
$functionOf = { param($prefix) aws cloudformation describe-stack-resources --profile la-cronica --region eu-west-1 --stack-name CronistaEdge --query "StackResources[?ResourceType=='AWS::Lambda::Function' && starts_with(LogicalResourceId, '$prefix')].PhysicalResourceId | [0]" --output text }
$coreApi = & $functionOf 'CoreApi'
$aiApi = & $functionOf 'AiApi'
aws lambda put-function-concurrency --profile la-cronica --region eu-west-1 --function-name $coreApi --reserved-concurrent-executions 5
aws lambda put-function-concurrency --profile la-cronica --region eu-west-1 --function-name $aiApi --reserved-concurrent-executions 2
aws lambda get-function-concurrency --profile la-cronica --region eu-west-1 --function-name $coreApi
aws lambda get-function-concurrency --profile la-cronica --region eu-west-1 --function-name $aiApi
```

Always run the way back. CloudFormation compares templates, not what is live, so a later deploy that does not change the value in `edge-stack.ts` may leave it at 0.

## Terraform

`terraform/github` and `terraform/cloudflare` own what is not AWS ("Terraform" in `delivery.md`). Set up each module once per machine. The bucket name stays out of the repo:

```powershell
$bucket = aws cloudformation describe-stacks --profile la-cronica --region eu-west-1 --stack-name CronistaGitHubAccess --query "Stacks[0].Outputs[?OutputKey=='DataBucketName'].OutputValue" --output text
$env:AWS_PROFILE = 'la-cronica'
terraform -chdir=terraform/github init -backend-config="bucket=$bucket"
terraform -chdir=terraform/cloudflare init -backend-config="bucket=$bucket"
```

**GitHub.** The provider uses your `gh` session when `GITHUB_TOKEN` is not set, so no extra admin token exists. From an up-to-date `master`, after the merge and outside the freeze:

```powershell
terraform -chdir=terraform/github plan
terraform -chdir=terraform/github apply
```

**Cloudflare.** The token has Zone Read and DNS Edit on `jcvstro.dev` alone. It is not stored anywhere: keep it in your password manager and enter it for each session. Never paste this module's plan into a PR or a log, because it shows private IDs:

```powershell
$token = Read-Host -AsSecureString "Cloudflare API token"
$env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $token).Password
Remove-Variable token
terraform -chdir=terraform/cloudflare plan
terraform -chdir=terraform/cloudflare apply
Remove-Item env:CLOUDFLARE_API_TOKEN
```

**Rebuilding a state.** Both states were imported, not created, and a lost one is imported again. S3 versioning keeps the older states for 90 days, so try restoring one first. Import blocks go in `imports.local.tf`, which git ignores, because they hold private IDs. Delete the file after the `apply`:

```powershell
$repo = 'repos/Joakamakaka1/Cronista'
$imports = [ordered]@{
  'github_repository.cronista' = 'Cronista'
  'github_repository_vulnerability_alerts.cronista' = 'Cronista'
  'github_repository_ruleset.master' = "Cronista:$(gh api "$repo/rulesets" --jq '.[0].id')"
  'github_actions_repository_permissions.cronista' = 'Cronista'
  'github_workflow_repository_permissions.cronista' = 'Cronista'
}
foreach ($environment in 'production', 'production-approval', 'production-plan', 'production-web') {
  $imports["github_repository_environment.this[`"$environment`"]"] = "Cronista:$environment"
  $policy = gh api "$repo/environments/$environment/deployment-branch-policies" --jq '.branch_policies[0].id'
  $imports["github_repository_environment_deployment_policy.master[`"$environment`"]"] = "Cronista:${environment}:$policy"
}
$imports.GetEnumerator() | ForEach-Object { "import {`n  to = $($_.Key)`n  id = `"$($_.Value)`"`n}`n" } | Set-Content terraform/github/imports.local.tf
```

For Cloudflare, with the token set as above:

```powershell
$headers = @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" }
$zone = (Invoke-RestMethod -Headers $headers "https://api.cloudflare.com/client/v4/zones?name=jcvstro.dev").result[0].id
$records = (Invoke-RestMethod -Headers $headers "https://api.cloudflare.com/client/v4/zones/$zone/dns_records?type=NS&name=cronista.jcvstro.dev").result
$records | ForEach-Object { "import {`n  to = cloudflare_dns_record.delegation[`"$($_.content)`"]`n  id = `"$zone/$($_.id)`"`n}`n" } | Set-Content terraform/cloudflare/imports.local.tf
```

Each plan must read `0 to add, 0 to destroy`. The first `apply` after importing the repo also shows it updating two settings that exist only in the state, `archive_on_destroy` and `ignore_vulnerability_alerts_during_read`.

## The workers in production

`CronistaWorkers` runs `ai-worker` at 08:00 (`open-day`), 22:00 (`close-day`) and 04:00 (`keep-alive`), and queues the reminders at 19:00 and 21:00 for `notifier`, all in Europe/Madrid. `keep-alive` counts the players with a `HEAD` request to the Data API, signed with the Supabase secret key: one query a day that returns no rows. Supabase says a few queries a day usually keep a Free plan project from pausing after a quiet week, without promising it: if its warning email arrives, open the project in the Dashboard. The schedules live in the `cronista` group:

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

Six alarms reach the alerts topic: `AiWorkerFailures` (an attempt of a job failed, even if a retry then succeeds, or a job was dropped without running), `NotifierErrors`, `NotificationDeadLettersAlarm` (dead notifications are waiting; it clears once they are gone, or after six hours in which nothing touches the queue, when SQS stops sending its metrics), `UndeliveredSchedulesAlarm` (each job, reminder or check that Scheduler could not deliver), `GameLoopCheckMissing` (see "The deadlines" below) and `SiteCheckFailedAlarm` (see "The public site" below). For dead notifications, fix the cause and move them back to the queue they came from:

```powershell
$dlq = aws cloudformation describe-stack-resources --profile la-cronica --region eu-west-1 --stack-name CronistaWorkers --query "StackResources[?ResourceType=='AWS::SQS::Queue' && starts_with(LogicalResourceId, 'NotificationDeadLetters')].PhysicalResourceId | [0]" --output text
aws sqs start-message-move-task --profile la-cronica --region eu-west-1 --source-arn (aws sqs get-queue-attributes --profile la-cronica --region eu-west-1 --queue-url $dlq --attribute-names QueueArn --query Attributes.QueueArn --output text)
```

A message in the schedules' dead-letter queue (`UndeliveredSchedules`) is a job, a reminder or a check that Scheduler could not deliver within an hour. Read it to see which one, run a missed job by hand as above, then purge the queue: it is not redriven.

### The deadlines

An error alarm misses a schedule that never fires and a job that ends without publishing, so the day's two jobs report that they finished and something checks that they did:

1. `ai-worker` records `JobCompleted` (namespace `Cronista/GameLoop`, dimension `Job`) in embedded metric format when `open-day` or `close-day` finishes its work. It writes the line straight to stdout, because CloudWatch does not recognize a metric that `console` logs with the JSON log format.
2. At 08:30 and 22:30, Scheduler queues a check for `notifier`, apart from `ai-worker` and its schedule role, so a broken or busy worker cannot silence it.
3. `notifier` reads the metric over the hour before the deadline. With no report, it emails `Cronista: the day was not opened` or `not closed`, once per day that fails. A retry of the close that finishes after 22:30 still raises the alert.
4. `notifier` records `DeadlineChecked` after each check. `GameLoopCheckMissing` fires when no check has reported for 15 hours, longer than the 14 between 08:30 and 22:30. It starts in `ALARM`, so the first deploy of the alarm sends one email until the next check runs.

To test the alert, queue a check of a time with no report, which sends a real email. `scheduledTime` is the UTC time of the deadline; CloudWatch keeps one-minute data for 15 days, so any older time counts as no report:

```powershell
$queue = aws cloudformation describe-stack-resources --profile la-cronica --region eu-west-1 --stack-name CronistaWorkers --query "StackResources[?ResourceType=='AWS::SQS::Queue' && starts_with(LogicalResourceId, 'Notifications')].PhysicalResourceId | [0]" --output text
'{"type":"game-loop-check","job":"open-day","scheduledTime":"2026-10-01T06:30:00Z"}' | Set-Content -NoNewline "$env:TEMP\check.json"
aws sqs send-message --profile la-cronica --region eu-west-1 --queue-url $queue --message-body "file://$env:TEMP/check.json"
```

### The public site

The other alarms watch the Lambdas, which leaves out CloudFront, DNS and the certificate. So Scheduler queues a check for `notifier` every hour from 08:00 to 23:00, which requests the site from eu-west-1 and expects what the deploy smoke test expects (`delivery.md`, "The smoke test"): 200 on the page, and 401 on `/api/me` and `POST /api/ai/hint`, which spends nothing on AI.

After a failure it waits 5 seconds and tries once more, so a network blip sends no email. If the retry fails too, it logs `site check failed` with the report and records `SiteCheckFailed` (namespace `Cronista/Site`), and `SiteCheckFailedAlarm` emails the alerts topic. The alarm's period is one hour, so it sends one email however long the outage lasts, plus another the next morning if it lasts the night. A failure that reaches an API can email every hour as well, through `CoreApiErrors`, `AiApiErrors` or `LambdaThrottles`: their period is 5 minutes, so they clear between two checks.

The report says what answered wrong, and status 0 means no answer at all:

- Status 0 on all three: DNS, the certificate or CloudFront.
- 403 on all three: the geo restriction or the WAF refused the request, which has to come from an allowed country.
- 429 on both APIs: the kill switch is on.
- 5xx on one API: that Lambda, whose own alarm fires too.

```powershell
$logs = aws cloudformation describe-stack-resources --profile la-cronica --region eu-west-1 --stack-name CronistaWorkers --query "StackResources[?ResourceType=='AWS::Logs::LogGroup' && starts_with(LogicalResourceId, 'NotifierLogs')].PhysicalResourceId | [0]" --output text
aws logs tail $logs --profile la-cronica --region eu-west-1 --since 1d --filter-pattern '"site check"'
```

With these checks the app uses 5 custom metrics, out of the 10 in the free tier, and 11 alarm metrics, one over the free tier's 10. That one costs 0.10 USD a month, within the 0-3 USD that `account-guards-stack.ts` expects.

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

The local `config.toml` mirrors production except for the sign-in providers. Google is not set up locally, and Email is on so the signup hook can be tried end to end: with `supabase start`, a signup through the Auth API with an email that is not in `players` gets a 403. Production keeps Email and phone sign-in off (Google only), and nobody runs `supabase config push` from this file: it would turn the Email provider on there.

## Supabase in production

### Settings outside the code

The production project is configured in the Dashboard, and nothing in the repo applies these settings. A daily check compares them with `infra/scripts/supabase-settings.ts` and fails if they differ ("Supabase settings drift" in `delivery.md`). When one changes, update this table and that file in the same PR. The check cannot read "Automatically expose new tables", so that row stays by hand.

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

`deploy.yml` applies them after each merge, once its plan is approved (`docs/delivery.md`). To push them by hand, after a failed run for instance, start from an up-to-date `master`, with the owner's OK and outside the deploy freeze. `db push` signs in through the Management API with a temporary login role (`supabase login`), so it needs no database password:

```powershell
supabase link --project-ref <project-ref> --workdir packages/db   # once per machine; the ref is the subdomain of the Supabase URL
supabase db push --dry-run --linked --workdir packages/db         # lists the migrations it would apply
supabase db push --linked --workdir packages/db
```

### Backups and the restore drill

Every night and before every migration, CI dumps the database (roles, schema and data), checks that the dump restores, encrypts it to the owner's age key and stores it under `backups/` in the data bucket for 90 days (`docs/delivery.md`). Only the owner can decrypt a dump.

The key pair is made once, with [age](https://github.com/FiloSottile/age) (`winget install FiloSottile.age`). Keep an offline copy of the private key file, in the password manager for instance: without it no backup can be restored. The public key goes in `.github/backup-recipients.txt` through a PR.

```powershell
age-keygen -o "$env:USERPROFILE\.secrets\cronista\backup-age-key.txt"   # prints the public key (age1…)
```

**The automatic check.** Every run restores the plain text dump into a throwaway local Postgres, in the same job and before encrypting it (`.github/actions/dump-database/restore-check.sh`). It passes when every table of production exists in the copy, with a row count between those read from production before and after the data dump, and when the copy has as many public tables with RLS and as many policies. The log is public, so it shows only names and counts, and a psql error shows only its SQLSTATE.

A failure fails the run, which emails the owner, and in `deploy.yml` it stops the migrations and the stacks. The dump is stored anyway, since it may still be the best copy there is. To try again, use "Re-run all jobs": re-running the failed job alone reuses the old result. An undefined column or table (`42703`, `42P01`) usually means that the Auth or Storage schema in production is ahead of the images of the pinned CLI: update `SUPABASE_CLI_VERSION`.

**The manual drill.** The automatic check does not prove that S3 holds the dump or that the owner's key decrypts it, so restore one by hand too. It ran once when the automatic check shipped, and then runs only:

- When the backup chain changes: `backup.yml`, the backup jobs of `deploy.yml`, `.github/actions/dump-database`, `.github/actions/store-backup`, the age version or `.github/backup-recipients.txt`. The PR template asks for it.
- After a Supabase Postgres major upgrade.
- After adding an extension or a role.
- Before a `contract` migration.
- Once a year, when `YearlyMaintenanceReminder` arrives.

It needs Docker Desktop, the owner's AWS profile (the backups role can only write) and the private key. Run it from the repository root; the dev stack must be stopped, since the drill project uses the same ports. Never copy a decrypted dump into the repo: it holds real player data.

1. Download the latest dump:

   ```powershell
   $drill = Join-Path $env:TEMP "cronista-drill"
   New-Item -ItemType Directory -Force $drill | Out-Null
   $bucket = aws cloudformation describe-stacks --profile la-cronica --region eu-west-1 --stack-name CronistaGitHubAccess --query "Stacks[0].Outputs[?OutputKey=='DataBucketName'].OutputValue" --output text
   # The data part is uploaded last, so its folder holds the whole dump.
   $latest = aws s3api list-objects-v2 --profile la-cronica --region eu-west-1 --bucket $bucket --prefix backups/ --query "sort_by(Contents[?ends_with(Key, '/data.sql.age')], &LastModified)[-1].Key" --output text
   $folder = $latest.Substring(0, $latest.LastIndexOf('/'))
   aws s3 cp --profile la-cronica --region eu-west-1 --recursive "s3://$bucket/$folder/" $drill
   ```

2. Decrypt it:

   ```powershell
   foreach ($part in 'roles', 'schema', 'data') {
     age --decrypt -i "$env:USERPROFILE\.secrets\cronista\backup-age-key.txt" -o "$drill\$part.sql" "$drill\$part.sql.age"
   }
   ```

3. Read the counts from production: run `.github/actions/dump-database/table-counts.sql` with the read-only MCP server or the Dashboard, and save each row as `name<TAB>count` in `$drill\counts.tsv`.

4. Restore it and compare, with the script CI runs. It starts an empty local project, restores the three parts and removes the project at the end:

   ```powershell
   supabase stop --workdir packages/db
   $paths = ($drill -replace '\\', '/')
   & "$env:ProgramFiles\Git\bin\bash.exe" .github/actions/dump-database/restore-check.sh $paths "$paths/counts.tsv" "$paths/counts.tsv"
   ```

   Production keeps changing after the dump, so a difference in tables that change without a player acting, such as `auth.sessions`, `auth.refresh_tokens` or `auth.flow_state`, is expected. Any other difference needs a look. The script's exit code alone does not tell them apart.

5. Remove the plain text:

   ```powershell
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

- **Remove a player**: delete the user in Authentication → Users (the link in `players` is cleared) and then their row in `players`. Deleting only the row keeps the account, but every policy for players denies it, because they all call `private.is_player()`.
- If a row is added back for someone whose user still exists, the trigger does not run again: set `user_id` by hand to their id in Authentication → Users.

## What never gets committed

`.gitignore` and gitleaks block it, but the rule comes before the tools:

- Secrets of any kind, `.env` files, keys and certificates.
- Database dumps, real games, the bible with real data and judge labels.
- Players' real names and emails. Fixtures and seeds use invented characters and `@example.com`.

## Working with AI agents

The instructions for Claude Code (and any agent) are in [`AGENTS.md`](../AGENTS.md); the rules, subagents, skills, workflows and hooks are in [`.claude/`](../.claude/).

- **Plugins**: `.claude/settings.json` enables them, but Claude Code does not download them on its own. Install each marketplace plugin it lists once per machine, for example `claude plugin install mattpocock-skills@claude-plugins-official`. The flows (`/joakamakaka-skills:*`) and the security reviewer come from the owner's personal plugin in `~/.claude/skills/joakamakaka-skills`, which is not part of this repo.
- **Permission rules** (`.claude/settings.json`): deny reading secrets, printing credentials, skipping git hooks, `reset --hard`, force pushes, PR merges and the Supabase plugin's MCP tools (only its skill is used); ask before pushes, PRs, deploys, `terraform` commands that change the infrastructure or its state, GitHub API writes, `git clean`, shell searches that name a `.env` file, a command wrapped by hand with `pnpm with-secrets` (named scripts like `pnpm check-keys` need no OK) and edits to the files that guard the repo (gitleaks, git hooks, Claude settings and hooks, workflows and their composite actions, the Snyk policy).
- **Hooks** (`.claude/hooks/`, a workspace package with its own tests, so `pnpm check` validates it): only what the rules cannot express, because it depends on the branch or the time: no commits on `master`, branch names `<type>/CR-<n>` and no deploys, deploy approvals or deploy dispatches during a freeze. They also format with Prettier after each edit, remind about evals, require `pnpm check` before finishing and report the branch and freeze status at session start.
- Rules and hooks are tripwires against mistakes, not a security boundary: the real controls are gitleaks, GitHub push protection and the `master` ruleset.
- **Snyk locally**: so local results match CI, install the CLI at the version pinned in `.github/workflows/security.yml` (`SNYK_VERSION`), sign in with `snyk auth` and run `snyk config set org=<id>` with the same organization as CI. The ID never goes in the repo.
