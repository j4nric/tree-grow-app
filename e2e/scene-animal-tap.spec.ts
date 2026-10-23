import type { BrowserContext, Page } from '@playwright/test';
import { expect, fullscreen, openFullscreen, openGame, overlaps, polaroidButton, savedState, sceneGeometry, seedRaw, test, waypoint } from './fixtures';
import { growth } from '../src/core/formulas';
import { createInitialState, type GameState } from '../src/core/state';
import { nicheAnchors } from '../src/render/anchors';
import { sceneToScreen, type CameraView } from '../src/render/camera';

/**
 * Tiere in der Szene antippen (docs/ALBUM_UI.md, C.6 und G-16): Im Polaroid öffnet ein Tipp
 * nur das Vollbild (kein Treffer-Test). Im Vollbild öffnet Klick/Tippen ohne Ziehen eine
 * Haftnotiz zum Tier; „Im Album ansehen“ schließt das Vollbild und zeigt die Tierdetails.
 * Zoomen (Rad) und Ziehen über einem Tier öffnen nichts. Die Lage des Tiers kommt aus
 * denselben Ankerpunkten wie im Renderer (bei reduzierter Bewegung ruhen Tiere und Wind).
 */

const detail = (page: Page) => page.locator('[data-ref="page-animal"]');
const note = (page: Page) => page.locator('[data-ref="note"]');
const canvas = (page: Page) => page.locator('canvas#scene');

async function seed(context: BrowserContext): Promise<void> {
  const state = createInitialState(Date.now(), 4242);
  state.totalGrowth = waypoint(8) + 1;
  state.niches.roots = ['earthworm'];
  state.niches.crown = ['bluetit'];
  await seedRaw(context, state, 0);
}

/** Regenwurm (Wurzelraum, Platz 0) in Seiten-Koordinaten – bei Ansicht `view`. */
async function wormPoint(page: Page, view: CameraView = { zoom: 1, x: 0.5, y: 0.5 }): Promise<{ x: number; y: number }> {
  // Aktuellen Stand speichern lassen, daraus das Wachstum wie im Game Loop.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  const g = growth((await savedState(page)) as GameState);
  const geo = await sceneGeometry(page);
  const a = nicheAnchors(geo.width, geo.height, g, 1).roots[0]!;
  const p = sceneToScreen(view, geo.width, geo.height, a.x, a.y + 2);
  return geo.toPage(p.x, p.y);
}

async function cameraView(page: Page): Promise<CameraView> {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('tree-grow-camera') ?? '{"zoom":1,"x":0.5,"y":0.5}'));
}

/** Wartet, bis die Kamera ruht (`data-camera`), und liefert die gespeicherte Ansicht. */
async function restingView(page: Page, ok: (v: CameraView) => boolean = () => true): Promise<CameraView> {
  let last: CameraView | null = null;
  await expect
    .poll(async () => {
      if ((await canvas(page).getAttribute('data-camera')) !== 'still') return false;
      last = await cameraView(page);
      return ok(last);
    })
    .toBe(true);
  return last!;
}

