/**
 * What the service worker stores when it installs, so the installed app opens with no network.
 *
 * @remarks
 * The WAF allows 300 requests per 5 minutes per IP, and it counts these too: an install fetches each
 * one once, on top of the page's own first load. So the list holds only what the first screen needs:
 * the page, its entry script and styles, the theme script, the icons and the Latin fonts. Other
 * fonts and anything loaded later are cached the first time the app asks for them.
 */
export const MAX_PRECACHE_ENTRIES = 30;

/** The files the app serves as they are from `public/` that the first screen needs. */
const publicFiles = [
  '/index.html',
  '/theme.js',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

/**
 * The URLs to precache from a build's output: every entry chunk, the chunks it imports up front, the
 * styles, the Latin `woff2` fonts and the public files above.
 *
 * @param outputs - Each emitted file's name and, for a chunk, whether it is an entry and what it
 *   imports statically.
 */
export function precacheList(
  outputs: readonly {
    readonly fileName: string;
    readonly isEntry?: boolean;
    readonly imports?: readonly string[];
  }[],
): readonly string[] {
  const byName = new Map(outputs.map((output) => [output.fileName, output]));
  const scripts = new Set<string>();
  const visit = (fileName: string) => {
    if (scripts.has(fileName)) return;
    scripts.add(fileName);
    for (const imported of byName.get(fileName)?.imports ?? []) visit(imported);
  };
  for (const output of outputs) if (output.isEntry === true) visit(output.fileName);

  const assets = outputs
    .map(({ fileName }) => fileName)
    .filter(
      (fileName) => fileName.endsWith('.css') || /-latin-(?!ext-)[^/]*\.woff2$/.test(fileName),
    );
  return [...publicFiles, ...[...scripts, ...assets].sort().map((fileName) => `/${fileName}`)];
}
