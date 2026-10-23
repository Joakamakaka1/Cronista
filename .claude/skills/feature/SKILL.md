---
name: feature
description: End-to-end flow for a new feature in Cronista, from the Linear issue to an open PR. Use when the user asks to build or add something new.
argument-hint: '<CR-n or short description>'
---

# New feature

Follow these steps in order. Do not skip a step without telling the user why.

1. **Issue**: find the Linear issue (`CR-<n>`) for `$ARGUMENTS`. If there is none, propose a title and description and create it in the `CR` team only after the user agrees.
2. **Branch**: from an up-to-date `master`, create `feature/CR-<n>`. If other sessions share this folder, use a git worktree (`git worktree add ../Cronista-CR-<n> -b feature/CR-<n> master`).
3. **Understand**: read the code involved and the matching rules. For broad searches, delegate to an Explore or Haiku subagent so file dumps stay out of the main context.
4. **Ask**: list every open question (behaviour, names, edge cases, UI copy) and ask the user before designing. Do not fill gaps with assumptions.
5. **Plan**: for anything beyond a one-sentence change, enter plan mode and get the plan approved. The plan names the files, the tests and how the result will be verified.
6. **Test first** in `packages/core` and `packages/narrator`: write the failing test, then the code.
7. **Implement** in small commits (`✨ feat(<scope>): …`). Keep each layer in its place (see `code-style.md`).
8. **Verify**: `pnpm check`; the evals if AI code changed; the running app (Claude in Chrome) if the user can see the change.
9. **Version**: bump the minor version in the root `package.json` if the feature reaches production.
10. **Pre-PR**: run `/pre-pr` and fix what it finds.
11. **PR**: run `/pr`.
