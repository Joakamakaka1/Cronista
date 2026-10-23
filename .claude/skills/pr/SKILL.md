---
name: pr
description: Opens the pull request for the current branch with a title in the commit convention and a detailed, plain description, then follows CI. Use only when the user asks to open the PR.
disable-model-invocation: true
---

# Open the PR

1. **Ready?** `/pre-pr` must have run on the current state of the branch. If it has not, run it first.
2. **Branch**: it must be `<type>/CR-<n>`. If not, rename it with `git branch -m` before pushing.
3. **Title**: `<emoji> <type>(<scope>): <description>`, at most 66 characters (the squash commit adds ` (#NN)`).
4. **Description**: fill in the sections below. Be detailed but plain: short sentences, no filler, nothing that the diff already says line by line.

   ```markdown
   ## Summary

   What changes, in two or three sentences.

   ## Why

   The problem or goal, and why this approach.

   ## Changes

   - Grouped by area, with the files or packages that matter.

   ## Verification

   - Each command or manual check and its result (`pnpm check`, evals, gitleaks, Snyk, app checks).

   ## Review

   - Reviewers and `/code-review` run, what they found and how it was resolved.

   ## Risks and rollback

   What could break in production and how to undo it (revert, contract migration, etc.).

   ## Merge order and follow-ups

   Dependencies on other PRs, and whether another change should go with or after this one.

   Closes CR-<n>
   ```

5. **Confirm**: show the user the title and description, and ask before pushing and creating the PR.
6. **Publish**: `git push -u origin <branch>`, then `gh pr create --base master --title "…" --body-file <file>` (write the body to a scratchpad file to keep the formatting).
7. **CI**: follow the checks until `code` and `secrets` are green. If one fails, read its log, fix the cause and push again. Never merge during the deploy freeze (22:30-00:00 Europe/Madrid), and merge only when the user says so.
