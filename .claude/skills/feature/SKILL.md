---
name: feature
description: End-to-end flow for a new feature in Cronista, from the Linear issue to an open PR. Use when the user asks to build or add something new.
argument-hint: '<CR-n or short description>'
---

# New feature

Follow these steps in order. Do not skip a step without telling the user why.

1. **Issue**: find the Linear issue (`CR-<n>`) for `$ARGUMENTS`. If there is none, propose a title and description and create it in the `CR` team only after the user agrees.
2. **Branch**: in the main folder, check that no other session is editing it (current branch and `git status`), then `git fetch origin master && git switch -c feature/CR-<n> origin/master`. No worktree (see `workflow.md`).
3. **Understand**: read the code involved and the matching rules. For broad searches, delegate to an Explore or Haiku subagent so file dumps stay out of the main context.
4. **Grill**: resolve every open question (behaviour, names, edge cases, UI copy) with the user before designing, using the `grilling` and `domain-modeling` skills, so settled terms land in `GLOSSARY.md` and hard-to-reverse decisions in `docs/adr/`. Do not fill gaps with assumptions. If the work turns out bigger than one PR, stop and suggest `/to-spec` and `/to-tickets`, which split it into sub-issues of the CR issue.
5. **Plan**: for anything beyond a one-sentence change, enter plan mode and get the plan approved. The plan names the files, the seams under test (the public interfaces the tests go through) and how the result will be verified.
6. **Test first** in `packages/core` and `packages/narrator`, with the `tdd` skill at the seams of the approved plan: one failing test, then the code that passes it, one slice at a time.
7. **Implement** in small commits (`✨ feat(<scope>): …`). Keep each layer in its place (see `code-style.md`).
8. **Verify**: `pnpm check`; the evals if AI code changed; the running app (Claude in Chrome) if the user can see the change.
9. **Version**: bump the minor version in the root `package.json` if the feature reaches production.
10. **Pre-PR**: run `/pre-pr` and fix what it finds.
11. **PR**: run `/pr`.
