# Validation

A task is done only when it is verified. "It should work" is not a result.

## While working

- In `packages/core` and `packages/narrator`, write the failing test first, then the code that makes it pass. Every fixed bug gets a regression test.
- `pnpm check` must pass before you finish. The Stop hook runs it on uncommitted changes and, if it fails, blocks you once with the errors: fix them before finishing.
- Changes to the narrator, its prompts or `evals` require an eval run, compared against the previous results (see `narrator.md`).
- Changes the user can see (UI, API responses, notifications) are checked in the running app, not only in tests: run it locally and drive it with the Claude in Chrome extension or real requests.
- Evidence for a bug comes from Langfuse traces, CloudWatch through the AWS CLI and the running app.

## Before opening a PR

`/joakamakaka-skills:pre-pr` runs the checks and one review pass. What it needs from Cronista:

- **Checks**: `pnpm check`, plus the evals when `packages/narrator` or `evals` changed.
- **Scans**: Snyk (`test` and `code test`) when code or dependencies change, with the commands and the ignore rules in `docs/delivery.md`. gitleaks already runs on every commit and in CI.
- **Review zones**: the critical zones and their reviewers are the `REVIEWERS` list in `.claude/workflows/pre-pr-review.js` (database, narrator, infrastructure, and security for auth, dependencies, CI and the guardrail files). A light PR changes fewer than ~100 lines and touches none of them. For several zones, `/pre-pr-review` runs the matching reviewers and verifies each finding; for one, calling its reviewer is enough.
- **Version**: see `workflow.md`.

All checks run locally: the PR should go green in CI on the first run.

## Reporting

- Say what was verified, how (the command and its outcome) and what was not verified, and why.
- Report failures with the relevant output. Never hide a skipped step.
