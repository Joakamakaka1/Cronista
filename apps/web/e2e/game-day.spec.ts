import { expect, type Page, test } from '@playwright/test';

// The harness's scripted narrator writes these; see harness/scripted-story.ts.
const chapterTitle = 'La noche en que se perdió la grúa';
const pullQuote = 'Cuando el faro volvió a encenderse, la grúa seguía sin aparecer.';
const action = 'Subo al faro con una linterna y busco la grúa desde arriba.';
const autopilot = 'Ni se presentó. Piloto automático y menos uno, por rata.';

/** Calls a harness route and returns the latest game day it leaves. */
async function harness(page: Page, path: string): Promise<string> {
  const response = await page.request.post(path, { headers: { accept: 'application/json' } });
  expect(response.ok()).toBe(true);
  const reply: unknown = await response.json();
  if (typeof reply !== 'object' || reply === null || !('day' in reply)) throw new Error('No day.');
  if (typeof reply.day !== 'string') throw new Error('No day.');
  return reply.day;
}

/** Collects the Content Security Policy violations the page reports. */
function cspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

/**
 * Records the theme the page has once its HTML is parsed, before the first paint, and whether
 * anything changes it afterwards: a flash of the other mode would.
 */
async function watchTheme(
  page: Page,
): Promise<() => Promise<{ atFirstPaint: string; changed: boolean }>> {
  await page.addInitScript(() => {
    const record = window as unknown as { themeAtReady?: string; themeChanged?: boolean };
    document.addEventListener('DOMContentLoaded', () => {
      record.themeAtReady = document.documentElement.dataset.theme ?? 'none';
      new MutationObserver(() => {
        record.themeChanged = true;
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    });
  });
  return () =>
    page.evaluate(() => {
      const record = window as unknown as { themeAtReady?: string; themeChanged?: boolean };
      return { atFirstPaint: record.themeAtReady ?? 'none', changed: record.themeChanged === true };
    });
}

test('a player plays a whole game day, from the situation to the chapter', async ({
  page,
}, info) => {
  const violations = cspViolations(page);
  const theme = await watchTheme(page);
  const day = await harness(page, '/__harness/season');

  await page.goto('/__harness/sign-in?player=sim-1');
  await expect(page.getByRole('heading', { name: 'El marrón de hoy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Han movido ficha 0 de 5' })).toBeVisible();
  const expectedTheme: unknown = info.project.metadata.theme;
  expect(await theme()).toEqual({ atFirstPaint: expectedTheme, changed: false });

  await page.getByRole('textbox', { name: '¿Qué vas a liar?' }).fill(action);
  await page.getByRole('button', { name: 'Envite de 3', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Envite de 3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // The keyboard and screen-reader path: Enter on the slider's thumb sends at once.
  await page.getByRole('button', { name: /^Enviar tu acción con envite de 3/ }).press('Enter');

  await expect(
    page.getByRole('heading', {
      name: 'Ya está. Ahora reza para que el narrador no te tenga manía.',
    }),
  ).toBeVisible();
  await expect(page.getByText('Envite de 3', { exact: true })).toBeVisible();
  await expect(page.getByText(action)).toBeVisible();
  await expect(page.getByText('La Farera, quien pregunta en voz alta')).toBeVisible();
  // Nothing on the screen offers to take it back.
  await expect(page.getByRole('button', { name: /deshacer|retirar|editar/i })).toHaveCount(0);

  // The close publishes the chapter, and the screen follows live, well before the app's one-minute
  // catch-up could hide a lost event.
  await harness(page, '/__harness/days/close');
  await expect(page.getByText('El capítulo de este día ya está publicado.')).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('link', { name: 'Leer el capítulo' }).click();

  await expect(page).toHaveURL(new RegExp(`/capitulos/${day}$`));
  await expect(page.getByRole('heading', { name: chapterTitle })).toBeVisible();
  await expect(page.getByRole('blockquote')).toHaveText(pullQuote);
  await expect(page.getByText(action)).toBeVisible();
  await expect(page.getByText(autopilot)).toHaveCount(4);
  expect(violations).toEqual([]);
});

test('a link to a chapter opens it directly', async ({ page }) => {
  const violations = cspViolations(page);
  await harness(page, '/__harness/season');
  const day = await harness(page, '/__harness/days/close');

  await page.goto('/__harness/sign-in?player=sim-2');
  await expect(page.getByRole('link', { name: 'Leer el capítulo' })).toBeVisible();
  await page.goto(`/capitulos/${day}`);

  await expect(page.getByRole('heading', { name: chapterTitle })).toBeVisible();
  await page.getByRole('link', { name: 'Capítulos' }).click();
  await expect(page.getByRole('link', { name: new RegExp(chapterTitle) }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Personajes' }).click();
  await expect(page.getByRole('heading', { name: 'Historial delictivo' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver qué esconde' }).click();
  await expect(page.getByText('Deudas')).toBeVisible();
  expect(violations).toEqual([]);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('nothing moves: the accounts are there at once', async ({ page }) => {
    const violations = cspViolations(page);
    await harness(page, '/__harness/season');
    const day = await harness(page, '/__harness/days/close');

    await page.goto('/__harness/sign-in?player=sim-3');
    await expect(page.getByRole('link', { name: 'Leer el capítulo' })).toBeVisible();
    await page.goto(`/capitulos/${day}`);
    await expect(page.getByRole('heading', { name: chapterTitle })).toBeVisible();

    const rows = page
      .getByRole('heading', { name: /Las cuentas/ })
      .locator('xpath=..')
      .getByRole('listitem');
    await expect(rows).toHaveCount(5);
    const styles = await rows.evaluateAll((items) =>
      items.map((item) => [getComputedStyle(item).opacity, getComputedStyle(item).transform]),
    );
    for (const [opacity, transform] of styles) {
      expect(opacity).toBe('1');
      expect(transform).toBe('none');
    }
    expect(violations).toEqual([]);
  });
});
