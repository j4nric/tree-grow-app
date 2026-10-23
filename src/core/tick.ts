import {
  CARDS_PER_ENCOUNTER,
  ENCOUNTER_WEIGHTS,
  FORCED_MAX_CARDS,
  INTERLUDE_CHANCE,
  INTERLUDE_POSITION,
  INTERLUDE_STAGE,
  INTERLUDE_WEIGHTS,
  MAX_PENDING_ENCOUNTERS,
  PLANT_WEIGHT_IN_RING,
  PLANT_WEIGHT_RING_FULL,
  SCRIPTED_ENCOUNTERS,
} from '../content/encounters';
import { CARE_BY_ID, type CareMeasure, type CareRank } from '../content/care';
import { EVENTS, EVENTS_BY_ID, type GameEvent } from '../content/events';
import { WEATHER_EVENT_FACTORS } from '../content/predation';
import { JOURNAL_SPECIES_WEIGHT, NEW_CYCLE_MIN_STAGE } from '../content/memory';
import { PLANTS, PLANTS_BY_ID } from '../content/plants';
import { SPECIES, SPECIES_BY_ID } from '../content/species';
import {
  EVENT_SEASONS,
  SEASONS_BY_ID,
  SEASON_IDS,
  SEASON_SECONDS,
  VISITOR_SEASONS,
  YEAR_SECONDS,
  type SeasonId,
} from '../content/seasons';
import { STAGES } from '../content/stages';
import {
  CORRIDORS,
  CORRIDORS_BY_ID,
  FEATURED_GENUS_WEIGHT,
  HOME_SITE,
  LANDSCAPE_SITES_BY_ID,
  MAX_SITE_FAUNA,
  SITE_IDS,
  type SiteId,
} from '../content/landscape';
import { DEFAULT_MAIN_TREE, MAIN_TREES, MAIN_TREES_BY_ID, type MainTreeId } from '../content/trees';
import { ENCOUNTER_TYPES, type EncounterType } from '../content/types';
import { VISITORS, VISITORS_BY_ID, type Visitor } from '../content/visitors';
import { WAYPOINT_COUNT } from '../content/waypoints';
import {
  activeCommunities,
  appearsContext,
  cycleMemoryGain,
  harmonyMemoryGain,
  memoryHarmonyBonus,
  declineReward,
  ecosystemOf,
  evaluateEcosystem,
  evaluate,
  nextPlantCost,
  nicheSlots,
  nichesAfterChoice,
  plantSlots,
  rarityWeights,
  regularSlots,
  regularSlotsOf,
  rerollCost,
  resolveChoice,
  seedSeconds,
  slotBonuses,
  speciesAppears,
  stageForWaypoint,
  thresholdFor,
  type ChoiceError,
  type Evaluation,
  type MemoryHarmonyBonus,
} from './formulas';
import { checkAchievements } from './achievements';
import {
  ANCIENT_STAGE,
  activeSite,
  corridorBetween,
  effectiveMemoryOf,
  featuredGenera,
  isSiteAncient,
  isSiteFounded,
  jaySeeds,
  landscapeOf,
  landscapeUnlocked,
  nextFoundingCost,
  ownMemory,
  siteEntry,
  wildwechselChance,
  wildwechselRoutes,
  type JaySeeds,
  type WildwechselRoute,
} from './landscape';
import { countDailyAction } from './daily-actions';
import { refreshDailyAfterNewCycle } from './daily';
import { pick, random, randomInt, weightedIndex, type RngHolder } from './rng';
import { MAX_ELAPSED, nextSeasonBoundary, normalizeElapsed, seasonIdAt, secondsToNextSeason } from './season';
import { GENTLE_DAYS, OFFLINE_AVERAGE_MIN_SECONDS, type WeatherId } from '../content/weather';
import { dayIndex, nextNightChange, secondsToNightChange, weatherOfDay, weatherSeed, weatherOfDayFromSeed, weatherSiteOf, type AmbientMode, type WeatherHolder } from './weather';
import {
  MAX_FOREST_MEMORY,
  allAnimals,
  createCycle,
  createSite,
  emptyNiches,
  isCardEncounter,
  type CardEncounterType,
  type ForcedEncounter,
  type GameState,
  type LifetimeStats,
  type FirstSeenJournal,
  type PendingEncounter,
} from './state';

/** Offline-Fortschritt wird auf diese Dauer begrenzt. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;

/** Was während eines Ticks (oder offline) passiert ist. */
export interface TickReport {
  /** Neu erreichte Wegpunkte. */
  waypoints: number;
  /** Davon als Begegnung in die Warteschlange gelegt. */
  encounters: number;
  /** Automatisch abgelehnt (Warteschlange voll oder keine Art verfügbar); Summe der beiden folgenden. */
  autoDeclined: number;
  /** Davon abgelehnt, weil die Warteschlange voll war. */
  declinedStackFull: number;
  /** Davon abgelehnt, weil weder Art noch Pflanze in Frage kam. */
  declinedNoCards: number;
  /** Summe der für automatisch abgelehnte Begegnungen gutgeschriebenen Samen (Rate je Wegpunkt). */
  declinedSeeds: number;
  /** Eingezogene Stammgäste (Art-IDs, in Reihenfolge des Einzugs). */
  regulars: string[];
  /** Am Zwischenhalt (ab Hain) in die Warteschlange gelegte Ereignisse und Gäste. */
  interludes: number;
  /**
   * Erreichte Zwischenhalte – auch ohne Ergebnis. Auch dann ändert sich der Spielstand
   * (Zufall, `cycle.interlude`): main.ts speichert sofort, damit Neuladen nichts neu würfelt.
   */
  interludesReached: number;
  /** Abgelaufene Zeit-Boni (Ereignis-IDs) und abgereiste Gäste (Gast-IDs). */
  expired: string[];
  /** Erreichte Jahreszeiten in Reihenfolge (je Wechsel ein Eintrag, für den Hinweis in der UI). */
  seasons: SeasonId[];
  /**
   * Wetter der erreichten Tage, parallel zu `seasons` (je Wechsel ein Eintrag, gekürzt wie
   * `seasons`). Auch offline gefüllt – dort nur für den Text („4 × Regen“), gerechnet wird
   * mit dem Mittel (OfflineReport.averaged).
   */
  weather: WeatherId[];
  /**
   * Wildwechsel-Karten (DESIGN_V2.md 24.6) in Reihenfolge der Wegpunkte: Art, Herkunftswald,
   * Korridor, Begegnung (`encounter`, Index in `pendingEncounters` nach dem Tick) und Platz der
   * Karte in ihr (`card`, Index in `cards`). Höchstens eine je Begegnung.
   */
  wildwechsel: WildwechselCard[];
}

/** Eine Wildwechsel-Karte: diese Art kam über `corridor` aus dem Bestand von `from`. */
export interface WildwechselCard extends WildwechselRoute {
  /**
   * Index der Begegnung in `pendingEncounters`. Gilt direkt nach dem Tick (ein Tick legt nur
   * an, entfernt nichts); entscheidet der Spieler danach, verschieben sich die Indizes.
   */
  encounter: number;
  /** Index der Karte in `PendingEncounter.cards`. */
  card: number;
}

/** Ergebnis von drawWildwechsel: die Karte ohne Begegnung (die kennt erst reachWaypoint). */
export type WildwechselDraw = Omit<WildwechselCard, 'encounter'>;

export interface OfflineReport extends TickReport {
  /** Tatsächlich simulierte Sekunden (nach Begrenzung). */
  seconds: number;
  /** Mit Mittelwetter und halber Nachtwirkung gerechnet (ab OFFLINE_AVERAGE_MIN_SECONDS, 21.5)? */
  averaged: boolean;
  growth: number;
  seeds: number;
}

/** Restdauern ab hier gelten als abgelaufen (Rundung bei vielen kleinen Ticks). */
const EXPIRY_EPSILON = 1e-9;

/**
 * Längster Tick mit Einzelwetter (100 Jahre Spielzeit = 20 h). Ein noch größerer Tick
 * (nur in Tests oder nach absurden Uhrsprüngen; online kommt höchstens 1 s je Frame,
 * offline rechnet simulateOffline gemittelt) rechnet ganz im Modus „Mittel“: Mit
 * Einzelwetter bräuchte er je Tag drei Runden und könnte keine Jahre überspringen.
 */
export const MAX_LIVE_SECONDS = 100 * YEAR_SECONDS;

/**
 * Lässt `dt` Sekunden Spielzeit vergehen. Verändert `state` direkt.
 * Ereignisgesteuert: Die Raten sind konstant bis zum nächsten Halt – dem nächsten
 * Wegpunkt, dem Zwischenhalt (ab Hain, über das Gesamt-Wachstum wie Wegpunkte), dem
 * Ablauf eines Zeit-Bonus bzw. Gastes (kleinste Restdauer) oder dem Wechsel der
 * Jahreszeit (`cycle.elapsed`, dort exakt auf die Grenze gesetzt). Bis dahin wird in
 * einem Schritt gerechnet. Darum liefern viele kleine Ticks und ein großer dasselbe Ergebnis
 * (bis auf Rundung). Deterministisch: Zeit kommt nur über `dt`, Zufall nur über
 * `state.rngState`.
 *
 * Wetter und Nacht (DESIGN_V2.md 21) nach `ambient`: `live` (Standard) mit dem Wetter des
 * Tages und Halten bei Sonnenuntergang und -aufgang (Sekunde 81 und 171 jedes Tages; der
 * Wetterwechsel fällt auf den Jahreszeiten-Halt), `average` mit dem Mittelwetter je
 * Jahreszeit (Tag 0 sein festes Wetter, Schonzeit ohne raue Lagen: averageWeatherOf) und
 * der halben Nachtwirkung ohne Nacht-Halte (offline), `off` ohne beides.
 * Ganze Jahre werden nur ohne Einzelwetter übersprungen.
 */
