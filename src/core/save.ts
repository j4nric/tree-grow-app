import { ACHIEVEMENTS_BY_ID } from '../content/achievements';
import { CHAPTER_IDS, type ChapterId } from '../content/chronicle';
import { COMMUNITIES_BY_ID } from '../content/communities';
import { DAILY_GOALS_BY_KIND, DAILY_GOAL_COUNT, type DailyGoalKind } from '../content/daily';
import { CARDS_PER_ENCOUNTER, MAX_PENDING_ENCOUNTERS } from '../content/encounters';
import { EVENTS, EVENTS_BY_ID, type CycleEffect, type TimedEffect } from '../content/events';
import { CORRIDORS_BY_ID, HOME_SITE, LANDSCAPE_UNLOCK_ACHIEVEMENT, MAX_SITE_FAUNA, SITE_IDS, type SiteId } from '../content/landscape';
import { V1_KEEPSAKE_ID, V1_KEEPSAKE_MEMORY, V1_KEEPSAKE_MIN_ENERGY, V1_KEEPSAKE_MIN_STAGE, NEW_CYCLE_MIN_STAGE } from '../content/memory';
import { PLANTS_BY_ID } from '../content/plants';
import { CARE_TO_RESEARCH, MAX_RESEARCH_RANK, MIGRATION_HARMONY_MINUTES, RESEARCH, RESEARCH_BY_ID, RESEARCH_REPEATABLE } from '../content/research';
import { TREE_PART_IDS } from '../content/upgrades';
import { MAX_SOWINGS, MAX_SOWING_CARDS } from '../content/sowing';
import { SPECIES_BY_ID } from '../content/species';
import { SEASON_IDS, type SeasonId } from '../content/seasons';
import { GENERA, NICHE_IDS, type Genus, type Tag } from '../content/types';
import { VISITORS_BY_ID } from '../content/visitors';
import { WAYPOINT_COUNT } from '../content/waypoints';
import { DEFAULT_MAIN_TREE, MAIN_TREES_BY_ID, type MainTreeId } from '../content/trees';
import {
  evaluate,
  harmonyMemoryGain,
  declineReward,
  nicheSlots,
  plantSlots,
  regularSlots,
  regularSlotsOf,
  researchSowing,
  slotBonuses,
  sowingCardCount,
  slotEffects,
  stageForWaypoint,
  thresholdFor,
  waypointsForGrowth,
} from './formulas';
import { checkAchievements } from './achievements';
import {
  effectiveMemoryOf,
  isSiteAncient,
  jaySeeds,
  jaySeedsSpent,
  kennartOf,
  landscapeUnlocked,
  ownMemory,
  siteEntry,
  wildwechselRoute,
} from './landscape';
import { isDayKey } from './daily';
import { isValidRngState, normalizeSeed } from './rng';
import { normalizeElapsed } from './season';
import { normalizeUpgradeLevel, upgradeLevel } from './upgrades';
import {
  MAX_STAT_COUNT,
  interludeThreshold,
  isTreeUnlocked,
  recordDiscoveries,
  researchExcluded,
  researchRequirementsMet,
} from './tick';
import {
  MAX_FOREST_MEMORY,
  MAX_HARMONY_POINTS,
  SAVE_VERSION,
  createCycle,
  createDaily,
  createFirstSeen,
  createInitialState,
  createLandscape,
  createResearchPlan,
  createSite,
  createStats,
  createUpgradeLevels,
  dailySeedOf,
  type ChronicleEntry,
  type CycleBonus,
  type CycleState,
  type DailyGoal,
  type DailyState,
  type FirstSeen,
  type FirstSeenJournal,
  type GameState,
  type LandscapeSite,
  type LandscapeState,
  type LifetimeStats,
  type PendingEncounter,
  type ResearchPlan,
  type SowingState,
  type TimedBonus,
  type UpgradeLevels,
} from './state';

export const SAVE_KEY = 'tree-grow-save';
/** Obergrenzen beim Laden: Andenken (Anzahl, Länge der ID) und Neuwürfe je Begegnung. */
export const MAX_KEEPSAKES = 100;
export const MAX_KEEPSAKE_ID_LENGTH = 64;
export const MAX_REROLLS = 1000;

/** Obergrenze für die Zyklus-Nummer beim Laden (Schutz vor kaputten Ständen). */
export const MAX_CYCLE_NUMBER = 1e9;

/**
 * v2 → v3: Prototyp-Stände (ohne Pflanzen) hatten keine Samen-Senke und bringen oft
 * Tausende 🌰 mit. Beim Laden wird der Bestand auf die Kosten der ersten zwei Pflanzen
 * begrenzt (20 + 38 = 58 🌰, „Pflanze setzen“ 20 · 1,9^n bis Phase 10), damit niemand mit einem
 * Schlag den Pflanzring füllt (Empfehlung DESIGN_V2.md 15.4). Seit Phase 10 eine feste Zahl.
 */
export const V2_SEED_CAP = 58;

/** Ergebnis des Ladens: der Spielstand und ob er aus einem v1-Stand neu angelegt wurde. */
export interface LoadResult {
  state: GameState;
  /** Der gespeicherte Stand war v1 (Wasser/Licht/Energie) und wurde durch einen Neustart ersetzt. */
  migratedFromV1: boolean;
  /** Andenken „Die alte Eiche“ (+5 Waldgedächtnis) wurde vergeben. */
  keepsake: boolean;
  /**
   * Der Stand kam aus v2–v6 und hat Waldgedächtnis oder Andenken: Seit v7 (Balancing 2.10)
   * bringt jeder Punkt +1 % statt +2 % – die Punkte selbst bleiben (bewusste Entscheidung,
   * DESIGN_V2.md 15.4). Nur ein Hinweis für die Oberfläche, nicht Teil des Spielstands.
   */
  memoryReweighted: boolean;
  /**
   * Migration v8 → v9: so viele Erfolge hat der Stand schon erfüllt und still nachgetragen
   * bekommen (die Oberfläche meldet sie gesammelt, nicht einzeln). Sonst 0.
   */
  achievementsBackfilled: number;
  /**
   * Migration v13 → v14: Der Stand erfüllt schon die Freischaltung der Waldlandschaft (Urwald-
   * Erfolg und ≥ 250 Gedächtnis) – die Oberfläche zeigt die Meldung 24.3 einmal. Sonst false.
   */
  landscapeUnlocked: boolean;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Liest einen gespeicherten Stand. Unbekannte oder kaputte Felder werden durch
 * Startwerte ersetzt, damit ein alter Spielstand das Spiel nie zum Absturz bringt.
 * Gibt null zurück, wenn gar nichts Brauchbares vorliegt.
 */
export function loadGame(raw: string | null, now: number): LoadResult | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  const version = typeof data.version === 'number' && Number.isFinite(data.version) ? data.version : 1;
  if (version < 2) return migrateV1(data, now);
  const deferred: DeferredPlants = { encounters: [], forced: null };
  const state = loadV2(data, now, version, deferred);
  if (version < 3) migrateV2(state);
  if (version < 4) migrateV3(state);
  if (version < 5) migrateV4(state);
  if (version < 6) migrateV5(state);
  if (version < 8) migrateV7(state);
  if (version < 10) migrateV9(state);
  if (version < 11) migrateV10(state);
  if (version < 13) migrateV12(state);
  // v6 → v7 (Balancing 2.10): nur die Wegpunkt-Kurve – schon in loadV2 umgerechnet
  // (v6GrowthToV7), bevor Wegpunkt, Stufe und Zwischenhalt abgeleitet werden.
  // Erst nach der Migration: sie verwirft z. B. Pflanzen, die v2 nicht kannte. Führt
  // auch H_max nach (die aktuelle Harmonie zählt schon für diesen Zyklus). Was es dabei ins
  // Tagebuch nachträgt, war schon früher entdeckt: kein erfundenes „Zuerst gesehen“.
  const firstSeen = structuredClone(state.meta.journal.firstSeen);
  recordDiscoveries(state);
  state.meta.journal.firstSeen = firstSeen;
  // v6 → v7: Waldgedächtnis +1 % statt +2 % je Punkt, Punkte unverändert → einmal Hinweis.
  const memoryReweighted = version < 7 && (state.meta.forestMemory > 0 || state.meta.journal.keepsakes.length > 0);
  // v8 → v9 (Erfolge): ganz zuletzt, wenn Tagebuch, Statistik und H_max feststehen.
  const achievementsBackfilled = version < 9 ? migrateV8(state) : 0;
  // v13 → v14 (Waldlandschaft): nach den Erfolgen (der Urwald-Erfolg setzt `ancient`).
  const landscapeUnlockedNow = version < 14 ? migrateV13(state) : false;
  // v14 → v15 (Hauptbäume der Landschaft, Wildwechsel-Markierung): nur der neue Zähler.
  if (version < 15) migrateV14(state);
  // v15 → v16 (Waldchronik) und robustes Laden ab v16: ganz zuletzt, wenn Landschaft (`ancient`
  // auch aus migrateV13), Gedächtnis, Tagebuch und Zyklus-Nummer feststehen.
  loadChronicles(isRecord(data.meta) ? data.meta.landscape : undefined, state, version);
  // v16 → v17 (Forschung, 27.9): Startguthaben aus der Harmonie des fertig geladenen Stands.
  if (version < 17) migrateV16(state);
  // „Etwas keimt“ → Aussaat (27.9 Schritt 4; v16-Migration und robustes Laden ab v17 gleich):
  // ganz zuletzt, denn das Zurücklegen weiterer Pflanzenbegegnungen zahlt Samen-Sekunden zur
  // Rate des fertig geladenen Stands.
  convertPlantEncounters(state, deferred);
  // v17 → v18 (Ausbau, 28.8): nichts umzubuchen – Stufen, Ränge, Bestmarke und Statistik beginnen
  // bei 0 (loadCycleExtras, loadV2, loadStats); Samen, Forschung und Plan bleiben, wie sie sind.
  return { state, migratedFromV1: false, keepsake: false, memoryReweighted, achievementsBackfilled, landscapeUnlocked: landscapeUnlockedNow };
}

/** Wie loadGame, aber nur der Spielstand. */
export function deserialize(raw: string | null, now: number): GameState | null {
  return loadGame(raw, now)?.state ?? null;
}

/**
 * v1 → v2: sauberer Neustart (Wasser/Licht/Energie/Upgrades haben keine Entsprechung).
 * Wer in v1 mindestens „Junger Baum“ erreicht hat, bekommt das Andenken „Die alte
 * Eiche“: +5 Waldgedächtnis. Keine Offline-Zeit – die Uhr startet jetzt.
 */
function migrateV1(data: Record<string, unknown>, now: number): LoadResult {
  const oldLastTick = finiteOr(data.lastTick, now);
  const state = createInitialState(now, now + oldLastTick);
  const keepsake =
    finiteOr(data.stage, 0) >= V1_KEEPSAKE_MIN_STAGE || finiteOr(data.totalEnergy, 0) >= V1_KEEPSAKE_MIN_ENERGY;
  if (keepsake) {
    state.meta.forestMemory += V1_KEEPSAKE_MEMORY;
    state.meta.journal.keepsakes.push(V1_KEEPSAKE_ID);
  }
  return { state, migratedFromV1: true, keepsake, memoryReweighted: false, achievementsBackfilled: 0, landscapeUnlocked: false };
}

