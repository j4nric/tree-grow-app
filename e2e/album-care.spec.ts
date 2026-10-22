import { expect, gotoTab, savedState, seedV3, subpage, test, waypoint } from './fixtures';

/**
 * Unterseite „Pflegemaßnahme“ (docs/ALBUM_UI.md, A.8 #97 und B.3): Tipp auf den Namen einer
 * Maßnahme blättert um; dort stehen Wirkung, Ränge, Voraussetzungen und Kaufen. Nach dem
 * Kauf bleibt die Seite offen, „‹ Pflege“ führt zurück an den Namen.
 */

const care = (page: import('@playwright/test').Page) => page.locator('[data-ref="care"]');

test('U:Pflegemaßnahme: umblättern, Wirkung und Ränge, zweimal kaufen, zurück an den Namen', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain: beide Ränge von „Laub liegen lassen“ kaufbar
    seeds: 8000,
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'pflege');
  const name = care(page).locator('[data-care-title="leaf-litter"]');
  await name.click();

  const sub = subpage(page, 'care-item');
  await expect(sub).toBeVisible();
  await expect(sub).not.toHaveAttribute('inert', '');
  await expect(sub.locator('.page-title')).toHaveText('Laub liegen lassen');
  await expect(sub.locator('.page-title')).toBeFocused();
  await expect(sub.locator('[data-ref="bookmark"]')).toHaveText('‹ Pflege');
  await expect(sub.locator('[data-ref="care-item-rank"]')).toHaveText('Rang 0/2');
  await expect(sub.locator('[data-ref="care-item-status"]')).toHaveText('Jetzt möglich');
  await expect(sub.locator('[data-ref="care-item-next"]')).toHaveText('+1 Platz Laubstreu');
  await expect(sub.locator('[data-ref="care-item-ranks"] li')).toHaveCount(2);
  await expect(sub.locator('[data-ref="care-item-ranks"]')).toContainText('ab Hain');
  await expect(sub.locator('[data-ref="care-item-needs"] [data-need="stage"]')).toHaveClass(/care-need-met/);
  await expect(sub.locator('[data-ref="care-item-needs"] [data-need="seeds"]')).toHaveText(/200 🌰/);

  const buy = sub.locator('[data-ref="care-item-buy"]');
  await expect(buy).toHaveText('Kaufen (200 🌰)');
  await buy.click();
  await expect(sub.locator('[data-ref="care-item-rank"]')).toHaveText('Rang 1/2');
  await expect(page.locator('.float-layer')).toContainText('Laub bleibt liegen');
  await expect(sub.getByRole('status')).toHaveText('Laub bleibt liegen');
  // Die Seite bleibt offen und zeigt den nächsten Rang.
  await expect(buy).toHaveText(/Kaufen \(7[.,]000 🌰\)/);
  await expect(sub.locator('[data-ref="care-item-ranks"] .care-rank-done')).toHaveCount(1);
  // Sperre gegen Doppelkäufe abwarten, dann den letzten Rang kaufen.
  await page.waitForTimeout(450);
  await buy.click();
  await expect(sub.locator('[data-ref="care-item-maxed"]')).toBeVisible();
  await expect(buy).toBeHidden();
  await expect(sub.locator('[data-ref="care-item-needs"]')).toBeHidden();
  expect((await savedState(page)).cycle.care).toEqual({ 'leaf-litter': 2 });

  await sub.locator('[data-ref="bookmark"]').click();
  await expect(sub).toBeHidden();
  await expect(name).toBeFocused();
  await expect(care(page).locator('[data-care="leaf-litter"]')).toContainText('voll ausgebaut');
});

test('U:Pflegemaßnahme mobil: Sperrgründe mit Kreuz, gesperrter Knopf, Escape, kein Querscrollen bei 360 px', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1, // Alter Baum: Insektenhotel steht in der Liste
    seeds: 100,
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'pflege');
  await care(page).locator('[data-care-title="insect-hotel"]').click();
  const sub = subpage(page, 'care-item');
  await expect(sub).toBeVisible();
  await expect(sub).not.toHaveAttribute('inert', '');
  await expect(sub.locator('.page-title')).toHaveText('Insektenhotel');
  // Ohne Insekten fehlt die Bedingung, die Samen reichen auch nicht.
  const needs = sub.locator('[data-ref="care-item-needs"]');
  await expect(needs.locator('.care-need-open')).toHaveCount(2);
  await expect(needs).toContainText('braucht');
  await expect(needs.locator('[data-need="seeds"]')).toContainText(/noch [\d.]+ 🌰/);
  const buy = sub.locator('[data-ref="care-item-buy"]');
  await expect(buy).toHaveAttribute('aria-disabled', 'true');
  await expect(sub.locator('[data-ref="care-item-blocker"]')).toBeVisible();
  expect((await buy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await buy.click({ force: true });
  expect((await savedState(page)).cycle.care ?? {}).toEqual({});
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.keyboard.press('Escape');
  await expect(sub).toBeHidden();
  await expect(care(page).locator('[data-care-title="insect-hotel"]')).toBeFocused();
});

test('Reiter Pflege bei 360 px: kein Querscrollen, Knöpfe mindestens 44 px', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain: viele Maßnahmen, lange Kosten
    seeds: 3000,
    niches: { roots: ['earthworm'], edge: ['bee'] },
  });
  await gotoTab(page, 'pflege');
  await expect(care(page).locator('[data-care]').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const heights = await care(page)
    .locator('button:visible')
    .evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(4);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
});
