import { createAnthropic } from '@ai-sdk/anthropic';
import {
  type AiUsage,
  type Bible,
  chapterOutputSchema,
  countTokensReplySchema,
  hintOutputSchema,
  type Narrator,
  type NarratorFailure,
  type NarratorFunction,
  type NarratorResult,
  refusalMetadataSchema,
  resolutionOutputSchema,
  situationOutputSchema,
} from '@cronista/core';
import {
  APICallError,
  generateText,
  jsonSchema,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  Output,
} from 'ai';
import type { z } from 'zod';

import { toApiSchema } from './api-schema.ts';
import { costInDollars, NARRATOR_MODEL } from './prices.ts';
import { hintData, narrateData, resolveData, situationData } from './prompts/v1/data.ts';
import {
  HINT_INSTRUCTIONS,
  NARRATE_INSTRUCTIONS,
  RESOLVE_INSTRUCTIONS,
  SITUATION_INSTRUCTIONS,
} from './prompts/v1/instructions.ts';
import { PROMPT_VERSION, stableSystem } from './prompts/v1/system.ts';
import { isWrittenRefusal } from './written-refusal.ts';

/** The Claude Console workspace whose key a narrator uses, named in the ledger. */
export type Workspace = 'game-prod' | 'evals' | 'dev';

/** What {@link createNarrator} needs. */
export interface NarratorOptions {
  readonly apiKey: string;
  readonly workspace: Workspace;
  /** Replaces the global `fetch` in tests. */
  readonly fetch?: typeof fetch;
  /** Replaces every call's own time limit in tests. */
  readonly timeoutMs?: number;
}