export function tick(state: GameState, dt: number, ambient: AmbientMode = 'live'): TickReport {
  const report: TickReport = {
    waypoints: 0,
    encounters: 0,
    autoDeclined: 0,
    declinedStackFull: 0,
    declinedNoCards: 0,
    declinedSeeds: 0,
    regulars: [],
    interludes: 0,
    interludesReached: 0,
    expired: [],
    seasons: [],
    weather: [],
    wildwechsel: [],
  };
  if (!(dt > 0) || !Number.isFinite(dt)) return report;
  const mode: AmbientMode = ambient === 'live' && dt > MAX_LIVE_SECONDS ? 'average' : ambient;
  // Kaputte Spielzeit (NaN, negativ, zu groß) nicht weiterschleppen.
  state.cycle.elapsed = normalizeElapsed(state.cycle.elapsed);
  let remaining = dt;
  // Schleife endet: Jede Runde verbraucht die Restzeit oder erreicht einen Halt – davon
  // gibt es endlich viele (Wegpunkte, je ein Zwischenhalt, endlich viele Boni, eine
  // Jahreszeitgrenze je SEASON_SECONDS, live zwei Nachtgrenzen je Tag).
  while (remaining > 0) {
    // Lange Zeitsprünge: ganze Jahre am Stück, solange darin kein anderer Halt liegt
    // (nicht mit Einzelwetter – jedes Jahr hat anderes Wetter).
    const years = mode === 'live' ? 0 : skipYears(state, remaining, report, mode);
    if (years > 0) {
      remaining -= years * YEAR_SECONDS;
      continue;
    }
    const ev = evaluate(state, mode);
    const next = thresholdFor(state.waypoint + 1);
    const rate = ev.growth > 0 && Number.isFinite(ev.growth) ? ev.growth : 0;
    const toNext = rate > 0 ? Math.max(0, next - state.totalGrowth) / rate : Infinity;
    const interlude = interludeThreshold(state);
    const toInterlude = rate > 0 && interlude < Infinity ? Math.max(0, interlude - state.totalGrowth) / rate : Infinity;
    const toExpiry = nextExpiry(state);
    let toSeason = secondsToNextSeason(state.cycle.elapsed);
    // Endet der Schritt nur Rundungsrauschen vor oder hinter der Grenze (Restzeit und
    // Spielzeit werden getrennt aufsummiert), gilt die Grenze als genau erreicht – sonst
    // landet offline (ein großer Tick mit Halten) bei 179,99999999999997 s bzw.
    // 180,00000000000003 s, online (ganze Sekunden) bei 180 s.
    if (Math.abs(toSeason - remaining) <= SEASON_SNAP_SECONDS) toSeason = remaining;
    // Sonnenuntergang und -aufgang: nur mit Einzelwetter ein Halt (die Nachtwirkung wechselt).
    let toNight = mode === 'live' ? secondsToNightChange(state.cycle.elapsed) : Infinity;
    if (Math.abs(toNight - remaining) <= SEASON_SNAP_SECONDS) toNight = remaining;
    const step = Math.min(remaining, toNext, toInterlude, toExpiry, toSeason, toNight);
    state.seeds = capped(state.seeds + ev.seeds * step);
    remaining -= step;
    countDown(state, step, report);
    // Spielzeit zuerst: Fällt die Grenze mit einem Wegpunkt zusammen, sieht die Begegnung
    // schon die neue Jahreszeit. An der Grenze exakt setzen (kein Rundungsdrift).
    if (step === toSeason) {
      state.cycle.elapsed = nextSeasonBoundary(state.cycle.elapsed);
      reportSeason(report, seasonIdAt(state.cycle.elapsed), weatherOfDay(state.cycle, dayIndex(state.cycle.elapsed), weatherSiteOf(state)));
      // Die Jahreszeit hebt oder senkt die Harmonie: H_max hier nachführen.
      raiseMaxHarmony(state, evaluate(state, mode).harmony);
    } else if (step === toNight) {
      // Exakt auf die Grenze (Sekunde 81 bzw. 171), wie bei der Jahreszeit.
      state.cycle.elapsed = nextNightChange(state.cycle.elapsed);
    } else {
      state.cycle.elapsed = normalizeElapsed(state.cycle.elapsed + step);
    }
    if (step === toNext) {
      // Wegpunkt genau erreicht (ohne Rundungsfehler, damit online und offline gleich zählen)
      state.totalGrowth = Math.max(state.totalGrowth, next);
      reachWaypoint(state, report, mode);
    } else if (step === toInterlude) {
      state.totalGrowth = Math.max(state.totalGrowth, interlude);
      reachInterlude(state, report, mode);
    } else {
      state.totalGrowth = capped(state.totalGrowth + rate * step);
    }
  }
  // Langzeit-Statistik: die ganze Spielzeit (auch über MAX_ELAPSED hinaus), je Tick einmal.
  // Das Wachstum braucht hier nichts – es steht exakt in `totalGrowth` (lifetimeGrowth).
  state.meta.stats.playSeconds = capped(state.meta.stats.playSeconds + dt);
  return report;
}

/** Obergrenze der Zähler in `meta.stats` (bleiben ganzzahlig). */
export const MAX_STAT_COUNT = Number.MAX_SAFE_INTEGER;

type StatCounter = Extract<
  keyof LifetimeStats,
  'cardsChosen' | 'eventsDecided' | 'visitorsHosted' | 'plantsPlanted' | 'careRanksBought' | 'wildwechselChosen'
>;

/** Zählt einen Zähler der Langzeit-Statistik um 1 hoch (höchstens bis MAX_STAT_COUNT). */
function countStat(state: GameState, key: StatCounter): void {
  state.meta.stats[key] = Math.min(MAX_STAT_COUNT, state.meta.stats[key] + 1);
}

/** Toleranz für das Erreichen einer Jahreszeitengrenze (Gleitkomma-Rest, siehe tick). */
export const SEASON_SNAP_SECONDS = 1e-9;

/** So viele Jahreszeitwechsel merkt sich ein TickReport höchstens (die letzten; 8 h offline = 160). */
export const MAX_REPORTED_SEASONS = 160;

function reportSeason(report: TickReport, id: SeasonId, weather: WeatherId): void {
  report.seasons.push(id);
  report.weather.push(weather);
  if (report.seasons.length > MAX_REPORTED_SEASONS) report.seasons.shift();
  if (report.weather.length > MAX_REPORTED_SEASONS) report.weather.shift();
}

/**
 * Schnellvorlauf über ganze Jahre (nur an einer Jahresgrenze, also zu Frühlingsbeginn):
 * Die Raten sind je Jahreszeit konstant, solange kein anderer Halt kommt – dann ergibt
 * ein Jahr genau 180 s × Σ Rate je Jahreszeit. Gesprungen wird nur über Jahre, in denen
 * weder Wegpunkt noch Zwischenhalt (über das Wachstum) noch der Ablauf eines Bonus liegt,
 * und nie über MAX_ELAPSED hinaus. Gibt die übersprungenen Jahre zurück (0 = normal
 * weiterrechnen). Ohne diesen Vorlauf bräuchte ein riesiger Zeitsprung je 180 s eine
 * Runde; im Spiel (≤ 8 h offline) ändert er nur die Rundung.
 */
function skipYears(state: GameState, remaining: number, report: TickReport, mode: Exclude<AmbientMode, 'live'>): number {
  const elapsed = state.cycle.elapsed;
  let years = Math.floor(remaining / YEAR_SECONDS);
  if (years < 1 || elapsed % YEAR_SECONDS !== 0) return 0;
  // Mittel erst nach der Schonzeit überspringen (davor gilt je Tag ein anderes Mittel).
  if (mode === 'average' && elapsed < GENTLE_DAYS * SEASON_SECONDS) return 0;
  years = Math.min(years, Math.floor((MAX_ELAPSED - elapsed) / YEAR_SECONDS));
  // Kein Bonus darf in den Jahren ablaufen (genau am Ende zählt schon: lieber normal rechnen).
  const expiry = nextExpiry(state);
  if (expiry < Infinity) years = Math.min(years, Math.ceil(expiry / YEAR_SECONDS) - 1);
  if (years < 1) return 0;
  // Raten je Jahreszeit (wie evaluate, nur mit der jeweiligen Jahreszeit; im Mittel-Modus
  // mit dem Mittelwetter dieser Jahreszeit und dem Nachtanteil).
  const eco = ecosystemOf(state, {}, mode);
  let growth = 0;
  let seeds = 0;
  const harmonies: number[] = [];
  for (const id of SEASON_IDS) {
    const ev = evaluateEcosystem({ ...eco, season: id });
    growth += (ev.growth > 0 && Number.isFinite(ev.growth) ? ev.growth : 0) * SEASON_SECONDS;
    seeds += ev.seeds * SEASON_SECONDS;
    harmonies.push(ev.harmony);
  }
  // Wegpunkt und Zwischenhalt: nur Jahre, nach denen die Schwelle noch nicht erreicht ist.
  for (const threshold of [thresholdFor(state.waypoint + 1), interludeThreshold(state)]) {
    if (growth > 0 && threshold < Infinity) years = Math.min(years, Math.ceil((threshold - state.totalGrowth) / growth) - 1);
  }
  if (!(years >= 1)) return 0;
  state.seeds = capped(state.seeds + seeds * years);
  state.totalGrowth = capped(state.totalGrowth + growth * years);
  state.cycle.elapsed = elapsed + years * YEAR_SECONDS;
  countDown(state, years * YEAR_SECONDS, report);
  // Jede Jahreszeit wurde durchlaufen: H_max wie beim schrittweisen Wechsel nachführen.
  for (const h of harmonies) raiseMaxHarmony(state, h);
  // Je Jahr die Wechsel Sommer, Herbst, Winter, Frühling (gemerkt werden nur die letzten)
  // mit dem Wetter dieser Tage (nur für den Text; gerechnet wurde ohne Einzelwetter).
  const reported = Math.min(years, Math.ceil(MAX_REPORTED_SEASONS / SEASON_IDS.length));
  const seed = weatherSeed(state.cycle);
  const site = weatherSiteOf(state);
  const lastDay = dayIndex(state.cycle.elapsed);
  for (let y = reported - 1; y >= 0; y--) {
    const yearStart = lastDay - y * SEASON_IDS.length;
    for (let i = 1; i <= SEASON_IDS.length; i++) {
      const day = yearStart - SEASON_IDS.length + i;
      reportSeason(report, SEASON_IDS[i % SEASON_IDS.length]!, weatherOfDayFromSeed(seed, day, site));
    }
  }
  return years;
}

/** Kleinste Restdauer eines Zeit-Bonus oder Gastes (Infinity, wenn keiner wirkt). */
export function nextExpiry(state: GameState): number {
  let next = Infinity;
  for (const t of state.cycle.timed) next = Math.min(next, Math.max(0, t.remaining));
  for (const v of state.cycle.visitors) next = Math.min(next, Math.max(0, v.remaining));
  return next;
}

/** Zieht `seconds` von allen Restdauern ab und entfernt Abgelaufenes. */
function countDown(state: GameState, seconds: number, report: TickReport): void {
  const cycle = state.cycle;
  if (cycle.timed.length === 0 && cycle.visitors.length === 0) return;
  const timed = [];
  for (const t of cycle.timed) {
    const left = t.remaining - seconds;
    if (left > EXPIRY_EPSILON) timed.push({ ...t, remaining: left });
    else report.expired.push(t.source);
  }
  const visitors = [];
  for (const v of cycle.visitors) {
    const left = v.remaining - seconds;
    if (left > EXPIRY_EPSILON) visitors.push({ ...v, remaining: left });
    else report.expired.push(v.id);
  }
  cycle.timed = timed;
  cycle.visitors = visitors;
}

/**
 * Gesamt-Wachstum des nächsten Zwischenhalts (DESIGN_V2.md 7.2, encounters.ts): ab
 * INTERLUDE_STAGE einmal je Abschnitt zwischen zwei Wegpunkten, bei INTERLUDE_POSITION
 * des Weges. Infinity, wenn keiner mehr ansteht.
 */
export function interludeThreshold(state: GameState): number {
  if (state.stage < INTERLUDE_STAGE || state.cycle.interlude >= state.waypoint || state.waypoint >= WAYPOINT_COUNT) {
    return Infinity;
  }
  const from = thresholdFor(state.waypoint);
  const to = thresholdFor(state.waypoint + 1);
  if (!Number.isFinite(to)) return Infinity;
  return from + INTERLUDE_POSITION * (to - from);
}

/**
 * Zwischenhalt erreicht: mit INTERLUDE_CHANCE ein Ereignis oder ein Gast (Gewichte
 * INTERLUDE_WEIGHTS, nur Typen mit Kandidaten). Bei voller Warteschlange oder ohne
 * Kandidaten passiert nichts – es fehlt ja keine Begegnung.
 */
