import type {
  Canon,
  CompareMomentsInput,
  ExtractMomentsInput,
  Finale,
  HintInput,
  Memory,
  NarrateInput,
  NarratorRetry,
  PastChapter,
  RememberedMoment,
  ResolutionOutput,
  ResolveInput,
  SituationInput,
  TestActionInput,
} from '@cronista/core';

// Players and everything derived from them are untrusted: nothing they wrote can close a tag.
const escaped = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Nor an attribute. Quotes stay as they are elsewhere, so that the model copies a name back unchanged.
const escapedAttribute = (text: string) => escaped(text).replaceAll('"', '&quot;');

// A value quoted in a list cannot start a line of its own and pass for another entry of the list.
const oneLine = (text: string) => escaped(text).replace(/\s+/g, ' ');

const lines = (items: readonly string[]) => items.map((item) => `- ${item}`).join('\n');

const canonBlock = ({ characters, items, debts }: Canon) =>
  `<canon>
Saldos:
${lines(characters.map(({ nickname, balance, out }) => `${escaped(nickname)}: ${String(balance)} puntos${out ? ', hoy fuera' : ''}`))}
Objetos:
${items.length === 0 ? 'Ninguno.' : lines(items.map(({ name, owner }) => `${escaped(name)}: de ${escaped(owner)}`))}
Deudas abiertas:
${debts.length === 0 ? 'Ninguna.' : lines(debts.map(({ debtor, creditor, points }) => `${escaped(debtor)} debe ${String(points)} puntos a ${escaped(creditor)}`))}
</canon>`;

/**
 * How far the fixed bundle is trimmed, from none to all of it, in the order it goes when a request is
 * over the context budget: the summary first, then the jokes, then the character sheets.
 */
export const MEMORY_TRIM_LEVELS = 4;

const dated = ({ day, text }: RememberedMoment) => `[${day}] ${oneLine(text)}`;

