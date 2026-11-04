/**
 * Prints whether each local key arrived and works, never a value. `pnpm check-keys` runs it through
 * `with-secrets.ts`; it costs a fraction of a cent, so run it after creating or rotating a key.
 *
 * @packageDocumentation
 */
import { checkLocalKeys } from './local-keys.ts';

const report = await checkLocalKeys(process.env, fetch);

for (const [provider, outcome] of Object.entries(report)) console.log(`${provider}: ${outcome}`);
if (Object.values(report).some((outcome) => outcome !== 'ok')) process.exitCode = 1;
