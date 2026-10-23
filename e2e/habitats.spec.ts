import type { BrowserContext, Page } from '@playwright/test';
import { createInitialState } from '../src/core/state';
import { animalPage, expect, niche, openGame, openTab, seedRaw, test, waypoint } from './fixtures';

/**
 * Lebensräume (DESIGN_V2.md 23.7 Punkt 5): Waldwiese, Totholzhaufen und Trockenmauer stehen
 * verschlossen in der Übersicht – mit Hinweis und „Zur Pflege“, sobald der Knoten in der
 * Liste steht. Offen sind sie Nischen wie alle anderen (Kachel → Tierdetails).
 */

const care = (page: Page) => page.locator('[data-ref="care"]');

async function seed(context: BrowserContext, patch: (state: ReturnType<typeof createInitialState>) => void): Promise<void> {
  const state = createInitialState(Date.now(), 777);
  state.niches.roots = ['earthworm'];
  state.meta.journal.species.push('earthworm');
  patch(state);
  await seedRaw(context, state, 0);
}

test('Mobil: verschlossene Waldwiese führt mit „Zur Pflege“ zum Knoten, nach dem Erforschen ist sie offen', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(context, (state) => {
    state.totalGrowth = waypoint(6) + 1; // Junger Baum: Waldwiese steht in der Liste
    state.harmonyPoints = 5_000;
  });
  await openGame(page);

  const meadow = niche(page, 'meadow');
  const wall = niche(page, 'wall');
  await expect(meadow).toContainText('🌾 Waldwiese');
  await expect(meadow).toContainText('öffnet durch Forschung „Waldwiese“ (ab „Junger Baum“)');
  // Die Trockenmauer kommt erst im Hain: Hinweis ja, Knopf noch nicht.
  await expect(wall).toContainText('öffnet durch Forschung „Trockenmauer“ (ab „Hain“)');
  await expect(wall.locator('[data-ref="niche-care-link"]')).toBeHidden();
  await expect(niche(page, 'deadwood').locator('[data-ref="niche-care-link"]')).toBeHidden();

  const link = meadow.getByRole('button', { name: 'Zur Pflege: Waldwiese öffnen' });
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await link.click();
  const item = care(page).locator('[data-care="meadow"]');
  await expect(item.locator('[data-care-title="meadow"]')).toBeFocused();
  await expect(item).toBeInViewport();
  await expect(item.locator('[data-ref="care-opens"]')).toHaveText('Öffnet Lebensraum 🌾 Waldwiese');

  await item.locator('[data-buy-care="meadow"]').click();
  // Erforscht: nichts mehr zu öffnen.
  await expect(item).toContainText('erforscht');
  await expect(item.locator('[data-ref="care-opens"]')).toBeHidden();
  await openTab(page, 'nischen');
  await expect(meadow).toContainText('0/2 belegt');
  await expect(meadow.locator('[data-ref="niche-care-link"]')).toBeHidden();
  await expect(meadow).not.toContainText('öffnet durch');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'schmal', width: 360, height: 740 },
]) {
  test(`Offene Trockenmauer (${viewport.name}): Reptilien-Sticker wie in jeder Nische, U:Tier mit Gattung`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(context, (state) => {
      state.totalGrowth = waypoint(20) + 1; // Hain
      state.cycle.research = ['meadow', 'drystone-wall'];
      state.niches.wall = ['sandlizard'];
      state.meta.journal.species.push('sandlizard');
    });
    await openGame(page);

    const wall = niche(page, 'wall');
    await expect(wall).toContainText('1/2 belegt');
    await expect(wall.locator('[data-ref="niche-care-link"]')).toBeHidden();
    const tile = wall.locator('[data-species="sandlizard"]');
    const button = tile.locator('button.sticker');
    await expect(button).toHaveAttribute('data-family', 'reptiles');
    await expect(tile).toContainText('Zauneidechse');
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await button.click();
    const sub = animalPage(page);
    await expect(sub).toBeVisible();
    await expect(sub.locator('.page-title')).toHaveAccessibleName('Zauneidechse');
    await expect(sub).toContainText('Reptilien');
    await expect(sub).toContainText('Trockenmauer');
    await page.keyboard.press('Escape');
    await expect(sub).toBeHidden();
    await expect(button).toBeFocused();
    // Gattungsleiste: Reptilien als siebte Gattung.
    await expect(page.locator('.family-badge[data-family="reptiles"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
