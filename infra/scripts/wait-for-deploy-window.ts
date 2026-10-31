/**
 * Waits until a deploy of the given length fits before the deploy freeze, so no part of it runs
 * inside the freeze. `deploy.yml` runs it right before the steps that change production.
 *
 * Usage: `node infra/scripts/wait-for-deploy-window.ts <minutes>`
 *
 * @packageDocumentation
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { deployWindowStart, GAME_TIME_ZONE } from '@cronista/core';

const minutes = process.argv[2] ?? '';
const start = deployWindowStart(new Date(), Number(minutes));
if (!start.ok) throw new Error(`Not a deploy length that fits between two freezes: "${minutes}".`);

const startsAt = start.value.toLocaleString('en-GB', { timeZone: GAME_TIME_ZONE });
console.log(`A ${minutes}-minute deploy fits from ${startsAt} (${GAME_TIME_ZONE}).`);
await sleep(Math.max(0, start.value.getTime() - Date.now()));
