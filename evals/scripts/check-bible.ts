/**
 * Checks a bible against its schema before it goes to the private bucket. It prints where the file
 * fails and never its text, which holds real data.
 *
 * Usage: `pnpm bible:check <path>`
 *
 * @packageDocumentation
 */
import { readFile } from 'node:fs/promises';

import { createBibleLoader } from '@cronista/engine/bible';

const path = process.argv[2];
if (path === undefined) throw new Error('Say which file to check: pnpm bible:check <path>');

const bible = await createBibleLoader(() => readFile(path, 'utf8').catch(() => undefined))(0);

if (bible.ok) {
  console.log(`ok: ${String(bible.value.characters.length)} characters`);
} else {
  console.error('This bible does not pass: the warning above says where.');
  process.exitCode = 1;
}
