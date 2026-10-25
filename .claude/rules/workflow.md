# Workflow

## Language

- Talk to the user in Spanish (chat, questions, summaries), whatever language the files are in.
- English: code, identifiers, comments, commits, PRs, `AGENTS.md`, `.claude/` and `docs/`.
- Spanish: the root `README.md`, text the players see (UI, notifications) and the narrator prompts.

## Planning

- Use plan mode for anything that touches several files or an unfamiliar area. Skip it for changes you can describe in one sentence.
- Never assume: when a requirement, name or behaviour is unclear, ask the user before writing code. Read the code and the docs first so the questions are precise.
- Before adding, removing or upgrading a dependency, ask the user. Versions are exact (no `^`), and pnpm ignores releases younger than one day (`minimumReleaseAge`).

## Linear and branches

- Every change starts from a Linear issue in the `CR` team. The issue ID names the branch: `<type>/CR-<n>`, e.g. `feature/CR-12`, `fix/CR-13`.
- One PR per topic: related issues (same area, same files) share a branch and a PR, named after the first issue, and the PR closes all of them. Unrelated changes go in separate PRs, so each squash commit on `master` is one topic and can be reverted alone.
- Branch types: `feature`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- One folder, one coding session at a time: work in the main folder, with no worktree per issue. Branch from an up-to-date `master` with `git fetch origin master && git switch -c <branch> origin/master`, and switch back to `master` when the work is pushed. Before starting, check that no other session is editing the folder (current branch and `git status`); if one is, wait for it to finish. Read-only work (searches, reviews) can run alongside, but not while the coding session switches branches.
- `master` only changes through a squash-merged PR (ruleset without bypass). The hooks block commits on it; the ruleset rejects pushes.

## Commits

- Conventional Commits led by the gitmoji of the type, in English, at most 72 characters:
  `✨ feat(narrator): add hybrid memory retrieval`.
- Types and emoji: ✨ feat, 🐛 fix, 📝 docs, 🎨 style, ♻️ refactor, ⚡️ perf, ✅ test, 📦️ build, 👷 ci, 🔧 chore, ⏪️ revert. The scope is the package or area (`core`, `narrator`, `db`, `api`, `infra`, `web`, `claude`…).
- Imperative description in lower case, without a final period. `.githooks/commit-msg` enforces the format.
- Small commits that each leave the repo working.

## Pull requests

- The PR title becomes the squash commit, so it follows the commit format and stays within 66 characters (GitHub appends `(#NN)` after a space).
- Open PRs with `/pr`: it fills in `.github/pull_request_template.md` (changes, reasons, verification, review, risks, merge order and follow-ups) and links the Linear issue with `Closes CR-<n>`.
- Claude opens PRs with `/pr`, after showing the title and description and asking the user before pushing and creating it.
- CodeRabbit is advisory and never blocks a merge; Claude and the user decide. For each comment, Claude checks it against the code and the rules and gives the user a recommendation (apply or not, and why, with professional judgement: CodeRabbit is often right but not always, and not every suggestion is worth the change). Claude changes nothing CodeRabbit asks for until the user confirms that comment; then it applies what was confirmed, replies in each thread with the decision and the reason, and resolves it. Auto-fix covers CI failures and merge conflicts, not CodeRabbit comments. Requests to harden the guardrails against deliberately obfuscated commands get a "do not apply" recommendation: hooks and permission rules are tripwires against mistakes, not a security boundary.
- **Only the user merges.** Claude never merges a PR, enables auto-merge or calls the merge API; `.claude/settings.json` denies those commands. The user never merges during the deploy freeze (22:30-00:00 Europe/Madrid).

## Versioning

- The app has one SemVer version, in the root `package.json`. It stays at `0.x` until season 1 starts, which releases `1.0.0`.
- Claude bumps it in every PR that reaches production (`apps/`, `services/`, `packages/`, `infra/`, migrations): minor for `feat`, patch for `fix`, `perf` and deployable `refactor`.
- Do not bump it for docs, comments, tests, CI, `.claude/` or tooling changes that nothing redeploys.
- Nobody tags or releases by hand: the GitHub release for each new version comes from `deploy.yml` on merge (CR-17). Until that workflow exists, versions are bumped but not released.
