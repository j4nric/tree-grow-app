import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { WAYPOINT_THRESHOLDS } from '../src/content/waypoints';
import { CONFIRM_MIN_MS } from '../src/ui/confirm';
import { v7GrowthToV6 } from '../src/core/save';
import { createInitialState } from '../src/core/state';

export { SAVE_VERSION } from '../src/core/state';

/**
 * Gemeinsame Hilfen für die e2e-Tests (Smoke-Tests, Langlauf).
 * Selektoren nur über Rollen, Text und data-ref-/data-Attribute, damit Änderungen an
 * Optik und Renderer die Tests nicht brechen.
 */

export const SAVE_KEY = 'tree-grow-save';

/**
 * Sammelt Konsolenfehler und unbehandelte Seitenfehler; jeder Test muss fehlerfrei enden.
 * Tagesziele sind in e2e-Tests aus (`window.__VSZW_DAILY__ = false`), sonst brächte das echte
 * Datum Ziele, Belohnungen und Hinweise in fremde Tests. Einschalten: `test.use({ daily: true })`.
 */
export const test = base.extend<{ pageErrors: string[]; daily: boolean; dailySwitch: void }>({
  daily: [false, { option: true }],
  dailySwitch: [
    async ({ context, daily }, use) => {
      if (!daily) await context.addInitScript(() => ((window as unknown as { __VSZW_DAILY__?: boolean }).__VSZW_DAILY__ = false));
      await use();
    },
    { auto: true },
  ],
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

export { expect };

/** Gesamt-Wachstum, ab dem Wegpunkt k erreicht ist – direkt aus den Spieldaten. */
export const waypoint = (k: number): number => WAYPOINT_THRESHOLDS[k]!;

/**
 * Gesamt-Wachstum der aktuellen Kurve → dieselbe Stelle (Wegpunkt und Anteil bis zum
 * nächsten) auf der Kurve der Stände v3–v6 (3,5 · k^3,4). Umkehrung der Migration
 * v6 → v7 (`v7GrowthToV6` in src/core/save.ts, Rundlauf per Vitest abgesichert): Ein
 * v3-Stand mit `legacyGrowth(waypoint(k) + x)` lädt genau bei `waypoint(k) + x`.
 */
export const legacyGrowth = v7GrowthToV6;

export type NicheId = 'roots' | 'litter' | 'edge' | 'crown' | 'bark' | 'hollows' | 'pond';

export interface SeedV3 {
  totalGrowth?: number;
  seeds?: number;
  /** Begleitpflanzen im Pflanzring (Pflanzen-IDs, Duplikate erlaubt). */
  plants?: string[];
  niches?: Partial<Record<NicheId, string[]>>;
  pendingEncounters?: { type: 'animal' | 'plant' | 'event' | 'visitor'; cards: string[]; rerolls: number }[];
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
 * Mit `page.clock` vorher installiert, nutzt `Date.now()` hier schon die Testuhr.
 */
export async function seedRaw(context: BrowserContext, save: object, lastTickOffsetMs?: number): Promise<void> {
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

/**
 * Spielstand im Format v3 (mit Pflanzring); das Laden übernimmt ihn verlustfrei (erster
 * Zyklus, Tagebuch-Arten zählen als neu). `totalGrowth` wird wie gewohnt auf der aktuellen
 * Kurve angegeben (`waypoint()`) und hier auf die Kurve der v3-Stände umgerechnet – das
 * Laden rechnet sie zurück (Migration v6 → v7). v2 würde zusätzlich die Samen begrenzen –
 * Tests mit großen Samenzahlen brauchen darum v3.
 */
export async function seedV3(context: BrowserContext, seed: SeedV3): Promise<void> {
  const save = {
    version: 3,
    totalGrowth: legacyGrowth(seed.totalGrowth ?? 0),
    seeds: seed.seeds ?? 0,
    waypoint: 0, // wird beim Laden aus totalGrowth abgeleitet
    stage: 0,
    plants: seed.plants ?? [],
    niches: { roots: [], litter: [], edge: [], crown: [], bark: [], hollows: [], ...seed.niches },
    pendingEncounters: seed.pendingEncounters ?? [],
    rngState: seed.rngState ?? 123456789,
    meta: { forestMemory: seed.forestMemory ?? 0, journal: { species: [], keepsakes: [] } },
  };
  await seedRaw(context, save, seed.lastTickOffsetMs ?? 0);
}

/**
 * Neues Spiel (aktueller Spielstand wie beim allerersten Start) mit festem Startwert des
 * Zufallsgenerators. main.ts nimmt dafür sonst die Uhrzeit; so bleibt der Seed auch dann
 * fest, wenn sich die Startzeit des Tests ändert. `now` = Beginn des Zyklus,
 * `lastTick` = Browser-Uhr beim Laden.
 */
export async function seedNewGame(context: BrowserContext, rngSeed: number, now: Date, forestMemory = 0): Promise<void> {
  const state = createInitialState(now.getTime(), rngSeed);
  state.meta.forestMemory = forestMemory;
  await seedRaw(context, state, 0);
}

/** Liest eine deutsch formatierte Zahl (z. B. „1.234,5“, „2,1/s“ oder „−4,7“). */
export function parseGermanNumber(text: string): number {
  const value = Number(
    text
      .trim()
      .replace(/\/s$/, '')
      .replace(/\s*%$/, '')
      .replace('−', '-')
      .replace('±', '')
      .replace(/\./g, '')
      .replace(',', '.'),
  );
  if (!Number.isFinite(value)) throw new Error(`Keine Zahl: „${text}“`);
  return value;
}

/** Liest eine deutsch formatierte Zahl aus einem Element. Nur für Werte < 10.000 (ohne „Tsd.“ o. Ä.). */
export async function readNumber(locator: Locator): Promise<number> {
  return parseGermanNumber((await locator.textContent()) ?? '');
}

export const stageLabel = (page: Page) => page.locator('[data-ref="stage"]');
export const seedsValue = (page: Page) => page.locator('[data-ref="seeds"]');
export const stack = (page: Page) => page.locator('[data-ref="encounter-stack"]');
export const dialog = (page: Page) => page.getByRole('dialog');
export const niche = (page: Page, id: string) => page.locator(`[data-niche="${id}"]`);
export const card = (page: Page, species: string) => dialog(page).locator(`[data-species="${species}"]`);

/** Reiter des Albums über ihren Hash (docs/ALBUM_UI.md, C.2). */
export type TabHash = 'nischen' | 'arten' | 'pflege' | 'ziele' | 'landschaft';
const TAB_IDS: Record<TabHash, string> = {
  nischen: 'niches',
  arten: 'species',
  pflege: 'care',
  ziele: 'goals',
  landschaft: 'landscape',
};

export const tabButton = (page: Page, tab: TabHash) => page.locator(`[data-ref="tab-${TAB_IDS[tab]}"]`);
export const tabPanel = (page: Page, tab: TabHash) => page.locator(`[data-ref="page-${TAB_IDS[tab]}"]`);
/** Überschrift der sichtbaren Reiterseite (Fokusziel, wenn sonst nichts mehr da ist). */
export const pageTitle = (page: Page) => page.locator('.album-tabpanel:not([hidden]) .page-title');
/** Unterseite des Albums, z. B. `subpage(page, 'save')`. */
export const subpage = (page: Page, kind: string) => page.locator(`[data-ref="page-${kind}"]`);
export const cover = (page: Page) => page.locator('[data-ref="cover"]');

/**
 * Meldungen (docs/ALBUM_UI.md, C.5) – Ersatz für den Toast. `stamps` ist die ganze Schicht
 * (für „enthält“), `stamp` die neueste Meldung (Stempel oder Zettel; für genaue Texte).
 * Ausgeblendete Meldungen verlieren ihr `data-ref` sofort.
 */
export const stamps = (page: Page) => page.locator('[data-ref="stamps"]');
export const stamp = (page: Page) => page.locator('[data-ref="stamp"]').last();
/** Neueste Meldung, nachdem sie fertig „hereingestempelt“ ist (für Lage und Größe). */
export async function settledStamp(page: Page): Promise<Locator> {
  const latest = stamp(page);
  await latest.evaluate((node) => Promise.all(node.getAnimations().map((a) => a.finished)));
  return latest;
}
/** Haftnotiz (C.4) mit `data-ref`, z. B. `weather-details`, `harmony-note`. */
export const note = (page: Page, ref = 'note') => page.locator(`[data-ref="${ref}"]`);

/** Wechselt per Klick in einen Reiter des Albums. */
export async function openTab(page: Page, tab: TabHash): Promise<void> {
  await tabButton(page, tab).click();
  await expect(tabButton(page, tab)).toHaveAttribute('aria-selected', 'true');
  await expect(tabPanel(page, tab)).toBeVisible();
}

/** Öffnet das Album direkt in einem Reiter (Hash, z. B. `/#pflege`) und wartet auf den Game Loop. */
export async function gotoTab(page: Page, tab: TabHash): Promise<void> {
  await page.goto(`/#${tab}`);
  await expect(stageLabel(page)).toContainText('Stufe:');
  await expect(tabButton(page, tab)).toHaveAttribute('aria-selected', 'true');
}

/** Öffnet den Buchumschlag (Menü: Spielanleitung, Einstellungen, Spielstand). */
export async function openCover(page: Page): Promise<void> {
  const button = page.locator('[data-ref="cover-open"]');
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  // Ruhezustand: sichtbar, keine Schließ-Animation mehr.
  await expect(cover(page)).toBeVisible();
  await expect(cover(page)).not.toHaveClass(/cover-out/);
}

/** Umschlag → Unterseite (Spielanleitung, Einstellungen, Konto, Spielstand), Umblättern abgewartet. */
export async function openCoverPage(page: Page, kind: 'guide' | 'settings' | 'account' | 'save'): Promise<void> {
  if (await subpage(page, kind).isVisible()) return;
  await openCover(page);
  await page.locator(`[data-ref="${kind}-open"]`).click();
  await expect(subpage(page, kind)).toBeVisible();
  // Umblättern abwarten (die Seite ist währenddessen nicht bedienbar).
  await expect(subpage(page, kind)).not.toHaveAttribute('inert', '');
}

/** Umschlag → Unterseite „Spielstand“ (Export, Import, Spielstand löschen). */
export const openSavePage = (page: Page) => openCoverPage(page, 'save');

/** Zurück über das Lesezeichen der obersten Unterseite. */
export async function back(page: Page): Promise<void> {
  await page.locator('[data-ref="bookmark"]:visible').click();
}

/** Wartet, bis die Seitenleiste vom Game Loop befüllt wurde. */
export async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(stageLabel(page)).toContainText('Stufe:');
}

/** Eingabesperre des Dialogs nach neuen Karten abwarten (300 ms, Schutz vor Doppelklicks). */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(400);
}

/** Öffnet den Begegnungs-Stapel am Rand der Szene. */
export async function openStack(page: Page): Promise<void> {
  await stack(page).click();
  await expect(dialog(page)).toBeVisible();
  await settle(page);
}

export async function savedState(page: Page): Promise<Record<string, any>> {
  return JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) ?? '{}');
}