/** Wegpunkt-Kurve der v2-Stände (Prototyp ohne Pflanzen): Wegpunkt k bei 4 · k^3,2. */
export const V2_WAYPOINT_BASE = 4;
export const V2_WAYPOINT_POWER = 3.2;

function v2Threshold(k: number): number {
  return k <= 0 ? 0 : Math.round(V2_WAYPOINT_BASE * Math.pow(k, V2_WAYPOINT_POWER));
}

/** Erreichte Wegpunkte auf einer (früheren) Kurve. */
function waypointsOnCurve(growth: number, threshold: (k: number) => number): number {
  let k = 0;
  while (k < WAYPOINT_COUNT && growth >= threshold(k + 1)) k++;
  return k;
}

/**
 * Bildet Gesamt-Wachstum von einer früheren Wegpunkt-Kurve auf dieselbe Stelle der
 * aktuellen Kurve ab: gleicher Wegpunkt, gleicher Bruchteil bis zum nächsten. So bleibt
 * die Stufe erhalten (kein Zurückstufen, keine entlassenen Tiere, keine doppelten
 * Wegpunkte). Hinter dem letzten Wegpunkt wird im Verhältnis der beiden Kurven skaliert.
 * Exportiert für Tests.
 */
export function growthToCurrentCurve(growth: number, threshold: (k: number) => number): number {
  if (!(growth > 0)) return 0;
  const k = waypointsOnCurve(growth, threshold);
  if (k >= WAYPOINT_COUNT) {
    const scaled = thresholdFor(WAYPOINT_COUNT) * (growth / threshold(WAYPOINT_COUNT));
    return Math.min(Number.MAX_VALUE, scaled);
  }
  const from = threshold(k);
  const to = threshold(k + 1);
  const fraction = Math.min(1, Math.max(0, (growth - from) / (to - from)));
  const newFrom = thresholdFor(k);
  const newTo = thresholdFor(k + 1);
  const result = newFrom + fraction * (newTo - newFrom);
  // Rundung darf nie unter den erreichten Wegpunkt fallen – und nie den nächsten erreichen
  // (ein Bruchteil knapp unter 1 kann im Gleitkomma auf genau newTo runden).
  return Math.max(newFrom, Math.min(result, below(newTo)));
}

/** Die größte Gleitkommazahl unter x (x > 0, endlich). */
function below(x: number): number {
  const y = x - x * Number.EPSILON;
  return y < x ? y : x - Number.MIN_VALUE;
}

/**
 * Umkehrung von growthToCurrentCurve: Gesamt-Wachstum der aktuellen Kurve → dieselbe Stelle
 * (Wegpunkt und Bruchteil bis zum nächsten) auf einer früheren Kurve.
 */
function growthFromCurrentCurve(growth: number, threshold: (k: number) => number): number {
  if (!(growth > 0)) return 0;
  const k = waypointsForGrowth(growth);
  if (k >= WAYPOINT_COUNT) return threshold(WAYPOINT_COUNT) * (growth / thresholdFor(WAYPOINT_COUNT));
  const share = (growth - thresholdFor(k)) / (thresholdFor(k + 1) - thresholdFor(k));
  return threshold(k) + share * (threshold(k + 1) - threshold(k));
}

/** v2-Stand (4 · k^3,2) → aktuelle Kurve (siehe growthToCurrentCurve). */
export function v2GrowthToCurrent(growth: number): number {
  return growthToCurrentCurve(growth, v2Threshold);
}

/**
 * Wegpunkt-Kurve der Stände v3 bis v6 (Schritt 2.1 bis Jahreszeiten): Wegpunkt k bei
 * 3,5 · k^3,4. Seit v7 (Balancing 2.10) gilt 3,5 · k^3,5 (content/waypoints.ts).
 */
export const V6_WAYPOINT_BASE = 3.5;
export const V6_WAYPOINT_POWER = 3.4;

/** Gesamt-Wachstum für Wegpunkt k auf der Kurve der Stände v3–v6. */
export function v6Threshold(k: number): number {
  return k <= 0 ? 0 : Math.round(V6_WAYPOINT_BASE * Math.pow(k, V6_WAYPOINT_POWER));
}

/**
 * v3–v6-Stand (3,5 · k^3,4) → aktuelle Kurve: gleicher Wegpunkt, gleicher Bruchteil bis
 * zum nächsten (siehe growthToCurrentCurve) – Stufe, Tiere und Zwischenhalt bleiben.
 */
export function v6GrowthToV7(growth: number): number {
  return growthToCurrentCurve(growth, v6Threshold);
}

/**
 * Umkehrung von v6GrowthToV7: aktuelle Kurve → Kurve der Stände v3–v6. Für Tests und
 * e2e-Fixtures (ein v3-Stand mit `v7GrowthToV6(g)` lädt bei g).
 */
export function v7GrowthToV6(growth: number): number {
  return growthFromCurrentCurve(growth, v6Threshold);
}

/** v2 → v3: noch keine Pflanzen; Samen-Bestand begrenzen (siehe V2_SEED_CAP). */
function migrateV2(state: GameState): void {
  state.plants = [];
  state.seeds = Math.min(state.seeds, V2_SEED_CAP);
}

/**
 * v3 → v4 (Neuer Zyklus): Vor v4 gab es keinen Zyklusstart, also läuft noch der erste
 * Zyklus – alle Arten im Tagebuch wurden in ihm entdeckt und zählen fürs Waldgedächtnis.
 * H_max ergänzt loadGame aus dem aktuellen Ökosystem; Stammgäste gibt es noch keine.
 */
function migrateV3(state: GameState): void {
  // Nur die v4-Felder setzen: Was das Laden schon ergänzt hat (z. B. wartende Ereignisse
  // in `seen`), bleibt erhalten.
  state.cycle.number = 1;
  state.cycle.maxHarmony = 0;
  state.cycle.newSpecies = [...state.meta.journal.species];
  state.meta.regulars = [];
}

/**
 * v4 → v5 (Ereignisse und Durchreisende): Die neuen Zyklusfelder starten leer (das
 * Laden setzt sie so). Liegt der Stand schon hinter dem Zwischenhalt des laufenden
 * Abschnitts, gilt er als ausgewertet – sonst käme direkt nach dem Update ein Ereignis.
 */
function migrateV4(state: GameState): void {
  state.cycle.interlude = 0;
  if (state.totalGrowth >= interludeThreshold(state)) state.cycle.interlude = state.waypoint;
}

/**
 * v5 → v6 (Jahreszeiten und Hauptbaum-Arten, DESIGN_V2.md 16.6, 17.5): Der laufende
 * Zyklus beginnt im Frühling (`elapsed = 0` – harmlos, nichts geht verloren) und wächst
 * als Stieleiche weiter, wie bisher. Plätze der Eiche (+1 Krone ab Junger Baum) kommen
 * dazu, gekürzt wird nichts.
 */
function migrateV5(state: GameState): void {
  state.cycle.elapsed = 0;
  state.cycle.mainTree = DEFAULT_MAIN_TREE;
}

/**
 * v7 → v8 (Langzeit-Statistik `meta.stats`, DESIGN_V2.md 12.5): Frühere Zyklen sind nicht
 * bekannt – die Statistik beginnt beim laufenden Zyklus: Spielzeit = `cycle.elapsed`,
 * Wachstum abgeschlossener Zyklen = 0 (Gesamt-Wachstum also `totalGrowth`), beste
 * Harmonie = H_max, alle Zähler 0. Gewachsen ist die aktuelle Baumart; ab Zyklus 2 auch
 * die Stieleiche, denn jeder erste Zyklus beginnt mit ihr (DEFAULT_MAIN_TREE, zuerst).
 * Was ein älterer Stand unter `meta.stats` mitbringt, zählt nicht. Läuft nach den älteren
 * Migrationen (Spielzeit und Baumart stehen dann fest).
 */
function migrateV7(state: GameState): void {
  const grownTrees = unique(
    state.cycle.number > 1 ? [DEFAULT_MAIN_TREE, state.cycle.mainTree] : [state.cycle.mainTree],
  ) as MainTreeId[];
  state.meta.stats = {
    ...createStats(state.cycle.mainTree),
    playSeconds: state.cycle.elapsed,
    bestHarmony: state.cycle.maxHarmony,
    grownTrees,
  };
}

/**
 * v9 → v10 (Sperrklinke der Vorschau, DESIGN_V2.md 10): Der beste Harmonie-Anteil des
 * Gedächtnis-Gewinns startet bei der aktuellen Vorschau (H_max und Wegpunkt des Stands).
 * Frühere, höhere Vorschauen dieses Zyklus sind nicht bekannt – niemand bekommt weniger als
 * vorher. loadGame führt ihn danach mit H_max nach (recordDiscoveries).
 */
function migrateV9(state: GameState): void {
  state.cycle.bestHarmonyMemory = Math.min(MAX_FOREST_MEMORY, harmonyMemoryGain(state.cycle.maxHarmony, state.waypoint));
}

/**
 * v10 → v11 (Erweiterung Amphibien, DESIGN_V2.md 5.5): neue Nische `niches.pond` – das
 * Laden legt sie für ältere Stände leer an (wie jede fehlende Nische). Wer im laufenden
 * Zyklus beim „Regenreichen Frühling“ den Waldtümpel entstehen ließ, bekam damals nur
 * Feuchte und +3 💧; die Option öffnet seit v11 zusätzlich einen Tümpelplatz. Der Platz
 * wird nachgetragen, damit Stand und Anzeige der Option übereinstimmen. Die Pflege
 * „Waldtümpel“ braucht nichts: Ihre Plätze folgen aus dem gekauften Rang.
 */
function migrateV10(state: GameState): void {
  const bonuses = state.cycle.bonuses;
  const fromRain = bonuses.filter((b) => b.source === 'rain');
  const choseRain = fromRain.some((b) => b.effect.kind === 'water');
  if (choseRain && !fromRain.some((b) => b.effect.kind === 'slot')) {
    bonuses.push({ source: 'rain', effect: { kind: 'slot', niche: 'pond', amount: 1 } });
  }
}

/** Ereignis „Käferjahr“ (Massenjahr, DESIGN_V2.md 22.5) – für migrateV12. */
const BEETLE_YEAR = 'beetle-year';

/**
 * v12 → v13 (Lebensräume, DESIGN_V2.md 23.6): neue Nischen `meadow`, `deadwood`, `wall` –
 * das Laden legt sie leer an (wie jede fehlende Nische). Wer im laufenden Zyklus den
 * Totholzhaufen gekauft hat, bekommt seine Plätze ohne Zutun: Sie folgen aus dem Rang (dass
 * er 3.500 statt 4.500 🌰 bezahlt hat, bleibt ein kleines Geschenk). Wie bei v11 (Regenreicher
 * Frühling) bekommt das Käferjahr seinen neuen Platz nachgetragen, wenn „Das Holz vermodern
 * lassen“ gewählt war – erkennbar am Totholz, das kein anderes gezogenes Ereignis vergibt.
 */
