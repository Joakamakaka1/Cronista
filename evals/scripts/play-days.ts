/**
 * Plays game days for 5 invented players on the local Supabase with real Haiku, through the same game
 * engine as production. It only talks to the local database, and it creates its own season, so it
 * needs no reset. Each run spends cents from the `evals` workspace.
 *
 * Usage: `pnpm play-days [days]`, 3 by default. Chapters go to `evals/results/play-days/`.
 *
 * @packageDocumentation
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { AiUsage, Memory, Narrator } from '@cronista/core';
import {
  closeDay,
  createSeason,
  openDay,
  type RaiseAlert,
  requestHint,
  submitAction,
} from '@cronista/engine';
import {
  addDays,
  gameInstant,
  localStore,
  localSupabase,
  nextSeasonSlot,
  SIMULATED_PLAYERS,
} from '@cronista/engine/local';
import { createMemoryStore, createVoyage, type Voyage } from '@cronista/memory-tools';
import { createNarrator } from '@cronista/narrator';

import { scriptedDays } from '../datasets/play-days.ts';
import { loadInventedBible, localKeys, startLocalTracing } from './local-narrator.ts';

const days = Number(process.argv[2] ?? 3);
if (!Number.isInteger(days) || days < 1) throw new Error('Say how many days to play.');

const flush = startLocalTracing('local');
const store = localStore();
const usage: AiUsage[] = [];

// Wraps the real narrator only to add up what each day costs.
const keys = localKeys();
const real = createNarrator({ apiKey: keys.ANTHROPIC_API_KEY, workspace: 'evals' });
const counted = <Input, Result extends { readonly usage: readonly AiUsage[] }>(
  call: (input: Input) => Promise<Result>,
) => {
  return async (input: Input): Promise<Result> => {
    const result = await call(input);
    usage.push(...result.usage);
    return result;
  };
};
// What the day's last resolve recalled, for its report.
let recalled: Memory | undefined;
const narrator: Narrator = {
  situation: counted(real.situation),
  hint: counted(real.hint),
  resolve: counted((input) => {
    recalled = input.memory;
    return real.resolve(input);
  }),
  narrate: counted(real.narrate),
  testAction: counted(real.testAction),
  extractMoments: counted(real.extractMoments),
  compareMoments: counted(real.compareMoments),
};
const realVoyage = createVoyage({ apiKey: keys.VOYAGE_API_KEY, workspace: 'evals' });
const voyage: Voyage = {
  embedDocuments: counted(realVoyage.embedDocuments),
  embedQueries: counted(realVoyage.embedQueries),
  rerank: realVoyage.rerank,
};
const memoryStore = createMemoryStore(localSupabase());
const alert: RaiseAlert = ({ subject, message }) => {
  console.warn(`ALERT ${subject}\n${message}`);
  return Promise.resolve(true);
};
const engine = {
  store,
  narrator,
  memory: { store: memoryStore, voyage },
  loadBible: loadInventedBible,
  alert,
};

/** What a day recalled, as its report shows it. */
const recalledLines = (memory: Memory | undefined) =>
  memory === undefined
    ? []
    : [
        ...memory.characterSheets.flatMap(({ nickname, moments }) =>
          moments.map(({ day, text }) => `- Ficha de ${nickname} (${day}): ${text}`),
        ),
        ...memory.activeJokes.map(
          ({ joke, moment }) => `- Chiste «${joke}» (${moment.day}): ${moment.text}`,
        ),
        ...(memory.earlierSummary === null
          ? []
          : [`- Resumen del ${memory.earlierSummary.day}: ${memory.earlierSummary.summary}`]),
        ...memory.recalled.map(({ day, text }) => `- Recuerdo (${day}): ${text}`),
      ];

const bible = await loadInventedBible(0);
if (!bible.ok) throw new Error('The invented bible does not load.');
const players = bible.value.characters.map(({ nickname }, index) => {
  const player = SIMULATED_PLAYERS[index];
  if (player === undefined)
    throw new Error('The invented bible has more characters than the seed.');
  return { nickname, ...player };
});

const { number, startsOn } = await nextSeasonSlot();
const season = await createSeason(
  { store },
  {
    number,
    startsOn,
    endsOn: addDays(startsOn, days - 1),
    characters: players.map(({ email, nickname }) => ({ email, nickname })),
  },
);
if (!season.ok) throw new Error(`Could not create the season: ${season.error}`);

const runFolder = fileURLToPath(
  new URL(`../results/play-days/season-${String(number)}/`, import.meta.url),
);
await mkdir(runFolder, { recursive: true });

console.log(`Season ${String(number)}, from ${startsOn}, ${String(days)} days.\n`);

