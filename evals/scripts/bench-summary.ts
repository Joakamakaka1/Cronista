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
            metadata: z.object({ toolCalls: z.number().nullish() }).nullish(),
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
  /** The memory tools a chapter ran; `null` for a call without them. */
  toolCalls: z.number().nullable().default(null),
  sample: z.string(),
});

/** The saved summary of a bench run: invented data only, small enough for a readable diff. */
export const benchSummarySchema = z.object({
  cases: z.record(z.string(), benchCaseSchema),
});

/** A bench run's summary. */
export type BenchSummary = z.infer<typeof benchSummarySchema>;

/** A summary as compared: a baseline saved before a field existed still reads. */
export type ComparedSummary = z.input<typeof benchSummarySchema>;

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
        toolCalls: result.response?.metadata?.toolCalls ?? null,
        sample: typeof output === 'string' ? output.slice(0, sampleCharacters) : '',
      },
    ] as const;
  });
  return { cases: Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))) };
}

/** The cost a simulated day may reach, from `narrator.md`. */
const maxDayCostUsd = 0.05;

// One day of play: its situation, a hint for each of the five players, the close and its memory.
const dayCases = [
  ['situation-continues', 1],
  ['hint-normal', 5],
  ['resolve-normal', 1],
  ['narrate-normal', 1],
  ['extract-moments', 1],
  ['compare-moments', 1],
] as const;

/**
 * Compares a run with the baseline case by case, the way `narrator.md` asks.
 *
 * @returns One line per case, then the totals, and whether any case passed before and fails now.
 */
export function compareBench(
  baseline: ComparedSummary | undefined,
  current: ComparedSummary,
): { readonly lines: readonly string[]; readonly regressed: boolean } {
  const lines: string[] = [];
  let regressed = false;
  let costBefore = 0;
  let costNow = 0;

  for (const [name, before] of Object.entries(baseline?.cases ?? {})) {
    if (current.cases[name] === undefined) {
      regressed = true;
      costBefore += before.costUsd;
      lines.push(`${name}: in the baseline, but this run did not have it`);
    }
  }

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
    const tools =
      now.toolCalls === null || now.toolCalls === undefined
        ? ''
        : `, tools ${String(now.toolCalls)}`;
    lines.push(`${name}: ${verdict} (${tokens}${tools})${error}`);
  }
  lines.push(`total cost: ${costBefore.toFixed(4)} $ -> ${costNow.toFixed(4)} $`);

  if (dayCases.every(([name]) => current.cases[name] !== undefined)) {
    const dayCost = dayCases.reduce(
      (total, [name, times]) => total + times * (current.cases[name]?.costUsd ?? 0),
      0,
    );
    const above = dayCost > maxDayCostUsd;
    if (above) regressed = true;
    lines.push(
      `simulated day: ${dayCost.toFixed(4)} $ (limit ${String(maxDayCostUsd)} $), tool calls ${String(current.cases['narrate-normal']?.toolCalls ?? 0)}${above ? ' ABOVE THE LIMIT' : ''}`,
    );
  }
  return { lines, regressed };
}
