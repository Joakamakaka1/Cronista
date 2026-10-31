---
paths:
  - 'infra/**'
  - 'services/**'
---

# Infrastructure and services

## CDK (`infra`)

- Regions: eu-west-1, plus us-east-1 for CloudFront-scoped resources (certificates, WAF).
- Only CloudFront is public. S3 and the Lambda Function URLs accept only requests signed by the distribution (OAC).
- One IAM role per Lambda, with the minimum permissions. No wildcards on actions or resources without a reason written in the code.
- Secrets live in SSM Parameter Store (`SecureString`, `/cronista/prod/…`) and are read with the Lambda extension. Never as plain environment variables.
- No account ID, ARN or private resource ID in the code: take them from the environment (`CDK_DEFAULT_ACCOUNT`) or lookups.
- Production changes only after the PR is merged, and never with `--hotswap`. CI deploys them; on a branch, `cdk diff` and `cdk synth` only.
- Exception: what CI cannot or does not deploy yet is deployed from the owner's machine with their CLI credentials. `CronistaGitHubAccess` always deploys this way, because the CloudFormation execution policy denies CI from changing it (`docs/delivery.md`). That only works in a stack that uses `CliCredentialsStackSynthesizer` and was created with it: a stack created through the bootstrap roles keeps `cfn-exec-role` forever, so the changes the policy denies to the CloudTrail trail and the Access Analyzer analyzers cannot deploy, not even from the owner's machine (CR-32, CR-33). Every other stack deploys from `deploy.yml` on merge; a manual deploy of one (after a failed run, say) follows the same rules. Such a deploy runs from a clean, up-to-date `master`, shows `cdk diff` first, waits for the owner's OK in the chat and never runs during the freeze.

## Lambdas (`services/*`)

- Node 24 arm64, bundled with esbuild through `NodejsFunction`.
- Handlers stay thin: validate the input with Zod, call the domain, map the result to a response.
- The four Lambdas follow ADR-23: `core-api` and `ai-api` have Function URLs; `ai-worker` and `notifier` have none.
- `core-api` and `ai-api` verify the Supabase JWT from `X-Session-Token` against the JWKS (ES256) on every request, through `@cronista/http`.
- Only `ai-api` and `ai-worker` read the AI provider keys; each role reads only its own SSM parameters.
- The `ai-worker` is idempotent per (season, day): running it twice must not publish twice.
- Structured logs without secrets or players' personal data.
- Before the PR, `/joakamakaka-skills:pre-pr` runs the reviewers of the zones the diff touches (see `validation.md`).
