---
name: fix
description: Flow for fixing a bug in Cronista: reproduce it with a failing test, find the root cause, fix it minimally and open a PR. Use when the user reports a bug, an error or a wrong behaviour.
argument-hint: '<CR-n or bug description>'
---

# Bug fix

1. **Issue**: find or create (after the user agrees) the Linear issue `CR-<n>` for `$ARGUMENTS`, with the steps to reproduce.
2. **Branch**: in the main folder, check that no other session is editing it, then `git fetch origin master && git switch -c fix/CR-<n> origin/master`. No worktree (see `workflow.md`).
3. **Reproduce**: get the exact failure first: the error, the logs (Langfuse traces, CloudWatch through the AWS CLI) or the steps in the running app. If it cannot be reproduced, stop and tell the user what you tried.
4. **Failing test**: write a test that fails for the same reason as the bug.
5. **Root cause**: explain it in one or two sentences before changing code. Fix the cause, not the symptom. If the cause is unclear, ask the user rather than guessing.
6. **Fix** minimally, then check whether the same mistake exists elsewhere and tell the user.
7. **Verify**: the new test passes, `pnpm check` passes, and the original reproduction no longer fails.
8. **Version**: bump the patch version in the root `package.json` if the fix reaches production.
9. Run `/pre-pr`, then `/pr`. The PR explains the cause, the fix and how it was verified.
