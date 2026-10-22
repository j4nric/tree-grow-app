import type { BrowserContext, Page } from '@playwright/test';
import { SEASON_SECONDS, YEAR_SECONDS } from '../src/content/seasons';
import { createInitialState } from '../src/core/state';
import { SAVE_VERSION, expect, openGame, openTab, savedState, seedRaw, test, waypoint } from './fixtures';

/**
 * Naturtagebuch, Reiter „Statistik“ (Kennzahlen aus dem Spielstand) und „Andenken“
 * (Hauptbaum-Arten: freigeschaltet, gesperrt mit Hinweis, aktuelle Art markiert).
 */

const journal = (page: Page) => page.locator('[data-ref="journal"]');
const stat = (page: Page, key: string) => journal(page).locator(`[data-stat="${key}"]`);

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

async function openJournal(page: Page): Promise<void> {
  await openTab(page, 'arten');
  await page.locator('[data-ref="journal-open"]').click();
  await expect(journal(page)).toBeVisible();
}

test('Statistik: per Tastatur erreichbar, Kennzahlen aus dem Spielstand, Samen laufen mit', async ({
  page,
  context,
}) => {
  await seedSecondCycle(context);
  await openGame(page);
  await openJournal(page);

  // Reiter per Tastatur: Ende → Statistik (letzter Reiter).
  await expect(journal(page).getByRole('tab', { name: /Arten/ })).toBeFocused();
  await page.keyboard.press('End');
  const tab = journal(page).getByRole('tab', { name: 'Statistik' });
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const panel = journal(page).getByRole('tabpanel', { name: 'Statistik' });
  await expect(panel).toBeVisible();

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

  // Samen wachsen weiter – die Zahl im offenen Dialog läuft mit (ohne Neubau der Zeilen).
  const seeds = stat(page, 'seeds').locator('.journal-stat-number');
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
  await openJournal(page);
  await journal(page).getByRole('tab', { name: 'Statistik' }).click();
  await expect(stat(page, 'total-time')).toContainText('24 Min.');
  await expect(stat(page, 'total-cards')).toContainText('0');
  await expect(stat(page, 'total-trees')).toContainText('Stieleiche');
});

test('Andenken: Hauptbaum-Arten mit Status, gesperrte mit Hinweis, aktuelle markiert', async ({ page, context }) => {
  await seedSecondCycle(context);
  await openGame(page);
  await openJournal(page);
  await journal(page).getByRole('tab', { name: /Andenken/ }).click();
  const panel = journal(page).getByRole('tabpanel', { name: /Andenken/ });
  await expect(panel.getByRole('heading', { name: 'Hauptbaum-Arten' })).toBeVisible();

  const oak = panel.locator('[data-tree="oak"]');
  const beech = panel.locator('[data-tree="beech"]');
  const pine = panel.locator('[data-tree="pine"]');
  await expect(oak).toContainText('Stieleiche');
  // Die Eiche war im ersten Zyklus Hauptbaum (Langzeit-Statistik).
  await expect(oak).toContainText('schon gewachsen');
  await expect(pine).toContainText('Waldkiefer');
  await expect(pine).toContainText('wächst in diesem Zyklus');
  await expect(pine).toHaveClass(/current/);
  await expect(beech).toContainText('gesperrt');
  await expect(beech).toContainText('Lass einmal eine Rotbuche im Pflanzring wachsen.');
  // Zähler: Eiche und Kiefer freigeschaltet, keine Erinnerungen.
  await expect(journal(page).getByRole('tab', { name: /Andenken/ })).toContainText('2');
  await expect(panel).toContainText('Noch keine Erinnerungen');
});

test('Andenken im ersten Zyklus: gesperrte Arten ohne Namen (keine Spoiler)', async ({ page, context }) => {
  const state = createInitialState(Date.now(), 99);
  state.totalGrowth = waypoint(3) + 1;
  await seedRaw(context, state, 0);
  await openGame(page);
  await openJournal(page);
  await journal(page).getByRole('tab', { name: /Andenken/ }).click();
  const panel = journal(page).getByRole('tabpanel', { name: /Andenken/ });
  await expect(panel.locator('[data-tree="oak"]')).toContainText('wächst in diesem Zyklus');
  await expect(panel.locator('.journal-tree.unknown')).toHaveCount(2);
  const html = await journal(page).evaluate((d) => d.outerHTML);
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
      await openJournal(page);
      const noScroll = () =>
        page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      for (const name of [/Statistik/, /Andenken/]) {
        await journal(page).getByRole('tab', { name }).tap();
        expect(await noScroll()).toBe(true);
        expect(await journal(page).evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
      }
      // Die Reiter scrollen in ihrer eigenen Leiste (nicht die Seite); alle bleiben 44 px hoch.
      for (const box of await journal(page).getByRole('tab').evaluateAll((tabs) => tabs.map((t) => t.getBoundingClientRect().toJSON()))) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const bar = (await journal(page).getByRole('tablist').boundingBox())!;
      expect(bar.x + bar.width).toBeLessThanOrEqual(width);
    });
  });
}