function migrateV12(state: GameState): void {
  const cycle = state.cycle;
  if (!cycle.seen.includes(BEETLE_YEAR) || cycle.bonuses.some((b) => b.source === BEETLE_YEAR)) return;
  if (state.pendingEncounters.some((e) => e.type === 'event' && e.cards[0] === BEETLE_YEAR)) return;
  // Totholz, das andere gezogene Ereignisse höchstens vergeben haben (je Ereignis die beste Option).
  const deadwoodOf = (id: string) =>
    Math.max(0, ...(EVENTS_BY_ID.get(id)?.options ?? []).map((o) => o.effects.filter((e) => e.kind === 'habitat' && e.tag === 'totholz').length));
  const fromOthers = cycle.seen.filter((id) => id !== BEETLE_YEAR).reduce((sum, id) => sum + deadwoodOf(id), 0);
  if (cycle.habitats.filter((t) => t === 'totholz').length <= fromOthers) return;
  const slot = eventEffects(BEETLE_YEAR, 'cycle').find((e) => e.effect.kind === 'slot');
  if (slot) cycle.bonuses.push({ source: BEETLE_YEAR, effect: slot.effect });
}

/**
 * v13 → v14 (Waldlandschaft, DESIGN_V2.md 24.8): Das bisherige Spiel ist der Heimatwald –
 * aktiv, Gedächtnis und Stammgäste bleiben, wo sie sind (`meta.forestMemory`,
 * `meta.regulars`). `ancient`, wenn der Erfolg „Uralt und voller Leben“ vorhanden ist; die
 * zuletzt gewachsene Art ist die des laufenden Zyklus. Was ein älterer Stand unter
 * `meta.landscape` mitbringt, zählt nicht (das Laden legt die Landschaft für < v14 neu an).
 * Gibt zurück, ob die Landschaft damit schon freigeschaltet ist (Meldung einmal beim Laden).
 */
function migrateV13(state: GameState): boolean {
  const landscape = createLandscape(state.cycle.mainTree);
  landscape.sites[0]!.ancient = state.meta.achievements.includes(LANDSCAPE_UNLOCK_ACHIEVEMENT);
  state.meta.landscape = landscape;
  return landscapeUnlocked(state);
}

/**
 * v14 → v15 (Hauptbäume je Waldtyp, DESIGN_V2.md 25.5; Wildwechsel 24.6, 24.12): ein
 * Versionssprung – kein v14-Stand enthält `fir`/`alder` oder `PendingEncounter.via`, es gibt
 * nichts umzubuchen. Frühere Wildwechsel sind nicht bekannt: `wildwechselChosen` beginnt bei 0
 * (die einzige Stelle dafür; ein gleichnamiges Feld eines älteren Stands zählt nicht). Die neue Version lässt die Versionsprüfung greifen,
 * damit ein v14-Spiel die neuen Baum-IDs nicht still zur Eiche macht.
 */
function migrateV14(state: GameState): void {
  state.meta.stats.wildwechselChosen = 0;
  // „Zuerst gesehen“ (25.10): für schon Entdecktes ist der Moment nicht bekannt – leer.
  state.meta.journal.firstSeen = createFirstSeen();
}

/**
 * v16 → v17 (Forschung, DESIGN_V2.md 27.9), letzter Schritt: Startguthaben
 * `round(MIGRATION_HARMONY_MINUTES · H)` ⚖️ mit der Harmonie des Stands (Gedächtnisfaktor
 * nicht mitgerechnet). Wer gerade auf einen Pflege-Rang sparte, hat Samen statt Harmonie – die
 * Samen bleiben ihm, die Forschung soll nicht bei 0 stehen. Die Pflege-Ränge sind da schon in
 * Knoten umgebucht (loadCycleExtras, migrateCare) und zählen in H mit; `harmonyEarned` bleibt 0.
 */
function migrateV16(state: GameState): void {
  const h = evaluate(state).harmony;
  const credit = Number.isFinite(h) && h > 0 ? Math.round(MIGRATION_HARMONY_MINUTES * h) : 0;
  state.harmonyPoints = Math.min(MAX_HARMONY_POINTS, credit);
}

/**
 * Waldchronik (DESIGN_V2.md 26.6). Für Stände vor v16 ist das die **Migration v15 → v16**: Jeder
 * Wald bekommt die Kapitel, die sich aus dem Stand ableiten lassen – ohne Datum (`cycle`/`season`
 * null): „Uralt geworden“, falls `ancient`, und „Ein Wald erinnert sich“, falls sein eigenes
 * Gedächtnis voll ist (aktiver Wald: `meta.forestMemory`). Alles andere bleibt leer, nichts
 * Erfundenes; was ein älterer Stand unter `chronicle` mitbringt, zählt nicht.
 *
 * **Robustes Laden ab v16:** je Wald der erste gespeicherte Eintrag gleicher ID (wie
 * loadLandscape); nur bekannte Kapitel, je einmal, in gespeicherter Reihenfolge; `cycle`
 * ganzzahlig in [1, laufender Zyklus], sonst null; `season` aus SEASON_IDS, sonst null.
 * Kapitel mit prüfbarer Bedingung nur, wenn sie gilt: `ancient` (Wald als Urwald gutgeschrieben),
 * `memory` (eigenes Gedächtnis voll), `kennart` (seine Kennart steht im Tagebuch), `first-snow`
 * (der Wald ist alt – ohne Urwald kein Schnee im Urwald). Fehlen `ancient` oder `memory`, obwohl
 * die Bedingung gilt, werden sie ohne Datum ergänzt (hinten). Höchstens sechs Einträge je Wald.
 */
function loadChronicles(raw: unknown, state: GameState, version: number): void {
  const rawSites = version >= 16 && isRecord(raw) && Array.isArray(raw.sites) ? raw.sites : [];
  const journal = new Set(state.meta.journal.species);
  for (const site of state.meta.landscape.sites) {
    const stored = rawSites.find((s): s is Record<string, unknown> => isRecord(s) && s.id === site.id);
    const holds: Partial<Record<ChapterId, boolean>> = {
      ancient: site.ancient,
      memory: ownMemory(state, site.id) >= MAX_FOREST_MEMORY,
      kennart: journal.has(kennartOf(site.id) ?? ''),
      'first-snow': isSiteAncient(state, site.id),
    };
    const chronicle: ChronicleEntry[] = [];
    for (const e of Array.isArray(stored?.chronicle) ? stored.chronicle : []) {
      if (!isRecord(e) || typeof e.chapter !== 'string' || !CHAPTER_IDS.includes(e.chapter as ChapterId)) continue;
      const chapter = e.chapter as ChapterId;
      if (holds[chapter] === false || chronicle.some((x) => x.chapter === chapter)) continue;
      const { cycle, season } = e;
      chronicle.push({
        chapter,
        cycle: typeof cycle === 'number' && Number.isInteger(cycle) && cycle >= 1 && cycle <= state.cycle.number ? cycle : null,
        season: typeof season === 'string' && SEASON_IDS.includes(season as SeasonId) ? (season as SeasonId) : null,
      });
    }
    for (const chapter of ['ancient', 'memory'] as const) {
      if (holds[chapter] && !chronicle.some((x) => x.chapter === chapter)) chronicle.push({ chapter, cycle: null, season: null });
    }
    site.chronicle = chronicle;
  }
}

/**
 * v8 → v9 (Erfolge, DESIGN_V2.md 18): Alles, was der Stand schon erfüllt, wird still
 * freigeschaltet (Reihenfolge wie ACHIEVEMENTS). Ab Zyklus 2 ist sicher, dass schon einmal
 * die Stufe für den Neuen Zyklus (Hain) erreicht war – die Stufen-Erfolge bis dorthin
 * kommen darum mit, ohne die Stufe im Spielstand zu ändern. Was frühere Zyklen sonst
 * erreicht haben, aber der Stand nicht mehr zeigt (z. B. Urwald, ein volles Jahr), ist
 * nicht bekannt und kommt beim nächsten Erreichen. Was ein älterer Stand unter
 * `meta.achievements` mitbringt, zählt nicht. Gibt die Anzahl zurück.
 */
function migrateV8(state: GameState): number {
  state.meta.achievements = [];
  const minStage = state.cycle.number > 1 ? NEW_CYCLE_MIN_STAGE : 0;
  return checkAchievements(state, { minStage }).length;
}

/**
 * Relative Toleranz für die Untergrenze `playSeconds ≥ cycle.elapsed` beim Laden: Beide
 * werden getrennt aufsummiert (Statistik je Tick um dt, `elapsed` je Schritt und an
 * Jahreszeitgrenzen exakt gesetzt), liegen also nach echtem Spiel um Rundungsrauschen
 * auseinander. Das darf Speichern + Laden nicht verändern.
 */
export const PLAY_SECONDS_TOLERANCE = 1e-6;

/**
 * Langzeit-Statistik robust laden (seit v8): fehlende, kaputte oder negative Zahlen → 0,
 * ±Infinity → Grenze, Zähler ganzzahlig. Untergrenzen aus dem laufenden Zyklus – über alle
 * Zyklen ist nie weniger als im laufenden (Spielzeit bis auf Rundungsrauschen, H_max,
 * aktuelle Baumart). Das Wachstum braucht keine: Gesamt = abgeschlossene Zyklen +
 * `totalGrowth` (lifetimeGrowth). Baumarten nur bekannte, freigeschaltete (`unlocked`) und
 * je einmal, in gespeicherter Reihenfolge; die aktuelle kommt dazu, falls sie fehlt.
 */
function loadStats(raw: unknown, state: GameState, unlocked: (id: MainTreeId) => boolean, version: number): LifetimeStats {
  const r = isRecord(raw) ? raw : {};
  const amount = (value: unknown) => clampedOr(value, 0, 0, Number.MAX_VALUE);
  const count = (value: unknown) => Math.floor(clampedOr(value, 0, 0, MAX_STAT_COUNT));
  const grownTrees = unique(stringArray(r.grownTrees)).filter(
    (id): id is MainTreeId => MAIN_TREES_BY_ID.has(id as MainTreeId) && unlocked(id as MainTreeId),
  );
  if (!grownTrees.includes(state.cycle.mainTree)) grownTrees.push(state.cycle.mainTree);
  const elapsed = state.cycle.elapsed;
  let playSeconds = amount(r.playSeconds);
  if (playSeconds < elapsed - Math.max(PLAY_SECONDS_TOLERANCE, elapsed * PLAY_SECONDS_TOLERANCE)) playSeconds = elapsed;
  return {
    playSeconds,
    completedCyclesGrowth: amount(r.completedCyclesGrowth),
    bestHarmony: Math.max(state.cycle.maxHarmony, amount(r.bestHarmony)),
    cardsChosen: count(r.cardsChosen),
    eventsDecided: count(r.eventsDecided),
    visitorsHosted: count(r.visitorsHosted),
    plantsPlanted: count(r.plantsPlanted),
    careRanksBought: count(r.careRanksBought),
    // Seit v17 (gesammelte Harmonie); in älteren Ständen zählt ein solches Feld nicht (27.9).
    harmonyEarned: version >= 17 ? amount(r.harmonyEarned) : 0,
    // Seit v15 (Wildwechsel-Markierung); ältere Stände setzt migrateV14 auf 0.
    wildwechselChosen: count(r.wildwechselChosen),
    // Seit v18 (Ausbau, 28.8); in älteren Ständen zählt ein solches Feld nicht.
    upgradesBought: version >= 18 ? count(r.upgradesBought) : 0,
    upgradeSeeds: version >= 18 ? amount(r.upgradeSeeds) : 0,
    grownTrees,
  };
}

