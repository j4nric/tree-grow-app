import type { BrowserContext, Page } from '@playwright/test';
import { createInitialState, type DailyGoal } from '../src/core/state';
import { SAVE_VERSION, dialog, expect, gotoTab, openStack, savedState, seedRaw, stack, stamps, test, waypoint } from './fixtures';

/**
 * Tagesziele (DESIGN_V2.md 20): Karte in der Seitenleiste, ein Ziel durch eine Entscheidung
 * erfüllen (Belohnung mit Hinweis, Serie, gespeichert), Tageswechsel um Mitternacht mit
 * Serie, Mobilansicht ohne Querscrollen. Die Testuhr steht still (Europe/Berlin), Zeit
 * vergeht nur über `page.clock`.
 */

test.use({ timezoneId: 'Europe/Berlin', daily: true });

/** 21.10.2026, 10:00 Uhr in Berlin. */
const START = new Date('2026-10-21T08:00:00Z');
const TODAY = '2026-10-21';
const daily = (page: Page) => page.locator('[data-ref="daily"]');
const goalItem = (page: Page, kind: string) => daily(page).locator(`[data-goal="${kind}"]`);
const toast = (page: Page) => stamps(page);

async function startClock(page: Page, time = START): Promise<void> {
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}

const goal = (kind: DailyGoal['kind'], target: number, extra: Partial<DailyGoal> = {}): DailyGoal => ({
  kind,
  target,
  progress: 0,
  reward: 'seeds',
  done: false,
  ...extra,
});

/** Keimling mit einer wartenden Tierbegegnung und festen Zielen für `day`. */
async function seedDay(context: BrowserContext, day: string, goals: DailyGoal[], streak = { streak: 0, lastDay: '' }): Promise<void> {
  const state = createInitialState(START.getTime(), 777);
  state.totalGrowth = waypoint(1) + 1;
  state.pendingEncounters = [{ type: 'animal', cards: ['earthworm'], rerolls: 0 }];
  state.meta.daily = { ...state.meta.daily, day, goals, ...streak, bestStreak: streak.streak };
  await seedRaw(context, state, 0);
}

test('Tagesziel durch Ablehnen erfüllen: Hinweis mit Samen, Haken, Serie, gespeichert', async ({ page, context }) => {
  await startClock(page);
  await seedDay(context, TODAY, [goal('decide', 1), goal('growth', 1_000_000)]);
  await gotoTab(page, 'ziele');

  await expect(daily(page).getByRole('heading', { name: 'Tagesziele' })).toBeVisible();
  await expect(daily(page)).toContainText('0/2 erfüllt');
  const decide = goalItem(page, 'decide');
  await expect(decide).toContainText('Entscheide eine Begegnung');
  await expect(decide.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await expect(decide.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '1');
  await expect(decide).toContainText('0/1');
  await expect(goalItem(page, 'growth')).toContainText('Lass deinen Baum um 1 Mio. 🌿 wachsen.');

  await openStack(page);
  // Eingabesperre des Dialogs läuft über die (angehaltene) Testuhr.
  await page.clock.runFor(500);
  await dialog(page).getByRole('button', { name: /^Ablehnen/ }).click();
  await expect(stack(page)).toBeHidden();
  await expect(toast(page)).toContainText('✅ Tagesziel erfüllt:');
  await expect(toast(page)).toContainText(/\+\d+(,\d)? 🌰/);
  await expect(decide).toHaveClass(/done/);
  await expect(decide).toContainText('✓ erfüllt');
  await expect(decide.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await expect(daily(page)).toContainText('1/2 erfüllt');
  await expect(daily(page).locator('[data-ref="daily-streak"]')).toHaveText('🌞 1 Tag in Folge');

  const saved = await savedState(page);
  expect(saved.version).toBe(SAVE_VERSION);
  expect(saved.meta.daily).toMatchObject({ day: TODAY, streak: 1, bestStreak: 1, lastDay: TODAY, goalsDone: 1 });
  expect(saved.meta.daily.goals[0]).toMatchObject({ kind: 'decide', done: true, progress: 1 });

  // Neuladen: dasselbe Ziel bleibt erfüllt, nichts wird doppelt belohnt.
  await page.reload();
  await expect(goalItem(page, 'decide')).toHaveClass(/done/);
  expect((await savedState(page)).meta.daily.goalsDone).toBe(1);
});

test('Mitternacht: neue Ziele, die Serie von gestern zählt weiter', async ({ page, context }) => {
  // 23:59:50 Uhr in Berlin, die Ziele sind von heute und schon erfüllt.
  const lateEvening = new Date('2026-10-21T21:59:50Z');
  await startClock(page, lateEvening);
  await seedDay(context, TODAY, [goal('decide', 1, { progress: 1, done: true }), goal('seeds', 5, { progress: 5, done: true })], {
    streak: 2,
    lastDay: TODAY,
  });
  await gotoTab(page, 'ziele');
  await expect(daily(page)).toContainText('Alle erfüllt – bis morgen!');
  await expect(daily(page).locator('[data-ref="daily-streak"]')).toHaveText('🌞 2 Tage in Folge');

  await page.clock.runFor(15_000);
  await expect(daily(page)).toContainText('0/3 erfüllt');
  await expect(daily(page).locator('.daily-goal.done')).toHaveCount(0);
  // Gestern erfüllt: Die Serie gilt noch, bis heute ein Ziel dazukommt.
  await expect(daily(page).locator('[data-ref="daily-streak"]')).toHaveText('🌞 2 Tage in Folge');
  const saved = await savedState(page);
  expect(saved.meta.daily.day).toBe('2026-10-22');
  expect(saved.meta.daily.goals).toHaveLength(3);
});

for (const width of [360, 390]) {
  test.describe(`Mobil (${width} px)`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });

    test('Tagesziele ohne horizontales Scrollen', async ({ page, context }) => {
      await startClock(page);
      await seedDay(context, TODAY, [
        goal('community', 1, { community: 'pond-life' }),
        goal('observe', 3, { genus: 'amphibians', season: 'spring' }),
        goal('growth', 123_456_789),
      ]);
      await gotoTab(page, 'ziele');
      await daily(page).scrollIntoViewIfNeeded();
      await expect(daily(page).locator('.daily-goal')).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const box = (await daily(page).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      for (const item of await daily(page).locator('.daily-goal').all()) {
        const b = (await item.boundingBox())!;
        expect(b.x + b.width).toBeLessThanOrEqual(width);
      }
    });
  });
}
