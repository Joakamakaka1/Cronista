import { parameterStoreReplySchema } from '@cronista/core';

/** The values read, under the key the caller gave each parameter. */
export type ParameterValues<Key extends string> = Readonly<Record<Key, string>>;

/** The values, or the keys whose parameter could not be read (never their values). */
export type ParametersResult<Key extends string> =
  | { readonly ok: true; readonly value: ParameterValues<Key> }
  | { readonly ok: false; readonly error: { readonly unreadable: readonly Key[] } };

/** Where {@link createParameterReader} reads the parameters from. */
export interface ParameterReaderOptions<Key extends string> {
  /** SSM parameter name of each key. */
  readonly parameterNames: Readonly<Record<Key, string>>;
  /** Port of the AWS Parameters and Secrets Lambda Extension (`PARAMETERS_SECRETS_EXTENSION_HTTP_PORT`). */
  readonly port: number;
  /** The function's `AWS_SESSION_TOKEN`, which the extension requires on every call. */
  readonly sessionToken: string;
  readonly fetch?: typeof fetch;
}

// The extension answers from localhost and caches; anything slower is treated as unreadable.
const extensionTimeoutMs = 2000;

/**
 * Creates a reader of SSM SecureString parameters through the Parameters and Secrets extension,
 * which decrypts them and caches them for the function. The values are only returned, never
 * logged.
 */
export function createParameterReader<Key extends string>(
  options: ParameterReaderOptions<Key>,
): () => Promise<ParametersResult<Key>> {
  const fetchParameter = options.fetch ?? fetch;
  // Object.keys widens to string[]; the keys are exactly those of parameterNames.
  const keys = Object.keys(options.parameterNames) as Key[];

  const readValue = async (name: string): Promise<string | undefined> => {
    const query = new URLSearchParams({ name, withDecryption: 'true' });
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
    const values = await Promise.all(keys.map((key) => readValue(options.parameterNames[key])));
    const unreadable = keys.filter((_, index) => values[index] === undefined);
    if (unreadable.length > 0) return { ok: false, error: { unreadable } };
    return {
      ok: true,
      // Every value is defined: the keys without one returned above.
      value: Object.fromEntries(
        keys.map((key, index) => [key, values[index]]),
      ) as ParameterValues<Key>,
    };
  };
}
