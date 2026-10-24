---
name: pre-pr
description: Local verification before opening a PR in Cronista (checks, evals, security scans, reviewers, code review, version bump). Use before /pr, or when the user asks whether a branch is ready.
---

# Pre-PR verification

Work on the current branch against `master`. Run every step that applies and record each command and its outcome for the PR description.

1. **Scope**: `git diff --stat master...HEAD` plus uncommitted changes. Classify the change: docs or comments only, tooling (`.claude/`, CI), or deployable code (`apps/`, `services/`, `packages/`, `infra/`, migrations).
2. **Checks**: `pnpm check` must pass. If AI code changed (`packages/narrator`, `evals`), run the evals and compare with `master`.
3. **Secrets**: `gitleaks git --log-opts="master..HEAD" --redact --no-banner --config .gitleaks.toml` for the branch commits, plus `gitleaks git --pre-commit --redact --no-banner --config .gitleaks.toml`, without and with `--staged`, for uncommitted changes to tracked files. Untracked files are scanned by the pre-commit hook when they are committed; commit (or delete) them before the PR.
4. **Snyk**: when the change touches dependencies or code (skip for docs and comments only), run the same scans as CI (`docs/entrega.md`): `snyk test --all-projects --dev --fail-fast --severity-threshold=high` (blocking) and `snyk code test` (report). They need the Snyk CLI authenticated on the user's machine (`snyk auth`); if it is missing, say so in the report and leave the scan to CI instead of installing anything. Ignores go in `.snyk`, always with a reason and an expiry date.
5. **Reviewers**: for small diffs, run the subagents that match the touched paths (`db-reviewer` for `packages/db` and SQL, `narrator-reviewer` for `packages/narrator` and `evals`, `infra-reviewer` for `infra` and `services`) plus `security-reviewer` for any code or config change, in parallel. For large diffs, run the `/pre-pr-review` workflow instead.
6. **Code review**: run the built-in `/code-review` on the branch.
7. **Fix or justify** every finding. Re-run the checks after fixing.
8. **Version**: if the change is deployable, confirm the root `package.json` version was bumped (minor for `feat`, patch for `fix`).
9. **Manual check**: if users can see the change, confirm it was tried in the running app.

End with a short report: what ran, the result of each step, what was skipped and why, and the remaining risks.
