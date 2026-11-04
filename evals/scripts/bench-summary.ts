import { z } from 'zod';

/** promptfoo's results file, reduced to what the comparison reads. */
const promptfooResultsSchema = z.object({
  results: z.object({
    results: z.array(
      z.object({
        vars: z.object({ scenario: z.string() }),
        success: z.boolean(),
        error: z.string().nullish(),
        cost: z.number().nullish(),
        latencyMs: z.number().nullish(),
        response: z
          .object({
            output: z.unknown(),
            tokenUsage: z
              .object({ prompt: z.number().nullish(), completion: z.number().nullish() })
              .nullish(),
          })
          .nullish(),
      }),
    ),
  }),
});

/** One case of a bench run, as the baseline keeps it. */
export const benchCaseSchema = z.object({
  pass: z.boolean(),
  error: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  sample: z.string(),
});

/** The saved summary of a bench run: invented data only, small enough for a readable diff. */
export const benchSummarySchema = z.object({
  cases: z.record(z.string(), benchCaseSchema),
});

/** A bench run's summary. */
export type BenchSummary = z.infer<typeof benchSummarySchema>;

const sampleCharacters = 400;

/** Reduces promptfoo's results to one summary row per case. */
export function summarizeBench(results: unknown): BenchSummary {
  const parsed = promptfooResultsSchema.parse(results);
  const entries = parsed.results.results.map((result) => {
    const output = result.response?.output;
    return [
      result.vars.scenario,
      {
        pass: result.success,
        error: result.error ?? null,
        inputTokens: result.response?.tokenUsage?.prompt ?? 0,
        outputTokens: result.response?.tokenUsage?.completion ?? 0,
        costUsd: result.cost ?? 0,
        sample: typeof output === 'string' ? output.slice(0, sampleCharacters) : '',
      },
    ] as const;
  });
  return { cases: Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))) };
}

/**
 * Compares a run with the baseline case by case, the way `narrator.md` asks.
 *
 * @returns One line per case, then the totals, and whether any case passed before and fails now.
 */
export function compareBench(
  baseline: BenchSummary | undefined,
  current: BenchSummary,
): { readonly lines: readonly string[]; readonly regressed: boolean } {
  const lines: string[] = [];
  let regressed = false;
  let costBefore = 0;
  let costNow = 0;

  for (const [name, now] of Object.entries(current.cases)) {
    const before = baseline?.cases[name];
    if (before?.pass === true && !now.pass) regressed = true;
    costBefore += before?.costUsd ?? 0;
    costNow += now.costUsd;
    const nowVerdict = now.pass ? 'pass' : 'FAIL';
    const verdict =
      before === undefined
        ? `new ${nowVerdict}`
        : `${before.pass ? 'pass' : 'FAIL'} -> ${nowVerdict}`;
    const tokens =
      before === undefined
        ? `input ${String(now.inputTokens)}, output ${String(now.outputTokens)}`
        : `input ${String(before.inputTokens)} -> ${String(now.inputTokens)}, output ${String(before.outputTokens)} -> ${String(now.outputTokens)}`;
    const error = now.error === null ? '' : ` ${now.error}`;
    lines.push(`${name}: ${verdict} (${tokens})${error}`);
  }
  lines.push(`total cost: ${costBefore.toFixed(4)} $ -> ${costNow.toFixed(4)} $`);
  return { lines, regressed };
}
