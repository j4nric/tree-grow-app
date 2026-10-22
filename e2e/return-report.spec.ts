import type { Locator, Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import { expect, openGame, overlaps, pageTitle, seedRaw, stamp, stamps, subpage, test, waypoint } from './fixtures';

/**
 * Rückkehr-Bericht (Playtest Phase 6, Album: docs/ALBUM_UI.md C.8): Nach 3 Std. Abwesenheit
 * steht nur die Kurzfassung in der Meldung (höchstens drei Zeilen – Desktop wie mobil) und im
 * Zettel „Während du weg warst …“ auf der linken Seite; „Details ›“ blättert zur Unterseite
 * mit allen Punkten, „Abheften“ blendet den Zettel aus – per Tastatur und Touch erreichbar.
 */

const GROVE = STAGES.findIndex((s) => s.id === 'grove');

/** Hain mit einer wartenden Begegnung (Stapel oben in der Szene sichtbar). */
function grove(): GameState {
  const state = createInitialState(Date.now(), 99);
  state.stage = GROVE;
  state.waypoint = STAGES[GROVE]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.seeds = 5_000;
  state.niches.roots = ['earthworm', 'vole'];
  state.meta.journal.species.push('earthworm', 'vole');
  state.pendingEncounters = [{ type: 'event', cards: ['storm'], rerolls: 0 }];
  return state;
}

const report = (page: Page) => page.locator('[data-ref="return-report"]');
const reportPage = (page: Page) => subpage(page, 'return-report');
const detailsButton = (page: Page) => page.locator('[data-ref="return-report-details"]');
const list = (page: Page) => page.locator('[data-ref="return-report-list"]');
const fileButton = (page: Page) => report(page).locator('[data-ref="return-report-close"]');

async function expectNotCovered(toast: Locator, controls: Record<string, Locator>): Promise<void> {
  const box = (await toast.boundingBox())!;
  for (const [name, locator] of Object.entries(controls)) {
    for (const item of await locator.all()) {
      const other = await item.boundingBox();
      if (other) expect(overlaps(box, other), `Toast verdeckt ${name}`).toBe(false);
    }
  }
}

/** Zeilen eines Textblocks: Höhe ohne Rand und Innenabstand durch die Zeilenhöhe (aus dem CSS). */
async function lineCount(locator: Locator): Promise<number> {
  return locator.evaluate((node) => {
    const css = getComputedStyle(node);
    // clientHeight: ohne Rand (die Kurzfassung hat oben/unten Rand statt Innenabstand).
    const inner = node.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
    const line = parseFloat(css.lineHeight);
    if (!Number.isFinite(line) || line <= 0) throw new Error(`line-height nicht gesetzt: ${css.lineHeight}`);
    return Math.round(inner / line);
  });
}

for (const viewport of [
  { name: 'mobil', width: 390, height: 844 },
  { name: 'schmal', width: 360, height: 740 },
  // Breite Schrift wie auf Linux-Runnern ohne Inter, dazu 110 % Schriftgröße.
  { name: 'schmal, DejaVu Sans 110 %', width: 360, height: 740, font: 'DejaVu Sans', scale: 1.1 },
  { name: 'Desktop', width: 1280, height: 800 },
]) {
  test(`Rückkehr nach 3 Std. (${viewport.name}): Kurzfassung, Details erreichbar, nichts verdeckt`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedRaw(context, grove(), -3 * 3600_000);
    await openGame(page);
    if (viewport.font) {
      await page.evaluate((s) => (document.documentElement.style.fontSize = `${s * 100}%`), viewport.scale);
      await page.addStyleTag({ content: `:root, body, button { font-family: '${viewport.font}', sans-serif !important; }` });
    }

    const toast = stamp(page);
    await expect(toast).toContainText('Willkommen zurück!');
    await expect(stamps(page)).toHaveAttribute('role', 'status');
    const summary = await page.locator('[data-ref="return-report-summary"]').textContent();
    expect(summary).toMatch(/^Willkommen zurück! 3 Std\.: \+[\d.]+ 🌿/);
    // Nur die Kurzfassung – eine flache Leiste statt eines hohen Blocks.
    await expect(toast).toHaveText(`${summary} · mehr im Rückkehr-Bericht`);
    await expect(toast).not.toContainText('Wetter gemittelt');
    // Höchstens drei Zeilen, unabhängig von Schrift und Größe (CSS line-clamp).
    expect(await lineCount(toast.locator('.stamp-text'))).toBeLessThanOrEqual(3);

    // Keine Überdeckung der Bedienelemente (auch nicht der Karte). Die Kamera-Knöpfe ziehen
    // in Schritt 3 ins Vollbild – der Zettel lässt Klicks ohnehin durch (smoke.spec.ts).
    await expect(page.locator('[data-ref="encounter-stack"]')).toBeVisible();
    await expectNotCovered(toast, {
      Stapel: page.locator('[data-ref="encounter-stack"]'),
      Raten: page.locator('.tape-label'),
      Bericht: report(page).getByRole('button'),
    });

    // Zettel gleich zu sehen (mobil unter den Etiketten, Desktop auf der linken Seite),
    // Knöpfe groß genug für Touch.
    await expect(report(page)).toBeVisible();
    await expect(report(page)).toContainText('Während du weg warst');
    await expect(detailsButton(page)).toBeInViewport();
    for (const button of await report(page).getByRole('button').all()) {
      const b = (await button.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    await expect(reportPage(page)).toBeHidden();

    // Tastatur: „Details ›“ blättert zur Unterseite, Fokus auf ihrer Überschrift, alles einsehbar.
    await detailsButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(reportPage(page)).toBeVisible();
    await expect(reportPage(page)).not.toHaveAttribute('inert', '');
    await expect(reportPage(page).getByRole('heading', { name: 'Rückkehr-Bericht' })).toBeFocused();
    await expect(list(page)).toBeVisible();
    await expect(list(page)).toContainText('Willkommen zurück! In 3 Std.');
    await expect(list(page)).toContainText(/Wetter gemittelt( \(.+\))?\./);
    await expect(list(page)).toContainText(/Begegnungen? warte/);
    await expect(list(page)).toContainText('neue Erfolge');
    expect(await reportPage(page).evaluate((p) => p.scrollWidth - p.clientWidth)).toBeLessThanOrEqual(0);
    // Escape blättert zurück, der Fokus geht an „Details ›“.
    await page.keyboard.press('Escape');
    await expect(reportPage(page)).toBeHidden();
    await expect(detailsButton(page)).toBeFocused();
    await expect(report(page)).toBeVisible();

    // Zeiger/Touch: Unterseite erneut, dort „Abheften“ – zurück, der Zettel ist weg.
    await detailsButton(page).click();
    await expect(reportPage(page)).not.toHaveAttribute('inert', '');
    await reportPage(page).getByRole('button', { name: 'Abheften' }).click();
    await expect(reportPage(page)).toBeHidden();
    await expect(report(page)).toBeHidden();
    await expect(pageTitle(page)).toBeFocused();

    // Nichts scrollt quer.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test('Abheften direkt am Zettel: Fokus an die Überschrift der Seite', async ({ page, context }) => {
  await seedRaw(context, grove(), -3 * 3600_000);
  await openGame(page);
  await expect(report(page)).toBeVisible();
  await expect(fileButton(page)).toHaveText('Abheften');
  await fileButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(report(page)).toBeHidden();
  await expect(pageTitle(page)).toBeFocused();
});

test('ohne Abwesenheit kein Rückkehr-Bericht', async ({ page, context }) => {
  await seedRaw(context, grove(), 0);
  await openGame(page);
  await expect(report(page)).toBeHidden();
});
