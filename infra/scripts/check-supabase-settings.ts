/**
 * Fails when a production Supabase setting differs from what `supabase-settings.ts` expects.
 * `.github/workflows/supabase-drift.yml` runs it every day.
 *
 * Usage: `node infra/scripts/check-supabase-settings.ts`, with `SUPABASE_SETTINGS_TOKEN` and
 * `SUPABASE_PROJECT_REF` in the environment.
 *
 * @packageDocumentation
 */
import { findSettingsDrift } from './supabase-settings.ts';

const token = process.env.SUPABASE_SETTINGS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF;
if (!token || !projectRef) {
  throw new Error('SUPABASE_SETTINGS_TOKEN and SUPABASE_PROJECT_REF are required.');
}

const drifted = await findSettingsDrift(projectRef, token, fetch);
if (drifted.length > 0) {
  console.error(
    'These settings differ from "Settings outside the code" in docs/development.md:\n' +
      drifted.map((name) => `- ${name}`).join('\n'),
  );
  process.exitCode = 1;
} else {
  console.log('Every Supabase setting matches.');
}
