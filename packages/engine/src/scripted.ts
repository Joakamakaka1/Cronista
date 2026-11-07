/**
 * Scripted stand-ins for the models: a `Narrator` with fixed answers, a deterministic embedder and
 * an invented bible. The integration tests and the web app's local harness share them, so a local
 * game day costs nothing. No side effects on import.
 *
 * @packageDocumentation
 */
import {
  type AiUsage,
  type Bible,
  EMBEDDING_DIMENSIONS,
  type Narrator,
  type NarratorFunction,
  type ResolutionOutput,
} from '@cronista/core';
import type { Voyage } from '@cronista/memory-tools';

import type { LoadBible } from './load-bible.ts';

/**
 * A deterministic stand-in for Voyage: each word lands on one axis, so texts that share words are
 * near. Only the model is faked; the memory tables are the local database's.
 */
export function wordsEmbedder(): Voyage & { readonly calls: string[][] } {
  const calls: string[][] = [];
  const embed = (texts: readonly string[]) => {
    calls.push([...texts]);
    return texts.map((text) => {
      const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
      for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
        let hash = 0;
        for (const char of word) {
          hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % (EMBEDDING_DIMENSIONS - 1);
        }
        vector[hash + 1] = (vector[hash + 1] ?? 0) + 1;
      }
      // Never the zero vector, which has no direction.
      vector[0] = 0.01;
      return vector;
    });
  };
  const usage = (name: 'embed_documents' | 'embed_query') => [
    { ...usageOf('resolve'), function: name },
  ];
  return {
    calls,
    embedDocuments: (texts) =>
      Promise.resolve({ ok: true, value: embed(texts), usage: usage('embed_documents') }),
    embedQueries: (texts) =>
      Promise.resolve({ ok: true, value: embed(texts), usage: usage('embed_query') }),
    rerank: (_query, documents, topK) =>
      Promise.resolve({
        ok: true,
        value: documents.map((_, index) => index).slice(0, topK),
        usage: [],
      }),
  };
}

/** The nicknames of the invented characters, in the order of the seed's players. */
export const INVENTED_NICKNAMES = [
  'La Farera',
  'El Notario',
  'La Boticaria',
  'El Sacristán',
  'La Alcaldesa',
] as const;

/** An invented bible for the season's first `count` characters. */
export function inventedBible(count = 5): Bible {
  return {
    world: 'Un pueblo costero inventado.',
    tone: 'Crónica de sucesos.',
    toneExamples: ['El alcalde perdió la llave.'],
    redLines: [],
    characters: INVENTED_NICKNAMES.slice(0, count).map((nickname) => ({
      nickname,
      sheet: `Ficha de ${nickname}.`,
      redLines: [],
    })),
  };
}

/** A bible loader that always answers with the invented bible. */
export function bibleLoader(count = 5): LoadBible {
  return () => Promise.resolve({ ok: true, value: inventedBible(count) });
}

/** One outcome of a resolution, with nothing charged and no canon change unless a test says so. */
export function outcomeOf(
  nickname: string,
  fields: Partial<ResolutionOutput['outcomes'][number]> = {},
): ResolutionOutput['outcomes'][number] {
  return {
    nickname,
    summary: 'Le sale bien.',
    award: 2,
    influence: 0,
    payments: [],
    newItems: [],
    movedItems: [],
    newDebts: [],
    paidDebts: [],
    outCharacters: [],
    ...fields,
  };
}

/** One invented ledger row for a scripted response. */
export function usageOf(name: NarratorFunction, refusalCategory: string | null = null): AiUsage {
  return {
    workspace: 'dev',
    function: name,
    promptVersion: 'scripted',
    model: 'scripted',
    inputTokens: 100,
    cacheReadTokens: 20,
    cacheWriteTokens: 10,
    outputTokens: 50,
    costUsd: 0.0001,
    latencyMs: 5,
    refusalCategory,
  };
}

/** A `Narrator` with fixed answers that records what it was asked. Only the model is faked. */
export function scriptedNarrator(overrides: Partial<Narrator> = {}) {
  const calls = {
    situation: [] as Parameters<Narrator['situation']>[0][],
    hint: [] as Parameters<Narrator['hint']>[0][],
    resolve: [] as Parameters<Narrator['resolve']>[0][],
    narrate: [] as Parameters<Narrator['narrate']>[0][],
    testAction: [] as Parameters<Narrator['testAction']>[0][],
    extractMoments: [] as Parameters<Narrator['extractMoments']>[0][],
    compareMoments: [] as Parameters<Narrator['compareMoments']>[0][],
  };
  const narrator: Narrator = {
    situation: (input) => {
      calls.situation.push(input);
      return (
        overrides.situation?.(input) ??
        Promise.resolve({
          ok: true,
          value: { text: `Situación del ${input.day}.` },
          usage: [usageOf('situation')],
        })
      );
    },
    hint: (input) => {
      calls.hint.push(input);
      return (
        overrides.hint?.(input) ??
        Promise.resolve({
          ok: true,
          value: { text: `Pista para ${input.action.nickname}.` },
          usage: [usageOf('hint')],
        })
      );
    },
    resolve: (input) => {
      calls.resolve.push(input);
      return (
        overrides.resolve?.(input) ??
        Promise.resolve({
          ok: true,
          value: { outcomes: input.actions.map(({ nickname }) => outcomeOf(nickname)) },
          usage: [usageOf('resolve')],
        })
      );
    },
    narrate: (input) => {
      calls.narrate.push(input);
      return (
        overrides.narrate?.(input) ??
        Promise.resolve({
          ok: true,
          value: {
            title: `Capítulo del ${input.day}`,
            body: 'Pasó lo que pasó.',
            pullQuote: 'Pasó lo que pasó.',
          },
          usage: [usageOf('narrate')],
        })
      );
    },
    testAction: (input) => {
      calls.testAction.push(input);
      return (
        overrides.testAction?.(input) ??
        Promise.resolve({
          ok: true,
          value: { text: 'Lo intenta.' },
          usage: [usageOf('test_action')],
        })
      );
    },
    // Five moments that each carry the chapter's text, so that a later day can find them.
    extractMoments: (input) => {
      calls.extractMoments.push(input);
      return (
        overrides.extractMoments?.(input) ??
        Promise.resolve({
          ok: true,
          value: {
            summary: `Resumen del ${input.chapter.day}.`,
            moments: [1, 2, 3, 4, 5].map((part) => ({
              text: `${input.chapter.body} (${String(part)})`,
              characters: [],
              importance: 3,
              joke: null,
            })),
          },
          usage: [usageOf('extract_moments')],
        })
      );
    },
    compareMoments: (input) => {
      calls.compareMoments.push(input);
      return (
        overrides.compareMoments?.(input) ??
        Promise.resolve({
          ok: true,
          value: {
            decisions: input.moments.map((_, index) => ({
              moment: index + 1,
              decision: 'ADD' as const,
              target: null,
            })),
          },
          usage: [usageOf('compare_moments')],
        })
      );
    },
  };
  return { narrator, calls };
}
