/**
 * The local API harness: the real `core-api` and `ai-api` handlers behind Vite, over the local
 * Supabase, with a scripted narrator and a clock set to the latest game day. It only runs in
 * `vite.config.ts` (dev and local preview), so nothing here reaches the bundle.
 *
 * @packageDocumentation
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createHandler as createAiApiHandler } from '@cronista/ai-api/handler';
import { createHandler as createCoreApiHandler } from '@cronista/core-api/handler';
import type { GameNotification, PushNotification } from '@cronista/core';
import type { Database } from '@cronista/db';
import { closeDay, createGameStore, openDay, requestHint, submitAction } from '@cronista/engine';
import {
  addDays,
  gameInstant,
  localSupabase,
  nextSeasonSlot,
  SIMULATED_PLAYERS,
} from '@cronista/engine/local';
import { bibleLoader, INVENTED_NICKNAMES, wordsEmbedder } from '@cronista/engine/scripted';
import { type FunctionUrlHandler, supabaseSessionVerifier } from '@cronista/http';
import { createPushSender, type VapidKeys } from '@cronista/notifier/push-sender';
import { createPushDelivery } from '@cronista/notifier/send-pushes';
import { functionUrlEvent } from '@cronista/http/testing';
import { createMemoryStore } from '@cronista/memory-tools';
import { createClient } from '@supabase/supabase-js';
import type { Connect, Plugin } from 'vite';

import { scriptedStory } from './scripted-story.ts';

/**
 * The Vite plugin that serves `/api/*` and the harness's own `/__harness` routes. The day's pushes go
 * out for real, signed with `vapid`: a pair the dev server made for itself, whose public half the app
 * subscribes with.
 */
export function localApiHarness(vapid: VapidKeys): Plugin {
  const middleware = createMiddleware(vapid);
  return {
    name: 'cronista-local-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function createMiddleware(vapid: VapidKeys): Connect.NextHandleFunction {
  const supabase = localSupabase();
  const store = createGameStore(supabase);
  const database = createClient<Database>(supabase.url, supabase.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const narrator = scriptedStory();
  const loadBible = bibleLoader();
  const memory = { store: createMemoryStore(supabase), voyage: wordsEmbedder() };
  const alert = ({ subject }: { subject: string }) => {
    console.warn(`[harness] alert: ${subject}`);
    return Promise.resolve(true);
  };

  // The latest game day in the local database: the one the app shows, and the clock's day.
  const latestDay = async () => {
    const { data, error } = await database
      .from('game_days')
      .select('day, state')
      .order('day', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error !== null) throw new Error(`Could not read the local game days: ${error.code}`);
    return data;
  };
  // Midday of the latest day, so actions and hints land inside it whatever the real date is.
  const middayClock = async () => {
    const latest = await latestDay();
    const instant = latest === null ? new Date() : gameInstant(latest.day, 12);
    return () => instant;
  };

  const verifySession = supabaseSessionVerifier(supabase.url);
  const coreApi = createCoreApiHandler({
    verifySession,
    reportClientError: () => {
      console.warn('[harness] client error reported');
    },
    submitAction: async (input) =>
      submitAction({ store, clock: await middayClock(), notify }, input),
  });
  const aiApi = createAiApiHandler({
    verifySession,
    requestHint: async (userId) =>
      requestHint({ store, narrator, loadBible, clock: await middayClock() }, { userId }),
    flushTraces: () => Promise.resolve(),
  });

  // As the notifier sends them, with no queue in between.
  const sendPushes = createPushDelivery({
    store,
    readVapidKeys: () => Promise.resolve({ ok: true, value: vapid }),
    pushSender: (keys) => createPushSender({ keys, contact: 'https://example.com' }),
  });
  const push = async (notification: PushNotification) => {
    const sent = await sendPushes(notification);
    console.info(`[harness] push ${notification.type}:`, sent.ok ? sent.value : sent.error);
    return sent.ok;
  };
  const notify = (notification: GameNotification) => push(notification).catch(() => false);
  const engine = (clock: () => Date) => ({
    store,
    narrator,
    memory,
    loadBible,
    clock,
    alert,
    notify,
  });

  const routes: Readonly<Record<string, () => Promise<string>>> = {
    'POST /__harness/season': async () => {
      const { number, startsOn } = await nextSeasonSlot();
      const created = await store.createSeason({
        number,
        startsOn,
        endsOn: addDays(startsOn, 29),
        characters: SIMULATED_PLAYERS.map(({ email }, index) => ({
          email,
          nickname: INVENTED_NICKNAMES[index] ?? `Personaje ${String(index + 1)}`,
        })),
      });
      if (!created.ok) throw new Error(`Could not create a season: ${created.error}`);
      return outcome(
        await openDay(
          engine(() => gameInstant(startsOn, 8)),
          startsOn,
        ),
      );
    },
    'POST /__harness/days/open': async () => {
      const latest = await latestDay();
      if (latest === null) return 'No day yet: create a season first.';
      const next = addDays(latest.day, 1);
      return outcome(
        await openDay(
          engine(() => gameInstant(next, 8)),
          next,
        ),
      );
    },
    'POST /__harness/reminder': async () => {
      const latest = await latestDay();
      if (latest === null) return 'No day to remind of.';
      // The 21:00 reminder of the latest day: only players who have not played get it.
      await push({ type: 'reminder', scheduledTime: gameInstant(latest.day, 21).toISOString() });
      return 'Reminder sent.';
    },
    'POST /__harness/days/close': async () => {
      const latest = await latestDay();
      if (latest === null) return 'No day to close.';
      return outcome(
        await closeDay(
          engine(() => gameInstant(latest.day, 22)),
          latest.day,
        ),
      );
    },
  };

  return (request, response, next) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://harness.local');
      if (url.pathname.startsWith('/api/')) {
        const handler = url.pathname.startsWith('/api/ai/') ? aiApi : coreApi;
        writeResult(response, await handler(await toEvent(request, url)));
        return;
      }
      if (url.pathname === '/__harness') {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(harnessPage((await latestDay())?.day ?? null));
        return;
      }
      if (url.pathname === '/__harness/sign-in') {
        response.statusCode = 302;
        response.setHeader(
          'location',
          await signInLocation(supabase, url.searchParams.get('player')),
        );
        response.end();
        return;
      }
      const route = routes[`${request.method ?? 'GET'} ${url.pathname}`];
      if (route === undefined) {
        next();
        return;
      }
      const text = await route();
      // A form posts here from the harness page; a script asks for JSON.
      if (request.headers.accept?.includes('application/json') === true) {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ result: text, day: (await latestDay())?.day ?? null }));
      } else {
        response.statusCode = 303;
        response.setHeader('location', '/__harness');
        response.end();
      }
    })().catch((error: unknown) => {
      console.error('[harness]', error);
      response.statusCode = 500;
      response.end('harness error');
    });
  };
}

