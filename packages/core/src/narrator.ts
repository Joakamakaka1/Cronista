import type { Bible } from './schemas/bible.ts';
import type {
  ActionTestOutput,
  ChapterOutput,
  HintOutput,
  ResolutionOutput,
  SituationOutput,
} from './schemas/narrator-output.ts';

/** The narrator calls recorded in the spend ledger. */
export type NarratorFunction = 'situation' | 'hint' | 'resolve' | 'narrate' | 'test_action';

/** The Claude Console workspace whose key made a call. */
export type Workspace = 'game-prod' | 'evals' | 'dev';

/** One model response in the spend ledger: ids and numbers only, never player text. */
export interface AiUsage {
  readonly workspace: Workspace;
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

/** What a second try at a call does differently: one notch softer, or fixing what was wrong. */
export type NarratorRetry =
  { readonly kind: 'softer' } | { readonly kind: 'fix'; readonly issues: readonly string[] };

/** A character in canon. */
export interface CanonCharacter {
  readonly nickname: string;
  readonly balance: number;
  /** Whether the character spends today out: its action, if any, is narrated from there. */
  readonly out: boolean;
}

/** An item in canon. */
export interface CanonItem {
  readonly name: string;
  readonly owner: string;
}

/** An open debt in canon. */
export interface CanonDebt {
  readonly id: number;
  readonly debtor: string;
  readonly creditor: string;
  readonly points: number;
}

/** The validated state the narrator cannot contradict. Debts come oldest first. */
export interface Canon {
  readonly characters: readonly CanonCharacter[];
  readonly items: readonly CanonItem[];
  readonly debts: readonly CanonDebt[];
}

/** A published chapter given to the narrator for continuity. */
export interface PastChapter {
  readonly day: string;
  readonly title: string;
  readonly body: string;
}

/** A player's real action as the narrator sees it. */
export interface NarratedAction {
  readonly nickname: string;
  readonly text: string;
}

/** A player's real action with its stake: the most the narrator may charge for it. */
export interface StakedAction extends NarratedAction {
  readonly stake: number;
}

/** What the narrator gets to write a day's situation. */
export interface SituationInput {
  readonly bible: Bible;
  readonly day: string;
  readonly canon: Canon;
  readonly lastChapters: readonly PastChapter[];
  readonly retry?: NarratorRetry;
}

/**
 * What the narrator gets to write a hint: the situation, canon and that action only. It has no field
 * for other actions or past chapters, so a hint cannot leak them.
 */
export interface HintInput {
  readonly bible: Bible;
  readonly situation: string;
  readonly canon: Canon;
  readonly action: NarratedAction;
}

/** What the narrator gets to test one action alone, after a chapter was refused twice. */
export interface TestActionInput {
  readonly bible: Bible;
  readonly situation: string;
  readonly action: NarratedAction;
}

/** What the narrator gets to resolve a day. */
export interface ResolveInput {
  readonly bible: Bible;
  readonly day: string;
  readonly situation: string;
  readonly canon: Canon;
  readonly lastChapters: readonly PastChapter[];
  readonly actions: readonly StakedAction[];
  /** Characters on autopilot: nothing to resolve, but other actions can affect them. */
  readonly absent: readonly string[];
  /** Characters whose action was struck out. Their text is gone, and only the name remains. */
  readonly struckOut: readonly string[];
  readonly retry?: NarratorRetry;
}

/** The count of a season's last chapter, which `narrate` can name. */
export interface Finale {
  /** More than one on a tie, which is a shared win. */
  readonly winners: readonly string[];
  readonly balances: readonly { readonly nickname: string; readonly balance: number }[];
}

/** What the narrator gets to write a chapter: the day and only what passed validation. */
export interface NarrateInput extends ResolveInput {
  readonly resolution: ResolutionOutput;
  /** Only on a season's last chapter. */
  readonly finale?: Finale;
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
  /** A short call that shows whether this action alone is refused. Its text is thrown away. */
  readonly testAction: (input: TestActionInput) => Promise<NarratorResult<ActionTestOutput>>;
}
