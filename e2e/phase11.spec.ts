import type { Page } from '@playwright/test';
import { RESEARCH, RESEARCH_BY_ID } from '../src/content/research';
import { SEASONS_BY_ID } from '../src/content/seasons';
import { STAGES } from '../src/content/stages';
import { NICHE_IDS } from '../src/content/types';
import { TREE_PART_IDS } from '../src/content/upgrades';
import { researchCostAt } from '../src/core/formulas';
import { loadGame, serialize } from '../src/core/save';
import { seasonIdAt } from '../src/core/season';
import { createInitialState, type GameState } from '../src/core/state';
import { researchExcluded, researchRequirementsMet, simulateOffline, tick } from '../src/core/tick';
import { upgradeBase, upgradeCostFrom } from '../src/core/upgrades';
import {
  SAVE_VERSION,
  encounter,
  expect,
  gotoTab,
  niche,
  openBranch,
  openGoalsPage,
  openTab,
  researchAction,
  researchNode,
  savedState,
  seedRaw,
  sowNow,
  stageLabel,
  stamps,
  tabPanel,
  test,
  waitForConfirm,
  waypoint,
} from './fixtures';

/**
 * Phase 10 + 11, 5a (ROADMAP; DESIGN_V2.md 27.9, 28.3, 28.4, 28.6, 28.8): die Lücken, die die
 * einzelnen Specs nicht schon abdecken – v16 lädt über v17 als v18, v17 als v18 ohne Verlust,
 * Uhr 2 h vorstellen (Zehntel, Jahreszeit weiter), Tab 30 s im Hintergrund ohne Verlust, Gabel
 * wählen → andere Seite gesperrt → endloser Knoten frei, Neuer Zyklus setzt Ausbau, Ränge und
 * Vorrat zurück (Abzeichen und Plan bleiben, der Plan kauft), R:Nischen und R:Forschung mit
 * großen Zahlen bei 360/390 px ohne Querscrollen.
 *
 * Schon anderswo geprüft (hier nicht doppelt): Ausbau → Meilenstein 25 → neuer Platz →
 * Neuladen, ×10/Max, verschlossene Nische ohne Knopf, Zielzeile springt (e2e/upgrades.spec.ts);
 * Rang kaufen, Plan-Schalter (e2e/care.spec.ts); Rückkehr-Bericht nach 3 Std. mit „Zehntel“
 * (e2e/return-report.spec.ts); ein v17-Gerät lehnt den v18-Stand ab – `outdated-client` beim
 * Sync und `newer` beim Import (e2e/chronicle-save.spec.ts, allgemein mit SAVE_VERSION ∓ 1).
 *
 * Preise kommen aus content/core (Balancing ändert sich in Phase 11, 3a), Zeit nur über
 * `page.clock` (keine festen Wartezeiten).
 */

const stageIndex = (id: string) => STAGES.findIndex((s) => s.id === id);
const OLD_TREE = stageIndex('old-tree');
const GROVE = stageIndex('grove');
const ANCIENT = stageIndex('ancient-forest');
const costOf = (id: string, rank = 0) => researchCostAt(RESEARCH_BY_ID.get(id)!, rank);

function stateAt(stage: number, seed = 5): GameState {
  const state = createInitialState(Date.now(), seed);
  state.stage = stage;
  state.waypoint = STAGES[stage]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  return state;
}

/** Ein Stand, wie ihn das Spiel bis v17 gespeichert hat (ohne die v18-Felder, 28.8). */
function toV17(state: GameState): Record<string, any> {
  const raw = JSON.parse(serialize(state));
  raw.version = 17;
  delete raw.cycle.upgrades;
  delete raw.cycle.researchRanks;
  delete raw.meta.upgrades;
  delete raw.meta.stats.upgradesBought;
  delete raw.meta.stats.upgradeSeeds;
  return raw;
}

