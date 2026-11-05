/** What a player reads when the model refuses their hint. Players see this text. */
export const HINT_CENSOR_LINE = 'Tu pista ha sido tachada por el censor del periódico.';

/**
 * The situation that opens a day when the narrator cannot write one. It has to fit any season's
 * world, so it names nothing from a bible. Players see this text.
 */
export const RESERVE_SITUATION =
  'El periódico sale hoy con la portada en blanco: la redacción no ha conseguido una sola noticia a tiempo. Mientras se aclara qué ha pasado, el día es vuestro. Haced algo que merezca ocupar esa portada.';

/** What players read while a chapter is postponed. Players see this text. */
export const POSTPONED_CHAPTER_MESSAGE =
  'El periódico no ha salido esta noche: el capítulo de hoy sigue en la imprenta. Mientras tanto nadie gana ni pierde nada, y el siguiente día no abrirá hasta que salga.';

/**
 * The paragraph code adds to a chapter with struck-out actions, so that it is there whatever the model
 * wrote. It names who and never what. Players see this text.
 *
 * @param nicknames - The characters whose actions were struck out, at least one.
 */
export function censorParagraph(nicknames: readonly string[]): string {
  if (nicknames.length === 1) {
    return `La acción de ${nicknames.join('')} ha sido tachada por el censor del periódico.`;
  }
  const all = `${nicknames.slice(0, -1).join(', ')} y ${nicknames.at(-1) ?? ''}`;
  return `Las acciones de ${all} han sido tachadas por el censor del periódico.`;
}
