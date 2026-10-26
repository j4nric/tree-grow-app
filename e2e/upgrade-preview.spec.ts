import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

/**
 * Ausbau-Vorschau (Phase 11, 1c): `src/ui/upgrade-preview.html` mit den drei Beispielzuständen
 * bei 360, 390 und 1200 px – kein Querscrollen, Knöpfe ≥ 44 px, verschlossene Nische ohne
 * Knopf, Kaufmenge, Kauf mit Meilenstein, Zielzeile springt, „Dein Baum“ als Karten auf dem
 * Desktop. Die Vorschau gehört nicht zum Build – darum ein eigener Vite-Dev-Server.
 * Screenshots als Anhang (nur zum Ansehen, kein Pixelvergleich).
 */

let server: ViteDevServer;
let base = '';

test.beforeAll(async () => {
  server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error', clearScreen: false });
  await server.listen();
  const address = server.httpServer!.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://localhost:${port}/src/ui/upgrade-preview.html`;
});

test.afterAll(async () => {
  await server?.close();
});

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1200, height: 700 },
];
const STATES = ['start', 'middle', 'late'] as const;

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${base}?${query}`);
  await expect(page.locator('[data-ref="tree-upgrades"] .upgrade-part')).toHaveCount(3);
}

for (const vp of VIEWPORTS) {
  for (const state of STATES) {
    for (const amount of ['1', 'max']) {
      test(`${vp.width} px, ${state}, ×${amount}: kein Querscrollen, Treffer ≥ 44 px`, async ({ page }, info) => {
        await page.setViewportSize(vp);
        await open(page, `state=${state}&amount=${amount}`);
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const wide = [...document.querySelectorAll<HTMLElement>('.preview-book *')]
            .filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > doc.clientWidth + 0.5)
            .map((e) => e.className);
          return { scroll: doc.scrollWidth - doc.clientWidth, wide };
        });
        expect(overflow).toEqual({ scroll: 0, wide: [] });
        const small = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('.upgrade-button, .buy-amount-option, .goal-line button')]
            .filter((b) => b.getClientRects().length > 0)
            .filter((b) => b.getBoundingClientRect().height < 43.5)
            .map((b) => b.textContent),
        );
        expect(small).toEqual([]);
        // Wirkungs-Knopf: sichtbar klein, Trefferfläche über ::after ≥ 44 px
        const effectHit = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('.upgrade-effect')].filter((b) => b.getClientRects().length > 0).every((b) => {
            const after = getComputedStyle(b, '::after');
            const extra = (parseFloat(after.top) || 0) + (parseFloat(after.bottom) || 0);
            return b.getBoundingClientRect().height - extra >= 43.5;
          }),
        );
        expect(effectHit).toBe(true);
        await info.attach(`upgrade-${vp.width}-${state}-${amount}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      });
    }
  }
}

test('Verschlossene Nische ohne Knopf, Abzeichen am Etikett, Wirkung als Haftnotiz', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'state=middle');
  const pond = page.locator('.nrow[data-niche="pond"]');
  await expect(pond).toHaveClass(/is-locked/);
  await expect(pond.locator('[data-ref="niche-upgrade"]')).toBeHidden();
  await expect(pond.locator('.upgrade-button')).toBeHidden();
  await expect(pond.locator('.nrow-hint-text')).toHaveText('öffnet mit Forschung „Waldtümpel“');

  const roots = page.locator('.nrow[data-niche="roots"]');
  await expect(roots.locator('.nrow-label [data-ref="upgrade-badge"]')).toHaveText('⭑ Bronze');
  await expect(roots.locator('.nrow-label [data-ref="upgrade-badge"]')).toHaveAttribute('data-tier', 'bronze');
  await expect(roots.locator('.upgrade-level-text')).toHaveText('St. 24');
  await expect(roots.locator('.upgrade-progress-label')).toHaveText('25: +1 Platz');
  await expect(roots.locator('.upgrade-button')).toHaveAttribute('aria-disabled', 'true');
  await expect(roots.locator('.upgrade-button-wait')).toHaveText('in 0:05');
  await roots.locator('.upgrade-effect').click();
  await expect(page.locator('[data-ref="niche-upgrade-note"]')).toContainText('3 Tiere, zusammen +6,4 %');

  // Balken: Füllung als Anteil (Wurzelraum 24 von 10 → 25: 14/15)
  const fill = await roots.locator('.upgrade-progress-fill').evaluate((e) => getComputedStyle(e).getPropertyValue('--progress'));
  expect(Number(fill)).toBeCloseTo(14 / 15, 2);
});