/** Ein Stand, wie ihn das Spiel bis v16 gespeichert hat: ohne Forschung und Aussaat, mit Pflege-Rängen. */
function toV16(state: GameState, care: Record<string, number>, pending: GameState['pendingEncounters'] | object[]): Record<string, any> {
  const raw = toV17(state);
  raw.version = 16;
  delete raw.harmonyPoints;
  delete raw.cycle.research;
  delete raw.cycle.sowings;
  delete raw.cycle.sowing;
  delete raw.cycle.freeSowing;
  delete raw.meta.research;
  delete raw.meta.stats.harmonyEarned;
  raw.cycle.care = care;
  raw.pendingEncounters = pending;
  return raw;
}

/** Was das Spiel aus einem Roh-Stand lädt (dieselbe Funktion wie im Browser). */
const loaded = (raw: object) => loadGame(JSON.stringify(raw), Date.now())!.state;

/**
 * Tab im Hintergrund vortäuschen (Chromium im Test bleibt sichtbar): `visibilitychange` mit
 * `hidden` speichert sofort (main.ts), `visible` rechnet die Zeit nach (catchUp).
 */
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** Speichert über „Tab verdeckt“ und liest den Stand – ohne Neuladen. */
async function hiddenSave(page: Page): Promise<Record<string, any>> {
  await setVisibility(page, 'hidden');
  return savedState(page);
}

/**
 * Testuhr angehalten: Zeit vergeht nur über `fastForward`/`runFor`, die Abwesenheit ist exakt.
 * (Mit frei laufender Testuhr sprang `Date.now()` nach `fastForward` gelegentlich zurück.)
 */
async function pausedClock(page: Page): Promise<void> {
  const start = new Date('2026-10-27T09:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
}

/** Relativer Abstand zweier Werte. */
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);

// --- Spielstand: v16 → v17 → v18, v17 → v18 ------------------------------------------------

test('v16-Stand lädt über v17 als v18: Pflege → Knoten, Startguthaben, Pflanzenbegegnung → Aussaat; Neuladen gleich', async ({ page, context }) => {
  const state = stateAt(OLD_TREE, 16);
  state.seeds = 321;
  state.niches.roots = ['earthworm'];
  state.niches.litter = ['robin'];
  state.niches.crown = ['bluetit'];
  state.meta.journal.species = ['earthworm', 'robin', 'bluetit'];
  const care = { 'leaf-litter': 1, 'nest-boxes': 1, 'deadwood-pile': 1 };
  const pending = [
    { type: 'plant', cards: ['hazel', 'fern', 'bramble'], rerolls: 1 },
    // Eine zweite Pflanzenbegegnung zieht beim Laden weiter wie Ablehnen (Samen gutgeschrieben).
    { type: 'plant', cards: ['nettle', 'strawberry', 'moss'], rerolls: 0 },
  ];
  const raw = toV16(state, care, pending);
  const expected = loaded(raw);
  // Erwartung aus core (27.9): Pflege-Ränge als Knoten, Startguthaben > 0, erste Begegnung als Aussaat.
  expect(expected.cycle.research).toEqual(expect.arrayContaining(['leaf-litter', 'nest-boxes', 'deadwood-pile']));
  expect(expected.harmonyPoints).toBeGreaterThan(0);
  expect(expected.cycle.sowing).toEqual({ cards: ['hazel', 'fern', 'bramble'], rerolls: 1 });
  expect(expected.seeds).toBeGreaterThan(321);

  await seedRaw(context, raw, 0);
  await gotoTab(page, 'nischen');
  const saved = await hiddenSave(page);
  await setVisibility(page, 'visible');
  expect(saved.version).toBe(SAVE_VERSION);
  expect(saved.cycle.care).toBeUndefined();
  expect(saved.cycle.research).toEqual(expected.cycle.research);
  expect(saved.cycle.sowing).toEqual(expected.cycle.sowing);
  expect(saved.pendingEncounters).toEqual([]);
  // Startguthaben (10 min Produktion), dazu nur der Zufluss der wenigen Sekunden.
  expect(saved.harmonyPoints).toBeGreaterThanOrEqual(expected.harmonyPoints);
  expect(saved.harmonyPoints).toBeLessThan(expected.harmonyPoints + 100);
  expect(saved.seeds).toBeGreaterThanOrEqual(expected.seeds);
  // v18-Felder beginnen bei 0.
  expect(saved.cycle.upgrades).toEqual({ niches: {}, tree: {} });
  expect(saved.meta.upgrades).toEqual({ best: { niches: {}, tree: {} } });
  expect(saved.cycle.researchRanks).toEqual({});

  // Wirkung der umgebuchten Pflege: Laubstreu mit einem Platz mehr (Alter Baum: 2 + 1).
  await expect(niche(page, 'litter')).toContainText('1/3 belegt');
  // Offene Aussaat mit genau den Karten der alten Begegnung.
  await sowNow(page);
  const plants = encounter(page).locator('[data-plant]');
  await expect(plants).toHaveCount(expected.cycle.sowing!.cards.length);
  expect(await plants.evaluateAll((els) => els.map((e) => e.getAttribute('data-plant')))).toEqual(expected.cycle.sowing!.cards);
  await page.keyboard.press('Escape');
  await expect(encounter(page)).toBeHidden();

  await openTab(page, 'forschung');
  for (const id of expected.cycle.research) await expect(researchNode(page, id)).toHaveClass(/is-researched/);

  // Neuladen: derselbe Stand (keine zweite Migration, kein zweites Startguthaben).
  await page.reload();
  await expect(stageLabel(page)).toContainText('Stufe:');
  const again = await hiddenSave(page);
  expect(again.cycle.research).toEqual(expected.cycle.research);
  expect(again.cycle.sowing).toEqual(expected.cycle.sowing);
  expect(again.harmonyPoints).toBeLessThan(expected.harmonyPoints + 200);
});

