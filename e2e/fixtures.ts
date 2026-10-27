import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { WAYPOINT_THRESHOLDS } from '../src/content/waypoints';
import { CONFIRM_MIN_MS } from '../src/ui/confirm';
import { loadGame, v7GrowthToV6 } from '../src/core/save';
import { STAGES } from '../src/content/stages';
import { createInitialState, createSite, type GameState } from '../src/core/state';

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
export const test = base.extend<{
  pageErrors: string[];
  daily: boolean;
  dailySwitch: void;
  guideHint: boolean;
  guideHintSwitch: void;
  freshLegend: boolean;
  legendSwitch: void;
}>({
  /**
   * Haftnotiz „Neu hier?“ beim ersten Start (album/guide-hint.ts): Sie liegt als Notiz über dem
   * Polaroid und gilt in fremden Tests als schon gesehen. Einschalten: `test.use({ guideHint: true })`.
   */
  guideHint: [false, { option: true }],
  guideHintSwitch: [
    async ({ context, guideHint }, use) => {
      if (!guideHint) {
        await context.addInitScript(() => {
          try {
            localStorage.setItem('tree-grow-guide-hint-seen', '1');
          } catch {
            // about:blank o. Ä. ohne Speicher
          }
        });
      }
      await use();
    },
    { auto: true },
  ],
  daily: [false, { option: true }],
  dailySwitch: [
    async ({ context, daily }, use) => {
      if (!daily) await context.addInitScript(() => ((window as unknown as { __VSZW_DAILY__?: boolean }).__VSZW_DAILY__ = false));
      await use();
    },
    { auto: true },
  ],
  /*
   * Legende der Begegnungs-Symbole (Haftnotiz am „?“): Sie öffnet sich beim allerersten Mal
   * von selbst und läge dann über den Karten. In e2e-Tests gilt sie darum als schon gesehen;
   * die Legenden-Tests schalten das mit `test.use({ freshLegend: true })` ab.
   */
  freshLegend: [false, { option: true }],
  legendSwitch: [
    async ({ context, freshLegend }, use) => {
      if (!freshLegend) {
        await context.addInitScript(() => {
          try {
            localStorage.setItem('tree-grow-legend-seen', '1');
          } catch {
            // Dokument ohne Speicher (about:blank, data:-URL) – dort gibt es keine Legende.
          }
        });
      }
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
  /**
   * Offene Begegnungen. `type: 'plant'` („Etwas keimt“ bis Phase 10) lädt das Spiel als offene
   * Aussaat (die erste, weitere ziehen weiter) – so legen Tests eine Aussaat mit festen Karten an.
   */
  pendingEncounters?: { type: 'animal' | 'plant' | 'event' | 'visitor'; cards: string[]; rerolls: number }[];
  rngState?: number;
  forestMemory?: number;
  /**
   * Harmonie-Vorrat ⚖️ (seit v17, Forschung). Gesetzt: Der v3-Stand wird hier schon geladen
   * (Migration bis v17) und mit diesem Vorrat als aktueller Stand abgelegt – sonst bekäme er
   * das Startguthaben der Migration v16 → v17 (10 min Produktion).
   */
  harmonyPoints?: number;
  /** Erforschte Knoten (seit v17, nur zusammen mit `harmonyPoints`). */
  research?: string[];
  /** Ränge der wiederholbaren Knoten (28.6, nur zusammen mit `harmonyPoints`); je Rang steht die ID in `research`. */
  researchRanks?: Record<string, number>;
  /** Forschungsplan des letzten Zyklus und Schalter „Plan folgen“ (27.8, nur zusammen mit `harmonyPoints`). */
  researchPlan?: { plan: string[]; auto: boolean };
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
  if (seed.harmonyPoints === undefined && seed.research === undefined) {
    await seedRaw(context, save, seed.lastTickOffsetMs ?? 0);
    return;
  }
  const state = loadGame(JSON.stringify(save), 0)!.state;
  state.harmonyPoints = seed.harmonyPoints ?? 0;
  if (seed.research) state.cycle.research = [...seed.research];
  if (seed.researchRanks) state.cycle.researchRanks = { ...seed.researchRanks };
  if (seed.researchPlan) state.meta.research = { plan: [...seed.researchPlan.plan], auto: seed.researchPlan.auto };
  await seedRaw(context, state, seed.lastTickOffsetMs ?? 0);
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
export const niche = (page: Page, id: string) => page.locator(`[data-niche="${id}"]`);
/** Unterseite „Begegnung“ (U:Begegnung, docs/ALBUM_UI.md A.6) – früher der Kartenwahl-Dialog. */
export const encounter = (page: Page) => page.locator('[data-ref="page-encounter"]');
/** Knopf „🌱 Säen“ im Pflanzring (Reiter Nischen, DESIGN_V2.md 27.6). */
export const sowButton = (page: Page) => page.locator('[data-ref="sow"]');
export const card = (page: Page, species: string) => encounter(page).locator(`[data-species="${species}"]`);

/** Reiter des Albums über ihren Hash (docs/ALBUM_UI.md, C.2). */
export type TabHash = 'nischen' | 'arten' | 'forschung' | 'ziele' | 'landschaft';
const TAB_IDS: Record<TabHash, string> = {
  nischen: 'niches',
  arten: 'species',
  forschung: 'care',
  ziele: 'goals',
  landschaft: 'landscape',
};

/**
 * Karte eines Forschungsknotens im Reiter „Forschung“ (Baum, Phase 11, 4a) und ihr Knopf
 * „Erforschen · ⚖️ 80“. Mobil (< 640 px) sind anfangs nur Äste mit Erforschbarem offen –
 * `openBranch` klappt einen Ast auf.
 */
export const researchNode = (page: Page, id: string) => page.locator(`[data-ref="care"] .research-node[data-node="${id}"]`);
export const researchName = (page: Page, id: string) => page.locator(`[data-ref="care"] [data-research-name="${id}"]`);
export const researchAction = (page: Page, id: string) => page.locator(`[data-ref="care"] [data-research-action="${id}"]`);
export async function openBranch(page: Page, branch: string): Promise<void> {
  const toggle = page.locator(`[data-ref="care"] .research-branch[data-branch="${branch}"] .research-branch-toggle`);
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

export const tabButton = (page: Page, tab: TabHash) => page.locator(`[data-ref="tab-${TAB_IDS[tab]}"]`);
export const tabPanel = (page: Page, tab: TabHash) => page.locator(`[data-ref="page-${TAB_IDS[tab]}"]`);
/** Überschrift der sichtbaren Reiterseite (Fokusziel, wenn sonst nichts mehr da ist). */
export const pageTitle = (page: Page) => page.locator('.album-tabpanel:not([hidden]) .page-title');
/** Unterseite des Albums, z. B. `subpage(page, 'save')`. */
export const subpage = (page: Page, kind: string) => page.locator(`[data-ref="page-${kind}"]`);
export const cover = (page: Page) => page.locator('[data-ref="cover"]');

/** Sticker einer Art in einer Nische (Reiter Nischen, docs/ALBUM_UI.md B.1) – ein Knopf. */
export const sticker = (page: Page, nicheId: string, species: string) =>
  page.locator(`[data-niche="${nicheId}"] [data-species="${species}"] button.sticker`);
/** Unterseite „Tier“ (U:Tier). */
export const animalPage = (page: Page) => subpage(page, 'animal');

/** Wartet, bis eine Unterseite fertig aufgeschlagen ist (nicht mehr `inert`). */
export async function settledSubpage(page: Page, kind: string): Promise<Locator> {
  const sub = subpage(page, kind);
  await expect(sub).toBeVisible();
  await expect(sub).not.toHaveAttribute('inert', '');
  return sub;
}

/** Tipp auf einen Sticker: blättert zu U:Tier um und wartet, bis die Seite bedienbar ist. */
export async function openAnimal(page: Page, nicheId: string, species: string): Promise<Locator> {
  await sticker(page, nicheId, species).click();
  const sub = await settledSubpage(page, 'animal');
  await expect(sub).toHaveAttribute('data-species', species);
  return sub;
}

/**
 * Meldungen (docs/ALBUM_UI.md, C.5) – Ersatz für den Toast. `stamps` ist die ganze Schicht
 * (für „enthält“), `stamp` die neueste Meldung (Stempel oder Zettel; für genaue Texte).
 * Ausgeblendete Meldungen verlieren ihr `data-ref` sofort.
 */
export const stamps = (page: Page) => page.locator('[data-ref="stamps"]');
export const stamp = (page: Page) => page.locator('[data-ref="stamp"]').last();
/**
 * Urwald, dessen Landschaft gerade frei wird: Beim Laden kommt der Hinweis mit dem Eichelhäher
 * als bleibender Zettel mit „×“ (lang, `keep`) – für Tests der Zettel-Optik. (Die Rückkehr
 * stempelt seit Playtest Schritt 14 nur noch kurz.)
 */
export function landscapeUnlockState(): GameState {
  const ancient = STAGES.findIndex((s) => s.id === 'ancient-forest');
  const state = createInitialState(Date.now(), 4242);
  state.stage = ancient;
  state.waypoint = STAGES[ancient]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.cycle.number = 4;
  state.meta.forestMemory = 300;
  state.meta.achievements = ['ancient-forest'];
  state.meta.landscape = { active: 'home', sites: [{ ...createSite('home'), ancient: true }], corridors: [], freeCorridors: [], announced: false };
  return state;
}

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

/** Öffnet das Album direkt in einem Reiter (Hash, z. B. `/#forschung`) und wartet auf den Game Loop. */
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

/**
 * Reiter „Ziele“ → Unterseite „Neuer Zyklus“, „Erfolge“ oder „Statistik“ (docs/ALBUM_UI.md,
 * B.4). Wartet, bis das Umblättern fertig ist (vorher ist die Seite nicht bedienbar).
 */
export async function openGoalsPage(page: Page, kind: 'cycle' | 'achievements' | 'stats'): Promise<Locator> {
  const target = subpage(page, kind);
  if (await target.isVisible()) return target;
  await openTab(page, 'ziele');
  await page.locator(`[data-ref="${kind}-open"]`).click();
  await expect(target).toBeVisible();
  await expect(target).not.toHaveAttribute('inert', '');
  return target;
}

/**
 * Reiter „Landschaft“ → Tipp auf einen Standort der Karte → U:Standort (docs/ALBUM_UI.md, B.5).
 * Wartet, bis das Umblättern fertig ist und die Seite den Standort zeigt.
 */
export async function openLandscapeSite(page: Page, site: string): Promise<Locator> {
  const target = subpage(page, 'site');
  if ((await target.isVisible()) && (await target.getAttribute('data-site-id')) === site) return target;
  if (!(await tabPanel(page, 'landschaft').isVisible())) await openTab(page, 'landschaft');
  const button = page.locator(`[data-ref="landscape-map"] [data-site="${site}"]`);
  // Der Klick wartet, bis die Reiterseite nach einem Zurückblättern wieder bedienbar ist.
  await button.click();
  await expect(target).toBeVisible();
  await expect(target).not.toHaveAttribute('inert', '');
  await expect(target).toHaveAttribute('data-site-id', site);
  return target;
}

/** Umschlag → Unterseite „Spielstand“ (Export, Import, Spielstand löschen). */
export const openSavePage = (page: Page) => openCoverPage(page, 'save');

/**
 * Wartet, bis im Album keine Animation mehr läuft (Umblättern, Umschlag, Überblenden) – statt
 * einer festen Wartezeit. Danach prüfen die Tests den Ruhezustand. Endlose Animationen (z. B.
 * die wandernden Spuren `lsc-trail` der Wildwechsel-Korridore auf der Karte) zählen nicht – sie
 * enden nie und sind kein Übergang.
 */
export async function albumAnimationsDone(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      if (a.playState !== 'running') return true;
      if (a.effect?.getComputedTiming().iterations === Infinity) return true;
      const target = (a.effect as KeyframeEffect | null)?.target;
      return !(target instanceof Element && target.closest('[data-ref="album"], [data-ref="cover"]'));
    }),
  );
}

/** Zurück über das Lesezeichen der obersten Unterseite. */
export async function back(page: Page): Promise<void> {
  await page.locator('[data-ref="bookmark"]:visible').click();
}

/** Wartet, bis die Seitenleiste vom Game Loop befüllt wurde. */
export async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(stageLabel(page)).toContainText('Stufe:');
}

/** Eingabesperre nach neuen Karten abwarten (300 ms, Schutz vor Doppelklicks). */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(400);
}

/** Tippt auf den Zettelstapel und wartet, bis U:Begegnung aufgeschlagen und bedienbar ist. */
export async function openStack(page: Page): Promise<void> {
  await stack(page).click();
  await settledSubpage(page, 'encounter');
  await settle(page);
}

/** „🌱 Säen“ im Reiter Nischen: sät (bzw. öffnet die offene Aussaat) und blättert zu U:Begegnung um. */
export async function sowNow(page: Page): Promise<Locator> {
  await sowButton(page).click();
  const sub = await settledSubpage(page, 'encounter');
  await settle(page);
  return sub;
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
