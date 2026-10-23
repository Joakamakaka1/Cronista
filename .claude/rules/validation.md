# Validation

A task is done only when it is verified. "It should work" is not a result.

## While working

- In `packages/core` and `packages/narrator`, write the failing test first, then the code that makes it pass. Every fixed bug gets a regression test.
- `pnpm check` must pass before you finish. The Stop hook runs it on uncommitted changes and keeps you working until it is green.
- Changes to the narrator, its prompts or `evals` require an eval run, compared against the previous results (see `narrator.md`).
- Changes the user can see (UI, API responses, notifications) are checked in the running app, not only in tests: run it locally and drive it with the Claude in Chrome extension or real requests.

## Before opening a PR

Run `/pre-pr`. It covers, in order:

1. `pnpm check`, plus the evals if AI code changed.
2. Security scans: gitleaks on the branch commits, and Snyk (`test` and `code test`) when the change touches dependencies or code. Pure docs or comment changes skip Snyk.
3. Review by the subagents that match the diff (`db-`, `narrator-`, `infra-` and `security-reviewer`), through the `/pre-pr-review` workflow for large diffs, then the built-in `/code-review`.
4. Version bump check (see `workflow.md`).

Fix what they find, or explain to the user why a finding does not apply. All checks run locally: the PR should go green in CI on the first run.

## Reporting

- Say what was verified, how (the command and its outcome) and what was not verified, and why.
- Report failures with the relevant output. Never hide a skipped step.
