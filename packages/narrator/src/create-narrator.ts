import { createAnthropic } from '@ai-sdk/anthropic';
import {
  actionTestOutputSchema,
  type AiUsage,
  type ChapterOutput,
  anthropicErrorReplySchema,
  chapterOutputSchema,
  comparisonOutputSchema,
  countTokensReplySchema,
  hintOutputSchema,
  momentsOutputSchema,
  type NarrateInput,
  type Narrator,
  type NarratorFailure,
  type NarratorFunction,
  type NarratorResult,
  type NarratorTool,
  refusalMetadataSchema,
  resolutionOutputSchema,
  situationOutputSchema,
  type Workspace,
} from '@cronista/core';
import {
  APICallError,
  generateText,
  isStepCount,
  jsonSchema,
  type JSONSchema7,
  type LanguageModel,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  Output,
  tool,
  type ToolSet,
} from 'ai';
import type { z } from 'zod';

import { toApiSchema } from './api-schema.ts';
import { costInDollars, NARRATOR_MODEL } from './prices.ts';
import {
  compareMomentsData,
  extractMomentsData,
  hintData,
  MEMORY_TRIM_LEVELS,
  narrateData,
  resolveData,
  situationData,
  testActionData,
} from './prompts/v4/data.ts';
import {
  COMPARE_MOMENTS_INSTRUCTIONS,
  EXTRACT_MOMENTS_INSTRUCTIONS,
  HINT_INSTRUCTIONS,
  NARRATE_INSTRUCTIONS,
  NARRATE_TOOLS_INSTRUCTIONS,
  RESOLVE_INSTRUCTIONS,
  shortChapterIssue,
  SITUATION_INSTRUCTIONS,
  TEST_ACTION_INSTRUCTIONS,
} from './prompts/v4/instructions.ts';
import { PROMPT_VERSION, stableSystem } from './prompts/v4/system.ts';
import { isWrittenRefusal } from './written-refusal.ts';

/** What {@link createNarrator} needs. */
export interface NarratorOptions {
  readonly apiKey: string;
  readonly workspace: Workspace;
  /** Replaces the global `fetch` in tests. */
  readonly fetch?: typeof fetch;
  /** Replaces the provider's model in tests. */
  readonly model?: LanguageModel;
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
  hint: { effort: 'low', maxOutputTokens: 1500, timeoutMs: 10_000, maxRetries: 0 },
  resolve: { effort: 'medium', maxOutputTokens: 8000, timeoutMs: 120_000, maxRetries: 2 },
  narrate: { effort: 'medium', maxOutputTokens: 12_000, timeoutMs: 180_000, maxRetries: 2 },
  test_action: { effort: 'low', maxOutputTokens: 1500, timeoutMs: 60_000, maxRetries: 2 },
  extract_moments: { effort: 'low', maxOutputTokens: 8000, timeoutMs: 120_000, maxRetries: 2 },
  compare_moments: { effort: 'low', maxOutputTokens: 4000, timeoutMs: 120_000, maxRetries: 2 },
};

const anthropicApiUrl = 'https://api.anthropic.com/v1';

// The same version as the provider check: the one this project's requests were written against.
const anthropicVersion = '2026-10-21';

// Above 100k the whole request costs five times more; this leaves room below that line.
const maxInputTokens = 85_000;

const countTokensTimeoutMs = 3000;

// The tool runs one chapter may make, its second try included. The prompt asks for 3 and a metric
// warns above that, so 5 is only the brake.
const maxToolCalls = 5;
const askedToolCalls = 3;

const toolLimitReached =
  'Has llegado al límite de consultas de memoria. Escribe ya el capítulo con lo que tienes.';

// Spanish runs about 3.5 characters a token, so 3 overestimates what a tool result adds.
const charactersPerToken = 3;

/** The memory tools of one chapter, and how many runs its tries have spent between them. */
interface ToolLoop {
  readonly tools: readonly NarratorTool[];
  readonly budget: { used: number };
}

