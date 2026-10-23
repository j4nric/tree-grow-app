import { test as base, type Page } from '@playwright/test';
import { CHAPTER_IDS, type ChapterId } from '../src/content/chronicle';
import { SEASON_SECONDS } from '../src/content/seasons';
import { COMMON_SPECIES, KENNARTEN } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { chronicleOf } from '../src/core/landscape';
import { codeFromJson, exportCode, importCode, serialize } from '../src/core/save';
import { MAX_FOREST_MEMORY, createInitialState, createSite, type ChronicleEntry, type GameState } from '../src/core/state';
import {
  SAVE_VERSION,
  back,
  expect,
  gotoTab,
  openCoverPage,
  openGame,
  openGoalsPage,
  openLandscapeSite,
  openSavePage,
  openTab,
  savedState,
  seedRaw,
  stamps,
  subpage,
  tabPanel,
  test,
  waitForConfirm,
  waypoint,
} from './fixtures';

/**
 * Phase 9, 4a (ROADMAP; DESIGN_V2.md 26.6/26.7) – ergänzt `e2e/chronicle.spec.ts` (3a) um die
 * Lücken: Ein v15-Stand lädt (über v16) als aktueller Stand mit abgeleiteten Kapiteln; das
 * letzte Kapitel per Fixture → Stempel → Andenken und Siegel bleiben nach dem Neuladen;
 * Kennarten vor der Landschaft unsichtbar auch über Hash/URL und Zähler; ein älteres Gerät
 * lehnt den neueren Stand ab
 * (`outdated-client` beim Sync, `newer` beim Import).
 */

const ANCIENT = STAGES.findIndex((s) => s.id === 'ancient-forest');
const GROVE = STAGES.findIndex((s) => s.id === 'grove');
const WINTER = 3 * SEASON_SECONDS;

const entry = (chapter: ChapterId, cycle: number | null, season: ChronicleEntry['season'] = null): ChronicleEntry => ({ chapter, cycle, season });
const site = (page: Page) => subpage(page, 'site');
const chapter = (page: Page, id: ChapterId) => site(page).locator(`[data-ref="site-chronicle-list"] [data-chapter="${id}"]`);
type SavedSite = { id: string; chronicle: ChronicleEntry[] };
const savedChronicle = (save: Record<string, any>, id: string): ChronicleEntry[] =>
  (save.meta.landscape.sites as SavedSite[]).find((s) => s.id === id)!.chronicle;

/** Landschaft frei, Zyklus 4, Stufe `stage`; Wälder nach Wahl. */
function landscapeState(stage: number, sites: GameState['meta']['landscape']['sites'], corridors: string[]): GameState {
  const state = createInitialState(Date.now(), 4242);
  state.stage = stage;
  state.waypoint = STAGES[stage]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.cycle.number = 4;
  state.meta.achievements = ['ancient-forest'];
  state.meta.landscape = { active: 'home', sites, corridors, freeCorridors: corridors, announced: true };
  return state;
}

// --- Migration v15 → v16 (→ aktuell) ------------------------------------------------------

