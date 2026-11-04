import { z } from 'zod';

const paragraph = z.string().trim().min(1);

/**
 * A season's bible: the owner's description of its world, tone, characters and red lines. Play
 * never changes it. Field names are in English; the text the owner writes is in Spanish.
 */
export const bibleSchema = z.strictObject({
  world: paragraph,
  tone: paragraph,
  toneExamples: z.array(paragraph).min(1),
  redLines: z.array(paragraph),
  characters: z
    .array(
      z.strictObject({
        nickname: paragraph,
        sheet: paragraph,
        redLines: z.array(paragraph),
      }),
    )
    .min(1)
    .refine(
      (characters) =>
        new Set(characters.map(({ nickname }) => nickname)).size === characters.length,
      { error: 'Two characters share a nickname.' },
    ),
});

/** A bible, validated by {@link bibleSchema}. */
export type Bible = z.infer<typeof bibleSchema>;
