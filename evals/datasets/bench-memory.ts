import type { ChapterSummary, HybridSearchRow, NarratorTool } from '@cronista/core';
import {
  bindMemoryTools,
  type MemoryReads,
  NARRATOR_MEMORY_TOOLS,
  type SeasonMoment,
} from '@cronista/memory-tools';

/**
 * The invented season the bench's chapters can look up: earlier days of Villaescollo, with one fact
 * that only the tools reach, the chest of the shipwreck.
 */
const moments: readonly SeasonMoment[] = [
  {
    id: 1,
    day: '2031-02-12',
    text: 'El día del naufragio, El Sacristán guardó en el arcón de la sacristía un catalejo de latón y juró no usarlo hasta que el faro volviera a encenderse.',
    characters: ['El Sacristán'],
    joke: null,
    importance: 4,
    current: true,
  },
  {
    id: 2,
    day: '2031-02-15',
    text: 'La Alcaldesa inauguró por tercera vez el puerto nuevo, que sigue sin barcos.',
    characters: ['La Alcaldesa'],
    joke: 'el puerto nuevo sin barcos',
    importance: 3,
    current: true,
  },
  {
    id: 3,
    day: '2031-02-18',
    text: 'La Farera apuntó en su cuaderno un barco que no pasó, y lo tachó al día siguiente.',
    characters: ['La Farera'],
    joke: 'el cuaderno de barcos que no pasan',
    importance: 2,
    current: true,
  },
  {
    id: 4,
    day: '2031-02-20',
    text: 'La Boticaria juró ante el pleno que nunca más vendería infusiones en una cola municipal.',
    characters: ['La Boticaria'],
    joke: null,
    importance: 4,
    current: true,
  },
  {
    id: 5,
    day: '2031-02-24',
    text: 'El Notario se declaró dueño de las teclas negras con un acta firmada por él mismo.',
    characters: ['El Notario'],
    joke: null,
    importance: 3,
    current: false,
  },
];

const summaries: readonly ChapterSummary[] = [
  {
    day: '2031-02-12',
    summary:
      'Un temporal hundió un mercante frente al faro apagado. El pueblo rescató cajas, y El Sacristán se llevó algo al arcón sin decir qué.',
  },
  {
    day: '2031-02-15',
    summary: 'La Alcaldesa inauguró el puerto nuevo otra vez. Ningún barco vino a verlo.',
  },
  {
    day: '2031-02-20',
    summary: 'Un pleno sobre infusiones acabó con un juramento de La Boticaria.',
  },
];

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-zñ]+/)
      .filter((word) => word.length > 3),
  );

/** The season's memory as the tools read it, with a word-overlap search in place of embeddings. */
const reads: MemoryReads = {
  hybridSearch: (search) => {
    const asked = words(search.query);
    const rows: HybridSearchRow[] = moments
      .filter(({ current }) => search.source === 'moments' && current)
      .filter(({ day }) => !search.excludeDays.includes(day))
      .map((moment) => ({
        moment,
        overlap: [...words(moment.text)].filter((word) => asked.has(word)).length,
      }))
      .filter(({ overlap }) => overlap > 0)
      .sort((first, second) => second.overlap - first.overlap)
      .slice(0, search.count)
      .map(({ moment }, rank) => ({
        id: moment.id,
        day: moment.day,
        content: moment.text,
        characters: [...moment.characters],
        joke: moment.joke,
        importance: moment.importance,
        joke_last_day: null,
        vector_rank: null,
        text_rank: rank + 1,
        name_rank: null,
        rrf_score: 1 / (50 + rank + 1),
      }));
    return Promise.resolve({ ok: true, value: rows });
  },
  seasonMoments: (_seasonId, before) =>
    Promise.resolve({ ok: true, value: moments.filter(({ day }) => day < before) }),
  chapterSummaries: (_seasonId, { from, before, limit, offset }) => {
    const inRange = summaries.filter(({ day }) => day < before && (from === null || day >= from));
    return Promise.resolve({
      ok: true,
      value: { summaries: inRange.slice(offset, offset + limit), total: inRange.length },
    });
  },
};

/** The narrator's memory tools over the invented season, as a chapter of `day` gets them. */
export function inventedMemoryTools(
  day: string,
  characters: readonly string[],
  excludeDays: readonly string[],
): NarratorTool[] {
  return bindMemoryTools(NARRATOR_MEMORY_TOOLS, {
    seasonId: 0,
    day,
    characters,
    excludeDays,
    reads,
    // The bench's search matches words, so no query is embedded and nothing is spent.
    embedQueries: (texts) => Promise.resolve({ ok: true, value: texts.map(() => []), usage: [] }),
    recordUsage: () => undefined,
  });
}
