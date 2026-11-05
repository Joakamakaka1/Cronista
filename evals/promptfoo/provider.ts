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

    const [usage] = result.usage;
    const metering =
      usage === undefined
        ? {}
        : {
            cost: usage.costUsd,
            tokenUsage: {
              prompt: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
              completion: usage.outputTokens,
              total:
                usage.inputTokens +
                usage.cacheReadTokens +
                usage.cacheWriteTokens +
                usage.outputTokens,
              cached: usage.cacheReadTokens,
            },
          };
    return result.ok
      ? { output: JSON.stringify(result.value), ...metering }
      : { error: `The narrator failed: ${JSON.stringify(result.error)}`, ...metering };
  }
}