function reachInterlude(state: GameState, report: TickReport, ambient: AmbientMode = 'live'): void {
  state.cycle.interlude = state.waypoint;
  report.interludesReached++;
  if (state.pendingEncounters.length >= MAX_PENDING_ENCOUNTERS) return;
  if (random(state) >= INTERLUDE_CHANCE) return;
  const events = eligibleEvents(state);
  const visitors = eligibleVisitors(state);
  const weights = [
    events.length > 0 ? INTERLUDE_WEIGHTS[0] * seasonFactor(state, 'event') : 0,
    visitors.length > 0 ? INTERLUDE_WEIGHTS[1] * seasonFactor(state, 'visitor') : 0,
  ];
  const i = weightedIndex(state, weights);
  if (i < 0) return;
  const encounter = i === 0 ? eventEncounter(state, pickEvent(state, events, ambient)) : visitorEncounter(state, pick(state, visitors));
  state.pendingEncounters.push(encounter);
  report.encounters++;
  report.interludes++;
}

/**
 * Faktor der laufenden Jahreszeit auf das Gewicht eines Begegnungstyps (fehlt = 1;
 * ungültige Werte zählen als 1, damit nie ein Typ ganz ausfällt).
 */
export function seasonFactor(state: GameState, type: EncounterType): number {
  const factor = SEASONS_BY_ID.get(seasonIdAt(state.cycle.elapsed))?.encounterFactors?.[type];
  return factor !== undefined && Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/** Kommt das Ereignis bzw. der Gast in der laufenden Jahreszeit (fehlt der Eintrag: ganzjährig)? */
export function inSeason(state: GameState, table: Readonly<Record<string, readonly SeasonId[]>>, id: string): boolean {
  const seasons = Object.hasOwn(table, id) ? table[id] : undefined;
  return !seasons || seasons.includes(seasonIdAt(state.cycle.elapsed));
}

/**
 * Begrenzt +Infinity auf die größte endliche Zahl: JSON.stringify schriebe sonst `null`
 * in den Spielstand. (Bis „Urwald“ unerreichbar – Schutz für riesige Zeitsprünge.)
 */
function capped(value: number): number {
  return value > Number.MAX_VALUE ? Number.MAX_VALUE : value;
}

/**
 * Simuliert die Zeit, in der das Spiel geschlossen war (höchstens 8 Stunden).
 * Begegnungen werden wie online gezogen; mehr als 3 offene werden automatisch
 * abgelehnt und als Samen gutgeschrieben. Ab OFFLINE_AVERAGE_MIN_SECONDS mit dem
 * Mittelwetter je Jahreszeit und NIGHT_SHARE der Nachtwirkung (tick im Modus `average`).
 */
export function simulateOffline(state: GameState, seconds: number): OfflineReport {
  const total = Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), MAX_OFFLINE_SECONDS) : 0;
  const growthBefore = state.totalGrowth;
  const seedsBefore = state.seeds;
  // Ab einem Tag Abwesenheit: Mittelwetter und halbe Nachtwirkung (DESIGN_V2.md 21.5);
  // kürzere Lücken (Tab kurz verdeckt) wie online.
  const averaged = total >= OFFLINE_AVERAGE_MIN_SECONDS;
  const report = tick(state, total, averaged ? 'average' : 'live');
  return { ...report, seconds: total, averaged, growth: state.totalGrowth - growthBefore, seeds: state.seeds - seedsBefore };
}

/** Automatisches Ablehnen am Wegpunkt: Samen wie beim Ablehnen von Hand, im Bericht summiert. */
function autoDecline(state: GameState, report: TickReport): void {
  const reward = declineReward(state);
  state.seeds = capped(state.seeds + reward);
  report.declinedSeeds = capped(report.declinedSeeds + reward);
  report.autoDeclined++;
}

function reachWaypoint(state: GameState, report: TickReport, ambient: AmbientMode = 'live'): void {
  state.waypoint++;
  state.stage = Math.max(state.stage, stageForWaypoint(state.waypoint));
  report.waypoints++;
  // Stammgäste ziehen in frei gewordene Plätze (auch die der neuen Stufe), bevor die
  // Karten gezogen werden – so bietet die Begegnung sie nicht noch einmal an.
  report.regulars.push(...moveInRegulars(state));
  // Stufe und Stammgäste können die Harmonie ändern (H_max) und Gemeinschaften bilden.
  // Führt auch die Sperrklinke zur neuen Schwelle nach (raiseMaxHarmony).
  recordDiscoveries(state);
  if (state.pendingEncounters.length >= MAX_PENDING_ENCOUNTERS) {
    // Warteschlange voll: überzählige Begegnung gleich ablehnen – nichts verfällt.
    autoDecline(state, report);
    report.declinedStackFull++;
    return;
  }
  const { encounter, wildwechsel } = drawEncounterWithRoute(state, ambient);
  if (!encounter) {
    // Weder Art noch Pflanze kommt in Frage: wie Ablehnen.
    autoDecline(state, report);
    report.declinedNoCards++;
    return;
  }
  state.pendingEncounters.push(encounter);
  report.encounters++;
  if (wildwechsel) report.wildwechsel.push({ ...wildwechsel, encounter: state.pendingEncounters.length - 1 });
}

/**
 * Zieht die Begegnung für den gerade erreichten Wegpunkt (DESIGN_V2.md, 7.1/7.2): Die
 * ersten Wegpunkte sind festgelegt (Tier, Pflanze, Tier), danach entscheidet das
 * Gewicht der Stufe zwischen „Tier zieht ein“ und „Etwas keimt“ (bei vollem Pflanzenring
 * zählt „Etwas keimt“ nur mit PLANT_WEIGHT_RING_FULL). Kommt für den Typ
 * keine Karte in Frage, gibt es den anderen; null, wenn gar nichts passt.
 */
export function drawEncounter(state: GameState, ambient: AmbientMode = 'live'): PendingEncounter | null {
  return drawEncounterWithRoute(state, ambient).encounter;
}

/** drawEncounter mit der Wildwechsel-Karte (falls eine kam) für den TickReport. */
function drawEncounterWithRoute(
  state: GameState,
  ambient: AmbientMode,
): { encounter: PendingEncounter | null; wildwechsel: WildwechselDraw | null } {
  const none = (encounter: PendingEncounter | null) => ({ encounter, wildwechsel: null });
  let type = SCRIPTED_ENCOUNTERS[state.waypoint - 1];
  if (type === undefined && state.cycle.forced) {
    // Vorgabe aus einem Ereignis (`nextEncounter`): gilt für genau diese Begegnung.
    const forced = state.cycle.forced;
    state.cycle.forced = null;
    const built = forcedEncounter(state, forced);
    if (built) return none(built);
    // Passt keine ID mehr: Der Vorzug verfällt still, es wird normal gezogen.
  }
  if (type === undefined) {
    const weights = ENCOUNTER_WEIGHTS[state.stage] ?? ENCOUNTER_WEIGHTS[ENCOUNTER_WEIGHTS.length - 1]!;
    const ringFull = state.plants.length >= plantSlots(state.stage);
    // Jahreszeit: Faktoren auf die Gewichte; der für „Etwas keimt“ nur bei freiem Ring.
    const drawable = ENCOUNTER_TYPES.map((t, i) =>
      t === 'plant' && ringFull ? weights[i]! * PLANT_WEIGHT_RING_FULL : weights[i]! * seasonFactor(state, t),
    );
    type = ENCOUNTER_TYPES[weightedIndex(state, drawable)] ?? 'animal';
    // Ereignis nach Wetter-Gewicht, Gast gleichverteilt; ohne Kandidaten Tier, sonst Pflanze.
    if (type === 'event') {
      const events = eligibleEvents(state);
      if (events.length > 0) return none(eventEncounter(state, pickEvent(state, events, ambient)));
    } else if (type === 'visitor') {
      const visitors = eligibleVisitors(state);
      if (visitors.length > 0) return none(visitorEncounter(state, pick(state, visitors)));
    }
  }
  const order: readonly CardEncounterType[] = type === 'plant' ? ['plant', 'animal'] : ['animal', 'plant'];
  for (const t of order) {
    const cards = drawCards(state, t);
    if (cards.length === 0) continue;
    const wildwechsel = t === 'animal' ? drawWildwechsel(state, cards) : null;
    const encounter: PendingEncounter = { type: t, cards, rerolls: 0 };
    // Markierung im Spielstand (seit v15): Karte und Weg bleiben auch nach dem Neuladen bekannt.
    if (wildwechsel) encounter.via = { card: wildwechsel.card, corridor: wildwechsel.corridor };
    return { encounter, wildwechsel };
  }
  return none(null);
}

/**
 * Wildwechsel-Karte (DESIGN_V2.md 24.6): Mit `wildwechselChance` (je gebautem Korridor am
 * aktiven Wald WILDWECHSEL_CHANCE, höchstens WILDWECHSEL_MAX_CHANCE) ersetzt eine Art aus dem
 * Bestand (`fauna`) eines Nachbarn eine der gezogenen Tierkarten. Regeln wie bei
 * Stammgästen: Freischalt-Stufe und offene Nische (Plätze > 0, wie jede Tierkarte) ja,
 * Erscheinungsbedingung nein; nie eine Art, die schon im Wald lebt oder schon auf einer
 * Karte dieser Begegnung liegt; höchstens eine je Begegnung. Zufall aus `rngState`, nur am
 * Wegpunkt (nicht beim Neu würfeln) – online = offline. Ohne Korridor wird nicht gewürfelt.
 * Verändert `cards` und gibt die Karte zurück (null: kein Wildwechsel).
 */
export function drawWildwechsel(state: GameState, cards: string[]): WildwechselDraw | null {
  if (cards.length === 0) return null;
  const chance = wildwechselChance(state);
  if (!(chance > 0) || !(random(state) < chance)) return null;
  const present = new Set(allAnimals(state));
  const slots = nicheSlots(state.stage, state.niches, slotBonuses(state));
  const candidates = wildwechselRoutes(state).filter((r) => {
    const sp = SPECIES_BY_ID.get(r.species);
    return !!sp && sp.unlock <= state.stage && slots[sp.niche] > 0 && !present.has(sp.id) && !cards.includes(sp.id);
  });
  if (candidates.length === 0) return null;
  const route = pick(state, candidates);
  const card = randomInt(state, cards.length);
  cards[card] = route.species;
  return { ...route, card };
}

/** Karten für einen Begegnungstyp (siehe drawAnimals / drawPlants). */
export function drawCards(
  state: GameState,
  type: CardEncounterType,
  exclude: readonly string[] = [],
  rng: RngHolder = state,
): string[] {
  return type === 'plant' ? drawPlants(state, exclude, rng) : drawAnimals(state, exclude, rng);
}

/**
 * Zieht bis zu drei verschiedene Pflanzenkarten gewichtet (schon im Ring:
 * PLANT_WEIGHT_IN_RING, sonst 1) aus allen Pflanzen, die
 * auf dieser Stufe freigeschaltet sind – auch solche, die schon wachsen (Duplikate
 * erlaubt). Pflanzen in `exclude` kommen nur zum Auffüllen dran (wie bei drawAnimals).
 */
