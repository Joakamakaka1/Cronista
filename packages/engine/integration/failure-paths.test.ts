import {
  type ChapterOutput,
  HINT_CENSOR_LINE,
  type Narrator,
  type NarratorResult,
  POSTPONED_CHAPTER_MESSAGE,
} from '@cronista/core';
import { PostgrestClient } from '@supabase/postgrest-js';
import { describe, expect, it, vi } from 'vitest';

import { closeDay, openDay, requestHint, submitAction } from '../src/index.ts';
import { localSupabase } from '../src/local.ts';
import {
  addDays,
  alertsInbox,
  answered,
  bibleLoader,
  gameInstant,
  lateClock,
  newSeason,
  outcomeOf,
  scriptedNarrator,
  SIMULATED_PLAYERS,
  store,
  usageOf,
} from './support.ts';

const { url, secretKey } = localSupabase();
const database = new PostgrestClient(`${url}/rest/v1`, { headers: { apikey: secretKey } });

const refused = (name: 'resolve' | 'narrate' | 'test_action'): Promise<NarratorResult<never>> =>
  Promise.resolve({
    ok: false,
    error: { kind: 'refused', category: 'general_harms' },
    usage: [usageOf(name, 'general_harms')],
  });

const chapter = (): Promise<NarratorResult<ChapterOutput>> =>
  Promise.resolve({
    ok: true,
    value: { title: 'Lunes', body: 'Pasó.' },
    usage: [usageOf('narrate')],
  });

/** Answers each call in turn, and the last one from then on. */
function inTurn<Output>(...answers: readonly (() => Promise<NarratorResult<Output>>)[]) {
  let call = 0;
  return () => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (answer === undefined) throw new Error('No answer scripted.');
    return answer();
  };
}

/** A season with its first day open and the actions of the first `players` characters. */
async function closing(players = 2) {
  const { day, seasonId } = await newSeason();
  const { alert, alerts } = alertsInbox();
  const opening = scriptedNarrator();
  await openDay(
    {
      store,
      narrator: opening.narrator,
      loadBible: bibleLoader(),
      clock: lateClock,
      alert: alertsInbox().alert,
    },
    day,
  );
  for (let index = 0; index < players; index += 1) {
    await submitAction(
      { store, clock: () => gameInstant(day, 12) },
      {
        userId: SIMULATED_PLAYERS[index]?.userId ?? '',
        action: { text: `Acción secreta ${String(index)}.`, stake: 3 },
      },
    );
  }

  return {
    day,
    seasonId,
    alerts,
    close: async (overrides: Partial<Narrator>) => {
      const { narrator, calls } = scriptedNarrator(overrides);
      const result = await closeDay(
        { store, narrator, loadBible: bibleLoader(), clock: lateClock, alert },
        day,
      );
      return { result, calls };
    },
    balances: async () => {
      const characters = await store.characters(seasonId);
      return characters.ok ? characters.value.map(({ balance }) => balance) : [];
    },
    gameDay: async () => {
      const gameDay = await store.gameDay(seasonId, day);
      return gameDay.ok ? gameDay.value : undefined;
    },
    body: async () => {
      const chapters = await store.lastChapters(seasonId, addDays(day, 1), 1);
      return chapters.ok ? chapters.value[0]?.body : undefined;
    },
    ledger: async () => {
      const { data } = await database
        .from('ai_usage')
        .select('function_name, refusal_category')
        .eq('game_day', day)
        .order('id');
      return data;
    },
    struckOut: async () => {
      const gameDay = await store.gameDay(seasonId, day);
      const id = gameDay.ok ? gameDay.value?.id : undefined;
      const { data } = await database
        .from('actions')
        .select('struck_out')
        .eq('game_day_id', id ?? 0)
        .eq('struck_out', true);
      return data?.length;
    },
  };
}

const untouched = [10, 10, 10, 10, 10];
const postponedFor = (reason: string) => ({ ok: true, value: { status: 'postponed', reason } });
const published = { ok: true, value: { status: 'published' } };

