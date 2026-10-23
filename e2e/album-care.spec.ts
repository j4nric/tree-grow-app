import { expect, gotoTab, parseGermanNumber, savedState, seedV3, subpage, test, waypoint } from './fixtures';

/**
 * Unterseite „Pflegemaßnahme“ (docs/ALBUM_UI.md, A.8 #97 und B.3), seit Spielstand v17 ein
 * Forschungsknoten (Notlösung bis Phase 10, 4a): Tipp auf den Namen blättert um; dort stehen
 * Wirkung, Voraussetzungen, Vorrat und Erforschen. Danach bleibt die Seite offen, „‹ Pflege“
 * führt zurück an den Namen.
 */

const care = (page: import('@playwright/test').Page) => page.locator('[data-ref="care"]');

test('U:Pflegemaßnahme (Forschungsknoten): umblättern, Wirkung, Voraussetzungen, erforschen, zurück an den Namen', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain: Humusschicht steht in der Liste, braucht Kompost und Laub
    harmonyPoints: 8000,
    research: ['leaf-litter'],
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'pflege');
  const name = care(page).locator('[data-care-title="humus"]');
  await name.click();

  const sub = subpage(page, 'care-item');
  await expect(sub).toBeVisible();
  await expect(sub).not.toHaveAttribute('inert', '');
  await expect(sub.locator('.page-title')).toHaveText('Humusschicht');
  await expect(sub.locator('.page-title')).toBeFocused();
  await expect(sub.locator('[data-ref="bookmark"]')).toHaveText('‹ Pflege');
  await expect(sub.locator('[data-ref="care-item-rank"]')).toHaveText('🪱 Boden');
  await expect(sub.locator('[data-ref="care-item-status"]')).toHaveText('Braucht „Kompost“');
  await expect(sub.locator('[data-ref="care-item-next"]')).toHaveText('+2 💧, +3 ⚖️');
  await expect(sub.locator('[data-ref="care-item-ranks"]')).toBeHidden();
  const needs = sub.locator('[data-ref="care-item-needs"]');
  await expect(needs.locator('[data-need="stage"]')).toHaveClass(/care-need-met/);
  await expect(needs.locator('[data-need="requires:leaf-litter"]')).toHaveClass(/care-need-met/);
  await expect(needs.locator('[data-need="requires:compost"]')).toHaveClass(/care-need-open/);
  await expect(needs.locator('[data-need="harmony"]')).toHaveText(/430 ⚖️/);
  await expect(sub.locator('[data-ref="care-item-wallet"]')).toHaveText(/^⚖️ [\d.]+ · \+\d+\/min$/);

  const buy = sub.locator('[data-ref="care-item-buy"]');
  await expect(buy).toHaveText('Erforschen (430 ⚖️)');
  await expect(buy).toHaveAttribute('aria-disabled', 'true');
  // Kompost in der Liste erforschen, dann zurück zur Humusschicht.
  await sub.locator('[data-ref="bookmark"]').click();
  await expect(sub).toBeHidden();
  await care(page).locator('[data-buy-care="compost"]').click();
  await expect(care(page).locator('[data-care="compost"]')).toContainText('erforscht');
  await name.click();
  await expect(sub).toBeVisible();
  await expect(needs.locator('[data-need="requires:compost"]')).toHaveClass(/care-need-met/);
  await expect(buy).not.toHaveAttribute('aria-disabled', 'true');
  await buy.click();
  await expect(page.locator('.float-layer')).toContainText('Humus aufgebaut');
  await expect(sub.getByRole('status')).toHaveText('Humus aufgebaut');
  // Die Seite bleibt offen und zeigt den Stempel „erforscht“.
  await expect(sub.locator('[data-ref="care-item-maxed"]')).toBeVisible();
  await expect(sub.locator('[data-ref="care-item-maxed"]')).toHaveText('erforscht');
  await expect(buy).toBeHidden();
  await expect(needs).toBeHidden();
  await expect.poll(async () => (await savedState(page)).cycle.research).toEqual(['leaf-litter', 'compost', 'humus']);

  await sub.locator('[data-ref="bookmark"]').click();
  await expect(sub).toBeHidden();
  await expect(name).toBeFocused();
  await expect(care(page).locator('[data-care="humus"]')).toContainText('erforscht');
});