test('v17-Stand lädt als v18 ohne Verlust: Samen, Vorrat, Forschung, Plan, Aussaat; Ausbau bei 0', async ({ page, context }) => {
  const state = stateAt(GROVE, 17);
  state.seeds = 12_345;
  state.harmonyPoints = 2_345;
  state.niches.roots = ['earthworm', 'vole'];
  state.niches.litter = ['robin'];
  state.meta.journal.species = ['earthworm', 'vole', 'robin'];
  state.cycle.research = ['compost', 'leaf-litter', 'deadwood-pile', 'fungus-garden'];
  state.cycle.sowings = 3;
  state.cycle.sowing = { cards: ['hazel', 'fern', 'bramble'], rerolls: 2 };
  state.meta.research = { plan: ['leaf-litter', 'compost', 'nest-boxes'], auto: false };
  const raw = toV17(state);
  const expected = loaded(raw);
  expect(expected.version).toBe(SAVE_VERSION);

  await seedRaw(context, raw, 0);
  await gotoTab(page, 'nischen');
  const saved = await hiddenSave(page);
  await setVisibility(page, 'visible');
  expect(saved.version).toBe(SAVE_VERSION);
  expect(saved.seeds).toBeGreaterThanOrEqual(12_345);
  expect(saved.harmonyPoints).toBeGreaterThanOrEqual(2_345);
  expect(saved.cycle.research).toEqual(state.cycle.research);
  expect(saved.cycle.sowings).toBe(3);
  expect(saved.cycle.sowing).toEqual(state.cycle.sowing);
  expect(saved.meta.research).toEqual(state.meta.research);
  expect(saved.cycle.upgrades).toEqual({ niches: {}, tree: {} });
  expect(saved.meta.upgrades).toEqual({ best: { niches: {}, tree: {} } });
  expect(saved.cycle.researchRanks).toEqual({});
  expect(saved.meta.stats.upgradesBought).toBe(0);
  expect(saved.meta.stats.upgradeSeeds).toBe(0);

  // Oberfläche: Fußzeile Stufe 0 an jeder offenen Nische, Gabel Boden bleibt entschieden.
  await expect(niche(page, 'roots').locator('[data-ref="niche-upgrade"] .upgrade-level-text')).toHaveText('St. 0');
  await openTab(page, 'forschung');
  await expect(researchNode(page, 'fungus-garden')).toHaveClass(/is-researched/);
  await expect(researchNode(page, 'beetle-castle')).toHaveClass(/is-excluded/);
});

