import {
  type Bible,
  censorParagraph,
  type ChapterOutput,
  finalStandings,
  hasDayClosed,
  type Narrator,
  type NarratorFailure,
  POSTPONED_CHAPTER_MESSAGE,
  type ResolutionValidation,
  type ResolveInput,
  type Result,
  type StakedAction,
  validateResolution,
} from '@cronista/core';

import { activeSeason } from './active-season.ts';
import { chapterPostponedAlert, type RaiseAlert } from './alerts.ts';
import type { LoadBible } from './load-bible.ts';
import { type MemoryDependencies, recallForDay, writePendingMemory } from './memory.ts';
import { retryingCall } from './retrying-call.ts';
import type { GameStore, Publication, StoreFailure, StoredCanon, StoredGameDay } from './store.ts';

/** How many published chapters the narrator reads for continuity. */
export const CHAPTERS_FOR_CONTINUITY = 2;

// Scheduler's clock is not this one, and nothing retries a close refused as too early, so a skew at
// 22:00 must not lose the day. Actions stop at 22:00 either way.
const closeToleranceMs = 60_000;

/** How a step can fail, a refusal apart: that one takes its own path through the close. */
type StepFailure = Exclude<NarratorFailure['kind'], 'refused'>;

/** Why a chapter was postponed. Nothing moved, and it goes to the logs, the job's report and the alert. */
export type PostponedReason =
  | 'bible_unavailable'
  | `resolve_${StepFailure}`
  | 'resolution_invalid'
  | `narrate_${StepFailure}`
  | 'resolution_mismatch'
  /** A chapter was refused twice and no action alone was. */
  | 'refused_no_culprit'
  /** The chapter was still refused without the struck-out actions. */
  | 'refused_after_strike'
  | 'test_action_spend_limit'
  | 'test_action_technical';

/** Whether a chapter was postponed by an outage, which a run again can fix with nobody's help. */
export const isOutage = (reason: PostponedReason): boolean =>
  reason === 'bible_unavailable' || reason.endsWith('_technical');

/** What running the close achieved. */
export type CloseDayOutcome =
  | { readonly status: 'no_active_season' | 'published' | 'already_published' }
  | { readonly status: 'postponed'; readonly reason: PostponedReason };

/** Why a close did not run. */
export type CloseDayFailure =
  | StoreFailure
  /** No situation opened this day, so there is nothing to resolve. */
  | 'no_open_day'
  /** Closing before 22:00 could not be undone, and it would take the day from the players. */
  | 'too_early';

/** What running the close achieved, or why it did not run. */
export type CloseDayResult = Result<CloseDayOutcome, CloseDayFailure>;

/** What {@link closeDay} needs. */
export interface CloseDayDependencies {
  readonly store: GameStore;
  readonly narrator: Pick<
    Narrator,
    'resolve' | 'narrate' | 'testAction' | 'extractMoments' | 'compareMoments'
  >;
  readonly memory: MemoryDependencies;
  readonly loadBible: LoadBible;
  readonly clock: () => Date;
  readonly alert: RaiseAlert;
}

/** A real action, with what publishing it needs. */
type DayAction = StakedAction & { readonly actionId: number; readonly characterId: number };

/** What the close knows about the day, before anyone is struck out. */
interface DayToWrite {
  readonly day: string;
  readonly isFinale: boolean;
  readonly canon: StoredCanon;
  readonly input: Omit<ResolveInput, 'actions' | 'struckOut'>;
  readonly actions: readonly DayAction[];
  readonly struckOut: readonly DayAction[];
}

/** How writing the day ended. */
type WrittenDay =
  | {
      readonly kind: 'written';
      readonly validation: ResolutionValidation;
      readonly chapter: ChapterOutput;
    }
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed'; readonly reason: PostponedReason };

/**
 * Closes game day `day`: autopilot, resolution, validation in code, chapter, and publishing as one
 * step. Running it twice publishes once. Each failure takes ADR-30's path, and a postponed chapter
 * moves nothing and leaves the newspaper's message. With no active season it does nothing and spends
 * nothing.
 */
