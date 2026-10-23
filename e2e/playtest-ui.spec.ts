import type { Page } from '@playwright/test';
import { encounter, expect, openGame, openTab, pageTitle, seedV3, settle, settledSubpage, stack, test, waypoint } from './fixtures';

/**
 * Funde aus dem Playtest (mobil): wartende Begegnungen bleiben beim Scrollen erreichbar
 * (Zettelstapel fest unten rechts im Album), die Sprungmarken im Reiter Arten passen in höchstens zwei
 * Zeilen – ohne Querscrollen der Seite.
 */

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [360, 390]) {
  test(`Mobil ${width} px: wartende Begegnung beim Scrollen sichtbar, Hinweis unter der Stufenleiste`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 800 });
    await seedV3(context, {
      totalGrowth: waypoint(6) + 1,
      niches: { roots: ['earthworm'] },
      pendingEncounters: [
        { type: 'animal', cards: ['bluetit', 'oakmoth'], rerolls: 0 },
        { type: 'animal', cards: ['robin'], rerolls: 0 },
      ],
    });
    await openGame(page);
    // Unter der Stufenleiste steht, dass Begegnungen warten (statt des Countdowns).
    await expect(page.locator('[data-ref="progress-hint"]')).toContainText('2 Begegnungen warten');

    // Der Zettelstapel liegt mobil fest unten rechts – auch weit nach unten gescrollt im Bild.
    await expect(stack(page)).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(stack(page)).toBeInViewport();
    const box = (await stack(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Der Stapel blättert zu U:Begegnung um, Esc blättert zurück und gibt den Fokus zurück.
    await stack(page).click();
    await settledSubpage(page, 'encounter');
    await settle(page);
    await page.keyboard.press('Escape');
    await expect(encounter(page)).toBeHidden();
    await expect(stack(page)).toBeFocused();
  });

  test(`Mobil ${width} px: Reiter Arten – Sprungmarken in höchstens zwei Zeilen, per Tastatur bedienbar`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 800 });
    await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'], crown: ['bluetit'] } });
    await openGame(page);
    await openTab(page, 'arten');
    const panel = page.locator('[data-ref="page-species"]');
    const jumps = panel.locator('.species-jump');
    // Tiere, Pflanzen, Gemeinschaften, Andenken (Erfolge und Statistik im Reiter „Ziele“).
    await expect(jumps).toHaveCount(4);
    // offsetTop: ohne die leichte Drehung der Washi-Streifen.
    const tops = await jumps.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop));
    expect(new Set(tops).size).toBeLessThanOrEqual(2);
    for (const box of await jumps.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Tastatur: Sprungmarke „Andenken“ per Enter – der Abschnitt kommt ins Bild.
    await panel.locator('[data-jump="keepsakes"]').focus();
    await page.keyboard.press('Enter');
    await expect(panel.locator('#species-heading-keepsakes')).toBeInViewport();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
}

test('Einspaltig 700 px: Zettelstapel bleibt beim Scrollen im Bild', async ({ page, context }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await seedV3(context, {
    totalGrowth: waypoint(6) + 1,
    niches: { roots: ['earthworm'] },
    pendingEncounters: [{ type: 'animal', cards: ['bluetit'], rerolls: 0 }],
  });
  await openGame(page);
  await expect(stack(page)).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 80));
  await settle(page);
  await expect(stack(page)).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(stack(page)).toBeInViewport();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('Letzte Begegnung per Tastatur erledigt: Fokus landet auf der Überschrift der Seite', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await seedV3(context, {
    totalGrowth: waypoint(6) + 1,
    niches: { roots: ['earthworm'] },
    pendingEncounters: [{ type: 'animal', cards: ['bluetit'], rerolls: 0 }],
  });
  await openGame(page);
  await stack(page).focus();
  await page.keyboard.press('Enter');
  await settledSubpage(page, 'encounter');
  await settle(page);
  await encounter(page).locator('.card-choose').first().click();
  await expect(encounter(page)).toBeHidden();
  await expect(stack(page)).toBeHidden();
  await expect(pageTitle(page)).toBeFocused();
  // Und der Fokus bleibt dort (nicht nachträglich auf body verloren).
  await settle(page);
  await expect(pageTitle(page)).toBeFocused();
});