// --- Offline: Uhr vorstellen, Tab im Hintergrund ------------------------------------------

/** Hain mit Tieren, Frühling kurz vor dem Sommer (cycle.elapsed = 100 s von 180 s). */
function offlineState(): GameState {
  const state = stateAt(GROVE, 99);
  state.seeds = 500;
  state.niches.roots = ['earthworm', 'vole'];
  state.niches.litter = ['robin'];
  state.meta.journal.species = ['earthworm', 'vole', 'robin'];
  state.cycle.elapsed = 100;
  return state;
}

test('Tab 30 s im Hintergrund: volle Erträge wie online, kein Rückkehr-Bericht mit Zehntel', async ({ page, context }) => {
  await pausedClock(page);
  await seedRaw(context, offlineState(), 0);
  await gotoTab(page, 'nischen');
  const before = await hiddenSave(page);
  await page.clock.fastForward(30_000);
  await setVisibility(page, 'visible');
  await expect(stageLabel(page)).toContainText('Stufe:');
  const after = await hiddenSave(page);
  await setVisibility(page, 'visible');

  const away = (after.lastTick - before.lastTick) / 1000;
  expect(away).toBeGreaterThanOrEqual(30);
  expect(away).toBeLessThan(40);
  // Erwartung: dieselbe Zeit online gespielt (ein Tick, f = 1).
  const online = loaded(before);
  tick(online, away);
  const gained = after.totalGrowth - before.totalGrowth;
  expect(gained).toBeGreaterThan(0);
  expect(rel(gained, online.totalGrowth - before.totalGrowth)).toBeLessThan(0.02);
  expect(rel(after.seeds - before.seeds, online.seeds - before.seeds)).toBeLessThan(0.02);
  expect(after.cycle.elapsed - before.cycle.elapsed).toBeCloseTo(away, 0);
  await expect(page.locator('[data-ref="return-report"]')).toBeHidden();
});

test('Uhr 2 h vorstellen: Rückkehr-Bericht mit „Zehntel“, Erträge wie simulateOffline, Jahreszeit weiter', async ({ page, context }) => {
  await pausedClock(page);
  await seedRaw(context, offlineState(), 0);
  await gotoTab(page, 'nischen');
  const season = page.locator('[data-ref="season"]');
  await expect(season).toHaveAttribute('data-season', 'spring');
  const before = await hiddenSave(page);
  await setVisibility(page, 'visible');
  // 2 h sind genau zehn Spieljahre (4 × 180 s) – 90 s mehr, damit die Jahreszeit sichtbar wechselt.
  await page.clock.fastForward(2 * 3600_000 + 90_000);

  const list = page.locator('[data-ref="return-report-list"]');
  await expect(page.locator('[data-ref="return-report"]')).toBeVisible();
  await expect(page.locator('[data-ref="return-report-summary"]')).toContainText('gemächlich (10 %)');
  await page.locator('[data-ref="return-report-details"]').click();
  await expect(list).toContainText('mit einem Zehntel der Kraft');
  await expect(list).toContainText(/In 2 Std\./);

  const after = await hiddenSave(page);
  const away = (after.lastTick - before.lastTick) / 1000;
  expect(away).toBeGreaterThanOrEqual(7290);
  expect(away).toBeLessThan(7300);
  // Die Zeit läuft voll weiter (Jahreszeit, Spielzeit) – nur die Erträge sind ein Zehntel.
  expect(after.cycle.elapsed - before.cycle.elapsed).toBeCloseTo(away, 0);
  const expectedSeason = seasonIdAt(after.cycle.elapsed);
  expect(expectedSeason).toBe('summer');
  await expect(season).toHaveAttribute('data-season', expectedSeason);
  await expect(season).toContainText(SEASONS_BY_ID.get(expectedSeason)!.name);

  const offline = loaded(before);
  simulateOffline(offline, away);
  const full = loaded(before);
  tick(full, away);
  const gained = after.totalGrowth - before.totalGrowth;
  expect(rel(gained, offline.totalGrowth - before.totalGrowth)).toBeLessThan(0.02);
  // Deutlich weniger als online (60 s voll + Rest × 0,1 ≈ 11 %).
  expect(gained).toBeLessThan(0.2 * (full.totalGrowth - before.totalGrowth));
});

