/**
 * Modell für Wetter und Nachtarten (docs/DESIGN_V2.md 21) – bis die Logik in src/core
 * steht. Bildet die Formeln aus 21.4 nach und liefert sie als `RunOptions.ambient` an
 * scripts/simulate.ts (Zeit-Boni bis zum nächsten Wechsel). Exakt, weil Wetter und Nacht
 * nur TimedEffect-Wirkungen haben; einzige Näherung: die Zufriedenheit der Nachtart wird am
 * Beginn der Nacht gemessen.
 *
 *   SIM_WEATHER=1 npx vitest run tests/weather-balance.test.ts --silent=false
 *
 * Nach der Umsetzung in core/ den Test auf die echte Logik umstellen und dieses Modell
 * löschen (wie scripts/season-model.ts, DESIGN_V2.md 16.5).
 */
import { DAY_SECONDS, DAY_START_PHASE, NIGHT_END_PHASE, NIGHT_SHARE, NIGHT_START_PHASE, NOCTURNAL } from '../src/content/daytime';
import type { TimedEffect } from '../src/content/events';
import { SEASON_IDS, SEASON_SECONDS, type SeasonId } from '../src/content/seasons';
import {
  AFTER_ROUGH_WEATHER,
  DIVERSITY_DAMPING_MAX,
  DIVERSITY_DAMPING_PER_GENUS,
  FIRST_DAY_WEATHER,
  GENTLE_DAYS,
  PROTECTION_FACTOR,
  WEATHERS_BY_ID,
  WEATHER_WEIGHTS,
  type Weather,
  type WeatherId,
} from '../src/content/weather';
import { evaluate } from '../src/core/formulas';
import { normalizeSeed, random } from '../src/core/rng';
import { allAnimals, type GameState } from '../src/core/state';
import { GENERA } from '../src/content/types';
import { SPECIES_BY_ID } from '../src/content/species';

/** Startwert des Wetters eines Zyklus (21.4): aus Zyklusnummer und Startzeit. */
export function weatherSeed(cycle: { number: number; startedAt?: number }): number {
  return normalizeSeed((cycle.startedAt ?? 0) + cycle.number * 1_000_003);
}

/** Gleichverteilte Zahl in [0, 1) für Tag n. */
export function weatherRoll(seed: number, day: number): number {
  return random({ rngState: normalizeSeed((seed ^ Math.imul(day >>> 0, 0x9e3779b1)) >>> 0) });
}

const seasonOfDay = (day: number): SeasonId => SEASON_IDS[day % SEASON_IDS.length]!;

/** Wetter nach Gewichten, ohne Regeln. */
export function rawWeather(seed: number, day: number): WeatherId {
  const weights = Object.entries(WEATHER_WEIGHTS[seasonOfDay(day)]) as [WeatherId, number][];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = weatherRoll(seed, day) * total;
  for (const [id, w] of weights) {
    r -= w;
    if (r < 0) return id;
  }
  return weights[weights.length - 1]![0];
}

const isRough = (id: WeatherId) => !!WEATHERS_BY_ID.get(id)!.rough;

/** Wetter an Tag n (21.4): Tag 0 ruhig, Schonzeit, nie zwei raue Tage hintereinander. */
export function weatherOfDay(seed: number, day: number): WeatherId {
  if (day === 0) return FIRST_DAY_WEATHER;
  const raw = rawWeather(seed, day);
  if (!isRough(raw)) return raw;
  if (day < GENTLE_DAYS) return AFTER_ROUGH_WEATHER;
  // Vortag zählt nur, wenn er selbst rau sein durfte (nach der Schonzeit).
  if (day - 1 >= GENTLE_DAYS && isRough(rawWeather(seed, day - 1))) return AFTER_ROUGH_WEATHER;
  return raw;
}

/** Gedämpfte Wirkungen eines Wetters für diesen Spielstand (21.3). */
export function weatherEffects(state: GameState, weather: Weather, genera?: number): TimedEffect[] {
  if (!weather.rough) return [...weather.effects];
  const g = genera ?? countGenera(state);
  const diversity = Math.min(DIVERSITY_DAMPING_MAX, DIVERSITY_DAMPING_PER_GENUS * g);
  const protectedBy = weather.protection !== undefined && (state.cycle.care[weather.protection] ?? 0) >= 1;
  const immune = (weather.immuneTrees ?? []).includes(state.cycle.mainTree);
  const factor = immune ? 0 : (1 - diversity) * (protectedBy ? PROTECTION_FACTOR : 1);
  return weather.effects.map((e) => (e.pct < 0 ? { ...e, pct: e.pct * factor } : e));
}

