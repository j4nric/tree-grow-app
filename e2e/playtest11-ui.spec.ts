import type { Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import { expect, gotoTab, openTab, seedRaw, tabPanel, test, waypoint } from './fixtures';

/**
 * Funde aus dem Playtest Phase 11 (docs/playtest/phase11.md, 5b), Teil `ui-dev`:
 * - F2: Äste mit *neu* Erforschbarem klappen mobil auf (nicht die selbst zugeklappten);
 *   „🔍 erforschbar ›“ zeigt den billigsten bezahlbaren Knoten (Ast auf, Fokus, Aufleuchten).
 * - F3: „🔍 erforschbar ›“ ohne Zahl, vorgelesen „N Knoten zur Wahl“.
 * - F4: „Alter Baum in ~N Min.“ unter der Stufenleiste; mobil „🎯“ in der Vorratsleiste.
 * - F9: „+1 Stufe“ bleibt nicht über der Forschung stehen.
 * F5, F6 (Umbrüche bei 360 px) prüft e2e/phase11.spec.ts mit großen Zahlen ohne Querscrollen,
 * F8 (Zahlen jenseits der Billion) tests/settings.test.ts.
 */

const YOUNG = STAGES.findIndex((s) => s.id === 'young-tree');

/** Junger Baum, Boden erforscht; 240 ⚖️ reichen nur für „Saatgut sortieren“ (200). */
function youngTree(): GameState {
  const state = createInitialState(Date.now(), 11);
  state.stage = YOUNG;
  state.waypoint = STAGES[YOUNG]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.seeds = 30;
  state.harmonyPoints = 240;
  state.cycle.research = ['compost', 'leaf-litter'];
  Object.assign(state.niches, { roots: ['earthworm'], litter: ['woodlouse'], edge: ['bee'] });
  state.meta.journal.species = ['earthworm', 'woodlouse', 'bee'];
  return state;
}

async function pausedClock(page: Page): Promise<void> {
  const start = new Date('2026-10-27T09:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
}

const branch = (page: Page, id: string) => page.locator(`[data-ref="care"] .research-branch[data-branch="${id}"] .research-branch-toggle`);

/** Uhr in Schritten vorstellen, bis `done` gilt (Harmonie sammelt sich). */
async function runUntil(page: Page, done: () => Promise<boolean>, stepMs = 10_000, max = 30): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await done()) return;
    await page.clock.runFor(stepMs);
  }
  throw new Error('Bedingung nicht erreicht');
}

test('390 px: neu Erforschbares klappt seinen Ast auf, selbst zugeklappte bleiben zu; „🔍 erforschbar ›“ zeigt den Knoten', async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await pausedClock(page);
  await seedRaw(context, youngTree(), 0);
  await gotoTab(page, 'forschung');

  // Anfangs nur der Ast mit Erforschbarem offen (wie bisher).
  await expect(branch(page, 'seed')).toHaveAttribute('aria-expanded', 'true');
  await expect(branch(page, 'crown')).toHaveAttribute('aria-expanded', 'false');
  await expect(branch(page, 'hem')).toHaveAttribute('aria-expanded', 'false');

  // Nistkästen (250 ⚖️) werden erforschbar → Krone klappt von allein auf.
  await runUntil(page, async () => (await branch(page, 'crown').getAttribute('aria-expanded')) === 'true');
  await expect(branch(page, 'hem')).toHaveAttribute('aria-expanded', 'false');
  // Selbst zugeklappt bleibt zu – auch wenn danach der Saum (300 ⚖️) neu erforschbar wird.
  await branch(page, 'crown').click();
  await branch(page, 'seed').click();
  await expect(branch(page, 'seed')).toHaveAttribute('aria-expanded', 'false');
  await runUntil(page, async () => (await branch(page, 'hem').getAttribute('aria-expanded')) === 'true');
  await expect(branch(page, 'crown')).toHaveAttribute('aria-expanded', 'false');
  await expect(branch(page, 'seed')).toHaveAttribute('aria-expanded', 'false');

  // Sprung aus der Zielzeile: ohne Zahl, vorgelesen mit „zur Wahl“; zeigt den billigsten
  // bezahlbaren Knoten (Saatgut sortieren, 200 ⚖️) – im zugeklappten Ast Saat.
  await openTab(page, 'nischen');
  await page.evaluate(() => window.scrollTo(0, 0));
  const jump = page.locator('[data-ref="goal-line-research"]');
  await expect(jump).toHaveText('🔍 erforschbar ›');
  await expect(jump).toHaveAttribute('aria-label', /^Erforschbar: \d+ Knoten zur Wahl – zur Forschung$/);
  await jump.click();
  await expect(tabPanel(page, 'forschung')).toBeVisible();
  await expect(branch(page, 'seed')).toHaveAttribute('aria-expanded', 'true');
  const name = page.locator('[data-ref="care"] [data-research-name="seed-sorting"]');
  await expect(name).toBeFocused();
  await expect(name).toBeInViewport();
});

test('390 px: „+1 Stufe“ verschwindet beim Reiterwechsel; Restzeit zur nächsten Stufe und 🎯 in der Vorratsleiste', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pausedClock(page);
  const state = youngTree();
  state.seeds = 5000;
  await seedRaw(context, state, 0);
  await gotoTab(page, 'nischen');

  // F4: mittelfristiges Ziel unter der Stufenleiste.
  await expect(page.locator('[data-ref="stage-eta"]')).toHaveText(/^Alter Baum in (~\d+ (Min\.|Std\.)|unter 1 Min\.)/);

  // F9: Kauf → „+1 Stufe“ schwebt; Reiterwechsel nimmt die Notiz mit.
  const buy = tabPanel(page, 'nischen').locator('[data-ref="tree-upgrades"] [data-part="rings"] .upgrade-button');
  await buy.scrollIntoViewIfNeeded();
  await buy.click();
  const floats = page.locator('.float-layer .float-note');
  await expect(floats.filter({ hasText: '+1 Stufe' })).toHaveCount(1);
  await openTab(page, 'forschung');
  await expect(floats.filter({ hasText: '+1 Stufe' })).toHaveCount(0);

  // F4 mobil: weit unten in R:Nischen steht das Ziel als 🎯 in der Vorratsleiste und springt.
  await openTab(page, 'nischen');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const goal = page.locator('[data-ref="supply-goal"]');
  await expect(goal).toBeVisible();
  await expect(goal).toHaveText(/^🎯 (Jetzt ›|in \d+:\d\d|›)/);
  const box = (await goal.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  // Trefferfläche (::after) reicht bis an die Reiter heran, aber nicht darüber (supply-bar.css).
  const hit = await goal.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const after = getComputedStyle(node, '::after');
    return r.height - parseFloat(after.bottom);
  });
  const tabTop = await page.locator('[data-ref="tabs"] [role="tab"]').first().evaluate((n) => n.getBoundingClientRect().top);
  expect(hit).toBeGreaterThanOrEqual(36);
  expect(box.y + hit).toBeLessThanOrEqual(tabTop + 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await goal.click();
  await expect(tabPanel(page, 'nischen')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-ref="page-niches"]'))).toBe(true);
});

test('Desktop: Restzeit zur nächsten Stufe neben dem Hinweis, keine Vorratsleiste', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await pausedClock(page);
  await seedRaw(context, youngTree(), 0);
  await gotoTab(page, 'nischen');
  await expect(page.locator('[data-ref="stage-eta"]')).toBeVisible();
  await expect(page.locator('[data-ref="stage-eta"]')).toHaveText(/^Alter Baum in /);
  await expect(page.locator('[data-ref="supply-goal"]')).toBeHidden();
});
