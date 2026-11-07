import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Plugin } from 'vite';

import { MAX_PRECACHE_ENTRIES, precacheList } from './precache.ts';

/**
 * Emits `sw.js` at the root of a build, with the build's precache list and a cache named after it
 * and the release, so each deploy installs a new worker and drops the old cache. The dev server
 * has no service worker: the app only registers one in a build.
 *
 * @throws When the list grows past {@link MAX_PRECACHE_ENTRIES}, which the WAF's rate limit counts.
 */
export function serviceWorker(release: string): Plugin {
  return {
    name: 'cronista-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const outputs = Object.values(bundle).map((output) =>
        output.type === 'chunk'
          ? { fileName: output.fileName, isEntry: output.isEntry, imports: output.imports }
          : { fileName: output.fileName },
      );
      const precache = precacheList(outputs);
      if (precache.length > MAX_PRECACHE_ENTRIES) {
        this.error(
          `The service worker would precache ${String(precache.length)} files, more than the ${String(MAX_PRECACHE_ENTRIES)} the WAF's rate limit allows for.`,
        );
      }
      const cache = `cronista-${createHash('sha256')
        .update([release, ...precache].join('\n'))
        .digest('hex')
        .slice(0, 12)}`;
      const source = readFileSync(new URL('sw.js', import.meta.url), 'utf8')
        .replace('self.__CRONISTA_PRECACHE__', JSON.stringify(precache))
        .replace('self.__CRONISTA_CACHE__', JSON.stringify(cache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
