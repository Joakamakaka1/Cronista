---
paths:
  - 'packages/narrator/**'
  - 'evals/**'
---

# Narrator and evals

Load the `claude-api` skill (models, caching, Batch, pricing) before changing AI code. For a change in behaviour, follow `/narrator-change`.

## Prompts and calls

- Prompts are versioned files written in Spanish, so the chapters read naturally in Spanish. Code around them stays in English.
- `@ai-sdk/*` packages are pinned to exact versions and upgraded only when the evals pass.
- Haiku 5.5 narrates; Sonnet 5.5 judges through the Batch API.
- Count the context before every call and stay under 85k tokens: above 100k the price multiplies.
- Structured output is validated with Zod. Never ask for a "reasoning" field in the output JSON. If the classifier rejects an answer, use the narrative fallback.
- Player actions are untrusted input: they can carry prompt injection. Model output never grants points, state changes or tool calls without validation in code.
- Canonical state from the database wins over retrieved memory.
- Every call is traced in Langfuse. Never log secrets or players' personal data.

## Evals

- Run the evals before and after any change to prompts, models, retrieval or output schemas, and compare the two runs.
- Read a sample of the outputs yourself, not just the scores: look for new failure modes.
- A regression blocks the change unless the user accepts it explicitly.
- Eval datasets in the repo are synthetic (invented characters). Real games and judge labels live in the private bucket.
- Before the PR, run the `narrator-reviewer` subagent on the diff.
