import type { Locator, Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import {
  cover,
  expect,
  gotoTab,
  openCover,
  openGame,
  openGoalsPage,
  openTab,
  overlaps,
  pageTitle,
  seedRaw,
  settledStamp,
  stamp,
  stamps,
  tabButton,
  test,
  waypoint,
} from './fixtures';

/**
 * Lage der Meldungen (docs/ALBUM_UI.md C.5, Playtest Schritt 14): Stempel und Zettel verdecken
 * nie eine scharfe Bestätigung, „Schließen“ im Umschlag oder den fokussierten Knopf (M2), sie
 * springen beim langsamen Scrollen nicht zwischen oben und unten (S2), und nach einem
 * Reiterwechsel ist mobil die neue Seite zu sehen (S5).
 */

const GROVE = STAGES.findIndex((s) => s.id === 'grove');

// „Hinweise länger“ (12 s statt 6 s): Der Erfolge-Stempel steht sicher, bis Umschlag und
// U:Neuer Zyklus aufgeschlagen sind – auch auf einem ausgelasteten Rechner.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('tree-grow-settings', JSON.stringify({ longToasts: true }));
    } catch {
      // Dokument ohne Speicher
    }
  });
});

/** Hain mit sechs Tieren: Beim Laden kommen neue Erfolge – ein Stempel, der eine Weile steht. */
function grove(): GameState {
  const state = createInitialState(Date.now(), 31337);
  state.stage = GROVE;
  state.waypoint = STAGES[GROVE]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 200;
  state.seeds = 2400;
  Object.assign(state.niches, { roots: ['earthworm', 'vole'], litter: ['robin', 'woodlouse'], edge: ['bee'], crown: ['bluetit'] });
  state.meta.journal.species.push('earthworm', 'vole', 'robin', 'woodlouse', 'bee', 'bluetit');
  state.cycle.newSpecies = ['earthworm', 'vole', 'robin', 'woodlouse', 'bee', 'bluetit'];
  return state;
}

/** Alle sichtbaren Meldungen zusammen (gedreht ragen sie über ihr Element hinaus – Rand dazu). */
async function stampsBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-ref="stamp"]')].map((n) => n.getBoundingClientRect());
    const top = Math.min(...boxes.map((b) => b.top));
    const bottom = Math.max(...boxes.map((b) => b.bottom));
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.right));
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
}

/** Die Meldungen liegen (nach dem Ausweichen) nicht über `target`. */
async function expectFree(page: Page, target: Locator, name: string): Promise<void> {
  await expect(stamp(page)).toBeVisible();
  const box = (await target.boundingBox())!;
  await expect.poll(async () => overlaps(await stampsBox(page), box), { message: `Meldung verdeckt ${name}` }).toBe(false);
  // Und bleibt im Bild.
  const s = await stampsBox(page);
  expect(s.y).toBeGreaterThanOrEqual(0);
  expect(s.y + s.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

for (const viewport of [
  { name: 'mobil', width: 390, height: 844 },
  { name: 'schmal', width: 360, height: 740 },
  { name: 'Desktop niedrig', width: 1200, height: 700 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test(`Meldung verdeckt weder die scharfe Bestätigung „Neuer Zyklus“ noch „Schließen“ im Umschlag (${viewport.width} × ${viewport.height})`, async ({ page, context }) => {
      await seedRaw(context, grove(), 0);
      await openGame(page);
      await expect(stamp(page)).toContainText('neue Erfolge');

      // Umschlag: „Schließen“ liegt mobil ganz unten – die Meldung rückt darüber.
      await openCover(page);
      await expectFree(page, cover(page).locator('[data-ref="cover-close"]'), '„Schließen“');
      await cover(page).locator('[data-ref="cover-close"]').click();
      await expect(cover(page)).toBeHidden();

      // U:Neuer Zyklus: Der Knopf liegt nach dem Scrollen unten; der erste Klick schaltet ihn
      // scharf („Zum Bestätigen erneut klicken“) – der Text muss lesbar bleiben.
      const sub = await openGoalsPage(page, 'cycle');
      const button = sub.locator('[data-ref="new-cycle"]');
      await button.scrollIntoViewIfNeeded();
      await button.click();
      await expect(button).toContainText('Zum Bestätigen erneut klicken');
      await expect(stamp(page)).toBeVisible();
      await expectFree(page, button, 'die Bestätigung');
      // Lesezeichen und Seitentitel oben bleiben ebenfalls frei.
      const s = await stampsBox(page);
      for (const target of [sub.locator('[data-ref="bookmark"]'), sub.locator('.page-title')]) {
        const box = await target.boundingBox();
        if (box) expect(overlaps(s, box)).toBe(false);
      }
    });
  });
}

test.describe('mobil', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Stempel springt beim langsamen Scrollen nicht zwischen oben und unten (S2)', async ({ page, context }) => {
    await seedRaw(context, grove(), 0);
    await openGame(page);
    const latest = await settledStamp(page);
    await expect(latest).toContainText('neue Erfolge');
    await expect(stamps(page)).toHaveClass(/stamps-top/);
    const start = (await latest.boundingBox())!;
    // Früher sprang er bei 48 px nach unten (y 8 → 754).
    for (const y of [20, 47, 49, 80, 30, 0]) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const box = (await latest.boundingBox())!;
      expect(Math.abs(box.y - start.y), `scrollY ${y}`).toBeLessThanOrEqual(1);
    }
    // Rücken die Knöpfe unter dem Bild heran, geht er nach unten – und bleibt dort, solange er steht.
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect(stamps(page)).not.toHaveClass(/stamps-top/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(stamps(page)).not.toHaveClass(/stamps-top/);
  });
});

for (const viewport of [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
]) {
  test(`Reiterwechsel mobil: Reiterleiste rückt nach oben, die neue Seite ist zu sehen (${viewport.width} × ${viewport.height}, S5)`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedRaw(context, grove(), 0);
    await gotoTab(page, 'nischen');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // Leiste liegt tief unten (unter Polaroid, Etiketten und Stufenleiste).
    expect((await tabButton(page, 'arten').boundingBox())!.y).toBeGreaterThan(viewport.height * 0.45);
    await openTab(page, 'arten');
    await expect.poll(async () => (await page.locator('[data-ref="tabs"]').boundingBox())!.y).toBeLessThanOrEqual(1);
    // Titel der neuen Seite steht direkt unter der Leiste, darunter ist Platz für Inhalt.
    const title = (await pageTitle(page).boundingBox())!;
    expect(title.y).toBeLessThan(140);

    // Tief gescrollt, dann Reiterwechsel: Die neue (kürzere) Seite beginnt im Bild, nicht
    // mittendrin bzw. darüber.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await openTab(page, 'ziele');
    await expect.poll(async () => (await pageTitle(page).boundingBox())!.y).toBeGreaterThan(0);
    expect((await pageTitle(page).boundingBox())!.y).toBeLessThan(viewport.height / 2);
  });
}

test('Desktop: Reiterwechsel scrollt nichts', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await seedRaw(context, grove(), 0);
  await gotoTab(page, 'nischen');
  await openTab(page, 'arten');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