/**
 * Robustes Laden eines Stands ab v2 (DESIGN_V2.md, 12.3). Felder, die es in v2 noch
 * nicht gab (Pflanzen), fehlen dort einfach und bleiben leer.
 */
function loadV2(data: Record<string, unknown>, now: number, version: number, deferred: DeferredPlants): GameState {
  const lastTick = finiteOr(data.lastTick, now);
  const state = createInitialState(now);
  state.version = SAVE_VERSION;
  state.lastTick = lastTick;
  // ±Infinity (z. B. „1e400“ im JSON) wird auf den größten endlichen Wert begrenzt.
  state.totalGrowth = clampedOr(data.totalGrowth, 0, 0, Number.MAX_VALUE);
  // v2 und v3–v6 rechneten mit anderen Wegpunkt-Kurven: erst auf die aktuelle umrechnen
  // (direkt, nicht über die v6-Kurve), dann Wegpunkt und Stufe ableiten.
  if (version < 3) state.totalGrowth = v2GrowthToCurrent(state.totalGrowth);
  else if (version < 7) state.totalGrowth = v6GrowthToV7(state.totalGrowth);
  state.seeds = clampedOr(data.seeds, 0, 0, Number.MAX_VALUE);
  // Seit v17: Harmonie-Vorrat, endlich und ≥ 0 (NaN, negativ, kein Zahl → 0; ±Infinity und zu
  // groß → MAX_HARMONY_POINTS). Ältere Stände: Startguthaben in migrateV16.
  state.harmonyPoints = version >= 17 ? clampedOr(data.harmonyPoints, 0, 0, MAX_HARMONY_POINTS) : 0;
  // Wegpunkt und Stufe immer aus dem Gesamt-Wachstum ableiten.
  state.waypoint = waypointsForGrowth(state.totalGrowth);
  state.stage = stageForWaypoint(state.waypoint);

  // Seit v5: Ereignis-Boni, Habitate, Gäste … – vor den Nischen, denn Platz-Boni zählen
  // beim Kürzen mit.
  const cycle = isRecord(data.cycle) ? data.cycle : {};
  const meta = isRecord(data.meta) ? data.meta : {};
  const journal = isRecord(meta.journal) ? meta.journal : {};
  // Begleitpflanzen: unbekannte IDs verwerfen (Duplikate sind erlaubt), auf den Pflanzring
  // kürzen. Vor dem Zyklus, denn sie schalten Baumarten frei.
  state.plants = stringArray(data.plants)
    .filter((id) => PLANTS_BY_ID.has(id))
    .slice(0, plantSlots(state.stage));
  // Pflanzen im Tagebuch schalten Baumarten frei. Was gerade (gültig) im Ring wächst, trägt
  // loadGame ohnehin nach (recordDiscoveries) – es zählt darum schon hier. Rohdaten jenseits
  // des Rings zählen nicht (sonst ließe sich eine gesperrte Art per Import setzen).
  const knownPlants = [...stringArray(journal.plants).filter((id) => PLANTS_BY_ID.has(id)), ...state.plants];
  // Seit v14: Waldlandschaft – vor dem Hauptbaum (seit v15 schaltet ein gegründeter Standort
  // Arten frei, DESIGN_V2.md 25.5) und vor den Nischen, denn Eigenheit des Standorts und Gaben
  // schaffen Plätze (ältere Stände: nur der Heimatwald, migrateV13 setzt `ancient`).
  state.meta.forestMemory = clampedOr(meta.forestMemory, 0, 0, MAX_FOREST_MEMORY);
  if (version >= 14) state.meta.landscape = loadLandscape(meta.landscape, state);
  loadCycleExtras(cycle, state, knownPlants, version, deferred);
  if (version >= 14) settleLandscapeTrees(state, knownPlants);
  else state.meta.landscape = createLandscape(state.cycle.mainTree);
  // Platz-Boni aus Ereignissen, Pflege, der Baumart (seit v6) und der Landschaft (seit v14)
  // zählen beim Kürzen mit.
  const bonusSlots = slotBonuses(state);

  // Nischen: unbekannte Arten und Duplikate verwerfen, jede Art in ihre eigene Nische,
  // auf die aktuelle Platzzahl kürzen. Fehlende Nischen (z. B. „hollows“ aus älteren
  // v2-Ständen) bleiben leer. Arten, die Plätze schaffen (Borkenkäfer → Höhlen, Schwarzspecht), ziehen
  // zuerst ein, damit ihre Plätze beim Kürzen schon zählen; danach gilt wieder die
  // gespeicherte Reihenfolge.
  const niches = isRecord(data.niches) ? data.niches : {};
  const candidates: string[] = [];
  for (const nicheId of NICHE_IDS) {
    for (const id of stringArray(niches[nicheId])) if (SPECIES_BY_ID.has(id) && !candidates.includes(id)) candidates.push(id);
  }
  const createsSlots = (id: string) => slotEffects(SPECIES_BY_ID.get(id)!).length > 0;
  // Alle gespeicherten Arten haben hier gelebt – auch gekürzte bleiben im Tagebuch.
  const seen = new Set<string>(candidates);
  for (const id of [...candidates.filter(createsSlots), ...candidates.filter((x) => !createsSlots(x))]) {
    const sp = SPECIES_BY_ID.get(id)!;
    if (state.niches[sp.niche].length >= nicheSlots(state.stage, state.niches, bonusSlots)[sp.niche]) continue;
    state.niches[sp.niche].push(id);
  }
  for (const nicheId of NICHE_IDS) {
    state.niches[nicheId].sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
  }
  // Sicherheitsnetz: Kürzen kann Platz-Schaffer entfernt haben – überzählige Tiere von hinten entlassen.
  for (let changed = true; changed; ) {
    changed = false;
    const slots = nicheSlots(state.stage, state.niches, bonusSlots);
    for (const nicheId of NICHE_IDS) {
      if (state.niches[nicheId].length > slots[nicheId]) {
        state.niches[nicheId].pop();
        changed = true;
        break;
      }
    }
  }

  // Offene Begegnungen: ungültige Karten entfernen, leere verwerfen, höchstens 3.
  // Pflanzen-Begegnungen („Etwas keimt“, bis Phase 10) haben Pflanzen-IDs als Karten – sie
  // werden gemerkt und am Ende von loadGame zur Aussaat (convertPlantEncounters, 27.9 Schritt 4).
  // Ereignisse und Gäste haben genau eine ID (seit v5); alles andere (auch fehlender Typ) gilt
  // als Tierbegegnung. Unbekannte Typen aus späteren Versionen verlieren so ihre Karten und
  // fallen weg.
  if (Array.isArray(data.pendingEncounters)) {
    for (const raw of data.pendingEncounters) {
      if (state.pendingEncounters.length + deferred.encounters.length >= MAX_PENDING_ENCOUNTERS) break;
      if (!isRecord(raw)) continue;
      if (raw.type === 'plant') {
        // Pflanzenkarten müssen auf dieser Stufe freigeschaltet sein.
        const cards = unique(stringArray(raw.cards).filter((id) => (PLANTS_BY_ID.get(id)?.unlock ?? Infinity) <= state.stage));
        if (cards.length > 0) deferred.encounters.push({ cards, rerolls: Math.floor(clampedOr(raw.rerolls, 0, 0, MAX_REROLLS)) });
        continue;
      }
      const type = raw.type === 'event' || raw.type === 'visitor' ? raw.type : 'animal';
      const valid: (id: string) => boolean =
        type === 'event' ? (id) => EVENTS_BY_ID.has(id) : type === 'visitor' ? (id) => VISITORS_BY_ID.has(id) : (id) => SPECIES_BY_ID.has(id);
      const single = type === 'event' || type === 'visitor';
      const cards = unique(stringArray(raw.cards).filter(valid)).slice(0, single ? 1 : CARDS_PER_ENCOUNTER);
      if (cards.length === 0) continue;
      if (single) {
        const id = cards[0]!;
        // Jedes Ereignis und jeder Gast höchstens einmal: keine Doppel in der Warteschlange,
        // kein Gast, der schon rastet, kein Ereignis, dessen Wirkungen schon vergeben sind.
        if (state.pendingEncounters.some((e) => e.cards[0] === id && e.type === type)) continue;
        if (type === 'visitor' && state.cycle.visitors.some((v) => v.id === id)) continue;
        if (type === 'event' && [...state.cycle.bonuses, ...state.cycle.timed].some((b) => b.source === id)) continue;
      }
      const encounter: PendingEncounter = {
        type,
        cards,
        rerolls: single ? 0 : Math.floor(clampedOr(raw.rerolls, 0, 0, MAX_REROLLS)),
      };
      // Seit v15: Wildwechsel-Markierung – nur gültig, sonst weggelassen.
      const via = version >= 15 && type === 'animal' ? loadVia(raw, cards, state.meta.landscape) : null;
      if (via) encounter.via = via;
      state.pendingEncounters.push(encounter);
      // Wartende Ereignisse und Gäste sind gezogen, also gesehen.
      if (single && !state.cycle.seen.includes(cards[0]!)) state.cycle.seen.push(cards[0]!);
    }
  }
  // Zwischenhalt: höchstens bis zum aktuellen Wegpunkt ausgewertet.
  state.cycle.interlude = Math.min(state.cycle.interlude, state.waypoint);

  state.rngState = isValidRngState(data.rngState) ? data.rngState : normalizeSeed(lastTick);

  state.meta.journal.species = unique(stringArray(journal.species).filter((id) => SPECIES_BY_ID.has(id)));
  for (const id of seen) if (!state.meta.journal.species.includes(id)) state.meta.journal.species.push(id);
  // Andenken sind freie IDs: Anzahl und Länge begrenzen (fremde oder manipulierte Stände).
  state.meta.journal.keepsakes = unique(stringArray(journal.keepsakes))
    .filter((id) => id.length > 0 && id.length <= MAX_KEEPSAKE_ID_LENGTH)
    .slice(0, MAX_KEEPSAKES);
  // Pflanzen und Lebensgemeinschaften im Tagebuch (seit Schritt 2.3, ohne neue Version):
  // fehlen sie (ältere Stände), ergänzt loadGame sie per recordDiscoveries aus dem Ökosystem.
  state.meta.journal.plants = unique(stringArray(journal.plants).filter((id) => PLANTS_BY_ID.has(id)));
  state.meta.journal.communities = unique(stringArray(journal.communities).filter((id) => COMMUNITIES_BY_ID.has(id)));

  // Seit v4: laufender Zyklus und Stammgäste (ältere Stände: migrateV3 setzt sie).
  const discovered = new Set(state.meta.journal.species);
  state.cycle.number = Math.floor(clampedOr(cycle.number, 1, 1, MAX_CYCLE_NUMBER));
  state.cycle.maxHarmony = clampedOr(cycle.maxHarmony, 0, 0, Number.MAX_VALUE);
  state.cycle.newSpecies = unique(stringArray(cycle.newSpecies).filter((id) => discovered.has(id)));
  // Seit v10: Sperrklinke (ältere Stände: migrateV9). Ganzzahlig, NaN/negativ → 0. Höchstens,
  // was H_max an irgendeinem Wegpunkt bringt – am meisten bis zum Hain (Schwelle steigt
  // danach) – und nie über MAX_FOREST_MEMORY. Schützt vor manipulierten Ständen.
  const bestPossible = Math.min(MAX_FOREST_MEMORY, harmonyMemoryGain(state.cycle.maxHarmony, 0));
  state.cycle.bestHarmonyMemory = version >= 10 ? Math.floor(clampedOr(cycle.bestHarmonyMemory, 0, 0, bestPossible)) : 0;
  if (typeof cycle.startedAt === 'number' && Number.isFinite(cycle.startedAt)) state.cycle.startedAt = cycle.startedAt;
  // Plätze aus dem wirksamen Gedächtnis (seit v14 mit Korridor-Zufluss, DESIGN_V2.md 24.6).
  state.meta.regulars = unique(stringArray(meta.regulars).filter((id) => discovered.has(id))).slice(0, regularSlotsOf(state));
  // Geparkte Stammgäste ruhender Wälder: dieselbe Regel mit dem wirksamen Gedächtnis jenes Waldes.
  for (const site of state.meta.landscape.sites) {
    if (site.id === state.meta.landscape.active) continue;
    site.regulars = site.regulars.filter((id) => discovered.has(id)).slice(0, regularSlots(effectiveMemoryOf(state, site.id)));
    // Bestand für den Wildwechsel (24.6): nur entdeckte Arten – im Spiel lebt dort nichts anderes.
    site.fauna = site.fauna.filter((id) => discovered.has(id));
  }
  // Wildwechsel-Markierung (seit v15): erst jetzt steht der Bestand fest – der Weg der Art muss
  // genau dieser Korridor sein (wie beim Ziehen, wildwechselRoute), sonst keine Markierung.
  for (const encounter of state.pendingEncounters) {
    const via = encounter.via;
    if (via && wildwechselRoute(state, encounter.cards[via.card]!)?.corridor !== via.corridor) delete encounter.via;
  }
  // Seit v15: „Zuerst gesehen“ (ältere Stände: migrateV14).
  state.meta.journal.firstSeen = loadFirstSeen(journal.firstSeen, state);
  // Seit v8: Langzeit-Statistik (ältere Stände: migrateV7 setzt sie).
  const known = { meta: { ...state.meta, journal: { ...state.meta.journal, plants: [...state.meta.journal.plants, ...state.plants] } } };
  state.meta.stats = loadStats(version >= 8 ? meta.stats : undefined, state, (id) => isTreeUnlocked(known, id), version);
  // Seit v17: Forschungsplan (ältere Stände: leer, Schalter aus).
  state.meta.research = version >= 17 ? loadResearchPlan(meta.research) : createResearchPlan();
  // Seit v18: Bestmarke des Ausbaus, nie unter der Stufe im Zyklus (ältere Stände: leer).
  state.meta.upgrades = { best: loadBestUpgrades(version >= 18 && isRecord(meta.upgrades) ? meta.upgrades.best : undefined, state.cycle.upgrades) };
  // Seit v9: Erfolge – nur bekannte IDs, je einmal, gespeicherte Reihenfolge (ältere Stände:
  // migrateV8). Ob sie erfüllt sind, lässt sich nicht prüfen (frühere Zyklen) – sie bleiben.
  state.meta.achievements =
    version >= 9 ? unique(stringArray(meta.achievements)).filter((id) => ACHIEVEMENTS_BY_ID.has(id)) : [];
  // Seit v12: Tagesziele (ältere Stände: migrateV11 – neuer Startwert aus dem Zufall des
  // Stands, noch kein Tag, keine Serie).
  state.meta.daily = version >= 12 ? loadDaily(meta.daily, state) : migrateV11(state);
  return state;
}

