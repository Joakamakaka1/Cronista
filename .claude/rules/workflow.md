# Workflow

## Language

- English: code, identifiers, comments, commits, PRs, `AGENTS.md`, `.claude/` and `docs/`.
- Spanish: the root `README.md`, text the players see (UI, notifications) and the narrator prompts.

## Planning

- Use plan mode for anything that touches several files or an unfamiliar area. Skip it for changes you can describe in one sentence.
- Never assume: when a requirement, name or behaviour is unclear, ask the user before writing code. Read the code and the docs first so the questions are precise.
- Before adding, removing or upgrading a dependency, ask the user. Versions are exact (no `^`), and pnpm ignores releases younger than one day (`minimumReleaseAge`).

## Linear and branches

- Every change starts from a Linear issue in the `CR` team. The issue ID names the branch: `<type>/CR-<n>`, e.g. `feature/CR-12`, `fix/CR-13`.
- Branch types: `feature`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Branch from an up-to-date `master`. When other sessions share the folder, work in a git worktree instead of switching branches.
- `master` only changes through a squash-merged PR (ruleset without bypass). The hooks block commits and pushes to it.

## Commits

- Conventional Commits led by the gitmoji of the type, in English, at most 72 characters:
  `✨ feat(narrator): add hybrid memory retrieval`.
- Types and emoji: ✨ feat, 🐛 fix, 📝 docs, 🎨 style, ♻️ refactor, ⚡️ perf, ✅ test, 📦️ build, 👷 ci, 🔧 chore, ⏪️ revert. The scope is the package or area (`core`, `narrator`, `db`, `api`, `infra`, `web`, `claude`…).
- Imperative description in lower case, without a final period. `.githooks/commit-msg` enforces the format.
- Small commits that each leave the repo working.

## Pull requests

- The PR title becomes the squash commit, so it follows the commit format and stays within 66 characters (GitHub appends ` (#NN)`).
- Open PRs with `/pr`: it writes a detailed but plain description (changes, reasons, verification, review, risks, merge order and follow-ups) and links the Linear issue with `Closes CR-<n>`.
- Ask the user before pushing, opening or merging a PR. Never merge during the deploy freeze (22:30-00:00 Europe/Madrid).

## Versioning

- The app has one SemVer version, in the root `package.json`.
- Bump it in the same PR when the change reaches production (`apps/`, `services/`, `packages/`, `infra/`, migrations): minor for `feat`, patch for `fix`, `perf` and deployable `refactor`.
- Do not bump it for docs, comments, tests, CI, `.claude/` or tooling changes that nothing redeploys.
