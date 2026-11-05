import type {
  CanonCharacter,
  HintInput,
  NarrateInput,
  PastChapter,
  ResolveInput,
  SituationInput,
} from '@cronista/core';

// Players and everything derived from them are untrusted: nothing they wrote can close a tag or an
// attribute.
const escaped = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const canonBlock = (canon: readonly CanonCharacter[]) =>
  `<canon>\n${canon
    .map(({ nickname, balance }) => `- ${nickname}: ${String(balance)} puntos`)
    .join('\n')}\n</canon>`;

const chaptersBlock = (chapters: readonly PastChapter[]) =>
  chapters.length === 0
    ? 'Todavía no hay capítulos anteriores.'
    : chapters
        .map(
          ({ day, title, body }) =>
            `<capitulo dia="${day}" titulo="${escaped(title)}">\n${escaped(body)}\n</capitulo>`,
        )
        .join('\n\n');

const situationBlock = (situation: string) => `<situacion>\n${escaped(situation)}\n</situacion>`;

const actionBlock = (nickname: string, text: string) =>
  `<accion personaje="${escaped(nickname)}">\n${escaped(text)}\n</accion>`;

const absentBlock = (absent: readonly string[]) =>
  absent.length === 0
    ? 'Hoy no hay personajes ausentes.'
    : `Personajes ausentes: ${absent.join(', ')}.`;

const actionsBlock = (input: ResolveInput) =>
  input.actions.length === 0
    ? 'Hoy nadie ha enviado una acción.'
    : input.actions.map(({ nickname, text }) => actionBlock(nickname, text)).join('\n\n');

/** The data of a `situation` request. */
export function situationData(input: SituationInput): string {
  return [`Hoy es ${input.day}.`, canonBlock(input.canon), chaptersBlock(input.lastChapters)].join(
    '\n\n',
  );
}

/** The data of a `hint` request: the situation, canon and that action, and nothing else. */
export function hintData(input: HintInput): string {
  return [
    situationBlock(input.situation),
    canonBlock(input.canon),
    actionBlock(input.action.nickname, input.action.text),
  ].join('\n\n');
}

/** The data of a `resolve` request. */
export function resolveData(input: ResolveInput): string {
  return [
    `Hoy es ${input.day}.`,
    canonBlock(input.canon),
    chaptersBlock(input.lastChapters),
    situationBlock(input.situation),
    actionsBlock(input),
    absentBlock(input.absent),
  ].join('\n\n');
}

/** The data of a `narrate` request: the day and the outcomes that passed validation. */
export function narrateData(input: NarrateInput): string {
  const outcomes =
    input.resolution.outcomes.length === 0
      ? 'Hoy no hay resultados, porque nadie ha enviado una acción.'
      : input.resolution.outcomes
          .map(
            ({ nickname, summary, award }) =>
              `<resultado personaje="${escaped(nickname)}" puntos="${String(award)}">\n${escaped(summary)}\n</resultado>`,
          )
          .join('\n\n');
  return [resolveData(input), outcomes].join('\n\n');
}