let failures = 0;
for (let index = 0; index < days; index += 1) {
  const day = addDays(startsOn, index);
  usage.length = 0;
  recalled = undefined;

  const opened = await openDay({ ...engine, clock: () => gameInstant(day, 8) }, day);
  if (!opened.ok) {
    console.error(`${day}: the day did not open: ${opened.error}`);
    failures += 1;
    break;
  }

  const noon = () => gameInstant(day, 12);
  const script = scriptedDays[index % scriptedDays.length] ?? [];
  const hints: string[] = [];
  for (const { nickname, text, stake } of script) {
    const player = players.find((candidate) => candidate.nickname === nickname);
    if (player === undefined) throw new Error(`Nobody plays ${nickname}.`);
    // A long run can leave a character below what the script stakes, and a player would stake less.
    const canon = await store.canon(season.value, day);
    const character = canon.ok
      ? canon.value.characters.find((candidate) => candidate.nickname === nickname)
      : undefined;
    const allowed = character === undefined || character.out ? 0 : Math.max(character.balance, 0);
    const sent = await submitAction(
      { store, clock: noon },
      { userId: player.userId, action: { text, stake: Math.min(stake, allowed) } },
    );
    if (!sent.ok) throw new Error(`${nickname} could not act: ${sent.error}`);

    const hint = await requestHint({ ...engine, clock: noon }, { userId: player.userId });
    if (!hint.ok) throw new Error(`${nickname} got no hint: ${hint.error}`);
    hints.push(`- **${nickname}**${hint.value.censored ? ' (censor)' : ''}: ${hint.value.text}`);
  }

  const closed = await closeDay({ ...engine, clock: () => gameInstant(day, 22) }, day);
  if (!closed.ok) throw new Error(`The close failed: ${closed.error}`);

  const cost = usage.reduce((total, row) => total + row.costUsd, 0);
  const slowestHint = Math.max(
    0,
    ...usage.filter((row) => row.function === 'hint').map((row) => row.latencyMs),
  );
  const cacheRead = usage.reduce((total, row) => total + row.cacheReadTokens, 0);
  const refusals = usage.filter((row) => row.refusalCategory !== null).length;
  console.log(
    `${day}: ${closed.value.status}${closed.value.status === 'postponed' ? ` (${closed.value.reason})` : ''}, ` +
      `${String(usage.length)} responses, ${cost.toFixed(4)} $, ` +
      `slowest hint ${String(slowestHint)} ms, ${String(cacheRead)} cache read tokens, ` +
      `${String(refusals)} refusals`,
  );
  if (closed.value.status !== 'published') {
    failures += 1;
    break;
  }

  const gameDay = await store.gameDay(season.value, day);
  const chapters = await store.lastChapters(season.value, addDays(day, 1), 1);
  const canon = await store.canon(season.value, addDays(day, 1));
  if (!gameDay.ok || !chapters.ok || !canon.ok) throw new Error('Could not read the day back.');
  const chapter = chapters.value[0];
  const moments = await memoryStore.seasonMoments(season.value, addDays(day, 1));
  const written = moments.ok ? moments.value.filter((moment) => moment.day === day) : [];

  const report = [
    `# ${day}: ${chapter?.title ?? ''}`,
    `## Situación\n\n${gameDay.value?.situation ?? ''}`,
    `## Acciones\n\n${script.map(({ nickname, text, stake }) => `- **${nickname}** (${String(stake)}): ${text}`).join('\n') || 'Nadie ha jugado.'}`,
    `## Pistas\n\n${hints.join('\n') || 'Ninguna.'}`,
    `## Lo que recordó\n\n${recalledLines(recalled).join('\n') || 'Nada.'}`,
    `## Capítulo\n\n${chapter?.body ?? ''}`,
    `## Canon\n\n${canon.value.characters.map(({ nickname, balance, out }) => `- ${nickname}: ${String(balance)}${out ? ', mañana fuera' : ''}`).join('\n')}`,
    `Objetos: ${canon.value.items.map(({ name, owner }) => `${name} (de ${owner})`).join(', ') || 'ninguno'}.`,
    `Deudas: ${canon.value.debts.map(({ debtor, creditor, points }) => `${debtor} debe ${String(points)} a ${creditor}`).join(', ') || 'ninguna'}.`,
    `## Momentos extraídos\n\n${written.map(({ text, importance, joke, current }) => `- (${String(importance)}${joke === null ? '' : `, «${joke}»`}${current ? '' : ', superado'}) ${text}`).join('\n') || 'Ninguno: quedan pendientes.'}`,
    `## Palabras del capítulo\n\n${String(chapter?.body.split(/\s+/).filter(Boolean).length ?? 0)}`,
  ].join('\n\n');
  await writeFile(`${runFolder}day-${String(index + 1)}.md`, `${report}\n`);
}

await flush();
console.log(`\nChapters in ${runFolder}`);
if (failures > 0) process.exitCode = 1;
