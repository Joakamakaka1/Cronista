import { PostgrestClient } from '@supabase/postgrest-js';
import { describe, expect, it } from 'vitest';

import { closeDay, createGameStore, openDay, requestHint, submitAction } from '../src/index.ts';
import { localSupabase } from '../src/local.ts';
import {
  alertsInbox,
  notificationsInbox,
  bibleLoader,
  gameInstant,
  lateClock,
  newSeason,
  scriptedNarrator,
  SIMULATED_PLAYERS,
  store,
  usageOf,
  memory,
  unheard,
} from './support.ts';

const { url, secretKey } = localSupabase();
const database = new PostgrestClient(`${url}/rest/v1`, { headers: { apikey: secretKey } });

// The ledger has no reader in the engine, so this looks at the table itself.
const ledgerOf = async (day: string) => {
  const { data, error } = await database
    .from('ai_usage')
    .select('function_name, refusal_category, input_tokens')
    .eq('game_day', day)
    .order('id');
  if (error !== null) throw new Error(error.code);
  return data;
};

describe('the spend ledger', () => {
  it('gets one row per AI response of a whole day, refusals included', async () => {
    const { day } = await newSeason();
    const { narrator } = scriptedNarrator({
      hint: () =>
        Promise.resolve({
          ok: false,
          error: { kind: 'refused', category: 'cyber' },
          usage: [usageOf('hint', 'cyber')],
        }),
    });
    const dependencies = {
      store,
      narrator,
      memory,
      loadBible: bibleLoader(),
      clock: lateClock,
      alert: alertsInbox().alert,
      notify: notificationsInbox().notify,
    };
    const noon = () => gameInstant(day, 12);
    const userId = SIMULATED_PLAYERS[0]?.userId ?? '';

    await openDay(dependencies, day);
    await submitAction(
      { store, notify: unheard, clock: noon },
      { userId, action: { text: 'Huyo.', stake: 0 } },
    );
    await requestHint({ ...dependencies, clock: noon }, { userId });
    await closeDay({ ...dependencies, clock: () => gameInstant(day, 22) }, day);

    expect(await ledgerOf(day)).toEqual([
      { function_name: 'situation', refusal_category: null, input_tokens: 100 },
      { function_name: 'hint', refusal_category: 'cyber', input_tokens: 100 },
      // Memory: nothing to recall on a first day, then the chapter's chunks and its moments.
      { function_name: 'resolve', refusal_category: null, input_tokens: 100 },
      { function_name: 'narrate', refusal_category: null, input_tokens: 100 },
      { function_name: 'embed_documents', refusal_category: null, input_tokens: 100 },
      { function_name: 'extract_moments', refusal_category: null, input_tokens: 100 },
      { function_name: 'embed_documents', refusal_category: null, input_tokens: 100 },
    ]);
  });

  it('never stops the game when the ledger cannot be written', async () => {
    const { day } = await newSeason();
    const { narrator } = scriptedNarrator();
    const brokenLedger = createGameStore({
      url,
      secretKey,
      fetch: (input, init) =>
        (input instanceof Request ? input.url : input.toString()).includes('/ai_usage')
          ? Promise.resolve(new Response('{"code":"XX000"}', { status: 500 }))
          : fetch(input, init),
    });

    expect(
      await openDay(
        {
          store: brokenLedger,
          narrator,
          memory,
          loadBible: bibleLoader(),
          clock: lateClock,
          alert: alertsInbox().alert,
          notify: notificationsInbox().notify,
        },
        day,
      ),
    ).toEqual({ ok: true, value: 'opened' });
    expect(await ledgerOf(day)).toEqual([]);
  });
});
