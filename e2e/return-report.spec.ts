import type { Locator, Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import { expect, openGame, overlaps, pageTitle, seedRaw, test, waypoint } from './fixtures';

/**
 * Rückkehr-Bericht (Playtest Phase 6): Nach 3 Std. Abwesenheit steht mobil nur die
 * Kurzfassung im Toast (oben fest, darf nur kurz sein), alles Weitere in der schließbaren
 * Karte „Rückkehr-Bericht“ oben in der Seitenleiste – per Tastatur und Touch erreichbar.
 * Am Desktop zeigt der Toast weiter die ganze Meldung (unten in der Szene, stört nicht).
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
const detailsButton = (page: Page) => page.locator('[data-ref="return-report-details"]');
const list = (page: Page) => page.locator('[data-ref="return-report-list"]');

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
  const narrow = viewport.width <= 760;

  test(`Rückkehr nach 3 Std. (${viewport.name}): Kurzfassung, Details erreichbar, nichts verdeckt`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedRaw(context, grove(), -3 * 3600_000);
    await openGame(page);
    if (viewport.font) {
      await page.evaluate((s) => (document.documentElement.style.fontSize = `${s * 100}%`), viewport.scale);
      await page.addStyleTag({ content: `:root, body, button { font-family: '${viewport.font}', sans-serif !important; }` });
    }

    const toast = page.locator('#toast');
    await expect(toast).toContainText('Willkommen zurück!');
    await expect(toast).toHaveAttribute('role', 'status');
    const summary = await page.locator('[data-ref="return-report-summary"]').textContent();
    expect(summary).toMatch(/^Willkommen zurück! 3 Std\.: \+[\d.]+ 🌿/);
    if (narrow) {
      // Mobil: nur die Kurzfassung – eine flache Leiste statt eines hohen Blocks.
      await expect(toast).toHaveText(`${summary} · mehr im Rückkehr-Bericht`);
      await expect(toast).not.toContainText('Wetter gemittelt');
      // Höchstens drei Zeilen, unabhängig von Schrift und Größe (CSS line-clamp).
      expect(await lineCount(toast)).toBeLessThanOrEqual(3);
    } else {
      // Desktop: weiter die ganze Meldung.
      await expect(toast).toContainText(/Wetter gemittelt( \(.+\))?\./);
    }

    // Keine Überdeckung der Bedienelemente (zusätzlich zur Toast-Platzierung: auch die Karte).
    await expect(page.locator('[data-ref="encounter-stack"]')).toBeVisible();
    await expectNotCovered(toast, {
      Stapel: page.locator('[data-ref="encounter-stack"]'),
      Raten: page.locator('.tape-label'),
      Bericht: report(page).getByRole('button'),
    });

    // Karte gleich zu sehen (mobil direkt unter der Szene), Knöpfe groß genug für Touch.
    await expect(report(page)).toBeVisible();
    await expect(detailsButton(page)).toBeInViewport();
    for (const button of await report(page).getByRole('button').all()) {
      const b = (await button.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    await expect(list(page)).toBeHidden();

    // Tastatur: Details öffnen → Fokus auf der Liste, alles einsehbar; Escape klappt zu.
    await detailsButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(detailsButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(list(page)).toBeVisible();
    await expect(list(page)).toBeFocused();
    await expect(list(page)).toContainText('Willkommen zurück! In 3 Std.');
    await expect(list(page)).toContainText(/Wetter gemittelt( \(.+\))?\./);
    await expect(list(page)).toContainText(/Begegnungen? warte/);
    await expect(list(page)).toContainText('neue Erfolge');
    await page.keyboard.press('Escape');
    await expect(list(page)).toBeHidden();
    await expect(detailsButton(page)).toBeFocused();

    // Zeiger/Touch: erneut öffnen, dann schließen – Fokus geht an die Überschrift der Seite.
    await detailsButton(page).click();
    await expect(list(page)).toBeVisible();
    await page.getByRole('button', { name: 'Rückkehr-Bericht schließen' }).click();
    await expect(report(page)).toBeHidden();
    await expect(pageTitle(page)).toBeFocused();

    // Nichts scrollt quer.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test('ohne Abwesenheit kein Rückkehr-Bericht', async ({ page, context }) => {
  await seedRaw(context, grove(), 0);
  await openGame(page);
  await expect(report(page)).toBeHidden();
});
