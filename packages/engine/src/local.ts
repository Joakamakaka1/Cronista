/**
 * What a local run needs from the local Supabase: its URL and key, the seed's invented players and a
 * free stretch of dates. Node only, and never imported by a Lambda.
 *
 * @packageDocumentation
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { gameDayOf, gameMinuteOfDay } from '@cronista/core';
import type { Database } from '@cronista/db';
import { PostgrestClient } from '@supabase/postgrest-js';
import { z } from 'zod';

import { createGameStore, type GameStore } from './store.ts';

const databasePackage = fileURLToPath(new URL('../../db', import.meta.url));

const statusSchema = z.looseObject({
  API_URL: z.url(),
  SECRET_KEY: z.string().min(1),
});

/** The players in `packages/db/supabase/seed.sql`, invented and signed up. */
export const SIMULATED_PLAYERS = [1, 2, 3, 4, 5].map((number) => ({
  email: `sim-${String(number)}@example.com`,
  userId: `00000000-0000-4000-8000-00000000000${String(number)}`,
}));

let connection: { readonly url: string; readonly secretKey: string } | undefined;

/**
 * The URL and key of the local Supabase, which are the CLI's and no secret. It refuses any other
 * host, so a local run can never reach production.
 */
export function localSupabase(): { readonly url: string; readonly secretKey: string } {
  if (connection !== undefined) return connection;
  const output = execFileSync('supabase', ['status', '-o', 'json', '--workdir', databasePackage], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const status = statusSchema.parse(JSON.parse(output));
  const { hostname } = new URL(status.API_URL);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error('A local run only talks to the local Supabase.');
  }
  connection = { url: status.API_URL, secretKey: status.SECRET_KEY };
  return connection;
}

/** The store of the local Supabase. */
export function localStore(): GameStore {
  return createGameStore(localSupabase());
}

/** A season number and start date free in the local database, for a run that never cleans up. */
export async function nextSeasonSlot(): Promise<{
  readonly number: number;
  readonly startsOn: string;
}> {
  const { url, secretKey } = localSupabase();
  const client = new PostgrestClient<Database>(`${url}/rest/v1`, {
    headers: { apikey: secretKey },
  });
  const { data, error } = await client.from('seasons').select('number, starts_on, ends_on');
  if (error !== null) throw new Error(`Could not read the local seasons: ${error.code}`);

  const number = Math.max(0, ...data.map((season) => season.number)) + 1;
  const lastDate = data
    .map((season) => season.ends_on ?? season.starts_on)
    .reduce((latest, date) => (date > latest ? date : latest), '2029-12-31');
  return { number, startsOn: addDays(lastDate, 1) };
}

/** `day` (`YYYY-MM-DD`) plus `days`. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The instant of game day `day` at `hour`:`minute` in the game time zone, for an injected clock. */
export function gameInstant(day: string, hour: number, minute = 0): Date {
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  for (const offset of ['+01:00', '+02:00']) {
    const instant = new Date(`${day}T${clock}${offset}`);
    if (gameDayOf(instant) === day && gameMinuteOfDay(instant) === hour * 60 + minute) {
      return instant;
    }
  }
  throw new Error(`There is no ${clock} on ${day} in the game time zone.`);
}
