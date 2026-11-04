import { describe, expect, it, vi } from 'vitest';

import { createBibleLoader } from './load-bible.ts';

const validBible = `
world: |
  Un pueblo costero inventado
  donde nada funciona.
tone: Crónica de sucesos.
toneExamples:
  - El alcalde perdió la llave.
redLines: []
characters:
  - nickname: La Farera
    sheet: Vigila un faro apagado.
    redLines: []
`;

describe('createBibleLoader', () => {
  it('parses and validates the bible, keeping multi-line text', async () => {
    const load = createBibleLoader(() => Promise.resolve(validBible));

    const bible = await load(0);

    expect(bible.ok && bible.value.world).toBe('Un pueblo costero inventado\ndonde nada funciona.');
    expect(bible.ok && bible.value.characters[0]?.nickname).toBe('La Farera');
  });

  it('reads each season once', async () => {
    const fetchText = vi.fn(() => Promise.resolve(validBible));
    const load = createBibleLoader(fetchText);

    await load(0);
    await load(0);
    await load(1);

    expect(fetchText.mock.calls).toEqual([[0], [1]]);
  });

  it('fails when the file cannot be read, and tries again next time', async () => {
    const fetchText = vi.fn<() => Promise<string | undefined>>();
    fetchText.mockResolvedValueOnce(undefined).mockResolvedValueOnce(validBible);
    const load = createBibleLoader(fetchText);

    expect(await load(0)).toEqual({ ok: false, error: 'bible_unavailable' });
    expect((await load(0)).ok).toBe(true);
  });

  it('fails on a bible with the wrong shape, logging where and never its text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = createBibleLoader(() => Promise.resolve('world: Un secreto del dueño.\n'));

    expect(await load(0)).toEqual({ ok: false, error: 'bible_unavailable' });
    expect(JSON.stringify(warn.mock.calls)).toContain('tone');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secreto');
    warn.mockRestore();
  });

  it('fails on invalid YAML without logging the parser message, which quotes the file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = createBibleLoader(() => Promise.resolve('world: "un secreto sin cerrar\n'));

    expect(await load(0)).toEqual({ ok: false, error: 'bible_unavailable' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secreto');
    warn.mockRestore();
  });
});