/** Gattungen mit mindestens einem Tier (ohne „zählt als Vogel“). */
export function countGenera(state: GameState): number {
  const seen = new Set<string>();
  for (const id of allAnimals(state)) seen.add(SPECIES_BY_ID.get(id)!.genus);
  return GENERA.filter((g) => seen.has(g)).length;
}

/** Ist der Tagesanteil Nacht (Sonnenuntergang bis Sonnenaufgang)? */
export const isNightPhase = (phase: number) => phase >= NIGHT_START_PHASE || phase < NIGHT_END_PHASE;

/** Sekunde im Tag, an der die Nacht beginnt bzw. endet (81 bzw. 171). */
const NIGHT_START_S = (NIGHT_START_PHASE - DAY_START_PHASE) * DAY_SECONDS;
const NIGHT_END_S = (1 + NIGHT_END_PHASE - DAY_START_PHASE) * DAY_SECONDS;

/** Nachtwirkungen der nachtaktiven Arten, mit ihrer Zufriedenheit skaliert (21.6). */
export function nightEffects(state: GameState, season: SeasonId, factor = 1): TimedEffect[] {
  const animals = new Set(allAnimals(state));
  const list = NOCTURNAL.filter((n) => animals.has(n.species) && (!n.seasons || n.seasons.includes(season)));
  if (list.length === 0) return [];
  const ev = evaluate(state);
  const out: TimedEffect[] = [];
  for (const n of list) {
    const h = ev.animals[n.species]?.happiness ?? 0;
    for (const e of n.effects) out.push({ ...e, pct: e.pct * h * factor });
  }
  return out;
}

export interface AmbientModel {
  weather: boolean;
  night: boolean;
  /** Mittelwetter und Nachtanteil wie offline (21.5) statt Einzelwetter. */
  average?: boolean;
}

/** Mittelwetter einer Jahreszeit (21.5): Σ p_eff(w) · gedämpfte Wirkungen. */
export function averageWeatherEffects(state: GameState, season: SeasonId): TimedEffect[] {
  const idx = SEASON_IDS.indexOf(season);
  const prev = SEASON_IDS[(idx + SEASON_IDS.length - 1) % SEASON_IDS.length]!;
  const share = (s: SeasonId) => {
    const w = WEATHER_WEIGHTS[s];
    const total = Object.values(w).reduce((a, b) => a + b!, 0);
    return Object.fromEntries(Object.entries(w).map(([id, v]) => [id, v! / total])) as Partial<Record<WeatherId, number>>;
  };
  const p = share(season);
  const roughPrev = Object.entries(share(prev)).reduce((s, [id, v]) => s + (isRough(id as WeatherId) ? v! : 0), 0);
  const genera = countGenera(state);
  const out: TimedEffect[] = [];
  for (const [id, v] of Object.entries(p) as [WeatherId, number][]) {
    const weather = WEATHERS_BY_ID.get(id)!;
    const pe = weather.rough ? v * (1 - roughPrev) : v;
    for (const e of weatherEffects(state, weather, genera)) out.push({ ...e, pct: e.pct * pe });
  }
  return out;
}

/** `RunOptions.ambient` für scripts/simulate.ts. */
export function ambientModel(model: AmbientModel) {
  return (state: GameState): { effects: TimedEffect[]; seconds: number } => {
    const e = state.cycle.elapsed;
    const day = Math.floor(e / SEASON_SECONDS + 1e-9);
    const inDay = e - day * SEASON_SECONDS;
    const season = seasonOfDay(day);
    const effects: TimedEffect[] = [];
    if (model.average) {
      if (model.weather) effects.push(...averageWeatherEffects(state, season));
      if (model.night) effects.push(...nightEffects(state, season, NIGHT_SHARE));
      // Neu rechnen am Tageswechsel (Jahreszeit) – und im Modell auch bei Änderungen am
      // Ökosystem, weil die Simulation spätestens an jedem Halt neu fragt.
      return { effects, seconds: Math.max(1e-6, SEASON_SECONDS - inDay) };
    }
    const seed = weatherSeed(state.cycle);
    if (model.weather) effects.push(...weatherEffects(state, WEATHERS_BY_ID.get(weatherOfDay(seed, day))!));
    const night = inDay >= NIGHT_START_S - 1e-9 && inDay < NIGHT_END_S - 1e-9;
    if (model.night && night) effects.push(...nightEffects(state, season));
    const stops = model.night ? [NIGHT_START_S, NIGHT_END_S, SEASON_SECONDS] : [SEASON_SECONDS];
    const next = stops.find((b) => b > inDay + 1e-9) ?? SEASON_SECONDS;
    return { effects, seconds: next - inDay };
  };
}
