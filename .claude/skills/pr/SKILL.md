---
name: pr
description: Opens the pull request for the current branch with a title in the commit convention and a detailed, plain description, then follows CI. Use when a branch has passed /pre-pr and is ready for review, or when the user asks to open the PR. Never merges.
---

# Open the PR

1. **Ready?** `/pre-pr` must have run on the current state of the branch and passed: `pnpm check` green and every finding fixed or justified to the user. If not, run it (or finish it) first.
2. **Branch**: it must be `<type>/CR-<n>`. If not, rename it with `git branch -m` before pushing.
3. **Title**: `<emoji> <type>(<scope>): <description>`, at most 66 characters (the squash commit appends `(#NN)` after a space).
4. **Description**: fill in every section of `.github/pull_request_template.md`, replacing the comments, and tick the checklist honestly. Be detailed but plain: short sentences, no filler, nothing that the diff already says line by line.
5. **Confirm**: show the user the title and description, and ask before pushing and creating the PR.
6. **Publish**: `git push -u origin <branch>`, then `gh pr create --base master --title "…" --body-file <file>` (write the body to a scratchpad file to keep the formatting).
7. **CI**: follow the required checks (`code`, `secrets` and `snyk`) until they are green. If one fails, read its log, fix the cause and ask the user before pushing again, unless they turned on Auto-fix for this PR (standing approval for fix pushes).
8. **Hand over**: tell the user the PR is ready for them to merge. **Never merge it yourself**, never enable auto-merge and never call the merge API: only the user merges, and never during the deploy freeze (22:30-00:00 Europe/Madrid).
