import type { Bible } from './schemas/bible.ts';
import type {
  ChapterOutput,
  HintOutput,
  ResolutionOutput,
  SituationOutput,
} from './schemas/narrator-output.ts';

/** The narrator calls recorded in the spend ledger. */
export type NarratorFunction = 'situation' | 'hint' | 'resolve' | 'narrate';

/** One model response in the spend ledger: ids and numbers only, never player text. */
export interface AiUsage {
  readonly workspace: string;
  readonly function: NarratorFunction;
  readonly promptVersion: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  /** The refusal's category; `written` for a refusal written as text, `null` for no refusal. */
  readonly refusalCategory: string | null;
}

/** Why the narrator returned no output. */
export type NarratorFailure =
  | { readonly kind: 'refused'; readonly category: string | null }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] }
  | { readonly kind: 'spend_limit' }
  | { readonly kind: 'technical' };

/** A narrator call's output or failure, with every model response it took. */
export type NarratorResult<Output> = (
  | { readonly ok: true; readonly value: Output }
  | { readonly ok: false; readonly error: NarratorFailure }
) & { readonly usage: readonly AiUsage[] };

/** A character as the narrator sees canon. */
export interface CanonCharacter {
  readonly nickname: string;
  readonly balance: number;
}

/** A published chapter given to the narrator for continuity. */
export interface PastChapter {
  readonly day: string;
  readonly title: string;
  readonly body: string;
}

/**
 * A player's real action as the narrator sees it. It carries no stake: nothing charges one, and the
 * model would narrate charges that never happen.
 */
export interface NarratedAction {
  readonly nickname: string;
  readonly text: string;
}

/** What the narrator gets to write a day's situation. */
export interface SituationInput {
  readonly bible: Bible;
  readonly day: string;
  readonly canon: readonly CanonCharacter[];
  readonly lastChapters: readonly PastChapter[];
}

/**
 * What the narrator gets to write a hint: the situation, canon and that action only. It has no field
 * for other actions or past chapters, so a hint cannot leak them.
 */
export interface HintInput {
  readonly bible: Bible;
  readonly situation: string;
  readonly canon: readonly CanonCharacter[];
  readonly action: NarratedAction;
}

/** What the narrator gets to resolve a day. */
export interface ResolveInput {
  readonly bible: Bible;
  readonly day: string;
  readonly situation: string;
  readonly canon: readonly CanonCharacter[];
  readonly lastChapters: readonly PastChapter[];
  readonly actions: readonly NarratedAction[];
  /** Characters on autopilot: nothing to resolve, but other actions can affect them. */
  readonly absent: readonly string[];
}

/** What the narrator gets to write a chapter: the day and only what passed validation. */
export interface NarrateInput extends ResolveInput {
  readonly resolution: ResolutionOutput;
}

/**
 * The AI that runs the game. This interface hides the AI SDK, so the game engine depends on neither
 * it nor the provider. Output is untrusted until code validates it.
 */
export interface Narrator {
  readonly situation: (input: SituationInput) => Promise<NarratorResult<SituationOutput>>;
  readonly hint: (input: HintInput) => Promise<NarratorResult<HintOutput>>;
  readonly resolve: (input: ResolveInput) => Promise<NarratorResult<ResolutionOutput>>;
  readonly narrate: (input: NarrateInput) => Promise<NarratorResult<ChapterOutput>>;
}