export function drawPlants(state: GameState, exclude: readonly string[] = [], rng: RngHolder = state): string[] {
  const eligible = PLANTS.filter((p) => p.unlock <= state.stage);
  const pools = [eligible.filter((p) => !exclude.includes(p.id)), eligible.filter((p) => exclude.includes(p.id))];
  const cards: string[] = [];
  for (const pool of pools) {
    const left = pool.map((p) => p.id);
    while (cards.length < CARDS_PER_ENCOUNTER && left.length > 0) {
      // Pflanzen, die schon im Ring wachsen, kommen seltener (PLANT_WEIGHT_IN_RING).
      const i = weightedIndex(
        rng,
        left.map((id) => (state.plants.includes(id) ? PLANT_WEIGHT_IN_RING : 1)),
      );
      cards.push(left.splice(i, 1)[0]!);
    }
  }
  return cards;
}

/** Wurde der letzte Wegpunkt erreicht? Danach gibt es keine Begegnungen mehr. */
export function allWaypointsReached(state: GameState): boolean {
  return state.waypoint >= WAYPOINT_COUNT;
}

/**
 * Zieht bis zu drei verschiedene Tierkarten: erst eine Seltenheit nach Gewicht
 * (rarityWeights: Stufe und Glückspilz), dann gleichverteilt eine Art dieser Seltenheit,
 * die freigeschaltet ist, deren Nische offen ist, die noch nicht im Ökosystem lebt und
 * deren Erscheinungsbedingung erfüllt ist (DESIGN_V2.md, 7.3). Seltenheiten ohne
 * passende Art fallen weg (neu gewichtet).
 * Arten in `exclude` (beim Neu würfeln: die bisherigen Karten) kommen nur zum Auffüllen
 * dran, wenn die übrigen Arten nicht für alle Karten reichen.
 * Ab dem zweiten Zyklus ziehen Arten aus dem Naturtagebuch innerhalb ihrer Seltenheit mit
 * doppeltem Gewicht (DESIGN_V2.md, Abschnitt 10); im ersten Zyklus bleibt es gleichverteilt.
 * Gattungen des aktiven Waldtyps (`featured`, 24.6) zählen dazu × FEATURED_GENUS_WEIGHT.
 * Wildwechsel-Karten kommen erst danach (drawWildwechsel, nur am Wegpunkt).
 * Zufall aus `rng` (Standard: der Spielstand selbst). `minRarity` (Standard 0): nur Arten ab
 * dieser Seltenheit (Belohnung der Tagesziele, DESIGN_V2.md 20).
 */
export function drawAnimals(
  state: GameState,
  exclude: readonly string[] = [],
  rng: RngHolder = state,
  minRarity = 0,
): string[] {
  const slots = nicheSlots(state.stage, state.niches, slotBonuses(state));
  const present = new Set(allAnimals(state));
  const appears = appearsContext(ecosystemOf(state));
  const eligible = SPECIES.filter(
    (s) => s.unlock <= state.stage && slots[s.niche] > 0 && !present.has(s.id) && speciesAppears(appears, s),
  );
  const pools = [eligible.filter((s) => !exclude.includes(s.id)), eligible.filter((s) => exclude.includes(s.id))];
  const weights = rarityWeights(state);
  const journal = state.cycle.number > 1 ? new Set(state.meta.journal.species) : null;
  // Gattungen des Waldtyps (24.6): × FEATURED_GENUS_WEIGHT in ihrer Seltenheit, mit dem Tagebuch multipliziert.
  const featured = featuredGenera(state);
  const weighted = journal !== null || featured.length > 0;
  const cards: string[] = [];
  for (const pool of pools) {
    while (cards.length < CARDS_PER_ENCOUNTER) {
      const byRarity = [0, 1, 2, 3].map((r) => pool.filter((s) => s.rarity === r && !cards.includes(s.id)));
      const r = weightedIndex(
        rng,
        weights.map((w, idx) => (byRarity[idx]!.length > 0 && idx >= minRarity ? w : 0)),
      );
      if (r < 0) break;
      const choices = byRarity[r]!;
      const chosen = weighted
        ? choices[
            weightedIndex(
              rng,
              choices.map(
                (s) =>
                  (journal?.has(s.id) ? JOURNAL_SPECIES_WEIGHT : 1) * (featured.includes(s.genus) ? FEATURED_GENUS_WEIGHT : 1),
              ),
            )
          ]!
        : pick(rng, choices);
      cards.push(chosen.id);
    }
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Spieleraktionen
// ---------------------------------------------------------------------------

export type ActionError =
  /** Fehler beim Wählen einer Karte (siehe ChoiceError in formulas.ts). */
  | ChoiceError
  | 'too-expensive'
  /** Keine Art bzw. Pflanze kommt in Frage. */
  | 'no-cards'
  /** Neu würfeln brächte nur dieselben Karten (zu wenige passende Arten). */
  | 'no-alternatives'
  /** Pflanze setzen: unbekannte Pflanzen-ID. */
  | 'unknown-plant'
  /** Pflanze setzen: erst auf einer späteren Stufe freigeschaltet. */
  | 'locked'
  /** Neuer Zyklus: Stufe „Hain“ noch nicht erreicht (Text: newCycleBlocker). */
  | 'cycle-locked'
  /** Neuer Zyklus: Baumart unbekannt oder noch nicht freigeschaltet (unlockedTrees). */
  | 'tree-locked'
  /** Stammgast: unbekannte Art-ID. */
  | 'unknown-species'
  /** Stammgast: Art steht noch nicht im Naturtagebuch. */
  | 'not-discovered'
  /** Stammgast: alle Plätze belegt. */
  | 'no-regular-slot'
  /** Aktion passt nicht zum Begegnungstyp (z. B. Ablehnen bei einem Ereignis). */
  | 'wrong-type'
  /** Ereignis: Diese Option gibt es nicht. */
  | 'no-option'
  /** Gast: rastet schon (nur bei manipulierten Ständen denkbar). */
  | 'already-active'
  /** Pflege (careBlocker): siehe CareBlocker. */
  | CareBlocker;

/**
 * Ergebnis einer Spieleraktion. `discovered`: Lebensgemeinschaften, die durch die Aktion
 * zum ersten Mal entstanden sind (chooseCard, plantSeed) – für die Entdeckungs-Meldung.
 * Fehlt, wenn nichts Neues entdeckt wurde.
 */
/** `regulars`: Stammgäste, die durch die Aktion eingezogen sind (Pflege mit Plätzen). */
export type ActionResult = { ok: true; discovered?: string[]; seeds?: number; regulars?: string[] } | { ok: false; error: ActionError };

const fail = (error: ActionError): ActionResult => ({ ok: false, error });

/** Erfolg; `discovered` nur, wenn wirklich etwas Neues entstanden ist. */
const discoveryResult = (discovered: string[]): ActionResult =>
  discovered.length > 0 ? { ok: true, discovered } : { ok: true };

/**
 * Wählt eine Karte, die Begegnung ist danach erledigt.
 * - Tierkarte: Das Tier zieht in seine Nische. Ist sie voll, muss `replaceId` ein Tier
 *   dieser Nische nennen – es wird entlassen (bleibt im Naturtagebuch).
 * - Pflanzenkarte („Etwas keimt“): Die Pflanze keimt kostenlos im Pflanzring. Ist er
 *   voll, muss `replaceId` eine Pflanze im Ring nennen – sie wird ersetzt.
 * Ohne Ersatz bei voller Nische/vollem Ring bleibt die Begegnung offen ('niche-full' /
 * 'ring-full'); der Spieler kann dann tauschen, ablehnen oder neu würfeln. Ein Tausch,
 * der anderen Tieren den Platz nähme, scheitert mit 'would-evict'. Gleiche Prüfung wie
 * previewChoice / choiceBlocker.
 */
export function chooseCard(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  replaceId?: string,
): ActionResult {
  const outcome = resolveChoice(state, encounterIndex, cardIndex, replaceId);
  if (!outcome.ok) return fail(outcome.error);
  const encounter = state.pendingEncounters[encounterIndex]!;
  const id = encounter.cards[cardIndex]!;
  // Gewählte Wildwechsel-Karte (Erfolg `wildwechsel-1`, DESIGN_V2.md 24.12).
  const viaWildwechsel = encounter.type === 'animal' && encounter.via?.card === cardIndex;
  for (const nicheId of Object.keys(outcome.niches) as (keyof typeof outcome.niches)[]) {
    state.niches[nicheId] = outcome.niches[nicheId];
  }
  state.plants = outcome.plants;
  if (encounter.type === 'animal' && !state.meta.journal.species.includes(id)) {
    state.meta.journal.species.push(id);
    markFirstSeen(state, 'species', id);
    // Neu im Tagebuch: zählt beim Neuen Zyklus fürs Waldgedächtnis.
    if (!state.cycle.newSpecies.includes(id)) state.cycle.newSpecies.push(id);
  }
  state.pendingEncounters.splice(encounterIndex, 1);
  countStat(state, 'cardsChosen');
  if (viaWildwechsel) countStat(state, 'wildwechselChosen');
  countDailyAction(state, 'decide');
  return discoveryResult(recordDiscoveries(state));
}

/**
 * „Zuerst gesehen“ (seit v15, DESIGN_V2.md 25.10): Zyklus und Jahreszeit des Moments, in dem
 * die Art bzw. Pflanze ins Naturtagebuch kommt – nur beim ersten Mal. Entdeckt wird nur durch
 * Aktionen des Spielers (chooseCard, plantSeed); Tick und Offline-Simulation tragen nichts
 * Neues ein, darum gilt online = offline von selbst.
 */
function markFirstSeen(state: GameState, kind: keyof FirstSeenJournal, id: string): void {
  const record = state.meta.journal.firstSeen[kind];
  if (Object.hasOwn(record, id)) return;
  record[id] = { cycle: state.cycle.number, season: seasonIdAt(state.cycle.elapsed) };
}

/**
 * Trägt ins Naturtagebuch ein, was gerade im Ökosystem ist: wachsende Pflanzen und
 * aktive Lebensgemeinschaften (je einmal, in der Reihenfolge der Entdeckung). Arten
 * trägt chooseCard selbst ein. Führt außerdem die höchste Harmonie des Zyklus (H_max)
 * nach. Läuft nach jeder Änderung am Ökosystem: chooseCard, plantSeed, Wegpunkt (Stufe,
 * Stammgäste), Neuer Zyklus und Laden.
 * Gibt die neu entdeckten Lebensgemeinschaften zurück (chooseCard und plantSeed reichen
 * sie als `discovered` an die UI weiter).
 */
export function recordDiscoveries(state: GameState): string[] {
  const journal = state.meta.journal;
  const ev = evaluate(state);
  for (const id of state.plants) {
    if (journal.plants.includes(id)) continue;
    journal.plants.push(id);
    markFirstSeen(state, 'plants', id);
  }
  const fresh = activeCommunities(ev).filter((id) => !journal.communities.includes(id));
  journal.communities.push(...fresh);
  raiseMaxHarmony(state, ev.harmony);
  return fresh;
}

/**
 * Hebt die höchste Harmonie des Zyklus (H_max) auf `harmony`, falls größer – und die beste
 * Harmonie aller Zyklen (`meta.stats.bestHarmony`). Führt danach immer die Sperrklinke der
 * Vorschau nach (raiseBestHarmonyMemory) – auch ohne neue H_max, denn nach einem Wegpunkt
 * (reachWaypoint → recordDiscoveries) gilt eine neue Schwelle.
 */
function raiseMaxHarmony(state: GameState, harmony: number): void {
  if (Number.isFinite(harmony)) {
    if (harmony > state.cycle.maxHarmony) state.cycle.maxHarmony = harmony;
    if (harmony > state.meta.stats.bestHarmony) state.meta.stats.bestHarmony = harmony;
  }
  raiseBestHarmonyMemory(state);
}

/**
 * Sperrklinke (seit v10): merkt sich den besten Harmonie-Anteil des Gedächtnis-Gewinns
 * (harmonyMemoryGain aus H_max und Wegpunkt). Läuft nach jeder Änderung von H_max und nach
 * jedem Wegpunkt – vor dem nächsten Wegpunkt steht darum der Wert zur alten Schwelle schon
 * fest. Hängt nur von H_max und Wegpunkt an diesen Stellen ab: online = offline.
 */
function raiseBestHarmonyMemory(state: GameState): void {
  const now = harmonyMemoryGain(state.cycle.maxHarmony, state.waypoint);
  if (now > state.cycle.bestHarmonyMemory) state.cycle.bestHarmonyMemory = Math.min(MAX_FOREST_MEMORY, now);
}

/**
 * Setzt eine Pflanze für Samen in den Pflanzring (die Samen-Senke, DESIGN_V2.md 4).
 * Kosten: 20 · 1,9^n bei n Begleitpflanzen (nextPlantCost). Duplikate sind erlaubt.
 */
export function plantSeed(state: GameState, plantId: string): ActionResult {
  const blocker = plantBlocker(state, plantId);
  if (blocker) return fail(blocker);
  state.seeds -= nextPlantCost(state);
  state.plants.push(plantId);
  countStat(state, 'plantsPlanted');
  countDailyAction(state, 'plant');
  return discoveryResult(recordDiscoveries(state));
}

/** Warum „Pflanze setzen“ gerade nicht geht – null, wenn es geht. Ändert nichts. */
export function plantBlocker(
  state: GameState,
  plantId: string,
): 'unknown-plant' | 'locked' | 'ring-full' | 'too-expensive' | null {
  const plant = PLANTS_BY_ID.get(plantId);
  if (!plant) return 'unknown-plant';
  if (plant.unlock > state.stage) return 'locked';
  if (state.plants.length >= plantSlots(state.stage)) return 'ring-full';
  if (!(state.seeds >= nextPlantCost(state))) return 'too-expensive';
  return null;
}

/** Kann diese Pflanze jetzt gesetzt werden? (Für den Knopf in der UI.) */
export function canPlant(state: GameState, plantId: string): boolean {
  return plantBlocker(state, plantId) === null;
}

/** Pflanzen, die auf der aktuellen Stufe gesetzt werden können (ohne Blick auf Samen und Ring). */
export function unlockedPlants(state: Pick<GameState, 'stage'>): string[] {
  return PLANTS.filter((p) => p.unlock <= state.stage).map((p) => p.id);
}

/**
 * Lehnt eine Tier- oder Pflanzenbegegnung ab und schreibt Samen gut. Ereignisse haben
 * kein Ablehnen (die Samen-Option ist die neutrale Wahl), Gäste „ziehen lassen“
 * (farewellVisitor) – dort scheitert es mit 'wrong-type'.
 */
export function declineEncounter(state: GameState, encounterIndex: number): ActionResult {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return fail('no-encounter');
  if (!isCardEncounter(encounter.type)) return fail('wrong-type');
  state.seeds = capped(state.seeds + declineReward(state));
  state.pendingEncounters.splice(encounterIndex, 1);
  countDailyAction(state, 'decide');
  return { ok: true };
}

/**
 * Würfelt die Karten einer Begegnung neu (kostet Samen, jedes weitere Mal doppelt so
 * viel) – Tierkarten wie Pflanzenkarten. Die bisherigen Karten kommen nur zum Auffüllen
 * wieder. Kommt keine Karte in Frage oder wären es dieselben Karten, bleibt alles
 * unverändert und es kostet nichts.
 */
export function rerollEncounter(state: GameState, encounterIndex: number): ActionResult {
  const blocker = rerollBlocker(state, encounterIndex);
  if (blocker) return fail(blocker);
  const encounter = state.pendingEncounters[encounterIndex]!;
  if (!isCardEncounter(encounter.type)) return fail('wrong-type');
  state.seeds -= rerollCost(state, encounterIndex);
  encounter.cards = drawCards(state, encounter.type, encounter.cards);
  encounter.rerolls++;
  // Neue Karten: keine davon kam über einen Korridor (24.6, Wildwechsel nur am Wegpunkt).
  delete encounter.via;
  return { ok: true };
}

/** Kann diese Begegnung jetzt neu gewürfelt werden? (Für den Knopf in der UI.) */
export function canReroll(state: GameState, encounterIndex: number): boolean {
  return rerollBlocker(state, encounterIndex) === null;
}

/**
 * Warum „Neu würfeln“ gerade nicht geht – null, wenn es geht. Verändert den Spielstand
 * nicht (der Zufall wird auf einer Kopie des Generators vorgezogen).
 */
export function rerollBlocker(
  state: GameState,
  encounterIndex: number,
): 'no-encounter' | 'wrong-type' | 'no-cards' | 'no-alternatives' | 'too-expensive' | null {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return 'no-encounter';
  // Ereignisse und Gäste werden nicht neu gewürfelt.
  if (!isCardEncounter(encounter.type)) return 'wrong-type';
  const cards = drawCards(state, encounter.type, encounter.cards, { rngState: state.rngState });
  if (cards.length === 0) return 'no-cards';
  if (sameSet(cards, encounter.cards)) return 'no-alternatives';
  if (!(state.seeds >= rerollCost(state, encounterIndex))) return 'too-expensive';
  return null;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));
}