test('U:Pflegemaßnahme mobil: Sperrgründe mit Kreuz, gesperrter Knopf, Escape, kein Querscrollen bei 360 px', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1, // Alter Baum: Insektenhotel steht in der Liste
    harmonyPoints: 100,
    research: ['wildflower-hem'],
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'pflege');
  await care(page).locator('[data-care-title="insect-hotel"]').click();
  const sub = subpage(page, 'care-item');
  await expect(sub).toBeVisible();
  await expect(sub).not.toHaveAttribute('inert', '');
  await expect(sub.locator('.page-title')).toHaveText('Insektenhotel');
  // Ohne Insekten fehlt die Bedingung, der Vorrat reicht auch nicht.
  const needs = sub.locator('[data-ref="care-item-needs"]');
  await expect(needs.locator('.care-need-open')).toHaveCount(2);
  await expect(needs).toContainText('braucht');
  await expect(needs.locator('[data-need="harmony"]')).toContainText(/noch [\d.]+ ⚖️/);
  const buy = sub.locator('[data-ref="care-item-buy"]');
  await expect(buy).toHaveAttribute('aria-disabled', 'true');
  await expect(sub.locator('[data-ref="care-item-blocker"]')).toBeVisible();
  expect((await buy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await buy.click({ force: true });
  expect((await savedState(page)).cycle.research).toEqual(['wildflower-hem']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.keyboard.press('Escape');
  await expect(sub).toBeHidden();
  await expect(care(page).locator('[data-care-title="insect-hotel"]')).toBeFocused();
});

test('Reiter Pflege bei 360 px: kein Querscrollen, Knöpfe mindestens 44 px', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain: viele Knoten, lange Kosten
    harmonyPoints: 3000,
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

/**
 * Vorratsleiste (docs/ALBUM_UI.md B.0, G.2-14; Playtest Schritt 14, S6): Mobil erscheint über
 * den klebenden Reitern eine schmale Leiste mit Samen, Wachstum und Harmonie, sobald die
 * Etiketten weggescrollt sind. Forschen kostet seit v17 ⚖️, nicht 🌰 – die Samen bleiben.
 * U:Pflegemaßnahme zeigt den Harmonie-Vorrat am Erforschen-Knopf.
 */
test('Mobil: Vorratsleiste beim Scrollen in der Pflege, Forschen lässt die Samen stehen', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain: lange Liste
    harmonyPoints: 3000,
    niches: { roots: ['earthworm'], edge: ['bee'] },
  });
  await gotoTab(page, 'pflege');
  const bar = page.locator('[data-ref="supply-bar"]');
  const inner = bar.locator('.supply-bar-inner');
  // Oben (Etiketten im Bild): keine Leiste.
  await expect(inner).toBeHidden();
  // Weit nach unten: Leiste da, die Reiter kleben darunter.
  const last = care(page).locator('[data-buy-care]').last();
  await last.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 300));
  await expect(inner).toBeVisible();
  const barSeeds = async () => parseGermanNumber((await bar.locator('[data-ref="supply-seeds"]').textContent()) ?? '');
  const seedsBefore = await barSeeds();
  await expect(bar.locator('[data-ref="supply-growth"]')).toHaveText(/\/s$/);
  const barBox = (await inner.boundingBox())!;
  const tabsBox = (await page.locator('[data-ref="tabs"]').boundingBox())!;
  expect(barBox.y).toBeLessThanOrEqual(1);
  expect(tabsBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
  // Erforschen: die Samen bleiben (die Forschung kostet ⚖️).
  const buy = care(page).locator('[data-buy-care]:not([aria-disabled="true"])').first();
  await buy.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  await buy.click();
  await expect.poll(async () => (await savedState(page)).cycle.research.length).toBe(1);
  expect(await barSeeds()).toBeGreaterThanOrEqual(seedsBefore);
  // Gleicher Stand wie das Samen-Etikett (gleiche Quelle, gleicher Moment).
  const labelSeeds = async () => parseGermanNumber((await page.locator('[data-ref="seeds"]').textContent()) ?? '');
  await expect.poll(async () => Math.abs((await barSeeds()) - (await labelSeeds()))).toBeLessThanOrEqual(5);
  // Wieder oben: Leiste weg.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(inner).toBeHidden();
});

test('Desktop: keine Vorratsleiste (Etiketten stehen daneben); U:Pflegemaßnahme zeigt den Harmonie-Vorrat', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await seedV3(context, { totalGrowth: waypoint(12) + 1, harmonyPoints: 1234, niches: { roots: ['earthworm'] } });
  await gotoTab(page, 'pflege');
  await expect(page.locator('[data-ref="supply-bar"]')).toBeHidden();
  await care(page).locator('[data-care-title="insect-hotel"]').click();
  const sub = subpage(page, 'care-item');
  await expect(sub.locator('[data-ref="care-item-wallet"]')).toHaveText(/^⚖️ 1\.2\d\d · \+\d+\/min$/);
});
