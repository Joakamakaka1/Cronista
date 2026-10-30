---
paths:
  - '**/*.ts'
---

# Code style

## Principles

- KISS and YAGNI: the simplest solution that works, built for today's need.
- DRY for knowledge, not for look-alike code: a little duplication beats the wrong abstraction.
- Fail fast: validate every external input with Zod at the boundary (HTTP, LLM output, database JSON, hook input) and work with typed data inside.
- Least surprise and least privilege: functions do what their name says; components get only the permissions they need.
- Leave the code you touch a little better than you found it.

## Structure

- Functions and immutable data (`readonly`, `as const`). Classes only when a library requires them.
- Errors are values in the domain and the narrator: return a discriminated union (`{ ok: true, value } | { ok: false, error }`). Throw only at the edges (Lambda handlers, scripts), where errors are turned into responses or logs.
- Everything in its layer: handlers stay thin (validate, call the domain, map the result); types and schemas live in `packages/core`; SQL lives in `packages/db`. A controller never declares domain types.
- One concept per file. No generic `utils` files, and no barrel files except each package's `index.ts`.
- Inline what is used once: a trivial helper or variable used in a single place goes inside its caller. Extract only when it is reused, needs its own test, or names a concept the reader needs.
- Explicit names without abbreviations. A good name beats a comment.

## Comments

- Every exported function, type and constant gets a TSDoc comment: a 1-2 line summary, plus tags only when they add something (`@param`, `@returns`, `@throws`, `@remarks`, `@example`). `tsdoc/syntax` lints them.
- Inline comments use `//`, one line, and explain why, not what. Plain words, but precise.
- Separate sections of a long file with a three-line divider:

  ```ts
  // -----------------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------------
  ```

- Comments describe the code as it is now: no TODOs, plans, history or "changed from". When the code changes, update its comments in the same change.
- Too many comments is over-engineering: comment only what gives context or explains a non-obvious decision.

## TypeScript

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`; ESM only; `import type` for types.
- No `any`, no non-null assertions (`!`) and no `as` casts on external data: parse it with Zod.
- Node 24 runs TypeScript natively: only erasable syntax (no `enum`, `namespace` or parameter properties), and relative imports end in `.ts`.