/**
 * v11 → v12 (Tagesziele, DESIGN_V2.md 20): eigener Startwert aus dem Zufallsgenerator des
 * Stands (fest, solange der Stand nicht weiterläuft – zweimal Laden ergibt dasselbe), noch
 * kein Tag, keine Serie. Die ersten Ziele entstehen beim ersten Tageswechsel im Spiel.
 */
function migrateV11(state: GameState): DailyState {
  return createDaily(dailySeedOf(state.rngState));
}

/**
 * „Zuerst gesehen“ robust laden (seit v15, DESIGN_V2.md 25.10): nur Arten bzw. Pflanzen, die
 * bekannt sind und im Naturtagebuch stehen; Zyklus ganzzahlig in [1, laufender Zyklus],
 * Jahreszeit aus SEASON_IDS. Alles andere fällt weg (dann zeigt die Oberfläche nichts).
 */
function loadFirstSeen(raw: unknown, state: GameState): FirstSeenJournal {
  const r = isRecord(raw) ? raw : {};
  const out = createFirstSeen();
  const entry = (value: unknown): FirstSeen | null => {
    if (!isRecord(value)) return null;
    const { cycle, season } = value;
    if (typeof cycle !== 'number' || !Number.isInteger(cycle) || cycle < 1 || cycle > state.cycle.number) return null;
    if (typeof season !== 'string' || !SEASON_IDS.includes(season as SeasonId)) return null;
    return { cycle, season: season as SeasonId };
  };
  for (const kind of ['species', 'plants'] as const) {
    const source = isRecord(r[kind]) ? (r[kind] as Record<string, unknown>) : {};
    for (const id of state.meta.journal[kind]) {
      if (!Object.hasOwn(source, id)) continue;
      const value = entry(source[id]);
      if (value) out[kind][id] = value;
    }
  }
  return out;
}

/**
 * Wildwechsel-Markierung einer Tierbegegnung robust laden (seit v15, DESIGN_V2.md 24.6):
 * `card` ist ein ganzzahliger Index in die **gespeicherten** Karten; er wird auf die geladenen
 * (`cards`, ungültige und doppelte verworfen) umgerechnet. `corridor` muss gebaut sein und am
 * aktiven Wald liegen. Sonst null (keine Markierung, die Karte bleibt eine gewöhnliche).
 */
function loadVia(raw: Record<string, unknown>, cards: readonly string[], landscape: LandscapeState): PendingEncounter['via'] | null {
  const via = raw.via;
  if (!isRecord(via) || typeof via.corridor !== 'string' || !Array.isArray(raw.cards)) return null;
  if (typeof via.card !== 'number' || !Number.isInteger(via.card) || via.card < 0 || via.card >= raw.cards.length) return null;
  const id = raw.cards[via.card];
  // Dieselbe Art unter den geladenen Karten (ungültige davor verschieben den Index).
  const card = typeof id === 'string' ? cards.indexOf(id) : -1;
  if (card < 0) return null;
  const corridor = CORRIDORS_BY_ID.get(via.corridor);
  if (!corridor || !landscape.corridors.includes(corridor.id) || !corridor.sites.includes(landscape.active)) return null;
  return { card, corridor: corridor.id };
}

/**
 * Waldlandschaft robust laden (seit v14, DESIGN_V2.md 24.8). Braucht Stufe und
 * `meta.forestMemory` des Stands (schon geladen), aber nicht den Zyklus: Seit v15 wird sie vor
 * dem Hauptbaum geladen (25.5), dessen Freischaltung von gegründeten Standorten abhängt. Die
 * Hauptbäume der Wälder ordnet danach settleLandscapeTrees:
 * - `sites`: nur bekannte IDs, je einmal, Heimatwald zuerst (fehlt er → ergänzt);
 *   Gedächtnis 0 … MAX_FOREST_MEMORY ganzzahlig abgerundet, Stammgäste und Bestand nur
 *   bekannte Arten je einmal (Bestand höchstens MAX_SITE_FAUNA; entdeckt und Plätze prüft
 *   loadV2 danach), unbekannte Baumart → Eiche.
 * - `active` muss gegründet sein, sonst Heimatwald – `meta.forestMemory` und `meta.regulars`
 *   werden dabei nicht umgebucht. Sein Eintrag hält Gedächtnis 0 und keine Stammgäste.
 * - `corridors`: bekannte IDs, je einmal, nur zwischen gegründeten Wäldern; `freeCorridors`
 *   ⊆ `corridors`, je gegründetem Wald außer dem Heimatwald höchstens einer (an diesem Wald).
 * - `announced` nur `true`, wenn so gespeichert (sonst kommt die Meldung 24.3 noch einmal).
 * - Kosten-Prüfung: Bezahlt die verdiente Hähersaat nicht alles (manipulierter Stand), fallen
 *   zuerst gekaufte Korridore (zuletzt gebaute zuerst), dann zuletzt gegründete **ruhende**
 *   Wälder samt ihrer Korridore – nie der aktive und nie der Heimatwald.
 */
