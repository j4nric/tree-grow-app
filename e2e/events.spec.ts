import { SAVE_VERSION, encounter, expect, gotoTab, openGame, openStack, openTab, savedState, seedV3, settle, test, waypoint } from './fixtures';

/**
 * Ereignisse mit Wahl und Durchreisende (Schritt 2.4): im Kartenwahl-Dialog wählen, der
 * Bonus erscheint in der Seitenleiste und übersteht das Neuladen.
 */
test('Ereignis und Gast wählen: Boni erscheinen mit Restzeit und bleiben nach dem Neuladen', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1, // Alter Baum
    seeds: 5000,
    niches: { roots: ['earthworm'], litter: ['robin'], crown: ['bluetit'] },
    pendingEncounters: [
      { type: 'event', cards: ['midsummer'], rerolls: 0 },
      { type: 'visitor', cards: ['cranes'], rerolls: 0 },
    ],
  });
  // Boni stehen im Reiter „Pflege“ (Abschnitt „Gerade wirksam“).
  await gotoTab(page, 'forschung');
  const bonuses = page.locator('[data-ref="bonuses"]');
  await expect(bonuses).toBeHidden();

  await openStack(page);
  await expect(encounter(page)).toContainText('Mittsommer');
  await expect(encounter(page)).toContainText('Die längsten Tage des Jahres');
  // Ereignis: Optionsknöpfe statt „Wählen“, kein Ablehnen, kein Neu würfeln.
  await expect(encounter(page).getByRole('button', { name: 'Alles blühen lassen' })).toBeVisible();
  await expect(encounter(page).getByRole('button', { name: /Neu würfeln/ })).toBeHidden();
  await encounter(page).getByRole('button', { name: 'Lange Tage nutzen' }).click();

  // Nächste Begegnung: der Gast.
  await expect(encounter(page)).toContainText('Kranichzug');
  await settle(page);
  await expect(encounter(page).getByRole('button', { name: /^Ziehen lassen \(\+[\d,.]+ 🌰\)$/ })).toBeVisible();
  await encounter(page).getByRole('button', { name: /^Bewirten \(−[\d,.]+ 🌰\)$/ }).click();
  await expect(encounter(page)).toBeHidden();

  await expect(bonuses).toBeVisible();
  await expect(bonuses.locator('[data-bonus^="timed:midsummer"]')).toContainText('+30 % 🌿');
  await expect(bonuses.locator('[data-bonus^="timed:midsummer"]')).toContainText(/noch \d+ Min\./);
  await expect(bonuses.locator('[data-bonus="visitor:cranes"]')).toContainText('Kranichzug');

  const saved = await savedState(page);
  expect(saved.version).toBe(SAVE_VERSION);
  expect(saved.cycle.timed).toHaveLength(1);
  expect(saved.cycle.visitors).toEqual([expect.objectContaining({ id: 'cranes' })]);
  expect(saved.seeds).toBeLessThan(5000);

  await page.reload();
  await expect(bonuses.locator('[data-bonus^="timed:midsummer"]')).toBeVisible();
  await expect(bonuses.locator('[data-bonus="visitor:cranes"]')).toBeVisible();
  const again = await savedState(page);
  expect(again.cycle.visitors).toEqual([expect.objectContaining({ id: 'cranes' })]);
});

