/**
 * Renders the app icons in `public/icons/` from `public/icons/icon.svg`, the isotipo on its night
 * tile, with Playwright's Chromium. Run it after changing the SVG and commit the PNGs:
 * `pnpm --filter @cronista/web exec node scripts/render-icons.ts`.
 *
 * @packageDocumentation
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const icons = fileURLToPath(new URL('../public/icons/', import.meta.url));
const svg = readFileSync(`${icons}icon.svg`, 'utf8');

// Full-bleed squares: the phone or the manifest rounds them. 180 px is the iPhone home screen.
const sizes = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 } as const;

const browser = await chromium.launch();
try {
  for (const [file, size] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<body style="margin:0">${svg.replace('<svg ', `<svg width="${String(size)}" height="${String(size)}" `)}</body>`,
    );
    await page.screenshot({ path: `${icons}${file}`, omitBackground: false });
    await page.close();
  }
} finally {
  await browser.close();
}
