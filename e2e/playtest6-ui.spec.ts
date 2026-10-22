import type { Locator } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import { expect, openGame, seedRaw, test, waypoint } from './fixtures';

/**
 * Funde aus dem Playtest Phase 6 in der Oberfläche. Stapel (K3): Symbol des Ereignisses.
 * Lage des Hinweis-Toasts (K1): Er verdeckt weder die Kamera-Knöpfe und
 * den Begegnungs-Stapel (Desktop) noch die Raten (mobil). Am Desktop liegt er in der Szene
 * über Stapel und Knöpfen, mobil oben – unter Stapel, Stufen-Banner und Update-Hinweis,
 * solange sie oben zu sehen sind (ui/toast-place.ts).
 */

const GROVE = STAGES.findIndex((s) => s.id === 'grove');

/** Hain mit einer wartenden Begegnung (Stapel sichtbar); beim Laden: „… neue Erfolge“. */
function grove(): GameState {
  const state = createInitialState(Date.now(), 99);
  state.stage = GROVE;
  state.waypoint = STAGES[GROVE]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.niches.roots = ['earthworm', 'vole'];
  state.meta.journal.species.push('earthworm', 'vole');
  state.pendingEncounters = [{ type: 'event', cards: ['storm'], rerolls: 0 }];
  return state;
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function boxesOf(locator: Locator): Promise<Box[]> {
  const out: Box[] = [];
  for (const item of await locator.all()) {
    const box = await item.boundingBox();
    if (box) out.push(box);
  }
  return out;
}

async function expectFree(toast: Box, controls: Record<string, Locator>): Promise<void> {
  for (const [name, locator] of Object.entries(controls)) {
    const boxes = await boxesOf(locator);
    expect(boxes.length, `${name} sichtbar`).toBeGreaterThan(0);
    for (const box of boxes) expect(overlaps(toast, box), `Toast verdeckt ${name}`).toBe(false);
  }
}

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
  { name: 'schmal', width: 360, height: 740 },
  { name: 'Tablett hochkant', width: 700, height: 900 },
]) {
  test(`Toast (${viewport.name}): Kamera-Knöpfe, Stapel und Raten bleiben frei`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedRaw(context, grove(), 0);
    await openGame(page);
    const toast = page.locator('#toast');
    await expect(toast).toContainText('neue Erfolge');
    await expect(page.locator('[data-ref="encounter-stack"]')).toBeVisible();
    const box = (await toast.boundingBox())!;
    await expectFree(box, {
      'Kamera-Knöpfe': page.locator('.scene-camera-button'),
      Stapel: page.locator('[data-ref="encounter-stack"]'),
      Raten: page.locator('.eco-stat'),
    });
    // Ganz zu sehen, ohne Querscrollen.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    if (viewport.width > 760) {
      // Desktop: in der Szene, nicht über der Seitenleiste.
      const scene = (await page.locator('.scene').boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(scene.x + scene.width);
    }
  });
}

test('Toast mobil, gescrollt: schwebender Stapel unten, Hinweis oben – beide frei', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRaw(context, grove(), 0);
  await openGame(page);
  const toast = page.locator('#toast');
  await expect(toast).toContainText('neue Erfolge');
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.locator('.scene-dock.floating')).toHaveCount(1);
  const box = (await toast.boundingBox())!;
  expect(box.y).toBeLessThan(100);
  await expectFree(box, { 'schwebender Stapel': page.locator('[data-ref="encounter-stack"]') });
});

test('Stapel zeigt das Symbol des vordersten Ereignisses bzw. Gasts', async ({ page, context }) => {
  const state = grove();
  state.pendingEncounters = [
    { type: 'event', cards: ['bee-swarm'], rerolls: 0 },
    { type: 'event', cards: ['storm'], rerolls: 0 },
  ];
  await seedRaw(context, state, 0);
  await openGame(page);
  const icon = page.locator('[data-ref="encounter-stack"] .stack-icon');
  await expect(icon).toHaveText('🐝');
  await expect(icon).not.toHaveText('⛈️');
});

/** Kurz vor der nächsten Stufe: Der Stufenwechsel (Banner) kommt nach wenigen Frames, der Toast „neue Erfolge“ beim Laden. */
function beforeNextStage(): GameState {
  const state = grove();
  const next = STAGES[GROVE + 1]!.waypoint;
  state.waypoint = next - 1;
  state.totalGrowth = waypoint(next) - 0.5;
  return state;
}

for (const viewport of [
  { name: 'mobil', width: 390, height: 844 },
  { name: 'schmal', width: 360, height: 740 },
  { name: 'Tablett hochkant', width: 700, height: 900 },
]) {
  test(`Stufen-Banner und Toast gleichzeitig (${viewport.name}): kein Überdecken`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedRaw(context, beforeNextStage(), 0);
    await openGame(page);
    const banner = page.locator('#stage-banner.visible');
    const toast = page.locator('#toast');
    await expect(banner).toBeVisible();
    await expect(toast).toBeVisible();
    // Lage nach dem Ausweichen (Übergang 0,2 s) – beide noch zu sehen.
    await page.waitForTimeout(400);
    await expect(banner).toHaveCount(1);
    const box = (await toast.boundingBox())!;
    await expectFree(box, { 'Stufen-Banner': banner, Stapel: page.locator('[data-ref="encounter-stack"]') });
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  });
}

test('Update-Hinweis oben: Toast weicht darunter aus (mobil)', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const state = grove();
  state.pendingEncounters = [];
  await seedRaw(context, state, 0);
  await openGame(page);
  const toast = page.locator('#toast');
  await expect(toast).toBeVisible();
  // Im e2e-Build meldet sich kein Service Worker an – derselbe Hinweis wie aus ui/pwa.ts.
  await page.evaluate(() => {
    const hint = document.createElement('div');
    hint.className = 'update-hint';
    hint.dataset.ref = 'update-hint';
    const text = document.createElement('span');
    text.className = 'update-hint-text';
    text.textContent = 'Neue Version verfügbar.';
    const reload = document.createElement('button');
    reload.className = 'update-hint-reload';
    reload.textContent = 'Neu laden';
    hint.append(text, reload);
    document.body.append(hint);
  });
  const hint = page.locator('[data-ref="update-hint"]');
  await expect(hint).toBeVisible();
  await page.waitForTimeout(400);
  await expectFree((await toast.boundingBox())!, { 'Update-Hinweis': hint });
  // Hinweis weg: Der Toast rückt wieder nach oben.
  await hint.evaluate((h) => ((h as HTMLElement).hidden = true));
  await page.waitForTimeout(400);
  expect((await toast.boundingBox())!.y).toBeLessThan(30);
});
