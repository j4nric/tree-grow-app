import type { BrowserContext, Page } from '@playwright/test';
import { ACHIEVEMENTS } from '../src/content/achievements';

// Ohne freigeschaltete Landschaft sind deren Erfolge verborgen und zählen nicht mit.
const VISIBLE = ACHIEVEMENTS.filter((a) => a.requires !== 'landscape').length;
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { YEAR_SECONDS } from '../src/content/seasons';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { createInitialState } from '../src/core/state';
import { SAVE_VERSION, dialog, expect, openGame, openStack, openTab, savedState, seedRaw, stack, test, waypoint } from './fixtures';

/**
 * Erfolge (DESIGN_V2.md 18): Reiter „Erfolge“ im Naturtagebuch, leiser Hinweis beim
 * Freischalten (auch bei offenem Tagebuch), Sammelhinweis nach der Migration v8 → v9 und
 * Mobilansicht. Die Testuhr steht still; Zeit vergeht nur über `page.clock`.
 */

const START = new Date('2026-10-21T08:00:00Z');
const journal = (page: Page) => page.locator('[data-ref="journal"]');
const toast = (page: Page) => page.locator('#toast');
const achievement = (page: Page, id: string) => journal(page).locator(`[data-achievement="${id}"]`);

async function startClock(page: Page): Promise<void> {
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
}

/** v8-Stand (vor den Erfolgen) im Hain, mit bewirteten Gästen und drei Arten. */
async function seedV8Grove(context: BrowserContext): Promise<void> {
  const state = createInitialState(START.getTime(), 4242);
  state.totalGrowth = waypoint(STAGES[NEW_CYCLE_MIN_STAGE]!.waypoint) + 1;
  state.niches.crown = ['bluetit'];
  state.meta.journal.species = ['bluetit', 'earthworm', 'robin'];
  state.meta.stats.visitorsHosted = 3;
  const { achievements: _a, ...meta } = state.meta;
  await seedRaw(context, { ...state, version: 8, meta }, 0);
}

async function openJournal(page: Page): Promise<void> {
  await openTab(page, 'arten');
  await page.locator('[data-ref="journal-open"]').click();
  await expect(journal(page)).toBeVisible();
}

test('v8-Stand: ein Sammelhinweis, Reiter „Erfolge“ mit Zähler, erreichte und offene Kacheln', async ({ page, context }) => {
  await startClock(page);
  await seedV8Grove(context);
  await openGame(page);
  // Nur eine zusammenfassende Meldung, keine Flut einzelner Hinweise.
  await expect(toast(page)).toContainText(/🏅 \d+ Erfolge nachgetragen/);
  await expect(toast(page)).not.toContainText('Erfolg: ');

  // Gleich im neuen Format gespeichert – der Hinweis kommt nur einmal.
  const saved = await savedState(page);
  expect(saved.version).toBe(SAVE_VERSION);
  expect(saved.meta.achievements).toEqual(expect.arrayContaining(['sapling', 'grove', 'visitor-1']));
  const unlocked = saved.meta.achievements.length as number;

  await openJournal(page);
  const tab = journal(page).getByRole('tab', { name: /Erfolge/ });
  await expect(tab).toContainText(`${unlocked}/${VISIBLE}`);
  // Per Tastatur: Ende → Statistik, einmal links → Erfolge.
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const panel = journal(page).getByRole('tabpanel', { name: /Erfolge/ });
  await expect(panel).toBeVisible();

  const done = panel.getByRole('list', { name: 'Erreicht' });
  const open = panel.getByRole('list', { name: 'Noch offen' });
  await expect(done.getByRole('listitem')).toHaveCount(unlocked);
  await expect(open.getByRole('listitem')).toHaveCount(VISIBLE - unlocked);
  await expect(achievement(page, 'grove')).toContainText('Nicht mehr allein');
  await expect(achievement(page, 'grove')).toHaveAttribute('data-unlocked', 'true');
  // Offen: Titel, neutrale Beschreibung und Fortschritt (für Screenreader beschriftet).
  const species = achievement(page, 'species-5');
  await expect(species).toHaveAttribute('data-unlocked', 'false');
  await expect(species).toContainText('Erste Nachbarn');
  await expect(species.locator('.journal-progress')).toHaveText('Fortschritt 3/5');
  await expect(achievement(page, 'visitor-10').locator('.journal-progress')).toContainText('3/10');
  // Nichts Unentdecktes beim Namen.
  const html = await panel.evaluate((p) => p.textContent ?? '');
  for (const s of SPECIES.filter((x) => !['bluetit', 'earthworm', 'robin'].includes(x.id))) expect(html).not.toContain(s.name);
});

