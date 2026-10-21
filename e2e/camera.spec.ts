import { expect, openGame, seedV3, test, waypoint } from './fixtures';
import type { CDPSession, Page } from '@playwright/test';

/**
 * Kamera der Szene: Zoom per Knopf, Rad, Doppelklick und Pinch, Verschieben per Ziehen
 * und Tastatur, harte Grenzen, Zurücksetzen und Seiten-Scrollen bei 1× (mobil).
 * Die Ansicht steht in sessionStorage (`tree-grow-camera`) – daraus lesen die Tests
 * Zoom und Ausschnitt, ohne den Renderer anzufassen.
 */

interface View {
  zoom: number;
  x: number;
  y: number;
}

const zoomIn = (page: Page) => page.locator('[data-ref="zoom-in"]');
const zoomOut = (page: Page) => page.locator('[data-ref="zoom-out"]');
const reset = (page: Page) => page.locator('[data-ref="zoom-reset"]');
const canvas = (page: Page) => page.locator('canvas#scene');

/** Ansicht, sobald sie ruht (gespeichert nach dem Gleiten). */
async function view(page: Page): Promise<View> {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('tree-grow-camera') ?? '{"zoom":1,"x":0.5,"y":0.5}'));
}

/**
 * Wartet, bis die gespeicherte (ruhende) Ansicht `ok` erfüllt, und gibt sie zurück. Die
 * Ansicht wird erst gespeichert, wenn die Kamera nicht mehr gleitet.
 */
async function viewWhen(page: Page, ok: (v: View) => boolean = () => true): Promise<View> {
  let last: View | null = null;
  await expect
    .poll(async () => {
      // Nur eine ruhende Kamera zählt (`data-camera` setzt camera-input.ts je Frame).
      if ((await canvas(page).getAttribute('data-camera')) !== 'still') return false;
      last = await view(page);
      return ok(last);
    })
    .toBe(true);
  return last!;
}

const isHome = (v: View) => v.zoom === 1 && v.x === 0.5 && v.y === 0.5;

/** Ein Finger wischt senkrecht um `dy` (CDP-Touch, wie ein echtes Gerät). */
async function swipe(cdp: CDPSession, x: number, y: number, dy: number): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 10, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

function expectInside(v: View): void {
  const half = 0.5 / v.zoom;
  expect(v.x - half).toBeGreaterThanOrEqual(-1e-9);
  expect(v.y - half).toBeGreaterThanOrEqual(-1e-9);
  expect(v.x + half).toBeLessThanOrEqual(1 + 1e-9);
  expect(v.y + half).toBeLessThanOrEqual(1 + 1e-9);
}

/** Deckende Pixel (kein Leerraum) an allen vier Rändern des Canvas, dazu deren Farben. */
async function edgePixels(page: Page): Promise<number[][]> {
  return canvas(page).evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const out: number[][] = [];
    const w = c.width;
    const h = c.height;
    for (const [x, y] of [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
      [Math.floor(w / 2), 0],
      [0, Math.floor(h / 2)],
      [w - 1, Math.floor(h / 2)],
      [Math.floor(w / 2), h - 1],
    ]) {
      out.push([...ctx.getImageData(x!, y!, 1, 1).data]);
    }
    return out;
  });
}

async function seedTree(context: Parameters<typeof seedV3>[0]): Promise<void> {
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1,
    seeds: 50,
    plants: ['hazel', 'birch'],
    niches: { roots: ['earthworm'], litter: ['robin'], crown: ['bluetit'] },
  });
}