test('v15-Stand lädt als aktueller Stand: abgeleitete Kapitel ohne Datum, Erfundenes zählt nicht, kein Stempel', async ({ page, context }) => {
  // Heimatwald aktiv (uralt, volles Gedächtnis über meta.forestMemory), Auwald ruhend und uralt
  // mit halbem Gedächtnis, Erlenbruch jung. Hain: im Test entsteht kein neues Kapitel.
  const state = landscapeState(
    GROVE,
    [
      { ...createSite('home'), ancient: true },
      { ...createSite('floodplain'), ancient: true, memory: 400 },
      { ...createSite('carr'), memory: 120 },
    ],
    ['home-floodplain', 'home-carr'],
  );
  state.meta.forestMemory = MAX_FOREST_MEMORY;
  const v15 = JSON.parse(serialize(state)) as Record<string, any>;
  v15.version = 15;
  for (const s of v15.meta.landscape.sites) delete s.chronicle;
  // Wie ein echter v15-Stand: Pflege statt Forschung, ohne Harmonie-Vorrat und Aussaat (v17).
  delete v15.harmonyPoints;
  delete v15.meta.research;
  delete v15.cycle.research;
  delete v15.cycle.sowing;
  v15.cycle.care = {};
  // Ein gleichnamiges Feld in einem v15-Stand ist nicht von uns – es zählt nicht.
  v15.meta.landscape.sites[2].chronicle = [{ chapter: 'harmony', cycle: 2, season: 'summer' }];
  await seedRaw(context, v15, 0);
  await openGame(page);

  await openTab(page, 'landschaft');
  const panel = tabPanel(page, 'landschaft');
  await expect(panel.locator('[data-ref="chronicle-total"]')).toHaveText('📜 3 / 36 Kapitel');
  const forests = panel.locator('[data-ref="landscape-forests"]');
  await expect(forests.locator('[data-forest="home"] [data-row="chronicle"]')).toContainText('2 / 6');
  await expect(forests.locator('[data-forest="floodplain"] [data-row="chronicle"]')).toContainText('1 / 6');
  await expect(forests.locator('[data-forest="carr"] [data-row="chronicle"]')).toContainText('0 / 6');

  await openLandscapeSite(page, 'home');
  await expect(site(page).locator('[data-ref="site-chronicle-count"]')).toHaveText('2 / 6');
  for (const id of ['ancient', 'memory'] as const) {
    await expect(chapter(page, id)).toHaveClass(/written/);
    await expect(chapter(page, id).locator('[data-ref="chapter-stamp"]')).toHaveText('schon früher');
  }
  await back(page);
  await openLandscapeSite(page, 'carr');
  await expect(site(page).locator('[data-ref="site-chronicle-count"]')).toHaveText('0 / 6');
  await expect(chapter(page, 'harmony')).not.toHaveClass(/written/);
  // Die Migration ist kein „neues Kapitel“.
  await expect(stamps(page)).not.toContainText('Kapitel');

  // Gespeichert wird im aktuellen Format (v15 → v16 → …) – mit genau den abgeleiteten Kapiteln.
  await page.reload();
  await expect(page.locator('[data-ref="stage"]')).toContainText('Stufe:');
  const saved = await savedState(page);
  expect(saved.version).toBe(SAVE_VERSION);
  expect(savedChronicle(saved, 'home')).toEqual([entry('ancient', null), entry('memory', null)]);
  expect(savedChronicle(saved, 'floodplain')).toEqual([entry('ancient', null)]);
  expect(savedChronicle(saved, 'carr')).toEqual([]);
});

// --- Letztes Kapitel → Stempel → Andenken, auch nach dem Neuladen ---------------------------