describe('invalid resolve output: a retry with its errors, then postponed', () => {
  const invalid = (): Promise<NarratorResult<never>> =>
    Promise.resolve({
      ok: false,
      error: { kind: 'invalid', issues: ['the answer is not valid JSON'] },
      usage: [usageOf('resolve')],
    });

  it('publishes when the retry fixes it, having told the model what was wrong', async () => {
    const game = await closing(1);

    const { result, calls } = await game.close({
      resolve: inTurn(invalid, () => answered(outcomeOf('La Farera'))),
    });

    expect(result).toEqual(published);
    expect(calls.resolve[0]?.retry).toBeUndefined();
    expect(calls.resolve[1]?.retry).toEqual({
      kind: 'fix',
      issues: ['the answer is not valid JSON'],
    });
  });

  it('postpones when the retry is invalid too, moving nothing', async () => {
    const game = await closing(1);

    const { result, calls } = await game.close({ resolve: invalid });

    expect(result).toEqual(postponedFor('resolve_invalid'));
    expect(calls.resolve).toHaveLength(2);
    expect(calls.narrate).toEqual([]);
    expect(await game.balances()).toEqual(untouched);
  });

  it('retries a missing action with the list of errors, then postpones', async () => {
    const game = await closing(2);

    const { result, calls } = await game.close({
      resolve: () => answered(outcomeOf('La Farera')),
    });

    expect(result).toEqual(postponedFor('resolution_invalid'));
    expect(calls.resolve[1]?.retry).toEqual({
      kind: 'fix',
      issues: ['missing outcome for El Notario'],
    });
  });

  it('retries a charge out of range, and publishes when the retry fixes it', async () => {
    const game = await closing(1);

    const { result, calls } = await game.close({
      resolve: inTurn(
        () => answered(outcomeOf('La Farera', { influence: 9 })),
        () => answered(outcomeOf('La Farera', { influence: 3 })),
      ),
    });

    expect(result).toEqual(published);
    expect(calls.resolve[1]?.retry).toEqual({
      kind: 'fix',
      issues: ['charges of 9 for La Farera are over its stake of 3'],
    });
    expect((await game.balances())[0]).toBe(9);
  });
});

describe('an invalid canon change: a retry with its errors, then dropped and logged', () => {
  const bad = outcomeOf('La Farera', { newItems: [{ name: 'Datos delicados', price: 0 }] });

  it('uses the retry when it fixes the change', async () => {
    const game = await closing(1);

    const { result, calls } = await game.close({
      resolve: inTurn(
        () => answered(bad),
        () =>
          answered(outcomeOf('La Farera', { newItems: [{ name: 'Datos delicados', price: 1 }] })),
      ),
    });

    expect(result).toEqual(published);
    expect(calls.resolve[1]?.retry).toEqual({
      kind: 'fix',
      issues: ['the new item Datos delicados of La Farera needs a charge'],
    });
    expect(calls.narrate[0]?.resolution.outcomes[0]?.newItems).toHaveLength(1);
  });

  it('drops the change and goes on, and a dropped change never reaches the text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const game = await closing(1);

    const { result, calls } = await game.close({ resolve: () => answered(bad) });

    expect(result).toEqual(published);
    expect(calls.resolve).toHaveLength(2);
    expect(calls.narrate[0]?.resolution.outcomes[0]?.newItems).toEqual([]);
    expect(calls.narrate[0]?.dropped).toEqual([
      'the new item Datos delicados of La Farera needs a charge',
    ]);
    expect(warn).toHaveBeenCalledWith({
      message: 'canon changes dropped',
      day: game.day,
      changes: ['new_item'],
    });
    // What the model wrote comes from player text, so it stays out of the logs.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Datos delicados');
    warn.mockRestore();
  });
});

