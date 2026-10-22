import { DAY_SECONDS, DAY_START_PHASE, NIGHT_END_PHASE, NIGHT_SHARE, NIGHT_START_PHASE, NOCTURNAL, type Nocturnal } from '../content/daytime';
import type { TimedEffect } from '../content/events';
import { SEASON_IDS, type SeasonId } from '../content/seasons';
import { SPECIES_BY_ID } from '../content/species';
import { GENERA, type Genus } from '../content/types';
import {
  AFTER_ROUGH_WEATHER,
  DIVERSITY_DAMPING_MAX,
  DIVERSITY_DAMPING_PER_GENUS,
  FIRST_DAY_WEATHER,
  GENTLE_DAYS,
  PROTECTION_FACTOR,
  WEATHERS,
  WEATHERS_BY_ID,
  WEATHER_BLEND_SECONDS,
  WEATHER_WEIGHTS,
  type Weather,
  type WeatherId,
} from '../content/weather';
import { normalizeSeed, random } from './rng';
import { MAX_ELAPSED, normalizeElapsed } from './season';
import { allAnimals, type CycleState, type GameState } from './state';

/*
 * Wetter und Nacht (DESIGN_V2.md 21): reine Rechnungen über Zyklus und Spielzeit, wie
 * season.ts. Kein DOM, keine Uhr, kein Math.random – und der Spielstand-Zufall
 * (`rngState`) bleibt unberührt: Jeder Tag zieht aus einem eigenen, nur hier angelegten
 * Zwischenzustand. Gleicher Spielstand → gleiches Wetter, auf jedem Gerät.
 */

/**
 * Wie Wetter und Nacht in die Raten eingehen:
 * - `live`: Wetter des laufenden Tages, Nachtwirkung nur nachts (online, kurze Lücken).
 * - `average`: Mittelwetter der Jahreszeit und NIGHT_SHARE der Nachtwirkung (offline ab
 *   OFFLINE_AVERAGE_MIN_SECONDS, 21.5).
 * - `off`: weder noch (Samen-Sekunden, Vergleichsläufe der Simulation).
 */
export type AmbientMode = 'live' | 'average' | 'off';

/** Was weatherSeed vom Zyklus braucht. */
export type WeatherCycle = Pick<CycleState, 'number'> & Partial<Pick<CycleState, 'startedAt'>>;

/** Startwert des Wetters eines Zyklus (21.4): aus Zyklusnummer und Startzeit (fehlt → 0). */
export function weatherSeed(cycle: WeatherCycle): number {
  const startedAt = Number.isFinite(cycle.startedAt) ? cycle.startedAt! : 0;
  const number = Number.isFinite(cycle.number) ? cycle.number : 0;
  return normalizeSeed(startedAt + number * 1_000_003);
}

/** Tag n des Zyklus (= Jahreszeit n): floor(elapsed / 180), ungültige Zeit wie 0. */
export function dayIndex(elapsed: number): number {
  return Math.floor(normalizeElapsed(elapsed) / DAY_SECONDS);
}

/** Jahreszeit des Tages n. */
export function seasonOfDay(day: number): SeasonId {
  return SEASON_IDS[validDay(day) % SEASON_IDS.length]!;
}

/** Ganze Zahl ≥ 0 (NaN, negativ → 0). */
function validDay(day: number): number {
  return Number.isFinite(day) && day > 0 ? Math.floor(day) : 0;
}

/**
 * Gleichverteilte Zahl in [0, 1) für Tag n – aus einem eigenen Halter, der Spielstand-
 * Zufall bleibt unberührt.
 */
export function weatherRoll(seed: number, day: number): number {
  return random({ rngState: normalizeSeed((seed ^ Math.imul(validDay(day) >>> 0, 0x9e3779b1)) >>> 0) });
}

/** Wetter nach den Gewichten der Jahreszeit, ohne Regeln (Reihenfolge wie in den Daten). */
export function rawWeather(seed: number, day: number): WeatherId {
  const weights = Object.entries(WEATHER_WEIGHTS[seasonOfDay(day)]) as [WeatherId, number][];
  const total = weights.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (!(total > 0)) return AFTER_ROUGH_WEATHER;
  let r = weatherRoll(seed, day) * total;
  for (const [id, w] of weights) {
    r -= Math.max(0, w);
    if (r < 0) return id;
  }
  // Rundungsrest: letztes Wetter mit Gewicht.
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i]![1] > 0) return weights[i]![0];
  return AFTER_ROUGH_WEATHER;
}

/** Raue Lage (Abzüge, Dämpfung, nie zweimal hintereinander)? */
export function isRough(id: WeatherId): boolean {
  return !!WEATHERS_BY_ID.get(id)?.rough;
}