test.describe('Tier in der Szene', () => {
  test.use({ viewport: { width: 1200, height: 760 } });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('Im Polaroid öffnet ein Klick auf das Tier nur das Vollbild', async ({ page, context }) => {
    await seed(context);
    await openGame(page);
    const p = await wormPoint(page);
    await page.mouse.move(p.x, p.y);
    // Kein Treffer-Test im Polaroid: kein Zeiger-Wechsel über dem Tier.
    await expect(polaroidButton(page)).toHaveCSS('cursor', 'zoom-in');
    await page.mouse.click(p.x, p.y);
    await expect(fullscreen(page)).toBeVisible();
    await expect(note(page)).toBeHidden();
    await expect(detail(page)).toBeHidden();
  });

  test('Im Vollbild: Klick öffnet die Haftnotiz, „Im Album ansehen“ U:Tier', async ({ page, context }) => {
    await seed(context);
    await openGame(page);
    await openFullscreen(page);
    const p = await wormPoint(page);
    await page.mouse.move(p.x, p.y);
    await expect(canvas(page)).toHaveCSS('cursor', 'pointer');
    await page.mouse.click(p.x, p.y);
    await expect(note(page)).toBeVisible();
    await expect(note(page)).toContainText('Regenwurm');
    await expect(note(page)).toContainText('zufrieden');
    // Esc schließt zuerst nur die Notiz, das Vollbild bleibt.
    await page.keyboard.press('Escape');
    await expect(note(page)).toBeHidden();
    await expect(fullscreen(page)).toBeVisible();

    await page.mouse.click(p.x, p.y);
    await note(page).getByRole('button', { name: 'Im Album ansehen' }).click();
    await expect(detail(page)).toBeVisible();
    await expect(detail(page)).toHaveAttribute('data-species', 'earthworm');
    await expect(fullscreen(page)).toBeHidden();
    await expect(detail(page)).not.toHaveAttribute('inert', '');
    // Esc blättert zurück, der Fokus geht an das Polaroid.
    await page.keyboard.press('Escape');
    await expect(detail(page)).toBeHidden();
    await expect(polaroidButton(page)).toBeFocused();
  });

  test('Rad und Ziehen über dem Tier öffnen nichts; vergrößert öffnet ein Klick', async ({ page, context }) => {
    await seed(context);
    await openGame(page);
    await openFullscreen(page);
    const p = await wormPoint(page);

    // Zoomen mit dem Rad über dem Tier.
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, -300);
    const v = await restingView(page, (c) => c.zoom > 1);
    await expect(note(page)).toBeHidden();

    // Ziehen (> 6 px), das auf dem Tier beginnt und endet.
    const q = await wormPoint(page, v);
    await page.mouse.move(q.x, q.y);
    await page.mouse.down();
    await page.mouse.move(q.x + 12, q.y, { steps: 4 });
    await page.mouse.move(q.x, q.y, { steps: 4 });
    await page.mouse.up();
    // Die Notiz öffnete (wenn überhaupt) schon im pointerup – synchron.
    await expect(note(page)).toBeHidden();

    // Ruhig vergrößert: Klick auf das Tier an seiner gezoomten Stelle öffnet.
    const still = await restingView(page);
    const r = await wormPoint(page, still);
    await page.mouse.click(r.x, r.y);
    await expect(note(page)).toContainText('Regenwurm');
  });

  test('Klick daneben (Himmel) öffnet nichts', async ({ page, context }) => {
    await seed(context);
    await openGame(page);
    await openFullscreen(page);
    const geo = await sceneGeometry(page);
    const sky = geo.toPage(geo.width * 0.1, geo.height * 0.1);
    await page.mouse.click(sky.x, sky.y);
    // Ein Treffer öffnete die Notiz synchron im pointerup; die Kamera bleibt bei 1×.
    expect(await restingView(page)).toEqual({ zoom: 1, x: 0.5, y: 0.5 });
    await expect(note(page)).toBeHidden();
    await expect(detail(page)).toBeHidden();
  });
});

test.describe('Tier in der Szene mobil', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test('Tippen aufs Polaroid öffnet das Vollbild, Tippen aufs Tier die Haftnotiz', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(context);
    await openGame(page);
    await openFullscreen(page, { tap: true });
    const p = await wormPoint(page);
    await page.touchscreen.tap(p.x, p.y);
    await expect(note(page)).toContainText('Regenwurm');
    // Die Notiz passt auf den Bildschirm.
    const box = (await note(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await note(page).getByRole('button', { name: 'Im Album ansehen' }).tap();
    await expect(detail(page)).toBeVisible();
    await expect(detail(page).locator('.page-title')).toHaveText('Regenwurm');
  });
});

test.describe('Vollbild bei 700 × 420', () => {
  test.use({ viewport: { width: 700, height: 420 } });

  test('Kamera-Leiste, Bildunterschrift und „Zurück ins Album“ überdecken sich nicht', async ({ page, context }) => {
    const state = createInitialState(Date.now(), 4242);
    state.totalGrowth = waypoint(8) + 1;
    state.pendingEncounters = [{ type: 'animal', cards: ['robin', 'bluetit', 'bee'], rerolls: 0 }];
    await seedRaw(context, state, 0);
    await openGame(page);
    await expect(page.locator('[data-ref="encounter-stack"]')).toBeVisible();
    await openFullscreen(page);
    const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
    const bar = await box('.fullscreen-tools .scene-camera');
    const caption = await box('.fullscreen-caption');
    const close = await box('[data-ref="fullscreen-close"]');
    expect(overlaps(bar, caption)).toBe(false);
    expect(overlaps(bar, close)).toBe(false);
    expect(overlaps(caption, close)).toBe(false);
    for (const b of [bar, caption, close]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(700);
      expect(b.y + b.height).toBeLessThanOrEqual(420);
    }
  });
});