function loadLandscape(raw: unknown, state: GameState): LandscapeState {
  const r = isRecord(raw) ? raw : {};
  const isSite = (id: unknown): id is SiteId => typeof id === 'string' && SITE_IDS.includes(id as SiteId);
  const sites: LandscapeSite[] = [];
  for (const s of Array.isArray(r.sites) ? r.sites : []) {
    if (!isRecord(s) || !isSite(s.id) || sites.some((x) => x.id === s.id)) continue;
    const tree = typeof s.mainTree === 'string' && MAIN_TREES_BY_ID.has(s.mainTree as MainTreeId) ? (s.mainTree as MainTreeId) : DEFAULT_MAIN_TREE;
    sites.push({
      id: s.id,
      memory: Math.floor(clampedOr(s.memory, 0, 0, MAX_FOREST_MEMORY)),
      regulars: unique(stringArray(s.regulars).filter((id) => SPECIES_BY_ID.has(id))),
      ancient: s.ancient === true,
      mainTree: tree,
      fauna: unique(stringArray(s.fauna).filter((id) => SPECIES_BY_ID.has(id))).slice(0, MAX_SITE_FAUNA),
      // Seit v16: die Chronik lädt loadChronicles zuletzt (sie braucht Tagebuch und Zyklus).
      chronicle: [],
    });
  }
  // Der Hauptbaum des aktiven Waldes folgt erst nach dem Zyklus (settleLandscapeTrees).
  const home = sites.find((s) => s.id === HOME_SITE) ?? createSite(HOME_SITE);
  const landscape: LandscapeState = {
    active: HOME_SITE,
    sites: [home, ...sites.filter((s) => s.id !== HOME_SITE)],
    corridors: [],
    freeCorridors: [],
    announced: r.announced === true,
  };
  if (isSite(r.active) && siteEntry(landscape, r.active)) landscape.active = r.active;
  const active = siteEntry(landscape, landscape.active)!;
  active.memory = 0;
  active.regulars = [];
  const founded = (id: SiteId) => siteEntry(landscape, id) !== undefined;
  landscape.corridors = unique(stringArray(r.corridors)).filter((id) => CORRIDORS_BY_ID.get(id)?.sites.every(founded) ?? false);
  const assigned = new Set<SiteId>();
  for (const id of unique(stringArray(r.freeCorridors))) {
    if (!landscape.corridors.includes(id)) continue;
    const end = CORRIDORS_BY_ID.get(id)!.sites.find((site) => site !== HOME_SITE && !assigned.has(site));
    if (end === undefined) continue;
    assigned.add(end);
    landscape.freeCorridors.push(id);
  }
  // Kosten-Prüfung (manipulierte Stände).
  const probe = { stage: state.stage, meta: { forestMemory: state.meta.forestMemory, achievements: [], landscape } };
  while (jaySeedsSpent(landscape) > jaySeeds(probe).earned) {
    const bought = landscape.corridors.filter((id) => !landscape.freeCorridors.includes(id));
    if (bought.length > 0) {
      landscape.corridors.splice(landscape.corridors.lastIndexOf(bought[bought.length - 1]!), 1);
      continue;
    }
    let drop = -1;
    for (let i = landscape.sites.length - 1; i > 0; i--) {
      if (landscape.sites[i]!.id !== landscape.active) {
        drop = i;
        break;
      }
    }
    if (drop < 0) break; // nur noch Heimatwald und aktiver Wald: bleibt (verfügbar dann 0)
    const id = landscape.sites[drop]!.id;
    landscape.sites.splice(drop, 1);
    const touches = (cid: string) => CORRIDORS_BY_ID.get(cid)!.sites.includes(id);
    landscape.corridors = landscape.corridors.filter((cid) => !touches(cid));
    landscape.freeCorridors = landscape.freeCorridors.filter((cid) => !touches(cid));
  }
  return landscape;
}

/**
 * Hauptbäume der Landschaft nach dem Laden des Zyklus (seit v15, DESIGN_V2.md 25.5): Der
 * aktive Wald trägt die Art des laufenden Zyklus; ruhende Wälder behalten ihre, wenn sie
 * freigeschaltet ist (Begleitpflanze in `knownPlants`, Standort gegründet – nach der
 * Kosten-Prüfung), sonst Eiche. Ein fehlender Heimatwald (kaputter Stand) bekommt so als
 * aktiver Wald ebenfalls die Art des Zyklus.
 */
function settleLandscapeTrees(state: GameState, knownPlants: readonly string[]): void {
  const landscape = state.meta.landscape;
  const known = { meta: { ...state.meta, journal: { ...state.meta.journal, plants: [...knownPlants] } } };
  for (const site of landscape.sites) {
    if (site.id === landscape.active) site.mainTree = state.cycle.mainTree;
    else if (!isTreeUnlocked(known, site.mainTree)) site.mainTree = DEFAULT_MAIN_TREE;
  }
}

/** Obergrenze der Zähler der Tagesziele (Serie, erfüllte Ziele, perfekte Tage). */
export const MAX_DAILY_COUNT = 1e9;

/**
 * Tagesziele robust laden (seit v12): Startwert gültig (sonst aus dem Zufall des Stands),
 * Tage nur als gültiges „JJJJ-MM-TT“, Ziele nur bekannte Arten mit allen Parametern, die
 * sie brauchen (Gattung, Jahreszeit, Lebensgemeinschaft, Schwelle), Zielwert endlich und
 * > 0, Fortschritt in [0, Zielwert], höchstens DAILY_GOAL_COUNT. Zähler ganzzahlig ≥ 0,
 * beste Serie nie unter der laufenden. Ohne gültigen Tag keine Ziele.
 */
function loadDaily(raw: unknown, state: GameState): DailyState {
  const r = isRecord(raw) ? raw : {};
  const daily = createDaily(isValidRngState(r.seed) ? r.seed : dailySeedOf(state.rngState));
  // createDaily mischt den Startwert: den gespeicherten unverändert übernehmen.
  if (isValidRngState(r.seed)) daily.seed = r.seed;
  const count = (value: unknown) => Math.floor(clampedOr(value, 0, 0, MAX_DAILY_COUNT));
  daily.day = isDayKey(r.day) ? r.day : '';
  daily.lastDay = isDayKey(r.lastDay) ? r.lastDay : '';
  daily.streak = daily.lastDay ? count(r.streak) : 0;
  daily.bestStreak = Math.max(daily.streak, count(r.bestStreak));
  daily.goalsDone = count(r.goalsDone);
  daily.perfectDays = count(r.perfectDays);
  if (daily.day && Array.isArray(r.goals)) {
    for (const g of r.goals) {
      if (daily.goals.length >= DAILY_GOAL_COUNT) break;
      const goal = loadDailyGoal(g);
      if (goal && !daily.goals.some((x) => x.kind === goal.kind)) daily.goals.push(goal);
    }
  }
  return daily;
}

function loadDailyGoal(raw: unknown): DailyGoal | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string' || !DAILY_GOALS_BY_KIND.has(raw.kind as DailyGoalKind)) return null;
  const kind = raw.kind as DailyGoalKind;
  const target = finiteOr(raw.target, 0);
  if (!(target > 0)) return null;
  const goal: DailyGoal = {
    kind,
    target,
    progress: clampedOr(raw.progress, 0, 0, target),
    reward: raw.reward === 'rare' ? 'rare' : 'seeds',
    done: raw.done === true,
  };
  if (goal.done) goal.progress = target;
  const genus = typeof raw.genus === 'string' && GENERA.includes(raw.genus as Genus) ? (raw.genus as Genus) : undefined;
  const season = typeof raw.season === 'string' && SEASON_IDS.includes(raw.season as SeasonId) ? (raw.season as SeasonId) : undefined;
  const community = typeof raw.community === 'string' && COMMUNITIES_BY_ID.has(raw.community) ? raw.community : undefined;
  const harmony = typeof raw.harmony === 'number' && Number.isFinite(raw.harmony) && raw.harmony >= 0 ? raw.harmony : undefined;
  switch (kind) {
    case 'observe':
      if (!genus || !season) return null;
      Object.assign(goal, { genus, season });
      break;
    case 'satisfaction':
      if (!genus) return null;
      goal.genus = genus;
      break;
    case 'community':
      if (!community) return null;
      goal.community = community;
      break;
    case 'harmony':
      if (harmony === undefined) return null;
      goal.harmony = harmony;
      break;
    default:
      break;
  }
  return goal;
}