/**
 * Wetter an Tag n eines Zyklus (21.2/21.4): Tag 0 „Wechselhaft“, in der Schonzeit
 * (erstes Jahr) keine rauen Lagen, nach einem rauen Tag nie ein zweiter. Regel 3 prüft
 * das Rohwetter des Vortags – ohne Rekursion, und trotzdem nie zwei raue Tage.
 */
export function weatherOfDay(cycle: WeatherCycle, day: number): WeatherId {
  return weatherOfDayFromSeed(weatherSeed(cycle), day);
}

/** Wie weatherOfDay, mit schon berechnetem Startwert (für viele Tage hintereinander). */
export function weatherOfDayFromSeed(seed: number, day: number): WeatherId {
  const n = validDay(day);
  if (n === 0) return FIRST_DAY_WEATHER;
  const raw = rawWeather(seed, n);
  if (!isRough(raw)) return raw;
  if (n < GENTLE_DAYS) return AFTER_ROUGH_WEATHER;
  if (n - 1 >= GENTLE_DAYS && isRough(rawWeather(seed, n - 1))) return AFTER_ROUGH_WEATHER;
  return raw;
}

/** Wetter (Daten) mit ID; unbekannte IDs → „Wechselhaft“. */
export function weatherById(id: WeatherId): Weather {
  return WEATHERS_BY_ID.get(id) ?? WEATHERS_BY_ID.get(AFTER_ROUGH_WEATHER) ?? WEATHERS[0]!;
}

/** Wetter des laufenden Tages. */
export function weatherAt(state: Pick<GameState, 'cycle'>): Weather {
  return weatherById(weatherOfDay(state.cycle, dayIndex(state.cycle.elapsed)));
}

/** Vorhersage: das Wetter von morgen (des nächsten Tages = der nächsten Jahreszeit). */
export function weatherForecast(state: Pick<GameState, 'cycle'>): Weather {
  return weatherById(weatherOfDay(state.cycle, dayIndex(state.cycle.elapsed) + 1));
}

/** Wetter für die Grafik (`SceneInput.weather` / `weatherBlend`, 21.8). */
export interface SceneWeather {
  /** Wetter des laufenden Tages. */
  weather: WeatherId;
  /** Wetter des Vortags (Tag 0: dasselbe), von dem aus überblendet wird. */
  previous: WeatherId;
  /** Überblendung 0 (Vortag) … 1 (heute) über WEATHER_BLEND_SECONDS ab Tagesbeginn. */
  blend: number;
}

/** Wetter und Überblendung zur Spielzeit des Zyklus – für den Renderer, jeden Frame. */
export function sceneWeather(cycle: WeatherCycle & Pick<CycleState, 'elapsed'>): SceneWeather {
  const elapsed = normalizeElapsed(cycle.elapsed);
  const day = dayIndex(elapsed);
  const seed = weatherSeed(cycle);
  const weather = weatherOfDayFromSeed(seed, day);
  const previous = day > 0 ? weatherOfDayFromSeed(seed, day - 1) : weather;
  const inDay = elapsed - day * DAY_SECONDS;
  const blend = previous === weather ? 1 : Math.min(1, Math.max(0, inDay / WEATHER_BLEND_SECONDS));
  return { weather, previous, blend };
}

// ---------------------------------------------------------------------------
// Dämpfung rauer Lagen (21.3)
// ---------------------------------------------------------------------------

/** Gattungen mit mindestens einem Tier (nur echte Arten; „zählt als Vogel“ und Gäste nicht). */
export function generaWithAnimals(animalIds: Iterable<string>): Genus[] {
  const seen = new Set<Genus>();
  for (const id of animalIds) {
    const genus = SPECIES_BY_ID.get(id)?.genus;
    if (genus) seen.add(genus);
  }
  return GENERA.filter((g) => seen.has(g));
}

/** Wie stark die Abzüge einer Wetterlage gedämpft werden – auch für den Tooltip. */
export interface WeatherDamping {
  /** Raue Lage? Nur dann wirkt die Dämpfung. */
  rough: boolean;
  /** Gattungen mit mindestens einem Tier. */
  genera: number;
  /** Dämpfung durch Vielfalt, 0 … DIVERSITY_DAMPING_MAX (0,3 = Abzug −30 %). */
  diversity: number;
  /** Schützende Pflegemaßnahme (ID), wenn sie mindestens Rang 1 hat, sonst null. */
  protectedBy: string | null;
  /** Hauptbaum ist gegen diese Lage gefeit (Kiefer bei Frost): Abzug entfällt. */
  immune: boolean;
  /** Faktor auf die Abzüge: 1 = voll, 0 = entfällt. Für ruhige Lagen immer 1. */
  factor: number;
}

