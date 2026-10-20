import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * Smoke-Tests für „Vom Samen zum Wald“.
 * Bewusst ohne Pixel- oder Layout-Vergleiche: Selektoren nur über Rollen, Text und
 * data-ref-Attribute, damit Änderungen an Optik und Renderer die Tests nicht brechen.
 */

const SAVE_KEY = 'tree-grow-save';

/** Sammelt Konsolenfehler und unbehandelte Seitenfehler; jeder Test muss fehlerfrei enden. */
const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      await use(errors);
      expect(errors, 'Konsolen- oder Seitenfehler').toEqual([]);
    },
    { auto: true },
  ],
});

interface SeedState {
  resources?: { water?: number; light?: number; energy?: number };
  upgrades?: Record<string, number>;
  stage?: number;
  totalEnergy?: number;
  /** lastTick relativ zur Browser-Uhr beim Laden (ms, negativ = Vergangenheit). */
  lastTickOffsetMs?: number;
}

/**
 * Legt vor dem ersten Laden einen Spielstand in localStorage ab.
 * Per addInitScript statt localStorage.setItem + reload, weil das Spiel bei
 * beforeunload speichert. Das Skript schreibt nur beim allerersten Laden im Tab
 * (Merker in sessionStorage), damit ein späteres Neuladen den echten Fortschritt sieht.
 */
async function seedSave(context: BrowserContext, seed: SeedState): Promise<void> {
  await context.addInitScript(
    ({ key, seed }) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      const now = Date.now();
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          resources: { water: 0, light: 0, energy: 0, ...seed.resources },
          upgrades: seed.upgrades ?? {},
          stage: seed.stage ?? 0,
          totalEnergy: seed.totalEnergy ?? 0,
          lastTick: now + (seed.lastTickOffsetMs ?? 0),
        }),
      );
    },
    { key: SAVE_KEY, seed },
  );
}

/** Liest eine deutsch formatierte Zahl (z. B. „1.234,5“) aus einem Element. Nur für Werte < 10.000. */
async function readNumber(locator: Locator): Promise<number> {
  const text = (await locator.textContent())?.trim() ?? '';
  const value = Number(text.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(value)) throw new Error(`Keine Zahl: „${text}“`);
  return value;
}

const resource = (page: Page, id: 'water' | 'light' | 'energy') => page.locator(`[data-ref="${id}"]`);
const growButton = (page: Page) => page.getByRole('button', { name: /Wachsen/ });
const upgradeRow = (page: Page, name: string) => page.locator('.upgrade').filter({ hasText: name });
const stageLabel = (page: Page) => page.locator('[data-ref="stage"]');

/** Wartet, bis die Seitenleiste vom Game Loop befüllt wurde. */
async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(stageLabel(page)).toContainText('Stufe:');
}

test('Spiel startet ohne Fehler mit Titel und Canvas', async ({ page }) => {
  await openGame(page);
  await expect(page).toHaveTitle('Vom Samen zum Wald');
  await expect(page.getByRole('heading', { level: 1, name: 'Vom Samen zum Wald' })).toBeVisible();
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  await expect(growButton(page)).toBeEnabled();

  const canvas = page.locator('canvas#scene');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  // Einige Frames laufen lassen, damit Fehler im Game Loop auffallen.
  await page.waitForTimeout(500);
});

test('„Wachsen“ bringt Wasser und Licht, daraus entsteht Energie', async ({ page }) => {
  await openGame(page);
  await expect(resource(page, 'energy')).toHaveText('0');

  const clicks = 20;
  // clickCount löst 20 einzelne click-Events in schneller Folge aus (ohne 20× Stabilitätsprüfung).
  await growButton(page).click({ clickCount: clicks });

  // Photosynthese baut Wasser/Licht mit 1/s ab – nach 20 schnellen Klicks ist noch genug da.
  await expect.poll(() => readNumber(resource(page, 'water'))).toBeGreaterThan(0);
  await expect.poll(() => readNumber(resource(page, 'light'))).toBeGreaterThan(0);

  await expect.poll(() => readNumber(resource(page, 'energy'))).toBeGreaterThan(0);

  // Ohne Upgrades gilt: jedes umgewandelte Wasser wird genau eine Energie.
  const water = await readNumber(resource(page, 'water'));
  const energy = await readNumber(resource(page, 'energy'));
  expect(water + energy).toBeCloseTo(clicks, 0);
});

test('Upgrade kaufen: Stufe (1) erscheint, Energie sinkt', async ({ page, context }) => {
  await seedSave(context, { resources: { energy: 100 }, totalEnergy: 5 });
  await openGame(page);
  await expect(resource(page, 'energy')).toHaveText('100');

  const row = upgradeRow(page, 'Wurzelhaare');
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('(1)');
  await row.getByRole('button').click();

  await expect(row).toContainText('(1)');
  await expect.poll(() => readNumber(resource(page, 'energy'))).toBeLessThan(100);
});