// The bottom of the range `narrator.md` sets. The model's length varies widely from one run to the next.
const minChapterWords = 700;

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean).length;

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
  const model =
    options.model ?? createAnthropic({ apiKey: options.apiKey, fetch: send })(NARRATOR_MODEL);

  /**
   * @param candidates - The request's data, fullest first. A call with memory offers it with less and
   * less of the fixed bundle, and the first that fits the context budget is sent.
   * @param loop - The memory tools it may call, which make it a loop: the history only grows, and it
   * stops offering them at the run limit or once the next request would pass the context budget.
   */
  const call = async <Value>(
    name: NarratorFunction,
    stable: string,
    instructions: string,
    candidates: readonly string[],
    schema: z.ZodType<Value>,
    readTexts: (output: Value) => readonly string[],
    loop?: ToolLoop,
  ): Promise<NarratorResult<Value>> => {
    const { effort, maxOutputTokens, timeoutMs, maxRetries } = settings[name];
    const limit = options.timeoutMs ?? timeoutMs;
    const failed = (error: NarratorFailure, usage: readonly AiUsage[] = []) =>
      ({ ok: false, error, usage }) as const;

    let data: string | undefined;
    let counted: Awaited<ReturnType<typeof countInputTokens>>;
    for (const [trim, candidate] of [...new Set(candidates)].entries()) {
      counted = await countInputTokens(send, options.apiKey, {
        stable,
        instructions,
        data: candidate,
        tools: loop?.tools ?? [],
      });
      if (counted === 'spend_limit') return failed({ kind: 'spend_limit' });
      if (counted === undefined) break;
      if (counted <= maxInputTokens) {
        data = candidate;
        // Numbers only: the bundle is derived from what players wrote.
        if (trim > 0) console.warn({ message: 'memory trimmed', function: name, trim });
        break;
      }
    }
    if (data === undefined) {
      console.warn({ message: 'context not sent', function: name, inputTokens: counted ?? null });
      return failed({ kind: 'technical' });
    }

    const startedAt = Date.now();
    const ledgerRow = (
      usage: LanguageModelUsage | undefined,
      latencyMs: number,
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
        latencyMs,
        refusalCategory,
      };
    };

    // One row per response, because a request above 100k tokens is priced at another rate. The last
    // one carries the refusal, if any; without a finished step, the call's own usage stands in.
    const finishedSteps: { readonly usage: LanguageModelUsage; readonly latencyMs: number }[] = [];
    let stepStartedAt = startedAt;
    const ledgerRows = (
      fallback: LanguageModelUsage | undefined,
      refusalCategory: string | null,
    ): AiUsage[] => {
      const steps =
        finishedSteps.length > 0
          ? finishedSteps
          : [{ usage: fallback, latencyMs: Date.now() - startedAt }];
      return steps.map(({ usage, latencyMs }, index) =>
        ledgerRow(usage, latencyMs, index === steps.length - 1 ? refusalCategory : null),
      );
    };

    // Read from the step, because a refusal with partial text makes the call itself throw.
    let stepMetadata: unknown;
    const refused = (usage: LanguageModelUsage | undefined) => {
      const metadata = refusalMetadataSchema.safeParse(stepMetadata);
      const category = metadata.success
        ? (metadata.data.anthropic.stopDetails.category ?? null)
        : null;
      return failed({ kind: 'refused', category }, ledgerRows(usage, category ?? 'unknown'));
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
            // In a loop, each step reads the one before it from the cache.
            ...(loop === undefined ? {} : { cacheControl: { type: 'ephemeral' } }),
          },
        },
        telemetry: { functionId: name },
        onStepEnd: ({ providerMetadata, usage }) => {
          stepMetadata = providerMetadata;
          const now = Date.now();
          finishedSteps.push({ usage, latencyMs: now - stepStartedAt });
          stepStartedAt = now;
        },
        ...(loop === undefined ? {} : toolLoopSettings(loop)),
      });

      if (result.finishReason === 'content-filter') return refused(result.usage);

      // Only a finished answer has an output: reading it after `max_tokens`, which thinking alone can
      // use up, throws and would lose this billed response from the ledger.
      if (result.finishReason !== 'stop') {
        const issues = [`the answer stopped early: ${result.finishReason}`];
        return failed({ kind: 'invalid', issues }, ledgerRows(result.usage, null));
      }

      const parsed = schema.safeParse(result.output);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`);
        return failed({ kind: 'invalid', issues }, ledgerRows(result.usage, null));
      }

      if (readTexts(parsed.data).some(isWrittenRefusal)) {
        return failed(
          { kind: 'refused', category: 'written' },
          ledgerRows(result.usage, 'written'),
        );
      }

      return { ok: true, value: parsed.data, usage: ledgerRows(result.usage, null) };
    } catch (error) {
      // The model answered, so this response is in the ledger: bad JSON, or text cut off or refused.
      if (NoObjectGeneratedError.isInstance(error)) {
        if (error.finishReason === 'content-filter') return refused(error.usage);
        return failed(
          { kind: 'invalid', issues: ['the answer is not valid JSON'] },
          ledgerRows(error.usage, null),
        );
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

  // Fullest first: the fixed bundle is what goes when a request is over the context budget.
  const withTrimmedMemory = (data: (trim: number) => string) =>
    Array.from({ length: MEMORY_TRIM_LEVELS }, (_, trim) => data(trim));

  const writeChapter = (input: NarrateInput, budget: ToolLoop['budget']) => {
    const tools = input.tools ?? [];
    return call(
      'narrate',
      stableSystem(input.bible),
      tools.length === 0
        ? NARRATE_INSTRUCTIONS
        : `${NARRATE_INSTRUCTIONS}

