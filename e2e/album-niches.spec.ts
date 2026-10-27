import { expect, gotoTab, niche, openGame, seedV3, test, waypoint } from './fixtures';

/**
 * Reiter Nischen beim ersten Start (Playtest Schritt 14, S10): keine Wand aus „verschlossen“-
 * Zeilen, sondern eine aufklappbare Zeile; Lebensgemeinschaften und Nahrungsnetz erst, wenn
 * dort etwas zu sehen ist.
 */

for (const { width, height } of [
  { width: 390, height: 844 },
  { width: 1200, height: 700 },
]) {
  test(`Erster Start (${width} px): Verschlossenes in einer Zeile, keine leeren Links`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openGame(page);
    const panel = page.locator('[data-ref="page-niches"]');
    const locked = panel.locator('[data-ref="niches-locked"]');
    await expect(locked).toBeVisible();
    await expect(locked.locator('summary')).toContainText('Noch 10 Nischen und der Pflanzring verschlossen');
    await expect(locked.locator('summary')).toContainText('während der Baum wächst');
    expect((await locked.locator('summary').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Zugeklappt: keine einzelnen grauen Zeilen, keine leeren Abschnitte, keine Links.
    await expect(niche(page, 'roots')).toBeHidden();
    await expect(panel.getByRole('heading', { name: 'Am Baum' })).toBeHidden();
    await expect(panel.getByRole('heading', { name: 'Lebensräume' })).toBeHidden();
    await expect(panel.locator('[data-ref="plant-ring"]')).toBeHidden();
    await expect(panel.locator('[data-ref="communities-link"]')).toBeHidden();
    await expect(panel.locator('[data-ref="food-web-link"]')).toBeHidden();
    // Aufklappen (Tastatur): Wann sich was öffnet.
    await locked.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(niche(page, 'roots')).toBeVisible();
    await expect(niche(page, 'roots')).toContainText('öffnet bei „Keimling“');
    await expect(locked.locator('[data-ref="plant-ring-locked"]')).toContainText('Pflanzring');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test('Mit dem ersten Tier: offene Nische einzeln, Links da, Rest weiter zusammengefasst', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
  await gotoTab(page, 'nischen');
  const panel = page.locator('[data-ref="page-niches"]');
  await expect(niche(page, 'roots')).toBeVisible();
  await expect(niche(page, 'roots')).toContainText('1/2 belegt');
  await expect(panel.locator('[data-ref="communities-link"]')).toBeVisible();
  await expect(panel.locator('[data-ref="food-web-link"]')).toBeVisible();
  // Beide Links gleich eingerückt (untereinander, randbündig).
  const a = (await panel.locator('[data-ref="communities-link"]').boundingBox())!;
  const b = (await panel.locator('[data-ref="food-web-link"]').boundingBox())!;
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
  // Junger Baum: Waldwiese hat „Zur Forschung ›“ und steht einzeln; Höhlen (Alter Baum) zusammengefasst.
  await expect(niche(page, 'meadow')).toBeVisible();
  await expect(niche(page, 'hollows')).toBeHidden();
  await expect(panel.locator('[data-ref="niches-locked-text"]')).toHaveText(/^Noch \d+ Nischen verschlossen$/);
});
