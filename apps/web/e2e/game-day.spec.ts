import { expect, type Page, test } from '@playwright/test';

// The harness's scripted narrator writes these; see harness/scripted-story.ts.
const chapterTitle = 'La noche en que se perdió la grúa';
const action = 'Subo al faro con una linterna y busco la grúa desde arriba.';

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

test('a player plays a whole game day, from the situation to the chapter', async ({ page }) => {
  // Room for the app's one-minute catch-up, should a live event be lost.
  test.setTimeout(120_000);
  const violations = cspViolations(page);
  const day = await harness(page, '/__harness/season');

  await page.goto('/__harness/sign-in?player=sim-1');
  await expect(page.getByRole('heading', { name: 'La situación' })).toBeVisible();
  await expect(page.getByText('Todavía no ha jugado nadie.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Tu acción' }).fill(action);
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole('button', { name: 'Subir el envite' }).click();
  }
  await expect(page.getByRole('spinbutton', { name: 'Envite' })).toHaveValue('3');
  await page.getByRole('button', { name: 'Revisar y enviar' }).click();
  await expect(page.getByText('Una vez enviada no se puede editar ni retirar.')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar acción' }).click();

  await expect(page.getByRole('heading', { name: 'Tu acción, enviada' })).toBeVisible();
  await expect(page.getByText('Envite: 3.', { exact: false })).toBeVisible();
  await expect(page.getByText('La Farera, quien pregunta en voz alta')).toBeVisible();
  await expect(page.getByText('Han jugado 1 de 5.')).toBeVisible();

  // The close publishes the chapter, and the screen follows without a reload: by a live event, or
  // by the app's one-minute catch-up if that event is lost.
  await harness(page, '/__harness/days/close');
  await expect(page.getByText('El capítulo de este día ya está publicado.')).toBeVisible({
    timeout: 75_000,
  });
  await page.getByRole('link', { name: 'Leer el capítulo' }).click();

  await expect(page).toHaveURL(new RegExp(`/capitulos/${day}$`));
  await expect(page.getByRole('heading', { name: chapterTitle })).toBeVisible();
  await expect(page.getByText(action)).toBeVisible();
  await expect(page.getByText('Piloto automático: no envió acción, y eso cuesta 1.')).toHaveCount(
    4,
  );
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
  expect(violations).toEqual([]);
});
