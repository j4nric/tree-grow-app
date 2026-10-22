import type { Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import { expect, openGame, seedRaw, test, waypoint } from './fixtures';

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
   * Breite langer Hinweise (CSS: width max-content, max-width min(100% − 32 px, 40rem)).
   * Mobil steht nach der Rückkehr nur noch die Kurzfassung im Toast (Rückkehr-Bericht,
   * e2e/return-report.spec.ts) – deren Breite hängt vom Inhalt ab und taugt nicht als Prüfung.
   * Lange Hinweise gibt es mobil trotzdem (z. B. Zusatzhinweise ohne Begrüßung). Darum
   * schreibt der Test die ganze Rückkehr-Meldung aus dem Bericht in den Toast: Sie ist sicher
   * länger als eine Zeile und muss die volle Breite nutzen. Am Desktop zeigt der Toast sie
   * ohnehin selbst.
   */
  test(`Lange Rückkehr-Meldung (${viewport.name}): Toast nutzt die Breite, nichts scrollt quer`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedRaw(context, grove(), -3 * 3600_000);
    await openGame(page);
    const toast = page.locator('#toast');
    await expect(toast).toContainText('Willkommen zurück!');
    const items = await page.locator('[data-ref="return-report-list"] li').allTextContents();
    const full = items.join(' ');
    expect(full.length).toBeGreaterThan(150);
    if (viewport.width <= 760) {
      // Den Toast mit der langen Meldung füllen und sichtbar halten (sein Zeitgeber ist egal).
      await toast.evaluate((node, text) => {
        node.textContent = text;
        (node as HTMLElement).hidden = false;
      }, full);
    } else {
      await expect(toast).toHaveText(full);
    }
    const box = (await toast.boundingBox())!;
    // Vorher höchstens die halbe Breite (left: 50%) – mobil ein schmaler, sehr hoher Block.
    expect(box.width).toBeGreaterThanOrEqual(Math.min(viewport.width - 32, 640) - 2);
    expect(box.width).toBeLessThanOrEqual(Math.min(viewport.width - 32, 640) + 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
