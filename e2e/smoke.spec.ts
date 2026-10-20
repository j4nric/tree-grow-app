import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * Smoke-Tests für „Vom Samen zum Wald“ (v2-Prototyp: Begegnungen und Kartenwahl).
 * Bewusst ohne Pixel- oder Layout-Vergleiche: Selektoren nur über Rollen, Text und
 * data-ref-/data-Attribute, damit Änderungen an Optik und Renderer die Tests nicht brechen.
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

/** Gesamt-Wachstum der Wegpunkte (4 · k^3,4, gerundet) – nur die, die die Tests brauchen. */
const WAYPOINT = { 1: 4, 3: 168, 6: 1769, 12: 18676, 20: 106063 } as const;

interface SeedV2 {
  totalGrowth?: number;
  seeds?: number;
  niches?: Partial<Record<'roots' | 'litter' | 'edge' | 'crown' | 'bark', string[]>>;
  pendingEncounters?: { type: 'animal'; cards: string[]; rerolls: number }[];
  rngState?: number;
  forestMemory?: number;
  /** lastTick relativ zur Browser-Uhr beim Laden (ms, negativ = Vergangenheit). */
  lastTickOffsetMs?: number;
}

/**
 * Legt vor dem ersten Laden einen Spielstand in localStorage ab.
 * Per addInitScript statt localStorage.setItem + reload, weil das Spiel bei
 * beforeunload speichert. Das Skript schreibt nur beim allerersten Laden im Tab
 * (Merker in sessionStorage), damit ein späteres Neuladen den echten Fortschritt sieht.
 */
async function seedRaw(context: BrowserContext, save: object, lastTickOffsetMs?: number): Promise<void> {
  await context.addInitScript(
    ({ key, save, lastTickOffsetMs }) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      const data = lastTickOffsetMs === undefined ? save : { ...save, lastTick: Date.now() + lastTickOffsetMs };
      localStorage.setItem(key, JSON.stringify(data));
    },
    { key: SAVE_KEY, save, lastTickOffsetMs },
  );
}

async function seedV2(context: BrowserContext, seed: SeedV2): Promise<void> {
  const save = {
    version: 2,
    totalGrowth: seed.totalGrowth ?? 0,
    seeds: seed.seeds ?? 0,
    waypoint: 0, // wird beim Laden aus totalGrowth abgeleitet
    stage: 0,
    niches: { roots: [], litter: [], edge: [], crown: [], bark: [], ...seed.niches },
    pendingEncounters: seed.pendingEncounters ?? [],
    rngState: seed.rngState ?? 123456789,
    meta: { forestMemory: seed.forestMemory ?? 0, journal: { species: [], keepsakes: [] } },
  };
  await seedRaw(context, save, seed.lastTickOffsetMs ?? 0);
}