describe('an invalid canon change, when its retry brings nothing', () => {
  const bad = outcomeOf('La Farera', { newItems: [{ name: 'Gratis', price: 0 }] });

  it.each([
    ['an invalid answer', { kind: 'invalid', issues: ['cut off'] }],
    ['a refusal', { kind: 'refused', category: 'cyber' }],
    ['an outage', { kind: 'technical' }],
  ] as const)('still drops the change and goes on after %s', async (_, error) => {
    const game = await closing(1);

    const { result, calls } = await game.close({
      resolve: inTurn(
        () => answered(bad),
        () => Promise.resolve({ ok: false, error, usage: [] }),
      ),
    });

    expect(result).toEqual(published);
    expect(calls.narrate[0]?.resolution.outcomes[0]?.newItems).toEqual([]);
    expect(calls.narrate[0]?.dropped).toEqual(['the new item Gratis of La Farera needs a charge']);
  });

  it('postpones when what it was fixing could not publish either', async () => {
    const game = await closing(1);

    const { result } = await game.close({
      resolve: inTurn(
        () => answered(outcomeOf('La Farera', { influence: 9 })),
        () =>
          Promise.resolve({
            ok: false,
            error: { kind: 'invalid', issues: ['cut off'] },
            usage: [],
          }),
      ),
    });

    expect(result).toEqual(postponedFor('resolution_invalid'));
  });

  it('postpones on a spend limit, which nothing here can get round', async () => {
    const game = await closing(1);

    const { result } = await game.close({
      resolve: inTurn(
        () => answered(bad),
        () => Promise.resolve({ ok: false, error: { kind: 'spend_limit' }, usage: [] }),
      ),
    });

    expect(result).toEqual(postponedFor('resolve_spend_limit'));
  });
});

describe('invalid or empty narrate output: a retry with its errors, then postponed', () => {
  const empty = (): Promise<NarratorResult<never>> =>
    Promise.resolve({
      ok: false,
      error: { kind: 'invalid', issues: ['body: too_small'] },
      usage: [usageOf('narrate')],
    });

  it('publishes when the retry fixes it', async () => {
    const game = await closing(1);

    const { result, calls } = await game.close({ narrate: inTurn(empty, chapter) });

    expect(result).toEqual(published);
    expect(calls.narrate[1]?.retry).toEqual({ kind: 'fix', issues: ['body: too_small'] });
    expect(calls.resolve).toHaveLength(1);
  });

  it('postpones when the retry is invalid too, moving nothing', async () => {
    const game = await closing(1);

    const { result, calls } = await game.close({ narrate: empty });

    expect(result).toEqual(postponedFor('narrate_invalid'));
    expect(calls.narrate).toHaveLength(2);
    expect(await game.balances()).toEqual(untouched);
  });
});