export async function closeDay(
  dependencies: CloseDayDependencies,
  day: string,
): Promise<CloseDayResult> {
  const { store, loadBible, clock } = dependencies;
  const season = await activeSeason(store, day);
  if (!season.ok) return season;
  if (season.value === undefined) return { ok: true, value: { status: 'no_active_season' } };
  if (!hasDayClosed(new Date(clock().getTime() + closeToleranceMs), day)) {
    return { ok: false, error: 'too_early' };
  }

  const gameDay = await store.gameDay(season.value.id, day);
  if (!gameDay.ok) return gameDay;
  if (gameDay.value === undefined) return { ok: false, error: 'no_open_day' };

  const begun = await store.beginClose(gameDay.value.id);
  if (!begun.ok) return begun;
  if (begun.value === 'already_published') {
    // A close run again, by Lambda or by hand, still writes what memory an earlier run left pending.
    const bible = await loadBible(season.value.number);
    const characters = await store.characters(season.value.id);
    if (bible.ok && characters.ok) {
      await writePendingMemory(
        dependencies,
        {
          id: season.value.id,
          bible: bible.value,
          characters: characters.value.map(({ nickname }) => nickname),
        },
        day,
      );
    }
    return { ok: true, value: { status: 'already_published' } };
  }

  const today = gameDay.value;
  const postpone = (reason: PostponedReason) => postponed(dependencies, today, reason);

  const bible = await loadBible(season.value.number);
  if (!bible.ok) return postpone('bible_unavailable');

  const [canon, stored, lastChapters] = await Promise.all([
    store.canon(season.value.id, day),
    store.actions(gameDay.value.id),
    store.lastChapters(season.value.id, day, CHAPTERS_FOR_CONTINUITY),
  ]);
  if (!canon.ok) return canon;
  if (!stored.ok) return stored;
  if (!lastChapters.ok) return lastChapters;

  // In the characters' order, so that the prompt does not depend on who played first.
  const actionOf = new Map(stored.value.map((action) => [action.characterId, action]));
  const actions: DayAction[] = [];
  const absent: string[] = [];
  for (const { id, nickname } of canon.value.characters) {
    const action = actionOf.get(id);
    if (action?.origin === 'player' && action.text !== null) {
      actions.push({
        actionId: action.id,
        characterId: id,
        nickname,
        text: action.text,
        stake: action.stake,
      });
    } else if (action?.origin === 'autopilot') {
      absent.push(nickname);
    }
  }

  // Moments an earlier close left pending go first, so that today recalls them.
  const nicknames = canon.value.characters.map(({ nickname }) => nickname);
  const seasonMemory = { id: season.value.id, bible: bible.value, characters: nicknames };
  // One at most: what is left waits for after publishing, so memory never takes the day's time.
  await writePendingMemory(dependencies, seasonMemory, day, 1);
  const seasonId = season.value.id;
  const recallWith = (real: readonly DayAction[]) =>
    recallForDay(dependencies, {
      seasonId,
      day,
      characters: nicknames,
      lastChapters: lastChapters.value,
      fullChapters: CHAPTERS_FOR_CONTINUITY,
      queries: [today.situation, ...real.map(({ text }) => text)],
    });

  const toWrite: DayToWrite = {
    day,
    isFinale: day === season.value.endsOn,
    canon: canon.value,
    input: {
      bible: bible.value,
      day,
      situation: gameDay.value.situation,
      canon: canon.value,
      lastChapters: lastChapters.value,
      memory: await recallWith(actions),
      absent,
    },
    actions,
    struckOut: [],
  };

  let written = await writeDay(dependencies, toWrite, true);
  let final = toWrite;
  if (written.kind === 'refused') {
    const culprits = await testEachAction(dependencies, toWrite, bible.value);
    if (!culprits.ok) return postpone(culprits.error);
    if (culprits.value.length === 0) return postpone('refused_no_culprit');

    const struckIds = new Set(culprits.value.map(({ actionId }) => actionId));
    console.warn({ message: 'actions struck out', day, count: struckIds.size });
    const remaining = actions.filter(({ actionId }) => !struckIds.has(actionId));
    final = {
      ...toWrite,
      // Recalled again without them: the chapter that stands, and every later day, never search with it.
      input: { ...toWrite.input, memory: await recallWith(remaining) },
      actions: remaining,
      struckOut: culprits.value,
    };
    written = await writeDay(dependencies, final, false);
    if (written.kind === 'refused') return postpone('refused_after_strike');
  }
  if (written.kind === 'failed') return postpone(written.reason);

  const { validation, chapter } = written;
  const censor = final.struckOut.map(({ nickname }) => nickname);
  const body = censor.length === 0 ? chapter.body : `${chapter.body}\n\n${censorParagraph(censor)}`;
  const published = await store.publishChapter(
    today.id,
    { title: chapter.title, body, pullQuote: quotedFrom(body, chapter.pullQuote) },
    publicationOf(final, validation),
  );
  if (published.ok) {
    // After publishing: a failure leaves the chapter standing, and the next close writes it.
    await writePendingMemory(dependencies, seasonMemory, day);
    return { ok: true, value: { status: published.value } };
  }
  if (published.error === 'resolution_mismatch') return postpone('resolution_mismatch');
  return { ok: false, error: published.error };
}

