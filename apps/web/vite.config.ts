import { readFileSync } from 'node:fs';

import { supabaseUrl } from '@cronista/infra/config';
import { securityHeadersFor } from '@cronista/infra/security-headers';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type PluginOption } from 'vite';

// The production project's publishable key: public by design, it ships in the bundle.
const productionPublishableKey = 'sb_publishable_LP8vpzdcaLuOELYmW7nHvA_9d698VBP';

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
  const plugins: PluginOption[] = [react(), tailwindcss()];
  if (local) {
    const { localApiHarness } = await import('./harness/local-api.ts');
    plugins.push(localApiHarness(), productionHeaders(supabase.url));
  }

  return {
    plugins,
    define: {
      __CRONISTA_RELEASE__: JSON.stringify(version),
      __SUPABASE_URL__: JSON.stringify(supabase.url),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabase.publishableKey),
    },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    build: { target: 'es2022', sourcemap: false },
  };
});

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
