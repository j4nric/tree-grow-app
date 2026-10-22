import type { BrowserContext, Page } from '@playwright/test';
import { SEASON_SECONDS, YEAR_SECONDS } from '../src/content/seasons';
import { createInitialState } from '../src/core/state';
import { SAVE_VERSION, expect, openGame, openGoalsPage, openTab, savedState, seedRaw, subpage, tabPanel, test, waypoint } from './fixtures';

/**
 * Unterseite „Statistik“ im Reiter „Ziele“ (Kennzahlen aus dem Spielstand, ALBUM_UI.md B.4)
 * und Abschnitt „Andenken“ im Reiter „Arten“ (Hauptbaum-Arten: freigeschaltet, gesperrt mit
 * Hinweis, aktuelle Art markiert; ALBUM_UI.md B.2).
 */

/** Abschnitt „Andenken“ im Reiter „Arten“. */
const keepsakes = (page: Page) => tabPanel(page, 'arten').locator('[data-ref="species-keepsakes"]');
const statsPage = (page: Page) => subpage(page, 'stats');
const stat = (page: Page, key: string) => statsPage(page).locator(`[data-stat="${key}"]`);

/** Zweiter Zyklus, Waldkiefer als Hauptbaum (freigeschaltet), Junger Baum, ein Stammgast. */
async function seedSecondCycle(context: BrowserContext): Promise<void> {
  const state = createInitialState(Date.now(), 4242);
  state.totalGrowth = waypoint(6) + 1;
  state.seeds = 1234;
  state.niches.crown = ['bluetit'];
  state.cycle.number = 2;
  state.cycle.mainTree = 'pine';
  state.cycle.elapsed = YEAR_SECONDS + 2 * SEASON_SECONDS + 30;
  state.meta.forestMemory = 30;
  state.meta.regulars = ['bluetit'];
  state.meta.journal.species = ['bluetit', 'earthworm'];
  state.meta.journal.plants = ['pine'];
  state.meta.stats.playSeconds = 3600 + 125;
  state.meta.stats.cardsChosen = 17;
  state.meta.stats.visitorsHosted = 2;
  state.meta.stats.grownTrees = ['oak', 'pine'];
  await seedRaw(context, state, 0);
}

async function openKeepsakes(page: Page): Promise<void> {
  await openTab(page, 'arten');
  await tabPanel(page, 'arten').locator('[data-jump="keepsakes"]').click();
  await expect(keepsakes(page)).toBeVisible();
}