// ---------------------------------------------------------------------------
// Neuer Zyklus und Stammgäste (DESIGN_V2.md, Abschnitt 10)
// ---------------------------------------------------------------------------

/**
 * Lässt Stammgäste einziehen: jede Art aus `meta.regulars` (in Wahl-Reihenfolge), die
 * noch nicht im Ökosystem lebt, auf dieser Stufe freigeschaltet ist und in ihrer Nische
 * einen freien Platz findet. Kostenlos und ohne Zufall. Schafft ein Stammgast Plätze
 * (Borkenkäfer → Höhlen), bekommen die übrigen eine weitere Runde.
 * Gibt die eingezogenen Arten zurück. Läuft in tick (nach jedem Wegpunkt) und beim
 * Neuen Zyklus – darum online und offline gleich.
 */
export function moveInRegulars(state: GameState): string[] {
  const moved: string[] = [];
  const present = new Set(allAnimals(state));
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of state.meta.regulars) {
      const sp = SPECIES_BY_ID.get(id);
      if (!sp || present.has(id) || sp.unlock > state.stage) continue;
      // Gleiche Prüfung wie beim Einzug per Karte: Die Nische braucht einen freien Platz.
      const niches = nichesAfterChoice(state, id);
      const slots = nicheSlots(state.stage, niches ?? undefined, slotBonuses(state));
      if (!niches || niches[sp.niche].length > slots[sp.niche]) continue;
      state.niches = niches;
      present.add(id);
      moved.push(id);
      changed = true;
    }
  }
  return moved;
}

/** Warum der Neue Zyklus noch gesperrt ist: Zielstufe und fehlende Wegpunkte. */
export interface NewCycleBlocker {
  /** Index in STAGES, ab dem es geht (Hain). */
  stage: number;
  /** Wegpunkte bis dahin (≥ 1). */
  waypointsLeft: number;
}

/** Vorschau auf den Neuen Zyklus (für die Seitenleiste). */
export interface NewCyclePreview {
  /** Warum es noch nicht geht – null, wenn es geht. Den Satz baut die UI (cycle-view.ts). */
  blocker: NewCycleBlocker | null;
  /** Höchste Harmonie dieses Zyklus (H_max). */
  maxHarmony: number;
  /** Arten, die in diesem Zyklus neu ins Tagebuch kamen. */
  newSpecies: number;
  /** Gewinn an Waldgedächtnis (schon auf MAX_FOREST_MEMORY begrenzt). */
  memoryGain: number;
  /** Schwelle und Obergrenze des Harmonie-Bonus für den erreichten Wegpunkt (memoryHarmonyBonus). */
  harmonyBonus: MemoryHarmonyBonus;
  memoryBefore: number;
  memoryAfter: number;
  /** Plätze für Stammgäste vorher und nachher. */
  regularSlotsBefore: number;
  regularSlotsAfter: number;
  /** Art des laufenden Zyklus (vorausgewählt). */
  mainTree: MainTreeId;
  /** Sichtbare Hauptbaum-Arten (isTreeVisible) in MAIN_TREES-Reihenfolge, mit Sperre (Hinweis: MAIN_TREES_BY_ID). */
  trees: { id: MainTreeId; unlocked: boolean }[];
  /** Waldlandschaft: wählbare Wälder, Hähersaat jetzt und nach diesem Zyklus (DESIGN_V2.md 24.5). */
  landscape: LandscapePreview;
}

/**
 * Warum ein Wald beim Neuen Zyklus nicht wählbar ist bzw. ein Korridor nicht gebaut werden
 * kann (DESIGN_V2.md 24.5, 24.6). Eigener Typ neben ActionError: Nur startNewCycle mit
 * Standort und buildCorridor liefern ihn.
 */
export type LandscapeError =
  /** Landschaft (noch) nicht freigeschaltet, Standort unbekannt oder ein Ende des Korridors nicht gegründet. */
  | 'site-locked'
  /** Zu wenig 🪶 Hähersaat (nach der Gutschrift dieses Zyklus). */
  | 'not-enough-jay-seeds'
  /** Ein neuer Wald muss neben dem aktiven liegen (Korridor in CORRIDORS). */
  | 'not-adjacent'
  /** Gründen nur aus dem Urwald. */
  | 'needs-ancient-forest'
  /** Korridor-ID unbekannt. */
  | 'unknown-corridor'
  /** Korridor steht schon. */
  | 'corridor-built';

/** Ein Standort in der Auswahl „Wo keimt der nächste Baum?“ (Karte der Landschaft). */
export interface SiteChoice {
  id: SiteId;
  founded: boolean;
  /** Hier wächst der laufende Zyklus („Hier“). */
  active: boolean;
  /** Eigenes Gedächtnis nach diesem Zyklus (beim aktiven Wald mit dem Gewinn). */
  memory: number;
  /**
   * Wirksames Gedächtnis, wenn der nächste Zyklus hier wächst: eigenes + Zufluss über die
   * Korridore (nach der Gutschrift, bei einer Gründung mit dem Gratis-Korridor).
   */
  effectiveMemory: number;
  /** Hier war schon einmal Urwald (nach diesem Zyklus). */
  ancient: boolean;
  /** Vorausgewählte Hauptbaum-Art: zuletzt hier gewachsen bzw. Leitbaum (falls freigeschaltet). */
  mainTree: MainTreeId;
  /**
   * Wählbare Arten, wenn der nächste Zyklus hier wächst (MAIN_TREES-Reihenfolge): wie
   * `NewCyclePreview.trees[].unlocked`, aber eine Gründung schaltet ihren Leitbaum schon frei (25.2).
   */
  unlockedTrees: MainTreeId[];
  /** Kosten der Gründung (nur nicht gegründete Wälder, sonst null). */
  cost: number | null;
  /** Korridor, der mit der Gründung gratis entsteht (null: gegründet oder nicht benachbart). */
  freeCorridor: string | null;
  /** null = wählbar; sonst der Grund. 'cycle-locked': Neuer Zyklus noch gesperrt (vor dem Hain). */
  blocker: LandscapeError | 'cycle-locked' | null;
}

