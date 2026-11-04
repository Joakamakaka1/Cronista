/** The model that does the game's work. */
export const NARRATOR_MODEL = 'claude-haiku-5-5';

/** The tokens of one response, as the ledger counts them. */
export interface TokenCounts {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

// Dollars per million tokens. The prompt's length picks the rate card, and every part of it counts.
const shortPrompt = { input: 0.1, output: 0.5 };
const longPrompt = { input: 0.5, output: 2.5 };
const longPromptAboveTokens = 100_000;
const cacheReadMultiplier = 0.1;
const cacheWriteMultiplier = 1.25;

/** What one response of {@link NARRATOR_MODEL} costs, in dollars. */
export function costInDollars(tokens: TokenCounts): number {
  const promptTokens = tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
  const rates = promptTokens > longPromptAboveTokens ? longPrompt : shortPrompt;
  return (
    (tokens.inputTokens * rates.input +
      tokens.cacheReadTokens * rates.input * cacheReadMultiplier +
      tokens.cacheWriteTokens * rates.input * cacheWriteMultiplier +
      tokens.outputTokens * rates.output) /
    1_000_000
  );
}
