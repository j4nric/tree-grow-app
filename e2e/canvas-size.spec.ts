import { closeFullscreen, expect, fullscreen, openFullscreen, openGame, polaroidButton, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Verdrahtung der Canvas-Größe (CanvasSizer in main.ts): Nach einer Größenänderung folgt
 * der Backing-Store der CSS-Größe × Pixeldichte (±1 Pixel Rundung, bei
 * `devicePixelContentBoxSize` rundet der Browser selbst). Mit deviceScaleFactor 2 prüft
 * der zweite Test auch, dass emulierte Pixeldichte nicht zu einem halb so großen
 * Backing-Store führt. Im Album: Größe im Polaroid und im Vollbild, während des
 * Aufziehens (FLIP) kein Resize, danach genau einer und kein Dauer-Resize. Keine
 * Pixelvergleiche.
 */

async function backingStore(page: Page): Promise<{ w: number; h: number; ew: number; eh: number; css: number }> {
  return page.locator('canvas#scene').evaluate((el) => {
    const c = el as HTMLCanvasElement;
    // Layoutgröße statt getBoundingClientRect: unabhängig von CSS-Transformationen (FLIP des
    // Vollbilds, gedrehtes Papier des Polaroids).
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

test.describe('Polaroid und Vollbild', () => {
  for (const viewport of [
    { width: 1200, height: 700 },
    { width: 390, height: 844 },
  ]) {
    test(`Größe im Polaroid und im Vollbild, kein Resize während des Aufziehens (${viewport.width}×${viewport.height})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openGame(page);
      await expectMatchesLayout(page);
      const inPolaroid = await backingStore(page);
      const photo = (await polaroidButton(page).boundingBox())!;
      // Das Canvas füllt die Bildfläche des Polaroids (gerade, ohne Drehung).
      expect(Math.abs(inPolaroid.css - photo.width)).toBeLessThanOrEqual(1);

      // Je Frame Breite des Backing-Stores und ob das Vollbild noch aufzieht.
      await page.evaluate(() => {
        const log: { w: number; moving: boolean }[] = [];
        (window as unknown as { __sizes: typeof log }).__sizes = log;
        const canvas = document.querySelector<HTMLCanvasElement>('canvas#scene')!;
        const step = () => {
          const layer = document.querySelector('[data-ref="fullscreen"]');
          log.push({ w: canvas.width, moving: !!layer?.classList.contains('fullscreen-moving') });
          if (log.length < 600) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      await openFullscreen(page);
      await expectMatchesLayout(page);
      const full = await backingStore(page);
      expect(Math.abs(full.css - viewport.width)).toBeLessThanOrEqual(1);
      // Kein Dauer-Resize: eine Weile stabil.
      await page.waitForTimeout(500);
      expect((await backingStore(page)).w).toBe(full.w);
      const sizes = await page.evaluate(() => (window as unknown as { __sizes: { w: number; moving: boolean }[] }).__sizes);
      // Während der Animation die alte Größe, danach genau ein Wechsel.
      expect(sizes.some((s) => s.moving)).toBe(true);
      for (const s of sizes) if (s.moving) expect(s.w).toBe(inPolaroid.w);
      const changes = sizes.filter((s, i) => i > 0 && s.w !== sizes[i - 1]!.w).length;
      expect(changes).toBe(1);

      await closeFullscreen(page);
      await expect(fullscreen(page)).toBeHidden();
      await expectMatchesLayout(page);
      expect((await backingStore(page)).w).toBe(inPolaroid.w);
    });
  }
});

/** Prüfsumme des Bildes (jedes 7. Pixel) – ändert sich, sobald neu gezeichnet wird (Wind, Wolken). */
function pixelSum(page: Page): Promise<number> {
  return page.locator('canvas#scene').evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 28) sum = (sum * 31 + data[i]! + data[i + 1]! * 3 + data[i + 2]! * 7) % 1_000_000_007;
    return sum;
  });
}

/** Ändert sich das Bild innerhalb von `ms`? */
async function redraws(page: Page, ms = 700): Promise<boolean> {
  const before = await pixelSum(page);
  await page.waitForTimeout(ms);
  return (await pixelSum(page)) !== before;
}

test.describe('Szene nur zeichnen, wenn sie zu sehen ist', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('weggescrollt oder unter einer Unterseite pausiert das Zeichnen, das Spiel läuft weiter', async ({ page }) => {
    await openGame(page);
    await expectMatchesLayout(page);
    expect(await redraws(page)).toBe(true);

    // Polaroid aus dem Bild gescrollt: kein neues Bild, das Spiel wächst weiter (tick).
    const grown = async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
      return (await page.evaluate(() => JSON.parse(localStorage.getItem('tree-grow-save')!).totalGrowth)) as number;
    };
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(300);
    const before = await grown();
    expect(await redraws(page)).toBe(false);
    expect(await grown()).toBeGreaterThan(before);

    // Wieder oben: es wird wieder gezeichnet.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    expect(await redraws(page)).toBe(true);

    // Unterseite über der ganzen Ansicht (Umschlag → Spielstand): pausiert.
    await page.locator('[data-ref="cover-open"]').click();
    await page.locator('[data-ref="save-open"]').click();
    await expect(page.locator('[data-ref="page-save"]')).not.toHaveAttribute('inert', '');
    await page.waitForTimeout(300);
    expect(await redraws(page)).toBe(false);
  });

  test('im Vollbild wird gezeichnet', async ({ page }) => {
    await openGame(page);
    await openFullscreen(page, { tap: true });
    expect(await redraws(page)).toBe(true);
  });
});
