---
name: fix
description: Flow for fixing a bug in Cronista: build a loop that reproduces it, find the root cause, fix it behind a regression test and open a PR. Use when the user reports a bug, an error or a wrong behaviour.
argument-hint: '<CR-n or bug description>'
---

# Bug fix

1. **Issue**: find or create (after the user agrees) the Linear issue `CR-<n>` for `$ARGUMENTS`, with the steps to reproduce.
2. **Branch**: in the main folder, check that no other session is editing it, then `git fetch origin master && git switch -c fix/CR-<n> origin/master`. No worktree (see `workflow.md`).
3. **Evidence**: Langfuse traces, CloudWatch through the AWS CLI and the running app. They hold real player data: before saving a captured request or log in the scratchpad, redact names, emails and other identifiers, and keep an action's text only when the bug depends on it. Tests and fixtures use invented characters and `@example.com`. Secrets follow `AGENTS.md`.
4. **Diagnose** with the `diagnosing-bugs` skill: a feedback loop that goes red on this bug, a minimal repro and ranked hypotheses shown to the user. Before changing code, state the root cause to the user in one or two sentences; if it is still unclear, ask rather than guess. If no loop can be built, stop and tell the user what you tried.
5. **Fix**: write the regression test first (`validation.md` requires one) and watch it fail, then fix the cause minimally. If there is no correct seam for the test, stop and tell the user instead of skipping it.
6. **Same mistake elsewhere**: check whether the cause repeats in other places and tell the user.
7. **Verify**: the regression test passes, `pnpm check` passes, and the original reproduction no longer fails.
8. **Version**: bump the patch version in the root `package.json` if the fix reaches production.
9. Run `/pre-pr`, then `/pr`. The PR explains the cause, the fix and how it was verified.
