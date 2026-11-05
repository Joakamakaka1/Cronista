import { createMemoryStore, recall, type RankingWeights } from '@cronista/memory-tools';
import { GOLDEN_MOMENTS, GOLDEN_QUERIES, goldenEmbeddings } from '@cronista/memory-tools/golden';

import { localSupabase } from '../src/local.ts';
import { addDays, newSeason, store } from './support.ts';

/** How long the golden season is, in days. */
const GOLDEN_DAYS = Math.max(...GOLDEN_MOMENTS.map(({ dayIndex }) => dayIndex)) + 1;

const memoryStore = createMemoryStore(localSupabase());

const emptyPublication = {
  awards: [],
  struckOut: [],
  charges: [],
  newItems: [],
  movedItems: [],
  newDebts: [],
  paidDebts: [],
  outCharacters: [],
};

/**
 * Plays the golden season into the local database: a published chapter per day, with that day's
 * moments and their cached embeddings. It answers the season and the day that asks the queries.
 */
export async function seedGoldenSeason(): Promise<{
  readonly seasonId: number;
  readonly askedOn: string;
}> {
  const { documents } = goldenEmbeddings();
  const { seasonId, day: startsOn } = await newSeason(5, GOLDEN_DAYS + 5);
  for (let index = 0; index < GOLDEN_DAYS; index += 1) {
    const day = addDays(startsOn, index);
    const opened = await store.openGameDay(seasonId, day, 'Situación.');
    if (!opened.ok) throw new Error(`The golden day did not open: ${opened.error}`);
    const { gameDayId } = opened.value;
    await store.beginClose(gameDayId);
    const published = await store.publishChapter(
      gameDayId,
      { title: 'Capítulo', body: 'Pasó.' },
      emptyPublication,
    );
    if (!published.ok) throw new Error(`The golden day was not published: ${published.error}`);

    const stored = await memoryStore.storeMoments(
      gameDayId,
      'Resumen.',
      GOLDEN_MOMENTS.filter(({ dayIndex }) => dayIndex === index).map((moment) => ({
        text: moment.text,
        characters: moment.characters,
        joke: moment.joke,
        importance: moment.importance,
        embedding: documents.get(moment.key) ?? [],
        supersedes: null,
      })),
    );
    if (!stored.ok) throw new Error(`The golden moments were not stored: ${stored.error}`);
  }
  return { seasonId, askedOn: addDays(startsOn, GOLDEN_DAYS) };
}

/** Recall at 10 and MRR of the golden queries, through 
ecall, as the close retrieves. */
export interface GoldenScore {
  readonly recallAt10: number;
  readonly mrr: number;
  /** The queries that missed a relevant moment in their top 10. */
  readonly misses: readonly string[];
}

/** Asks every golden query on a seeded season and scores what retrieval answers. */
export async function scoreGoldenSet(
  season: { readonly seasonId: number; readonly askedOn: string },
  weights?: RankingWeights,
): Promise<GoldenScore> {
  const { queries } = goldenEmbeddings();
  const keyOf = new Map(GOLDEN_MOMENTS.map(({ key, text }) => [text, key]));
  const queryVector = new Map(
    GOLDEN_QUERIES.map(({ key, text }) => [text, queries.get(key) ?? []]),
  );

  let recallTotal = 0;
  let reciprocalTotal = 0;
  const misses: string[] = [];
  for (const query of GOLDEN_QUERIES) {
    const found = await recall(
      {
        embedQueries: (texts) =>
          Promise.resolve({
            ok: true,
            value: texts.map((text) => queryVector.get(text) ?? []),
            usage: [],
          }),
        search: memoryStore.hybridSearch,
        ...(weights === undefined ? {} : { weights }),
      },
      {
        seasonId: season.seasonId,
        day: season.askedOn,
        queries: [query.text],
        excludeDays: [],
        k: 10,
      },
    );
    if (!found.ok) throw new Error(`Retrieval failed: ${found.error}`);

    const keys = found.value.map(({ text }) => keyOf.get(text));
    const hits = query.relevant.filter((key) => keys.includes(key));
    recallTotal += hits.length / query.relevant.length;
    const first = keys.findIndex((key) => key !== undefined && query.relevant.includes(key));
    reciprocalTotal += first === -1 ? 0 : 1 / (first + 1);
    if (hits.length < query.relevant.length) misses.push(query.key);
  }
  return {
    recallAt10: recallTotal / GOLDEN_QUERIES.length,
    mrr: reciprocalTotal / GOLDEN_QUERIES.length,
    misses,
  };
}
