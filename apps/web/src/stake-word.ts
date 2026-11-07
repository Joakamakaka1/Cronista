/**
 * The word players see for a stake, with its article. ADR-30 leaves it to the owner, so it is
 * provisional and this is the only place that names it.
 */
export const STAKE_WORD = {
  lower: 'envite',
  title: 'Envite',
  /** The word with its definite article, for sentences such as "Sube el envite". */
  the: 'el envite',
  /** The same, opening a sentence. */
  The: 'El envite',
} as const;
