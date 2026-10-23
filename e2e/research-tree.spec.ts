import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

/**
 * Forschungsbaum-Vorschau (Phase 10, 1c): `src/ui/research-preview.html` mit den drei
 * Beispielzuständen bei 360, 390 und 1200 px – kein Querscrollen, Bedienelemente ≥ 44 px,
 * Zustand → Klassen und aria, Gabel-Hinweis, Raster ab GRID_MIN_WIDTH, Sprung über
 * „braucht …“. Die Vorschau gehört nicht zum Build – darum ein eigener Vite-Dev-Server.
 * Screenshots als Anhang (nur zum Ansehen, kein Pixelvergleich).
 */

let server: ViteDevServer;
let base = '';

test.beforeAll(async () => {
  server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error', clearScreen: false });
  await server.listen();
  const address = server.httpServer!.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://localhost:${port}/src/ui/research-preview.html`;
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

async function open(page: Page, state: string, frame = 'full'): Promise<void> {
  await page.goto(`${base}?state=${state}&frame=${frame}`);
  await expect(page.locator('.research-tree .research-supply')).not.toBeEmpty();
}

/** Alle Äste aufklappen (Liste), damit jede Karte gemessen wird. */
async function expandAll(page: Page): Promise<void> {
  const closed = page.locator('.research-branch-toggle[aria-expanded="false"]:visible');
  while ((await closed.count()) > 0) await closed.first().click();
}

for (const vp of VIEWPORTS) {
  for (const state of STATES) {
    test(`${vp.width} px, ${state}: kein Querscrollen, Treffer ≥ 44 px`, async ({ page }, info) => {
      await page.setViewportSize(vp);
      await open(page, state);
      await expandAll(page);
      const layout = await page.locator('.research-tree').getAttribute('data-layout');
      expect(layout).toBe(vp.width >= 1000 ? 'grid' : 'list');
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const wide = [...document.querySelectorAll<HTMLElement>('.research-tree *')]
          .filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > doc.clientWidth + 0.5)
          .map((e) => e.className);
        return { scroll: doc.scrollWidth - doc.clientWidth, wide };
      });
      expect(overflow).toEqual({ scroll: 0, wide: [] });
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.research-tree button')]
          .filter((b) => b.getClientRects().length > 0)
          .filter((b) => b.getBoundingClientRect().height < 43.5 && !b.classList.contains('research-node-name'))
          .map((b) => b.textContent),
      );
      expect(small).toEqual([]);
      await info.attach(`research-${vp.width}-${state}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
}

test('Zustände → Klassen und aria (Mitte)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'middle');
  await expandAll(page);
  const node = (id: string) => page.locator(`.research-node[data-node="${id}"]`);

  await expect(node('compost')).toHaveClass(/is-researched/);
  await expect(node('compost').locator('.research-node-stamp')).toBeVisible();
  await expect(node('compost').locator('.research-node-action')).toBeHidden();

  await expect(node('humus')).toHaveClass(/is-available/);
  await expect(node('humus').locator('.research-node-action')).toHaveAttribute('aria-disabled', 'false');

  await expect(node('hem-wide')).toHaveClass(/is-saving/);
  await expect(node('hem-wide').locator('.research-node-action')).toHaveAttribute('aria-disabled', 'true');
  await expect(node('hem-wide').locator('.research-node-action')).toHaveText(/^Noch 200/);

  await expect(node('hem-bloom')).toHaveClass(/is-locked lock-stage/);
  await expect(node('hem-bloom').locator('.research-node-action')).toHaveAttribute('aria-label', 'Blühender Saum: Gesperrt: erst ab Wald.');

  await expect(node('dense-crown')).toHaveClass(/is-excluded/);
  await expect(node('dense-crown').locator('.research-node-action')).toHaveText('anderer Weg gewählt');
  await expect(node('dense-crown-3')).toHaveClass(/is-excluded/);

  // Gabeln: offen mit Frage, entschieden mit gewähltem Weg
  const soil = page.locator('.research-fork[data-fork="soil"]');
  await expect(soil).toHaveAttribute('role', 'group');
  await expect(soil).toHaveAttribute('data-chosen', 'none');
  await expect(soil).toHaveAttribute('aria-label', 'Gabel Boden: Käferburg oder Pilzgarten, nur ein Weg ist möglich');
  await expect(soil.locator('.research-fork-hint')).toHaveText(/^Gabel: Neue Arten im Totholz/);
  await expect(soil.locator('.research-fork-or')).toHaveText('oder');
  const crown = page.locator('.research-fork[data-fork="crown"]').first();
  await expect(crown).toHaveAttribute('data-chosen', '0');
  await expect(crown.locator('.research-fork-hint')).toHaveText('Gabel entschieden: Lichte Krone – die Wahl gilt für alle Ebenen.');

  // Ein aria-disabled-Knopf löst nichts aus
  await node('hem-wide').locator('.research-node-action').click({ force: true });
  await expect(node('hem-wide')).toHaveClass(/is-saving/);
});

test('Erforschen in der Vorschau: Stempel, Vorrat sinkt, Gabel-Partner ausgeschlossen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'middle');
  await expandAll(page);
  await page.locator('.research-node[data-node="fungus-garden"] .research-node-action').click();
  await expect(page.locator('.research-node[data-node="fungus-garden"]')).toHaveClass(/is-researched/);
  await expect(page.locator('.research-node[data-node="beetle-castle"]')).toHaveClass(/is-excluded/);
  await expect(page.locator('.research-fork[data-fork="soil"]')).toHaveAttribute('data-chosen', '1');
  await expect(page.locator('.research-supply')).toHaveText('⚖️ 50');
});

test('Liste unter 640 px: nur Äste mit Erforschbarem offen; „braucht …“ springt dorthin', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, 'start');
  await expect(page.locator('.research-branch[data-branch="water"] .research-branch-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.research-branch[data-branch="soil"] .research-branch-toggle')).toHaveAttribute('aria-expanded', 'true');
  // Register öffnet einen zugeklappten Ast
  await page.locator('.research-register-tab', { hasText: '💧' }).click();
  await expect(page.locator('.research-branch[data-branch="water"] .research-branch-toggle')).toHaveAttribute('aria-expanded', 'true');
  // Benjeshecke braucht Nistkästen (Krone)
  await page.locator('.research-branch[data-branch="crown"] .research-branch-toggle').click();
  await expect(page.locator('.research-branch[data-branch="crown"] .research-branch-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.research-node[data-node="dead-hedge"] .research-ref').click();
  await expect(page.locator('.research-branch[data-branch="crown"] .research-branch-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.research-node[data-node="nest-boxes"] .research-node-name')).toBeFocused();
});

test('Raster bei 1200 px: sechs Spalten, eine Linie je Verbindung, Album-Seite als Liste', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await open(page, 'late');
  const tops = await page.locator('.research-branch-heading').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(tops).toHaveLength(6);
  expect(new Set(tops).size).toBe(1);
  const paths = page.locator('.research-links path');
  expect(await paths.count()).toBeGreaterThan(10);
  expect(await paths.evaluateAll((ps) => ps.every((p) => (p.getAttribute('d') ?? '').startsWith('M')))).toBe(true);
  // Gleiche Ebene = gleiche Zeile: Kompost (Setzling) und Nistkästen (Junger Baum) übereinander versetzt
  const y = async (id: string) => (await page.locator(`.research-node[data-node="${id}"]`).boundingBox())!.y;
  expect(Math.abs((await y('nest-boxes')) - (await y('meadow')))).toBeLessThan(2);
  expect(await y('nest-boxes')).toBeGreaterThan(await y('compost'));

  await open(page, 'middle', 'page');
  await expect(page.locator('.research-tree')).toHaveAttribute('data-layout', 'list');
});
