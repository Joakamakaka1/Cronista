---
name: pr
description: Opens the pull request for the current branch with a title in the commit convention and a detailed, plain description, then follows CI. Use when a branch has passed /pre-pr and is ready for review, or when the user asks to open the PR. Never merges.
---

# Open the PR

1. **Ready?** `/pre-pr` must have run on the current state of the branch and passed: `pnpm check` green and every finding fixed or justified to the user. If not, run it (or finish it) first.
2. **Branch**: it must be `<type>/CR-<n>`. If not, rename it with `git branch -m` before pushing.
3. **Title**: `<emoji> <type>(<scope>): <description>`, at most 66 characters (the squash commit appends `(#NN)` after a space).
4. **Description**: fill in every section of `.github/pull_request_template.md`, replacing the comments, and tick the checklist honestly. Be detailed but plain: short sentences, no filler, nothing that the diff already says line by line. The summary's visual and the merge-danger call (door and blast radius) follow the guidance of the plugin skill `mattpocock-skills:pr`; this template replaces that skill's sections.
5. **Confirm**: show the user the title and description, and ask before pushing and creating the PR.
6. **Publish**: scan the branch commits once more, because pushing makes them public (rebases and cherry-picks skip the pre-commit hook): `gitleaks git --log-opts="origin/master..HEAD" --redact --no-banner --config .gitleaks.toml`. Then `git push -u origin <branch>`, then `gh pr create --base master --title "…" --body-file <file>` (write the body to a scratchpad file to keep the formatting).
7. **CI**: follow the required checks (`code`, `secrets`, `snyk`, `snyk-code` and `pr-title`) until they are green. If one fails, read its log, fix the cause and ask the user before pushing again, unless they turned on Auto-fix for this PR (standing approval for fix pushes).
8. **Review comments**: as `workflow.md` says, give the user a recommendation for each CodeRabbit comment (apply or not, and why) and wait for their confirmation before changing anything. Then apply only what they confirmed, reply in each thread with the decision and the reason, and resolve it. Each fix push follows the same rule as step 7.
9. **Hand over**: tell the user the PR is ready for them to merge, with the decision taken on each review comment. **Never merge it yourself**, never enable auto-merge and never call the merge API: only the user merges, and never during the deploy freeze (21:30-23:00 Europe/Madrid).
