---
paths:
  - 'packages/narrator/**'
  - 'packages/memory-tools/**'
  - 'evals/**'
---

# Narrator, memory and evals

Load the `claude-api` skill (models, caching, Batch, pricing) before changing AI code. For a change in behaviour, follow `/narrator-change`. When the AI SDK's docs and Anthropic's disagree, Anthropic's win (the smallest cacheable prompt is 512 tokens on Haiku 5.5 and Sonnet 5.5).

## Prompts and calls

- Prompts are versioned files written in Spanish, so the chapters read naturally in Spanish. Code around them stays in English.
- `ai` and `@ai-sdk/*` packages are pinned to exact versions and upgraded only when the evals pass. A `Narrator` interface hides them, so the official SDK can replace them without touching its callers.
- Haiku 5.5 does the game's work; Sonnet 5.5 only judges, through the Batch API.
- Every call sets its effort: `medium` to resolve, `low` to extract and `medium` to judge. The evals decide any change.
- Thinking stays adaptive and on. It counts in `max_tokens` and bills as output, so size `max_tokens` to leave it room, and read the response's blocks by `type`. In a tool loop, pass thinking blocks back untouched and only append to the history: editing earlier turns invalidates them.
- The request carries only what these models accept: no sampling parameters (400), no assistant prefill (400, so the last turn is the user's), no `budget_tokens` (400) and `tool_choice: auto` (Sonnet rejects forced tools, and Haiku skips thinking with them).
- Haiku sets `structuredOutputMode: 'outputFormat'`, with a test that proves it, because the provider's `auto` mode only covers Sonnet, Opus and Fable. Structured output has no numeric ranges or lengths, so Zod checks them afterwards (points from -3 to +5).
- The output JSON and tool arguments never ask for a "reasoning" field: it triggers `reasoning_extraction` refusals. The judge reasons with thinking and returns only its verdict.
- Player actions are untrusted input: they can carry prompt injection. Model output never grants points, state changes or tool calls without validation in code.
- Every call is traced in Langfuse, and a Lambda calls `forceFlush()` before it returns. Never log secrets or players' personal data.

## Refusals and limits

- Detect both kinds of refusal: `finishReason: "content-filter"` (`stop_reason: "refusal"`, with its category) and a refusal written as normal text, which ends in `end_turn`. Record each one with its category: the rate is a gated metric.
- A refusal gets one retry with Haiku, asking for the same chapter one notch softer. Haiku 5.5 has no server-side fallback. If it refuses again, the chapter is published with the paragraph "tachado por el censor del periódico" and the action that caused it gets a comic penalty.
- A workspace spend limit answers 400 `invalid_request_error`. Treat it as an incident: postpone the chapter, tell the players with a message from the newspaper, and raise an alert.

## Spend ledger

- `ai_usage` records each response: time, workspace, function, model, tokens (input, cache read, cache write, output) and dollars, from `usage` and a price table. It holds ids and numbers, never player text. It sits in `public` with grants only to `service_role`, because the Lambdas reach the database through the Data API.
- It adds up per credit cycle, which starts on the credits' renewal date, not on day 1. It alerts on the account alerts topic at 50 % and 80 % of each category's budget.
- The ledger is the main brake; workspace limits are the safety net. N2, N3 and the rehearsal season estimate their cost first and stop if it exceeds what `evals` has left in the cycle. The narrator checks only its own reserve.

## Context budget

- Count with `count_tokens` (free) before every call and stay under 85k tokens, trimming the fixed memory bundle above that. Above 100k the whole request costs 5 times more, and the threshold includes cache reads and writes.
- Measure with the real model: the Haiku 5.5 tokenizer yields about 30 % more tokens than Haiku 4.5's. A resolving call is about 35k.
- Stable and cached first, with the 5-minute cache: tools, system prompt, world bible and tone examples. Then, uncached: canonical state, the fixed memory bundle (character sheets, active jokes, the previous chapter's summary), hybrid top-k over today's actions, the last 2 full chapters, today's actions and tool results.

## Memory

- Canonical state from the database wins over retrieved memory.
- Atomic moments in `memories`, plus `chapter_chunks` as a fallback index over full chapters. Embeddings are `halfvec(1024)`: `voyage-4` for documents and `voyage-4-lite` for queries.
- Search is `hybrid_search`: HNSW with pgvector's iterative scan (or exact search) when filtering, full-text search with an `es` configuration (`spanish` plus `unaccent`) on both the column and the query, and a third list from `pg_trgm` over names, nicknames and joke aliases. Reciprocal Rank Fusion with k = 50.
- Final score: RRF + α · importance + β · recency (exponential decay) − γ · recent use of the same joke. The golden set tunes α, β and γ.
- Writing: after publishing, Haiku extracts 5-20 self-contained moments, only from final chapters, so summaries cannot reinject hallucinations. Each moment is compared with its 5 nearest, and Haiku answers `ADD`, `UPDATE` or `NOOP`.
- A fact that changes stays and gets `superseded_by`. Closing a season merges duplicates and recalculates importance.
- Reranking stays behind a flag, off until the golden set shows a precision problem that fusion does not solve.

## Tools and MCP

- Each tool is defined once (name, description, Zod schema, handler) in `packages/memory-tools`. The narrator wraps it with the AI SDK's `tool()`, and the local MCP server registers the same definition.
- Names carry the `memory_` prefix, and parameters are unambiguous (`character_id`). Tools offer readable fields, a brief response format, pagination with sensible defaults and errors that say what to do.
- Tool order and definitions stay stable: a change invalidates the whole prompt cache.
- The prompt asks for at most 3 tool calls per chapter, the code stops at 5, and a metric warns above 3.
- The MCP server uses stdio and is declared in `.mcp.json`. It targets local Supabase by default and production through a read-only Postgres role. Keep responses under 10k tokens, where Claude Code starts warning (it cuts at 25k).

## Evals

- Run the evals before and after any change to prompts, models, retrieval or output schemas, and compare the two runs item by item.
- Read a sample of the outputs yourself, not just the scores: look for new failure modes.
- A regression blocks the change unless the user accepts it explicitly.
- Eval datasets in the repo are synthetic (invented characters). Real games and judge labels live in the private bucket.
- promptfoo runs the suites through a custom TypeScript provider that calls the same `Narrator` as production. Vitest covers retrieval and everything deterministic, and the judges use the AI SDK and Zod.
- The evals run locally until the `evals` and `judge-gate` checks exist (`docs/delivery.md`).
- Before the PR, run the `narrator-reviewer` subagent on the diff.

### Levels

| Level   | What runs                                                                                                                               | When                                                                                                                                       | Cost    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| N1      | Retrieval golden set in Vitest, with cached embeddings                                                                                  | Every PR                                                                                                                                   | 0 $     |
| N2      | Haiku: 30 resolve-and-narrate cases × 3, 20 other cases                                                                                 | PRs touching the narrator, prompts, memory or AI dependencies                                                                              | ~1 $    |
| N3      | Sonnet judge through Batch, effort `medium`                                                                                             | Required when a PR touches narrator prompts or output schemas (`skip-judge` skips it with the user's OK); otherwise `run-judge` or by hand | ~3 $    |
| N4      | Frozen benchmark without cache, reduced                                                                                                 | Weekly; opens an issue                                                                                                                     | ~0.80 $ |
| Nightly | Sonnet judge on the day's chapter, as an `ai-worker` job: it submits the Batch after the close and collects the results on its next run | Every night; opens an issue                                                                                                                | ~0.03 $ |

### Thresholds

Starting values, recalibrated from the rehearsal season. Binary invariants must pass all 3 repetitions (pass^3). The judge blocks only when it runs.

| Metric                                    | Layer     | Threshold                      |
| ----------------------------------------- | --------- | ------------------------------ |
| recall@10                                 | Retrieval | ≥ 0.85, drop ≤ 5 points        |
| MRR                                       | Retrieval | ≥ 0.60, drop ≤ 5 points        |
| Schema validity, points in range          | Narrator  | 100 %                          |
| All actions resolved                      | Narrator  | 100 %                          |
| Consistency with canonical state          | Narrator  | ≥ 98 %                         |
| Refusals, including those written as text | Narrator  | 0 in normal cases              |
| Chapter length                            | Narrator  | 95 % within 700-1,100 words    |
| Input tokens per call                     | Narrator  | 100 % under 85k                |
| Cost per simulated day                    | Narrator  | ≤ 0.05 $                       |
| Tool calls per chapter                    | Narrator  | ≤ 5                            |
| Memory fidelity                           | Judge     | ≥ 90 %                         |
| No contradiction with the canon           | Judge     | ≥ 95 %                         |
| Each action recognisably addressed        | Judge     | ≥ 95 %                         |
| Red lines                                 | Judge     | 100 %                          |
| Humour and style against `master`, paired | Judge     | Whole 95 % interval under 50 % |

nDCG@10, the p95 latency of `memory_search` (under 300 ms) and the use of retrieved moments are reported without blocking.