test('Letztes Kapitel online: Stempel, Andenken und Siegel – nach dem Neuladen noch da', async ({ page, context }) => {
  // Heimatwald im Urwald mit fünf Kapiteln, zwei Sekunden vor dem Winter: „Erster Schnee im
  // Urwald“ macht die Chronik vollständig. Die Bedingungen der Kapitel gelten (alt, volles
  // Gedächtnis, Haselmaus im Tagebuch) – sonst nähme das Laden sie weg.
  const state = landscapeState(ANCIENT, [{ ...createSite('home'), ancient: true }], []);
  state.cycle.elapsed = WINTER - 2;
  state.meta.forestMemory = MAX_FOREST_MEMORY;
  state.meta.journal.species.push('dormouse');
  state.meta.landscape.sites[0]!.chronicle = CHAPTER_IDS.filter((c) => c !== 'first-snow').map((c) => entry(c, 3, 'autumn'));
  await seedRaw(context, state, 0);
  await openGame(page);
  await expect(stamps(page)).toContainText('📜 Neues Kapitel im Heimatwald: Erster Schnee im Urwald', { timeout: 10_000 });
  await expect(stamps(page)).toContainText('Eine Waldgeschichte');

  const check = async () => {
    await openTab(page, 'landschaft');
    const panel = tabPanel(page, 'landschaft');
    await expect(panel.locator('[data-ref="chronicle-total"]')).toHaveText('📜 6 / 36 Kapitel');
    await expect(panel.locator('[data-ref="landscape-map"] [data-site="home"] [data-ref="site-seal"]')).toHaveText('🌰');
    await openLandscapeSite(page, 'home');
    await expect(site(page).locator('[data-ref="site-chronicle-count"]')).toHaveText('6 / 6');
    await expect(chapter(page, 'first-snow').locator('[data-ref="chapter-stamp"]')).toHaveText('4. Zyklus · Winter');
    await expect(chapter(page, 'harmony').locator('[data-ref="chapter-stamp"]')).toHaveText('3. Zyklus · Herbst');
    await expect(site(page).locator('[data-ref="site-keepsake"]')).toContainText('Die Eichel des Hähers');
    // R:Arten → Andenken: die Chronik des Heimatwalds mit ihrem Andenken.
    await openTab(page, 'arten');
    const species = tabPanel(page, 'arten');
    await species.locator('[data-jump="keepsakes"]').click();
    await expect(species.locator('[data-ref="species-chronicles"] [data-chronicle="home"]')).toContainText('Die Eichel des Hähers');
  };
  await check();
  await page.reload();
  await expect(page.locator('[data-ref="stage"]')).toContainText('Stufe:');
  await check();
  const saved = savedChronicle(await savedState(page), 'home');
  expect(saved.map((e) => e.chapter).sort()).toEqual([...CHAPTER_IDS].sort());
  expect(saved.find((e) => e.chapter === 'first-snow')).toEqual(entry('first-snow', 4, 'winter'));
  // Der Stempel kommt nach dem Neuladen nicht noch einmal.
  await page.waitForTimeout(500);
  await expect(stamps(page)).not.toContainText('Neues Kapitel');
});

// --- Kennarten vor der Landschaft: auch nicht über Hash, URL und Zähler ---------------------

/**
 * Wald (eine Stufe unter dem Urwald), Landschaft noch nicht frei, ein paar Arten im Tagebuch –
 * und der Biber, als hätte ein fremdes Gerät ihn eingetragen: Auch dann verrät nichts eine Kennart.
 */
function beforeLandscape(): GameState {
  const state = createInitialState(Date.now(), 4242);
  state.stage = ANCIENT - 1;
  state.waypoint = STAGES[state.stage]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.meta.journal.species.push('earthworm', 'robin', 'squirrel', 'beaver');
  return state;
}

const KENNART_NAMES = KENNARTEN.map((s) => s.name);
const KENNART_IDS = KENNARTEN.map((s) => s.id);

/** Nichts im DOM (auch Verborgenes) nennt eine Kennart – weder Name noch ID. */
async function expectNoKennart(page: Page): Promise<void> {
  const html = await page.content();
  for (const name of KENNART_NAMES) expect(html, name).not.toContain(name);
  for (const id of KENNART_IDS) expect(html, id).not.toMatch(new RegExp(`data-[a-z-]+="${id}"`));
  expect(html).not.toContain('Kennart');
  // Auch der Hash und der Titel verraten nichts.
  const { hash, title } = await page.evaluate(() => ({ hash: location.hash, title: document.title }));
  for (const id of KENNART_IDS) expect(hash + title).not.toContain(id);
  for (const name of KENNART_NAMES) expect(title).not.toContain(name);
}

