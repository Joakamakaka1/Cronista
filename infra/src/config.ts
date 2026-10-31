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
 * SSM SecureString parameters with the VAPID key pair (P-256, base64url) that signs Web Push
 * requests. The owner generates it (`docs/development.md`); only `notifier` may read it.
 */
export const vapidKeyParameters = {
  privateKey: '/cronista/prod/vapid/private-key',
  publicKey: '/cronista/prod/vapid/public-key',
} as const;

/**
 * SSM SecureString parameter with the Supabase secret key (`sb_secret_…`), encrypted with the
 * `aws/ssm` key. The owner enters it (`docs/development.md`); only `ai-worker` may read it.
 */
export const supabaseSecretKeyParameter = '/cronista/prod/supabase/secret-key';
