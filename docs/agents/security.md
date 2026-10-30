# Security notes

What the security reviewer checks Cronista against. The hard rules are in "Secrets and player data" in [`AGENTS.md`](../../AGENTS.md).

- **Public by design**: the Supabase URL and publishable key and the Langfuse public key, because they ship in the web bundle. No other key or token, the AWS account ID, ARNs or private resource IDs may appear anywhere in the repo.
- **Personal data**: players' real names and emails, real games, the bible with real data and judge labels. Fixtures, seeds and the simulated season use invented characters and `@example.com`.
- **Auth**: the Supabase JWT arrives in `X-Session-Token` and is verified against the JWKS on every API request; authorisation uses `app_metadata`. No endpoint trusts client-sent identity.
- **Input**: every external input (HTTP, LLM output, database JSON) is parsed with Zod at the boundary.
- **Infrastructure**: least-privilege IAM, no public S3 bucket or Function URL (CloudFront with OAC in front), secrets from SSM under `/cronista/prod/` rather than plain environment variables, and the security headers (CSP, HSTS) intact.
- **Supply chain**: GitHub Actions pinned by SHA, dependencies at exact versions (pnpm's `minimumReleaseAge` applies).
