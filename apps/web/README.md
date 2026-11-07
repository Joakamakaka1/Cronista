# apps/web

Cronista's player app: a static React PWA, served from S3 by CloudFront with no server of its own (ADR-15). A player signs in with Google and plays the whole game day from a phone: reads the situation, sends an action with a stake, gets the hint, sees who has played and reads the chapter after the close. The text players see is in Spanish.

## Stack

React 19, Vite, Tailwind 4, Motion, React Router, TanStack Query and `@supabase/supabase-js`, with components copied in (see "Components"). Phone first: one column, centred on a desktop. The second design (CR-58) is black humour on paper or at night: Rammetto One (weight 400 only) for the logo, headings, numbers and stickers, and Geist for the interface and the reading, both served from the site itself under their OFL licences.

- **Theme**: dark by default. The «Tu cuenta» panel, opened from the player's mascot on Today, switches to light, and the choice is kept on the device (`localStorage`, `cronista:tema`). `public/theme.js`, a same-origin script in `<head>` (no inline script, because of the CSP), applies it before the first paint. Every colour is a token in `src/styles.css`, so both modes come from one set of components.
- **Visual system** (`src/brand/`): the five hooded mascots and the narrator's flame mask, the isotipo, the sign-in logo and the painterly blend, all inline SVG ported from the owner's canvas "Cronista: diseño v1". A character's mascot is its seat, its place by id in the season, never its nickname. The app icons in `public/icons/` and the favicon come from the isotipo; `scripts/render-icons.ts` renders the PNGs from `icon.svg`.

## How it works

- **Reads** go straight to Supabase through RLS (`src/game/game-queries.ts`). The current day is the latest `game_days` row, not the browser's clock, which only tells an open day from one past 22:00.
- **Live updates**: one Realtime channel on `game_days`, `actions` and `chapters`. Each event refetches the game queries, so the screen follows a new action or a published chapter without a reload. Those rows hold no action text or stake, and Realtime checks each event against the player's RLS. The app also refetches when the channel joins and when Realtime confirms that database changes stream to it: after a while with no subscribers Realtime stops streaming, the next join restarts it, and changes committed before it streams again never arrive. While the page is visible, the season and today refetch every minute too, for a connection that drops unnoticed.
- **Writes** go through CloudFront to the APIs (`src/api/post-to-api.ts`): `POST /api/actions` and `POST /api/ai/hint`. Every POST carries the session in `X-Session-Token` and the body's SHA-256 in `x-amz-content-sha256`. A 503 `auth_unavailable` keeps the session and retries three times; a 401 ends the session on the device and returns to the sign-in screen.
- **Session**: the implicit flow, so Google sign-in comes back with the session in the URL fragment, which never reaches a server. supabase-js keeps it in `localStorage` so an installed app stays signed in; the strict CSP keeps other scripts away from it.
- **The stake's word** is provisional (ADR-30 leaves it open) and lives only in `src/stake-word.ts`.

## Screens

