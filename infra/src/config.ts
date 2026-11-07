/**
 * Countries that CloudFront serves (ISO 3166-1 alpha-2): the 27 members of the EU, plus Canada.
 *
 * @remarks
 * Every other country gets a 403 from CloudFront, on the site and the API alike. Supabase Auth is
 * outside CloudFront and unaffected.
 */
export const allowedViewerCountries = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  'CA',
] as const;

/** URL of the Supabase project. Public by design: it ships in the web bundle too. */
export const supabaseUrl = 'https://crbkwqrqaogykugxhewy.supabase.co';

/**
 * SSM SecureString parameters with the AI providers' keys, encrypted with the `aws/ssm` key. The
 * owner enters the values (`docs/development.md`); only `ai-api` and `ai-worker` may read them.
 */
export const aiProviderKeyParameters = {
  anthropic: '/cronista/prod/anthropic/game-api-key',
  voyage: '/cronista/prod/voyage/api-key',
  langfuse: '/cronista/prod/langfuse/secret-key',
} as const;

/**
 * SSM SecureString parameter with the Langfuse public key (`pk-lf-…`), which signs traces together
 * with the secret key. Public by design; `ai-api` and `ai-worker` read it.
 */
export const langfusePublicKeyParameter = '/cronista/prod/langfuse/public-key';

/** Langfuse Cloud EU, where the Cronista project lives. */
export const langfuseUrl = 'https://cloud.langfuse.com';

/**
 * SSM SecureString parameters with the VAPID key pair (P-256, base64url) that signs Web Push
 * requests. The owner generates it (`docs/development.md`); only `notifier` may read it.
 */
export const vapidKeyParameters = {
  privateKey: '/cronista/prod/vapid/private-key',
  publicKey: '/cronista/prod/vapid/public-key',
} as const;

/**
 * Name of the notifications queue in `CronistaWorkers`. `core-api` lives in `CronistaEdge`, which is
 * created first, so it reaches the queue by this name rather than by a reference between stacks.
 */
export const notificationsQueueName = 'cronista-notifications';

/**
 * SSM SecureString parameter with the Supabase secret key (`sb_secret_…`), encrypted with the
 * `aws/ssm` key. The owner enters it (`docs/development.md`); `core-api`, `ai-api` and `ai-worker`
 * may read it, because all three reach the game through the Data API.
 */
export const supabaseSecretKeyParameter = '/cronista/prod/supabase/secret-key';

/**
 * SSM String parameter with the name of the data bucket of `CronistaGitHubAccess`, which holds the
 * bibles. The owner enters it (`docs/development.md`). CloudFormation resolves it when it deploys, so
 * the name stays out of the repo, the templates and the plan: that stack is owner-only and the CI
 * stacks cannot reference it.
 */
export const dataBucketNameParameter = '/cronista/prod/data-bucket-name';
