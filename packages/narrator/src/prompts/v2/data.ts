import type {
  Canon,
  Finale,
  HintInput,
  NarrateInput,
  NarratorRetry,
  PastChapter,
  ResolutionOutput,
  ResolveInput,
  SituationInput,
  TestActionInput,
} from '@cronista/core';

// Players and everything derived from them are untrusted: nothing they wrote can close a tag or an
// attribute.
const escaped = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

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

const actionBlock = (nickname: string, text: string, stake?: number) => {
  const declared = stake === undefined ? '' : ` declarados="${String(stake)}"`;
  return `<accion personaje="${escaped(nickname)}"${declared}>\n${escaped(text)}\n</accion>`;
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
    `Tu respuesta anterior tenía estos errores. Vuelve a responder entera, sin ellos:\n<errores>\n${lines(retry.issues.map(escaped))}\n</errores>`,
  ];
};

const dayBlocks = (input: ResolveInput) => [
  `Hoy es ${input.day}.`,
  canonBlock(input.canon),
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
  return `<resultado personaje="${escaped(outcome.nickname)}" puntos="${String(outcome.award)}" influencia="${String(outcome.influence)}">\n${body}\n</resultado>`;
};

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

/** The data of a `resolve` request. */
export function resolveData(input: ResolveInput): string {
  return [...dayBlocks(input), ...retryBlock(input.retry)].join('\n\n');
}

/** The data of a `narrate` request: the day and what passed validation. */
export function narrateData(input: NarrateInput): string {
  const outcomes =
    input.resolution.outcomes.length === 0
      ? 'Hoy no hay resultados, porque nadie ha enviado una acción que puedas leer.'
      : input.resolution.outcomes.map(outcomeBlock).join('\n\n');
  return [
    ...dayBlocks(input),
    outcomes,
    ...(input.finale === undefined ? [] : [finaleBlock(input.finale)]),
    ...retryBlock(input.retry),
  ].join('\n\n');
}
