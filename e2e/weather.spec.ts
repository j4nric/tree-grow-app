import type { Page } from '@playwright/test';
import { SEASONS_BY_ID, SEASON_IDS, SEASON_SECONDS } from '../src/content/seasons';
import { STAGES } from '../src/content/stages';
import { GENTLE_DAYS, type WeatherId } from '../src/content/weather';
import { createInitialState, type GameState } from '../src/core/state';
import { weatherOfDay } from '../src/core/weather';
import { toWeatherBadgeView } from '../src/ui/weather-view';
import { expect, openGame, seedRaw, test, waypoint } from './fixtures';

/**
 * Wetter und Nacht in der Oberfläche (DESIGN_V2.md 21.8): Abzeichen mit aufklappbarer
 * Erklärung, ein gemeinsamer Hinweis für Jahreszeiten- und Wetterwechsel, 🌙 an Nachtarten
 * und „Wetter gemittelt“ nach längerer Abwesenheit. Die Testuhr steht still.
 */

const START = new Date('2026-10-21T08:00:00Z');
const badge = (page: Page) => page.locator('[data-ref="weather"]');
const details = (page: Page) => page.locator('[data-ref="weather-details"]');
/** Fünf Gattungen: Vielfalt dämpft den Abzug rauer Lagen um 50 %. */
const GROVE = ['vole', 'robin', 'bee', 'earthworm', 'chanterelle'];
const NICHE: Record<string, keyof GameState['niches']> = {
  vole: 'roots',
  robin: 'litter',
  bee: 'edge',
  earthworm: 'roots',
  chanterelle: 'roots',
  owl: 'hollows',
};

async function startClock(page: Page): Promise<void> {
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
}

/** Erster Tag nach der Schonzeit mit diesem Wetter. */
function dayWith(state: GameState, id: WeatherId): number {
  for (let d = GENTLE_DAYS + 1; d < 10_000; d++) if (weatherOfDay(state.cycle, d) === id) return d;
  throw new Error(`kein Tag mit ${id}`);
}

/** Alter Baum (Stufe 5) mit Tieren; `second` = Spielzeit im Tag mit dem gewünschten Wetter. */
function forestOn(id: WeatherId, animals: string[], second: number): GameState {
  const state = createInitialState(START.getTime(), 7);
  state.stage = 5;
  state.waypoint = STAGES[5]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  for (const a of animals) {
    state.niches[NICHE[a]!]!.push(a);
    state.meta.journal.species.push(a);
  }
  state.cycle.elapsed = dayWith(state, id) * SEASON_SECONDS + second;
  return state;
}

