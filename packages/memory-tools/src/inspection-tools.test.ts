import type { HybridSearchRow } from '@cronista/core';
import { describe, expect, it } from 'vitest';

import { type GameReads, type InspectionContext, MCP_TOOLS } from './inspection-tools.ts';
import { bindMemoryTools } from './tool-definition.ts';

const row = (id: number, fields: Partial<HybridSearchRow> = {}): HybridSearchRow => ({
  id,
  day: '2031-01-09',
  content: `Momento ${String(id)}.`,
  characters: ['La Farera'],
  joke: 'el faro',
  importance: 5,
  joke_last_day: '2031-01-09',
  vector_rank: 1,
  text_rank: null,
  name_rank: 2,
  rrf_score: 0.0384,
  ...fields,
});

function toolsWith(game: Partial<GameReads> = {}) {
  const context: InspectionContext = {
    seasonId: 7,
    day: '2031-01-10',
    characters: ['La Farera', 'El Notario'],
    excludeDays: [],
    embedQueries: (texts) =>
      Promise.resolve({ ok: true, value: texts.map(() => [0.1]), usage: [] }),
    recordUsage: () => undefined,
    reads: {
      hybridSearch: () => Promise.resolve({ ok: true, value: [row(1)] }),
      seasonMoments: () => Promise.resolve({ ok: true, value: [] }),
      chapterSummaries: () => Promise.resolve({ ok: true, value: { summaries: [], total: 0 } }),
    },
    game: {
      gameState: () =>
        Promise.resolve({
          ok: true,
          value: {
            season: { number: 0, startsOn: '2031-01-01', endsOn: null },
            characters: [
              { nickname: 'La Farera', balance: 12, out: false },
              { nickname: 'El Notario', balance: 7, out: true },
            ],
            items: [{ name: 'La llave <del faro>', owner: 'El Notario' }],
            debts: [{ debtor: 'La Farera', creditor: 'El Notario', points: 3 }],
            days: [{ day: '2031-01-09', state: 'published' }],
          },
        }),
      chapter: (_seasonId, day) =>
        Promise.resolve({
          ok: true,
          value:
            day === '2031-01-09'
              ? { day, title: 'El faro', body: 'Párrafo uno.\n\nPárrafo dos.', summary: 'Resumen.' }
              : null,
        }),
      ...game,
    },
  };
  const tools = bindMemoryTools(MCP_TOOLS, context);
  const run = (name: string, input: unknown) => {
    const found = tools.find((tool) => tool.name === name);
    if (found === undefined) throw new Error(`No tool ${name}`);
    return found.run(input);
  };
  return { tools, run };
}

describe('the MCP tools', () => {
  it('are the narrator tools, then the three for inspection, in a fixed order', () => {
    expect(toolsWith().tools.map(({ name }) => name)).toEqual([
      'memory_search',
      'memory_get_character',
      'memory_timeline',
      'memory_explain_ranking',
      'game_get_state',
      'chapter_get',
    ]);
  });
});

describe('memory_explain_ranking', () => {
  it('breaks each score into its parts and the rank in each list', async () => {
    const text = await toolsWith().run('memory_explain_ranking', { query: 'faro' });

    expect(text).toMatch(/^<datos_herramienta herramienta="memory_explain_ranking">/);
    expect(text).toContain('[2031-01-09] Momento 1. · La Farera · «el faro»');
    expect(text).toMatch(/RRF 0\.0384 \(vector #1, texto —, nombres #2\)/);
    expect(text).toMatch(/importancia \+0\.00\d+/);
    expect(text).toMatch(/recencia \+0\.00\d+/);
    expect(text).toMatch(/chiste repetido −0\.00\d+/);
  });
});

describe('game_get_state', () => {
  it('shows balances, who is out, items, open debts and days, with what is untrusted escaped', async () => {
    const text = await toolsWith().run('game_get_state', {});

    expect(text).toContain('Temporada 0, desde 2031-01-01, sin fecha de fin');
    expect(text).toContain('- La Farera: 12 puntos');
    expect(text).toContain('- El Notario: 7 puntos, fuera');
    expect(text).toContain('- La llave &lt;del faro&gt;: de El Notario');
    expect(text).toContain('- La Farera debe 3 puntos a El Notario');
    expect(text).toContain('- 2031-01-09: published');
  });
});

describe('chapter_get', () => {
  it('answers a published chapter whole', async () => {
    const text = await toolsWith().run('chapter_get', { day: '2031-01-09' });

    expect(text).toContain('# El faro');
    expect(text).toContain('Párrafo uno.\n\nPárrafo dos.');
    expect(text).toContain('Resumen: Resumen.');
  });

  it('says so when that day has no published chapter', async () => {
    const text = await toolsWith().run('chapter_get', { day: '2031-01-05' });
    expect(text).toContain('No hay capítulo publicado el 2031-01-05');
  });

  it('explains a day that is not a date', async () => {
    const text = await toolsWith().run('chapter_get', { day: 'ayer' });
    expect(text).toContain('Entrada no válida');
  });
});
