import type { AiUsage, ChapterSummary } from '@cronista/core';
import { z } from 'zod';

import type { MemoryStore, MemoryStoreResult, SeasonMoment } from './memory-store.ts';
import { recall } from './recall.ts';
import {
  defineTool,
  type MemoryToolDefinition,
  oneLine,
  problem,
  type ToolAnswer,
  type ToolProblem,
} from './tool-definition.ts';
import type { Voyage } from './voyage.ts';

/** A page of published chapter summaries, oldest first, and how many the range holds. */
export interface SummaryPage {
  readonly summaries: readonly ChapterSummary[];
  readonly total: number;
}

/** The reads the memory tools need, over the Data API in the Lambdas or Postgres in the MCP server. */
export interface MemoryReads {
  readonly hybridSearch: MemoryStore['hybridSearch'];
  readonly seasonMoments: MemoryStore['seasonMoments'];
  /** Summaries of chapters published from `from` (or the start) up to the day before `before`. */
  readonly chapterSummaries: (
    seasonId: number,
    range: {
      readonly from: string | null;
      readonly before: string;
      readonly limit: number;
      readonly offset: number;
    },
  ) => Promise<MemoryStoreResult<SummaryPage>>;
}

/** The day the tools answer about, and what they read with. */
export interface MemoryToolContext {
  readonly seasonId: number;
  /** Today: the tools only read what happened before it. */
  readonly day: string;
  /** The season's nicknames, the only valid `character_id` values. */
  readonly characters: readonly string[];
  /** Days the reader already has in full, which a search leaves out. */
  readonly excludeDays: readonly string[];
  readonly reads: MemoryReads;
  readonly embedQueries: Voyage['embedQueries'];
  /** Where what the tools spend goes, so that it reaches the ledger. */
  readonly recordUsage: (usage: readonly AiUsage[]) => void;
}

// -----------------------------------------------------------------------------
// Shared pieces
// -----------------------------------------------------------------------------

const characterId = z
  .string()
  .describe('El apodo exacto del personaje, tal como lo escribe el canon (p. ej. "La Farera").');

const page = (defaultLimit: number, maxLimit: number) => ({
  limit: z
    .number()
    .int()
    .min(1)
    .max(maxLimit)
    .default(defaultLimit)
    .describe(`Cuántos resultados (1-${String(maxLimit)}).`),
  offset: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(0)
    .describe('Cuántos saltar, para pasar página.'),
});

const unknownCharacter = (context: MemoryToolContext, nickname: string): ToolProblem | undefined =>
  context.characters.includes(nickname)
    ? undefined
    : problem(
        `No hay ningún personaje "${oneLine(nickname)}" esta temporada. Usa el apodo exacto: ${context.characters.join(', ')}.`,
      );

const unavailable = problem('La memoria no responde ahora. Sigue con lo que ya sabes.');

const moreHint = (shown: number, offset: number, hasMore: boolean) =>
  hasMore ? [`Hay más: vuelve a llamar con offset: ${String(offset + shown)}.`] : [];

const nothing = ['Nada en la memoria para esto.'];

const characterSuffix = (characters: readonly string[]) =>
  characters.length === 0 ? '' : ` · ${characters.join(', ')}`;

const jokeSuffix = (joke: string | null) => (joke === null ? '' : ` · «${oneLine(joke)}»`);

// -----------------------------------------------------------------------------
// The tools
// -----------------------------------------------------------------------------

const memorySearch = defineTool({
  name: 'memory_search',
  description:
    'Busca en la memoria de la temporada momentos de días anteriores parecidos a una consulta. Úsala cuando una acción o la situación aluda a algo pasado que no está en tus fichas ni en los capítulos completos. Devuelve una línea por momento: [día] texto · personajes · «chiste». El canon manda sobre lo que encuentres.',
  input: z
    .object({
      query: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('Qué buscar, en pocas palabras: un hecho, un objeto, un chiste.'),
      character_id: characterId.optional(),
      ...page(5, 10),
    })
    .strict(),
  handler: async (context: MemoryToolContext, input): Promise<ToolAnswer> => {
    const nickname = input.character_id;
    if (nickname !== undefined) {
      const unknown = unknownCharacter(context, nickname);
      if (unknown !== undefined) return unknown;
    }
    const wanted = input.offset + input.limit + 1;
    // A character's moments are a slice of the ranking, so it searches deeper before keeping them.
    const k = nickname === undefined ? wanted : Math.min(60, wanted * 4);
    const found = await recall(
      { embedQueries: context.embedQueries, search: context.reads.hybridSearch },
      {
        seasonId: context.seasonId,
        day: context.day,
        queries: [input.query],
        excludeDays: context.excludeDays,
        k,
      },
    );
    context.recordUsage(found.usage);
    if (!found.ok) {
      return found.error === 'store_unavailable'
        ? unavailable
        : problem('No se ha podido buscar ahora. Sigue con lo que ya sabes.');
    }
    const kept =
      nickname === undefined
        ? found.value
        : found.value.filter(({ source, characters, text }) =>
            source === 'moments' ? characters.includes(nickname) : text.includes(nickname),
          );
    const shown = kept.slice(input.offset, input.offset + input.limit);
    if (shown.length === 0) return { ok: true, lines: nothing };
    return {
      ok: true,
      lines: [
        ...shown.map(({ day, text, characters, joke, source }) =>
          source === 'chunks'
            ? `[${day}] (fragmento del capítulo) ${oneLine(text)}`
            : `[${day}] ${oneLine(text)}${characterSuffix(characters)}${jokeSuffix(joke)}`,
        ),
        ...moreHint(shown.length, input.offset, kept.length > input.offset + input.limit),
      ],
    };
  },
});