/** Alle Wirkungen einer Art aus allen Ereignis-Optionen (für die Prüfung beim Laden). */
function eventEffects<K extends 'cycle' | 'timed' | 'habitat'>(eventId: string, kind: K) {
  const out: Extract<(typeof EVENTS)[number]['options'][number]['effects'][number], { kind: K }>[] = [];
  for (const option of EVENTS_BY_ID.get(eventId)?.options ?? []) {
    for (const e of option.effects) if (e.kind === kind) out.push(e as (typeof out)[number]);
  }
  return out;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Lädt die Zyklusfelder für Ereignisse und Gäste (seit v5) robust: Boni, Zeit-Boni und
 * Habitate nur, wenn ein Ereignis sie wirklich vergibt (Schutz vor manipulierten
 * Ständen), Restdauern begrenzt auf (0, Dauer], Gäste nur bekannte. Seit v6 auch
 * Spielzeit (wie normalizeElapsed, keine Zahl → 0) und Hauptbaum (bekannt und über
 * `knownPlants` freigeschaltet, sonst DEFAULT_MAIN_TREE). Ältere Stände (< v6) kannten
 * beides nicht: Was dort steht, zählt nicht (Frühling, Eiche) – so kürzt loadV2 die
 * Nischen auch nicht mit den Plätzen einer fremden Art.
 */
function loadCycleExtras(
  raw: Record<string, unknown>,
  state: GameState,
  knownPlants: readonly string[],
  version: number,
  deferred: DeferredPlants,
): void {
  const cycle: CycleState = createCycle(1);
  if (version >= 6) {
    // −Infinity und negative Werte → 0 (Frühling), +Infinity und sehr große → MAX_ELAPSED.
    cycle.elapsed = typeof raw.elapsed === 'number' ? normalizeElapsed(raw.elapsed) : 0;
    const tree = typeof raw.mainTree === 'string' ? MAIN_TREES_BY_ID.get(raw.mainTree as MainTreeId) : undefined;
    const known: Pick<GameState, 'meta'> = { ...state, meta: { ...state.meta, journal: { ...state.meta.journal, plants: [...knownPlants] } } };
    cycle.mainTree = tree && isTreeUnlocked(known, tree.id) ? tree.id : DEFAULT_MAIN_TREE;
  }
  if (typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt)) cycle.startedAt = raw.startedAt;
  cycle.seen = unique(stringArray(raw.seen).filter((id) => EVENTS_BY_ID.has(id) || VISITORS_BY_ID.has(id)));
  // Wirkungen nur von Ereignissen, die in diesem Zyklus gezogen wurden, und je (Quelle,
  // Wirkung) höchstens einmal – so lassen sich Boni nicht durch Kopieren vervielfachen.
  const seen = new Set(cycle.seen);
  const taken = new Set<string>();
  const once = (kind: string, source: string, effect: unknown) => {
    const key = `${kind}|${source}|${JSON.stringify(effect)}`;
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  };
  for (const b of Array.isArray(raw.bonuses) ? raw.bonuses : []) {
    if (!isRecord(b) || typeof b.source !== 'string' || !seen.has(b.source)) continue;
    const effect = eventEffects(b.source, 'cycle').find((e) => sameJson(e.effect, b.effect))?.effect;
    if (effect && once('cycle', b.source, effect)) cycle.bonuses.push({ source: b.source, effect: effect as CycleEffect } satisfies CycleBonus);
  }
  // Habitate: je Merkmal höchstens so oft, wie die gezogenen Ereignisse es vergeben können.
  const allowed = new Map<string, number>();
  for (const id of cycle.seen) {
    const perTag = new Map<string, number>();
    for (const option of EVENTS_BY_ID.get(id)?.options ?? []) {
      const counts = new Map<string, number>();
      for (const e of option.effects) if (e.kind === 'habitat') counts.set(e.tag, (counts.get(e.tag) ?? 0) + 1);
      for (const [tag, n] of counts) perTag.set(tag, Math.max(perTag.get(tag) ?? 0, n));
    }
    for (const [tag, n] of perTag) allowed.set(tag, (allowed.get(tag) ?? 0) + n);
  }
  for (const tag of stringArray(raw.habitats)) {
    const left = allowed.get(tag) ?? 0;
    if (left <= 0) continue;
    allowed.set(tag, left - 1);
    cycle.habitats.push(tag as Tag);
  }
  for (const t of Array.isArray(raw.timed) ? raw.timed : []) {
    if (!isRecord(t) || typeof t.source !== 'string' || !seen.has(t.source)) continue;
    const timed = eventEffects(t.source, 'timed').find((e) => sameJson(e.effect, t.effect));
    const remaining = finiteOr(t.remaining, 0);
    if (!timed || !(remaining > 0) || !once('timed', t.source, timed.effect)) continue;
    cycle.timed.push({ source: t.source, effect: timed.effect as TimedEffect, remaining: Math.min(remaining, timed.seconds) } satisfies TimedBonus);
  }
  for (const v of Array.isArray(raw.visitors) ? raw.visitors : []) {
    if (!isRecord(v) || typeof v.id !== 'string' || !seen.has(v.id)) continue;
    const visitor = VISITORS_BY_ID.get(v.id);
    const remaining = finiteOr(v.remaining, 0);
    if (!visitor || !(remaining > 0) || cycle.visitors.some((x) => x.id === v.id)) continue;
    cycle.visitors.push({ id: v.id, remaining: Math.min(remaining, visitor.stay) });
  }
  if (isRecord(raw.forced) && raw.forced.type === 'animal') {
    // Nur IDs, die ein Ereignis wirklich als nächste Tierbegegnung vorgibt.
    const offered = new Set(
      EVENTS.flatMap((e) => e.options.flatMap((o) => o.effects.flatMap((x) => (x.kind === 'nextEncounter' && x.type === 'animal' ? x.ids : [])))),
    );
    const ids = unique(stringArray(raw.forced.ids).filter((id) => offered.has(id)));
    if (ids.length > 0) cycle.forced = { type: 'animal', ids };
  } else if (isRecord(raw.forced) && raw.forced.type === 'plant') {
    // Vorgabe „Etwas keimt“ (Vogelsaat bis Phase 10) → geschenkte Aussaat (27.9 Schritt 4).
    const ids = unique(stringArray(raw.forced.ids).filter((id) => FREE_SOWING_IDS.has(id)));
    if (ids.length > 0) deferred.forced = ids;
  }
  cycle.interlude = Math.floor(clampedOr(raw.interlude, 0, 0, WAYPOINT_COUNT));
  // Forschung (seit v17, 27.9): robust laden. Ältere Stände: Pflege-Ränge umbuchen (migrateCare).
  cycle.research = sanitizeResearch(version >= 17 ? stringArray(raw.research) : migrateCare(raw.care, state.stage), state.stage);
  // Aussaat (seit v17, 27.6/27.9; Logik ab Phase 10, 2b). Ältere Stände: Zähler = Begleitpflanzen
  // im Ring (der Preis setzt dort fort, wo der Ring steht), nichts offen.
  const sowings = raw.sowings;
  cycle.sowings =
    version >= 17 && typeof sowings === 'number' && Number.isInteger(sowings) && sowings >= 0 && sowings <= MAX_SOWINGS
      ? sowings
      : Math.min(MAX_SOWINGS, state.plants.length);
  cycle.sowing = version >= 17 ? loadSowing(raw.sowing, state.stage, cycle.research) : null;
  cycle.freeSowing = version >= 17 ? loadFreeSowing(raw.freeSowing, cycle.seen) : null;
  // Seit v18 (28.8): Ausbaustufen und Ränge – vor den Nischen geladen, denn die Ausbau-Plätze
  // zählen beim Kürzen mit (sie öffnen keine Nische, nicheSlots). Ältere Stände: leer.
  cycle.upgrades = version >= 18 ? loadUpgradeLevels(raw.upgrades) : createUpgradeLevels();
  cycle.researchRanks = version >= 18 ? loadResearchRanks(raw.researchRanks, cycle.research, state.stage) : {};
  state.cycle = cycle;
}

/**
 * Ausbaustufen robust (seit v18, DESIGN_V2.md 28.8): nur bekannte Nischen (NICHE_IDS) und
 * Baumteile (TREE_PART_IDS), Stufe ganzzahlig in 1 … MAX_UPGRADE_LEVEL – NaN, negativ, zu groß,
 * Bruch oder Text zählen als 0 und fallen weg. Eine Stufe in einer gerade verschlossenen Nische
 * bleibt (sie ruht, ihr Platz zählt nicht).
 */
function loadUpgradeLevels(raw: unknown): UpgradeLevels {
  const r = isRecord(raw) ? raw : {};
  const out = createUpgradeLevels();
  const niches = isRecord(r.niches) ? r.niches : {};
  const tree = isRecord(r.tree) ? r.tree : {};
  for (const id of NICHE_IDS) {
    const level = Object.hasOwn(niches, id) ? normalizeUpgradeLevel(niches[id]) : 0;
    if (level > 0) out.niches[id] = level;
  }
  for (const id of TREE_PART_IDS) {
    const level = Object.hasOwn(tree, id) ? normalizeUpgradeLevel(tree[id]) : 0;
    if (level > 0) out.tree[id] = level;
  }
  return out;
}

/** Bestmarke des Ausbaus (seit v18): wie loadUpgradeLevels, dazu nie unter der Stufe im Zyklus. */
function loadBestUpgrades(raw: unknown, cycle: UpgradeLevels): UpgradeLevels {
  const best = loadUpgradeLevels(raw);
  for (const id of NICHE_IDS) {
    const level = Math.max(upgradeLevel(best, { kind: 'niche', id }), upgradeLevel(cycle, { kind: 'niche', id }));
    if (level > 0) best.niches[id] = level;
  }
  for (const id of TREE_PART_IDS) {
    const level = Math.max(upgradeLevel(best, { kind: 'tree', id }), upgradeLevel(cycle, { kind: 'tree', id }));
    if (level > 0) best.tree[id] = level;
  }
  return best;
}

/**
 * Ränge der wiederholbaren Knoten robust (seit v18, 28.8; Logik ab Phase 11, 2b): nur Knoten aus
 * RESEARCH_REPEATABLE, deren Stufe erreicht ist und deren Voraussetzung (ein Gabel-Knoten des
 * Asts) in `research` steht; Rang ganzzahlig in 1 … MAX_RESEARCH_RANK, sonst fällt er weg (0).
 */
function loadResearchRanks(raw: unknown, research: readonly string[], stage: number): Record<string, number> {
  const r = isRecord(raw) ? raw : {};
  const out: Record<string, number> = {};
  for (const node of RESEARCH_REPEATABLE) {
    if (!Object.hasOwn(r, node.id) || node.minStage > stage || !researchRequirementsMet(node, research)) continue;
    const rank = r[node.id];
    if (typeof rank === 'number' && Number.isInteger(rank) && rank >= 1 && rank <= MAX_RESEARCH_RANK) out[node.id] = rank;
  }
  return out;
}

/**
 * Migration v16 → v17, Schritt 1 (27.9): Pflege-Ränge (`cycle.care`, ID → Rang) → Knoten nach
 * CARE_TO_RESEARCH. Ränge wie bis v16 ganzzahlig und höchstens bis zum letzten, den die Stufe
 * erlaubt (die Knoten tragen die Stufe ihres Rangs); von zwei Kronen bleibt nur die erste in
 * Tabellen-Reihenfolge (wie bis v16 in CARE-Reihenfolge). Danach werden fehlende
 * Voraussetzungen geschenkt, soweit ihre Stufe erreicht ist (z. B. Humusschicht → Kompost) –
 * niemand verliert eine Wirkung, die er schon hat. Ergebnis in RESEARCH-Reihenfolge (jede
 * Voraussetzung steht dort vor dem Knoten); sanitizeResearch prüft danach wie beim Laden.
 */
function migrateCare(raw: unknown, stage: number): string[] {
  const owned = new Set<string>();
  if (!isRecord(raw)) return [];
  const reachable = (id: string) => (RESEARCH_BY_ID.get(id)?.minStage ?? Infinity) <= stage;
  for (const [careId, nodes] of Object.entries(CARE_TO_RESEARCH)) {
    if (!Object.hasOwn(raw, careId)) continue;
    let allowed = 0;
    while (allowed < nodes.length && reachable(nodes[allowed]!)) allowed++;
    const ranks = Math.floor(clampedOr(raw[careId], 0, 0, allowed));
    if (ranks <= 0 || researchExcluded(RESEARCH_BY_ID.get(nodes[0]!)!, [...owned])) continue;
    for (const id of nodes.slice(0, ranks)) owned.add(id);
  }
  // Geschenkte Voraussetzungen (wiederholt: eine geschenkte kann selbst welche brauchen).
  for (let changed = true; changed; ) {
    changed = false;
    for (const node of RESEARCH) {
      if (!owned.has(node.id)) continue;
      const gift = (id: string) => {
        if (owned.has(id) || !reachable(id) || researchExcluded(RESEARCH_BY_ID.get(id)!, [...owned])) return;
        owned.add(id);
        changed = true;
      };
      for (const id of node.requires ?? []) gift(id);
      const any = node.requiresAny ?? [];
      if (any.length > 0 && !any.some((id) => owned.has(id))) {
        const first = any.find((id) => reachable(id) && !researchExcluded(RESEARCH_BY_ID.get(id)!, [...owned]));
        if (first) gift(first);
      }
    }
  }
  return RESEARCH.filter((n) => owned.has(n.id)).map((n) => n.id);
}

/**
 * Erforschte Knoten robust (seit v17, 27.9), in gespeicherter (Kauf-)Reihenfolge: nur bekannte
 * IDs, je einmal, Stufe erreicht; ein Knoten bleibt nur, wenn seine Voraussetzungen schon vor
 * ihm stehen (so fällt alles, was an einem verworfenen Knoten hängt, mit) und kein früherer
 * Knoten ihn ausschließt – von einer Gabel bleibt der zuerst gekaufte Weg. `condition` gilt nur
 * beim Erforschen (wie bis v16 `requires` der Pflege). Höchstens alle Knoten von RESEARCH.
 */
function sanitizeResearch(raw: readonly string[], stage: number): string[] {
  const out: string[] = [];
  for (const id of raw) {
    const node = RESEARCH_BY_ID.get(id);
    if (!node || out.includes(id) || node.minStage > stage) continue;
    if (researchExcluded(node, out) || !researchRequirementsMet(node, out)) continue;
    out.push(id);
  }
  return out;
}

/**
 * Offene Aussaat robust (seit v17, 27.9): nur bekannte, auf dieser Stufe freigeschaltete Pflanzen,
 * verschieden, höchstens 3 + Σ `sowCards` der Forschung (≤ MAX_SOWING_CARDS); Würfe ganzzahlig
 * ≥ 0 (höchstens MAX_REROLLS). Ohne gültige Karte null.
 */