// The fixed bundle, trimmed to `trim` of MEMORY_TRIM_LEVELS. What retrieval recalled is never trimmed.
const memoryBlocks = (memory: Memory, trim: number) => {
  const parts: string[] = [];
  if (trim < 3 && memory.characterSheets.length > 0) {
    parts.push(
      `Fichas de la temporada:\n${memory.characterSheets
        .map(({ nickname, moments }) => `## ${escaped(nickname)}\n${lines(moments.map(dated))}`)
        .join('\n')}`,
    );
  }
  if (trim < 2 && memory.activeJokes.length > 0) {
    parts.push(
      `Chistes recurrentes:\n${lines(memory.activeJokes.map(({ joke, moment }) => `«${oneLine(joke)}» ${dated(moment)}`))}`,
    );
  }
  if (trim < 1 && memory.earlierSummary !== null) {
    const { day, summary } = memory.earlierSummary;
    parts.push(`Antes de los últimos capítulos, el ${day}:\n${escaped(summary)}`);
  }
  const bundle = parts.length === 0 ? [] : [`<memoria>\n${parts.join('\n\n')}\n</memoria>`];
  const recalled = memory.recalled.map(
    ({ day, text }) => `<recuerdo dia="${day}">\n${escaped(text)}\n</recuerdo>`,
  );
  return [...bundle, ...(recalled.length === 0 ? [] : [recalled.join('\n')])];
};

const chaptersBlock = (chapters: readonly PastChapter[]) =>
  chapters.length === 0
    ? 'Todavía no hay capítulos anteriores.'
    : chapters
        .map(
          ({ day, title, body }) =>
            `<capitulo dia="${day}" titulo="${escapedAttribute(title)}">\n${escaped(body)}\n</capitulo>`,
        )
        .join('\n\n');

const situationBlock = (situation: string) => `<situacion>\n${escaped(situation)}\n</situacion>`;

const actionBlock = (nickname: string, text: string, stake?: number) => {
  const declared = stake === undefined ? '' : ` declarados="${String(stake)}"`;
  return `<accion personaje="${escapedAttribute(nickname)}"${declared}>\n${escaped(text)}\n</accion>`;
};

const absentBlock = (absent: readonly string[]) =>
  absent.length === 0
    ? 'Hoy no hay personajes ausentes.'
    : `Personajes ausentes: ${absent.map(escaped).join(', ')}.`;

const actionsBlock = (input: ResolveInput) =>
  input.actions.length === 0
    ? 'Hoy nadie ha enviado una acción que puedas leer.'
    : input.actions
        .map(({ nickname, text, stake }) => actionBlock(nickname, text, stake))
        .join('\n\n');

const struckOutBlock = (struckOut: readonly string[]) =>
  struckOut.length === 0
    ? []
    : [`Acción tachada por el censor: ${struckOut.map(escaped).join(', ')}.`];

// At the end of what the model reads, so that the start of the request stays cached.
const retryBlock = (retry: NarratorRetry | undefined) => {
  if (retry === undefined) return [];
  if (retry.kind === 'softer') {
    return [
      'Tu respuesta anterior fue rechazada. Escribe lo mismo un punto más suave: los mismos hechos, con menos detalle en lo que pueda resultar delicado.',
    ];
  }
  return [
    `Tu respuesta anterior tenía estos errores. Vuelve a responder entera, sin ellos:\n<errores>\n${lines(retry.issues.map(oneLine))}\n</errores>`,
  ];
};

const dayBlocks = (input: ResolveInput, trim: number) => [
  `Hoy es ${input.day}.`,
  canonBlock(input.canon),
  ...memoryBlocks(input.memory, trim),
  chaptersBlock(input.lastChapters),
  situationBlock(input.situation),
  actionsBlock(input),
  absentBlock(input.absent),
  ...struckOutBlock(input.struckOut),
];

const outcomeBlock = (outcome: ResolutionOutput['outcomes'][number]) => {
  const changes = [
    ...outcome.payments.map(({ to }) => `Paga a ${escaped(to)}.`),
    ...outcome.newItems.map(({ name }) => `Compra ${escaped(name)}.`),
    ...outcome.movedItems.map(
      ({ item, from, to }) => `${escaped(item)} pasa de ${escaped(from)} a ${escaped(to)}.`,
    ),
    ...outcome.newDebts.map(({ creditor }) => `Queda a deber a ${escaped(creditor)}.`),
    ...outcome.paidDebts.map(({ creditor }) => `Salda su deuda con ${escaped(creditor)}.`),
    ...outcome.outCharacters.map((nickname) => `${escaped(nickname)} pasa mañana el día fuera.`),
  ];
  const body = [escaped(outcome.summary), ...changes].join('\n');
  return `<resultado personaje="${escapedAttribute(outcome.nickname)}" puntos="${String(outcome.award)}" influencia="${String(outcome.influence)}">\n${body}\n</resultado>`;
};

const droppedBlock = (dropped: readonly string[]) =>
  dropped.length === 0 ? [] : [`<descartado>\n${lines(dropped.map(oneLine))}\n</descartado>`];

const finaleBlock = ({ winners, balances }: Finale) =>
  `<final>\nGanan: ${winners.map(escaped).join(', ')}.\nSaldos finales:\n${lines(balances.map(({ nickname, balance }) => `${escaped(nickname)}: ${String(balance)} puntos`))}\n</final>`;

/** The data of a `situation` request. */
export function situationData(input: SituationInput): string {
  return [
    `Hoy es ${input.day}.`,
    canonBlock(input.canon),
    chaptersBlock(input.lastChapters),
    ...retryBlock(input.retry),
  ].join('\n\n');
}

/** The data of a `hint` request: the situation, canon and that action, and nothing else. */
export function hintData(input: HintInput): string {
  return [
    situationBlock(input.situation),
    canonBlock(input.canon),
    actionBlock(input.action.nickname, input.action.text),
  ].join('\n\n');
}

/** The data of a `testAction` request: that action alone, with no other player's text. */
export function testActionData(input: TestActionInput): string {
  return [
    situationBlock(input.situation),
    actionBlock(input.action.nickname, input.action.text),
  ].join('\n\n');
}

/**
 * The data of a `resolve` request.
 *
 * @param trim - How much of the fixed bundle to leave out, from 0 to {@link MEMORY_TRIM_LEVELS} - 1.
 */
export function resolveData(input: ResolveInput, trim = 0): string {
  return [...dayBlocks(input, trim), ...retryBlock(input.retry)].join('\n\n');
}

/**
 * The data of a `narrate` request: the day and what passed validation.
 *
 * @param trim - How much of the fixed bundle to leave out, from 0 to {@link MEMORY_TRIM_LEVELS} - 1.
 */
export function narrateData(input: NarrateInput, trim = 0): string {
  const outcomes =
    input.resolution.outcomes.length === 0
      ? 'Hoy no hay resultados, porque nadie ha enviado una acción que puedas leer.'
      : input.resolution.outcomes.map(outcomeBlock).join('\n\n');
  return [
    ...dayBlocks(input, trim),
    outcomes,
    ...droppedBlock(input.dropped),
    ...(input.finale === undefined ? [] : [finaleBlock(input.finale)]),
    ...retryBlock(input.retry),
  ].join('\n\n');
}

/** The data of an `extractMoments` request: the published chapter, the nicknames and the jokes. */
export function extractMomentsData(input: ExtractMomentsInput): string {
  return [
    `Personajes: ${input.characters.length === 0 ? 'ninguno' : input.characters.map(escaped).join(', ')}.`,
    input.jokes.length === 0
      ? 'Todavía no hay chistes recurrentes.'
      : `Chistes recurrentes:\n${lines(input.jokes.map((joke) => `«${oneLine(joke)}»`))}`,
    chaptersBlock([input.chapter]),
    ...retryBlock(input.retry),
  ].join('\n\n');
}

/** The data of a `compareMoments` request: each new moment, numbered, with its nearest. */
export function compareMomentsData(input: CompareMomentsInput): string {
  const moments = input.moments.map(({ text, nearest }, index) => {
    const near =
      nearest.length === 0
        ? 'Sin recuerdos cercanos.'
        : nearest
            .map(
              ({ id, day, text: known }) =>
                `<cercano id="${String(id)}" dia="${day}">${oneLine(known)}</cercano>`,
            )
            .join('\n');
    return `<nuevo n="${String(index + 1)}">\n${escaped(text)}\n${near}\n</nuevo>`;
  });
  return [`Hoy es ${input.day}.`, ...moments, ...retryBlock(input.retry)].join('\n\n');
}