/** Ist eine Pflegemaßnahme mindestens auf Rang 1? (Unsinnige Ränge zählen nicht.) */
function hasCareRank(care: Readonly<Record<string, number>> | undefined, id: string | undefined): boolean {
  if (id === undefined || !care || !Object.hasOwn(care, id)) return false;
  const rank = care[id];
  return typeof rank === 'number' && Number.isFinite(rank) && rank >= 1;
}

/**
 * Dämpfung einer Wetterlage aus Gattungszahl, Pflege und Hauptbaum:
 * Abzug × (1 − min(0,5; 0,1 × Gattungen)) × (0,5 mit Schutz); Kiefer bei Frost: 0.
 */
export function weatherDampingFor(
  weather: Weather,
  genera: number,
  care: Readonly<Record<string, number>> | undefined,
  mainTree: string | undefined,
): WeatherDamping {
  const g = Number.isFinite(genera) && genera > 0 ? Math.floor(genera) : 0;
  const diversity = Math.min(DIVERSITY_DAMPING_MAX, DIVERSITY_DAMPING_PER_GENUS * g);
  const protectedBy = weather.rough && hasCareRank(care, weather.protection) ? weather.protection! : null;
  const immune = !!weather.rough && mainTree !== undefined && (weather.immuneTrees ?? []).some((t) => t === mainTree);
  const factor = !weather.rough ? 1 : immune ? 0 : (1 - diversity) * (protectedBy !== null ? PROTECTION_FACTOR : 1);
  return { rough: !!weather.rough, genera: g, diversity, protectedBy, immune, factor };
}

/** Dämpfung für diesen Spielstand (Standard: das Wetter des laufenden Tages). */
export function weatherDamping(
  state: Pick<GameState, 'niches' | 'cycle'>,
  weather: Weather = weatherAt(state),
): WeatherDamping {
  return weatherDampingFor(weather, generaWithAnimals(allAnimals(state)).length, state.cycle.care, state.cycle.mainTree);
}

/** Wirkungen einer Wetterlage mit gedämpften Abzügen (Samen bleiben voll). */
export function dampedWeatherEffects(weather: Weather, damping: Pick<WeatherDamping, 'factor'>): TimedEffect[] {
  return weather.effects.map((e) => (e.pct < 0 ? { ...e, pct: e.pct * damping.factor } : { ...e }));
}

/** Gedämpfte Wirkungen einer Wetterlage für diesen Spielstand – Abzeichen und Tooltip. */
export function weatherEffects(state: Pick<GameState, 'niches' | 'cycle'>, weather: Weather = weatherAt(state)): TimedEffect[] {
  return dampedWeatherEffects(weather, weatherDamping(state, weather));
}

// ---------------------------------------------------------------------------
// Mittelwetter (offline, 21.5)
// ---------------------------------------------------------------------------

/** Anteile der Wetterlagen einer Jahreszeit (Gewichte / Summe). */
function weatherShares(season: SeasonId): [WeatherId, number][] {
  const entries = (Object.entries(WEATHER_WEIGHTS[season] ?? {}) as [WeatherId, number][]).map(
    ([id, w]) => [id, Number.isFinite(w) && w > 0 ? w : 0] as [WeatherId, number],
  );
  const total = entries.reduce((s, [, w]) => s + w, 0);
  return total > 0 ? entries.map(([id, w]) => [id, w / total]) : [];
}

/**
 * Langfristige Häufigkeit je Wetterlage einer Jahreszeit nach der Regel „nie zwei raue
 * Tage“ (ohne Tag 0 und Schonzeit): p_eff(w) = p(w) × (1 − r_vor) für raue Lagen, r_vor =
 * Anteil rauer Lagen der Vorjahreszeit. „Wechselhaft“ bekommt den Rest. Summe 1.
 */
export function weatherProbabilities(season: SeasonId): Partial<Record<WeatherId, number>> {
  const idx = Math.max(0, SEASON_IDS.indexOf(season));
  const prev = SEASON_IDS[(idx + SEASON_IDS.length - 1) % SEASON_IDS.length]!;
  const roughPrev = weatherShares(prev).reduce((s, [id, p]) => s + (isRough(id) ? p : 0), 0);
  const out: Partial<Record<WeatherId, number>> = {};
  let sum = 0;
  for (const [id, p] of weatherShares(season)) {
    const pe = isRough(id) ? p * (1 - roughPrev) : p;
    out[id] = (out[id] ?? 0) + pe;
    sum += pe;
  }
  out[AFTER_ROUGH_WEATHER] = (out[AFTER_ROUGH_WEATHER] ?? 0) + Math.max(0, 1 - sum);
  return out;
}

