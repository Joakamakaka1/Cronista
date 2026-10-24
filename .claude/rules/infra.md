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
- Production changes only through CI after merge. Locally, `cdk diff` and `cdk synth` only. Never `--hotswap`.

## Lambdas (`services/*`)

- Node 24 arm64, bundled with esbuild through `NodejsFunction`.
- Handlers stay thin: validate the input with Zod, call the domain, map the result to a response.
- The `api` Lambda verifies the Supabase JWT from `X-Session-Token` against the JWKS (ES256) on every request.
- The `resolver` is idempotent per (season, day): running it twice must not publish twice.
- Structured logs without secrets or players' personal data.
- Before the PR, run the `infra-reviewer` and `security-reviewer` subagents on the diff.
