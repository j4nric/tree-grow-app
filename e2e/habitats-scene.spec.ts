import type { BrowserContext, Page } from '@playwright/test';
import { expect, openFullscreen, openGame, savedState, sceneGeometry, seedRaw, test, waypoint } from './fixtures';
import { STAGES } from '../src/content/stages';
import { growth } from '../src/core/formulas';
import { createInitialState, type GameState } from '../src/core/state';
import { createAnchorResolver } from '../src/render/anchors';
import { animalBounds, type SceneAnimal } from '../src/render/animals';
import { makeLayout, placeMainTree } from '../src/render/layout';

/**
 * Lebensräume in der Szene (DESIGN_V2.md 23.8): Mit erforschten Knoten stehen Waldwiese und
 * Trockenmauer im Mittelgrund, der Totholzhaufen im Erdschnitt; ein Tippen auf einen
 * Bewohner im Vollbild öffnet seine Haftnotiz, „Im Album ansehen“ die Tierdetails. Die Lage
 * kommt aus denselben Ankerpunkten wie im Renderer (bei reduzierter Bewegung ruhen Tiere
 * und Wind).
 */

async function seed(context: BrowserContext): Promise<void> {
  const state = createInitialState(Date.now(), 4242);
  // Hain: alle drei Lebensräume können offen sein.
  state.totalGrowth = waypoint(STAGES[5]!.waypoint) + 1;
  state.cycle.research = ['meadow', 'leaf-litter', 'deadwood-pile', 'drystone-wall'];
  state.niches.meadow = ['rabbit'];
  state.niches.deadwood = ['weasel'];
  state.niches.wall = ['sandlizard'];
  await seedRaw(context, state, 0);
}

/** Mitte eines Bewohners in Seiten-Koordinaten (ganze Szene, ohne Kamera). */
async function residentPoint(page: Page, animal: SceneAnimal, scene: SceneAnimal[]): Promise<{ x: number; y: number }> {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  const g = growth((await savedState(page)) as GameState);
  const geo = await sceneGeometry(page);
  const layout = makeLayout(geo.width, geo.height);
  const anchors = createAnchorResolver(layout, g, placeMainTree(layout, g));
  const b = animalBounds(animal, anchors, ['pileGap', 'perchTwig', 'meadowTuft'], scene)!;
  return geo.toPage((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
}

test.describe('Lebensräume in der Szene', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  for (const viewport of [
    { width: 1200, height: 760 },
    { width: 390, height: 844 },
  ]) {
    test(`Tippen auf Bewohner von Wiese, Totholzhaufen und Mauer (Vollbild) öffnet die Tierdetails (${viewport.width}×${viewport.height})`, async ({ page, context }) => {
      await page.setViewportSize(viewport);
      await seed(context);
      await openGame(page);
      const scene: SceneAnimal[] = [
        { id: 'rabbit', family: 'mammals', niche: 'meadow', slot: 0, happiness: 1 },
        { id: 'weasel', family: 'mammals', niche: 'deadwood', slot: 0, happiness: 1 },
        { id: 'sandlizard', family: 'reptiles', niche: 'wall', slot: 0, happiness: 1 },
      ];
      for (const [i, name] of ['Wildkaninchen', 'Mauswiesel', 'Zauneidechse'].entries()) {
        await openFullscreen(page);
        const p = await residentPoint(page, scene[i]!, scene);
        await page.mouse.click(p.x, p.y);
        const note = page.locator('[data-ref="note"]');
        await expect(note).toContainText(name);
        await note.getByRole('button', { name: 'Im Album ansehen' }).click();
        const sub = page.locator('[data-ref="page-animal"]');
        await expect(sub).toBeVisible();
        await expect(sub.locator('.page-title')).toHaveAccessibleName(name);
        await expect(sub).not.toHaveAttribute('inert', '');
        await page.keyboard.press('Escape');
        await expect(sub).toBeHidden();
      }
    });
  }
});
