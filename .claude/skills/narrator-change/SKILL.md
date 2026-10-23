---
name: narrator-change
description: Flow for changing the AI narrator's behaviour (prompts, models, retrieval, tools, output schema) with an eval run before and after. Use when a change affects what the narrator writes or how it decides.
argument-hint: '<what should change in the narrator>'
---

# Narrator change

Load the `claude-api` and `ai-sdk` skills first. The rules are in `.claude/rules/narrator.md`.

1. **Baseline**: before touching anything, run the evals on `master`'s behaviour and save the summary (scores and a few sample outputs) in the scratchpad.
2. **Failure first**: add eval cases that show the problem or the new behaviour, and confirm they fail on the baseline.
3. **Change** the prompt (in Spanish, in its file), the code or the schema. Keep the context under 85k tokens and the output validated with Zod.
4. **Evals after**: run the same suite and compare with the baseline, case by case. Read a sample of outputs yourself, looking for new failure modes, not just score deltas.
5. **Cost**: compare tokens per chapter and cache hits with the baseline. Report any increase.
6. **Decide**: if anything regressed, fix it or bring the trade-off to the user. Never ship a regression silently.
7. **Review**: run the `narrator-reviewer` subagent on the diff.
8. The PR includes the before/after eval summary and the cost comparison.
