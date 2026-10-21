import { expect, niche, openGame, savedState, seedV3, test, waypoint } from './fixtures';

/**
 * Pflegemaßnahmen (Schritt 2.7): eine Maßnahme kaufen, die Wirkung sehen (ein Platz mehr
 * in der Laubstreu), Neuladen behält den Rang.
 */
test('Pflege kaufen: Samen weg, ein Platz mehr, nächster Rang gesperrt – auch nach dem Neuladen', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(6) + 1, // Junger Baum: Laubstreu hat 2 Plätze
    seeds: 1000,
    niches: { roots: ['earthworm'], litter: ['robin'] },
  });
  await openGame(page);
  const care = page.locator('[data-ref="care"]');
  const litter = care.locator('[data-care="leaf-litter"]');
  await expect(litter).toContainText('Laub liegen lassen');
  await expect(litter).toContainText('Rang 1/2');
  await expect(litter).toContainText('+1 Platz Laubstreu');
  await expect(niche(page, 'litter')).toContainText('1/2 belegt');
  // Maßnahmen ab Alter Baum (z. B. Lichte Krone) stehen noch nicht in der Liste.
  await expect(care.locator('[data-care="light-crown"]')).toHaveCount(0);

  await litter.getByRole('button', { name: 'Kaufen (600 🌰)' }).click();

  await expect(niche(page, 'litter')).toContainText('1/3 belegt');
  await expect(litter).toContainText('Rang 2/2');
  await expect(litter.locator('[data-ref="care-blocker"]')).toHaveText('Ab Stufe „Hain“');
  // Gesperrt per aria-disabled (nicht `disabled`): bleibt fokussierbar, Grund wird vorgelesen.
  const locked = litter.getByRole('button', { name: /Kaufen/ });
  await expect(locked).toHaveAttribute('aria-disabled', 'true');
  await expect(locked).toHaveAccessibleName(/gesperrt: Ab Stufe „Hain“/);
  await expect(locked).toBeDisabled();
  // Klick auf den gesperrten Knopf kauft nichts.
  await locked.click({ force: true });
  await expect(litter).toContainText('Rang 2/2');
  const saved = await savedState(page);
  expect(saved.cycle.care).toEqual({ 'leaf-litter': 1 });
  expect(saved.seeds).toBeLessThan(450);

  await page.reload();
  await expect(care.locator('[data-care="leaf-litter"]')).toContainText('Rang 2/2');
  await expect(niche(page, 'litter')).toContainText('1/3 belegt');
  expect((await savedState(page)).cycle.care).toEqual({ 'leaf-litter': 1 });
});

test('Pflege per Tastatur: Fokus bleibt auf dem Knopf, nach dem letzten Rang auf dem Titel', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain: beide Ränge von „Laub liegen lassen“ kaufbar
    seeds: 100_000,
    niches: { roots: ['earthworm'] },
  });
  await openGame(page);
  const litter = page.locator('[data-ref="care"] [data-care="leaf-litter"]');
  const buy = litter.locator('[data-buy-care="leaf-litter"]');
  await expect(buy).toHaveText('Kaufen (600 🌰)');
  await buy.focus();
  await page.keyboard.press('Enter');
  await expect(litter).toContainText('Rang 2/2');
  // Neu gebauter Knopf (nächster Rang) hat den Fokus übernommen.
  await expect(buy).toHaveText(/Kaufen \(4[.,]000 🌰\)/);
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
  await openGame(page);
  const care = page.locator('[data-ref="care"]');
  const litter = care.locator('[data-care="leaf-litter"]');
  await litter.locator('[data-buy-care="leaf-litter"]').dblclick();
  await expect(litter).toContainText('Rang 2/2');
  await page.waitForTimeout(450);
  expect((await savedState(page)).cycle.care).toEqual({ 'leaf-litter': 1 });

  // Gehaltene Enter-Taste: Playwright meldet weitere keydown mit `repeat`.
  const pond = care.locator('[data-care="pond"]');
  await pond.locator('[data-buy-care="pond"]').focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(pond).toContainText('Rang 2/2');
  await page.waitForTimeout(450);
  expect((await savedState(page)).cycle.care).toEqual({ 'leaf-litter': 1, pond: 1 });
});