describe('a refusal', () => {
  const fineTest = (): Promise<NarratorResult<{ text: string }>> =>
    Promise.resolve({ ok: true, value: { text: 'Lo intenta.' }, usage: [usageOf('test_action')] });

  it('gets one softer retry on resolve, and publishes when that answers', async () => {
    const game = await closing(1);

    const { result, calls } = await game.close({
      resolve: inTurn(
        () => refused('resolve'),
        () => answered(outcomeOf('La Farera')),
      ),
    });

    expect(result).toEqual(published);
    expect(calls.resolve[1]?.retry).toEqual({ kind: 'softer' });
    expect(calls.testAction).toEqual([]);
    expect(await game.ledger()).toContainEqual({
      function_name: 'resolve',
      refusal_category: 'general_harms',
    });
  });

  it('gets one softer retry on narrate, and publishes when that answers', async () => {
    const game = await closing(1);

    const { result, calls } = await game.close({
      narrate: inTurn(() => refused('narrate'), chapter),
    });

    expect(result).toEqual(published);
    expect(calls.narrate[1]?.retry).toEqual({ kind: 'softer' });
    expect(calls.resolve).toHaveLength(1);
    expect(calls.testAction).toEqual([]);
  });

  const scripts: Readonly<Record<'resolve' | 'narrate', Partial<Narrator>>> = {
    resolve: {
      resolve: inTurn(
        () => refused('resolve'),
        () => refused('resolve'),
        () => answered(outcomeOf('El Notario', { award: 4 })),
      ),
      narrate: chapter,
    },
    // Both steps run again without the action, so resolve answers twice.
    narrate: {
      resolve: inTurn(
        () => answered(outcomeOf('La Farera'), outcomeOf('El Notario')),
        () => answered(outcomeOf('El Notario', { award: 4 })),
      ),
      narrate: inTurn(
        () => refused('narrate'),
        () => refused('narrate'),
        chapter,
      ),
    },
  };

  it.each(['resolve', 'narrate'] as const)(
    'tests each action alone after two on %s, and strikes out the refused one',
    async (step) => {
      const game = await closing(2);

      const { result, calls } = await game.close({
        ...scripts[step],
        testAction: ({ action }) =>
          action.nickname === 'La Farera' ? refused('test_action') : fineTest(),
      });

      expect(result).toEqual(published);
      expect(calls.testAction.map(({ action }) => action.nickname)).toEqual([
        'La Farera',
        'El Notario',
      ]);

      // The comic penalty, with the stake back and no canon change; the other action counts.
      expect(await game.balances()).toEqual([8, 14, 9, 9, 9]);
      expect(await game.struckOut()).toBe(1);

      // The chapter runs without it, with the censor's paragraph.
      const lastNarrate = calls.narrate.at(-1);
      expect(lastNarrate?.struckOut).toEqual(['La Farera']);
      expect(lastNarrate?.actions.map(({ nickname }) => nickname)).toEqual(['El Notario']);
      expect(JSON.stringify(calls.resolve.at(-1))).not.toContain('Acción secreta 0');
      expect(JSON.stringify(lastNarrate)).not.toContain('Acción secreta 0');
      expect(await game.body()).toBe(
        'Pasó.\n\nLa acción de La Farera ha sido tachada por el censor del periódico.',
      );
      expect(await game.ledger()).toContainEqual({
        function_name: 'test_action',
        refusal_category: 'general_harms',
      });
    },
  );

  it('publishes with every action struck out, deciding nothing', async () => {
    const game = await closing(1);

    const { result, calls } = await game.close({
      resolve: inTurn(
        () => refused('resolve'),
        () => refused('resolve'),
      ),
      testAction: () => refused('test_action'),
    });

    expect(result).toEqual(published);
    expect(calls.resolve).toHaveLength(2);
    expect(calls.narrate[0]?.actions).toEqual([]);
    expect(await game.balances()).toEqual([8, 9, 9, 9, 9]);
  });

  it('postpones when no action alone is refused, and nobody pays', async () => {
    const game = await closing(2);

    const { result, calls } = await game.close({ narrate: () => refused('narrate') });

    expect(result).toEqual(postponedFor('refused_no_culprit'));
    expect(calls.narrate).toHaveLength(2);
    expect(calls.testAction).toHaveLength(2);
    expect(await game.balances()).toEqual(untouched);
    expect(await game.struckOut()).toBe(0);
  });

  it('postpones when the chapter is still refused without them, striking nobody out', async () => {
    const game = await closing(2);

    const { result, calls } = await game.close({
      narrate: () => refused('narrate'),
      testAction: ({ action }) =>
        action.nickname === 'La Farera'
          ? refused('test_action')
          : Promise.resolve({ ok: true, value: { text: 'Bien.' }, usage: [] }),
      resolve: inTurn(
        () => answered(outcomeOf('La Farera'), outcomeOf('El Notario')),
        () => answered(outcomeOf('El Notario')),
      ),
    });

    expect(result).toEqual(postponedFor('refused_after_strike'));
    // Twice before the tests, once after: it gets no second softer retry.
    expect(calls.narrate).toHaveLength(3);
    expect(await game.balances()).toEqual(untouched);
    expect(await game.struckOut()).toBe(0);
  });

  it('postpones on a day nobody played, because there is no action to test', async () => {
    const game = await closing(0);

    const { result, calls } = await game.close({ narrate: () => refused('narrate') });

    expect(result).toEqual(postponedFor('refused_no_culprit'));
    expect(calls.testAction).toEqual([]);
  });

  it('takes an invalid answer to a test as no refusal: the model did answer', async () => {
    const game = await closing(1);

    const { result } = await game.close({
      narrate: () => refused('narrate'),
      testAction: () =>
        Promise.resolve({ ok: false, error: { kind: 'invalid', issues: ['cut off'] }, usage: [] }),
    });

    expect(result).toEqual(postponedFor('refused_no_culprit'));
  });

  it('keeps an outage or a limit in the tests from reading as no culprit', async () => {
    const outage = await closing(1);
    const limited = await closing(1);
    const resolve = () => refused('resolve');

    expect(
      (
        await outage.close({
          resolve,
          testAction: () => Promise.resolve({ ok: false, error: { kind: 'technical' }, usage: [] }),
        })
      ).result,
    ).toEqual(postponedFor('test_action_technical'));
    expect(
      (
        await limited.close({
          resolve,
          testAction: () =>
            Promise.resolve({ ok: false, error: { kind: 'spend_limit' }, usage: [] }),
        })
      ).result,
    ).toEqual(postponedFor('test_action_spend_limit'));
  });
});