/** Vorschau der Landschaft beim Neuen Zyklus. */
export interface LandscapePreview {
  /** Jetzt freigeschaltet (24.3). */
  unlocked: boolean;
  /** Nach diesem Neuen Zyklus freigeschaltet – dann zeigt die UI die Karte. */
  unlockedAfter: boolean;
  active: SiteId;
  /** Hähersaat jetzt und nach der Gutschrift dieses Zyklus („🪶 5 – nach diesem Zyklus 6“). */
  jaySeeds: JaySeeds;
  jaySeedsAfter: JaySeeds;
  /** Alle Standorte in SITE_IDS-Reihenfolge. */
  sites: SiteChoice[];
}

/** Ein Korridor in der Karte der Landschaft (Kauf jederzeit, 24.6). */
export interface CorridorChoice {
  id: string;
  built: boolean;
  /** Kam mit einer Gründung (kostenlos). */
  free: boolean;
  cost: number;
  /** null = jetzt baubar; sonst der Grund ('corridor-built', wenn er steht). */
  blocker: LandscapeError | null;
}

/** Warum „Neuer Zyklus“ gerade nicht geht – null, wenn es geht. */
export function newCycleBlocker(state: GameState): NewCycleBlocker | null {
  if (state.stage >= NEW_CYCLE_MIN_STAGE) return null;
  const target = STAGES[NEW_CYCLE_MIN_STAGE]!;
  return { stage: NEW_CYCLE_MIN_STAGE, waypointsLeft: Math.max(1, target.waypoint - state.waypoint) };
}

/** Was ein Neuer Zyklus jetzt brächte. Ändert nichts. */
export function previewNewCycle(state: GameState): NewCyclePreview {
  // Eigenes Gedächtnis des aktiven Waldes: Gewinn und Obergrenze rechnen damit (24.6).
  const memoryBefore = state.meta.forestMemory;
  // Sperrklinke: der beste Harmonie-Anteil dieses Zyklus zählt, wenn er über dem aktuellen liegt.
  const memoryGain = cycleMemoryGain(
    state.cycle.maxHarmony,
    state.cycle.newSpecies.length,
    memoryBefore,
    state.waypoint,
    state.cycle.bestHarmonyMemory,
  );
  const blocker = newCycleBlocker(state);
  const memoryAfter = memoryBefore + memoryGain;
  const active = activeSite(landscapeOf(state));
  const memoryOf = (site: SiteId) => (site === active ? memoryAfter : ownMemory(state, site));
  return {
    blocker,
    maxHarmony: state.cycle.maxHarmony,
    newSpecies: state.cycle.newSpecies.length,
    memoryGain,
    harmonyBonus: memoryHarmonyBonus(state.waypoint),
    memoryBefore,
    memoryAfter,
    // Plätze aus dem wirksamen Gedächtnis des aktiven Waldes (mit Korridor-Zufluss).
    regularSlotsBefore: regularSlotsOf(state),
    regularSlotsAfter: regularSlots(effectiveMemoryOf(state, active, memoryOf)),
    mainTree: state.cycle.mainTree,
    // Arten der Landschaft erst nach deren Freischaltung (25.2, isTreeVisible).
    trees: MAIN_TREES.filter((t) => isTreeVisible(state, t.id)).map((t) => ({ id: t.id, unlocked: isTreeUnlocked(state, t.id) })),
    landscape: previewLandscape(state, memoryOf, blocker !== null),
  };
}

/** Freigeschaltete Art oder DEFAULT_MAIN_TREE; `site` gilt dabei als gegründet (isTreeUnlocked). */
function unlockedOr(state: GameState, id: MainTreeId | null | undefined, site?: SiteId): MainTreeId {
  return id && isTreeUnlocked(state, id, site) ? id : DEFAULT_MAIN_TREE;
}

/**
 * Landschaft in der Vorschau des Neuen Zyklus (24.5): Reihenfolge wie beim Neustart –
 * erst den Gewinn dem aktiven Wald gutschreiben (`memoryOf`) und `ancient` setzen, dann
 * prüfen, was bezahlbar ist.
 */
function previewLandscape(state: GameState, memoryOf: (site: SiteId) => number, cycleLocked: boolean): LandscapePreview {
  const landscape = landscapeOf(state);
  const active = activeSite(landscape);
  const reachedAncient = state.stage >= ANCIENT_STAGE;
  const unlocked = landscapeUnlocked(state);
  const unlockedAfter = landscapeUnlocked(state, memoryOf(HOME_SITE), reachedAncient);
  const after = jaySeeds(state, memoryOf);
  const cost = nextFoundingCost(landscape);
  const sites = SITE_IDS.map((id): SiteChoice => {
    const entry = siteEntry(landscape, id);
    const isActive = id === active;
    const free = entry ? undefined : corridorBetween(active, id);
    let blocker: SiteChoice['blocker'] = null;
    if (!isActive) {
      if (!unlockedAfter) blocker = 'site-locked';
      else if (cycleLocked) blocker = 'cycle-locked';
      else if (!entry) {
        if (!reachedAncient) blocker = 'needs-ancient-forest';
        else if (!free) blocker = 'not-adjacent';
        else if (cost === null || after.available < cost) blocker = 'not-enough-jay-seeds';
      }
    }
    return {
      id,
      founded: entry !== undefined,
      active: isActive,
      memory: entry ? memoryOf(id) : 0,
      effectiveMemory: entry ? effectiveMemoryOf(state, id, memoryOf) : effectiveMemoryOf(state, id, memoryOf, free ? [free] : []),
      ancient: entry ? isSiteAncient(state, id) : false,
      // Beim Gründen ist der Leitbaum vorausgewählt – die Gründung schaltet ihn frei (25.2).
      mainTree: isActive ? state.cycle.mainTree : unlockedOr(state, entry ? entry.mainTree : LANDSCAPE_SITES_BY_ID.get(id)?.leadTree, id),
      unlockedTrees: MAIN_TREES.filter((t) => isTreeUnlocked(state, t.id, id)).map((t) => t.id),
      cost: entry ? null : cost,
      freeCorridor: free?.id ?? null,
      blocker,
    };
  });
  return { unlocked, unlockedAfter, active, jaySeeds: jaySeeds(state), jaySeedsAfter: after, sites };
}

/**
 * Die Meldung zur Freischaltung der Landschaft (24.3) ist gezeigt: einmal, dauerhaft. Die UI
 * zeigt sie, solange `landscapeAnnouncementDue(state)` gilt, und ruft danach diese Aktion.
 * Gibt zurück, ob sich etwas geändert hat (vor der Freischaltung: nichts, false).
 */
export function markLandscapeAnnounced(state: GameState): boolean {
  if (!landscapeUnlocked(state) || state.meta.landscape.announced) return false;
  state.meta.landscape.announced = true;
  return true;
}

/** Warum dieser Korridor gerade nicht gebaut werden kann – null, wenn es geht. */
export function corridorBlocker(state: GameState, id: string): LandscapeError | null {
  const corridor = CORRIDORS_BY_ID.get(id);
  if (!corridor) return 'unknown-corridor';
  const landscape = landscapeOf(state);
  if (landscape.corridors.includes(id)) return 'corridor-built';
  if (!landscapeUnlocked(state) || !corridor.sites.every((site) => isSiteFounded(state, site))) return 'site-locked';
  if (jaySeeds(state).available < corridor.cost) return 'not-enough-jay-seeds';
  return null;
}

/** Alle Korridore für die Karte der Landschaft (Reihenfolge wie CORRIDORS). */
export function landscapeCorridors(state: GameState): CorridorChoice[] {
  const landscape = landscapeOf(state);
  return CORRIDORS.map((c) => ({
    id: c.id,
    built: landscape.corridors.includes(c.id),
    free: landscape.freeCorridors.includes(c.id),
    cost: c.cost,
    blocker: corridorBlocker(state, c.id),
  }));
}

/**
 * Korridor bauen (24.6) – jederzeit, nicht nur beim Neustart: Kosten aus der verfügbaren
 * Hähersaat (abgeleitet, darum nur der Eintrag in `corridors`). Ändert das wirksame
 * Gedächtnis der beiden Wälder (und damit evaluate und die Stammgast-Plätze). Bei Fehlern
 * ändert sich nichts.
 */
export function buildCorridor(state: GameState, id: string): { ok: true } | { ok: false; error: LandscapeError } {
  const blocker = corridorBlocker(state, id);
  if (blocker) return { ok: false, error: blocker };
  state.meta.landscape.corridors.push(id);
  return { ok: true };
}

/**
 * Wählbare Hauptbaum-Arten (DESIGN_V2.md 17.2, 25.2): die Eiche immer, die übrigen, sobald
 * ihre Begleitpflanze im Naturtagebuch steht (`meta.journal.plants`) bzw. ihr Standort der
 * Landschaft gegründet ist (`meta.landscape.sites`). Abgeleitet, kein eigenes Feld im
 * Spielstand. Reihenfolge wie MAIN_TREES.
 */
export function unlockedTrees(state: Pick<GameState, 'meta'>): MainTreeId[] {
  return MAIN_TREES.filter((t) => isTreeUnlocked(state, t.id)).map((t) => t.id);
}

/**
 * Ist diese Art bekannt und freigeschaltet? `founding`: Standort, der gerade gegründet wird –
 * er gilt für die Prüfung schon als gegründet (25.2: die Gründung schaltet den Leitbaum im
 * selben Schritt frei; Vorschau und startNewCycle).
 */
export function isTreeUnlocked(state: Pick<GameState, 'meta'>, id: string, founding?: SiteId): boolean {
  const tree = MAIN_TREES_BY_ID.get(id as MainTreeId);
  if (!tree) return false;
  if (tree.unlockPlant !== null && !state.meta.journal.plants.includes(tree.unlockPlant)) return false;
  if (tree.unlockSite !== undefined && tree.unlockSite !== founding && !isSiteFounded(state, tree.unlockSite)) return false;
  return true;
}

/**
 * Erscheint diese Art in der Baumwahl? Arten der Landschaft (`unlockSite`) erst nach deren
 * Freischaltung (25.2, kein Spoiler) – danach gesperrt mit Hinweis, bis der Standort gegründet
 * ist. Alle übrigen bekannten Arten immer.
 */
export function isTreeVisible(state: Pick<GameState, 'meta'>, id: string): boolean {
  const tree = MAIN_TREES_BY_ID.get(id as MainTreeId);
  if (!tree) return false;
  return tree.unlockSite === undefined || landscapeUnlocked(state) || isTreeUnlocked(state, id);
}

