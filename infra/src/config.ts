/** URL of the Supabase project. Public by design: it ships in the web bundle too. */
export const supabaseUrl = 'https://crbkwqrqaogykugxhewy.supabase.co';

/**
 * SSM SecureString parameters with the AI providers' keys, encrypted with the `aws/ssm` key. The
 * owner enters the values (`docs/development.md`); only `ai-api` and `ai-worker` may read them.
 */
export const aiProviderKeyParameters = {
  anthropic: '/cronista/prod/anthropic/api-key',
  voyage: '/cronista/prod/voyage/api-key',
  langfuse: '/cronista/prod/langfuse/secret-key',
} as const;
