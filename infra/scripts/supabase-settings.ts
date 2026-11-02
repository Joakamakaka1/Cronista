/**
 * The production Supabase settings that live outside the code ("Settings outside the code" in
 * `docs/development.md`), compared with what the Management API reports.
 *
 * @remarks
 * It imports nothing, not even Zod, so `supabase-drift.yml` runs it with no dependency next to the
 * token. The auth response can hold secrets, and the log is public: the report only ever names
 * settings.
 *
 * @packageDocumentation
 */

const SITE_ORIGIN = 'https://cronista.jcvstro.dev';
const SIGN_UP_HOOK = 'pg-functions://postgres/private/before_user_created';
// Each has its own setting below, so a change names it.
const NAMED_PROVIDERS: ReadonlySet<string> = new Set([
  'external_google_enabled',
  'external_email_enabled',
  'external_phone_enabled',
  'external_anonymous_users_enabled',
]);

type Responses = Readonly<
  Record<'project' | 'ssl' | 'legacyKeys' | 'signingKeys' | 'auth', unknown>
>;

// A missing field reads as undefined, so a setting the API stops returning counts as drift.
const field = (value: unknown, ...path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (current, key) =>
      typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined,
    value,
  );

const hasOurOrigin = (url: unknown): boolean =>
  typeof url === 'string' && URL.canParse(url) && new URL(url).origin === SITE_ORIGIN;

const SETTINGS: readonly (readonly [name: string, holds: (live: Responses) => boolean])[] = [
  ['Region', ({ project }) => field(project, 'region') === 'eu-west-1'],
  ['Database: SSL enforced', ({ ssl }) => field(ssl, 'currentConfig', 'database') === true],
  ['API keys: legacy keys disabled', ({ legacyKeys }) => field(legacyKeys, 'enabled') === false],
  [
    'JWT signing: one ES256 key',
    ({ signingKeys }) => {
      const keys: unknown = field(signingKeys, 'keys');
      if (!Array.isArray(keys)) return false;
      const trusted = keys.filter((key) => field(key, 'status') !== 'revoked');
      return (
        trusted.length === 1 &&
        field(trusted[0], 'status') === 'in_use' &&
        field(trusted[0], 'algorithm') === 'ES256'
      );
    },
  ],
  ['Sign-in: Google on', ({ auth }) => field(auth, 'external_google_enabled') === true],
  [
    'Sign-in: Google nonce checks on',
    ({ auth }) => field(auth, 'external_google_skip_nonce_check') === false,
  ],
  ['Sign-in: email off', ({ auth }) => field(auth, 'external_email_enabled') === false],
  ['Sign-in: phone off', ({ auth }) => field(auth, 'external_phone_enabled') === false],
  [
    'Sign-in: anonymous off',
    ({ auth }) => field(auth, 'external_anonymous_users_enabled') === false,
  ],
  [
    'Sign-in: no other provider',
    ({ auth }) =>
      typeof auth === 'object' &&
      auth !== null &&
      Object.entries(auth).every(
        ([key, value]) =>
          !/^(external_\w+|saml|passkey|custom_oauth)_enabled$/.test(key) ||
          NAMED_PROVIDERS.has(key) ||
          value !== true,
      ),
  ],
  ['Sign-ups: on', ({ auth }) => field(auth, 'disable_signup') === false],
  [
    'Sign-ups: hook enabled',
    ({ auth }) => field(auth, 'hook_before_user_created_enabled') === true,
  ],
  [
    'Sign-ups: hook function',
    ({ auth }) => field(auth, 'hook_before_user_created_uri') === SIGN_UP_HOOK,
  ],
  ['URLs: site URL', ({ auth }) => hasOurOrigin(field(auth, 'site_url'))],
  [
    'URLs: redirect URLs',
    ({ auth }) => {
      const urls = field(auth, 'uri_allow_list');
      return (
        typeof urls === 'string' &&
        urls
          .split(',')
          .filter((url) => url !== '')
          .every(hasOurOrigin)
      );
    },
  ],
];

/**
 * Reads the project's settings and compares them.
 *
 * @returns The name of every setting that differs; empty when they all match.
 * @throws When an endpoint answers with an error or a body that is not JSON. The message names the
 * endpoint and its status, never the project or the body.
 */
export async function findSettingsDrift(
  projectRef: string,
  token: string,
  fetcher: typeof fetch,
): Promise<readonly string[]> {
  const read = async (path: string): Promise<unknown> => {
    const response = await fetcher(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Could not read "${path || '/'}" of the project: HTTP ${response.status}.`);
    }
    // A parse error quotes the body, and the auth body can hold secrets.
    return response.json().catch(() => {
      throw new Error(`Could not parse "${path || '/'}" of the project.`);
    });
  };
  const [project, ssl, legacyKeys, signingKeys, auth] = await Promise.all([
    read(''),
    read('/ssl-enforcement'),
    read('/api-keys/legacy'),
    read('/config/auth/signing-keys'),
    read('/config/auth'),
  ]);
  const live = { project, ssl, legacyKeys, signingKeys, auth };
  return SETTINGS.filter(([, holds]) => !holds(live)).map(([name]) => name);
}
