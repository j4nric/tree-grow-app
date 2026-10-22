import type { Page } from '@playwright/test';
import { expect, gotoTab, niche, openGame, openTab, savedState, seedV3, test, waypoint } from './fixtures';

/**
 * Pflegemaßnahmen (Schritt 2.7): eine Maßnahme kaufen, die Wirkung sehen (ein Platz mehr
 * in der Laubstreu), Neuladen behält den Rang.
 */
test('Pflege kaufen: Samen weg, ein Platz mehr, nächster Rang gesperrt – auch nach dem Neuladen', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(6) + 1, // Junger Baum: Laubstreu hat 2 Plätze
    seeds: 400,
    niches: { roots: ['earthworm'], litter: ['robin'] },
  });
  await gotoTab(page, 'pflege');
  const care = page.locator('[data-ref="care"]');
  const litter = care.locator('[data-care="leaf-litter"]');
  await expect(litter).toContainText('Laub liegen lassen');
  await expect(litter).toContainText('Rang 0/2');
  await expect(litter).toContainText('+1 Platz Laubstreu');
  await expect(niche(page, 'litter')).toContainText('1/2 belegt');
  // Maßnahmen ab Alter Baum (z. B. Lichte Krone) stehen noch nicht in der Liste.
  await expect(care.locator('[data-care="light-crown"]')).toHaveCount(0);

  await litter.getByRole('button', { name: 'Kaufen (200 🌰)' }).click();

  await expect(niche(page, 'litter')).toContainText('1/3 belegt');
  await expect(litter).toContainText('Rang 1/2');
  await expect(litter.locator('[data-ref="care-blocker"]')).toHaveText('Ab Stufe „Hain“');
  // Gesperrt per aria-disabled (nicht `disabled`): bleibt fokussierbar, Grund wird vorgelesen.
  const locked = litter.getByRole('button', { name: /Kaufen/ });
  await expect(locked).toHaveAttribute('aria-disabled', 'true');
  await expect(locked).toHaveAccessibleName(/gesperrt: Ab Stufe „Hain“/);
  await expect(locked).toBeDisabled();
  // Klick auf den gesperrten Knopf kauft nichts.
  await locked.click({ force: true });
  await expect(litter).toContainText('Rang 1/2');
  const saved = await savedState(page);
  expect(saved.cycle.care).toEqual({ 'leaf-litter': 1 });
  expect(saved.seeds).toBeLessThan(300);

  await page.reload();
  await expect(care.locator('[data-care="leaf-litter"]')).toContainText('Rang 1/2');
  await expect(niche(page, 'litter')).toContainText('1/3 belegt');
  expect((await savedState(page)).cycle.care).toEqual({ 'leaf-litter': 1 });
});

test('Pflege per Tastatur: Fokus bleibt auf dem Knopf, nach dem letzten Rang auf dem Titel', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain: beide Ränge von „Laub liegen lassen“ kaufbar
    seeds: 100_000,
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'pflege');
  const litter = page.locator('[data-ref="care"] [data-care="leaf-litter"]');
  const buy = litter.locator('[data-buy-care="leaf-litter"]');
  await expect(buy).toHaveText('Kaufen (200 🌰)');
  await buy.focus();
  await page.keyboard.press('Enter');
  await expect(litter).toContainText('Rang 1/2');
  // Neu gebauter Knopf (nächster Rang) hat den Fokus übernommen.
  await expect(buy).toHaveText(/Kaufen \(7[.,]000 🌰\)/);
  await expect(buy).toBeFocused();
  // Sperre gegen Doppelkäufe abwarten, dann den letzten Rang kaufen.
  await page.waitForTimeout(450);
  await page.keyboard.press('Enter');
  await expect(litter).toContainText('voll ausgebaut');
  await expect(buy).toHaveCount(0);
  await expect(litter.locator('[data-care-title="leaf-litter"]')).toBeFocused();
  expect((await savedState(page)).cycle.care).toEqual({ 'leaf-litter': 2 });
});

test('Pflege: Doppelklick und gehaltene Enter-Taste kaufen nur einen Rang', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1,
    seeds: 100_000,
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'pflege');
  const care = page.locator('[data-ref="care"]');
  const litter = care.locator('[data-care="leaf-litter"]');
  await litter.locator('[data-buy-care="leaf-litter"]').dblclick();
  await expect(litter).toContainText('Rang 1/2');
  await page.waitForTimeout(450);
  expect((await savedState(page)).cycle.care).toEqual({ 'leaf-litter': 1 });

  // Gehaltene Enter-Taste: Playwright meldet weitere keydown mit `repeat`.
  const pond = care.locator('[data-care="pond"]');
  await pond.locator('[data-buy-care="pond"]').focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(pond).toContainText('Rang 1/2');
  await page.waitForTimeout(450);
  expect((await savedState(page)).cycle.care).toEqual({ 'leaf-litter': 1, pond: 1 });
});