export type NewCycleResult =
  /**
   * `achievements`: neu freigeschaltete Erfolge (vor und nach dem Zurücksetzen geprüft).
   * `site`: Wald, in dem der neue Zyklus wächst; `founded`: dieser Wald wurde gerade
   * gegründet; `landscapeUnlocked`: die Landschaft ist mit diesem Neustart freigeschaltet
   * (Meldung 24.3, einmal).
   */
  | {
      ok: true;
      preview: NewCyclePreview;
      regulars: string[];
      achievements: string[];
      site: SiteId;
      founded: boolean;
      landscapeUnlocked: boolean;
    }
  | { ok: false; error: ActionError };

/** Ergebnis von startNewCycle mit Standort: zusätzlich die Fehler der Landschaft. */
export type LandscapeCycleResult = NewCycleResult | { ok: false; error: LandscapeError };

/**
 * Neuer Zyklus: Waldgedächtnis gutschreiben, dann Wachstum, Samen, Wegpunkt, Stufe,
 * Pflanzen, Nischen und offene Begegnungen zurücksetzen. Naturtagebuch, Waldgedächtnis,
 * Stammgäste und der Zufallsgenerator (`rngState`) laufen weiter. Danach ziehen
 * Stammgäste ein, die schon Platz finden. `now` (ms seit Epoch) markiert den Beginn des
 * Zyklus; `lastTick` bleibt unverändert. Der neue Zyklus beginnt im Frühling mit der Art
 * `mainTree` (ohne Angabe: die des laufenden Zyklus); ist sie gesperrt oder unbekannt,
 * scheitert die Aktion mit 'tree-locked' und nichts ändert sich.
 * Erfolge werden vorher geprüft (Stufe und Spielzeit des Zyklus beginnen neu – nichts
 * Erreichtes geht verloren) und danach (abgeschlossene Zyklen, Baumarten).
 */
export function startNewCycle(state: GameState, now: number, mainTree?: MainTreeId): NewCycleResult;
export function startNewCycle(state: GameState, now: number, mainTree: MainTreeId | undefined, site: SiteId | undefined): LandscapeCycleResult;
export function startNewCycle(state: GameState, now: number, mainTree?: MainTreeId, site?: SiteId): LandscapeCycleResult {
  const preview = previewNewCycle(state);
  if (preview.blocker !== null) return { ok: false, error: 'cycle-locked' };
  const landscape = state.meta.landscape;
  // Ungültiger aktiver Wald (kaputter Stand): wie beim Laden der Heimatwald, kein Fehler.
  const from = activeSite(landscape);
  const target = site ?? from;
  const choice = preview.landscape.sites.find((s) => s.id === target);
  if (!choice) return { ok: false, error: 'site-locked' };
  if (choice.blocker !== null) return { ok: false, error: choice.blocker };
  // Ohne Angabe: im selben Wald die Art des laufenden Zyklus, sonst die Vorauswahl des Waldes.
  const tree = mainTree ?? choice.mainTree;
  // Der Zielstandort zählt schon als gegründet: `('fir', 'mountain')` gelingt in einem Schritt (25.2).
  if (!isTreeUnlocked(state, tree, target)) return { ok: false, error: 'tree-locked' };
  const wasUnlocked = preview.landscape.unlocked;
  const achievements = checkAchievements(state);
  // 1. Gewinn dem alten Wald gutschreiben, 2. `ancient` setzen, 3. wechseln bzw. gründen (24.5).
  state.meta.forestMemory = preview.memoryAfter;
  let fromEntry = siteEntry(landscape, from);
  if (!fromEntry) {
    fromEntry = createSite(from, state.cycle.mainTree);
    // Der Heimatwald steht immer zuerst, jeder andere in Gründungs-Reihenfolge hinten.
    if (from === HOME_SITE) landscape.sites.unshift(fromEntry);
    else landscape.sites.push(fromEntry);
  }
  if (state.stage >= ANCIENT_STAGE) fromEntry.ancient = true;
  fromEntry.mainTree = state.cycle.mainTree;
  const founded = !choice.founded && target !== from;
  if (target !== from) {
    // Den alten Wald ruhen lassen: Gedächtnis, Stammgäste und Bestand parken.
    fromEntry.memory = state.meta.forestMemory;
    fromEntry.regulars = state.meta.regulars;
    fromEntry.fauna = allAnimals(state).slice(0, MAX_SITE_FAUNA);
    let entry = siteEntry(landscape, target);
    let regulars: string[];
    if (!entry) {
      // Gründung: bezahlt ist sie, sobald der Wald in `sites` steht (Hähersaat ist abgeleitet);
      // der Korridor zum alten Wald entsteht gratis („der Weg der Häher“).
      entry = createSite(target, tree);
      landscape.sites.push(entry);
      const corridor = corridorBetween(from, target)!;
      if (!landscape.corridors.includes(corridor.id)) {
        landscape.corridors.push(corridor.id);
        landscape.freeCorridors.push(corridor.id);
      }
      // „Die Häher bringen Gesellschaft mit“: die Stammgäste des alten Waldes (gekürzt unten).
      regulars = [...fromEntry.regulars];
    } else {
      regulars = entry.regulars;
    }
    state.meta.forestMemory = entry.memory;
    entry.memory = 0;
    entry.regulars = [];
    landscape.active = target;
    state.meta.regulars = regulars.slice(0, regularSlotsOf(state));
  }
  landscape.active = target;
  siteEntry(landscape, target)!.mainTree = tree;
  state.meta.stats.completedCyclesGrowth = capped(state.meta.stats.completedCyclesGrowth + state.totalGrowth);
  state.totalGrowth = 0;
  state.seeds = 0;
  state.waypoint = 0;
  state.stage = 0;
  state.plants = [];
  state.niches = emptyNiches();
  state.pendingEncounters = [];
  state.cycle = createCycle(state.cycle.number + 1, now, tree);
  if (!state.meta.stats.grownTrees.includes(tree)) state.meta.stats.grownTrees.push(tree);
  const regulars = moveInRegulars(state);
  recordDiscoveries(state);
  achievements.push(...checkAchievements(state));
  // Tagesziele überdauern den Zyklus; offene passen sich dem neuen Wald an (DESIGN_V2.md 20.5).
  refreshDailyAfterNewCycle(state);
  return {
    ok: true,
    preview,
    regulars,
    achievements,
    site: target,
    founded,
    landscapeUnlocked: !wasUnlocked && landscapeUnlocked(state),
  };
}

/** Warum diese Art gerade nicht Stammgast werden kann – null, wenn es geht oder sie es schon ist. */
export function regularBlocker(
  state: GameState,
  speciesId: string,
): 'unknown-species' | 'not-discovered' | 'no-regular-slot' | null {
  if (!SPECIES_BY_ID.has(speciesId)) return 'unknown-species';
  if (!state.meta.journal.species.includes(speciesId)) return 'not-discovered';
  if (state.meta.regulars.includes(speciesId)) return null;
  if (state.meta.regulars.length >= regularSlotsOf(state)) return 'no-regular-slot';
  return null;
}

/**
 * Wählt eine entdeckte Art als Stammgast oder wählt sie ab. Eingezogen wird beim
 * nächsten Wegpunkt bzw. Zyklusstart (moveInRegulars); Abwählen entlässt kein Tier.
 */
export function toggleRegular(state: GameState, speciesId: string): ActionResult {
  const at = state.meta.regulars.indexOf(speciesId);
  if (at >= 0) {
    state.meta.regulars.splice(at, 1);
    return { ok: true };
  }
  const blocker = regularBlocker(state, speciesId);
  if (blocker) return fail(blocker);
  state.meta.regulars.push(speciesId);
  return { ok: true };
}

/**
 * Setzt alle Stammgäste auf einmal (Prüfung wie toggleRegular; bei Fehlern bleibt alles,
 * wie es war) – für die spätere Tagebuch-Ansicht. Die Seitenleiste nutzt toggleRegular.
 */
