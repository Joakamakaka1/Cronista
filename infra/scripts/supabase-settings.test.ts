import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { findSettingsDrift } from './supabase-settings.ts';

const SECRET = 'fixture-secret-value';

const live = () => ({
  '': { region: 'eu-west-1', name: 'fixture' },
  '/ssl-enforcement': { currentConfig: { database: true }, appliedSuccessfully: true },
  '/api-keys/legacy': { enabled: false },
  '/config/auth/signing-keys': {
    keys: [
      { algorithm: 'ES256', status: 'in_use' },
      { algorithm: 'HS256', status: 'revoked' },
    ],
  },
  '/config/auth': {
    external_google_enabled: true,
    external_google_skip_nonce_check: false,
    external_email_enabled: false,
    external_phone_enabled: false,
    external_anonymous_users_enabled: false,
    disable_signup: false,
    hook_before_user_created_enabled: true,
    hook_before_user_created_uri: 'pg-functions://postgres/private/before_user_created',
    site_url: 'https://cronista.jcvstro.dev',
    uri_allow_list: 'https://cronista.jcvstro.dev/**',
    external_google_secret: SECRET,
    smtp_pass: SECRET,
  },
});

type Live = ReturnType<typeof live>;

const fetchFrom =
  (responses: Readonly<Record<string, unknown>>): typeof fetch =>
  (url) => {
    const path = typeof url === 'string' ? url.split('/projects/fixture-ref')[1] : undefined;
    return Promise.resolve(Response.json(responses[path ?? '']));
  };

const drift = (change: (settings: Live) => void = () => undefined): Promise<readonly string[]> => {
  const settings = live();
  change(settings);
  return findSettingsDrift('fixture-ref', 'fixture-token', fetchFrom(settings));
};

describe('findSettingsDrift', () => {
  it('finds nothing when every setting matches', async () => {
    await expect(drift()).resolves.toEqual([]);
  });

  it.each<[string, (settings: Live) => void]>([
    [
      'Region',
      (settings) => {
        settings[''].region = 'us-east-1';
      },
    ],
    [
      'Database: SSL enforced',
      (settings) => {
        settings['/ssl-enforcement'].currentConfig.database = false;
      },
    ],
    [
      'API keys: legacy keys disabled',
      (settings) => {
        settings['/api-keys/legacy'].enabled = true;
      },
    ],
    [
      'JWT signing: one ES256 key',
      (settings) => {
        settings['/config/auth/signing-keys'].keys.push({ algorithm: 'HS256', status: 'standby' });
      },
    ],
    [
      'Sign-in: Google on',
      (settings) => {
        settings['/config/auth'].external_google_enabled = false;
      },
    ],
    [
      'Sign-in: Google nonce checks on',
      (settings) => {
        settings['/config/auth'].external_google_skip_nonce_check = true;
      },
    ],
    [
      'Sign-in: email off',
      (settings) => {
        settings['/config/auth'].external_email_enabled = true;
      },
    ],
    [
      'Sign-in: phone off',
      (settings) => {
        settings['/config/auth'].external_phone_enabled = true;
      },
    ],
    [
      'Sign-in: anonymous off',
      (settings) => {
        settings['/config/auth'].external_anonymous_users_enabled = true;
      },
    ],
    [
      'Sign-ups: on',
      (settings) => {
        settings['/config/auth'].disable_signup = true;
      },
    ],
    [
      'Sign-ups: hook enabled',
      (settings) => {
        settings['/config/auth'].hook_before_user_created_enabled = false;
      },
    ],
    [
      'Sign-ups: hook function',
      (settings) => {
        settings['/config/auth'].hook_before_user_created_uri = 'pg-functions://postgres/public/x';
      },
    ],
    [
      'URLs: site URL',
      (settings) => {
        settings['/config/auth'].site_url = 'http://localhost:3000';
      },
    ],
    [
      'URLs: redirect URLs',
      (settings) => {
        settings['/config/auth'].uri_allow_list =
          'https://cronista.jcvstro.dev/**,https://example.com';
      },
    ],
  ])('names "%s" when it differs', async (name, change) => {
    await expect(drift(change)).resolves.toEqual([name]);
  });

  it('counts a field the API stops returning as drift', async () => {
    const found = await drift((settings) => {
      Reflect.deleteProperty(settings['/config/auth'], 'disable_signup');
    });
    expect(found).toEqual(['Sign-ups: on']);
  });

  it('counts a redirect URL that is not a URL as drift', async () => {
    const found = await drift((settings) => {
      settings['/config/auth'].uri_allow_list = 'not a url';
    });
    expect(found).toEqual(['URLs: redirect URLs']);
  });

  it('never reports a value from the responses', async () => {
    const found = await drift((settings) => {
      settings['/config/auth'].site_url = SECRET;
      settings[''].region = SECRET;
    });
    expect(found).toHaveLength(2);
    expect(JSON.stringify(found)).not.toContain(SECRET);
  });

  it('sends the token and fails on an error status without the body or the project', async () => {
    const seen: (string | undefined)[] = [];
    const failing: typeof fetch = (_url, init) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? undefined);
      return Promise.resolve(new Response(SECRET, { status: 401 }));
    };
    const failure = findSettingsDrift('fixture-ref', 'fixture-token', failing);
    await expect(failure).rejects.toThrow(/HTTP 401/);
    await expect(failure).rejects.not.toThrow(new RegExp(`${SECRET}|fixture-ref`));
    expect(seen[0]).toBe('Bearer fixture-token');
  });
});

describe('findSettingsDrift with a broken response', () => {
  it('fails on a body that is not JSON without quoting it', async () => {
    const broken: typeof fetch = () =>
      Promise.resolve(new Response(`{"external_google_secret":"${SECRET}"`));
    const failure = findSettingsDrift('fixture-ref', 'fixture-token', broken);
    await expect(failure).rejects.toThrow(/Could not parse/);
    await expect(failure).rejects.not.toThrow(SECRET);
  });
});

describe('check-supabase-settings', () => {
  it('runs with no dependencies installed: it only imports its sibling and Node modules', () => {
    for (const file of ['./supabase-settings.ts', './check-supabase-settings.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const imports = [...source.matchAll(/^import\s.*from\s+['"]([^'"]+)['"]/gm)].map(
        (match) => match[1],
      );
      expect(imports.filter((name) => !/^(node:|\.\/)/.test(name ?? ''))).toEqual([]);
    }
  });
});