test('Vor der Landschaft: Kennarten weder über den Hash noch in Zählern, Statistik oder Anleitung', async ({ page, context }) => {
  await seedRaw(context, beforeLandscape(), 0);
  // Unbekannte Hashes (Art-ID, Reihe „Kennarten“) und die gesperrte Landschaft führen zu den
  // Nischen; ein gültiger Hash zeigt die Arten – ohne Kennarten.
  for (const hash of ['#arten/beaver', '#beaver', '#kennarten', '#arten?art=lynx', '#landschaft', '#Arten']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('[data-ref="stage"]')).toContainText('Stufe:');
    const expected = hash === '#Arten' ? '#arten' : '#nischen';
    await expect.poll(() => page.evaluate(() => location.hash), { message: hash }).toBe(expected);
    await expectNoKennart(page);
  }
  // Ein Wechsel per Hash im laufenden Spiel ebenso.
  await gotoTab(page, 'arten');
  await page.evaluate(() => (location.hash = '#arten/dormouse'));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#nischen');

  // Zähler: nur die gewöhnlichen Arten, auch je Gattung (Säugetiere ohne Haselmaus, Biber, Luchs).
  await gotoTab(page, 'arten');
  const species = tabPanel(page, 'arten');
  await expect(species.locator('[data-ref="journal-counts"]')).toContainText(`3/${COMMON_SPECIES.length} Arten`);
  const mammals = COMMON_SPECIES.filter((s) => s.genus === 'mammals').length;
  await expect(species.locator('[data-ref="species-count-mammals"]')).toHaveText(`1 von ${mammals}`);
  await expect(species.locator('[data-ref="species-kennarten"]')).toHaveCount(0);
  // Alle zurückgehaltenen Blöcke aufdecken (Sprung ans Ende), dann prüfen.
  await species.locator('[data-jump="keepsakes"]').click();
  await expect(species.locator('[data-ref="species-chronicles"]')).toBeHidden();
  await expectNoKennart(page);

  // Statistik und Spielanleitung zählen ebenso ohne Kennarten.
  await openGoalsPage(page, 'stats');
  await expectNoKennart(page);
  await openCoverPage(page, 'guide');
  const guide = subpage(page, 'guide');
  await expect(guide.locator('[data-chapter="chronicle"]')).toHaveCount(0);
  const chapterPage = subpage(page, 'guide-chapter');
  // „Gattungen“ zählt die Arten, „Nachtarten“ nennt sie (Haselmaus und Ziegenmelker sind nachtaktiv).
  for (const [id, text] of [
    ['communities', `Es gibt ${COMMON_SPECIES.length} Arten`],
    ['night', 'Nachts werden'],
  ] as const) {
    await guide.locator(`[data-chapter="${id}"]`).click();
    await expect(chapterPage).toHaveAttribute('data-section', id);
    await expect(chapterPage).not.toHaveAttribute('inert', '');
    await expect(chapterPage).toContainText(text);
    await expectNoKennart(page);
    await chapterPage.locator('[data-ref="bookmark"]').click();
    await expect(guide).not.toHaveAttribute('inert', '');
  }
});

// --- Ein v15-Gerät lehnt den v16-Stand ab ---------------------------------------------------

/** Aktueller Stand mit Chronik und einer Kennart im Tagebuch (das, was ein älteres Spiel verlöre). */
function chronicleSave(): GameState {
  const state = landscapeState(GROVE, [{ ...createSite('home'), ancient: true }, { ...createSite('floodplain'), ancient: true }], ['home-floodplain']);
  state.meta.landscape.active = 'floodplain';
  state.meta.journal.species.push('beaver');
  state.meta.landscape.sites[0]!.chronicle = [entry('ancient', null), entry('signature', 2, 'spring')];
  state.meta.landscape.sites[1]!.chronicle = [entry('ancient', 3, 'winter'), entry('kennart', 4, 'summer')];
  return state;
}

/** Derselbe Stand, wie ihn eine neuere Spielversion speichert (version = SAVE_VERSION + 1). */
function newerCode(): string {
  const json = JSON.parse(serialize(chronicleSave())) as Record<string, unknown>;
  json.version = SAVE_VERSION + 1;
  return codeFromJson(JSON.stringify(json));
}

