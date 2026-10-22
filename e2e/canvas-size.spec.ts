import { expect, openGame, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Verdrahtung der Canvas-Größe (CanvasSizer in main.ts): Nach einer Größenänderung folgt
 * der Backing-Store der CSS-Größe × Pixeldichte (±1 Pixel Rundung, bei
 * `devicePixelContentBoxSize` rundet der Browser selbst). Mit deviceScaleFactor 2 prüft
 * der zweite Test auch, dass emulierte Pixeldichte nicht zu einem halb so großen
 * Backing-Store führt. Keine Pixelvergleiche.
 */

async function backingStore(page: Page): Promise<{ w: number; h: number; ew: number; eh: number; css: number }> {
  return page.locator('canvas#scene').evaluate((el) => {
    const c = el as HTMLCanvasElement;
    // Layoutgröße statt getBoundingClientRect: Das Polaroid im Album ist leicht gedreht, das
    // umschließende Rechteck wäre größer als das Canvas selbst.
    const style = getComputedStyle(c);
    const r = { width: parseFloat(style.width), height: parseFloat(style.height) };
    const dpr = window.devicePixelRatio;
    return { w: c.width, h: c.height, ew: Math.round(r.width * dpr), eh: Math.round(r.height * dpr), css: r.width };
  });
}

async function expectMatchesLayout(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await backingStore(page);
        return s.ew > 0 && s.eh > 0 && Math.abs(s.w - s.ew) <= 1 && Math.abs(s.h - s.eh) <= 1;
      },
      { timeout: 3_000 },
    )
    .toBe(true);
}

test('Canvas folgt Größenänderungen des Fensters (Backing-Store = CSS-Größe × Pixeldichte)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGame(page);
  await expectMatchesLayout(page);
  const before = await backingStore(page);

  // Schmaler (Handy hochkant) – Layout und Canvas ändern sich.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectMatchesLayout(page);
  const narrow = await backingStore(page);
  expect(narrow.w).not.toBe(before.w);

  // Mehrere schnelle Änderungen (Ziehen), dann stabil.
  for (const w of [700, 760, 820, 900]) {
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(16);
  }
  await expectMatchesLayout(page);
});

test.describe('hohe Pixeldichte', () => {
  test.use({ deviceScaleFactor: 2 });

  test('Canvas nutzt die Gerätepixel', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openGame(page);
    await expectMatchesLayout(page);
    await page.setViewportSize({ width: 600, height: 900 });
    await expectMatchesLayout(page);
    const s = await backingStore(page);
    expect(s.w).toBeGreaterThanOrEqual(Math.floor(s.css * 2) - 1);
  });
});