test.describe('Desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Knöpfe zoomen hinein und heraus, Zurücksetzen zeigt wieder alles', async ({ page, context }) => {
    await seedTree(context);
    await openGame(page);
    await expect(reset(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(zoomOut(page)).toHaveAttribute('aria-disabled', 'true');
    for (const b of [zoomIn(page), zoomOut(page), reset(page)]) {
      const box = await b.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const before = await canvas(page).screenshot();

    await zoomIn(page).click();
    await zoomIn(page).click();
    const v = await viewWhen(page, (v) => Math.abs(v.zoom - 2.25) < 1e-6);
    expectInside(v);
    await expect(reset(page)).toHaveAttribute('aria-disabled', 'false');
    expect((await canvas(page).screenshot()).equals(before)).toBe(false);

    await zoomOut(page).click();
    await viewWhen(page, (v) => Math.abs(v.zoom - 1.5) < 1e-6);

    // Bis zum Höchstzoom: „+“ ist dann nicht mehr verfügbar.
    // 1,5 → 2,25 → 3,375 → 4 (begrenzt).
    for (let i = 0; i < 3; i++) await zoomIn(page).click();
    await viewWhen(page, (v) => v.zoom === 4);
    await expect(zoomIn(page)).toHaveAttribute('aria-disabled', 'true');

    await reset(page).click();
    await viewWhen(page, isHome);
    await expect(reset(page)).toHaveAttribute('aria-disabled', 'true');
  });

  test('Mausrad zoomt zum Zeiger, Ziehen verschiebt', async ({ page, context }) => {
    await seedTree(context);
    await openGame(page);
    const box = (await canvas(page).boundingBox())!;
    // Rad über dem linken oberen Viertel: Zoom zum Zeiger (Mitte wandert dorthin).
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
    const z = await viewWhen(page, (v) => v.zoom > 2);
    expect(z.x).toBeLessThan(0.5);
    expect(z.y).toBeLessThan(0.5);
    expectInside(z);

    // Ziehen nach links oben: der Ausschnitt wandert nach rechts unten (ein Ausgleiten
    // führt nur weiter in dieselbe Richtung).
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 150, cy - 100, { steps: 10 });
    await page.mouse.up();
    expectInside(await viewWhen(page, (v) => v.x > z.x && v.y > z.y));
  });

  test('Grenzen halten an allen Seiten (kein Leerraum)', async ({ page, context }) => {
    await seedTree(context);
    await openGame(page);
    const box = (await canvas(page).boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Bei 1,5× reicht ein kräftiger Zug bis über den Rand: weit über alle Ränder hinaus
    // ziehen – nie Leerraum.
    await zoomIn(page).click();
    await viewWhen(page, (v) => Math.abs(v.zoom - 1.5) < 1e-6);
    for (const [dx, dy] of [
      [2000, 2000],
      [-2000, -2000],
      [2000, -2000],
      [-2000, 2000],
    ]) {
      // Mehrmals kräftig ziehen (innerhalb des Fensters).
      for (let k = 0; k < 2; k++) {
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + Math.sign(dx!) * box.width * 0.4, cy + Math.sign(dy!) * box.height * 0.4, { steps: 8 });
        await page.mouse.up();
      }
      // Am Rand: Ausschnitt stößt genau an (links bzw. rechts, oben bzw. unten).
      const atEdge = (v: View) => {
        const half = 0.5 / v.zoom;
        const ex = dx! > 0 ? v.x - half : 1 - (v.x + half);
        const ey = dy! > 0 ? v.y - half : 1 - (v.y + half);
        return Math.abs(ex) < 1e-6 && Math.abs(ey) < 1e-6;
      };
      expectInside(await viewWhen(page, atEdge));
      for (const px of await edgePixels(page)) expect(px[3]).toBe(255);
    }
  });

  test('Doppelklick zoomt hinein, Tastatur verschiebt und setzt zurück', async ({ page, context }) => {
    await seedTree(context);
    await openGame(page);
    const box = (await canvas(page).boundingBox())!;
    // Himmel (kein Tier) doppelt anklicken.
    await canvas(page).dblclick({ position: { x: box.width * 0.2, y: box.height * 0.15 } });
    const v = await viewWhen(page, (v) => Math.abs(v.zoom - 2) < 1e-6);
    expect(v.x).toBeLessThan(0.5);

    await canvas(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await viewWhen(page, (m) => m.x > v.x + 0.1);
    await page.keyboard.press('+');
    await viewWhen(page, (m) => Math.abs(m.zoom - 3) < 1e-6);
    await page.keyboard.press('-');
    await viewWhen(page, (m) => Math.abs(m.zoom - 2) < 1e-6);
    await page.keyboard.press('0');
    await viewWhen(page, isHome);
  });
});

test.describe('Mobil', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

  test('bei 1× scrollt die Seite über der Szene; Pinch zoomt; vergrößert scrollt sie nicht', async ({ page, context }) => {
    await seedTree(context);
    await openGame(page);
    const box = (await canvas(page).boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.6;

    // Bedienleiste liegt nicht über dem Begegnungs-Stapel (oben rechts) und in der Szene.
    const bar = (await page.locator('.scene-camera').boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(box.y + box.height + 1);
    expect(bar.y).toBeGreaterThan(box.y + box.height / 2);

    // 1×: senkrecht wischen scrollt die Seite.
    await swipe(cdp, x, y, -200);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
    // Der Wisch kann nachgleiten (Fling) und ein einmaliges scrollTo überholen – daher
    // zurücksetzen und erst weiter, wenn die Seite 10 Frames lang oben stehen bleibt.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          window.scrollTo({ top: 0, behavior: 'instant' });
          for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
          return window.scrollY;
        }),
      )
      .toBe(0);
    expect((await view(page)).zoom).toBe(1);

    // Pinch mit zwei Fingern (CDP-Touch): auseinander → Zoom > 1.
    const steps = 12;
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', d: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints:
          type === 'touchEnd'
            ? []
            : [
                { x: x - d, y, id: 1 },
                { x: x + d, y, id: 2 },
              ],
      });
    // Pinch beginnt bei 1× (touch-action: pan-y) – auch dabei scrollt die Seite nicht.
    await touch('touchStart', 30);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', 30 + (i * 60) / steps);
      if (i % 4 === 0) expect(await page.evaluate(() => window.scrollY), `während des Pinch (Schritt ${i})`).toBe(0);
    }
    await touch('touchEnd', 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const pinched = await viewWhen(page, (v) => v.zoom > 2);
    expectInside(pinched);
    await expect(canvas(page)).toHaveCSS('touch-action', 'none');

    // Vergrößert: Wischen verschiebt die Szene, die Seite bleibt stehen – auch nach dem
    // Ausgleiten (einige Frames abwarten).
    await swipe(cdp, x, y, -120);
    const panned = await viewWhen(page, (v) => v.y > pinched.y);
    expectInside(panned);
    expect(
      await page.evaluate(async () => {
        for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
        return window.scrollY;
      }),
    ).toBe(0);
    for (const px of await edgePixels(page)) expect(px[3]).toBe(255);

    // Zurücksetzen: wieder 1×, die Seite scrollt wieder.
    await reset(page).click();
    await viewWhen(page, isHome);
    await expect(canvas(page)).toHaveCSS('touch-action', 'pan-y');
  });
});

test.describe('Mobil 360 px', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('Bedienleiste überdeckt den Begegnungs-Stapel nicht', async ({ page, context }) => {
    await seedV3(context, {
      totalGrowth: waypoint(12) + 1,
      niches: { roots: ['earthworm'] },
      pendingEncounters: [{ type: 'animal', cards: ['robin', 'bluetit', 'bee'], rerolls: 0 }],
    });
    await openGame(page);
    const stackBox = (await page.locator('[data-ref="encounter-stack"]').boundingBox())!;
    const bar = (await page.locator('.scene-camera').boundingBox())!;
    const overlapX = Math.min(stackBox.x + stackBox.width, bar.x + bar.width) - Math.max(stackBox.x, bar.x);
    const overlapY = Math.min(stackBox.y + stackBox.height, bar.y + bar.height) - Math.max(stackBox.y, bar.y);
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });
});