/** Liest eine deutsch formatierte Zahl (z. B. „1.234,5“ oder „2,1/s“). Nur für Werte < 10.000. */
async function readNumber(locator: Locator): Promise<number> {
  const text = (await locator.textContent())?.trim() ?? '';
  const value = Number(text.replace(/\/s$/, '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(value)) throw new Error(`Keine Zahl: „${text}“`);
  return value;
}

const stageLabel = (page: Page) => page.locator('[data-ref="stage"]');
const encounters = (page: Page) => page.locator('[data-encounter]');
const niche = (page: Page, id: string) => page.locator(`[data-niche="${id}"]`);
const card = (page: Page, species: string) => page.locator(`[data-species="${species}"]`);

/** Wartet, bis die Seitenleiste vom Game Loop befüllt wurde. */
async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(stageLabel(page)).toContainText('Stufe:');
}

test('Spiel startet ohne Fehler mit Titel und Canvas, ohne Klick-Button und Upgrades', async ({ page }) => {
  await openGame(page);
  await expect(page).toHaveTitle('Vom Samen zum Wald');
  await expect(page.getByRole('heading', { level: 1, name: 'Vom Samen zum Wald' })).toBeVisible();
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  await expect(page.getByRole('button', { name: /Wachsen/ })).toHaveCount(0);
  await expect(page.locator('.upgrade')).toHaveCount(0);

  const canvas = page.locator('canvas#scene');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  // Einige Frames laufen lassen, damit Fehler im Game Loop auffallen.
  await page.waitForTimeout(500);
});

test('Wachstum steigt von selbst, die erste Begegnung erscheint', async ({ page }) => {
  await openGame(page);
  await expect(page.locator('[data-ref="growth-rate"]')).not.toHaveText('0/s');
  const first = await readNumber(page.locator('[data-ref="growth-total"]'));
  await expect.poll(() => readNumber(page.locator('[data-ref="growth-total"]'))).toBeGreaterThan(first + 0.5);
  // Erster Wegpunkt bei 4 Gesamt-Wachstum: nach ~4 s ist der Samen ein Keimling.
  await expect(stageLabel(page)).toHaveText('Stufe: Keimling', { timeout: 8_000 });
  await expect(encounters(page)).toHaveCount(1);
  await expect(card(page, 'earthworm')).toContainText('Regenwurm');
  await expect(card(page, 'earthworm')).toContainText('Bodenleben');
  await expect(card(page, 'earthworm')).toContainText('gewöhnlich');
  await expect(card(page, 'earthworm')).toContainText('Wurzelraum');
});

test('Karte wählen: Tier zieht in seine Nische, Neuladen zeigt denselben Stand', async ({ page, context }) => {
  // Junger Baum mit einer offenen Begegnung (Karten fest im Spielstand)
  await seedV2(context, {
    totalGrowth: WAYPOINT[6] + 1,
    seeds: 3,
    niches: { roots: ['earthworm'] },
    pendingEncounters: [
      { type: 'animal', cards: ['bluetit', 'oakmoth', 'robin'], rerolls: 0 },
      { type: 'animal', cards: ['woodlouse', 'barkbeetle'], rerolls: 0 },
    ],
  });
  await openGame(page);
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  await expect(encounters(page)).toHaveCount(2);

  await card(page, 'bluetit').getByRole('button', { name: 'Wählen' }).click();
  await expect(niche(page, 'crown')).toContainText('Blaumeise');
  await expect(encounters(page)).toHaveCount(1);

  await page.reload();
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  await expect(niche(page, 'crown')).toContainText('Blaumeise');
  await expect(niche(page, 'roots')).toContainText('Regenwurm');
  await expect(encounters(page)).toHaveCount(1);
  await expect(card(page, 'woodlouse')).toBeVisible();
  await expect(card(page, 'barkbeetle')).toBeVisible();

  const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) ?? '{}');
  expect(saved.version).toBe(2);
  expect(saved.niches.crown).toEqual(['bluetit']);
  expect(saved.pendingEncounters).toEqual([{ type: 'animal', cards: ['woodlouse', 'barkbeetle'], rerolls: 0 }]);
});

test('Ablehnen bringt Samen, Neu würfeln kostet Samen', async ({ page, context }) => {
  await seedV2(context, {
    totalGrowth: WAYPOINT[6] + 1,
    seeds: 12,
    pendingEncounters: [
      { type: 'animal', cards: ['bluetit'], rerolls: 0 },
      { type: 'animal', cards: ['robin'], rerolls: 0 },
    ],
  });
  await openGame(page);
  const seeds = page.locator('[data-ref="seeds"]');

  const reroll = encounters(page).first().getByRole('button', { name: /Neu würfeln \(−10 🌰\)/ });
  await expect(reroll).toBeEnabled();
  await reroll.click();
  expect(await readNumber(seeds)).toBeLessThan(5);
  await expect(encounters(page).first().getByRole('button', { name: /Neu würfeln \(−20 🌰\)/ })).toBeDisabled();

  await encounters(page).first().getByRole('button', { name: /Ablehnen \(\+5 🌰\)/ }).click();
  await expect(encounters(page)).toHaveCount(1);
  expect(await readNumber(seeds)).toBeGreaterThanOrEqual(7);
});

test('Volle Nische: Tier tauschen', async ({ page, context }) => {
  await seedV2(context, {
    totalGrowth: WAYPOINT[6] + 1,
    niches: { litter: ['woodlouse', 'centipede'] },
    pendingEncounters: [{ type: 'animal', cards: ['robin'], rerolls: 0 }],
  });
  await openGame(page);
  const robin = card(page, 'robin');
  await expect(robin).toContainText('voll');
  await robin.getByRole('combobox').selectOption('centipede');
  await robin.getByRole('button', { name: 'Tauschen' }).click();
  await expect(niche(page, 'litter')).toContainText('Rotkehlchen');
  await expect(niche(page, 'litter')).toContainText('Rollassel');
  await expect(niche(page, 'litter')).not.toContainText('Steinläufer');
});

