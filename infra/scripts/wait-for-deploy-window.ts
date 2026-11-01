/**
 * Waits until the given minutes fit before the next deploy freeze. Each job of `deploy.yml` and
 * `deploy-web.yml` that changes production runs it first, with its step timeouts plus a margin.
 * When the wait would outlast a GitHub-hosted job it fails at once: re-run the job when deploys
 * reopen.
 *
 * Usage: `node infra/scripts/wait-for-deploy-window.ts <minutes>`
 *
 * @packageDocumentation
 */
import { setTimeout as sleep } from 'node:timers/promises';

// By path, not through `@cronista/core`: the deploy jobs run it before installing any dependency.
import { deployWindowStart, GAME_TIME_ZONE } from '../../packages/core/src/schedule.ts';

// A hosted job runs for 6 hours at most, and the hour left covers the job's own work.
const maximumWaitMilliseconds = 5 * 60 * 60_000;

const argument = process.argv[2] ?? '';
const start = deployWindowStart(new Date(), Number(argument));
if (!start.ok) throw new Error(`Not a deploy length that fits between two freezes: "${argument}".`);

const startsAt = start.value.toLocaleString('en-GB', { timeZone: GAME_TIME_ZONE });
const wait = Math.max(0, start.value.getTime() - Date.now());
if (wait > maximumWaitMilliseconds) {
  throw new Error(
    `Deploys are frozen: a ${argument}-minute deploy fits from ${startsAt} (${GAME_TIME_ZONE}), ` +
      'later than this job can wait. Re-run it then.',
  );
}
console.log(`A ${argument}-minute deploy fits from ${startsAt} (${GAME_TIME_ZONE}).`);
await sleep(wait);
