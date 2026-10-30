import { parameterStoreReplySchema } from '@cronista/core';

/** API keys of the AI providers, read from SSM SecureString parameters. */
export interface ProviderKeys {
  readonly anthropic: string;
  readonly voyage: string;
  readonly langfuse: string;
}

/** A provider whose key `ai-api` reads. */
export type Provider = keyof ProviderKeys;

/** The keys, or the providers whose key could not be read (never their values). */
export type ProviderKeysResult =
  | { readonly ok: true; readonly value: ProviderKeys }
  | { readonly ok: false; readonly error: { readonly unreadable: readonly Provider[] } };

/** Where {@link createProviderKeyReader} reads the keys from. */
export interface ProviderKeyReaderOptions {
  /** SSM parameter name of each provider's key. */
  readonly parameterNames: Readonly<Record<Provider, string>>;
  /** Port of the AWS Parameters and Secrets Lambda Extension (`PARAMETERS_SECRETS_EXTENSION_HTTP_PORT`). */
  readonly port: number;
  /** The function's `AWS_SESSION_TOKEN`, which the extension requires on every call. */
  readonly sessionToken: string;
  readonly fetch?: typeof fetch;
}

const providers: readonly Provider[] = ['anthropic', 'voyage', 'langfuse'];

// The extension answers from localhost and caches; anything slower is treated as unreadable.
const extensionTimeoutMs = 2000;

/**
 * Creates a reader of the providers' keys through the Parameters and Secrets extension, which
 * decrypts them and caches them for the function. The values are only returned, never logged.
 */
export function createProviderKeyReader(
  options: ProviderKeyReaderOptions,
): () => Promise<ProviderKeysResult> {
  const fetchParameter = options.fetch ?? fetch;

  const readKey = async (provider: Provider): Promise<string | undefined> => {
    const query = new URLSearchParams({
      name: options.parameterNames[provider],
      withDecryption: 'true',
    });
    try {
      const reply = await fetchParameter(
        `http://localhost:${options.port}/systemsmanager/parameters/get?${query.toString()}`,
        {
          headers: { 'X-Aws-Parameters-Secrets-Token': options.sessionToken },
          signal: AbortSignal.timeout(extensionTimeoutMs),
        },
      );
      if (!reply.ok) {
        // Releases the connection now instead of when the unread body is collected.
        await reply.body?.cancel();
        return undefined;
      }
      const parsed = parameterStoreReplySchema.safeParse(await reply.json());
      return parsed.success ? parsed.data.Parameter.Value : undefined;
    } catch {
      return undefined;
    }
  };

  return async () => {
    const values = await Promise.all(providers.map(readKey));
    const [anthropic, voyage, langfuse] = values;
    if (anthropic === undefined || voyage === undefined || langfuse === undefined) {
      return {
        ok: false,
        error: { unreadable: providers.filter((_, index) => values[index] === undefined) },
      };
    }
    return { ok: true, value: { anthropic, voyage, langfuse } };
  };
}