test('Statistik: per Tastatur erreichbar, Kennzahlen aus dem Spielstand, Samen laufen mit', async ({
  page,
  context,
}) => {
  await seedSecondCycle(context);
  await openGame(page);
  await openTab(page, 'ziele');
  // Link-Karte per Tastatur: Fokus auf die Karte, Enter blättert um.
  const link = page.locator('[data-ref="stats-open"]');
  await expect(link).toContainText('Zyklus 2 · 1 Std. 2 Min. gespielt');
  await link.focus();
  await page.keyboard.press('Enter');
  const panel = statsPage(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Statistik', exact: true })).toBeFocused();

  await expect(stat(page, 'cycle')).toContainText('Zyklus');
  await expect(stat(page, 'cycle')).toContainText('1 Zyklus abgeschlossen');
  await expect(stat(page, 'time')).toContainText('1 Jahr, 2 Jahreszeiten');
  await expect(stat(page, 'time')).toContainText('Herbst');
  await expect(stat(page, 'tree')).toContainText('Waldkiefer');
  await expect(stat(page, 'stage')).toContainText('Junger Baum');
  await expect(stat(page, 'species')).toContainText('2/51');
  await expect(stat(page, 'plants')).toContainText('1/');
  await expect(stat(page, 'communities')).toContainText('0/15');
  await expect(stat(page, 'memory')).toContainText('+30 % Wachstum und Samen');
  await expect(stat(page, 'regulars')).toContainText('1/1');
  await expect(stat(page, 'regulars')).toContainText('Blaumeise');

  // Über alle Zyklen (Langzeit-Statistik aus dem Spielstand, eigener Abschnitt).
  const total = panel.locator('[data-ref="journal-stats-total"]');
  await expect(panel.getByRole('heading', { name: 'Über alle Zyklen' })).toBeVisible();
  await expect(total.locator('[data-stat="total-time"]')).toContainText('1 Std.');
  await expect(total.locator('[data-stat="total-cards"]')).toContainText('17');
  await expect(total.locator('[data-stat="total-visitors"]')).toContainText('2');
  await expect(total.locator('[data-stat="total-trees"]')).toContainText('Stieleiche, Waldkiefer');
  await expect(panel.locator('[data-ref="journal-stats"] [data-stat^="total-"]')).toHaveCount(0);

  // Samen wachsen weiter – die Zahl auf der offenen Seite läuft mit (ohne Neubau der Zeilen).
  const seeds = stat(page, 'seeds').locator('.stat-number');
  const before = await seeds.textContent();
  await seeds.evaluate((e) => e.setAttribute('data-e2e-marker', '1'));
  await expect(seeds).not.toHaveText(before ?? '', { timeout: 5000 });
  await expect(seeds).toHaveAttribute('data-e2e-marker', '1');
});

test('Alter Spielstand (v7, ohne Statistik): Über alle Zyklen beginnt beim laufenden Zyklus', async ({ page, context }) => {
  const state = createInitialState(Date.now(), 777);
  state.totalGrowth = waypoint(6) + 1;
  state.cycle.number = 3;
  state.cycle.elapsed = 2 * YEAR_SECONDS;
  const { stats: _stats, ...meta } = state.meta;
  await seedRaw(context, { ...state, version: 7, meta }, 0);
  await openGame(page);
  // Gespeichert spätestens beim Verlassen – dann im neuen Format.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  const saved = await savedState(page);
  expect(saved.version).toBe(SAVE_VERSION);
  expect(saved.meta.stats).toMatchObject({ cardsChosen: 0, grownTrees: ['oak'] });
  expect(saved.meta.stats.playSeconds).toBeGreaterThanOrEqual(2 * YEAR_SECONDS);
  await openGoalsPage(page, 'stats');
  await expect(stat(page, 'total-time')).toContainText('24 Min.');
  await expect(stat(page, 'total-cards')).toContainText('0');
  await expect(stat(page, 'total-trees')).toContainText('Stieleiche');
});

test('Andenken: Hauptbaum-Arten mit Status, gesperrte mit Hinweis, aktuelle markiert', async ({ page, context }) => {
  await seedSecondCycle(context);
  await openGame(page);
  await openKeepsakes(page);
  const panel = keepsakes(page);
  await expect(panel.getByRole('heading', { name: 'Hauptbaum-Arten' })).toBeVisible();

  const oak = panel.locator('[data-tree="oak"]');
  const beech = panel.locator('[data-tree="beech"]');
  const pine = panel.locator('[data-tree="pine"]');
  await expect(oak).toContainText('Stieleiche');
  // Die Eiche war im ersten Zyklus Hauptbaum (Langzeit-Statistik).
  await expect(oak).toContainText('schon gewachsen');
  await expect(pine).toContainText('Waldkiefer');
  await expect(pine).toContainText('wächst in diesem Zyklus');
  await expect(pine).toHaveClass(/is-current/);
  await expect(beech).toContainText('gesperrt');
  await expect(beech).toContainText('Lass einmal eine Rotbuche im Pflanzring wachsen.');
  // Zähler: Eiche und Kiefer freigeschaltet, keine Erinnerungen.
  await expect(tabPanel(page, 'arten').locator('[data-jump="keepsakes"]')).toContainText('2');
  await expect(panel).toContainText('Noch keine Erinnerungen');
});

test('Andenken im ersten Zyklus: gesperrte Arten ohne Namen (keine Spoiler)', async ({ page, context }) => {
  const state = createInitialState(Date.now(), 99);
  state.totalGrowth = waypoint(3) + 1;
  await seedRaw(context, state, 0);
  await openGame(page);
  await openKeepsakes(page);
  const panel = keepsakes(page);
  await expect(panel.locator('[data-tree="oak"]')).toContainText('wächst in diesem Zyklus');
  await expect(panel.locator('.species-tree.is-unknown')).toHaveCount(2);
  const html = await tabPanel(page, 'arten').evaluate((d) => d.outerHTML);
  expect(html).not.toContain('Rotbuche');
  expect(html).not.toContain('Waldkiefer');
  expect(html).not.toContain('data-tree="beech"');
  expect(html).not.toContain('data-tree="pine"');
});

for (const width of [360, 390]) {
  test.describe(`Mobil (${width} px)`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });

    test('Statistik und Andenken ohne horizontales Scrollen', async ({ page, context }) => {
      await seedSecondCycle(context);
      await openGame(page);
      const noScroll = () =>
        page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      await openGoalsPage(page, 'stats');
      expect(await noScroll()).toBe(true);
      expect(await statsPage(page).evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
      await page.locator('[data-ref="bookmark"]:visible').tap();
      await expect(statsPage(page)).toBeHidden();
      await openKeepsakes(page);
      expect(await noScroll()).toBe(true);
      // Kein Samentütchen ragt rechts aus der Seite.
      const right = (await tabPanel(page, 'arten').boundingBox())!;
      for (const box of await keepsakes(page).locator('li').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
        expect(box.x + box.width).toBeLessThanOrEqual(right.x + right.width + 0.5);
      }
    });
  });
}