function loadSowing(raw: unknown, stage: number, research: readonly string[]): SowingState | null {
  if (!isRecord(raw)) return null;
  const max = Math.min(MAX_SOWING_CARDS, CARDS_PER_ENCOUNTER + Math.max(0, Math.floor(researchSowing(research, 'sowCards'))));
  const cards = unique(stringArray(raw.cards).filter((id) => (PLANTS_BY_ID.get(id)?.unlock ?? Infinity) <= stage)).slice(0, max);
  if (cards.length === 0) return null;
  return { cards, rerolls: Math.floor(clampedOr(raw.rerolls, 0, 0, MAX_REROLLS)) };
}

/** Pflanzen, die irgendein Ereignis als geschenkte Aussaat vorgibt (Wirkung `freeSowing`). */
const FREE_SOWING_IDS: ReadonlySet<string> = new Set(
  EVENTS.flatMap((e) => e.options.flatMap((o) => o.effects.flatMap((x) => (x.kind === 'freeSowing' ? x.ids : [])))),
);

/**
 * Geschenkte Aussaat der Vogelsaat (seit v17, 27.9): nur IDs, die ein in diesem Zyklus gezogenes
 * Ereignis als geschenkte Aussaat vorgibt (Wirkung `freeSowing`), je einmal; sonst null.
 */
function loadFreeSowing(raw: unknown, seen: readonly string[]): { ids: string[] } | null {
  if (!isRecord(raw)) return null;
  const offered = new Set(
    EVENTS.filter((e) => seen.includes(e.id)).flatMap((e) =>
      e.options.flatMap((o) => o.effects.flatMap((x) => (x.kind === 'freeSowing' ? x.ids : []))),
    ),
  );
  const ids = unique(stringArray(raw.ids).filter((id) => offered.has(id)));
  return ids.length > 0 ? { ids } : null;
}

/**
 * Was ein Stand noch an „Etwas keimt“ mitbringt (bis Phase 10): offene Pflanzenbegegnungen
 * (Karten schon geprüft) und die Vorgabe `forced` vom Typ `'plant'` (IDs schon geprüft).
 */
interface DeferredPlants {
  encounters: SowingState[];
  forced: string[] | null;
}

/**
 * „Etwas keimt“ → Aussaat (DESIGN_V2.md 27.9 Schritt 4; gleiche Regel für migrierte v16-Stände
 * und beim robusten Laden ab v17, ohne neue Version – die v17-Felder gibt es schon): Die erste
 * offene Pflanzenbegegnung wird die offene Aussaat (gleiche Karten und Würfe, höchstens
 * sowingCardCount Karten), sofern keine offen ist; jede weitere zieht weiter wie Ablehnen
 * (declineReward, Samen gutgeschrieben). Die Vorgabe `forced` Pflanze wird eine geschenkte
 * Aussaat (`cycle.freeSowing`), sofern keine wartet. Der Aussaat-Zähler bleibt: geschenkt.
 */
function convertPlantEncounters(state: GameState, deferred: DeferredPlants): void {
  for (const encounter of deferred.encounters) {
    if (!state.cycle.sowing) {
      state.cycle.sowing = { cards: encounter.cards.slice(0, sowingCardCount(state.cycle.research)), rerolls: encounter.rerolls };
    } else {
      state.seeds = Math.min(Number.MAX_VALUE, state.seeds + declineReward(state));
    }
  }
  // Wie beim Laden von `freeSowing`: nur, wenn das Ereignis in diesem Zyklus gezogen wurde.
  if (deferred.forced && !state.cycle.freeSowing) state.cycle.freeSowing = loadFreeSowing({ ids: deferred.forced }, state.cycle.seen);
}

/** Forschungsplan robust (seit v17): bekannte Knoten je einmal, `auto` nur echtes true. */
function loadResearchPlan(raw: unknown): ResearchPlan {
  const r = isRecord(raw) ? raw : {};
  return { plan: unique(stringArray(r.plan).filter((id) => RESEARCH_BY_ID.has(id))), auto: r.auto === true };
}

/**
 * Speichert den Spielstand. Rückgabe: der geschriebene Text (z. B. für eine Prüfsumme) oder
 * null, wenn das Schreiben scheiterte (Speicher voll oder blockiert, z. B. privater Modus) –
 * das Spiel läuft trotzdem weiter.
 */
export function saveToStorage(state: GameState, storage: Storage = localStorage): string | null {
  try {
    const raw = serialize(state);
    storage.setItem(SAVE_KEY, raw);
    return raw;
  } catch {
    return null;
  }
}

export function loadFromStorage(now: number, storage: Storage = localStorage): LoadResult | null {
  try {
    return loadGame(storage.getItem(SAVE_KEY), now);
  } catch {
    return null;
  }
}

/**
 * Liegt im Speicher ein Stand aus einer neueren Spielversion (version > SAVE_VERSION)?
 * Dann darf dieses Spiel ihn weder laden noch überschreiben: Es kennt seine neuen Nischen,
 * Arten und Ereignisse nicht und würde sie beim Laden still verwerfen (DESIGN_V2.md 22.8,
 * 23.6) – wie beim Import („newer“) und beim Konto-Abgleich (`isNewerSchema`). Fehlerhafter
 * oder blockierter Speicher → false.
 */
export function storedSaveIsNewer(storage: Storage = localStorage): boolean {
  try {
    const raw = storage.getItem(SAVE_KEY);
    return raw !== null && isNewerSave(raw);
  } catch {
    return false;
  }
}

export function clearStorage(storage: Storage = localStorage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // ignorieren
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Zahl in [min, max]; NaN und Nicht-Zahlen → fallback, ±Infinity → Grenze. */
function clampedOr(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------
// Spielstand als Text-Code (Exportieren / Importieren)
// ---------------------------------------------------------------------------

/** Präfix des Text-Codes („Vom Samen zum Wald“, Format 1). */
export const EXPORT_PREFIX = 'VSZW1:';
/** Längere Codes werden gar nicht erst dekodiert (Schutz vor riesigen Eingaben). */
export const MAX_EXPORT_CODE_LENGTH = 200_000;

/** Warum ein Code nicht geladen werden konnte. */
export type ImportError =
  /** Leere Eingabe. */
  | 'empty'
  /** Länger als MAX_EXPORT_CODE_LENGTH. */
  | 'too-large'
  /** Kein Code dieses Spiels (Präfix, Aufbau oder Zeichen falsch). */
  | 'format'
  /** Prüfsumme passt nicht – der Code wurde unvollständig oder verändert kopiert. */
  | 'checksum'
  /** Der Inhalt ist kein brauchbarer Spielstand. */
  | 'invalid'
  /**
   * Stand einer neueren Spielversion (version > SAVE_VERSION): Dieses Spiel kennt seine
   * Felder nicht und würde sie beim Speichern verlieren – nie laden.
   */
  | 'newer';

export type ImportResult = { ok: true; result: LoadResult } | { ok: false; error: ImportError };

/**
 * Spielstand als Text-Code: `VSZW1:<Base64url des JSON>.<Prüfsumme>`. Deterministisch
 * (gleicher Stand → gleicher Code), nur URL-sichere Zeichen, ohne Zeilenumbrüche.
 */
export function exportCode(state: GameState): string {
  return codeFromJson(serialize(state));
}

/** Kodiert einen gespeicherten Stand (JSON-Text, auch ältere Versionen) als Text-Code. */
export function codeFromJson(json: string): string {
  const payload = base64UrlEncode(new TextEncoder().encode(json));
  return `${EXPORT_PREFIX}${payload}.${checksum(payload)}`;
}

/**
 * Liest einen Text-Code und lädt ihn wie einen gespeicherten Stand (loadGame: robust,
 * mit Migration alter Versionen). Leerraum (Zeilenumbrüche beim Kopieren) wird ignoriert.
 * Die Uhr startet beim Import neu (`lastTick = now`) – ein Import bringt keine
 * Offline-Zeit. Verändert nichts außerhalb des Ergebnisses. Mit `keepClock` bleibt die Uhr
 * des Codes stehen (Konto-Abgleich: die Zeit seit dem Speichern wird nachgerechnet).
 */
export function importCode(code: string, now: number, options: { keepClock?: boolean } = {}): ImportResult {
  // Grobe Prüfung vor dem Entfernen des Leerraums (riesige Eingaben gar nicht erst anfassen).
  if (code.length > 2 * MAX_EXPORT_CODE_LENGTH) return { ok: false, error: 'too-large' };
  const compact = code.replace(/\s+/g, '');
  if (compact.length === 0) return { ok: false, error: 'empty' };
  if (compact.length > MAX_EXPORT_CODE_LENGTH) return { ok: false, error: 'too-large' };
  if (!compact.startsWith(EXPORT_PREFIX)) return { ok: false, error: 'format' };
  const body = compact.slice(EXPORT_PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) return { ok: false, error: 'format' };
  const payload = body.slice(0, dot);
  const sum = body.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{8}$/.test(sum)) return { ok: false, error: 'format' };
  if (checksum(payload) !== sum) return { ok: false, error: 'checksum' };
  const bytes = base64UrlDecode(payload);
  if (!bytes) return { ok: false, error: 'format' };
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (isNewerSave(json)) return { ok: false, error: 'newer' };
  let result: LoadResult | null;
  try {
    result = loadGame(json, now);
  } catch {
    // z. B. zu tief verschachteltes JSON – lieber „ungültig“ als ein Absturz.
    return { ok: false, error: 'invalid' };
  }
  if (!result) return { ok: false, error: 'invalid' };
  if (!options.keepClock) result.state.lastTick = now;
  return { ok: true, result };
}

/**
 * Stammt der gespeicherte Stand (JSON-Text) aus einer neueren Spielversion? Kaputtes JSON
 * oder ohne Version → false (darüber entscheidet loadGame).
 */
export function isNewerSave(json: string): boolean {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return false;
  }
  if (!isRecord(data)) return false;
  return typeof data.version === 'number' && Number.isFinite(data.version) && data.version > SAVE_VERSION;
}

/** FNV-1a (32 Bit) über die Zeichen – einfach und deterministisch, als 8 Hex-Ziffern. */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url ohne Auffüllzeichen (eigene Umsetzung, damit der Kern ohne btoa auskommt). */
function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]!;
    if (b !== undefined) out += BASE64URL[(n >> 6) & 63]!;
    if (c !== undefined) out += BASE64URL[n & 63]!;
  }
  return out;
}

/** Gegenstück zu base64UrlEncode; null bei unmöglicher Länge oder fremden Zeichen. */
function base64UrlDecode(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const v = k < chunk.length ? BASE64URL.indexOf(chunk[k]!) : 0;
      if (v < 0) return null;
      n = (n << 6) | v;
    }
    out[o++] = (n >> 16) & 255;
    if (chunk.length > 2) out[o++] = (n >> 8) & 255;
    if (chunk.length > 3) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
