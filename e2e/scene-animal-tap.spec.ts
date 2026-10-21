import type { BrowserContext, Page } from '@playwright/test';
import { expect, openGame, overlaps, savedState, seedRaw, test, waypoint } from './fixtures';
import { growth } from '../src/core/formulas';
import { createInitialState, type GameState } from '../src/core/state';
import { nicheAnchors } from '../src/render/anchors';
import { sceneToScreen, type CameraView } from '../src/render/camera';

/**
 * Tiere in der Szene antippen: Klick/Tippen ohne Ziehen öffnet die Tierdetails, Esc gibt
 * den Fokus an die Szene zurück. Zoomen (Rad) und Ziehen über einem Tier öffnen nichts.
 * Die Lage des Tiers kommt aus denselben Ankerpunkten wie im Renderer (bei reduzierter
 * Bewegung ruhen Tiere und Wind).
 */

const detail = (page: Page) => page.locator('[data-ref="animal-detail"]');
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
  const box = (await canvas(page).boundingBox())!;
  const a = nicheAnchors(box.width, box.height, g, 1).roots[0]!;
  const p = sceneToScreen(view, box.width, box.height, a.x, a.y + 2);
  return { x: box.x + p.x, y: box.y + p.y };
}

async function cameraView(page: Page): Promise<CameraView> {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('tree-grow-camera') ?? '{"zoom":1,"x":0.5,"y":0.5}'));
}

test.describe('Tier in der Szene', () => {
  test.use({ viewport: { width: 1200, height: 760 } });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('Klick öffnet die Tierdetails, Esc gibt den Fokus an die Szene zurück', async ({ page, context }) => {
    await seed(context);
    await openGame(page);
    const p = await wormPoint(page);
    await page.mouse.move(p.x, p.y);
    await expect(canvas(page)).toHaveCSS('cursor', 'pointer');
    await page.mouse.click(p.x, p.y);
    await expect(page.getByRole('dialog', { name: 'Regenwurm' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail(page)).toBeHidden();
    await expect(canvas(page)).toBeFocused();
  });

  test('Rad und Ziehen über dem Tier öffnen nichts; vergrößert öffnet ein Klick', async ({ page, context }) => {
    await seed(context);
    await openGame(page);
    const p = await wormPoint(page);

    // Zoomen mit dem Rad über dem Tier.
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(400);
    await expect(detail(page)).toBeHidden();
    expect((await cameraView(page)).zoom).toBeGreaterThan(1);

    // Ziehen (> 6 px), das auf dem Tier beginnt und endet.
    const v = await cameraView(page);
    const q = await wormPoint(page, v);
    await page.mouse.move(q.x, q.y);
    await page.mouse.down();
    await page.mouse.move(q.x + 12, q.y, { steps: 4 });
    await page.mouse.move(q.x, q.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(detail(page)).toBeHidden();

    // Ruhig vergrößert: Klick auf das Tier an seiner gezoomten Stelle öffnet.
    const still = await cameraView(page);
    const r = await wormPoint(page, still);
    await page.mouse.click(r.x, r.y);
    await expect(page.getByRole('dialog', { name: 'Regenwurm' })).toBeVisible();
  });

  test('Klick daneben (Himmel) öffnet nichts', async ({ page, context }) => {
    await seed(context);
    await openGame(page);
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.1);
    await page.waitForTimeout(300);
    await expect(detail(page)).toBeHidden();
  });
});

test.describe('Tier in der Szene mobil', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test('Tippen öffnet die Tierdetails', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(context);
    await openGame(page);
    const p = await wormPoint(page);
    await page.touchscreen.tap(p.x, p.y);
    await expect(page.getByRole('dialog', { name: 'Regenwurm' })).toBeVisible();
  });
});

test.describe('Kamera-Leiste bei 700 px', () => {
  test.use({ viewport: { width: 700, height: 420 } });

  test('der schwebende Begegnungs-Stapel verdeckt die Leiste in keiner Scrollposition', async ({ page, context }) => {
    const state = createInitialState(Date.now(), 4242);
    state.totalGrowth = waypoint(8) + 1;
    state.pendingEncounters = [{ type: 'animal', cards: ['robin', 'bluetit', 'bee'], rerolls: 0 }];
    await seedRaw(context, state, 0);
    await openGame(page);
    const stackEl = page.locator('[data-ref="encounter-stack"]');
    await expect(stackEl).toBeVisible();
    let floated = false;
    for (let y = 0; y <= 400; y += 8) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await page.waitForTimeout(40);
      const r = await page.evaluate(() => {
        const vis = (el: Element) => {
          const b = el.getBoundingClientRect();
          // Nur der sichtbare Teil zählt.
          const top = Math.max(0, b.top);
          const bottom = Math.min(window.innerHeight, b.bottom);
          return { x: b.left, y: top, width: b.width, height: Math.max(0, bottom - top) };
        };
        return {
          bar: vis(document.querySelector('.scene-camera')!),
          stack: vis(document.querySelector('[data-ref="encounter-stack"]')!),
          floating: document.querySelector('.scene-dock')!.classList.contains('floating'),
        };
      });
      floated ||= r.floating;
      expect(overlaps(r.bar, r.stack), `scrollY ${y}`).toBe(false);
    }
    // Der Fall ist wirklich eingetreten: Der Stapel hat geschwebt.
    expect(floated).toBe(true);
  });
});
