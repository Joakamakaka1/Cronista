# apps/web

Cronista's front end: a static SvelteKit PWA (adapter-static), served from S3 by CloudFront.

It waits for the **visual spike** (ADR-15), which chooses between CSS/SVG with Motion or with GSAP. The project is created with `sv create` when the spike starts, together with `eslint-plugin-svelte` and `prettier-plugin-svelte`.

## Placeholder

Until the spike, `cronista.jcvstro.dev` serves `placeholder/`: a landing page and the "Probar conexión" check, in plain HTML, CSS and JS with no dependencies and no build. `deploy-web.yml` syncs it to the site bucket on every merge that changes `apps/web` (`docs/delivery.md`). The text players see is in Spanish.

The check exercises the whole chain the way the app does:

- It signs in with Google by redirecting to Supabase Auth, which returns the token in the URL fragment. The page removes it from the address bar and keeps it in memory only. Supabase only comes back to the page if `https://cronista.jcvstro.dev/**` is among its redirect URLs (Authentication → URL Configuration).
- It calls `core-api` and `ai-api` with the JWT in `X-Session-Token` and, on every POST, the body's SHA-256 in `x-amz-content-sha256`, which CloudFront's origin access control requires.
- Expected answers: 401 without a session, 200 on `/api/me`, 501 for a valid action, 400 for one of 1001 characters and 501 on `/api/ai/hint`. A 503 on the hint means a provider key is missing in SSM.

The CSP (`script-src 'self'`) allows no inline scripts, so all the JS lives in `check.js`. Turbo does not lint it, because `apps/web` is not a package yet; Prettier formats it.
