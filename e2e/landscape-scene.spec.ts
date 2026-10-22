import type { Page } from '@playwright/test';
import { SITE_IDS } from '../src/content/landscape';
import { STAGES } from '../src/content/stages';
import { createInitialState } from '../src/core/state';
import { expect, seedRaw, stageLabel, test, waypoint } from './fixtures';

/**
 * Kulisse je Waldtyp (DESIGN_V2.md 24.11, Schritt 3): Mit `?site=<id>` zeigt das Spiel die
 * Kulisse jedes Standorts (nur das Bild). Geprüft wird, dass jeder Waldtyp ohne Konsolenfehler
 * läuft (Fixture) und sich vom Heimatwald sichtbar unterscheidet.
 */

/** Mittlere Farbe (r, g, b) eines Streifens knapp über der Bodenlinie (Horizont der Kulisse). */
function horizonColor(page: Page): Promise<[number, number, number]> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas#scene')!;
    const ctx = canvas.getContext('2d')!;
    const y = Math.floor(canvas.height * 0.8 * 0.9);
    const data = ctx.getImageData(0, y, Math.floor(canvas.width * 0.2), 6).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) sum[k] = sum[k]! + data[i + k]!;
    const n = data.length / 4;
    return [sum[0]! / n, sum[1]! / n, sum[2]! / n];
  });
}

async function seedGrove(context: Parameters<typeof seedRaw>[0]): Promise<void> {
  const state = createInitialState(Date.now(), 4242);
  state.totalGrowth = waypoint(STAGES[4]!.waypoint) + 1;
  await seedRaw(context, state, 0);
}

test.describe('Kulisse je Waldtyp', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1000, height: 700 });
  });

  for (const site of SITE_IDS) {
    test(`?site=${site} läuft ohne Fehler`, async ({ page, context }) => {
      await seedGrove(context);
      await page.goto(`/?site=${site}`);
      await expect(stageLabel(page)).toContainText('Stufe:');
      await page.waitForTimeout(500);
      await expect(page.locator('canvas#scene')).toBeVisible();
    });
  }

  test('jeder Waldtyp hat einen eigenen Horizont; unbekannte IDs zeigen den Heimatwald', async ({ page, context }) => {
    await seedGrove(context);
    await page.goto('/?site=home');
    await expect(stageLabel(page)).toContainText('Stufe:');
    await page.waitForTimeout(400);
    const home = await horizonColor(page);
    const diff = (a: number[], b: number[]) => Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!);
    for (const site of ['carr', 'beechwood', 'mountain', 'heath']) {
      await page.goto(`/?site=${site}`);
      await expect.poll(async () => diff(await horizonColor(page), home), { message: site }).toBeGreaterThan(12);
    }
    await page.goto('/?site=mars');
    await expect(stageLabel(page)).toContainText('Stufe:');
    await expect.poll(async () => diff(await horizonColor(page), home)).toBeLessThan(3);
  });
});
