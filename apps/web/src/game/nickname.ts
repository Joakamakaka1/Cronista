const ARTICLE = /^(el|la|los|las)\s+/i;

/** A nickname without its article, as it goes under a mascot: "El Notario" → "Notario". */
export function shortName(nickname: string): string {
  return nickname.replace(ARTICLE, '');
}

/** A nickname inside a sentence, with its article in lower case: "la Boticaria". */
export function inSentence(nickname: string): string {
  return nickname.replace(ARTICLE, (article) => article.toLowerCase());
}

/** Whether the nickname's article is feminine; without one, Spanish defaults to masculine. */
export function isFeminine(nickname: string): boolean {
  return /^(la|las)\s/i.test(nickname);
}

/** The word repeated tone on tone behind a character's card: "FARERA". */
export function patternWord(nickname: string): string {
  return (shortName(nickname).split(/\s+/)[0] ?? nickname).slice(0, 7).toLocaleUpperCase('es');
}
