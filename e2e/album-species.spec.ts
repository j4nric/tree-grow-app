import type { BrowserContext, Page } from '@playwright/test';
import { COMMUNITIES } from '../src/content/communities';
import { V1_KEEPSAKE_ID } from '../src/content/memory';
import { PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { createInitialState } from '../src/core/state';
import { expect, gotoTab, seedRaw, tabPanel, test } from './fixtures';

/**
 * Reiter „Arten“ mit vollem Tagebuch (docs/ALBUM_UI.md, B.2 und R3): Sticker-Bilder erst,
 * wenn sie ins Bild kommen; matte Bilder und Silhouetten aus der Leerlaufzeit; Sprungmarken;
 * Andenken als Samentütchen und Zettel; Messwerte für Aufbau und erste Darstellung.
 */

const panel = (page: Page) => tabPanel(page, 'arten');

/** Hain, alle Tiere, Pflanzen und Gemeinschaften entdeckt, drei Tiere im Wald, eine Erinnerung. */
async function seedFullJournal(context: BrowserContext, opts: { all?: boolean } = {}): Promise<void> {
  const state = createInitialState(Date.now(), 4242);
  const grove = STAGES.findIndex((s) => s.id === 'grove');
  state.stage = grove;
  state.waypoint = STAGES[grove]!.waypoint;
  state.niches.roots = ['earthworm'];
  state.niches.crown = ['bluetit'];
  state.niches.litter = ['woodlouse'];
  const all = opts.all !== false;
  state.meta.journal.species = all ? SPECIES.map((s) => s.id) : ['earthworm', 'bluetit', 'woodlouse', 'robin'];
  state.meta.journal.plants = all ? PLANTS.map((p) => p.id) : [];
  state.meta.journal.communities = all ? COMMUNITIES.map((c) => c.id) : [];
  state.meta.journal.keepsakes = [V1_KEEPSAKE_ID];
  await seedRaw(context, state, 0);
}

/** Wurde das Bild des Stickers schon gezeichnet? (Leer ist es 1 × 1 Pixel groß.) */
const drawn = (page: Page, id: string) =>
  panel(page).locator(`[data-species="${id}"] canvas`).evaluate((c: HTMLCanvasElement) => c.width > 1);

test('Bilder erst im Bild, matte Sticker aus der Leerlaufzeit, Messwerte', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await seedFullJournal(context);
  await gotoTab(page, 'arten');
  await expect(panel(page).locator('[data-ref="journal-counts"]')).toContainText(`${SPECIES.length}/${SPECIES.length} Arten`);

  // Oben: farbig (lebt hier) sofort, matt (entdeckt, nicht da) etwas später – beides gezeichnet.
  await expect.poll(() => drawn(page, 'bluetit')).toBe(true);
  await expect.poll(() => drawn(page, 'robin')).toBe(true);
  // Die letzte Gattung liegt weit unten: noch nicht gezeichnet …
  const last = SPECIES[SPECIES.length - 1]!.id;
  expect(await drawn(page, last)).toBe(false);
  // … bis sie ins Bild gescrollt wird.
  await panel(page).locator(`[data-species="${last}"]`).scrollIntoViewIfNeeded();
  await expect.poll(() => drawn(page, last)).toBe(true);

  const timing = await page.evaluate(() =>
    ['album-species-build', 'album-species-first-render'].map((name) => performance.getEntriesByName(name)[0]?.duration ?? -1),
  );
  // Gemessen und nicht absurd (Rechner unter Last: großzügige Grenze).
  for (const ms of timing) {
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(1500);
  }
  test.info().annotations.push({ type: 'Messung', description: `Aufbau ${timing[0]!.toFixed(1)} ms, erste Darstellung ${timing[1]!.toFixed(1)} ms` });
});

test('Silhouetten werden gezeichnet, ohne die Art zu verraten', async ({ page, context }) => {
  await seedFullJournal(context, { all: false });
  await gotoTab(page, 'arten');
  const unknown = panel(page).locator('.species-group[data-genus="birds"] .species-cell.is-unknown').first();
  await expect.poll(() => unknown.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width > 1)).toBe(true);
  await expect(unknown).not.toHaveAttribute('data-species');
  await expect(unknown.locator('.sticker-name')).toHaveText('???');
  // Kein unbekannter Sticker verrät Name oder ID – weder im Text noch in Attributen.
  const html = await panel(page).locator('.species-cell.is-unknown').evaluateAll((cells) => cells.map((c) => c.outerHTML));
  expect(html.length).toBeGreaterThan(0);
  for (const cellHtml of html) {
    for (const s of SPECIES) {
      expect(cellHtml).not.toContain(s.name);
      expect(cellHtml).not.toMatch(new RegExp(`["\\s]${s.id}["\\s]`));
    }
  }
});

test('Sprungmarken und Andenken: Samentütchen und Erinnerungen', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await seedFullJournal(context);
  await gotoTab(page, 'arten');
  await panel(page).locator('[data-jump="keepsakes"]').click();
  const keepsakes = panel(page).locator('[data-ref="species-keepsakes"]');
  await expect(keepsakes.getByRole('heading', { name: /Andenken/ })).toBeInViewport();
  await expect(keepsakes.locator('[data-tree="oak"]')).toContainText('wächst in diesem Zyklus');
  await expect(keepsakes.locator(`[data-keepsake="${V1_KEEPSAKE_ID}"]`)).toContainText('Die alte Eiche');
  await expect(panel(page).locator('[data-jump="animals"] .species-jump-count')).toHaveText(`${SPECIES.length}/${SPECIES.length}`);
});
