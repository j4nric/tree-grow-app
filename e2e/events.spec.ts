import { dialog, expect, openGame, openStack, savedState, seedV3, settle, test, waypoint } from './fixtures';

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
  await openGame(page);
  const bonuses = page.locator('[data-ref="bonuses"]');
  await expect(bonuses).toBeHidden();

  await openStack(page);
  await expect(dialog(page)).toContainText('Mittsommer');
  await expect(dialog(page)).toContainText('Die längsten Tage des Jahres');
  // Ereignis: Optionsknöpfe statt „Wählen“, kein Ablehnen, kein Neu würfeln.
  await expect(dialog(page).getByRole('button', { name: 'Alles blühen lassen' })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: /Neu würfeln/ })).toBeHidden();
  await dialog(page).getByRole('button', { name: 'Lange Tage nutzen' }).click();

  // Nächste Begegnung: der Gast.
  await expect(dialog(page)).toContainText('Kranichzug');
  await settle(page);
  await expect(dialog(page).getByRole('button', { name: /^Ziehen lassen \(\+[\d,.]+ 🌰\)$/ })).toBeVisible();
  await dialog(page).getByRole('button', { name: /^Bewirten \(−[\d,.]+ 🌰\)$/ }).click();
  await expect(dialog(page)).toBeHidden();

  await expect(bonuses).toBeVisible();
  await expect(bonuses.locator('[data-bonus^="timed:midsummer"]')).toContainText('+30 % 🌿');
  await expect(bonuses.locator('[data-bonus^="timed:midsummer"]')).toContainText(/noch \d+ Min\./);
  await expect(bonuses.locator('[data-bonus="visitor:cranes"]')).toContainText('Kranichzug');

  const saved = await savedState(page);
  expect(saved.version).toBe(5);
  expect(saved.cycle.timed).toHaveLength(1);
  expect(saved.cycle.visitors).toEqual([expect.objectContaining({ id: 'cranes' })]);
  expect(saved.seeds).toBeLessThan(5000);

  await page.reload();
  await expect(bonuses.locator('[data-bonus^="timed:midsummer"]')).toBeVisible();
  await expect(bonuses.locator('[data-bonus="visitor:cranes"]')).toBeVisible();
  const again = await savedState(page);
  expect(again.cycle.visitors).toEqual([expect.objectContaining({ id: 'cranes' })]);
});
