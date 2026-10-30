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

## AWS account setup outside the code

The CDK app in `infra` owns the account's resources, cost guards included. A few settings cannot live there and are set by hand.

### Cost alert email

`CronistaAccountGuards` creates an SNS topic for every account alert: Budgets (5 and 10 USD a month), Cost Anomaly Detection (anomalies of 1 USD or more, immediately) and the active findings of IAM Access Analyzer in both regions (us-east-1 forwards its findings to the eu-west-1 event bus). Subscribe your email to it once, so the address never reaches the repo, the templates or CI:

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

## Local Supabase

Migrations, pgTAP tests and the CLI configuration live in `packages/db/supabase`. The same steps run in the `db` check in CI:

```powershell
supabase db start --workdir packages/db              # Postgres only; `supabase start` adds Auth and the API
supabase db reset --workdir packages/db              # applies every migration from scratch
supabase test db --workdir packages/db               # pgTAP
pnpm --filter @cronista/db types                     # regenerates src/database.types.ts
pnpm --filter @cronista/db lint:sql                  # Squawk: no destructive or unsafe statements
```

Use the same Supabase CLI version as CI (`SUPABASE_CLI_VERSION` in `.github/workflows/ci.yml`): the generated types change between releases, and CI fails if they differ from the committed ones.

The local `config.toml` mirrors production except for the Email provider, which is on locally so the signup hook can be tried end to end: with `supabase start`, a signup through the Auth API with an email that is not in `players` gets a 403. Production keeps Email and phone sign-in off (Google only), and nobody runs `supabase config push` from this file: it would turn the Email provider on there.

## The players list

`public.players` is the closed list of players. Its migration also adds the Before User Created hook (`private.before_user_created`), which rejects any signup whose email is not in the list, and a trigger that fills `players.user_id` once a player's email is confirmed (Google sign-ins arrive confirmed).

- **Enable the hook in production** once the migration is applied, before turning on any sign-in provider: Dashboard → Authentication → Hooks → Before User Created → Postgres → schema `private`, function `before_user_created`. It stays a dashboard setting until Terraform covers Supabase.
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