test('Import eines Stands einer neueren Spielversion: abgelehnt (newer), nichts geändert, keine Rückfrage', async ({ page, context }) => {
  // So sieht ein v15-Gerät einen v16-Code: version > eigene SAVE_VERSION. Hier spielt das
  // laufende Spiel die Rolle des älteren Geräts (Code mit SAVE_VERSION + 1).
  const own = createInitialState(Date.now(), 21);
  own.seeds = 77;
  await seedRaw(context, own, 0);
  await openGame(page);
  await page.reload(); // im aktuellen Format gespeichert
  const before = await savedState(page);
  await openSavePage(page);
  const transfer = page.locator('[data-ref="save-transfer"]');
  await transfer.locator('[data-ref="import-code"]').fill(newerCode());
  const importButton = transfer.locator('[data-ref="import"]');
  await importButton.click();
  await expect(transfer.locator('[data-ref="save-status"]')).toContainText('Dieser Code stammt aus einer neueren Spielversion');
  await expect(transfer.locator('[data-ref="save-status"]')).toContainText('bleibt unverändert');
  await expect(importButton).toHaveText('Importieren');
  // Ein zweiter Klick lädt ihn auch nicht.
  await waitForConfirm(page);
  await importButton.click();
  await expect(transfer.locator('[data-ref="save-status"]')).toContainText('neueren Spielversion');
  const after = await savedState(page);
  expect(after.meta.landscape?.sites?.map((s: SavedSite) => s.id) ?? ['home']).toEqual(before.meta.landscape?.sites?.map((s: SavedSite) => s.id) ?? ['home']);
  expect(after.meta.journal.species).not.toContain('beaver');
  expect(after.version).toBe(SAVE_VERSION);
});

declare const process: { env: Record<string, string | undefined> };
const SYNC_URL = `http://localhost:${Number(process.env.E2E_SYNC_PORT ?? Number(process.env.E2E_PORT ?? 4173) + 1)}`;
const uniqueName = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

base('Sync: ein älteres Gerät (SAVE_VERSION - 1) darf den Stand mit Chronik nicht überschreiben (422 outdated-client)', async ({ request }) => {
  const reg = await request.post(`${SYNC_URL}/api/register`, { data: { username: uniqueName('chron'), password: 'geheim-wald-1' } });
  expect(reg.status()).toBe(201);
  const headers = { Authorization: `Bearer ${((await reg.json()) as { token: string }).token}` };
  // Der Code trägt Chronik und Kennart.
  const code = exportCode(chronicleSave());
  const decoded = importCode(code, 0);
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) return;
  expect(decoded.result.state.version).toBe(SAVE_VERSION);
  expect(chronicleOf(decoded.result.state, 'floodplain')).toEqual([entry('ancient', 3, 'winter'), entry('kennart', 4, 'summer')]);

  const put = await request.put(`${SYNC_URL}/api/save`, { headers, data: { data: code, baseVersion: 0, deviceId: 'neu', action: true, schema: SAVE_VERSION } });
  expect(put.status()).toBe(200);
  const { version } = (await put.json()) as { version: number };
  // Ein älteres Gerät (ohne Biber) will darüber schreiben – auch mit passender Basis.
  const old = createInitialState(0, 1);
  const rejected = await request.put(`${SYNC_URL}/api/save`, {
    headers,
    data: { data: exportCode(old), baseVersion: version, deviceId: 'alt', action: true, schema: SAVE_VERSION - 1 },
  });
  expect(rejected.status()).toBe(422);
  expect(await rejected.json()).toMatchObject({ error: 'outdated-client', schema: SAVE_VERSION });
  // Im Konto liegt unverändert der neuere Stand mit seiner Chronik.
  const res = await request.get(`${SYNC_URL}/api/save`, { headers });
  expect(await res.json()).toMatchObject({ data: code, version, deviceId: 'neu', schema: SAVE_VERSION });
});
