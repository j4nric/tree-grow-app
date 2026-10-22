import type { BrowserContext, Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, createSite, type GameState, type LandscapeSite } from '../src/core/state';
import { expect, openGame, openTab, seedRaw, tabButton, tabPanel, test, waypoint } from './fixtures';

/**
 * Tagebuch-Teil „Landschaft“ (DESIGN_V2.md 24.11): verborgen vor der Freischaltung, danach je
 * Wald Gedächtnis, Urwald, Leitbaum, Stammgäste, Tiere; Korridore, Hähersaat. Bis Phase 8,
 * Schritt 7 ein Reiter im Dialog „Naturtagebuch“, seitdem (bis Schritt 10) der Abschnitt
 * „Unsere Wälder“ im Album-Reiter „Landschaft“.
 */

const GROVE = STAGES.findIndex((s) => s.id === 'grove');

function landscapeState(opts: { own: number; achievement?: boolean; active?: LandscapeSite['id']; sites?: LandscapeSite[]; corridors?: string[]; free?: string[] }): GameState {
  const state = createInitialState(Date.now(), 4242);
  state.stage = GROVE;
  state.waypoint = STAGES[GROVE]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.cycle.number = 4;
  state.meta.forestMemory = opts.own;
  state.meta.achievements = opts.achievement === false ? [] : ['ancient-forest'];
  state.meta.journal.species = ['robin', 'owl', 'blackwoodpecker'];
  state.meta.landscape = {
    active: opts.active ?? 'home',
    sites: opts.sites ?? [{ ...createSite('home'), ancient: true }],
    corridors: opts.corridors ?? [],
    freeCorridors: opts.free ?? [],
    announced: true,
  };
  return state;
}

/** Heimatwald ruht (400 Gedächtnis, Urwald), aktiv ist der Auwald; Mühlbach kam mit der Gründung. */
const founded = () =>
  landscapeState({
    own: 120,
    active: 'floodplain',
    sites: [
      { ...createSite('home'), memory: 400, ancient: true, regulars: ['robin'], fauna: ['robin', 'owl', 'blackwoodpecker'] },
      createSite('floodplain'),
    ],
    corridors: ['home-floodplain'],
    free: ['home-floodplain'],
  });

const section = (page: Page) => page.locator('[data-ref="journal-landscape"]');

async function open(page: Page, context: BrowserContext, state: GameState): Promise<void> {
  await seedRaw(context, state, 0);
  await openGame(page);
  await openTab(page, 'landschaft');
  await expect(section(page)).toBeVisible();
}

test('vor der Freischaltung: kein Reiter „Landschaft“, nichts verrät die Landschaft', async ({ page, context }) => {
  await seedRaw(context, landscapeState({ own: 100 }), 0);
  await openGame(page);
  await expect(tabButton(page, 'landschaft')).toBeHidden();
  await expect(section(page)).toBeHidden();
  await openTab(page, 'arten');
  const html = await tabPanel(page, 'arten').evaluate((d) => d.outerHTML);
  expect(html).not.toContain('Auwald');
  expect(html).not.toContain('🪶');
});

test('nach der Freischaltung: Wälder, Korridore und Hähersaat im Reiter Landschaft', async ({ page, context }) => {
  await open(page, context, founded());
  const panel = section(page);
  await expect(panel.getByRole('heading', { name: 'Unsere Wälder' })).toBeVisible();
  await expect(panel.locator('[data-ref="journal-landscape-summary"]')).toHaveText('2 von 6 Wäldern gegründet · 1 von 10 Korridoren');

  // Hähersaat: Heimat 4 + 2, Auwald 1 → 7 verdient, 3 für die Gründung.
  const seeds = panel.locator('[data-ref="journal-jay-seeds"]');
  await expect(seeds.locator('[data-row="earned"]')).toContainText('7 🪶');
  await expect(seeds.locator('[data-row="spent"]')).toContainText('3 🪶');
  await expect(seeds.locator('[data-row="available"]')).toContainText('4 🪶');

  const home = panel.locator('li[data-site="home"]');
  await expect(home).toContainText('Heimatwald');
  await expect(home).toContainText('Eichen');
  await expect(home.locator('[data-row="memory"]')).toContainText('400 eigen · 460 wirksam');
  await expect(home.locator('[data-row="ancient"]')).toContainText('ja');
  await expect(home.locator('[data-row="lead"]')).toContainText('Stieleiche');
  await expect(home.locator('[data-row="regulars"]')).toContainText('Rotkehlchen');
  // Lange Namen tragen weiche Trennstellen (hyphenate.ts) – zum Vergleich entfernen.
  const fauna = await home.locator('[data-row="fauna"] dd').evaluate((d) => d.textContent!.replaceAll('\u00ad', ''));
  expect(fauna).toBe('Schwarzspecht (legendär), Waldkauz (besonders) und Rotkehlchen');
  expect(await home.locator('[data-row="fauna"] dd').evaluate((d) => d.textContent)).toContain('\u00ad');

  const flood = panel.locator('li[data-site="floodplain"]');
  await expect(flood).toContainText('hier wächst dein Wald');
  await expect(flood).toContainText('Hartholzaue');
  await expect(flood.locator('[data-row="memory"]')).toContainText('120 eigen · 320 wirksam');
  await expect(flood.locator('[data-row="ancient"]')).toContainText('noch nicht');
  await expect(flood.locator('[data-row="regulars"]')).toContainText('keine');

  const corridor = panel.locator('li[data-corridor="home-floodplain"]');
  await expect(corridor).toContainText('Mühlbach');
  await expect(corridor).toContainText('Heimatwald – Auwald am Fluss');
  await expect(corridor).toContainText('mit der Gründung, gratis');
});

for (const width of [360, 390]) {
  test.describe(`Mobil (${width} px)`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });

    test('Abschnitt „Unsere Wälder“ ohne horizontales Scrollen', async ({ page, context }) => {
      await open(page, context, founded());
      const panel = section(page);
      await panel.locator('li[data-site="floodplain"]').scrollIntoViewIfNeeded();
      await expect(panel.locator('li[data-site="floodplain"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      // Kein Element ragt rechts aus dem Reiter heraus.
      const overflow = await panel.evaluate((p) => {
        const right = p.getBoundingClientRect().right + 0.5;
        return [...p.querySelectorAll('*')].filter((n) => n.getBoundingClientRect().right > right).length;
      });
      expect(overflow).toBe(0);
    });
  });
}