test('Kaufmenge ×10/Max beschriftet alle Knöpfe; aria-disabled kauft nicht', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'state=middle');
  const edge = page.locator('.nrow[data-niche="edge"] .upgrade-button');
  await expect(edge).toHaveText(/^Ausbauen · 88/);
  await page.locator('.buy-amount-option[data-amount="10"]').click();
  await expect(page.locator('.buy-amount-option[data-amount="10"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(edge).toHaveText(/^\+10 · 1\.790/);
  await expect(edge).toHaveAttribute('aria-disabled', 'true');
  await edge.click({ force: true });
  await expect(page.locator('.nrow[data-niche="edge"] .upgrade-level-text')).toHaveText('St. 9');
  await page.locator('.buy-amount-option[data-amount="max"]').click();
  await expect(edge).toHaveText('+2 · Max');
  await expect(page).toHaveURL(/amount=max/);
});

test('Kauf: Stufe steigt, Samen sinken, Meilenstein 25 klebt einen Platz ein; Ziel wechselt', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'state=middle');
  // Waldsaum 9 → 10 ist das Ziel (Meilenstein, bezahlbar)
  const goal = page.locator('[data-ref="goal-line-jump"]');
  await expect(goal).toHaveText('Jetzt: 🌼 Waldsaum St. 10 (öfter in den Karten) · 88 🌰 ›');
  await expect(goal).toHaveClass(/is-ready/);
  await expect(page.locator('[data-ref="goal-line-research"]')).toHaveText('🔍 2 erforschbar ›');
  await goal.click();
  await expect(page.locator('.nrow[data-niche="edge"] .nrow-title')).toBeFocused();
  await page.locator('.nrow[data-niche="edge"] .upgrade-button').click();
  await expect(page.locator('.nrow[data-niche="edge"] .upgrade-level-text')).toHaveText('St. 10');
  await expect(page.locator('[data-ref="seeds"]')).toHaveText('152');
  await expect(goal).not.toHaveText(/Waldsaum St\. 10/);
  // aria-live sagt den Zielwechsel an
  await expect(page.locator('[data-ref="goal-line"] [aria-live="polite"]')).not.toBeEmpty();


  // Meilenstein 25 „Gut bewohnt“: Mit laufender Zeit reicht es nach ~3 s für Wurzelraum 25 –
  // ein leerer Platz kommt dazu.
  await open(page, 'state=middle&live=1');
  const roots = page.locator('.nrow[data-niche="roots"]');
  await expect(roots.locator('.upgrade-button')).toHaveAttribute('aria-disabled', 'false', { timeout: 8000 });
  await roots.locator('.upgrade-button').click();
  await expect(roots.locator('.upgrade-level-text')).toHaveText('St. 25');
  await expect(roots.locator('.nrow-count')).toHaveText('3/4 belegt');
  await expect(roots.locator('.sticker-slot:not([hidden])')).toHaveCount(4);
  await expect(roots.locator('.upgrade-progress-label')).toHaveText('50: Seltene öfter');
});

test('Desktop 1200 px: Polaroid links, Seite rechts, „Dein Baum“ als drei Karten nebeneinander', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await open(page, 'state=late');
  const tops = await page.locator('.upgrade-part').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  const head = (await page.locator('.preview-head').boundingBox())!;
  const pageBox = (await page.locator('.preview-page').boundingBox())!;
  expect(pageBox.x).toBeGreaterThan(head.x + head.width - 1);
  // Nischen-Fußzeile in einer Zeile: Wirkung neben dem Knopf
  const roots = page.locator('.nrow[data-niche="roots"]');
  const effect = (await roots.locator('.upgrade-effect').boundingBox())!;
  const button = (await roots.locator('.upgrade-button').boundingBox())!;
  expect(Math.abs(effect.y + effect.height / 2 - (button.y + button.height / 2))).toBeLessThan(4);

  // Album-Seite (470 px): Baumteile als Liste untereinander
  await open(page, 'state=late&frame=page');
  const listTops = await page.locator('.upgrade-part').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(listTops).size).toBe(3);
});

test('360 px: Wirkung bricht unter die Stufe', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, 'state=middle');
  const roots = page.locator('.nrow[data-niche="roots"]');
  const level = (await roots.locator('.upgrade-level').boundingBox())!;
  const effect = (await roots.locator('.upgrade-effect').boundingBox())!;
  expect(effect.y).toBeGreaterThanOrEqual(level.y + level.height - 1);
});