// -----------------------------------------------------------------------------
// Writing the day
// -----------------------------------------------------------------------------

/** Runs both steps: resolve, validate in code, and narrate from what passed. */
async function writeDay(
  { store, narrator }: CloseDayDependencies,
  toWrite: DayToWrite,
  softerOnRefusal: boolean,
): Promise<WrittenDay> {
  const { day, canon, actions, struckOut, isFinale, input } = toWrite;
  const narrated = {
    ...input,
    actions: actions.map(({ nickname, text, stake }) => ({ nickname, text, stake })),
    struckOut: struckOut.map(({ nickname }) => nickname),
  };
  const validate = (resolution: ResolutionValidation['kept']) =>
    validateResolution(resolution, { canon, actions: narrated.actions });

  // A day with no real action has nothing to decide, so that step spends nothing and cannot fail.
  let validation = validate({ outcomes: [] });
  if (actions.length > 0) {
    const resolved = await retryingCall({
      call: (retry) => narrator.resolve({ ...narrated, retry }),
      record: (result) => store.recordUsage(result.usage, day),
      problems: (resolution) => {
        const { issues, canonIssues } = validate(resolution);
        return [...issues, ...canonIssues.map(({ message }) => message)];
      },
      // Only canon changes wrong: they are dropped and the day goes on.
      canStand: (resolution) => validate(resolution).issues.length === 0,
      softerOnRefusal,
    });
    if (resolved.kind === 'refused') return { kind: 'refused' };
    if (resolved.kind !== 'answered') {
      return { kind: 'failed', reason: `resolve_${resolved.kind}` };
    }
    validation = validate(resolved.value);
    if (validation.issues.length > 0) return { kind: 'failed', reason: 'resolution_invalid' };
    if (validation.canonIssues.length > 0) {
      // The kinds only: the messages quote what the model wrote, which comes from player text.
      console.warn({
        message: 'canon changes dropped',
        day,
        changes: validation.canonIssues.map(({ change }) => change),
      });
    }
  }

  const finale = isFinale
    ? finalStandings(canon, validation.kept, {
        absent: input.absent,
        struckOut: narrated.struckOut,
      })
    : undefined;
  const narrating = {
    ...narrated,
    resolution: validation.kept,
    dropped: validation.canonIssues.map(({ message }) => message),
    ...(finale === undefined ? {} : { finale }),
  };
  const chapter = await retryingCall({
    call: (retry) => narrator.narrate({ ...narrating, retry }),
    record: (result) => store.recordUsage(result.usage, day),
    softerOnRefusal,
  });
  if (chapter.kind === 'refused') return { kind: 'refused' };
  if (chapter.kind !== 'answered') return { kind: 'failed', reason: `narrate_${chapter.kind}` };
  return { kind: 'written', validation, chapter: chapter.value };
}