/** Mittelwetter einer Jahreszeit: Σ p_eff(w) × gedämpfte Wirkungen (gebrochene Prozente). */
export function averageWeatherEffectsFor(
  season: SeasonId,
  genera: number,
  care: Readonly<Record<string, number>> | undefined,
  mainTree: string | undefined,
): TimedEffect[] {
  const out: TimedEffect[] = [];
  for (const [id, p] of Object.entries(weatherProbabilities(season)) as [WeatherId, number][]) {
    if (!(p > 0)) continue;
    const weather = weatherById(id);
    for (const e of dampedWeatherEffects(weather, weatherDampingFor(weather, genera, care, mainTree))) {
      out.push({ ...e, pct: e.pct * p });
    }
  }
  return out;
}

/** Mittelwetter einer Jahreszeit für diesen Spielstand (offline, 21.5). */
export function averageWeatherEffects(state: Pick<GameState, 'niches' | 'cycle'>, season: SeasonId): TimedEffect[] {
  return averageWeatherEffectsFor(season, generaWithAnimals(allAnimals(state)).length, state.cycle.care, state.cycle.mainTree);
}

// ---------------------------------------------------------------------------
// Nacht (21.4, 21.6)
// ---------------------------------------------------------------------------

/** Sekunde im Tag (elapsed mod 180), zu der die spielerische Nacht beginnt bzw. endet. */
export const NIGHT_START_SECOND = roundSecond((NIGHT_START_PHASE - DAY_START_PHASE) * DAY_SECONDS);
export const NIGHT_END_SECOND = roundSecond((1 + NIGHT_END_PHASE - DAY_START_PHASE) * DAY_SECONDS);

/** Glättet Gleitkomma-Reste (0,45 × 180 = 81,00000000000001). */
function roundSecond(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** Sekunde im laufenden Tag, [0, 180). */
function secondOfDay(elapsed: number): number {
  const now = normalizeElapsed(elapsed);
  const s = now - Math.floor(now / DAY_SECONDS) * DAY_SECONDS;
  return s >= DAY_SECONDS ? 0 : s;
}

/** Spielerische Nacht (Sonnenuntergang bis Sonnenaufgang): Sekunde 81 bis 171 jedes Tages. */
export function isNight(elapsed: number): boolean {
  const s = secondOfDay(elapsed);
  return s >= NIGHT_START_SECOND && s < NIGHT_END_SECOND;
}

/** Spielzeit des nächsten Wechsels zwischen Tag und Nacht (> elapsed). */
export function nextNightChange(elapsed: number): number {
  const now = normalizeElapsed(elapsed);
  const dayStart = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;
  const s = now - dayStart;
  if (s < NIGHT_START_SECOND) return dayStart + NIGHT_START_SECOND;
  if (s < NIGHT_END_SECOND) return dayStart + NIGHT_END_SECOND;
  return dayStart + DAY_SECONDS + NIGHT_START_SECOND;
}

/**
 * Sekunden bis zum nächsten Wechsel zwischen Tag und Nacht (> 0). Infinity ab MAX_ELAPSED
 * – dort steht die Zeit still (wie secondsToNextSeason).
 */
export function secondsToNightChange(elapsed: number): number {
  const now = normalizeElapsed(elapsed);
  if (now >= MAX_ELAPSED) return Infinity;
  const left = nextNightChange(now) - now;
  return left > 0 ? left : Infinity;
}

/** Ist die Nachtart in dieser Jahreszeit aktiv (fehlende Liste: ganzjährig)? */
export function nocturnalInSeason(n: Nocturnal, season: SeasonId | undefined): boolean {
  return !n.seasons || (season !== undefined && n.seasons.includes(season));
}

/**
 * Nachtarten im Ökosystem, die in dieser Jahreszeit nachts wirken (je Art einmal, in der
 * Reihenfolge von NOCTURNAL) – für Karten und das 🌙 an der Raten-Anzeige.
 */
export function nocturnalSpecies(state: Pick<GameState, 'niches'>, season: SeasonId): Nocturnal[] {
  const present = new Set(allAnimals(state));
  return NOCTURNAL.filter((n) => present.has(n.species) && nocturnalInSeason(n, season));
}

/** Anteil der Nachtwirkung in einem Modus zur Spielzeit (live: 0 oder 1, Mittel: NIGHT_SHARE). */
export function nightShare(mode: AmbientMode, elapsed: number): number {
  if (mode === 'off') return 0;
  if (mode === 'average') return NIGHT_SHARE;
  return isNight(elapsed) ? 1 : 0;
}