test('Abzeichen: Sturm mit gedämpftem Abzug, Erklärung per Tippen und Tastatur', async ({ page, context }) => {
  await startClock(page);
  const state = forestOn('storm', GROVE, 10);
  await seedRaw(context, state, 0);
  await openGame(page);

  await expect(badge(page)).toHaveText('🌬️ Sturm · −8 % 🌿 · +25 % 🌰');
  await expect(badge(page)).toHaveText(toWeatherBadgeView(state).text);
  await expect(badge(page)).toHaveAttribute('data-weather', 'storm');
  await expect(badge(page)).toHaveAccessibleName(/^Wetter heute: Sturm, −8 % Wachstum, \+25 % Samen/);
  await expect(badge(page)).toHaveAttribute('title', /Böen zerren .* Morgen: /);
  await expect(badge(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(details(page)).toBeHidden();

  // Antippen klappt die Erklärung auf: Wirkung, Dämpfung, Tipp, Vorhersage.
  await badge(page).click();
  await expect(badge(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(details(page)).toBeVisible();
  await expect(details(page).locator('[data-ref="weather-effects"]')).toHaveText('Heute: −7,5 % 🌿 (statt −15 %) · +25 % 🌰');
  await expect(details(page).locator('[data-ref="weather-damping"]')).toHaveText('Abzug gedämpft: Vielfalt −50 % (5 Gattungen).');
  await expect(details(page).locator('[data-ref="weather-tip"]')).toContainText('„Lichte Krone“ halbiert den Abzug');
  await expect(details(page).locator('[data-ref="weather-forecast"]')).toHaveText(/^Morgen: /);
  await expect(details(page).locator('[data-ref="weather-daytime"]')).toContainText('☀️ Tag');
  await expect(details(page).locator('[data-ref="weather-daytime-note"]')).toBeHidden();

  // Escape klappt zu, der Fokus bleibt am Knopf; Enter öffnet wieder.
  await page.keyboard.press('Escape');
  await expect(details(page)).toBeHidden();
  await expect(badge(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(details(page)).toBeVisible();
});

test('ein Hinweis für Jahreszeit und Wetter am selben Wechsel', async ({ page, context }) => {
  await startClock(page);
  // 2 s vor einem Sturmtag.
  const state = forestOn('storm', [], 0);
  state.cycle.elapsed -= 2;
  await seedRaw(context, state, 0);
  await openGame(page);
  const day = Math.round((state.cycle.elapsed + 2) / SEASON_SECONDS);
  const season = SEASONS_BY_ID.get(SEASON_IDS[day % 4]!)!;

  await page.clock.runFor(3_000);
  await expect(badge(page)).toHaveAttribute('data-weather', 'storm');
  const toast = page.locator('#toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(`${season.icon} ${season.name} · 🌬️ Sturm – ${season.text}`);
  await expect(toast).toContainText('Böen zerren an der Krone');
});

test('Nacht: 🌙 an der Rate und an der Kachel des Waldkauzes', async ({ page, context }) => {
  await startClock(page);
  // Sekunde 79: kurz vor Sonnenuntergang (Nacht ab Sekunde 81).
  const state = forestOn('mild', ['owl'], 79);
  await seedRaw(context, state, 0);
  await openGame(page);
  const moon = page.locator('[data-ref="growth-rate-night"]');
  const tileMoon = page.locator('.slot[data-species="owl"] .slot-night');
  await expect(tileMoon).toBeVisible();
  await expect(tileMoon).not.toHaveClass(/active/);
  await expect(moon).toBeHidden();

  await page.clock.runFor(3_000);
  await expect(moon).toBeVisible();
  await expect(moon).toHaveAttribute('title', 'Nachtbonus: Waldkauz');
  await expect(tileMoon).toHaveClass(/active/);
  await expect(page.locator('[data-ref="seeds-night"]')).toBeHidden();
  await badge(page).click();
  await expect(details(page).locator('[data-ref="weather-daytime"]')).toContainText('nachtaktiv: Waldkauz (+10 % 🌿)');
});

test('Rückkehr nach Stunden: „Wetter gemittelt“ in der Begrüßung', async ({ page, context }) => {
  await startClock(page);
  const state = forestOn('mild', [], 10);
  await seedRaw(context, state, -3 * 3600 * 1000);
  await openGame(page);
  await expect(page.locator('#toast')).toContainText('Willkommen zurück!');
  await expect(page.locator('#toast')).toContainText(/Wetter gemittelt( \(.+\))?\./);
});

test.describe('mobil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Abzeichen und Erklärung ohne Überlauf (390 und 360 px)', async ({ page, context }) => {
    await startClock(page);
    await seedRaw(context, forestOn('sun', GROVE, 10), 0);
    await openGame(page);
    await badge(page).scrollIntoViewIfNeeded();
    await badge(page).tap();
    await expect(details(page)).toBeVisible();
    const box = await badge(page).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('#panel')!;
      const season = document.querySelector<HTMLElement>('#season')!;
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panel: panel.scrollWidth - panel.clientWidth,
        season: season.scrollWidth - season.clientWidth,
      };
    });
    expect(overflow).toEqual({ page: 0, panel: 0, season: 0 });
    // Auch bei der schmalsten unterstützten Breite.
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(() => {
        const season = document.querySelector<HTMLElement>('#season')!;
        return [document.documentElement.scrollWidth - document.documentElement.clientWidth, season.scrollWidth - season.clientWidth];
      }),
    ).toEqual([0, 0]);
  });
});
