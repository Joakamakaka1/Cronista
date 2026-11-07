import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MAX_PRECACHE_ENTRIES, precacheList } from './precache.ts';

describe('precacheList', () => {
  it('keeps the entry, what it imports up front, the styles and the Latin fonts', () => {
    const list = precacheList([
      { fileName: 'assets/index-a.js', isEntry: true, imports: ['assets/shared-b.js'] },
      { fileName: 'assets/shared-b.js', isEntry: false, imports: [] },
      { fileName: 'assets/chapter-lazy-c.js', isEntry: false, imports: [] },
      { fileName: 'assets/index-d.css' },
      { fileName: 'assets/geist-latin-wght-normal-e.woff2' },
      { fileName: 'assets/geist-latin-ext-wght-normal-f.woff2' },
      { fileName: 'assets/geist-cyrillic-wght-normal-g.woff2' },
      { fileName: 'assets/rammetto-one-latin-400-normal-h.woff' },
    ]);

    expect(list).toContain('/index.html');
    expect(list).toContain('/manifest.json');
    expect(list).toContain('/assets/index-a.js');
    expect(list).toContain('/assets/shared-b.js');
    expect(list).toContain('/assets/index-d.css');
    expect(list).toContain('/assets/geist-latin-wght-normal-e.woff2');
    expect(list).not.toContain('/assets/chapter-lazy-c.js');
    expect(list).not.toContain('/assets/geist-latin-ext-wght-normal-f.woff2');
    expect(list).not.toContain('/assets/geist-cyrillic-wght-normal-g.woff2');
    expect(list).not.toContain('/assets/rammetto-one-latin-400-normal-h.woff');
  });

  it('stays far below what the WAF lets one phone ask for in five minutes', () => {
    // Every file a real build could emit, as if each one were an entry.
    const everything = Array.from({ length: 200 }, (_, index) => ({
      fileName: `assets/font-cyrillic-${String(index)}.woff2`,
    }));
    const list = precacheList([
      { fileName: 'assets/index.js', isEntry: true, imports: [] },
      { fileName: 'assets/index.css' },
      ...everything,
    ]);
    expect(list.length).toBeLessThanOrEqual(MAX_PRECACHE_ENTRIES);
    // The install plus a first load (about a dozen requests) leave most of the 300 for playing.
    expect(MAX_PRECACHE_ENTRIES + 15).toBeLessThan(300 / 4);
  });

  it('only names public files that exist', () => {
    const publicDirectory = new URL('../public/', import.meta.url);
    const icons = readdirSync(new URL('icons/', publicDirectory)).map((name) => `/icons/${name}`);
    const files = [...readdirSync(publicDirectory).map((name) => `/${name}`), ...icons];
    const named = precacheList([]).filter((url) => url !== '/index.html');
    for (const url of named) expect(files).toContain(url);
  });
});