// --- Forschung: Gabel und endloser Knoten -------------------------------------------------

test('Gabel wählen: andere Seite gesperrt, endloser Knoten frei, Rang kaufen – nach dem Neuladen gleich', async ({ page, context }) => {
  const state = stateAt(GROVE, 31);
  state.niches.roots = ['earthworm'];
  state.meta.journal.species = ['earthworm'];
  state.cycle.research = ['compost', 'leaf-litter', 'deadwood-pile'];
  // Genug für die Käferburg und Rang 1 des Bodenlebens, nicht für Rang 2.
  state.harmonyPoints = costOf('beetle-castle') + costOf('soil-life', 0) + 50;
  await seedRaw(context, state, 0);
  await gotoTab(page, 'forschung');

  const fork = page.locator('[data-ref="care"] .research-fork[data-fork="soil"]');
  await expect(fork.locator('.research-fork-hint')).toHaveText(/^Gabel: /);
  await expect(researchAction(page, 'fungus-garden')).toHaveAttribute('aria-disabled', 'false');
  // Der endlose Knoten hängt an der Gabel (requiresAny): vorher gesperrt.
  await expect(researchAction(page, 'soil-life')).toHaveAttribute('aria-disabled', 'true');

  await researchAction(page, 'beetle-castle').click();
  await expect(researchNode(page, 'beetle-castle')).toHaveClass(/is-researched/);
  const other = researchAction(page, 'fungus-garden');
  await expect(researchNode(page, 'fungus-garden')).toHaveClass(/is-excluded/);
  await expect(other).toHaveText('anderer Weg gewählt');
  await expect(other).toHaveAttribute('aria-disabled', 'true');
  await expect(other).toHaveAccessibleName(/Ausgeschlossen: An dieser Gabel ist Käferburg gewählt\./);
  await expect(fork.locator('.research-fork-hint')).toHaveText('Gabel entschieden: Käferburg.');
  await other.click({ force: true });

  // Rang 1 des Bodenlebens.
  const soil = researchAction(page, 'soil-life');
  await expect(soil).toHaveAttribute('aria-disabled', 'false');
  await soil.click();
  await expect(researchNode(page, 'soil-life').locator('.research-node-stamp')).toHaveText('Rang 1');
  await expect(soil).toHaveText(new RegExp(`^Noch [\\d.]+\\s⚖️`));
  await expect.poll(async () => (await savedState(page)).cycle.researchRanks).toEqual({ 'soil-life': 1 });
  const saved = await savedState(page);
  expect(saved.cycle.research).toEqual(['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle', 'soil-life']);

  await page.reload();
  await expect(stageLabel(page)).toContainText('Stufe:');
  await expect(researchNode(page, 'beetle-castle')).toHaveClass(/is-researched/);
  await expect(researchNode(page, 'fungus-garden')).toHaveClass(/is-excluded/);
  await expect(researchNode(page, 'soil-life').locator('.research-node-stamp')).toHaveText('Rang 1');
  expect((await savedState(page)).cycle.research).not.toContain('fungus-garden');
});

// --- Neuer Zyklus --------------------------------------------------------------------------

