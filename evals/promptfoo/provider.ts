import { createNarrator } from '@cronista/narrator';

import { scenarios } from '../datasets/bench.ts';
import { loadInventedBible, localKeys, startLocalTracing } from '../scripts/local-narrator.ts';

const narrator = createNarrator({ apiKey: localKeys().ANTHROPIC_API_KEY, workspace: 'evals' });
const flush = startLocalTracing('evals');

/**
 * The promptfoo provider: it runs the bench's cases through the same `Narrator` as production, so
 * promptfoo's own prompt is only the name of the case.
 */
export default class NarratorProvider {
  id(): string {
    return 'cronista-narrator';
  }

  async callApi(prompt: string) {
    const scenario = scenarios[prompt];
    if (scenario === undefined) return { error: `Unknown case: ${prompt}` };

    const bible = await loadInventedBible(0);
    if (!bible.ok) return { error: bible.error };

    const result = await scenario.run(narrator, bible.value);
    await flush();

    // Every response of the call, because a short chapter gets a second one. Input is the largest
    // single prompt, which is what the 85k check is about.
    const metering =
      result.usage.length === 0
        ? {}
        : {
            cost: result.usage.reduce((total, row) => total + row.costUsd, 0),
            tokenUsage: {
              prompt: Math.max(
                ...result.usage.map(
                  (row) => row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens,
                ),
              ),
              completion: result.usage.reduce((total, row) => total + row.outputTokens, 0),
              cached: result.usage.reduce((total, row) => total + row.cacheReadTokens, 0),
            },
          };
    return result.ok
      ? { output: JSON.stringify(result.value), ...metering }
      : { error: `The narrator failed: ${JSON.stringify(result.error)}`, ...metering };
  }
}