test('Ereignis- und Gast-Karten: große Knöpfe mit Wirkungszeile, Tastatur, mobil ohne Querscrollen', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1, // Alter Baum
    seeds: 5000,
    niches: { roots: ['earthworm'], litter: ['robin'], crown: ['bluetit'] },
    pendingEncounters: [
      { type: 'event', cards: ['rain'], rerolls: 0 },
      { type: 'visitor', cards: ['bramblings'], rerolls: 0 },
    ],
  });
  await openGame(page);
  await openStack(page);
  const d = encounter(page);
  await expect(d.locator('.encounter-subtitle')).toHaveCSS('font-style', 'italic');
  // Wirkungszeile aus den Daten, Zeit-Boni mit „Min.“.
  const grow = d.getByRole('button', { name: 'Alles austreiben lassen' });
  await expect(grow).toContainText('+25 % 🌿 für 5 Min.');
  await expect(d.getByRole('button', { name: 'Wasser ableiten' })).toContainText(/\+[\d.]+ 🌰 sofort/);
  // Optionen untereinander, nichts läuft quer über.
  expect(await d.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await d.locator('.encounter-cards').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  // Tastatur wie bei den Tierkarten: Fokus auf der ersten Option, Pfeiltasten wechseln.
  await expect(d.getByRole('button', { name: 'Waldtümpel entstehen lassen' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(grow).toBeFocused();
  await page.keyboard.press('Enter');

  // Gast: Bild-Symbol und Gattung im Kopf, Wirkung mit Dauer auf dem Knopf.
  await expect(d).toContainText('Bergfinken-Schwarm');
  await settle(page);
  await expect(d.locator('.encounter-hero-icon')).toBeVisible();
  await expect(d.getByRole('list', { name: 'Eckdaten' })).toHaveText('🐦 Vögel');
  // Im Kopf kein zweites kleines Symbol vor „Besuch auf der Durchreise“.
  await expect(d.locator('.encounter-kind')).toHaveText('Besuch auf der Durchreise');
  const host = d.getByRole('button', { name: /^Bewirten \(−[\d,.]+ 🌰\)$/ });
  await expect(host).toContainText('+12 % 🌿, +12 % 🌰 für 7 Min.');
  await expect(host).toBeFocused();
  await page.keyboard.press('End');
  await expect(d.getByRole('button', { name: /^Ziehen lassen/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(host).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(d).toBeHidden();

  // Aktive Boni (Reiter „Pflege“, „Gerade wirksam“): je Quelle eine Zeile, Zeit-Boni mit Restzeit-Balken.
  await openTab(page, 'forschung');
  const bonuses = page.locator('[data-ref="bonuses"]');
  await expect(bonuses.locator('[data-bonus="timed:rain"]')).toContainText('+25 % 🌿');
  await expect(bonuses.locator('[data-bonus="visitor:bramblings"]')).toContainText('+12 % 🌿, +12 % 🌰');
  const fill = bonuses.locator('[data-bonus="visitor:bramblings"] .care-bonus-fill');
  await expect(fill).toHaveAttribute('style', /--left: (100|9\d(\.\d)?)%/);
});

test('Aktive Boni: Wirkungen derselben Quelle stehen in einer Zeile, ohne Balken', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1,
    seeds: 100,
    niches: { roots: ['earthworm'] },
    pendingEncounters: [{ type: 'event', cards: ['storm'], rerolls: 0 }],
  });
  await openGame(page);
  await openStack(page);
  await encounter(page).getByRole('button', { name: 'Totholz liegen lassen' }).click();
  await expect(encounter(page)).toBeHidden();
  await openTab(page, 'forschung');
  const bonuses = page.locator('[data-ref="bonuses"]');
  await expect(bonuses.locator('.care-bonus')).toHaveCount(1);
  await expect(bonuses.locator('[data-bonus="cycle:storm"]')).toContainText('Totholz, +1 Platz Höhlen & Totholz');
  await expect(bonuses.locator('.care-bonus-bar')).toHaveCount(0);
  await expect(bonuses).toContainText('bis zum Neuen Zyklus');
});

test('Gast ohne genug Samen: „Bewirten“ per aria-disabled gesperrt, fokussierbar, Grund vorlesbar', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1,
    seeds: 0,
    niches: { roots: ['earthworm'], litter: ['robin'] },
    pendingEncounters: [{ type: 'visitor', cards: ['cranes'], rerolls: 0 }],
  });
  await openGame(page);
  await openStack(page);
  const d = encounter(page);
  const host = d.getByRole('button', { name: /^Bewirten/ });
  await expect(host).toHaveAttribute('aria-disabled', 'true');
  await expect(host).not.toHaveAttribute('disabled', '');
  await expect(host).toHaveAccessibleName(/gesperrt: Nicht genug Samen/);
  // Startfokus auf der wählbaren Option; der gesperrte Knopf bleibt per Pfeiltaste erreichbar.
  const farewell = d.getByRole('button', { name: /^Ziehen lassen/ });
  await expect(farewell).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(host).toBeFocused();
  await host.click({ force: true });
  await expect(d).toContainText('Kranichzug');
  await farewell.click();
  await expect(d).toBeHidden();
});

test('Ereignis-Karte: keine Spoiler für unentdeckte Arten – auch nicht in Attributen, mobil 360 px', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  // Pfifferling lebt schon hier (= entdeckt), die anderen Pilze des Pilzherbsts nicht.
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1,
    seeds: 100,
    niches: { roots: ['earthworm', 'chanterelle'] },
    pendingEncounters: [{ type: 'event', cards: ['mushroom-autumn'], rerolls: 0 }],
  });
  await openGame(page);
  await openStack(page);
  const d = encounter(page);
  const forced = d.getByRole('button', { name: 'Den Hüten Zeit lassen' });
  await expect(forced).toContainText('nächste Begegnung: Pfifferling oder 3 unbekannte Arten (🍄)');
  // Weder Namen noch IDs der unentdeckten Pilze stehen irgendwo im DOM (Text, title, aria, data-*).
  const html = await page.content();
  for (const name of ['Steinpilz', 'Zunderschwamm', 'Fliegenpilz']) expect(html).not.toContain(name);
  for (const id of ['porcini', 'tinder', 'flyagaric']) expect(html).not.toContain(`"${id}"`);
  // Mobil: nichts läuft quer über.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(await d.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await d.locator('.encounter-cards').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});