/**
 * Bestätigungen per zweitem Klick nehmen den zweiten Klick erst nach CONFIRM_MIN_MS an
 * (Schutz vor Doppelklicks). Mit installierter Testuhr (`page.clock`) die Uhr vorstellen.
 */
export async function waitForConfirm(page: Page, options: { clock?: boolean } = {}): Promise<void> {
  if (options.clock) await page.clock.runFor(CONFIRM_MIN_MS + 50);
  else await page.waitForTimeout(CONFIRM_MIN_MS + 50);
}

/** Überlappen sich zwei Rechtecke (mit mehr als einem Pixel)? */
export function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return dx > 1 && dy > 1;
}

/**
 * Lage des Szenen-Canvas: Layoutgröße (`width`, `height`) und Umrechnung eines Punkts im
 * Canvas in Seitenkoordinaten. Rechnet CSS-Transformationen der Vorfahren mit ein (das Bild im
 * Polaroid steht heute gerade, das umschließende Rechteck wäre sonst bei einer Drehung größer).
 */
export async function sceneGeometry(page: Page): Promise<{ width: number; height: number; toPage(x: number, y: number): { x: number; y: number } }> {
  const g = await page.locator('canvas#scene').evaluate((el) => {
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // Lineare Teile aller Transformationen bis zur Wurzel.
    let m = new DOMMatrix();
    for (let node: Element | null = el; node; node = node.parentElement) {
      const t = getComputedStyle(node).transform;
      if (t && t !== 'none') m = new DOMMatrix(t).multiply(m);
    }
    return { width: parseFloat(style.width), height: parseFloat(style.height), cx: r.left + r.width / 2, cy: r.top + r.height / 2, a: m.a, b: m.b, c: m.c, d: m.d };
  });
  return {
    width: g.width,
    height: g.height,
    toPage(x, y) {
      const dx = x - g.width / 2;
      const dy = y - g.height / 2;
      return { x: g.cx + g.a * dx + g.c * dy, y: g.cy + g.b * dx + g.d * dy };
    },
  };
}