test('Fortschritt bleibt nach Neuladen erhalten', async ({ page, context }) => {
  await seedSave(context, { resources: { energy: 100 }, totalEnergy: 5 });
  await openGame(page);

  const row = upgradeRow(page, 'Keimblatt');
  await row.getByRole('button').click();
  await row.getByRole('button').click();
  await expect(row).toContainText('(2)');
  const energyBefore = await readNumber(resource(page, 'energy'));
  expect(energyBefore).toBeLessThan(100);

  await page.reload();
  await expect(stageLabel(page)).toContainText('Stufe:');
  await expect(upgradeRow(page, 'Keimblatt')).toContainText('(2)');
  // Keimblatt erzeugt nur Licht, ohne Wasser entsteht keine Energie – der Wert bleibt gleich.
  await expect.poll(() => readNumber(resource(page, 'energy'))).toBeCloseTo(energyBefore, 0);

  const saved = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect(JSON.parse(saved ?? '{}').upgrades).toMatchObject({ cotyledon: 2 });
});

test('„Spielstand löschen“ setzt nach Bestätigung zurück', async ({ page, context }) => {
  await seedSave(context, {
    resources: { water: 10, light: 10, energy: 500 },
    upgrades: { 'root-hairs': 3, cotyledon: 3, chlorophyll: 1 },
    stage: 2,
    totalEnergy: 500,
  });
  await openGame(page);
  await expect(stageLabel(page)).toHaveText('Stufe: Setzling');

  // Ein einzelner Klick fragt nur nach und lässt den Stand unverändert.
  await page.getByRole('button', { name: 'Spielstand löschen' }).click();
  await expect(page.getByRole('button', { name: /Wirklich alles löschen/ })).toBeVisible();
  await expect(stageLabel(page)).toHaveText('Stufe: Setzling');
  await expect(upgradeRow(page, 'Wurzelhaare')).toContainText('(3)');

  // Der zweite Klick bestätigt und setzt zurück.
  await page.getByRole('button', { name: /Wirklich alles löschen/ }).click();
  await expect(page.getByRole('button', { name: 'Spielstand löschen' })).toBeVisible();
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  await expect(resource(page, 'energy')).toHaveText('0');
  await expect(resource(page, 'water')).toHaveText('0');
  await expect(upgradeRow(page, 'Wurzelhaare')).not.toContainText('(');
  await expect(upgradeRow(page, 'Chlorophyll')).toBeHidden();

  // Auch nach dem Neuladen bleibt der Stand zurückgesetzt.
  await page.reload();
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  await expect(resource(page, 'energy')).toHaveText('0');
});

test('Offline-Fortschritt zeigt Willkommens-Meldung', async ({ page, context }) => {
  await seedSave(context, {
    upgrades: { 'root-hairs': 4, cotyledon: 4 },
    resources: { energy: 0 },
    totalEnergy: 50,
    stage: 1,
    lastTickOffsetMs: -60 * 60 * 1000,
  });
  await openGame(page);

  const toast = page.locator('#toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Willkommen zurück');
  await expect(toast).toContainText('Energie');
  // 2 Wasser/s, 2 Licht/s, Photosynthese 1/s → in einer Stunde 3.600 Energie.
  await expect.poll(() => readNumber(resource(page, 'energy'))).toBeGreaterThanOrEqual(3600);
});

test('ohne Offline-Zeit erscheint keine Willkommens-Meldung', async ({ page, context }) => {
  await seedSave(context, { upgrades: { 'root-hairs': 4, cotyledon: 4 }, totalEnergy: 50, stage: 1 });
  await openGame(page);
  await page.waitForTimeout(300);
  await expect(page.locator('#toast')).toBeHidden();
});

test.describe('Mobil (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  async function expectNoHorizontalScroll(page: Page): Promise<void> {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  }

  test('kein horizontales Scrollen beim Start', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('canvas#scene')).toBeVisible();
    await expect(growButton(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('kein horizontales Scrollen mit allen Upgrades und großen Zahlen', async ({ page, context }) => {
    await seedSave(context, {
      resources: { water: 1.5e9, light: 2.5e9, energy: 9.87e8 },
      upgrades: { 'root-hairs': 120, cotyledon: 120, chlorophyll: 80, taproot: 60, canopy: 60, chloroplasts: 40 },
      stage: 7,
      totalEnergy: 5e10,
    });
    await openGame(page);
    await expect(stageLabel(page)).toHaveText('Stufe: Urwald');
    await expect(upgradeRow(page, 'Chloroplasten')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
