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
  seedV3,
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

test('Zielzeile (2c): nennt den billigsten Ausbau, springt zu den Nischen, wählt nach dem Kauf neu', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Junger Baum mit vollem Pflanzring (kein „Säen“), Regenwurm im Wurzelraum.
  await seedV3(context, { totalGrowth: waypoint(6) + 1, seeds: 200, plants: ['moss', 'fern', 'hazel'], niches: { roots: ['earthworm'] } });
  await gotoTab(page, 'ziele');
  const line = page.locator('[data-ref="goal-line"]');
  const jump = line.locator('[data-ref="goal-line-jump"]');
  await expect(jump).toHaveText(/^Jetzt: 🪱 Wurzelraum St\. 1 · 10\s🌰 ›$/);
  expect((await jump.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await jump.click();
  await expect(tabPanel(page, 'nischen')).toBeVisible();
  // Kauf in der Fußzeile der Nische (4b) → die Zielzeile wählt neu.
  await niche(page, 'roots').locator('[data-ref="niche-upgrade"] [data-ref="upgrade-buy"]').click();
  await expect(niche(page, 'roots').locator('.upgrade-level-text')).toHaveText('St. 1');
  await expect(jump).toHaveText(/^Jetzt: 🪱 Wurzelraum St\. 2 · 12\s🌰 ›$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

/** Der Sprung der Zielzeile hat die Zeile ins Bild geholt, hebt sie hervor und setzt den Fokus. */
async function expectRevealed(page: Page, row: ReturnType<Page['locator']>, focus: ReturnType<Page['locator']>): Promise<void> {
  await expect(row).toHaveClass(/goal-flash/);
  await expect(focus).toBeFocused();
  // Ganz zu sehen und nicht unter der klebenden Reiterleiste bzw. Vorratsleiste.
  await expect.poll(async () => {
    const box = (await row.boundingBox())!;
    const strip = (await page.locator('.tab-strip').boundingBox())!;
    return box.y >= strip.y + strip.height - 1 && box.y < page.viewportSize()!.height;
  }).toBe(true);
}

for (const width of [360, 390]) {
  test(`${width} px: Zielzeile (4c) springt zum Baumteil; aria-live nur beim Zielwechsel`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 740 });
    // Junger Baum, Ring voll, Wurzelraum auf 30: der billigste Ausbau ist ein Baumteil.
    const state = upgradeState(0);
    state.plants = ['moss', 'fern', 'hazel'];
    state.cycle.upgrades.niches.roots = 30;
    state.meta.upgrades.best.niches.roots = 30;
    await seedRaw(context, state, 0);
    await gotoTab(page, 'ziele');
    const line = page.locator('[data-ref="goal-line"]');
    const jump = line.locator('[data-ref="goal-line-jump"]');
    const live = line.locator('[aria-live="polite"]');
    await expect(jump).toHaveText(/^Nächstes: 🪵 Jahresringe St\. 1 · 15\s🌰/);
    // Beim Laden und während der Countdown läuft: nichts angesagt.
    const before = await jump.textContent();
    await expect.poll(() => jump.textContent(), { timeout: 15_000 }).not.toBe(before);
    await expect(live).toBeEmpty();

    await jump.click();
    await expect(tabPanel(page, 'nischen')).toBeVisible();
    const part = page.locator('[data-part="rings"]');
    await expectRevealed(page, part, part.locator('.upgrade-part-title'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // Warten, bis die Samen reichen, kaufen → neues Ziel (Stufe 2 oder ein anderer Baumteil), angesagt.
    await expect(jump).toHaveText(/^Jetzt: 🪵 Jahresringe St\. 1/, { timeout: 30_000 });
    await expect(live).toBeEmpty();
    await part.locator('[data-ref="upgrade-buy"]').click();
    await expect(jump).not.toHaveText(/Jahresringe St\. 1 /);
    await expect(live).toHaveText(/^Nächstes Ziel: /);
  });
}

test('Zielzeile (4c): Säen springt zum Pflanzring', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Leerer Pflanzring: die erste Aussaat ist gratis und gewinnt (kein Meilenstein in Reichweite).
  const state = upgradeState(0);
  state.cycle.upgrades.niches.roots = 30;
  await seedRaw(context, state, 0);
  await gotoTab(page, 'ziele');
  const jump = page.locator('[data-ref="goal-line-jump"]');
  await expect(jump).toHaveText(/^Jetzt: 🌱 Säen/);
  await jump.click();
  const ring = page.locator('[data-ref="plant-ring"]');
  await expectRevealed(page, ring, ring.locator('.niches-heading'));
  await expect(page.locator('[data-ref="sow"]')).toBeInViewport();
});

test('Zielzeile (4c): Meilenstein-Ziel springt zur Zeile der Nische', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Wurzelraum 24 mit 2.000 Samen und vollem Ring: Meilenstein 25 gewinnt (Regel 2).
  const full = upgradeState(2000);
  full.plants = ['moss', 'fern', 'hazel'];
  await seedRaw(context, full, 0);
  await gotoTab(page, 'arten');
  const jump = page.locator('[data-ref="goal-line-jump"]');
  await expect(jump).toHaveText(/^Jetzt: 🪱 Wurzelraum St\. 25 \(\+1 Platz\)/);
  await jump.click();
  await expect(tabPanel(page, 'nischen')).toBeVisible();
  await expectRevealed(page, niche(page, 'roots'), niche(page, 'roots').locator('.nrow-title'));
});