/** Vollbild der Szene (docs/ALBUM_UI.md, C.6). */
export const fullscreen = (page: Page) => page.locator('[data-ref="fullscreen"]');
/** Polaroid-Knopf „Szene vergrößern“ (hält das Canvas, solange kein Vollbild offen ist). */
export const polaroidButton = (page: Page) => page.locator('[data-ref="polaroid-open"]');

/**
 * Öffnet das Vollbild per Klick (bzw. `tap`) auf das Polaroid und wartet, bis es aufgezogen
 * ist und der Renderer die neue Größe übernommen hat (Backing-Store = Layout × Pixeldichte) –
 * erst dann stimmen Treffer-Test und Kamera mit der Lage im Vollbild überein.
 */
export async function openFullscreen(page: Page, options: { tap?: boolean } = {}): Promise<void> {
  if (options.tap) await polaroidButton(page).tap();
  else await polaroidButton(page).click();
  await expect(fullscreen(page)).toBeVisible();
  await expect(fullscreen(page)).not.toHaveClass(/fullscreen-moving/);
  await expect
    .poll(() =>
      page.locator('canvas#scene').evaluate((el) => {
        const c = el as HTMLCanvasElement;
        const d = window.devicePixelRatio;
        return (
          !!c.closest('[data-ref="fullscreen"]') &&
          Math.abs(c.width - Math.round(c.clientWidth * d)) <= 1 &&
          Math.abs(c.height - Math.round(c.clientHeight * d)) <= 1
        );
      }),
    )
    .toBe(true);
}

/** Schließt das Vollbild per „Zurück ins Album“ und wartet, bis das Canvas wieder im Polaroid liegt. */
export async function closeFullscreen(page: Page): Promise<void> {
  await page.locator('[data-ref="fullscreen-close"]').click();
  await expect(fullscreen(page)).toBeHidden();
  await expect(polaroidButton(page).locator('canvas#scene')).toHaveCount(1);
}