| Route             | What it shows                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/entrar`         | Sign-in with Google, and why a sign-in failed or a session ended                                                                             |
| `/`               | Today: the situation or the newspaper's message, who has played, the action and stake form, and the hint. Every state of the day             |
| `/capitulos`      | The archive: every published chapter, newest first                                                                                           |
| `/capitulos/:day` | One chapter (`/capitulos/2026-11-09`): its text, then each action with its stake, award and charges, autopilot and struck-out actions marked |
| `/personajes`     | Each character's balance, items, open debts and status                                                                                       |

The chapter text never moves. Motion animates what surrounds it (the slide to send, the tick and sparks when it lands, the narrator's waiting line, the character card's flip and count, the ledger and the archive as they appear), and `prefers-reduced-motion` stills it all: `MotionConfig reducedMotion="user"` for transforms, `useReducedMotion` in each copied component for opacity and timers, and a CSS rule for transitions.

## Components

Components are copied in by hand, never installed (ADR-31), so they are our code: review them, and keep the origin (library, registry URL, version or date) and the licence notice at the top of each file, with the licence text beside it in `src/ui/`. Which component goes on which screen is in ADR-31.

| Library                                            | Use it for                                                     | Licence                                        |
| -------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| [shadcn](https://ui.shadcn.com)                    | Base components and the `cn` helper                            | MIT                                            |
| [ReUI](https://reui.io)                            | Structure shadcn lacks: Avatar, Badge, Alert, Timeline, Table  | MIT for the free components; Pro is never used |
| [Motion Primitives](https://motion-primitives.com) | Motion around lists and blocks: AnimatedGroup, In View         | MIT                                            |
| [Kokonutui](https://kokonutui.com)                 | slide-to-confirm, card-flip                                    | MIT                                            |
| [React Bits](https://reactbits.dev)                | Small motion: RotatingText, CountUp, SpringCheck, AnimatedList | MIT + Commons Clause                           |
| [Animate UI](https://animate-ui.com)               | Particles only; the npm package is not installed               | MIT + Commons Clause                           |

Rules for copying:

- **CSP first**: `style-src 'self'` blocks any `<style>` a component injects at runtime. Move a static `<style>{css}</style>` into `styles.css`; turn `AnimatePresence mode="popLayout"` into `"wait"` or `"sync"`, because Motion injects a `<style>` for it. Radix `Dialog`, `AlertDialog`, `Sheet`, modal menus and `vaul` stay out: their scroll lock injects one. Styles set through the DOM (`element.style`), as React and Motion do, are allowed, and so are inline SVG filters. The local preview serves the app under the real headers, so Playwright fails on a violation before production does.
- **Licence**: MIT + Commons Clause allows use as part of an application, not resale or redistribution of the components on their own. The repo is public, so keep the copyright notice in every copied file and never move them into a package.
- **Motion first**, so one animation library ships. No GSAP, WebGL, `three.js` or physics engine.
- **Touch**: no components that follow a cursor a phone does not have. No camera or microphone.
- **Icons**: `lucide-react` only; swap any other set while copying.
- **Game rules**: chapter text never animates, and nothing offers to undo a sent action.

## Running it locally

The local API harness (`harness/`) mounts the real `core-api` and `ai-api` handlers behind Vite, over the local Supabase, with the engine's scripted narrator: the whole app runs at no cost and a test can close a day. It lives only in `vite.config.ts`, so nothing of it reaches the production bundle.

```powershell
supabase start --workdir packages/db -x studio,imgproxy,storage-api,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit
pnpm --filter @cronista/web dev                 # http://127.0.0.1:5173, with hot reload
pnpm --filter @cronista/web preview:harness     # http://127.0.0.1:4173, the built app under the site's headers
```

Realtime must be running for live updates. Then open `/__harness`:

- **Crear temporada** creates a season of the seed's five invented players in a free stretch of dates and opens its first day.
- **Cerrar** closes the latest day at 22:00 and publishes its chapter; **Abrir** opens the next one.
- **Entrar como** signs in as an invented player with a magic link verified by the harness, which hands the session to the app in the URL fragment, as Google sign-in does.

The harness's clock is midday of the latest day, so actions and hints land inside it whatever the real date is.

## Tests

- `pnpm --filter @cronista/web test` (in `pnpm check`): Vitest on the pure logic, such as the day's phase, the stake's bounds, a chapter's ledger and error reports.
- `pnpm --filter @cronista/web e2e`: Playwright on mobile Chromium (Pixel 7) and mobile WebKit (iPhone 15), each in dark and light mode, against `preview:harness`. The happy path signs in, sends an action with a stake from the keyboard, sees the tip-off, closes the day and reads the chapter with its pull quote, and checks the theme was applied before the first paint; a second test opens a chapter from a link and flips a character card; a third checks that reduced motion stills the ledger. They assert behaviour and text, not layout, and fail on any CSP violation. They need the local Supabase with Realtime, so they run locally before a front PR and are not a CI check. Install the browsers once with `pnpm --filter @cronista/web exec playwright install chromium webkit`.

## The edge

- **CSP** (`infra/src/security-headers.ts`): `connect-src` allows the Supabase project over `https` and `wss`, plus `font-src`, `manifest-src` and `worker-src 'self'`. `img-src 'self'` keeps remote images and `data:` out.
- **Routes**: a viewer-request CloudFront Function (`infra/src/app-routes.ts`) serves `index.html` for any path whose last segment has no extension, on the site's behaviour only, so a link to a chapter opens directly and a missing asset is still a 404.
- **Hashed assets**: `deploy-web.yml` builds the app and keeps Vite's `assets/` for a year; everything else is `no-cache`.
- **Rate limit**: the WAF counts cached assets too (300 requests per 5 minutes per IP). A first load is about a dozen requests; check the service worker's precache against it when the PWA arrives.

## Error reports

The app reports its uncaught errors with `POST /api/client-errors`, which `core-api` logs and counts, and which raises the `ClientErrors` alarm (`docs/development.md`, "Errors in the browser"):

- A root error boundary for what fails while rendering, and listeners on `error` and `unhandledrejection` for everything else, such as event handlers.
- Only while signed in, at most 5 reports per page load, never retried or shown, and only for scripts of the site's own origin (browser extensions are ignored).
- A report holds the error type, script path, line, column and release, and nothing else (`clientErrorSchema` in `@cronista/core`): never the error's message, which can quote a player's text, or the page's URL. The release is the root `package.json` version at build time.