/** data-care-IDs der Pflege-Liste in Anzeige-Reihenfolge. */
const careIds = (page: Page) =>
  page.locator('[data-ref="care"] [data-care]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.care!));

test('Pflege: kaufbar zuerst, Reihenfolge bleibt beim Kauf stehen, Bestätigung schwebt', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain
    seeds: 2600,
    niches: { roots: ['earthworm'], edge: ['bee'] },
  });
  await gotoTab(page, 'pflege');
  const care = page.locator('[data-ref="care"]');
  const groups = await care.locator('[data-care]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.group!));
  const rank: Record<string, number> = { buyable: 0, saving: 1, locked: 2, maxed: 3 };
  const ranks = groups.map((g) => rank[g]!);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  expect(groups[0]).toBe('buyable');
  await expect(care.locator('[data-ref="care-summary"]')).toHaveText(/\d+ kaufbar/);
  await expect(care.locator('[data-care="insect-hotel"] [data-ref="care-preview"]')).toContainText('+3 ⚖️');

  const order = await careIds(page);
  const boxes = care.locator('[data-buy-care="nest-boxes"]');
  await boxes.focus();
  await page.keyboard.press('Enter');
  await expect(care.locator('[data-care="nest-boxes"]')).toContainText('Rang 1/2');
  // Bestätigung: schwebender Hinweis und Statuszeile für Screenreader.
  await expect(page.locator('.float-layer')).toContainText('Nistkästen angebracht');
  await expect(care.getByRole('status')).toHaveText('Nistkästen angebracht');
  // Fokus in der Liste: nichts springt.
  expect(await careIds(page)).toEqual(order);
  await expect(boxes).toBeFocused();

  // Fokus verlässt die Liste → neu sortiert (Nistkästen ist jetzt zu teuer und rutscht nach hinten).
  await page.locator('[data-ref="tab-care"]').focus();
  await expect.poll(async () => (await careIds(page)).indexOf('nest-boxes')).toBeGreaterThan(order.indexOf('nest-boxes'));
});

test('Pflege auf dem Handy: zugeklappt mit Zusammenfassung, aufklappbar, ohne Querscrollen', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedV3(context, { totalGrowth: waypoint(6) + 1, seeds: 1200, niches: { roots: ['earthworm'] } });
  await gotoTab(page, 'pflege');
  const care = page.locator('[data-ref="care"]');
  const buy = care.locator('[data-buy-care="leaf-litter"]');
  // Kompost 200, Laub 200, Nistkästen 650, Wildblumen-Saum 900 🌰.
  await expect(care.locator('[data-ref="care-summary"]')).toHaveText('4 kaufbar');
  await expect(buy).toBeHidden();
  await care.getByText('Pflege', { exact: true }).click();
  await expect(buy).toBeVisible();
  expect((await buy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('Mobil: „Zur Pflege“ beim verschlossenen Waldtümpel öffnet die Pflege bei der Maßnahme', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1, // Alter Baum: Pflege „Waldtümpel“ steht in der Liste
    seeds: 10_000,
    niches: { roots: ['earthworm'] },
  });
  await openGame(page);
  const pond = niche(page, 'pond');
  await expect(pond).toContainText('öffnet durch Pflege „Waldtümpel“');
  // Schmal ist die Pflege zugeklappt – der Knopf am Hinweis führt hin (Playtest Amphibien).
  const details = page.locator('[data-ref="care"] details');
  await expect(details).not.toHaveAttribute('open', '');
  await pond.getByRole('button', { name: 'Zur Pflege: Waldtümpel öffnen' }).click();
  await expect(details).toHaveAttribute('open', '');
  // Der Knopf wechselt in den Reiter „Pflege“.
  await expect(page.locator('[data-ref="tab-care"]')).toHaveAttribute('aria-selected', 'true');
  const item = page.locator('[data-ref="care"] [data-care="pond"]');
  await expect(item.locator('[data-care-title="pond"]')).toBeFocused();
  await expect(item).toBeInViewport();
  await item.locator('[data-buy-care="pond"]').click();
  await expect(pond).toContainText('0/2 belegt');
  await openTab(page, 'nischen');
  await expect(pond.locator('[data-ref="niche-care-link"]')).toBeHidden();
});

test('Pflege: nach einem Mausklick wird neu sortiert, sobald die Maus die Liste verlässt', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain
    seeds: 2600,
    niches: { roots: ['earthworm'], edge: ['bee'] },
  });
  await gotoTab(page, 'pflege');
  const care = page.locator('[data-ref="care"]');
  const order = await careIds(page);
  const boxes = care.locator('[data-buy-care="nest-boxes"]');
  await boxes.click();
  await expect(care.locator('[data-care="nest-boxes"]')).toContainText('Rang 1/2');
  const note = page.locator('.float-layer .float-note').filter({ hasText: 'Nistkästen angebracht' });
  const noteBox = (await note.boundingBox())!;
  const nameBox = (await care.locator('[data-care="nest-boxes"] .care-name').boundingBox())!;
  expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(nameBox.y + 2);
  // Direkt nach dem Kauf (Maus noch in der Liste, Haltezeit): nichts springt.
  expect(await careIds(page)).toEqual(order);
  // Maus raus – der per Klick fokussierte Knopf hält die Liste nicht fest; nach der
  // Haltezeit rutscht „Nistkästen“ (jetzt zu teuer) nach hinten.
  await page.mouse.move(5, 5);
  await expect.poll(async () => (await careIds(page)).indexOf('nest-boxes')).toBeGreaterThan(order.indexOf('nest-boxes'));
});
