import type { Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import { expect, landscapeUnlockState, openGame, seedRaw, stamp, stamps, test, waypoint } from './fixtures';

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
  state.cycle.research = ['meadow'];
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
  await page.locator('[data-ref="food-web-link"]').click();
  await expect(miceHint(page)).toHaveText('Das Mäusejahr wartet unter deinen Begegnungen – dort kannst du Jäger einladen.');

  // Der Zettelstapel blättert von U:Nahrungsnetz aus zu U:Begegnung um (Ebene 2) …
  await page.locator('[data-ref="encounter-stack"]').click();
  const sheet = page.locator('[data-ref="page-encounter"]');
  await expect(sheet).toContainText('Mäusejahr');
  await page.waitForTimeout(400); // Eingabesperre nach neuen Karten
  await sheet.getByRole('button', { name: /Vorräte anlegen lassen/ }).click();
  // … und nach der letzten Entscheidung von selbst zurück aufs Nahrungsnetz.
  await expect(sheet).toBeHidden();
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
   * höchstens 26rem, ganz im Bild. Der Hinweis „Landschaft frei“ ist so ein langer Text (die
   * Rückkehr stempelt seit Playtest Schritt 14 nur noch kurz – die Kurzfassung steht im Zettel).
   */
  test(`Langer Hinweis (${viewport.name}): Zettel nutzt die Breite, nichts scrollt quer`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedRaw(context, landscapeUnlockState(), 0);
    await openGame(page);
    const slip = stamp(page);
    await expect(slip).toContainText('Eichelhäher');
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