${NARRATE_TOOLS_INSTRUCTIONS}`,
      withTrimmedMemory((trim) => narrateData(input, trim)),
      chapterOutputSchema,
      ({ body }) => [body],
      tools.length === 0 ? undefined : { tools, budget },
    );
  };

  return {
    situation: (input) =>
      call(
        'situation',
        stableSystem(input.bible),
        SITUATION_INSTRUCTIONS,
        [situationData(input)],
        situationOutputSchema,
        ({ text }) => [text],
      ),
    hint: (input) =>
      call(
        'hint',
        // A hint goes back to one player, who must not be able to draw out the others' sheets and
        // red lines. Hints come hours apart, so they lose no cache by this.
        stableSystem(
          input.bible,
          input.bible.characters.filter(({ nickname }) => nickname === input.action.nickname),
        ),
        HINT_INSTRUCTIONS,
        [hintData(input)],
        hintOutputSchema,
        ({ text }) => [text],
      ),
    resolve: (input) =>
      call(
        'resolve',
        stableSystem(input.bible),
        RESOLVE_INSTRUCTIONS,
        withTrimmedMemory((trim) => resolveData(input, trim)),
        resolutionOutputSchema,
        ({ outcomes }) => outcomes.map(({ summary }) => summary),
      ),
    // A short chapter gets one more try, and it never fails the day: it is still a chapter. A retry
    // from the game engine is already a second try, so it does not ask for a third.
    // Both tries share the chapter's tool runs.
    narrate: async (input) => {
      const budget = { used: 0 };
      const counted = (result: NarratorResult<ChapterOutput>): NarratorResult<ChapterOutput> => {
        // Numbers only: what the tools were asked comes from what players wrote.
        if (budget.used > askedToolCalls) {
          console.warn({
            message: 'tool calls above budget',
            function: 'narrate',
            calls: budget.used,
          });
        }
        return { ...result, toolCalls: budget.used };
      };

      const first = await writeChapter(input, budget);
      if (!first.ok || input.retry !== undefined) return counted(first);
      const length = wordsIn(first.value.body);
      if (length >= minChapterWords) return counted(first);

      const second = await writeChapter(
        { ...input, retry: { kind: 'fix', issues: [shortChapterIssue(length)] } },
        budget,
      );
      const usage = [...first.usage, ...second.usage];
      const longer = second.ok && wordsIn(second.value.body) > length;
      return counted({ ...(longer ? second : first), usage });
    },
    testAction: (input) =>
      call(
        'test_action',
        stableSystem(input.bible),
        TEST_ACTION_INSTRUCTIONS,
        [testActionData(input)],
        actionTestOutputSchema,
        ({ text }) => [text],
      ),
    extractMoments: (input) =>
      call(
        'extract_moments',
        stableSystem(input.bible),
        EXTRACT_MOMENTS_INSTRUCTIONS,
        [extractMomentsData(input)],
        momentsOutputSchema,
        ({ summary, moments }) => [summary, ...moments.map(({ text }) => text)],
      ),
    compareMoments: (input) =>
      call(
        'compare_moments',
        stableSystem(input.bible),
        COMPARE_MOMENTS_INSTRUCTIONS,
        [compareMomentsData(input)],
        comparisonOutputSchema,
        // Decisions and ids only: nothing written that a refusal could hide in.
        () => [],
      ),
  };
}

/** The input tokens of a request, the workspace's spend limit, or `undefined` for any other failure. */
async function countInputTokens(
  send: typeof fetch,
  apiKey: string,
  request: {
    readonly stable: string;
    readonly instructions: string;
    readonly data: string;
    readonly tools: readonly NarratorTool[];
  },
): Promise<number | 'spend_limit' | undefined> {
  const { stable, instructions, data, tools } = request;
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
        ...(tools.length === 0 ? {} : { tools: tools.map(toolDefinition) }),
      }),
      signal: AbortSignal.timeout(countTokensTimeoutMs),
    });
    if (reply.status === 400) {
      const error = anthropicErrorReplySchema.safeParse(await reply.json());
      return error.success && spendLimitMessage.test(error.data.error.message)
        ? 'spend_limit'
        : undefined;
    }
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

/** A tool as the Messages API declares it, which is also how `count_tokens` counts it. */
const toolDefinition = ({ name, description, inputSchema }: NarratorTool) => ({
  name,
  description,
  input_schema: inputSchema,
});

/**
 * The settings that make a call a tool loop. The SDK keeps the history append-only and passes the
 * thinking blocks back untouched; this only decides, before each step, whether tools are still offered.
 * They stay declared either way, so the cached start of the request does not change.
 */
function toolLoopSettings({ tools, budget }: ToolLoop) {
  const toolSet: ToolSet = Object.fromEntries(
    tools.map((narratorTool) => [
      narratorTool.name,
      tool({
        description: narratorTool.description,
        // Generated from the tool's Zod schema in `@cronista/memory-tools`.
        inputSchema: jsonSchema(narratorTool.inputSchema as JSONSchema7),
        execute: (input: unknown) => {
          // Counted before running, so a batch of parallel calls cannot pass the limit.
          if (budget.used >= maxToolCalls) return Promise.resolve(toolLimitReached);
          budget.used += 1;
          return narratorTool.run(input);
        },
      }),
    ]),
  );
  return {
    tools: toolSet,
    // A brake under the run limit: every step but the last runs at least one tool.
    stopWhen: isStepCount(maxToolCalls + 1),
    prepareStep: ({ steps }: { readonly steps: readonly StepSummary[] }) => {
      const last = steps.at(-1);
      const results =
        last === undefined
          ? 0
          : last.toolResults.reduce(
              (total, { output }) => total + JSON.stringify(output).length,
              0,
            );
      const nextInput =
        last === undefined
          ? 0
          : (last.usage.inputTokens ?? 0) +
            (last.usage.outputTokens ?? 0) +
            Math.ceil(results / charactersPerToken);
      // Above the budget the history is never trimmed: no more tools, and the chapter is written.
      return budget.used >= maxToolCalls || nextInput > maxInputTokens
        ? { toolChoice: 'none' as const }
        : {};
    },
  };
}

/** What `prepareStep` reads of a finished step. */
interface StepSummary {
  readonly usage: LanguageModelUsage;
  readonly toolResults: readonly { readonly output: unknown }[];
}
