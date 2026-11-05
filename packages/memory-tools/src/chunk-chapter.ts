/** The most words a chapter chunk holds. */
export const CHUNK_WORDS = 200;

/**
 * Cuts a chapter into chunks for the fallback index: whole paragraphs together while they fit, and a
 * paragraph longer than a chunk cut by words.
 */
export function chunkChapter(body: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) chunks.push(current.join(' '));
    current = [];
  };

  for (const paragraph of body.split(/\n\s*\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    if (current.length + words.length > CHUNK_WORDS) flush();
    for (let start = 0; start < words.length; start += CHUNK_WORDS) {
      const piece = words.slice(start, start + CHUNK_WORDS);
      if (piece.length === CHUNK_WORDS) {
        flush();
        chunks.push(piece.join(' '));
      } else {
        current.push(...piece);
      }
    }
  }
  flush();
  return chunks;
}
