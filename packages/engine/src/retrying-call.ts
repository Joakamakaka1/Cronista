import type { NarratorResult, NarratorRetry } from '@cronista/core';

/** How a narrator call ended after its retries. */
export type RetriedCall<Output> =
  | { readonly kind: 'answered'; readonly value: Output }
  | { readonly kind: 'refused' | 'invalid' | 'spend_limit' | 'technical' };

/** What {@link retryingCall} needs. */
export interface RetryingCallOptions<Output> {
  readonly call: (retry: NarratorRetry | undefined) => Promise<NarratorResult<Output>>;
  /** Writes each response in the ledger, whatever came of it. */
  readonly record: (result: NarratorResult<Output>) => Promise<void>;
  /** What is wrong with an answer by the game's rules, which one retry asks to fix. */
  readonly problems?: (output: Output) => readonly string[];
  /** Whether an answer with problems can still stand if the retry for them brings nothing. */
  readonly canStand?: (output: Output) => boolean;
  /** Whether a refusal gets its one softer retry. */
  readonly softerOnRefusal: boolean;
}

/**
 * Runs a narrator call with ADR-30's retries: one with the list of errors for an invalid answer, and
 * one softer for a refusal. A limit or an outage gets none here: a retry would not change the first,
 * and Lambda retries the job on the second.
 *
 * @remarks
 * An answer that still has problems comes back as answered, because what happens next depends on the
 * problem: the caller decides whether it drops a change or postpones the chapter. So when the retry
 * for those problems brings nothing, an answer that can stand comes back too.
 */
export async function retryingCall<Output>({
  call,
  record,
  problems = () => [],
  canStand = () => false,
  softerOnRefusal,
}: RetryingCallOptions<Output>): Promise<RetriedCall<Output>> {
  let retry: NarratorRetry | undefined;
  let fixed = false;
  let softened = !softerOnRefusal;
  let standing: Output | undefined;

  for (;;) {
    const result = await call(retry);
    await record(result);

    if (result.ok) {
      const issues = problems(result.value);
      if (issues.length === 0) return { kind: 'answered', value: result.value };
      if (fixed) {
        // A retry that came out worse than the answer it was fixing does not replace it.
        const value = standing !== undefined && !canStand(result.value) ? standing : result.value;
        return { kind: 'answered', value };
      }
      fixed = true;
      if (canStand(result.value)) standing = result.value;
      retry = { kind: 'fix', issues };
    } else if (standing !== undefined && result.error.kind !== 'spend_limit') {
      return { kind: 'answered', value: standing };
    } else if (result.error.kind === 'refused') {
      if (softened) return { kind: 'refused' };
      softened = true;
      retry = { kind: 'softer' };
    } else if (result.error.kind === 'invalid') {
      if (fixed) return { kind: 'invalid' };
      fixed = true;
      retry = { kind: 'fix', issues: result.error.issues };
    } else {
      return { kind: result.error.kind };
    }
  }
}