describe('a struck-out action afterwards', () => {
  it('never reaches the model again, and others see it struck out with no text', async () => {
    const game = await closing(2);
    await game.close({
      resolve: inTurn(
        () => refused('resolve'),
        () => refused('resolve'),
        () => answered(outcomeOf('El Notario')),
      ),
      testAction: ({ action }) =>
        action.nickname === 'La Farera'
          ? refused('test_action')
          : Promise.resolve({ ok: true, value: { text: 'Bien.' }, usage: [] }),
    });

    // A close run again finds it published, and its text stays out of the store's reads.
    const gameDay = await game.gameDay();
    const actions = await store.actions(gameDay?.id ?? 0);
    expect(actions.ok && actions.value.map(({ text }) => text)).not.toContain('Acción secreta 0.');

    const { narrator, calls } = scriptedNarrator();
    await closeDay(
      {
        store,
        narrator,
        loadBible: bibleLoader(),
        clock: lateClock,
        alert: alertsInbox().alert,
      },
      game.day,
    );
    expect(calls.resolve).toEqual([]);

    // Its row says so, and the row holds no text: RLS keeps the text from others (pgTAP proves it).
    const { data } = await database
      .from('actions')
      .select('struck_out, character_id')
      .eq('game_day_id', gameDay?.id ?? 0)
      .eq('struck_out', true);
    expect(data).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('secreta');
  });
});

describe('a workspace spend limit', () => {
  it.each(['resolve', 'narrate'] as const)(
    'postpones on %s with no retry, a message and an alert that names it',
    async (step) => {
      const game = await closing(1);

      const { result, calls } = await game.close({
        [step]: () => Promise.resolve({ ok: false, error: { kind: 'spend_limit' }, usage: [] }),
      });

      expect(result).toEqual(postponedFor(`${step}_spend_limit`));
      expect(calls[step]).toHaveLength(1);
      expect((await game.gameDay())?.newspaperMessage).toBe(POSTPONED_CHAPTER_MESSAGE);
      expect(game.alerts.map(({ subject }) => subject)).toEqual([
        'Cronista: the workspace spend limit postponed a chapter',
      ]);
      expect(await game.balances()).toEqual(untouched);
    },
  );
});

describe('a postponed chapter', () => {
  it('changes no balance or canon and leaves the newspaper message', async () => {
    const game = await closing(1);

    await game.close({
      resolve: () =>
        answered(
          outcomeOf('La Farera', {
            influence: 99,
            newItems: [{ name: 'La llave', price: 1 }],
            outCharacters: ['El Notario'],
          }),
        ),
    });

    const gameDay = await game.gameDay();
    expect(gameDay?.state).toBe('postponed');
    expect(gameDay?.newspaperMessage).toBe(POSTPONED_CHAPTER_MESSAGE);
    expect(await game.balances()).toEqual(untouched);
    const canon = await store.canon(game.seasonId, addDays(game.day, 1));
    expect(canon.ok && canon.value.items).toEqual([]);
    expect(canon.ok && canon.value.characters.some(({ out }) => out)).toBe(false);
  });

  it('tells the owner once, however many times it fails again', async () => {
    const game = await closing(1);
    const broken = { narrate: () => refused('narrate') };

    await game.close(broken);
    await game.close(broken);

    expect(game.alerts).toHaveLength(1);
    expect(game.alerts[0]?.message).toContain('refused_no_culprit');
    expect(JSON.stringify(game.alerts)).not.toContain('Acción secreta');
  });
});

describe('a refused hint', () => {
  it('still takes its own path: the censor line, the quota spent and no penalty', async () => {
    const game = await closing(1);
    const { narrator } = scriptedNarrator({
      hint: () =>
        Promise.resolve({
          ok: false,
          error: { kind: 'refused', category: 'cyber' },
          usage: [usageOf('hint', 'cyber')],
        }),
    });

    const hint = await requestHint(
      {
        store,
        narrator,
        loadBible: bibleLoader(),
        clock: () => gameInstant(game.day, 12),
      },
      { userId: SIMULATED_PLAYERS[0]?.userId ?? '' },
    );

    expect(hint).toEqual({ ok: true, value: { text: HINT_CENSOR_LINE, censored: true } });
    expect(await game.balances()).toEqual(untouched);
  });
});
