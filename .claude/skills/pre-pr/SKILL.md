---
name: pre-pr
description: Local verification before opening a PR in Cronista (checks, evals, Snyk, reviewers, code review, version bump). Use before /pr, or when the user asks whether a branch is ready.
---

# Pre-PR verification

Work on the current branch against `master`. Run every step that applies and record each command and its outcome for the PR description. Secrets are not scanned here: gitleaks already runs on every commit (pre-commit hook) and on the whole history in CI.

1. **Scope**: `git diff --stat master...HEAD` plus uncommitted changes. Classify the change: docs or comments only, tooling (`.claude/`, CI, settings, dependencies), or deployable code (`apps/`, `services/`, `packages/`, `infra/`, migrations).
2. **Checks**: `pnpm check` must pass. If AI code changed (`packages/narrator`, `evals`), run the evals and compare with `master`.
3. **Snyk**: when the change touches dependencies or code (skip for docs and comments only), run the same scans as CI (`docs/delivery.md`): `snyk test --all-projects --dev --fail-fast --severity-threshold=high` and `snyk code test --severity-threshold=high`, both blocking. They need the Snyk CLI authenticated on the user's machine (`snyk auth`) with the same organization as CI as its default (the user sets it once with `snyk config set org=<id>`; the ID never goes in the repo), otherwise local results may differ from CI. If the CLI is missing, say so in the report and leave the scans to CI instead of installing anything. Ignores need the user's OK first: Snyk Open Source ignores go in `.snyk`, with a reason and an expiry date; Snyk Code ignores follow `docs/delivery.md`.
4. **Reviewers**, scaled to the change:
   - Docs or comments only: no subagents; `/code-review` is enough.
   - Tooling: `security-reviewer`.
   - Deployable code: the subagents that match the touched paths (`db-reviewer` for `packages/db` and SQL, `narrator-reviewer` for `packages/narrator` and `evals`, `infra-reviewer` for `infra` and `services`) plus `security-reviewer`, in parallel. For large diffs, run the `/pre-pr-review` workflow instead.
5. **Code review**: run the built-in `/code-review` on the branch.
6. **Fix or justify** every finding. Re-run the checks after fixing. Findings that only harden the guardrails against deliberately obfuscated commands are accepted without changes (see `workflow.md`).
7. **Version**: if the change is deployable, confirm the root `package.json` version was bumped (minor for `feat`, patch for `fix`).
8. **Manual check**: if users can see the change, confirm it was tried in the running app.

End with a short report: what ran, the result of each step, what was skipped and why, and the remaining risks.
