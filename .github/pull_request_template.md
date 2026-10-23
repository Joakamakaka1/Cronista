<!-- Title: "<emoji> <type>(<scope>): <description>", max 66 characters (the squash commit adds " (#NN)"). -->

## Summary

<!-- What changes, in two or three sentences. -->

## Why

<!-- The problem or goal, and why this approach. -->

## Changes

<!-- Grouped by area, with the files or packages that matter. -->

## Verification

<!-- Each command or manual check and its result: pnpm check, evals, gitleaks, Snyk, app checks. -->

## Review

<!-- Reviewers and /code-review run, what they found and how it was resolved. -->

## Risks and rollback

<!-- What could break in production and how to undo it. -->

## Merge order and follow-ups

<!-- Dependencies on other PRs, and whether another change should go with or after this one. -->

## Checklist

- [ ] No secrets or real player data (fixtures use invented characters and `@example.com`).
- [ ] Migrations work with the code in production (expand/contract); destructive changes go in a `contract` PR.
- [ ] Narrator or prompt changes: evals run and compared.
- [ ] Deployable change: version bumped in the root `package.json`.

Closes CR-<n>