test('Neuer Zyklus: Ausbau, Ränge und Vorrat zurück, Abzeichen bleiben, der Plan folgt', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-27T09:00:00Z') });
  const state = stateAt(GROVE, 42);
  state.seeds = 5_000;
  state.harmonyPoints = 3_000;
  state.meta.forestMemory = 60;
  Object.assign(state.niches, { roots: ['earthworm', 'vole'], litter: ['robin'], edge: ['bee'], crown: ['bluetit'] });
  state.meta.journal.species = ['earthworm', 'vole', 'robin', 'bee', 'bluetit'];
  state.cycle.upgrades.niches.roots = 25;
  state.cycle.upgrades.tree.rings = 10;
  state.meta.upgrades.best.niches.roots = 25;
  state.meta.upgrades.best.tree.rings = 10;
  state.cycle.research = ['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle', 'soil-life'];
  state.cycle.researchRanks = { 'soil-life': 1 };
  state.meta.research = { plan: [], auto: true };
  await seedRaw(context, state, 0);
  await gotoTab(page, 'nischen');
  await expect(niche(page, 'roots').locator('[data-ref="upgrade-badge"]')).toHaveText('⭑ Bronze');

  const cycle = await openGoalsPage(page, 'cycle');
  const button = cycle.locator('[data-ref="new-cycle"]');
  await button.click();
  await waitForConfirm(page, { clock: true });
  await button.click();
  await expect(stamps(page)).toContainText('Zyklus 2 beginnt');

  const after = await savedState(page);
  expect(after.cycle.number).toBe(2);
  expect(after.stage).toBe(0);
  expect(after.cycle.upgrades).toEqual({ niches: {}, tree: {} });
  expect(after.cycle.researchRanks).toEqual({});
  expect(after.cycle.research).toEqual([]);
  expect(after.harmonyPoints).toBeLessThan(10);
  expect(after.seeds).toBeLessThan(10);
  // Bleibt: Bestmarke (Abzeichen), Erfolg „Gut bewohnt“, Plan mit dem Rang, Schalter an.
  expect(after.meta.upgrades.best.niches.roots).toBe(25);
  expect(after.meta.upgrades.best.tree.rings).toBe(10);
  expect(after.meta.achievements).toContain('upgrade-25');
  expect(after.meta.research).toEqual({ plan: state.cycle.research, auto: true });

  await openTab(page, 'nischen');
  await expect(niche(page, 'roots').locator('[data-ref="upgrade-badge"]')).toHaveText('⭑ Bronze');
  await expect(tabPanel(page, 'nischen').locator('[data-ref="tree-upgrades"] [data-part="rings"] .upgrade-level-text')).toHaveText('St. 0');

  await openTab(page, 'forschung');
  const plan = page.locator('[data-ref="research-plan"]');
  await expect(plan.getByRole('switch', { name: 'Plan des letzten Zyklus folgen' })).toBeChecked();
  await expect(researchNode(page, 'compost').locator('.research-node-plan')).toHaveText('1');
  await expect(researchNode(page, 'leaf-litter').locator('.research-node-plan')).toHaveText('2');

  // Der Plan kauft, sobald Stufe und Vorrat reichen – Zeit nur über die Testuhr.
  await expect
    .poll(
      async () => {
        await page.clock.fastForward(10_000);
        return (await savedState(page)).cycle.research?.[0] ?? null;
      },
      { timeout: 60_000, intervals: [0] },
    )
    .toBe('compost');
  await expect(researchNode(page, 'compost')).toHaveClass(/is-researched/);
});

// --- Große Zahlen auf dem Handy -----------------------------------------------------------

const BIG_LEVEL = 150;

