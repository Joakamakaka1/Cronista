import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { supabaseUrl } from '@cronista/infra/config';
import { securityHeadersFor } from '@cronista/infra/security-headers';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type PluginOption } from 'vite';

import { serviceWorker } from './pwa/service-worker-plugin.ts';

// The production project's publishable key: public by design, it ships in the bundle.
const productionPublishableKey = 'sb_publishable_LP8vpzdcaLuOELYmW7nHvA_9d698VBP';

// The public half of production's VAPID pair, which every browser subscribes with: public by design,
// kept as data next to the service worker.
const { production: productionVapidPublicKey } = JSON.parse(
  readFileSync(new URL('pwa/vapid-public-key.json', import.meta.url), 'utf8'),
) as { production: string };

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

// `vite` (dev) and `--mode harness` run against the local Supabase with the API harness; a plain
// build is the production site, with nothing of the harness in it. Vitest also serves, in `test`
// mode, and needs neither the harness nor a running Supabase.
export default defineConfig(async ({ command, mode }) => {
  const local = mode === 'harness' || (command === 'serve' && mode === 'development');
  const supabase = local
    ? await import('@cronista/engine/local').then(({ localSupabase }) => localSupabase())
    : { url: supabaseUrl, publishableKey: productionPublishableKey };
  const plugins: PluginOption[] = [react(), tailwindcss(), serviceWorker(version)];
  let vapidPublicKey = productionVapidPublicKey;
  if (local) {
    const { localApiHarness } = await import('./harness/local-api.ts');
    // A local pair of its own, shared by `vite build` and `vite preview`, which are two processes.
    const vapid = localVapidPair();
    vapidPublicKey = vapid.publicKey;
    plugins.push(localApiHarness(vapid), productionHeaders(supabase.url));
  }

  return {
    plugins,
    define: {
      __CRONISTA_RELEASE__: JSON.stringify(version),
      __SUPABASE_URL__: JSON.stringify(supabase.url),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabase.publishableKey),
      __VAPID_PUBLIC_KEY__: JSON.stringify(vapidPublicKey),
    },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    build: { target: 'es2022', sourcemap: false },
  };
});

// A P-256 pair as base64url, as SSM keeps production's: the private scalar and the public point.
// It lives in node_modules' cache, never in the repo, and only signs pushes to local browsers; a
// browser subscribed with an older pair subscribes again when the player turns pushes on.
function localVapidPair(): { privateKey: string; publicKey: string } {
  const file = new URL('node_modules/.cache/cronista-local-vapid.json', import.meta.url);
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8')) as { privateKey: string; publicKey: string };
  }
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
    format: 'jwk',
  });
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? '', 'base64url'),
    Buffer.from(jwk.y ?? '', 'base64url'),
  ]);
  const pair = { privateKey: jwk.d ?? '', publicKey: point.toString('base64url') };
  mkdirSync(new URL('.', file), { recursive: true });
  writeFileSync(file, JSON.stringify(pair));
  return pair;
}

// The local preview serves the built app under the site's real headers, so a component that
// injects a style tag fails here before it fails in production.
function productionHeaders(localSupabaseUrl: string): Plugin {
  return {
    name: 'cronista-production-headers',
    configurePreviewServer(server) {
      server.middlewares.use((_request, response, next) => {
        for (const [name, value] of Object.entries(securityHeadersFor(localSupabaseUrl))) {
          response.setHeader(name, value);
        }
        next();
      });
    },
  };
}
