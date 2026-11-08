import { z } from 'zod';

import type { MemoryStoreResult } from './memory-store.ts';
import { type MemoryToolContext, NARRATOR_MEMORY_TOOLS } from './narrator-tools.ts';
import { recall } from './recall.ts';
import {
  defineTool,
  type MemoryToolDefinition,
  oneLine,
  problem,
  type ToolAnswer,
} from './tool-definition.ts';

/** A season's canon as the owner inspects it: what the narrator gets as canon, and its days. */
export interface GameState {
  readonly season: {
    readonly number: number;
    readonly startsOn: string;
    readonly endsOn: string | null;
  };
  /** Each character's balance, and whether it is out on the latest day with a status. */
  readonly characters: readonly {
    readonly nickname: string;
    readonly balance: number;
    readonly out: boolean;
  }[];
  readonly items: readonly { readonly name: string; readonly owner: string }[];
  /** Only the debts still open. */
  readonly debts: readonly {
    readonly debtor: string;
    readonly creditor: string;
    readonly points: number;
  }[];
  /** The season's latest days, newest first. */
  readonly days: readonly { readonly day: string; readonly state: string }[];
}

/** A published chapter, whole. */
export interface PublishedChapter {
  readonly day: string;
  readonly title: string;
  readonly body: string;
  readonly summary: string | null;
}

/** The game's reads that only the owner's inspection needs. */
export interface GameReads {
  readonly gameState: (seasonId: number) => Promise<MemoryStoreResult<GameState>>;
  /** The chapter published on `day`, or `null` when there is none. */
  readonly chapter: (
    seasonId: number,
    day: string,
  ) => Promise<MemoryStoreResult<PublishedChapter | null>>;
}

/** What the inspection tools read with: the memory tools' context, and the game's state. */
export interface InspectionContext extends MemoryToolContext {
  readonly game: GameReads;
}

const unavailable = problem('La base de datos no responde ahora. Vuelve a intentarlo.');

const score = (value: number) => value.toFixed(4);

const rank = (value: number | null) => (value === null ? '—' : `#${String(value)}`);

const memoryExplainRanking = defineTool({
  name: 'memory_explain_ranking',
  description:
    'Busca como memory_search y explica cada puntuación: RRF con su posición en cada lista (vector, texto y nombres), más importancia y recencia, menos el chiste repetido. Para inspeccionar la memoria, no para narrar.',
  input: z
    .object({
      query: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('Qué buscar, como lo buscaría el narrador.'),
      limit: z.number().int().min(1).max(10).default(5).describe('Cuántos resultados (1-10).'),
    })
    .strict(),
  handler: async (context: InspectionContext, input): Promise<ToolAnswer> => {
    const found = await recall(
      { embedQueries: context.embedQueries, search: context.reads.hybridSearch },
      {
        seasonId: context.seasonId,
        day: context.day,
        queries: [input.query],
        excludeDays: context.excludeDays,
        k: input.limit,
      },
    );
    context.recordUsage(found.usage);
    if (!found.ok) {
      return found.error === 'store_unavailable'
        ? unavailable
        : problem(
            'No se ha podido calcular el embedding de la consulta. Revisa la clave de Voyage.',
          );
    }
    if (found.value.length === 0) return { ok: true, lines: ['Nada en la memoria para esto.'] };
    return {
      ok: true,
      lines: found.value.flatMap(
        ({ day, text, characters, joke, source, score: total, breakdown }) => [
          `[${day}] ${source === 'chunks' ? '(fragmento del capítulo) ' : ''}${oneLine(text)}${
            characters.length === 0 ? '' : ` · ${characters.join(', ')}`
          }${joke === null ? '' : ` · «${oneLine(joke)}»`}`,
          `  ${score(total)} = RRF ${score(breakdown.rrf)} (vector ${rank(breakdown.ranks.vector)}, texto ${rank(breakdown.ranks.text)}, nombres ${rank(breakdown.ranks.name)}) · importancia +${score(breakdown.importance)} · recencia +${score(breakdown.recency)} · chiste repetido −${score(breakdown.jokeUse)}`,
        ],
      ),
    };
  },
});

const gameGetState = defineTool({
  name: 'game_get_state',
  description:
    'El canon de la temporada activa: saldos, quién está fuera, objetos, deudas abiertas y los últimos días con su estado.',
  input: z.object({}).strict(),
  handler: async (context: InspectionContext): Promise<ToolAnswer> => {
    const state = await context.game.gameState(context.seasonId);
    if (!state.ok) return unavailable;
    const { season, characters, items, debts, days } = state.value;
    const list = (items: readonly string[], none: string) =>
      items.length === 0 ? [none] : items.map((item) => `- ${item}`);
    return {
      ok: true,
      lines: [
        `Temporada ${String(season.number)}, desde ${season.startsOn}, ${season.endsOn === null ? 'sin fecha de fin' : `hasta ${season.endsOn}`}.`,
        'Saldos:',
        ...list(
          characters.map(
            ({ nickname, balance, out }) =>
              `${nickname}: ${String(balance)} puntos${out ? ', fuera' : ''}`,
          ),
          'Ningún personaje.',
        ),
        'Objetos:',
        ...list(
          items.map(({ name, owner }) => `${oneLine(name)}: de ${owner}`),
          'Ninguno.',
        ),
        'Deudas abiertas:',
        ...list(
          debts.map(
            ({ debtor, creditor, points }) =>
              `${debtor} debe ${String(points)} puntos a ${creditor}`,
          ),
          'Ninguna.',
        ),
        'Últimos días:',
        ...list(
          days.map(({ day, state: dayState }) => `${day}: ${dayState}`),
          'Ninguno.',
        ),
      ],
    };
  },
});

const chapterGet = defineTool({
  name: 'chapter_get',
  description: 'El capítulo publicado un día, entero, con su resumen si ya se extrajo.',
  input: z.object({ day: z.iso.date().describe('El día del capítulo, AAAA-MM-DD.') }).strict(),
  handler: async (context: InspectionContext, input): Promise<ToolAnswer> => {
    const found = await context.game.chapter(context.seasonId, input.day);
    if (!found.ok) return unavailable;
    if (found.value === null) {
      return {
        ok: true,
        lines: [`No hay capítulo publicado el ${input.day} en la temporada activa.`],
      };
    }
    const { title, body, summary } = found.value;
    return {
      ok: true,
      lines: [
        `# ${oneLine(title)}`,
        // Paragraph by paragraph, so that a long chapter is cut at a paragraph, never whole.
        ...body
          .split(/\n\s*\n/)
          .flatMap((paragraph, index) => (index === 0 ? [paragraph] : ['', paragraph])),
        `Resumen: ${summary === null ? 'aún sin extraer.' : oneLine(summary)}`,
      ],
    };
  },
});

/**
 * Every tool of the owner's local MCP server, in its order: the narrator's three, then the three that
 * only inspection needs. All of them read and none writes.
 */
export const MCP_TOOLS: readonly MemoryToolDefinition<InspectionContext>[] = Object.freeze([
  ...NARRATOR_MEMORY_TOOLS,
  memoryExplainRanking,
  gameGetState,
  chapterGet,
]);
