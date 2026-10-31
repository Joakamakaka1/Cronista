/**
 * Waits until the given minutes fit before the deploy freeze. Each job of `deploy.yml` that changes
 * production runs it first, with its step timeouts plus a margin.
 *
 * Usage: `node infra/scripts/wait-for-deploy-window.ts <minutes>`
 *
 * @packageDocumentation
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { deployWindowStart, GAME_TIME_ZONE } from '@cronista/core';

const argument = process.argv[2] ?? '';
const start = deployWindowStart(new Date(), Number(argument));
if (!start.ok) throw new Error(`Not a deploy length that fits between two freezes: "${argument}".`);

const startsAt = start.value.toLocaleString('en-GB', { timeZone: GAME_TIME_ZONE });
console.log(`A ${argument}-minute deploy fits from ${startsAt} (${GAME_TIME_ZONE}).`);
await sleep(Math.max(0, start.value.getTime() - Date.now()));
