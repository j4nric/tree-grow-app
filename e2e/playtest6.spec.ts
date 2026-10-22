import type { Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import { expect, openGame, seedRaw, stamp, stamps, test, waypoint } from './fixtures';

/**
 * Funde aus dem Playtest Phase 6 (Tag/Nacht, Wetter, Räuber und Beute, Lebensräume,
 * Landschaft): Breite langer Hinweise mobil und der Hinweis zu einem Massenjahr, das noch
 * im Stapel wartet.
 */

const GROVE = STAGES.findIndex((s) => s.id === 'grove');

/** Hain mit Wühlmaus und Feldmaus ohne Jäger (Kleinsäuger ungejagt), Waldwiese offen. */
function grove(): GameState {
  const state = createInitialState(Date.now(), 99);
  state.stage = GROVE;
  state.waypoint = STAGES[GROVE]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.seeds = 5_000;
  state.cycle.care = { meadow: 1 };
  state.niches.roots = ['earthworm', 'vole'];
  state.niches.meadow = ['fieldmouse'];
  state.meta.journal.species.push('earthworm', 'vole', 'fieldmouse');
  return state;
}

const miceHint = (page: Page) => page.locator('[data-ref="food-web"] [data-tag="kleinsaeuger"] [data-ref="food-web-hint"]');

test('Massenjahr im Stapel: Nahrungsnetz sagt „wartet“, nach der Wahl „war schon“', async ({ page, context }) => {
  const state = grove();
  // Gezogen (steht in `seen`), aber noch nicht entschieden.
  state.cycle.seen = ['vole-year'];
  state.pendingEncounters = [{ type: 'event', cards: ['vole-year'], rerolls: 0 }];
  await seedRaw(context, state, 0);
  await openGame(page);
  await page.locator('[data-ref="food-web"] summary').click();
  await expect(miceHint(page)).toHaveText('Das Mäusejahr wartet unter deinen Begegnungen – dort kannst du Jäger einladen.');

  await page.locator('[data-ref="encounter-stack"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Mäusejahr');
  await page.waitForTimeout(400); // Eingabesperre nach neuen Karten
  await dialog.getByRole('button', { name: /Vorräte anlegen lassen/ }).click();
  await expect(dialog).toBeHidden();
  await expect(miceHint(page)).toHaveText('Das Mäusejahr war schon – ein Jäger fände hier Futter.');
});

for (const viewport of [
  { name: 'mobil', width: 390, height: 844 },
  { name: 'schmal', width: 360, height: 740 },
  { name: 'Desktop', width: 1280, height: 800 },
]) {
  /*
   * Breite langer Hinweise: Lange Meldungen (über 90 Zeichen) stehen als Zettel in der
   * Meldungsschicht (docs/ALBUM_UI.md, C.5) – breit statt als schmaler, sehr hoher Block,
   * höchstens 26rem, ganz im Bild. Die Rückkehr-Kurzfassung mit Verweis auf den Bericht ist
   * so ein langer Text.
   */
  test(`Lange Rückkehr-Meldung (${viewport.name}): Zettel nutzt die Breite, nichts scrollt quer`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedRaw(context, grove(), -3 * 3600_000);
    await openGame(page);
    const slip = stamp(page);
    await expect(slip).toContainText('Willkommen zurück!');
    await expect(slip).toHaveAttribute('data-kind', 'slip');
    // Layoutbreite (ohne die leichte Drehung) gegen die Breite der Schicht.
    const { width, layer } = await slip.evaluate((node) => ({
      width: (node as HTMLElement).offsetWidth,
      layer: (node.parentElement as HTMLElement).clientWidth,
    }));
    const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(width).toBe(Math.min(layer, Math.round(26 * rem)));
    expect(layer).toBeGreaterThanOrEqual(Math.min(viewport.width - 82, 26 * rem));
    const box = (await slip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await stamps(page).getAttribute('role')).toBe('status');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
