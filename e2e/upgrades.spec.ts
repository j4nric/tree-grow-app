import type { Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState } from '../src/core/state';
import {
  expect,
  gotoTab,
  niche,
  openGoalsPage,
  savedState,
  seedRaw,
  seedsValue,
  stamps,
  tabPanel,
  test,
  waypoint,
} from './fixtures';

/**
 * Ausbau im Album (Phase 11, 4b; DESIGN_V2.md 28.9): Fußzeile je Nische, „🌳 Dein Baum“,
 * Kaufmenge ×1/×10/Max (gemerkt in den Einstellungen), Meilenstein 25 mit Stempel, neuem Platz
 * und Abzeichen, verschlossene Nische ohne Knopf, Statistik „Höchste Ausbaustufen“ – mobil
 * bei 360 und 390 px ohne Querscrollen, Knöpfe ≥ 44 px.
 */

/** Junger Baum, ein Regenwurm, Wurzelraum kurz vor Meilenstein 25. */
function upgradeState(seeds: number) {
  const stage = STAGES.findIndex((s) => s.id === 'young-tree');
  const state = createInitialState(Date.now(), 777);
  state.stage = stage;
  state.waypoint = STAGES[stage]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.seeds = seeds;
  state.niches.roots = ['earthworm'];
  state.meta.journal.species = ['earthworm'];
  state.cycle.upgrades.niches.roots = 24;
  state.meta.upgrades.best.niches.roots = 24;
  return state;
}

async function noOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [...document.querySelectorAll<HTMLElement>('[data-ref="page-niches"] *')]
      // Gattungen scrollen bewusst waagerecht in ihrer eigenen Reihe (ALBUM_UI.md B.1).
      .filter((e) => !e.closest('.family-row'))
      .filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > doc.clientWidth + 0.5)
      .map((e) => e.className);
    return { scroll: doc.scrollWidth - doc.clientWidth, wide };
  });
  expect(overflow).toEqual({ scroll: 0, wide: [] });
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-ref="page-niches"] .upgrade-button, [data-ref="page-niches"] .buy-amount-option')]
      .filter((b) => b.getClientRects().length > 0)
      .filter((b) => b.getBoundingClientRect().height < 43.5)
      .map((b) => b.textContent),
  );
  expect(small).toEqual([]);
}

for (const width of [360, 390]) {
  test(`${width} px: Meilenstein 25 mit Stempel, neuem Platz und Abzeichen; ×10 und Max; bleibt nach dem Neuladen`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await seedRaw(context, upgradeState(2000), 0);
    await gotoTab(page, 'nischen');
    const panel = tabPanel(page, 'nischen');
    const roots = niche(page, 'roots');
    const footer = roots.locator('[data-ref="niche-upgrade"]');
    await expect(footer.locator('.upgrade-level-text')).toHaveText('St. 24');
    await expect(footer.locator('.upgrade-progress-label')).toHaveText('25: +1 Platz');
    await expect(footer.locator('[data-ref="upgrade-buy"]')).toContainText('Ausbauen · 287 🌰');
    await expect(roots.locator('[data-ref="upgrade-badge"]')).toBeHidden();
    // Verschlossene Nische (Höhlen vor dem Alten Baum): keine Fußzeile, kein Knopf.
    await expect(niche(page, 'hollows').locator('[data-ref="niche-upgrade"]')).toBeHidden();
    await noOverflow(page);
    await info.attach(`upgrades-${width}-vorher.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    const slots = await roots.locator('.sticker-slot:not([hidden])').count();
    await footer.locator('[data-ref="upgrade-buy"]').click();
    await expect(footer.locator('.upgrade-level-text')).toHaveText('St. 25');
    await expect(stamps(page)).toContainText('Gut bewohnt!');
    await expect(roots.locator('.sticker-slot:not([hidden])')).toHaveCount(slots + 1);
    await expect(roots.locator('[data-ref="upgrade-badge"]')).toHaveText('⭑ Bronze');
    await expect(footer.locator('.upgrade-progress-label')).toHaveText('50: Seltene öfter');

    // ×10: Baumteil Jahresringe 0 → 10 (blass, bis die Samen reichen – hier reichen sie).
    const switcher = panel.locator('[data-ref="buy-amount"]');
    await switcher.locator('[data-amount="10"]').click();
    await expect(switcher.locator('[data-amount="10"]')).toHaveAttribute('aria-pressed', 'true');
    const rings = panel.locator('[data-ref="tree-upgrades"] [data-part="rings"]');
    await expect(rings.locator('[data-ref="upgrade-buy"]')).toContainText('+10 ·');
    await rings.locator('[data-ref="upgrade-buy"]').click();
    await expect(rings.locator('.upgrade-level-text')).toHaveText('St. 10');

    // Max: so viele Stufen, wie die Samen reichen – danach reicht es für keine mehr.
    await switcher.locator('[data-amount="max"]').click();
    const leaves = panel.locator('[data-ref="tree-upgrades"] [data-part="leaves"]');
    await expect(leaves.locator('[data-ref="upgrade-buy"]')).toContainText(/^\+\d+ · Max/);
    await leaves.locator('[data-ref="upgrade-buy"]').click();
    await expect(leaves.locator('[data-ref="upgrade-buy"]')).toHaveAttribute('aria-disabled', 'true');
    await noOverflow(page);
    await info.attach(`upgrades-${width}-nachher.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    const saved = await savedState(page);
    expect(saved.cycle.upgrades.niches.roots).toBe(25);
    expect(saved.cycle.upgrades.tree.rings).toBe(10);
    expect(saved.cycle.upgrades.tree.leaves).toBeGreaterThan(5);
    expect(saved.meta.upgrades.best.niches.roots).toBe(25);
    expect(saved.seeds).toBeLessThan(2000);

    // Neuladen: Stufen bleiben, die Kaufmenge auch (Einstellung, nicht Spielstand).
    await page.reload();
    await expect(niche(page, 'roots').locator('.upgrade-level-text')).toHaveText('St. 25');
    await expect(tabPanel(page, 'nischen').locator('[data-ref="buy-amount"] [data-amount="max"]')).toHaveAttribute('aria-pressed', 'true');
  });
}

test('Zu teuer: blass mit Wartezeit, kauft nicht; Statistik „Höchste Ausbaustufen“', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = upgradeState(0);
  state.meta.upgrades.best.niches.roots = 52;
  await seedRaw(context, state, 0);
  await gotoTab(page, 'nischen');
  const roots = niche(page, 'roots');
  const button = roots.locator('[data-ref="upgrade-buy"]');
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(roots.locator('[data-ref="upgrade-badge"]')).toHaveText('⭑ Silber');
  await button.click({ force: true });
  await expect(roots.locator('.upgrade-level-text')).toHaveText('St. 24');
  expect(Number(await seedsValue(page).textContent().then((t) => (t ?? '').replace(/\D/g, '') || '0'))).toBeLessThan(287);

  const stats = await openGoalsPage(page, 'stats');
  await expect(stats.locator('[data-stat="total-upgrade-best"]')).toContainText('Wurzelraum 52 · Silber');
  await expect(stats.locator('[data-stat="total-upgrades"]')).toContainText('Ausbaustufen gekauft');
});
