import { spawnSync } from 'node:child_process';
import { copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Invented values for everything a Lambda parses at cold start. */
const inventedEnvironment = {
  AWS_SESSION_TOKEN: 'invented',
  AWS_REGION: 'eu-west-1',
  PARAMETERS_SECRETS_EXTENSION_HTTP_PORT: '2773',
  SUPABASE_URL: 'https://invented.invalid',
  SITE_URL: 'https://invented.invalid',
  LANGFUSE_URL: 'https://invented.invalid',
  BIBLE_BUCKET: 'invented-bucket',
  ALERTS_TOPIC_ARN: 'arn:aws:sns:eu-west-1:111111111111:invented',
  SUPABASE_SECRET_KEY_PARAMETER: '/cronista/invented',
  ANTHROPIC_API_KEY_PARAMETER: '/cronista/invented',
  VOYAGE_API_KEY_PARAMETER: '/cronista/invented',
  LANGFUSE_SECRET_KEY_PARAMETER: '/cronista/invented',
  LANGFUSE_PUBLIC_KEY_PARAMETER: '/cronista/invented',
  VAPID_PRIVATE_KEY_PARAMETER: '/cronista/invented',
  VAPID_PUBLIC_KEY_PARAMETER: '/cronista/invented',
};

/**
 * Loads a synthesized Lambda bundle in Node, as a cold start does, and answers what it threw. A bundle
 * can pass every test of its source and still throw on load, because bundling changes how its
 * dependencies resolve.
 *
 * @remarks
 * The copy goes under the service's `node_modules`, so `@aws-sdk/*`, which the Lambda runtime provides
 * and the bundle leaves out, resolves to the service's own development copy.
 */
export function bundleStartError(
  bundle: string,
  service: 'core-api' | 'ai-api' | 'ai-worker' | 'notifier',
): string | undefined {
  const copy = `${repositoryRoot}services/${service}/node_modules/.bundle-start-check.mjs`;
  copyFileSync(bundle, copy);
  try {
    const started = spawnSync(process.execPath, [copy], {
      encoding: 'utf8',
      env: { ...process.env, ...inventedEnvironment },
    });
    if (started.status === 0) return undefined;
    return /^\w*Error: .*$/m.exec(started.stderr)?.[0] ?? started.stderr.slice(0, 500);
  } finally {
    rmSync(copy, { force: true });
  }
}
