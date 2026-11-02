# apps/web

Cronista's front end: a static SvelteKit PWA (adapter-static), served from S3 by CloudFront.

It waits for the **visual spike** (ADR-15), which chooses between CSS/SVG with Motion or with GSAP. The project is created with `sv create` when the spike starts, together with `eslint-plugin-svelte` and `prettier-plugin-svelte`.

## Placeholder

Until the spike, `cronista.jcvstro.dev` serves `placeholder/`: a landing page and the "Probar conexión" check, in plain HTML, CSS and JS with no dependencies and no build. `deploy-web.yml` syncs it to the site bucket on every merge that changes `apps/web` (`docs/delivery.md`). The text players see is in Spanish.

The check exercises the whole chain the way the app does:

- It signs in with Google by redirecting to Supabase Auth, which returns the token in the URL fragment. The page removes it from the address bar and keeps it in memory only. Supabase only comes back to the page if `https://cronista.jcvstro.dev/**` is among its redirect URLs (Authentication → URL Configuration).
- It calls `core-api` and `ai-api` with the JWT in `X-Session-Token` and, on every POST, the body's SHA-256 in `x-amz-content-sha256`, which CloudFront's origin access control requires.
- Expected answers: 401 without a session, 200 on `/api/me`, 501 for a valid action, 400 for one of 1001 characters and 501 on `/api/ai/hint`. A 503 on the hint means a provider key is missing in SSM.

The CSP (`script-src 'self'`) allows no inline scripts, so all the JS lives in `check.js` and `release.js`. Turbo does not lint them, because `apps/web` is not a package yet; Prettier formats them.

## Error reports

Once signed in, the page reports its uncaught errors with `POST /api/client-errors`, which `core-api` logs and counts, and which raises the `ClientErrors` alarm (`docs/development.md`, "Errors in the browser").

- It listens to `error` and `unhandledrejection`, ignores other origins (browser extensions), sends at most 5 reports per page load, and never retries or shows a report that fails.
- A report holds the error type, script path, line, column and release, and nothing else (`clientErrorSchema` in `@cronista/core`). The error's message can quote a player's text, and the page's URL holds the access token in its fragment after signing in. A rejection with no stack reports only its type and release.
- `release.js` says `0.0.0` in the repo. `deploy-web.yml` overwrites it with the version it deploys, so a local page reports `0.0.0`.

**The SvelteKit app reports through the same route**, with the same rules and the version from its build: `handleError` in its client hooks for what fails while loading or rendering, and the same two listeners for everything else, such as its event handlers.
