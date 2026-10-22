import type { Locator } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import { expect, openGame, seedRaw, settledStamp, stamp, test, waypoint } from './fixtures';

/**
 * Funde aus dem Playtest Phase 6 in der Oberfläche. Stapel (K3): Symbol des Ereignisses.
 * Lage der Meldungen (K1, jetzt Stempel und Zettel, docs/ALBUM_UI.md C.5): Sie verdecken
 * weder den Zettelstapel noch die Etiketten. Auf der Doppelseite liegen sie oben über der
 * rechten Seite, mobil oben – unter einer sichtbaren Banderole. Fester Platz statt
 * Ausweichen; Klicks gehen durch (smoke.spec.ts).
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
    for (const box of boxes) expect(overlaps(toast, box), `Meldung verdeckt ${name}`).toBe(false);
  }
}

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
  { name: 'schmal', width: 360, height: 740 },
  { name: 'Tablett hochkant', width: 700, height: 900 },
]) {
  test(`Stempel (${viewport.name}): Stapel und Raten bleiben frei`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedRaw(context, grove(), 0);
    await openGame(page);
    await expect(stamp(page)).toContainText('neue Erfolge');
    const toast = await settledStamp(page);
    await expect(page.locator('[data-ref="encounter-stack"]')).toBeVisible();
    const box = (await toast.boundingBox())!;
    await expectFree(box, {
      Stapel: page.locator('[data-ref="encounter-stack"]'),
      Raten: page.locator('.tape-label'),
    });
    // Ganz zu sehen, ohne Querscrollen.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    if (viewport.width > 760) {
      // Doppelseite: oben im Buch, unter dem Kopf mit Umschlag-Knopf und Zettelstapel.
      const head = (await page.locator('.album-head').boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
    }
  });
}

test('Stempel mobil, gescrollt: Meldung unten über dem Zettelstapel, Reiterleiste oben frei', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRaw(context, grove(), 0);
  await openGame(page);
  await expect(stamp(page)).toContainText('neue Erfolge');
  const toast = await settledStamp(page);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.locator('[data-ref="encounter-stack"]')).toBeInViewport();
  // Gescrollt klebt oben die Reiterleiste: Die Meldung rückt nach unten (Schritt 12).
  await expect.poll(async () => (await toast.boundingBox())!.y).toBeGreaterThan(422);
  const box = (await toast.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await expectFree(box, {
    'schwebender Stapel': page.locator('[data-ref="encounter-stack"]'),
    Reiterleiste: page.locator('[data-ref="tabs"]'),
  });
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

test('Banderole oben: Meldungen rücken darunter, die Banderole bleibt frei (mobil)', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const state = grove();
  state.pendingEncounters = [];
  await seedRaw(context, state, 0);
  await openGame(page);
  await expect(stamp(page)).toBeVisible();
  const toast = await settledStamp(page);
  const before = (await toast.boundingBox())!;
  // Im e2e-Build meldet sich kein Service Worker an – eine Banderole wie aus ui/pwa.ts.
  await page.evaluate(() => {
    const band = document.createElement('div');
    band.className = 'banderole banderole-tape';
    band.dataset.ref = 'update-hint';
    const text = document.createElement('p');
    text.className = 'banderole-text';
    text.textContent = 'Neue Version verfügbar –';
    const reload = document.createElement('button');
    reload.className = 'banderole-button';
    reload.textContent = 'neu laden';
    band.append(text, reload);
    document.querySelector('.album-banners')!.append(band);
  });
  const hint = page.locator('[data-ref="update-hint"]');
  await expect(hint).toBeVisible();
  await expect.poll(async () => (await toast.boundingBox())!.y).toBeGreaterThan(before.y);
  await expectFree((await toast.boundingBox())!, { Banderole: hint });
  // Banderole weg: Die Meldung rückt wieder nach oben.
  await hint.evaluate((h) => ((h as HTMLElement).hidden = true));
  await expect.poll(async () => (await toast.boundingBox())!.y).toBeLessThanOrEqual(before.y + 1);
});