const byImportanceThenNewest = (first: SeasonMoment, second: SeasonMoment) =>
  second.importance - first.importance ||
  second.day.localeCompare(first.day) ||
  second.id - first.id;

const memoryGetCharacter = defineTool({
  name: 'memory_get_character',
  description:
    'Los momentos vigentes de un personaje en días anteriores, del más importante al menos. Úsala para recordar qué ha hecho alguien más allá de su ficha. Devuelve una línea por momento: [día] texto · con quién · «chiste».',
  input: z.object({ character_id: characterId, ...page(5, 10) }).strict(),
  handler: async (context: MemoryToolContext, input): Promise<ToolAnswer> => {
    const unknown = unknownCharacter(context, input.character_id);
    if (unknown !== undefined) return unknown;
    const moments = await context.reads.seasonMoments(context.seasonId, context.day);
    if (!moments.ok) return unavailable;
    const theirs = moments.value
      .filter(({ current, characters }) => current && characters.includes(input.character_id))
      .sort(byImportanceThenNewest);
    const shown = theirs.slice(input.offset, input.offset + input.limit);
    if (shown.length === 0) return { ok: true, lines: nothing };
    return {
      ok: true,
      lines: [
        `Momentos vigentes de ${input.character_id} (${String(theirs.length)} en total):`,
        ...shown.map(
          ({ day, text, characters, joke }) =>
            `[${day}] ${oneLine(text)}${characterSuffix(characters.filter((name) => name !== input.character_id))}${jokeSuffix(joke)}`,
        ),
        ...moreHint(shown.length, input.offset, theirs.length > input.offset + input.limit),
      ],
    };
  },
});

const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const memoryTimeline = defineTool({
  name: 'memory_timeline',
  description:
    'Los resúmenes de los capítulos publicados en días anteriores, del más antiguo al más reciente. Úsala para situar cuándo pasó algo o repasar un tramo de la temporada. Devuelve una línea por día: [día] resumen.',
  input: z
    .object({
      from_day: z.iso
        .date()
        .optional()
        .describe('Primer día, AAAA-MM-DD. Sin él, desde el principio.'),
      to_day: z.iso.date().optional().describe('Último día, AAAA-MM-DD. Sin él, hasta ayer.'),
      ...page(7, 14),
    })
    .strict(),
  handler: async (context: MemoryToolContext, input): Promise<ToolAnswer> => {
    const after = input.to_day === undefined ? context.day : nextDay(input.to_day);
    const found = await context.reads.chapterSummaries(context.seasonId, {
      from: input.from_day ?? null,
      before: after < context.day ? after : context.day,
      limit: input.limit,
      offset: input.offset,
    });
    if (!found.ok) return unavailable;
    const { summaries, total } = found.value;
    if (summaries.length === 0) return { ok: true, lines: nothing };
    return {
      ok: true,
      lines: [
        ...summaries.map(({ day, summary }) => `[${day}] ${oneLine(summary)}`),
        ...moreHint(summaries.length, input.offset, input.offset + summaries.length < total),
      ],
    };
  },
});

/**
 * The tools the narrator may call while it writes a chapter, in the order it receives them. Their
 * order and definitions stay fixed: any change invalidates the whole prompt cache.
 */
export const NARRATOR_MEMORY_TOOLS: readonly MemoryToolDefinition<MemoryToolContext>[] =
  Object.freeze([memorySearch, memoryGetCharacter, memoryTimeline]);