/** Tests each real action alone, in a short call of its own, and answers the ones refused. */
async function testEachAction(
  { store, narrator }: CloseDayDependencies,
  { day, input, actions }: DayToWrite,
  bible: Bible,
): Promise<Result<readonly DayAction[], PostponedReason>> {
  const culprits: DayAction[] = [];
  for (const action of actions) {
    const { nickname, text } = action;
    const tested = await narrator.testAction({
      bible,
      situation: input.situation,
      action: { nickname, text },
    });
    await store.recordUsage(tested.usage, day);
    if (tested.ok || tested.error.kind === 'invalid') continue;
    if (tested.error.kind === 'refused') {
      culprits.push(action);
    } else {
      return { ok: false, error: `test_action_${tested.error.kind}` };
    }
  }
  return { ok: true, value: culprits };
}

// -----------------------------------------------------------------------------
// Publishing
// -----------------------------------------------------------------------------

/** What the database writes, from a validated resolution. Nicknames become ids here. */
function publicationOf(
  { canon, actions, struckOut }: DayToWrite,
  { kept, paidDebts }: ResolutionValidation,
): Publication {
  const characterIds = new Map(canon.characters.map(({ id, nickname }) => [nickname, id]));
  const idOf = (nickname: string) => characterIds.get(nickname) ?? 0;
  const actionIds = new Map(actions.map(({ nickname, actionId }) => [nickname, actionId]));

  const publication: Publication = {
    awards: [],
    struckOut: struckOut.map(({ actionId }) => actionId),
    charges: [],
    newItems: [],
    movedItems: [],
    newDebts: [],
    // A debt is paid by its debtor, so its action is the debtor's.
    paidDebts: paidDebts.map(({ id, debtor }) => ({
      actionId: actionIds.get(debtor) ?? 0,
      debtId: id,
    })),
    outCharacters: [],
  };

  for (const outcome of kept.outcomes) {
    const actionId = actionIds.get(outcome.nickname) ?? 0;
    publication.awards.push({ actionId, points: outcome.award });
    if (outcome.influence > 0) {
      publication.charges.push({
        actionId,
        points: outcome.influence,
        purpose: 'influence',
        recipientId: null,
      });
    }
    for (const { to, points } of outcome.payments) {
      publication.charges.push({ actionId, points, purpose: 'payment', recipientId: idOf(to) });
    }
    for (const { name, price } of outcome.newItems) {
      publication.newItems.push({ actionId, name, price });
    }
    for (const { item, from, to } of outcome.movedItems) {
      publication.movedItems.push({ actionId, name: item, fromId: idOf(from), toId: idOf(to) });
    }
    for (const { creditor, points } of outcome.newDebts) {
      publication.newDebts.push({ actionId, creditorId: idOf(creditor), points });
    }
    for (const nickname of outcome.outCharacters) {
      publication.outCharacters.push({ actionId, characterId: idOf(nickname) });
    }
  }
  return publication;
}

async function postponed(
  { store, alert }: CloseDayDependencies,
  gameDay: StoredGameDay,
  reason: PostponedReason,
): Promise<CloseDayResult> {
  console.warn({ message: 'chapter postponed', day: gameDay.day, reason });
  const stored = await store.postponeChapter(gameDay.id, POSTPONED_CHAPTER_MESSAGE);
  if (!stored.ok) return stored;
  // Once: a Lambda retry or a failed run by hand has nothing new to say.
  if (stored.value.first) await alert(chapterPostponedAlert(gameDay.day, reason));
  return { ok: true, value: { status: 'postponed', reason } };
}

// The pull quote is shown as a line of the chapter, so it stands only if the chapter says it word
// for word on one line. A quote that does not is dropped: it never costs the day.
function quotedFrom(body: string, pullQuote: string): string | null {
  return /[\r\n\p{Zl}\p{Zp}]/u.test(pullQuote) || !body.includes(pullQuote) ? null : pullQuote;
}
