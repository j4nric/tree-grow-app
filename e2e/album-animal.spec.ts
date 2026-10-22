import type { BrowserContext } from '@playwright/test';
import { animalPage, back, expect, openAnimal, openGame, seedV3, settledSubpage, sticker, tabPanel, test, waypoint } from './fixtures';

/**
 * Reiter Nischen und U:Tier im Album (docs/ALBUM_UI.md, B.1, C.1–C.3): Kennzahl im
 * Seitenkopf, Umblättern per Sticker, Lesezeichen und Browser-Zurück, nie Ebene 3.
 */

async function seed(context: BrowserContext): Promise<void> {
  await seedV3(context, {
    totalGrowth: waypoint(14) + 1,
    niches: { roots: ['vole', 'earthworm'], edge: ['fox'], hollows: ['owl'] },
  });
}

test('Seitenkopf: „x von y Plätzen“, Sticker mit fester Neigung je Art', async ({ page, context }) => {
  await seed(context);
  await openGame(page);
  const meta = tabPanel(page, 'nischen').locator('.page-meta');
  await expect(meta).toHaveText(/^4 von \d+ Plätzen$/);
  const tilt = () => sticker(page, 'roots', 'vole').evaluate((b) => getComputedStyle(b).getPropertyValue('--tilt').trim());
  const first = await tilt();
  expect(first).toMatch(/^-?[1-6]deg$/);
  await page.reload();
  await expect(sticker(page, 'roots', 'vole')).toBeVisible();
  expect(await tilt()).toBe(first);
});

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
]) {
  test(`U:Tier (${viewport.name}): Umblättern, Lesezeichen und Browser-Zurück`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(context);
    await openGame(page);
    const niches = tabPanel(page, 'nischen');

    const sub = await openAnimal(page, 'hollows', 'owl');
    // Die Reiterseite ist weggedreht und nicht bedienbar.
    await expect(niches.locator('xpath=ancestor-or-self::*[@inert]')).not.toHaveCount(0);
    await expect(sub.locator('[data-ref="bookmark"]')).toHaveText('‹ Nischen');
    await expect(sub.locator('.page-title')).toBeFocused();
    if (viewport.name === 'Desktop') await expect(sub.locator('.page-number')).toHaveText('S. 13');

    // Lesezeichen: zurück, Fokus auf den Sticker.
    await back(page);
    await expect(sub).toBeHidden();
    await expect(niches.locator('xpath=ancestor-or-self::*[@inert]')).toHaveCount(0);
    await expect(sticker(page, 'hollows', 'owl')).toBeFocused();

    // Browser-Zurück schließt die Unterseite, nicht die App.
    await openAnimal(page, 'roots', 'vole');
    await page.goBack();
    await expect(animalPage(page)).toBeHidden();
    await expect(page).toHaveURL(/#nischen$/);
    await expect(niches).toBeVisible();
  });
}

test('U:Tier → Nahrungsnetz (Ebene 2): Lesezeichen nennt die Art, zwei Schritte zurück', async ({ page, context }) => {
  await seed(context);
  await openGame(page);
  const sub = await openAnimal(page, 'hollows', 'owl');
  await sub.locator('[data-ref="detail-food-web"]').click();
  const web = await settledSubpage(page, 'foodweb');
  await expect(web.locator('[data-ref="bookmark"]')).toHaveText('‹ Waldkauz');
  // Zwei Ebenen zurück führen auf die Reiterseite.
  await back(page);
  await expect(web).toBeHidden();
  await expect(sub).toBeVisible();
  await back(page);
  await expect(sub).toBeHidden();
  await expect(tabPanel(page, 'nischen').locator('xpath=ancestor-or-self::*[@inert]')).toHaveCount(0);
});