test('„Spielstand löschen“ setzt nach Bestätigung zurück', async ({ page, context }) => {
  await seedV2(context, {
    totalGrowth: WAYPOINT[6] + 1,
    seeds: 500,
    niches: { roots: ['earthworm'], crown: ['bluetit'] },
    pendingEncounters: [{ type: 'animal', cards: ['robin'], rerolls: 0 }],
  });
  await openGame(page);
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');

  // Ein einzelner Klick fragt nur nach und lässt den Stand unverändert.
  await page.getByRole('button', { name: 'Spielstand löschen' }).click();
  await expect(page.getByRole('button', { name: /Wirklich alles löschen/ })).toBeVisible();
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');

  // Der zweite Klick bestätigt und setzt zurück.
  await page.getByRole('button', { name: /Wirklich alles löschen/ }).click();
  await expect(page.getByRole('button', { name: 'Spielstand löschen' })).toBeVisible();
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  expect(await readNumber(page.locator('[data-ref="seeds"]'))).toBeLessThan(5);
  await expect(niche(page, 'crown')).not.toContainText('Blaumeise');

  // Auch nach dem Neuladen bleibt der Stand zurückgesetzt.
  await page.reload();
  await expect(stageLabel(page)).toHaveText(/Stufe: (Samen|Keimling)/);
  await expect(niche(page, 'crown')).not.toContainText('Blaumeise');
  expect(await readNumber(page.locator('[data-ref="seeds"]'))).toBeLessThan(5);
});

test('v1-Spielstand: Neustart mit Andenken-Meldung', async ({ page, context }) => {
  await seedRaw(
    context,
    {
      version: 1,
      resources: { water: 10, light: 10, energy: 9000 },
      upgrades: { 'root-hairs': 10, cotyledon: 10 },
      stage: 4,
      totalEnergy: 50_000,
    },
    -2 * 60 * 60 * 1000,
  );
  await openGame(page);
  const toast = page.locator('#toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Dein Wald beginnt neu – mit Erinnerungen.');
  await expect(stageLabel(page)).toHaveText(/Stufe: (Samen|Keimling)/);

  const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) ?? '{}');
  expect(saved.version).toBe(2);
  expect(saved.meta.forestMemory).toBe(5);
  expect(saved).not.toHaveProperty('upgrades');

  // Beim nächsten Laden kommt die Meldung nicht noch einmal.
  await page.reload();
  await expect(stageLabel(page)).toContainText('Stufe:');
  await page.waitForTimeout(300);
  await expect(toast).toBeHidden();
});

test('Offline-Fortschritt zeigt Willkommens-Meldung mit wartenden Begegnungen', async ({ page, context }) => {
  await seedV2(context, {
    totalGrowth: WAYPOINT[3] + 1,
    niches: { roots: ['earthworm'] },
    lastTickOffsetMs: -60 * 60 * 1000,
  });
  await openGame(page);

  const toast = page.locator('#toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Willkommen zurück');
  await expect(toast).toContainText('🌿');
  await expect(toast).toContainText(/Begegnung/);
  // In einer Stunde vergehen mehrere Wegpunkte – höchstens 3 Begegnungen warten.
  await expect(encounters(page)).toHaveCount(3);
});

test('ohne Offline-Zeit erscheint keine Willkommens-Meldung', async ({ page, context }) => {
  await seedV2(context, { totalGrowth: WAYPOINT[3] + 1 });
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
    await expectNoHorizontalScroll(page);
  });

  test('kein horizontales Scrollen mit vollen Nischen, 3 Begegnungen und großen Zahlen', async ({ page, context }) => {
    await seedV2(context, {
      totalGrowth: WAYPOINT[20] + 1,
      seeds: 9.87e8,
      forestMemory: 500,
      niches: {
        roots: ['earthworm'],
        litter: ['robin', 'woodlouse', 'centipede'],
        edge: ['bee'],
        crown: ['bluetit', 'oakmoth'],
        bark: ['barkbeetle', 'woodpecker'],
      },
      pendingEncounters: [
        { type: 'animal', cards: ['robin', 'bee', 'woodpecker'], rerolls: 5 },
        { type: 'animal', cards: ['centipede', 'oakmoth', 'earthworm'], rerolls: 0 },
        { type: 'animal', cards: ['bluetit', 'barkbeetle', 'woodlouse'], rerolls: 0 },
      ],
    });
    await openGame(page);
    await expect(stageLabel(page)).toHaveText('Stufe: Hain');
    await expect(encounters(page)).toHaveCount(3);
    await expectNoHorizontalScroll(page);
  });
});
