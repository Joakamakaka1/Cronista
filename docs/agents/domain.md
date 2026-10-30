# Domain docs

How the engineering skills consume this repo's domain documentation when exploring the codebase. Cronista is a single context: one domain, even though it is a monorepo.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: the ADRs that touch the area you are about to work in.

If either does not exist yet, **proceed silently**. Don't flag its absence or suggest creating it upfront: the `domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them when a term or a decision is actually resolved. [`architecture.md`](../architecture.md) describes the system; the glossary holds only the language.

## File structure

```
/
├── GLOSSARY.md
└── docs/adr/
    ├── 0001-<decision>.md
    └── 0002-<decision>.md
```

## Language

Terms are in English, like the code and the docs. When players see a different Spanish word in the app or the chapters, add it after the definition as `_Players see_: <word>`, so the code, the UI copy and the narrator prompts stay aligned.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test name), use the term as `GLOSSARY.md` defines it. Don't drift to synonyms the glossary lists under _Avoid_.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, say so explicitly rather than silently overriding it:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