// -----------------------------------------------------------------------------
// Requests and responses
// -----------------------------------------------------------------------------

async function toEvent(request: IncomingMessage, url: URL) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers[name.toLowerCase()] = value;
  }
  return functionUrlEvent({
    method: request.method ?? 'GET',
    path: url.pathname,
    headers,
    ...(chunks.length === 0 ? {} : { body: Buffer.concat(chunks).toString('utf8') }),
  });
}

function writeResult(response: ServerResponse, result: Awaited<ReturnType<FunctionUrlHandler>>) {
  response.statusCode = result.statusCode ?? 200;
  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, String(value));
  }
  response.end(result.body ?? '');
}

function outcome(result: { ok: boolean; value?: unknown; error?: unknown }): string {
  return JSON.stringify(result.ok ? result.value : { error: result.error });
}

// -----------------------------------------------------------------------------
// Signing in as an invented player
// -----------------------------------------------------------------------------

/**
 * Signs in as one of the seed's invented players with a magic link verified here, and hands the
 * session to the app in the URL fragment, as Google sign-in does through Supabase Auth.
 */
async function signInLocation(
  supabase: ReturnType<typeof localSupabase>,
  player: string | null,
): Promise<string> {
  const email = SIMULATED_PLAYERS.find((candidate) =>
    candidate.email.startsWith(`${player ?? 'sim-1'}@`),
  )?.email;
  if (email === undefined) throw new Error(`No invented player ${player ?? ''}.`);
  const admin = createClient(supabase.url, supabase.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error !== null) throw link.error;
  const verified = await admin.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.data.properties.hashed_token,
  });
  const session = verified.data.session;
  if (session === null) throw new Error('The magic link gave no session.');
  const fragment = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in),
    expires_at: String(session.expires_at ?? ''),
    token_type: 'bearer',
    type: 'magiclink',
  });
  return `/#${fragment.toString()}`;
}

// -----------------------------------------------------------------------------
// The harness page
// -----------------------------------------------------------------------------

function harnessPage(day: string | null): string {
  const players = SIMULATED_PLAYERS.map(({ email }, index) => {
    const player = email.split('@')[0] ?? '';
    return `<li><a href="/__harness/sign-in?player=${player}">${INVENTED_NICKNAMES[index] ?? player}</a> (${email})</li>`;
  }).join('');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><title>Harness · Cronista</title>
<body style="font-family:system-ui;max-width:40rem;margin:2rem auto;padding:0 1rem">
<h1>Harness local</h1>
<p>Último día en la base de datos local: <strong>${day ?? 'ninguno'}</strong>.</p>
<form method="post" action="/__harness/season"><button>Crear temporada y abrir su primer día</button></form>
<form method="post" action="/__harness/days/close"><button>Cerrar el último día (22:00)</button></form>
<form method="post" action="/__harness/days/open"><button>Abrir el día siguiente (08:00)</button></form>
<form method="post" action="/__harness/reminder"><button>Enviar el recordatorio de las 21:00</button></form>
<h2>Entrar como</h2><ul>${players}</ul>
</body></html>`;
}