/** How one kind of call runs. */
interface CallSettings {
  readonly effort: 'low' | 'medium';
  /** Leaves thinking room: it counts in this limit and bills as output. */
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

// The hint answers a waiting player inside the 20 s of ai-api, so it gets no time for second tries;
// a technical failure spends no quota and the player can ask again. The others run in the worker's
// 15 minutes, where the SDK's retries can ride out a short outage.
const settings: Readonly<Record<NarratorFunction, CallSettings>> = {
  situation: { effort: 'medium', maxOutputTokens: 4000, timeoutMs: 60_000, maxRetries: 2 },
  hint: { effort: 'low', maxOutputTokens: 1500, timeoutMs: 12_000, maxRetries: 0 },
  resolve: { effort: 'medium', maxOutputTokens: 8000, timeoutMs: 120_000, maxRetries: 2 },
  narrate: { effort: 'medium', maxOutputTokens: 12_000, timeoutMs: 180_000, maxRetries: 2 },
};

const anthropicApiUrl = 'https://api.anthropic.com/v1';

// The same version as the provider check: the one this project's requests were written against.
const anthropicVersion = '2026-10-21';

// Above 100k the whole request costs five times more; this leaves room below that line.
const maxInputTokens = 85_000;

const countTokensTimeoutMs = 5000;

// A workspace's limit answers 400 like a malformed request does, so only its message tells them apart.
const spendLimitMessage = /usage limits?|spend(ing)? limit|reached .{0,40}limit|credit balance/i;

/**
 * Creates the real narrator: Haiku 5.5 through the AI SDK. Every request carries the season's world
 * first, cached, then its instructions, and only then what happened, as delimited data.
 *
 * @remarks
 * Output is validated here for its shape; the rules of the game are the engine's to validate.
 */
export function createNarrator(options: NarratorOptions): Narrator {
  const send = options.fetch ?? fetch;
  const model = createAnthropic({ apiKey: options.apiKey, fetch: send })(NARRATOR_MODEL);

  const call = async <Value>(
    name: NarratorFunction,
    bible: Bible,
    instructions: string,
    data: string,
    schema: z.ZodType<Value>,
    readText: (output: Value) => string,
  ): Promise<NarratorResult<Value>> => {
    const stable = stableSystem(bible);
    const { effort, maxOutputTokens, timeoutMs, maxRetries } = settings[name];
    const limit = options.timeoutMs ?? timeoutMs;
    const failed = (error: NarratorFailure, usage: readonly AiUsage[] = []) =>
      ({ ok: false, error, usage }) as const;

    const counted = await countInputTokens(send, options.apiKey, stable, instructions, data);
    if (counted === undefined || counted > maxInputTokens) {
      console.warn({ message: 'context not sent', function: name, inputTokens: counted ?? null });
      return failed({ kind: 'technical' });
    }

    const startedAt = Date.now();
    const ledgerRow = (
      usage: LanguageModelUsage | undefined,
      refusalCategory: string | null,
    ): AiUsage => {
      const tokens = {
        inputTokens: usage?.inputTokenDetails.noCacheTokens ?? 0,
        cacheReadTokens: usage?.inputTokenDetails.cacheReadTokens ?? 0,
        cacheWriteTokens: usage?.inputTokenDetails.cacheWriteTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      };
      return {
        workspace: options.workspace,
        function: name,
        promptVersion: PROMPT_VERSION,
        model: NARRATOR_MODEL,
        ...tokens,
        costUsd: costInDollars(tokens),
        latencyMs: Date.now() - startedAt,
        refusalCategory,
      };
    };

    try {
      const result = await generateText({
        model,
        instructions: [
          {
            role: 'system',
            content: stable,
            providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
          },
          { role: 'system', content: instructions },
        ],
        prompt: data,
        output: Output.object({ schema: jsonSchema(toApiSchema(schema)) }),
        maxOutputTokens,
        maxRetries,
        abortSignal: AbortSignal.timeout(limit),
        providerOptions: {
          anthropic: {
            thinking: { type: 'adaptive' },
            effort,
            structuredOutputMode: 'outputFormat',
          },
        },
        telemetry: { functionId: name },
      });

      if (result.finishReason === 'content-filter') {
        const category = refusalMetadataSchema.safeParse(result.finalStep.providerMetadata);
        const stopCategory = category.success
          ? (category.data.anthropic.stopDetails.category ?? null)
          : null;
        return failed({ kind: 'refused', category: stopCategory }, [
          ledgerRow(result.usage, stopCategory ?? 'unknown'),
        ]);
      }

      const parsed = schema.safeParse(result.output);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`);
        return failed({ kind: 'invalid', issues }, [ledgerRow(result.usage, null)]);
      }

      if (isWrittenRefusal(readText(parsed.data))) {
        return failed({ kind: 'refused', category: 'written' }, [
          ledgerRow(result.usage, 'written'),
        ]);
      }

      return { ok: true, value: parsed.data, usage: [ledgerRow(result.usage, null)] };
    } catch (error) {
      // The model answered, so this response is in the ledger: bad JSON or an answer cut off.
      if (NoObjectGeneratedError.isInstance(error)) {
        return failed({ kind: 'invalid', issues: ['the answer is not valid JSON'] }, [
          ledgerRow(error.usage, null),
        ]);
      }
      if (
        APICallError.isInstance(error) &&
        error.statusCode === 400 &&
        spendLimitMessage.test(error.message)
      ) {
        return failed({ kind: 'spend_limit' });
      }
      // The class and status only: an API error can quote the request, which holds player text.
      console.warn({
        message: 'narrator call failed',
        function: name,
        error: error instanceof Error ? error.name : 'unknown',
        status: APICallError.isInstance(error) ? (error.statusCode ?? null) : null,
      });
      return failed({ kind: 'technical' });
    }
  };

  return {
    situation: (input) =>
      call(
        'situation',
        input.bible,
        SITUATION_INSTRUCTIONS,
        situationData(input),
        situationOutputSchema,
        ({ text }) => text,
      ),
    hint: (input) =>
      call(
        'hint',
        input.bible,
        HINT_INSTRUCTIONS,
        hintData(input),
        hintOutputSchema,
        ({ text }) => text,
      ),
    resolve: (input) =>
      call(
        'resolve',
        input.bible,
        RESOLVE_INSTRUCTIONS,
        resolveData(input),
        resolutionOutputSchema,
        ({ outcomes }) => outcomes[0]?.summary ?? '',
      ),
    narrate: (input) =>
      call(
        'narrate',
        input.bible,
        NARRATE_INSTRUCTIONS,
        narrateData(input),
        chapterOutputSchema,
        ({ body }) => body,
      ),
  };
}

/** The input tokens of a request, or `undefined` when they could not be counted. */
async function countInputTokens(
  send: typeof fetch,
  apiKey: string,
  stable: string,
  instructions: string,
  data: string,
): Promise<number | undefined> {
  try {
    const reply = await send(`${anthropicApiUrl}/messages/count_tokens`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': anthropicVersion,
      },
      body: JSON.stringify({
        model: NARRATOR_MODEL,
        system: [
          { type: 'text', text: stable },
          { type: 'text', text: instructions },
        ],
        messages: [{ role: 'user', content: data }],
      }),
      signal: AbortSignal.timeout(countTokensTimeoutMs),
    });
    if (!reply.ok) {
      await reply.body?.cancel();
      return undefined;
    }
    const body = countTokensReplySchema.safeParse(await reply.json());
    return body.success ? body.data.input_tokens : undefined;
  } catch {
    return undefined;
  }
}