export function setRegulars(state: GameState, speciesIds: readonly string[]): ActionResult {
  const ids = [...new Set(speciesIds)];
  for (const id of ids) {
    if (!SPECIES_BY_ID.has(id)) return fail('unknown-species');
    if (!state.meta.journal.species.includes(id)) return fail('not-discovered');
  }
  if (ids.length > regularSlotsOf(state)) return fail('no-regular-slot');
  state.meta.regulars = ids;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ereignisse mit Wahl und Durchreisende (DESIGN_V2.md 7.4, 7.5, 7.8)
// ---------------------------------------------------------------------------

/**
 * Ereignisse, die jetzt gezogen werden können: ab ihrer Stufe, einmal je Zyklus, in ihrer
 * Jahreszeit (EVENT_SEASONS), Bedingungen erfüllt.
 */
export function eligibleEvents(state: GameState): GameEvent[] {
  const ctx = appearsContext(ecosystemOf(state));
  return EVENTS.filter(
    (e) =>
      e.minStage <= state.stage &&
      !state.cycle.seen.includes(e.id) &&
      inSeason(state, EVENT_SEASONS, e.id) &&
      speciesAppears(ctx, e),
  );
}

/** Gäste, die jetzt gezogen werden können (wie eligibleEvents, Jahreszeit aus VISITOR_SEASONS). */
export function eligibleVisitors(state: GameState): Visitor[] {
  const ctx = appearsContext(ecosystemOf(state));
  return VISITORS.filter(
    (v) =>
      v.minStage <= state.stage &&
      !state.cycle.seen.includes(v.id) &&
      inSeason(state, VISITOR_SEASONS, v.id) &&
      speciesAppears(ctx, v),
  );
}

/**
 * Gewicht eines Ereignisses beim Ziehen (DESIGN_V2.md 22.6): Faktor aus
 * WEATHER_EVENT_FACTORS für das Wetter des laufenden Tages im aktiven Wald (`weatherOfDay` – eine reine
 * Funktion von Zyklus und Spielzeit, darum online und im Mittelmodus offline gleich), sonst 1.
 * Ungültige Faktoren zählen als 1; im Modus `off` (ohne Wetter) gilt immer 1.
 */
export function eventWeight(state: WeatherHolder, eventId: string, ambient: AmbientMode = 'live'): number {
  if (ambient === 'off') return 1;
  const factors = WEATHER_EVENT_FACTORS[weatherOfDay(state.cycle, dayIndex(state.cycle.elapsed), weatherSiteOf(state))];
  const f = factors && Object.hasOwn(factors, eventId) ? factors[eventId] : undefined;
  return f !== undefined && Number.isFinite(f) && f > 0 ? f : 1;
}

/** Zieht eines der (nicht leeren) Ereignisse nach eventWeight, mit dem Zufall des Spielstands. */
export function pickEvent(state: GameState, events: readonly GameEvent[], ambient: AmbientMode = 'live'): GameEvent {
  const i = weightedIndex(state, events.map((e) => eventWeight(state, e.id, ambient)));
  return events[Math.max(0, i)]!;
}

/** Begegnung für ein Ereignis; es gilt ab jetzt als gesehen. */
function eventEncounter(state: GameState, event: GameEvent): PendingEncounter {
  state.cycle.seen.push(event.id);
  return { type: 'event', cards: [event.id], rerolls: 0 };
}

/** Begegnung für einen Gast; er gilt ab jetzt als gesehen. */
function visitorEncounter(state: GameState, visitor: Visitor): PendingEncounter {
  state.cycle.seen.push(visitor.id);
  return { type: 'visitor', cards: [visitor.id], rerolls: 0 };
}

/**
 * Baut die vorgegebene Begegnung (`nextEncounter`): zuerst zufällig bis zu FORCED_MAX_CARDS
 * der vorgegebenen IDs, die passen (Arten: freigeschaltet, noch nicht im Ökosystem, Nische
 * offen – Seltenheit und Erscheinungsbedingung zählen nicht; Pflanzen: freigeschaltet),
 * Rest normal gezogen – ohne die übrigen Vorgaben, damit eine andere Wahl bleibt. Nur wenn
 * sonst nichts passt, füllen weitere Vorgaben auf. null, wenn keine ID passt.
 */
function forcedEncounter(state: GameState, forced: ForcedEncounter): PendingEncounter | null {
  const slots = nicheSlots(state.stage, state.niches, slotBonuses(state));
  const present = new Set(allAnimals(state));
  const fits = forced.ids.filter((id, i) => {
    if (forced.ids.indexOf(id) !== i) return false;
    if (forced.type === 'plant') return (PLANTS_BY_ID.get(id)?.unlock ?? Infinity) <= state.stage;
    const sp = SPECIES_BY_ID.get(id);
    return !!sp && sp.unlock <= state.stage && !present.has(id) && slots[sp.niche] > 0;
  });
  if (fits.length === 0) return null;
  const chosen: string[] = [];
  while (fits.length > 0 && chosen.length < FORCED_MAX_CARDS) chosen.push(fits.splice(randomInt(state, fits.length), 1)[0]!);
  // Übrige Vorgaben nur zum Auffüllen (drawCards zieht `exclude` erst, wenn sonst nichts passt).
  const rest = drawCards(state, forced.type, [...chosen, ...forced.ids]).filter((id) => !chosen.includes(id));
  return { type: forced.type, cards: [...chosen, ...rest].slice(0, CARDS_PER_ENCOUNTER), rerolls: 0 };
}

/** Warum diese Ereignis-Option gerade nicht gewählt werden kann – null, wenn es geht. */
export function eventOptionBlocker(
  state: GameState,
  encounterIndex: number,
  optionIndex: number,
): 'no-encounter' | 'wrong-type' | 'no-option' | null {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return 'no-encounter';
  if (encounter.type !== 'event') return 'wrong-type';
  const event = EVENTS_BY_ID.get(encounter.cards[0] ?? '');
  if (!event || !Number.isInteger(optionIndex) || !event.options[optionIndex]) return 'no-option';
  return null;
}

/** Samen, die eine Ereignis-Option sofort bringt (Samen-Sekunden zur aktuellen Rate). */
export function eventOptionSeeds(state: GameState, eventId: string, optionIndex: number): number {
  const option = EVENTS_BY_ID.get(eventId)?.options[optionIndex];
  if (!option) return 0;
  let seeds = 0;
  for (const e of option.effects) if (e.kind === 'seedsNow') seeds += seedSeconds(state, e.seconds);
  return seeds;
}

/**
 * Wählt eine Option eines Ereignisses; die Begegnung ist danach erledigt. Samen-Sekunden
 * werden zur Rate VOR der Wahl gerechnet. Zeit-Boni laufen ab jetzt (Spielzeit), Zyklus-
 * Boni und Habitate gelten bis zum Neuen Zyklus, `nextEncounter` gilt für die nächste
 * gezogene Begegnung. `seeds` im Ergebnis: sofort erhaltene Samen.
 */
export function chooseEventOption(state: GameState, encounterIndex: number, optionIndex: number): ActionResult {
  const blocker = eventOptionBlocker(state, encounterIndex, optionIndex);
  if (blocker) return fail(blocker);
  const event = EVENTS_BY_ID.get(state.pendingEncounters[encounterIndex]!.cards[0]!)!;
  const option = event.options[optionIndex]!;
  const seeds = eventOptionSeeds(state, event.id, optionIndex);
  const cycle = state.cycle;
  for (const e of option.effects) {
    switch (e.kind) {
      case 'seedsNow':
        break; // oben schon zusammengezählt
      case 'timed':
        cycle.timed.push({ source: event.id, effect: e.effect, remaining: e.seconds });
        break;
      case 'cycle':
        cycle.bonuses.push({ source: event.id, effect: e.effect });
        break;
      case 'habitat':
        cycle.habitats.push(e.tag);
        break;
      case 'nextEncounter':
        cycle.forced = { type: e.type, ids: [...e.ids] };
        break;
    }
  }
  state.seeds = capped(state.seeds + seeds);
  state.pendingEncounters.splice(encounterIndex, 1);
  countStat(state, 'eventsDecided');
  countDailyAction(state, 'decide');
  const discovered = recordDiscoveries(state);
  return discovered.length > 0 ? { ok: true, discovered, seeds } : { ok: true, seeds };
}

/** Kosten fürs Bewirten und Dank fürs Ziehenlassen eines Gastes (Samen, zur aktuellen Rate). */
export function visitorSeeds(state: GameState, visitorId: string): { host: number; farewell: number } | null {
  const visitor = VISITORS_BY_ID.get(visitorId);
  if (!visitor) return null;
  return { host: seedSeconds(state, visitor.hostCost), farewell: seedSeconds(state, visitor.farewellSeeds) };
}

/** Warum „Bewirten“ gerade nicht geht – null, wenn es geht. */
export function hostBlocker(
  state: GameState,
  encounterIndex: number,
): 'no-encounter' | 'wrong-type' | 'no-card' | 'already-active' | 'too-expensive' | null {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return 'no-encounter';
  if (encounter.type !== 'visitor') return 'wrong-type';
  const costs = visitorSeeds(state, encounter.cards[0] ?? '');
  if (!costs) return 'no-card';
  if (state.cycle.visitors.some((v) => v.id === encounter.cards[0])) return 'already-active';
  if (!(state.seeds >= costs.host)) return 'too-expensive';
  return null;
}

/**
 * Bewirtet einen Gast: kostet Samen-Sekunden, dafür bleibt er `stay` Sekunden Spielzeit,
 * wirkt mit Faktor 1 und zählt für die Gattungsboni. `seeds` im Ergebnis: negativ (Kosten).
 */
export function hostVisitor(state: GameState, encounterIndex: number): ActionResult {
  const blocker = hostBlocker(state, encounterIndex);
  if (blocker) return fail(blocker);
  const id = state.pendingEncounters[encounterIndex]!.cards[0]!;
  const visitor = VISITORS_BY_ID.get(id)!;
  const cost = visitorSeeds(state, id)!.host;
  state.seeds = Math.max(0, state.seeds - cost);
  state.cycle.visitors.push({ id, remaining: visitor.stay });
  state.pendingEncounters.splice(encounterIndex, 1);
  countStat(state, 'visitorsHosted');
  countDailyAction(state, 'decide');
  const discovered = recordDiscoveries(state);
  return discovered.length > 0 ? { ok: true, discovered, seeds: -cost } : { ok: true, seeds: -cost };
}

/** Lässt einen Gast ziehen: bringt Samen-Sekunden als Dank. */
export function farewellVisitor(state: GameState, encounterIndex: number): ActionResult {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return fail('no-encounter');
  if (encounter.type !== 'visitor') return fail('wrong-type');
  const costs = visitorSeeds(state, encounter.cards[0] ?? '');
  const seeds = costs?.farewell ?? 0;
  state.seeds = capped(state.seeds + seeds);
  state.pendingEncounters.splice(encounterIndex, 1);
  countDailyAction(state, 'decide');
  return { ok: true, seeds };
}

// ---------------------------------------------------------------------------
// Pflegemaßnahmen (DESIGN_V2.md 8, Umsetzungsnotiz 8.2)
// ---------------------------------------------------------------------------

/**
 * Warum ein Pflege-Rang gerade nicht gekauft werden kann (Reihenfolge der Prüfung):
 * unbekannte Maßnahme, alle Ränge gekauft, Stufe zu niedrig, Gegenstück schon gekauft,
 * Bedingung nicht erfüllt, Samen reichen nicht.
 */
export type CareBlocker = 'unknown-care' | 'maxed' | 'stage' | 'excluded' | 'requires' | 'too-expensive';

/** Gekaufte Ränge dieser Maßnahme (0 = noch keiner). */
export function careRank(state: GameState, id: string): number {
  const measure = CARE_BY_ID.get(id);
  const rank = state.cycle.care[id] ?? 0;
  return measure ? Math.min(measure.ranks.length, Math.max(0, Math.floor(Number.isFinite(rank) ? rank : 0))) : 0;
}

/** Nächster kaufbarer Rang einer Maßnahme (undefined, wenn unbekannt oder voll ausgebaut). */
export function nextCareRank(state: GameState, id: string): CareRank | undefined {
  return CARE_BY_ID.get(id)?.ranks[careRank(state, id)];
}

/** Warum der nächste Rang nicht gekauft werden kann – null, wenn es geht. Ändert nichts. */
export function careBlocker(state: GameState, id: string): CareBlocker | null {
  const measure: CareMeasure | undefined = CARE_BY_ID.get(id);
  if (!measure) return 'unknown-care';
  const next = measure.ranks[careRank(state, id)];
  if (!next) return 'maxed';
  if (state.stage < next.minStage) return 'stage';
  if (measure.excludes?.some((other) => careRank(state, other) > 0)) return 'excluded';
  if (measure.requires && !speciesAppears(appearsContext(ecosystemOf(state)), { appears: measure.requires })) return 'requires';
  if (!(state.seeds >= next.cost)) return 'too-expensive';
  return null;
}

/**
 * Kauft den nächsten Rang einer Pflegemaßnahme: Samen abziehen, Rang erhöhen, H_max und
 * Tagebuch nachführen. Wirkt bis zum Neuen Zyklus; die Bedingung gilt nur beim Kauf.
 * `seeds` im Ergebnis: die Kosten (negativ).
 */
export function buyCare(state: GameState, id: string): ActionResult {
  const blocker = careBlocker(state, id);
  if (blocker) return fail(blocker);
  const cost = nextCareRank(state, id)!.cost;
  state.seeds = Math.max(0, state.seeds - cost);
  state.cycle.care[id] = careRank(state, id) + 1;
  countStat(state, 'careRanksBought');
  countDailyAction(state, 'care');
  // Neue Plätze (z. B. Waldtümpel, Nistkästen): Stammgäste ziehen sofort ein, nicht erst
  // am nächsten Wegpunkt.
  const regulars = moveInRegulars(state);
  const discovered = recordDiscoveries(state);
  const result: ActionResult = { ok: true, seeds: -cost };
  if (discovered.length > 0) result.discovered = discovered;
  if (regulars.length > 0) result.regulars = regulars;
  return result;
}

/**
 * Vorschau: das Ökosystem mit dem nächsten Rang (wie previewPlant). Prüft weder Samen
 * noch Stufe (siehe careBlocker); null bei unbekannter oder voll ausgebauter Maßnahme.
 */
export function previewCare(state: GameState, id: string): Evaluation | null {
  if (!nextCareRank(state, id)) return null;
  const care = { ...state.cycle.care, [id]: careRank(state, id) + 1 };
  return evaluateEcosystem(ecosystemOf({ ...state, cycle: { ...state.cycle, care } }));
}
