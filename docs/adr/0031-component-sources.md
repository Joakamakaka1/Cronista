# Component libraries are sources, not dependencies

ADR-15 chose React, Vite, Tailwind, shadcn and Motion for the player app, and left several component libraries as candidates for later designs. The owner validated them on 2026-11-06 against the site's strict CSP, phones, reduced motion and the rule that chapter text never moves, and the second design (CR-58) picked from them on 2026-11-07. This ADR's number continues ADR-01 to ADR-30 in the private architecture document.

## Decision

- **Copy, never install.** Components come from shadcn, ReUI, Motion Primitives, Kokonutui, React Bits and Animate UI by copying their source into `apps/web/src/ui/`, one component at a time, when a screen needs it. No component library is an npm dependency, so drawing from several costs nothing beyond the code we copy. What a copied component imports (`motion`, `lucide-react`) is already installed; anything new is a dependency change and needs the owner's OK with an exact version.
- **By hand, from the registry JSON, with the origin named.** The shadcn CLI writes dependency ranges and some registries serve `main` unpinned, so each file is copied by hand. Its header names the library, the registry URL, the version or date when the registry gives one, the licence and what was changed; the licence text sits beside it (`LICENSE-<library>.txt`).
- **A copied file is our code.** It is reviewed like any other, trimmed to what the screen uses, and fixed while copying:
  - a static `<style>{css}</style>` moves into `styles.css`;
  - `AnimatePresence mode="popLayout"` becomes `"wait"` or `"sync"` (Motion's PopChild injects a `<style>`);
  - other icon sets become `lucide-react`, or a plain path;
  - every animation stills under `prefers-reduced-motion`;
  - colours and type come from the app's tokens.
- **What stays out**: anything that injects a `<style>` at runtime that cannot be moved, Radix `Dialog`, `AlertDialog`, `Sheet` and modal menus, and `vaul` (scroll locks inject a `<style>`), cursor-only effects, camera and microphone, GSAP for what Motion does, WebGL and physics, and anything that animates chapter text or offers to undo a sent action.

## Licences

Motion Primitives, Kokonutui, ReUI's free components and shadcn are MIT. React Bits and Animate UI are MIT + Commons Clause: they may be used as part of this application but not sold or redistributed on their own, so their files are never extracted into a package. Paid tiers are never used: ReUI Pro forbids public repositories and Aceternity's compare-slider is paid.

## Chosen components

| Screen            | Component                                                                                            | Source                 | File                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------- |
| Today, sending    | slide-to-confirm («Desliza. Sin vuelta atrás»), with Enter, Space and screen readers sending at once | Kokonutui              | `slide-to-confirm.tsx`              |
| Sent              | SpringCheck and one Particles burst when the action lands                                            | React Bits, Animate UI | `spring-check.tsx`, `particles.tsx` |
| Narrator thinking | RotatingText, with the embers beside it                                                              | React Bits             | `rotating-text.tsx`                 |
| Characters        | card-flip around the numbers and the secrets; CountUp for points                                     | Kokonutui, React Bits  | `card-flip.tsx`, `count-up.tsx`     |
| Chapter ledger    | AnimatedList                                                                                         | React Bits             | `animated-list.tsx`                 |
| Archive           | AnimatedGroup and In View                                                                            | Motion Primitives      | `animated-group.tsx`, `in-view.tsx` |

Silk and HoloCard were considered for sign-in and the character cards and are out of v1: both are WebGL, and the second design's painterly blend is inline SVG instead.

## Rejected

- **Installing Animate UI** (`@animate-ui/react`): its peers pull in Base UI, React Aria, shiki and more, and about twelve of its components inject a `<style>`. Particles is copied instead.
- **Only shadcn and Motion**: the most control, but it rebuilds what these libraries already solve.
- **The shadcn CLI**: faster, but it writes `^` ranges against the exact-version rule.
