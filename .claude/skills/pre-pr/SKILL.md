---
name: pre-pr
description: Local verification before opening a PR in Cronista (checks, evals, Snyk, reviewers, code review, version bump). Use before /pr, or when the user asks whether a branch is ready.
---

# Pre-PR verification

Work on the current branch against `origin/master`, fetched first (`git fetch origin master`): the local `master` is not updated in the one-folder workflow, so diffing against it would count changes that are already merged. Run every step that applies and record each command and its outcome for the PR description. Secrets are not scanned here: gitleaks already runs on every commit (pre-commit hook) and on the whole history in CI.

1. **Scope**: `git diff --stat origin/master...HEAD` plus uncommitted changes. Classify the change: docs or comments only, tooling (`.claude/`, CI, settings, dependencies), or deployable code (`apps/`, `services/`, `packages/`, `infra/`, migrations).
2. **Checks**: `pnpm check` must pass. If AI code changed (`packages/narrator`, `evals`), run the evals and compare with `origin/master`.
3. **Snyk**: when the change touches dependencies or code (skip for docs and comments only), run the same scans as CI (`docs/delivery.md`): `snyk test --all-projects --dev --fail-fast --severity-threshold=high` and `snyk code test --severity-threshold=high`, both blocking. If the CLI is missing or not set up, say so in the report and leave the scans to CI instead of installing anything. One-time setup, done by the user on their machine so local results match CI:
   - Install the Snyk CLI at the version pinned in `.github/workflows/security.yml` (`SNYK_VERSION`).
   - `snyk auth`, which signs in through the browser.
   - `snyk config set org=<id>`, with the same organization as CI. The ID never goes in the repo.

   Ignores need the user's OK first: Snyk Open Source ignores go in `.snyk`, with a reason and an expiry date; Snyk Code ignores follow `docs/delivery.md`.

4. **Reviewers**, scaled to the change:
   - Docs or comments only: no subagents; `/code-review` is enough.
   - Light PR, which takes precedence over the two rows below: fewer than ~100 changed lines that touch none of IAM, RLS or migrations, auth, narrator prompts, CI workflows, the guardrail files (`.claude/settings.json`, `.claude/hooks/`, `.gitleaks.toml`, `.githooks/`, `.snyk`, `.gitignore`), dependencies or the lockfile, and `infra/`. No subagents; `/code-review` is enough.
   - Tooling: `security-reviewer`.
   - Deployable code: the subagents that match the touched paths (`db-reviewer` for `packages/db` and SQL, `narrator-reviewer` for `packages/narrator` and `evals`, `infra-reviewer` for `infra` and `services`) plus `security-reviewer`, in parallel. For large diffs, run the `/pre-pr-review` workflow instead.
5. **Code review**: run the built-in `/code-review` on the branch. Unless the change is docs-only or a light PR (step 4), also run `/mattpocock-skills:code-review` with `origin/master` as the fixed point: its Spec axis checks the diff against the CR issue, which no other reviewer does.
6. **Fix or justify** every finding. Re-run the checks after fixing. Findings that only harden the guardrails against deliberately obfuscated commands are accepted without changes (see `workflow.md`).
7. **Version**: if the change is deployable, confirm the root `package.json` version was bumped (minor for `feat`, patch for `fix` and `perf`; see `workflow.md`).
8. **Manual check**: if users can see the change, confirm it was tried in the running app.

End with a short report: what ran, the result of each step, what was skipped and why, and the remaining risks.
