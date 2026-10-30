---
name: fix
description: Flow for fixing a bug in Cronista: reproduce it with a failing test, find the root cause, fix it minimally and open a PR. Use when the user reports a bug, an error or a wrong behaviour.
argument-hint: '<CR-n or bug description>'
---

# Bug fix

1. **Issue**: find or create (after the user agrees) the Linear issue `CR-<n>` for `$ARGUMENTS`, with the steps to reproduce.
2. **Branch**: in the main folder, check that no other session is editing it, then `git fetch origin master && git switch -c fix/CR-<n> origin/master`. No worktree (see `workflow.md`).
3. **Diagnose** with the `diagnosing-bugs` skill: a feedback loop that goes red on this bug, a minimal repro, ranked hypotheses shown to the user, then a minimal fix of the cause behind a regression test (`validation.md` requires one). Before changing code, state the root cause to the user in one or two sentences; if it is still unclear, ask rather than guess. Cronista's evidence comes from Langfuse traces, CloudWatch through the AWS CLI and the running app; the secrets file is never read and secrets are never printed (see `AGENTS.md`). Those traces hold real player data: captured requests and logs stay in the scratchpad, and the regression test and its fixtures use invented characters and `@example.com`. If no loop can be built, stop and tell the user what you tried.
4. **Same mistake elsewhere**: check whether the cause repeats in other places and tell the user.
5. **Verify**: the regression test passes, `pnpm check` passes, and the original reproduction no longer fails.
6. **Version**: bump the patch version in the root `package.json` if the fix reaches production.
7. Run `/pre-pr`, then `/pr`. The PR explains the cause, the fix and how it was verified.
