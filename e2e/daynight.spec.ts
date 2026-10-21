import type { Page } from '@playwright/test';
import { DAY_SECONDS, DAY_START_PHASE } from '../src/content/daytime';
import { createInitialState } from '../src/core/state';
import { expect, openGame, seedRaw, test } from './fixtures';

/**
 * Tag und Nacht (DESIGN_V2.md 19): Die Szene zeigt nachts einen dunklen Himmel; die
 * Einstellung „Tageszeit → Immer Tag“ (⚙️) macht sie hell und bleibt nach dem Neuladen.
 * Geprüft wird die mittlere Helligkeit eines Streifens oben im Himmel (rechts vom Mond).
 */

const settings = (page: Page) => page.locator('[data-ref="settings"]');
const daytimeGroup = (page: Page) => settings(page).locator('[data-setting="daytime"]');

/** Mittlere Helligkeit (0–255) oben im Himmel der Szene. */
function skyBrightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas#scene')!;
    const ctx = canvas.getContext('2d')!;
    const x = Math.floor(canvas.width * 0.55);
    const w = Math.max(1, Math.floor(canvas.width * 0.3));
    const y = Math.floor(canvas.height * 0.04);
    const data = ctx.getImageData(x, y, w, 4).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    return sum / (data.length / 4);
  });
}

/** Spielstand kurz vor Mitternacht der Spielzeit (Tagesanteil ≈ 0,99). */
async function seedNight(context: Parameters<typeof seedRaw>[0]): Promise<void> {
  const state = createInitialState(Date.now(), 4242);
  // Tagesanteil = DAY_START_PHASE + elapsed / DAY_SECONDS (mod 1) → kurz vor 1 = Mitternacht.
  state.cycle.elapsed = (1 - DAY_START_PHASE - 0.01) * DAY_SECONDS;
  await seedRaw(context, state, 0);
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`Nacht und Einstellung „Immer Tag“ (${viewport.width} px)`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await seedNight(context);
    await openGame(page);
    // Nachts: dunkler Himmel (der Taghimmel ist oben hellblau, Helligkeit > 150).
    await expect.poll(() => skyBrightness(page)).toBeLessThan(90);

    await page.locator('[data-ref="settings-open"]').click();
    await expect(settings(page)).toBeVisible();
    await expect(settings(page).getByRole('group', { name: 'Tageszeit' })).toBeVisible();
    await expect(daytimeGroup(page).getByLabel(/^Wechsel/)).toBeChecked();
    await daytimeGroup(page).getByLabel('Immer Tag').check();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tree-grow-settings') ?? '{}').daytime)).toBe('day');
    // Die Szene gleitet in wenigen Sekunden zum Tag.
    await expect.poll(() => skyBrightness(page), { timeout: 10_000 }).toBeGreaterThan(150);
    await page.keyboard.press('Escape');

    // Bleibt nach dem Neuladen (sofort hell, kein Gleiten beim Start).
    await page.reload();
    await expect(page.locator('[data-ref="settings-open"]')).toBeVisible();
    await expect.poll(() => skyBrightness(page)).toBeGreaterThan(150);

    // Zurück auf Wechsel: wieder Nacht.
    await page.locator('[data-ref="settings-open"]').click();
    await daytimeGroup(page).getByLabel(/^Wechsel/).check();
    await expect.poll(() => skyBrightness(page), { timeout: 10_000 }).toBeLessThan(90);
  });
}

test('Nacht bei weniger Bewegung: dunkel ohne Fehler', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedNight(context);
  await openGame(page);
  await expect.poll(() => skyBrightness(page)).toBeLessThan(90);
  expect(await page.evaluate(() => document.body.dataset.motion)).toBe('reduce');
});
