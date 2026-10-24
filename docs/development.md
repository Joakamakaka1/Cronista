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

The CDK app in `infra` owns the account's resources, cost guards included. Three settings cannot live there and are set once by hand.

### Cost alert email

`CronistaAccountGuards` creates an SNS topic for every account alert: Budgets (5 and 10 USD a month), Cost Anomaly Detection (anomalies of 1 USD or more, immediately) and the active findings of IAM Access Analyzer in both regions (us-east-1 forwards its findings to the eu-west-1 event bus). Subscribe your email to it once, so the address never reaches the repo, the templates or CI:

```powershell
$topic = aws cloudformation describe-stacks --profile la-cronica --region eu-west-1 --stack-name CronistaAccountGuards --query "Stacks[0].Outputs[?OutputKey=='CostAlertsTopicArn'].OutputValue" --output text
$email = Read-Host "Email for cost alerts"
aws sns subscribe --profile la-cronica --region eu-west-1 --topic-arn $topic --protocol email --notification-endpoint $email
Remove-Variable email
```

Then open the confirmation email from AWS. If the topic is ever replaced, subscribe again.

### S3 Block Public Access and the root user

- **Account-level S3 Block Public Access**: all four settings are on. CloudFormation has no resource for it. To check it:

  ```powershell
  aws s3control get-public-access-block --profile la-cronica --account-id (aws sts get-caller-identity --profile la-cronica --query Account --output text)
  ```

- **Root user**: MFA on and no access keys. To check it (expect `[1, 0]`):

  ```powershell
  aws iam get-account-summary --profile la-cronica --query "SummaryMap.[AccountMFAEnabled,AccountAccessKeysPresent]"
  ```

## Local Supabase

Migrations and the CLI configuration live in `packages/db/supabase` (created in the skeleton phase):

```powershell
supabase start --workdir packages/db
supabase db reset --workdir packages/db
```

## What never gets committed

`.gitignore` and gitleaks block it, but the rule comes before the tools:

- Secrets of any kind, `.env` files, keys and certificates.
- Database dumps, real games, the bible with real data and judge labels.
- Players' real names and emails. Fixtures and seeds use invented characters and `@example.com`.

## Working with AI agents

The instructions for Claude Code (and any agent) are in [`AGENTS.md`](../AGENTS.md); the rules, subagents, skills, workflows and hooks are in [`.claude/`](../.claude/). The hooks are a workspace package (`@cronista/claude-hooks`) with their own tests, so `pnpm check` validates them too.