/** Urwald, alles ausgebaut und erforscht, hohe Ränge, lange Pläne – die breitesten Texte. */
function bigState(): GameState {
  const state = stateAt(ANCIENT, 4242);
  state.harmonyPoints = 9.8e6;
  state.cycle.number = 7;
  state.meta.forestMemory = 300;
  Object.assign(state.niches, {
    roots: ['earthworm', 'vole'],
    litter: ['robin', 'woodlouse'],
    edge: ['bee', 'fox'],
    crown: ['bluetit'],
    hollows: ['owl'],
  });
  state.meta.journal.species = ['earthworm', 'vole', 'robin', 'woodlouse', 'bee', 'fox', 'bluetit', 'owl'];
  // Stufe 150: Preise in Milliarden/Billionen; der Vorrat reicht für einige Stufen (Max).
  for (const id of NICHE_IDS) {
    state.cycle.upgrades.niches[id] = BIG_LEVEL;
    state.meta.upgrades.best.niches[id] = BIG_LEVEL + 12;
  }
  for (const id of TREE_PART_IDS) {
    state.cycle.upgrades.tree[id] = BIG_LEVEL;
    state.meta.upgrades.best.tree[id] = BIG_LEVEL;
  }
  state.seeds = upgradeCostFrom(upgradeBase({ kind: 'tree', id: 'rings' })!, BIG_LEVEL, 5) + 1;
  // Je Gabel der erste Weg, jeder endlose Knoten mit Rang 150.
  const research: string[] = [];
  const ranks: Record<string, number> = {};
  for (const node of RESEARCH) {
    if (researchExcluded(node, research) || !researchRequirementsMet(node, research)) continue;
    if (node.repeatable) {
      ranks[node.id] = 150;
      for (let r = 0; r < 150; r++) research.push(node.id);
    } else research.push(node.id);
  }
  state.cycle.research = research;
  state.cycle.researchRanks = ranks;
  state.meta.research = { plan: [...research, ...research.filter((id) => RESEARCH_BY_ID.get(id)!.repeatable)], auto: false };
  return state;
}

for (const width of [360, 390]) {
  test(`${width} px: R:Nischen und R:Forschung mit großen Zahlen ohne Querscrollen`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await seedRaw(context, bigState(), 0);
    await gotoTab(page, 'nischen');
    const wide = (selector: string) =>
      page.evaluate((sel) => {
        const doc = document.documentElement;
        const out = [...document.querySelectorAll<HTMLElement>(`${sel} *`)]
          // Gattungen scrollen bewusst waagerecht in ihrer eigenen Reihe (ALBUM_UI.md B.1).
          .filter((e) => !e.closest('.family-row'))
          .filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > doc.clientWidth + 0.5)
          .map((e) => `${e.tagName.toLowerCase()}.${e.className}`);
        return { scroll: doc.scrollWidth - doc.clientWidth, wide: out };
      }, selector);

    // Nischen: Kaufmenge Max mit riesigem Vorrat – die längsten Knopf-Texte.
    const panel = tabPanel(page, 'nischen');
    await panel.locator('[data-ref="buy-amount"] [data-amount="max"]').click();
    await expect(panel.locator('[data-ref="tree-upgrades"] [data-part="rings"] .upgrade-level-text')).toHaveText(`St. ${BIG_LEVEL}`);
    await expect(panel.locator('[data-ref="tree-upgrades"] [data-part="rings"] [data-ref="upgrade-buy"]')).toHaveText(/^\+\d+ · Max/);
    await expect(niche(page, 'roots').locator('[data-ref="upgrade-badge"]')).toBeVisible();
    expect(await wide('[data-ref="page-niches"]')).toEqual({ scroll: 0, wide: [] });
    await info.attach(`gross-${width}-nischen.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    // Forschung: alle Äste aufgeklappt, Ränge 150 („unerreichbar“ bzw. Kosten in Mio.).
    await openTab(page, 'forschung');
    for (const branch of ['soil', 'water', 'crown', 'hem', 'open', 'seed']) await openBranch(page, branch);
    await expect(researchNode(page, 'soil-life').locator('.research-node-stamp')).toHaveText('Rang 150');
    expect(await wide('[data-ref="page-care"]')).toEqual({ scroll: 0, wide: [] });
    await info.attach(`gross-${width}-forschung.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}
