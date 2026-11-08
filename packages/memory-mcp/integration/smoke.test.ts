import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { closeDay, openDay, submitAction } from '@cronista/engine';
import {
  addDays,
  gameInstant,
  localStore,
  localSupabase,
  nextSeasonSlot,
  SIMULATED_PLAYERS,
} from '@cronista/engine/local';
import {
  bibleLoader,
  INVENTED_NICKNAMES,
  scriptedNarrator,
  wordsEmbedder,
} from '@cronista/engine/scripted';
import { createMemoryStore } from '@cronista/memory-tools';
import {
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  InMemoryTransport,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMemoryServer } from '../src/memory-server.ts';
import { connectReader, createPostgresReads } from '../src/postgres-reads.ts';
import { LOCAL_DATABASE_URL } from '../src/target.ts';

const store = localStore();
const voyage = wordsEmbedder();
const sql = connectReader(LOCAL_DATABASE_URL);

/** Plays a season's first days on local Supabase, so that memory has chapters and moments. */
async function playedSeason(days: number) {
  const { number, startsOn } = await nextSeasonSlot();
  const created = await store.createSeason({
    number,
    startsOn,
    endsOn: addDays(startsOn, 29),
    characters: SIMULATED_PLAYERS.slice(0, 2).map(({ email }, index) => ({
      email,
      nickname: INVENTED_NICKNAMES[index] ?? '',
    })),
  });
  if (!created.ok) throw new Error(`Could not create a season: ${created.error}`);
  const unheard = () => Promise.resolve(true);
  for (let index = 0; index < days; index += 1) {
    const day = addDays(startsOn, index);
    const dependencies = {
      store,
      narrator: scriptedNarrator({
        narrate: () =>
          Promise.resolve({
            ok: true,
            value: {
              title: `Día ${String(index + 1)}`,
              body: `${INVENTED_NICKNAMES[0]} encendió el faro con una cerilla mojada.`,
              pullQuote: 'una cerilla mojada',
            },
            usage: [],
          }),
      }).narrator,
      memory: { store: createMemoryStore(localSupabase()), voyage },
      loadBible: bibleLoader(2),
      clock: () => gameInstant(day, 9),
      alert: unheard,
      notify: unheard,
    };
    const opened = await openDay(dependencies, day);
    if (!opened.ok) throw new Error(`The day did not open: ${opened.error}`);
    const sent = await submitAction(
      { store, notify: unheard, clock: () => gameInstant(day, 12) },
      {
        userId: SIMULATED_PLAYERS[0]?.userId ?? '',
        action: { text: 'Enciendo el faro.', stake: 0 },
      },
    );
    if (!sent.ok) throw new Error(`The action was not sent: ${sent.error}`);
    const closed = await closeDay({ ...dependencies, clock: () => gameInstant(day, 22) }, day);
    if (!closed.ok) throw new Error(`The day did not close: ${closed.error}`);
  }
  return { startsOn, lastDay: addDays(startsOn, days - 1) };
}

/** A JSON-RPC client over the in-memory transport: each request waits for its answer. */
async function connectedClient(lastDay: string) {
  const server = createMemoryServer({
    reads: createPostgresReads(sql),
    embedQueries: voyage.embedQueries,
    clock: () => gameInstant(lastDay, 23),
  });
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const waiting = new Map<number, (message: JSONRPCMessage) => void>();
  client.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number') waiting.get(message.id)?.(message);
  };
  await server.connect(serverSide);
  await client.start();
  let nextId = 0;
  const request = (method: string, params: Record<string, unknown> = {}) => {
    nextId += 1;
    const id = nextId;
    return new Promise<JSONRPCMessage>((resolve) => {
      waiting.set(id, resolve);
      void client.send({ jsonrpc: '2.0', id, method, params });
    });
  };
  await request('initialize', {
    protocolVersion: DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.0' },
  });
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { request, close: () => server.close() };
}

const textOf = (message: JSONRPCMessage) => {
  const result = 'result' in message ? (message.result as { content?: { text?: string }[] }) : {};
  return result.content?.map(({ text }) => text ?? '').join('\n') ?? '';
};

let played: Awaited<ReturnType<typeof playedSeason>>;

beforeAll(async () => {
  played = await playedSeason(3);
}, 60_000);

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe('the MCP server on local Supabase', () => {
  it('lists the six read-only tools, in their order', async () => {
    const client = await connectedClient(played.lastDay);
    const listed = await client.request('tools/list');
    const tools =
      'result' in listed
        ? (listed.result as { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] })
            .tools
        : [];
    expect(tools.map(({ name }) => name)).toEqual([
      'memory_search',
      'memory_get_character',
      'memory_timeline',
      'memory_explain_ranking',
      'game_get_state',
      'chapter_get',
    ]);
    expect(tools.every(({ annotations }) => annotations?.readOnlyHint === true)).toBe(true);
    await client.close();
  });

  it('answers all six as labelled untrusted data, under 10k tokens', async () => {
    const client = await connectedClient(played.lastDay);
    const nickname = INVENTED_NICKNAMES[0];
    const calls: [string, Record<string, unknown>][] = [
      ['memory_search', { query: 'faro cerilla' }],
      ['memory_get_character', { character_id: nickname }],
      ['memory_timeline', {}],
      ['memory_explain_ranking', { query: 'faro' }],
      ['game_get_state', {}],
      ['chapter_get', { day: played.startsOn }],
    ];
    for (const [name, args] of calls) {
      const answer = textOf(await client.request('tools/call', { name, arguments: args }));
      expect(answer, name).toMatch(new RegExp(`^<datos_herramienta herramienta="${name}">`));
      expect(answer, name).not.toContain('no responde');
      // A generous 2 characters a token: still far below the 10k where Claude Code warns.
      expect(answer.length / 2, name).toBeLessThan(10_000);
    }
    const timeline = textOf(
      await client.request('tools/call', { name: 'memory_timeline', arguments: {} }),
    );
    expect(timeline).toContain(`[${played.startsOn}] Resumen del ${played.startsOn}.`);
    const chapter = textOf(
      await client.request('tools/call', {
        name: 'chapter_get',
        arguments: { day: played.startsOn },
      }),
    );
    expect(chapter).toContain('# Día 1');
    const search = textOf(
      await client.request('tools/call', {
        name: 'memory_explain_ranking',
        arguments: { query: 'faro' },
      }),
    );
    expect(search).toMatch(/RRF \d\.\d{4} \(vector/);
    await client.close();
  });
});

describe('the server process', () => {
  it('starts on stdio against local Supabase and answers the tool list', async () => {
    const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
    const child = spawn(process.execPath, [main], {
      env: { ...process.env, CRONISTA_MCP_TARGET: 'local', VOYAGE_API_KEY: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    const answered = new Promise<string>((resolve) => {
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        if (output.includes('"id":2')) resolve(output);
      });
    });
    const send = (message: Record<string, unknown>) =>
      child.stdin.write(`${JSON.stringify(message)}\n`);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'smoke-test', version: '0.0.0' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const lines = await answered;
    child.kill();
    expect(lines).toContain('"name":"chapter_get"');
  }, 30_000);

  it('refuses production without its opt-in URL', async () => {
    const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
    const child = spawn(process.execPath, [main], {
      env: { ...process.env, CRONISTA_MCP_TARGET: 'prod', CRONISTA_MCP_DATABASE_URL: '' },
    });
    let errors = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      errors += chunk;
    });
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(1);
    expect(errors).toContain('CRONISTA_MCP_DATABASE_URL');
  }, 30_000);
});
