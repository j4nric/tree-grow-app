import { expect, gotoTab, niche, savedState, seedV3, tabPanel, test, waypoint } from './fixtures';

/**
 * Ausbau, einfache Fassung (Phase 11, 2a; DESIGN_V2.md 28.4): Knopf „Ausbauen · Preis“ je offener
 * Nische und drei Baum-Zeilen „🌳 Dein Baum“ im Reiter Nischen – kaufen, speichern, neu laden.
 * Die ausgefeilte Ansicht (Kaufmenge, Meilenstein-Balken) prüft 5a nach 4b.
 */

test('Nische und Baum ausbauen: Stufe steigt, Samen sinken, bleibt nach dem Neuladen', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Junger Baum, ein Regenwurm im Wurzelraum, genug Samen für ein paar Stufen.
  await seedV3(context, { totalGrowth: waypoint(6) + 1, seeds: 200, niches: { roots: ['earthworm'] } });
  await gotoTab(page, 'nischen');
  const panel = tabPanel(page, 'nischen');
  const roots = niche(page, 'roots').locator('[data-ref="upgrade"]');
  await expect(roots).toContainText('St. 0');
  await expect(roots.locator('[data-ref="upgrade-button"]')).toHaveText('Ausbauen · 10 🌰');
  // Verschlossene Nische (Höhlen vor dem Alten Baum): kein Knopf.
  await expect(niche(page, 'hollows').locator('[data-ref="upgrade"]')).toBeHidden();
  await roots.locator('[data-ref="upgrade-button"]').click();
  await expect(roots).toContainText('St. 1');
  await expect(roots.locator('[data-ref="upgrade-button"]')).toHaveText('Ausbauen · 12 🌰');

  const tree = panel.locator('[data-ref="tree-upgrades"]');
  await expect(tree).toBeVisible();
  await expect(tree.locator('[data-ref="upgrade"]')).toHaveCount(3);
  const rings = tree.locator('[data-upgrade="rings"]');
  await expect(rings).toContainText('Jahresringe');
  await rings.locator('[data-ref="upgrade-button"]').click();
  await expect(rings).toContainText('St. 1');
  const button = rings.locator('[data-ref="upgrade-button"]');
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  const saved = await savedState(page);
  expect(saved.cycle.upgrades).toEqual({ niches: { roots: 1 }, tree: { rings: 1 } });
  expect(saved.meta.upgrades.best).toEqual({ niches: { roots: 1 }, tree: { rings: 1 } });
  expect(saved.meta.stats.upgradesBought).toBe(2);
  expect(saved.meta.stats.upgradeSeeds).toBe(25);

  await page.reload();
  await expect(niche(page, 'roots').locator('[data-ref="upgrade"]')).toContainText('St. 1');
  await expect(tabPanel(page, 'nischen').locator('[data-upgrade="rings"]')).toContainText('St. 1');
});
