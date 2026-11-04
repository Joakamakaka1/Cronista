# apps/web

Cronista's front end: a static React PWA, served from S3 by CloudFront with no server of its own (ADR-15). The app is created with v1's front card.

## Stack

React 19, Vite, Tailwind 4, shadcn and Motion. Mobile first, with a modern, editorial look: clean serif text for reading, animation around it, never on the text being read.

## Components

Components are copied into the app through the shadcn CLI or by hand, so they are our code: review them, and pin what they install to exact versions (the CLI writes `^`). A new dependency still needs the owner's OK.

| Library                                            | Depends on                                 | License                                                                          |
| -------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| [Animate UI](https://animate-ui.com)               | Motion and a primitive library (Base UI)   | MIT + Commons Clause                                                             |
| [Motion Primitives](https://motion-primitives.com) | Motion, Tailwind                           | MIT                                                                              |
| [Kokonutui](https://kokonutui.com)                 | Motion, `lucide-react`, Tailwind 4, shadcn | MIT                                                                              |
| [React Bits](https://reactbits.dev)                | Varies by component: see below             | MIT + Commons Clause                                                             |
| [ReUI](https://reui.io)                            | shadcn, Radix                              | MIT for its free components only: the Pro blocks and icons are paid, so not used |

Rules for choosing:

- **License**: MIT + Commons Clause allows use as part of an application, not resale or redistribution of the components on their own. The repo is public, so keep the copyright notice in every copied file.
- **Motion first**, so one animation library ships. GSAP (proprietary, no charge) only for an effect worth its weight: React Bits' `SplitText`, `TextLoop`, `AnimatedContent`, `AccordionGallery` and `StaggeredMenu` need it.
- **No WebGL or physics in v1**: `ColorBends`, `Lanyard` and `PaperCrumple` (`three`), `WarpText`, `FlexCarousel` and `MorphSlider` (`ogl`), and `FolderFloat` (`matter-js`) wait until they pass a battery and heat check on the oldest phone. `Silk` and `Ribbons` import no library but should get the same check.
- **Touch**: `GlowCursor`, `TargetCursor` and `Crosshair` follow a cursor that a phone does not have.
- React Bits' remaining components use Motion, `@hugeicons/react` or nothing beyond React. Choose one icon set (`lucide-react` comes with Kokonutui and shadcn) when both would ship.

## What the app needs from the edge

These change with the front card, because the current settings only fit the placeholder:

- **CSP** (`infra/src/security-headers.ts`): `connect-src` needs the Supabase URL over `https` and `wss`, and the app needs `font-src`, `manifest-src` and `worker-src` set to `'self'`. `style-src 'self'` blocks `<style>` tags that a component injects at runtime, so test the chosen components against it before relaxing anything.
- **Deep links**: S3 has no `/chapter/3`, so a route must fall back to `index.html`.
- **Hashed assets**: `deploy-web.yml` keeps `_app/immutable/` for a year. Vite writes them to `assets/`.
- **Rate limit**: the WAF counts cached assets too (300 requests per 5 minutes per IP), so check it against the size of the service worker's precache.

## Placeholder

Until v1, `cronista.jcvstro.dev` serves `placeholder/`: a landing page and the "Probar conexión" check, in plain HTML, CSS and JS with no dependencies and no build. `deploy-web.yml` syncs it to the site bucket on every merge that changes `apps/web` (`docs/delivery.md`). The text players see is in Spanish.

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

**The React app reports through the same route**, with the same rules and the version from its build: a root error boundary for what fails while rendering, and the same two listeners for everything else, such as its event handlers.
