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
  await expect(litter.getByRole('button', { name: /Kaufen/ })).toBeDisabled();
  const saved = await savedState(page);
  expect(saved.cycle.care).toEqual({ 'leaf-litter': 1 });
  expect(saved.seeds).toBeLessThan(450);

  await page.reload();
  await expect(care.locator('[data-care="leaf-litter"]')).toContainText('Rang 2/2');
  await expect(niche(page, 'litter')).toContainText('1/3 belegt');
  expect((await savedState(page)).cycle.care).toEqual({ 'leaf-litter': 1 });
});
