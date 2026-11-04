/**
 * Runs the narrator's bench through promptfoo and compares it with the saved baseline, case by case.
 * It spends cents from the `evals` workspace, and fails on a case that passed and now fails.
 *
 * Usage: `pnpm bench`, or `pnpm bench --save` to make this run the new baseline.
 *
 * @packageDocumentation
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { benchSummarySchema, compareBench, summarizeBench } from './bench-summary.ts';

const inEvals = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const resultsFolder = inEvals('results/bench');
const resultsFile = `${resultsFolder}/results.json`;
const baselineFile = inEvals('baselines/bench.json');
mkdirSync(resultsFolder, { recursive: true });

const run = spawnSync(
  process.execPath,
  [
    inEvals('node_modules/promptfoo/dist/src/entrypoint.js'),
    'eval',
    '--config',
    inEvals('promptfoo/promptfooconfig.yaml'),
    '--output',
    resultsFile,
    '--no-cache',
    '--no-write',
    '--no-table',
    '--no-progress-bar',
    '--max-concurrency',
    '4',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      PROMPTFOO_DISABLE_TELEMETRY: '1',
      PROMPTFOO_DISABLE_UPDATE: '1',
      PROMPTFOO_CONFIG_DIR: `${resultsFolder}/.promptfoo`,
    },
  },
);
// promptfoo answers 100 when an assertion fails, which is the comparison's to judge.
if (run.status !== 0 && run.status !== 100) {
  throw new Error(`promptfoo failed with status ${String(run.status)}.`);
}

const summary = summarizeBench(JSON.parse(readFileSync(resultsFile, 'utf8')));
const baseline = existsSync(baselineFile)
  ? benchSummarySchema.parse(JSON.parse(readFileSync(baselineFile, 'utf8')))
  : undefined;
const { lines, regressed } = compareBench(baseline, summary);
console.log(`\n${lines.join('\n')}\n\nFull results: ${resultsFile}`);

if (process.argv.includes('--save')) {
  mkdirSync(inEvals('baselines'), { recursive: true });
  writeFileSync(baselineFile, `${JSON.stringify(summary, undefined, 2)}\n`);
  console.log(`Saved as the baseline: ${baselineFile}`);
} else if (regressed) {
  process.exitCode = 1;
}