test('Freischalten beim Spielen: leiser Hinweis, bei offenem Tagebuch im Dialog', async ({ page, context }) => {
  await startClock(page);
  const state = createInitialState(START.getTime(), 777);
  state.cycle.elapsed = YEAR_SECONDS - 2; // 2 s vor dem ersten vollen Jahr
  await seedRaw(context, state, 0);
  await openGame(page);
  await openJournal(page);
  await journal(page).getByRole('tab', { name: /Erfolge/ }).click();
  await expect(journal(page).getByRole('tab', { name: /Erfolge/ })).toContainText(`0/${VISIBLE}`);
  await expect(journal(page).getByRole('tabpanel', { name: /Erfolge/ })).toContainText('Noch keine Erfolge');

  await page.clock.runFor(3_000);
  // Wie andere Hinweise: im offenen Dialog statt als Toast (gemeinsam mit der Jahreszeit).
  const notice = journal(page).getByRole('status');
  await expect(notice).toContainText('🏅 Erfolg: „Ein ganzes Jahr“');
  await expect(notice).toContainText('Frühling');
  await expect(achievement(page, 'full-year')).toHaveAttribute('data-unlocked', 'true');
  await expect(journal(page).getByRole('tab', { name: /Erfolge/ })).toContainText(`1/${VISIBLE}`);
  const saved = await savedState(page);
  expect(saved.meta.achievements).toEqual(['full-year']);
});

test('Begegnungsdialog offen, Stapel voll, Wegpunkt mit Erfolg: beide Hinweise in einem Text', async ({ page, context }) => {
  await startClock(page);
  const state = createInitialState(START.getTime(), 4711);
  // Kurz vor dem Setzling (Wegpunkt 3): Der nächste Wegpunkt bringt Stufe und Erfolg.
  state.totalGrowth = waypoint(3) - 0.5;
  state.pendingEncounters = [
    { type: 'animal', cards: ['bluetit'], rerolls: 0 },
    { type: 'animal', cards: ['oakmoth'], rerolls: 0 },
    { type: 'animal', cards: ['robin'], rerolls: 0 },
  ];
  await seedRaw(context, state, 0);
  await openGame(page);
  await expect(stack(page)).toHaveText(/3 Begegnungen warten/);
  await openStack(page);

  // In Einzelframes: Der Wegpunkt fällt in tick() eines Frames.
  await page.clock.runFor(2_000);
  const notice = dialog(page).getByRole('status');
  // „Stapel voll …“ wird nicht vom Erfolg verdrängt – beides steht im Hinweis.
  await expect(notice).toContainText(/Stapel voll – eine Begegnung zog weiter/);
  await expect(notice).toContainText('🏅 Erfolg: „Ein dünner Stamm“');
  expect((await savedState(page)).meta.achievements).toEqual(['sapling']);
});

test('Offenes Tagebuch: Fortschritt der Zeit-Erfolge läuft mit', async ({ page, context }) => {
  await startClock(page);
  const state = createInitialState(START.getTime(), 778);
  state.cycle.elapsed = 118; // knapp 2 Min. von 12 Min. (ein Jahr)
  await seedRaw(context, state, 0);
  await openGame(page);
  await openJournal(page);
  await journal(page).getByRole('tab', { name: /Erfolge/ }).click();
  const progress = achievement(page, 'full-year').locator('.journal-progress');
  const before = await progress.textContent();
  expect(before).toContain('1 Min.');
  // Kachel bleibt dieselbe (kein Neubau), nur der Text ändert sich.
  await achievement(page, 'full-year').evaluate((li) => ((li as HTMLElement & { e2eMark?: boolean }).e2eMark = true));
  await page.clock.runFor(3_000);
  await expect(progress).not.toHaveText(before ?? '');
  await expect(progress).toContainText('2 Min.');
  expect(await achievement(page, 'full-year').evaluate((li) => (li as HTMLElement & { e2eMark?: boolean }).e2eMark)).toBe(true);
});

for (const width of [360, 390]) {
  test.describe(`Mobil (${width} px)`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });

    test('Reiter „Erfolge“ ohne horizontales Scrollen', async ({ page, context }) => {
      await startClock(page);
      await seedV8Grove(context);
      await openGame(page);
      await openJournal(page);
      await journal(page).getByRole('tab', { name: /Erfolge/ }).tap();
      await expect(journal(page).getByRole('tabpanel', { name: /Erfolge/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await journal(page).evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
      for (const box of await journal(page).getByRole('tab').evaluateAll((tabs) => tabs.map((t) => t.getBoundingClientRect().toJSON()))) {
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.right).toBeLessThanOrEqual(width);
      }
    });
  });
}
