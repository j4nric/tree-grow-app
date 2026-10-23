import type { Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, createSite, type GameState } from '../src/core/state';
import {
  expect,
  gotoTab,
  openGame,
  openGoalsPage,
  overlaps,
  seedRaw,
  settledStamp,
  stamp,
  tabButton,
  test,
  waypoint,
} from './fixtures';

/**
 * Album-Layout nach dem Aufräumen (docs/ALBUM_UI.md, F-12 und Playtest-Funde): Reiterleiste
 * passt mobil auch mit fünf Reitern, breiter Ersatzschrift und 125 % Schrift; Meldungen
 * verdecken keine Navigation; mitgelieferte Schrift-Lizenzen.
 */

const ANCIENT = STAGES.findIndex((s) => s.id === 'ancient-forest');

/** Urwald mit freigeschalteter Landschaft: fünf Reiter. */
function landscapeState(): GameState {
  const state = createInitialState(Date.now(), 4242);
  state.stage = ANCIENT;
  state.waypoint = STAGES[ANCIENT]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.cycle.number = 4;
  state.meta.forestMemory = 300;
  state.meta.achievements = ['ancient-forest'];
  state.meta.landscape = { active: 'home', sites: [{ ...createSite('home'), ancient: true }], corridors: [], freeCorridors: [], announced: true };
  state.niches.roots = ['earthworm'];
  state.meta.journal.species.push('earthworm');
  return state;
}

/**
 * Breite Ersatzschrift wie auf Linux-Runnern ohne Caveat/Nunito, dazu 125 % Text in den
 * Reitern – vor dem Aufbau des Albums gesetzt (wie eine Systemschrift bzw. Textgröße).
 */
async function wideFont(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = `.album, .album button, .tab { font-family: 'DejaVu Sans', sans-serif !important; } .tab-label { font-size: 125%; }`;
      document.head.append(style);
    });
  });
}

/** Alle sichtbaren Reiter liegen ganz in der Leiste, und die Leiste scrollt nicht quer. */
async function expectTabsFit(page: Page): Promise<void> {
  const fit = await page.locator('[data-ref="tabs"]').evaluate((strip) => {
    const box = strip.getBoundingClientRect();
    const tabs = [...strip.querySelectorAll<HTMLElement>('.tab:not([hidden])')].map((t) => t.getBoundingClientRect());
    return {
      overflow: strip.scrollWidth - strip.clientWidth,
      count: tabs.length,
      outside: tabs.filter((t) => t.left < box.left - 1 || t.right > box.right + 1).length,
      small: tabs.filter((t) => t.width < 44 || t.height < 44).length,
    };
  });
  expect(fit.count).toBe(5);
  expect(fit.overflow).toBeLessThanOrEqual(1);
  expect(fit.outside).toBe(0);
  expect(fit.small).toBe(0);
}

/** Der gewählte Reiter zeigt seinen Namen ausgeschrieben (nicht nur das Symbol). */
async function expectNamed(page: Page, tab: Parameters<typeof tabButton>[1]): Promise<void> {
  const label = tabButton(page, tab).locator('.tab-label');
  await expect(label).toBeVisible();
  expect(await label.evaluate((l) => l.getBoundingClientRect().width > 20 && l.scrollWidth <= l.clientWidth + 1)).toBe(true);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
]) {
  test(`Fünf Reiter passen in ${viewport.width} px`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await seedRaw(context, landscapeState(), 0);
    await gotoTab(page, 'landschaft');
    await expectTabsFit(page);
    // Der gewählte Reiter zeigt seinen Namen ganz.
    await expectNamed(page, 'landschaft');
  });

  test(`Fünf Reiter passen in ${viewport.width} px mit DejaVu Sans und 125 % Schrift`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await wideFont(page);
    await seedRaw(context, landscapeState(), 0);
    await gotoTab(page, 'landschaft');
    await expectTabsFit(page);
    await expectNamed(page, 'landschaft');
    // Reiterwechsel per Tastatur: Der neue Reiter zeigt seinen Namen, die Leiste passt weiter.
    await tabButton(page, 'landschaft').focus();
    await page.keyboard.press('Home');
    await expect(tabButton(page, 'nischen')).toHaveAttribute('aria-selected', 'true');
    await expectNamed(page, 'nischen');
    await expectTabsFit(page);
    // Zugänglicher Name bleibt der volle Name (das Symbol wird nicht vorgelesen).
    await expect(page.getByRole('tab', { name: 'Landschaft', exact: true })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test.describe('mobil', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Meldungen verdecken weder Reiterleiste noch Lesezeichen und Seitentitel', async ({ page, context }) => {
    // Beim Laden kommen neue Erfolge: ein Zettel, der eine Weile stehen bleibt.
    await seedRaw(context, landscapeState(), 0);
    await gotoTab(page, 'nischen');
    const layer = page.locator('[data-ref="stamps"]');
    const latest = await settledStamp(page);
    await expect(latest).toContainText('Erfolge');
    // Ganz oben auf der Hauptansicht: über dem Bild, neben dem Umschlag-Knopf.
    await expect(layer).toHaveClass(/stamps-top/);
    expect(overlaps((await latest.boundingBox())!, (await page.locator('[data-ref="cover-open"]').boundingBox())!)).toBe(false);

    // Gescrollt: Die Reiterleiste klebt oben – die Meldung rückt nach unten.
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect(layer).not.toHaveClass(/stamps-top/);
    // Darüber die Vorratsleiste (30 px): Die Reiter kleben direkt darunter.
    const strip = (await page.locator('[data-ref="tabs"]').boundingBox())!;
    expect(strip.y).toBeLessThanOrEqual(31);
    await expect.poll(async () => overlaps((await stamp(page).boundingBox())!, (await page.locator('.supply-bar-inner').boundingBox())!)).toBe(false);
    await expect.poll(async () => overlaps((await stamp(page).boundingBox())!, strip)).toBe(false);

    // Unterseite: Lesezeichen und Titel oben bleiben frei.
    const sub = await openGoalsPage(page, 'cycle');
    await expect(stamp(page)).toBeVisible();
    await expect(layer).not.toHaveClass(/stamps-top/);
    const box = (await stamp(page).boundingBox())!;
    for (const target of [sub.locator('[data-ref="bookmark"]'), sub.locator('.page-title')]) {
      expect(overlaps(box, (await target.boundingBox())!)).toBe(false);
    }
    // Und nichts ragt über den Rand.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  });
});

test('Schrift-Lizenzen (SIL OFL) werden mit ausgeliefert', async ({ page }) => {
  await openGame(page);
  for (const name of ['OFL-Caveat.txt', 'OFL-Nunito.txt']) {
    const res = await page.request.get(`licenses/${name}`);
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain('SIL OPEN FONT LICENSE');
  }
});

