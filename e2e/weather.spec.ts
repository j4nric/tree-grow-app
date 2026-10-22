import type { Page } from '@playwright/test';
import { DAY_SECONDS, DAY_START_PHASE, NOON_PHASE } from '../src/content/daytime';
import { createInitialState } from '../src/core/state';
import { expect, seedRaw, stageLabel, test } from './fixtures';

/**
 * Wetter in der Szene (DESIGN_V2.md 21.8): Mit `?weather=<id>` zeigt das Spiel jedes Wetter
 * (nur das Bild). Geprüft wird, dass jede Lage ohne Konsolenfehler läuft (Fixture) und dass
 * die Wolkendecke bei Sturm und Regen den Himmel sichtbar abdunkelt.
 */

/** Mittlere Helligkeit (0–255) oben im Himmel der Szene (rechts vom Mond, wie daynight.spec.ts). */
function skyBrightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas#scene')!;
    const ctx = canvas.getContext('2d')!;
    const x = Math.floor(canvas.width * 0.05);
    const w = Math.max(1, Math.floor(canvas.width * 0.3));
    const y = Math.floor(canvas.height * 0.04);
    const data = ctx.getImageData(x, y, w, 4).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    return sum / (data.length / 4);
  });
}

/** Spielstand am Mittag der Spielzeit (heller Tag). */
async function seedNoon(context: Parameters<typeof seedRaw>[0]): Promise<void> {
  const state = createInitialState(Date.now(), 4242);
  state.cycle.elapsed = (NOON_PHASE - DAY_START_PHASE) * DAY_SECONDS;
  await seedRaw(context, state, 0);
}

async function openWeather(page: Page, weather: string): Promise<void> {
  await page.goto(`/?weather=${weather}`);
  await expect(stageLabel(page)).toContainText('Stufe:');
  // Einige Frames laufen lassen (Partikel, Nebelbänder, Tönung).
  await page.waitForTimeout(600);
}

for (const weather of ['storm', 'rain', 'fog', 'snow', 'drought', 'frost', 'sun', 'mild']) {
  test(`Wetter ?weather=${weather} läuft ohne Fehler`, async ({ page, context }) => {
    await seedNoon(context);
    await openWeather(page, weather);
    await expect(page.locator('canvas#scene')).toBeVisible();
  });
}

test('Sturm und Regen dunkeln den Himmel ab; unbekanntes Wetter zeigt das Tageswetter', async ({ page, context }) => {
  await seedNoon(context);
  await openWeather(page, 'mild');
  const clear = await skyBrightness(page);
  expect(clear).toBeGreaterThan(150);
  for (const weather of ['storm', 'rain']) {
    await page.goto(`/?weather=${weather}`);
    await expect.poll(() => skyBrightness(page)).toBeLessThan(clear - 20);
  }
  await page.goto('/?weather=blitz');
  await expect(stageLabel(page)).toContainText('Stufe:');
  // Tag 0 ist immer „Wechselhaft“ (21.2): Himmel wie ohne Wetter.
  await expect.poll(() => skyBrightness(page)).toBeGreaterThan(clear - 5);
});

test('Wetter bei weniger Bewegung und mobil: ohne Fehler', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await seedNoon(context);
  for (const weather of ['storm', 'snow', 'fog']) await openWeather(page, weather);
  expect(await page.evaluate(() => document.body.dataset.motion)).toBe('reduce');
});
