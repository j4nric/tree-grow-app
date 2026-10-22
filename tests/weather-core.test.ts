import { afterEach, describe, expect, it, vi } from 'vitest';
import { NIGHT_SHARE, NOCTURNAL_BY_SPECIES } from '../src/content/daytime';
import type { TimedEffect } from '../src/content/events';
import { SEASON_IDS, SEASON_SECONDS, YEAR_SECONDS, type SeasonId } from '../src/content/seasons';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import {
  AFTER_ROUGH_WEATHER,
  DIVERSITY_DAMPING_MAX,
  FIRST_DAY_WEATHER,
  GENTLE_DAYS,
  OFFLINE_AVERAGE_MIN_SECONDS,
  PROTECTION_FACTOR,
  WEATHERS,
  WEATHERS_BY_ID,
  WEATHER_BLEND_SECONDS,
  type WeatherId,
} from '../src/content/weather';
import { evaluate, evaluateEcosystem, ecosystemOf, seedSecondsRate } from '../src/core/formulas';
import { deserialize, serialize } from '../src/core/save';
import { MAX_ELAPSED } from '../src/core/season';
import { SAVE_VERSION, type GameState } from '../src/core/state';
import { MAX_LIVE_SECONDS, simulateOffline, tick } from '../src/core/tick';
import {
  NIGHT_END_SECOND,
  NIGHT_START_SECOND,
  averageWeatherEffects,
  dayIndex,
  generaWithAnimals,
  isNight,
  isRough,
  nextNightChange,
  nocturnalSpecies,
  rawWeather,
  sceneWeather,
  secondsToNightChange,
  seasonOfDay,
  weatherAt,
  weatherDamping,
  weatherDampingFor,
  weatherEffects,
  weatherForecast,
  weatherOfDay,
  weatherOfDayFromSeed,
  weatherProbabilities,
  weatherRoll,
  weatherSeed,
} from '../src/core/weather';
import { generateDailyGoals } from '../src/core/daily';
import { stateAt } from './helpers';

/** Logik für Wetter und Nachtarten (DESIGN_V2.md 21, src/core/weather.ts). Daten: weather.test.ts. */

const cycleOf = (number: number, startedAt?: number) => ({ number, startedAt });

/** Erster Tag ab `from` (nach der Schonzeit) mit diesem Wetter in diesem Zyklus. */
function dayWith(cycle: { number: number; startedAt?: number }, id: WeatherId, from = GENTLE_DAYS + 1): number {
  for (let d = from; d < 100_000; d++) if (weatherOfDay(cycle, d) === id) return d;
  throw new Error(`kein Tag mit ${id}`);
}

/** Stand am Vormittag (Sekunde 10) eines Tages mit diesem Wetter. */
function stateOnWeather(id: WeatherId, animals: string[] = [], stage = 5): GameState {
  const state = stateAt(stage, animals, 7);
  state.cycle.startedAt = 1_700_000_000_000;
  state.cycle.elapsed = dayWith(state.cycle, id) * SEASON_SECONDS + 10;
  expect(weatherAt(state).id).toBe(id);
  expect(isNight(state.cycle.elapsed)).toBe(false);
  return state;
}

const sumPct = (effects: readonly TimedEffect[], kind: TimedEffect['kind']) =>
  effects.filter((e) => e.kind === kind).reduce((s, e) => s + e.pct, 0);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Auswahl: deterministisch, eigener Zufall (21.2, 21.4)', () => {
  it('gleicher Zyklus → gleiche Folge; Nummer und Startzeit ändern sie; kein Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random');
    });
    const a = cycleOf(3, 1_700_000_123_456);
    const days = (c: { number: number; startedAt?: number }) => Array.from({ length: 200 }, (_, d) => weatherOfDay(c, d));
    expect(days(a)).toEqual(days({ ...a }));
    expect(days(cycleOf(4, a.startedAt))).not.toEqual(days(a));
    expect(days(cycleOf(3, a.startedAt! + 1))).not.toEqual(days(a));
    expect(weatherSeed(a)).toBe(weatherSeed({ ...a }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('verändert den Spielstand-Zufall nicht (rngState), auch nicht in evaluate und tick ohne Wegpunkt', () => {
    const state = stateAt(7, ['owl', 'bat', 'earthworm'], 99);
    state.waypoint = WAYPOINT_COUNT;
    const rng = state.rngState;
    weatherAt(state);
    weatherForecast(state);
    sceneWeather(state.cycle);
    evaluate(state);
    tick(state, 3 * YEAR_SECONDS + 77);
    simulateOffline(state, 3600);
    expect(state.rngState).toBe(rng);
  });

  it('Startwert: fehlende oder kaputte Startzeit zählt als 0, kaputte Nummer als 0', () => {
    expect(weatherSeed(cycleOf(2))).toBe(weatherSeed(cycleOf(2, 0)));
    expect(weatherSeed(cycleOf(2, NaN))).toBe(weatherSeed(cycleOf(2, 0)));
    expect(weatherSeed(cycleOf(2, Infinity))).toBe(weatherSeed(cycleOf(2, 0)));
    expect(weatherSeed(cycleOf(NaN, 5))).toBe(weatherSeed(cycleOf(0, 5)));
    for (const s of [weatherSeed(cycleOf(1)), weatherSeed(cycleOf(1e12, 1e15))]) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });

  it('Rohwetter: Würfe in [0, 1), nur Wetter der Jahreszeit; Tag NaN/negativ wie Tag 0', () => {
    const seed = weatherSeed(cycleOf(1, 42));
    for (let d = 0; d < 400; d++) {
      const r = weatherRoll(seed, d);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
    expect(weatherRoll(seed, NaN)).toBe(weatherRoll(seed, 0));
    expect(weatherRoll(seed, -3)).toBe(weatherRoll(seed, 0));
    expect(weatherOfDay(cycleOf(1, 42), NaN)).toBe(FIRST_DAY_WEATHER);
    expect(weatherOfDay(cycleOf(1, 42), -10)).toBe(FIRST_DAY_WEATHER);
    // Sehr große Tage (bis MAX_ELAPSED): gültiges Wetter der passenden Jahreszeit.
    const last = dayIndex(MAX_ELAPSED);
    expect(seasonOfDay(last)).toBe('spring');
    expect(WEATHERS_BY_ID.has(weatherOfDay(cycleOf(1, 42), last))).toBe(true);
    expect(WEATHERS_BY_ID.has(weatherOfDay(cycleOf(1, 42), 1e300))).toBe(true);
  });
});

describe('Regeln (21.2)', () => {
  const CYCLES = 300;
  const DAYS = 400;
  const sequences = Array.from({ length: CYCLES }, (_, c) => {
    const seed = weatherSeed(cycleOf(c + 1, 1_650_000_000_000 + c * 86_400_017));
    return Array.from({ length: DAYS }, (_, d) => weatherOfDayFromSeed(seed, d));
  });

  it('Tag 0 ist immer „Wechselhaft“', () => {
    for (const days of sequences) expect(days[0]).toBe(FIRST_DAY_WEATHER);
    expect(FIRST_DAY_WEATHER).toBe('mild');
  });

  it('Schonzeit: im ersten Jahr (Tage 0–3) keine rauen Lagen – auch wenn das Rohwetter rau ist', () => {
    let roughRaw = 0;
    sequences.forEach((days, c) => {
      const seed = weatherSeed(cycleOf(c + 1, 1_650_000_000_000 + c * 86_400_017));
      for (let d = 0; d < GENTLE_DAYS; d++) {
        expect(isRough(days[d]!), `Zyklus ${c} Tag ${d}`).toBe(false);
        if (d > 0 && isRough(rawWeather(seed, d))) {
          roughRaw++;
          expect(days[d]).toBe(AFTER_ROUGH_WEATHER);
        }
      }
    });
    expect(roughRaw).toBeGreaterThan(0); // die Regel wurde wirklich gebraucht
  });

  it('nie zwei raue Tage hintereinander; nach der Schonzeit gibt es raue Tage', () => {
    let rough = 0;
    for (const days of sequences) {
      for (let d = 1; d < days.length; d++) {
        if (isRough(days[d]!)) rough++;
        expect(isRough(days[d]!) && isRough(days[d - 1]!)).toBe(false);
      }
    }
    expect(rough).toBeGreaterThan(CYCLES * DAYS * 0.1);
  });

  it('nur Wetter, die in der Jahreszeit vorkommen (Schnee nur im Winter usw.)', () => {
    for (const days of sequences.slice(0, 50)) {
      days.forEach((w, d) => {
        if (w === AFTER_ROUGH_WEATHER) return;
        const season = seasonOfDay(d);
        expect(weatherProbabilities(season)[w] ?? 0, `${season} ${w}`).toBeGreaterThan(0);
      });
    }
  });

  it('Häufigkeiten (120 000 Tage) = p_eff je Jahreszeit ± 1 Prozentpunkt', () => {
    const counts = SEASON_IDS.map(() => new Map<WeatherId, number>());
    const totals = [0, 0, 0, 0];
    for (const days of sequences) {
      for (let d = GENTLE_DAYS + 1; d < days.length; d++) {
        const i = d % 4;
        counts[i]!.set(days[d]!, (counts[i]!.get(days[d]!) ?? 0) + 1);
        totals[i]!++;
      }
    }
    expect(totals.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10_000);
    SEASON_IDS.forEach((season, i) => {
      const p = weatherProbabilities(season);
      for (const w of WEATHERS) {
        const measured = (counts[i]!.get(w.id) ?? 0) / totals[i]!;
        expect(Math.abs(measured - (p[w.id] ?? 0)), `${season} ${w.id}`).toBeLessThan(0.01);
      }
    });
  });

  it('p_eff: Summe 1, raue Lagen um den rauen Anteil der Vorjahreszeit gekürzt', () => {
    for (const s of SEASON_IDS) {
      const p = weatherProbabilities(s);
      expect(Object.values(p).reduce((a, b) => a + b!, 0), s).toBeCloseTo(1, 12);
    }
    // Frühling: Frost 5 % × (1 − 25 % rau im Winter) = 3,75 %; Wechselhaft 40 % + 1,25 %.
    expect(weatherProbabilities('spring').frost).toBeCloseTo(0.0375, 12);
    expect(weatherProbabilities('spring').mild).toBeCloseTo(0.4125, 12);
    expect(weatherProbabilities('summer').drought).toBeCloseTo(0.1 * 0.95, 12);
    expect(weatherProbabilities('winter').frost).toBeCloseTo(0.2 * 0.8, 12);
  });

  it('Neuer Zyklus → neue Folge; Vorhersage = Wetter von morgen', () => {
    const state = stateAt(5, [], 3);
    state.cycle.startedAt = 1_700_000_000_000;
    const before = Array.from({ length: 60 }, (_, d) => weatherOfDay(state.cycle, d));
    state.cycle.number++;
    const after = Array.from({ length: 60 }, (_, d) => weatherOfDay(state.cycle, d));
    expect(after).not.toEqual(before);
    for (const t of [0, 179.9, 180, 1000, 5 * YEAR_SECONDS + 3]) {
      state.cycle.elapsed = t;
      expect(weatherAt(state).id).toBe(weatherOfDay(state.cycle, Math.floor(t / 180)));
      expect(weatherForecast(state).id).toBe(weatherOfDay(state.cycle, Math.floor(t / 180) + 1));
    }
  });

  it('Laden: Stand ohne cycle.startedAt rechnet mit 0, ohne Absturz (Wetter braucht keine eigene Version)', () => {
    expect(SAVE_VERSION).toBe(13);
    const state = stateAt(4, ['owl'], 5);
    state.cycle.elapsed = 1234;
    const raw = JSON.parse(serialize(state));
    delete raw.cycle.startedAt;
    const loaded = deserialize(JSON.stringify(raw), 0)!;
    expect(loaded.cycle.startedAt).toBeUndefined();
    expect(weatherAt(loaded).id).toBe(weatherOfDay({ number: loaded.cycle.number, startedAt: 0 }, dayIndex(1234)));
    expect(() => evaluate(loaded)).not.toThrow();
    expect(() => simulateOffline(loaded, 3600)).not.toThrow();
    // Kein neues Feld im Spielstand.
    expect(Object.keys(JSON.parse(serialize(loaded)).cycle).sort()).toEqual(Object.keys(raw.cycle).sort());
  });
});

describe('Dämpfung rauer Lagen (21.3)', () => {
  const storm = WEATHERS_BY_ID.get('storm')!;
  const frost = WEATHERS_BY_ID.get('frost')!;

  it('je Gattung mit Tier −10 % des Abzugs, höchstens −50 %; Pflege halbiert; Kiefer nur bei Frost frei', () => {
    expect(weatherDampingFor(storm, 0, {}, 'oak').factor).toBe(1);
    expect(weatherDampingFor(storm, 1, {}, 'oak').factor).toBeCloseTo(0.9, 12);
    expect(weatherDampingFor(storm, 5, {}, 'oak').factor).toBeCloseTo(0.5, 12);
    expect(weatherDampingFor(storm, 6, {}, 'oak').diversity).toBe(DIVERSITY_DAMPING_MAX);
    expect(weatherDampingFor(storm, 5, { 'light-crown': 1 }, 'oak')).toMatchObject({
      protectedBy: 'light-crown',
      factor: 0.5 * PROTECTION_FACTOR,
    });
    // Falsche Maßnahme schützt nicht; Rang 0, NaN oder negativ zählen nicht.
    const cares: Record<string, number>[] = [{ pond: 2 }, { 'light-crown': 0 }, { 'light-crown': NaN }, { 'light-crown': -1 }];
    for (const care of cares) {
      expect(weatherDampingFor(storm, 0, care, 'oak').protectedBy, JSON.stringify(care)).toBeNull();
    }
    expect(weatherDampingFor(frost, 0, {}, 'pine')).toMatchObject({ immune: true, factor: 0 });
    expect(weatherDampingFor(storm, 0, {}, 'pine')).toMatchObject({ immune: false, factor: 1 });
    // Ruhige Lagen: immer Faktor 1. Unsinnige Gattungszahlen zählen als 0.
    expect(weatherDampingFor(WEATHERS_BY_ID.get('rain')!, 6, { 'light-crown': 1 }, 'pine')).toMatchObject({ rough: false, factor: 1 });
    expect(weatherDampingFor(storm, NaN, {}, 'oak').factor).toBe(1);
    expect(weatherDampingFor(storm, -3, {}, 'oak').factor).toBe(1);
    expect(weatherDampingFor(storm, 1e300, {}, 'oak').factor).toBeCloseTo(0.5, 12);
  });

  it('Gattungen: nur echte Tiere, je Gattung einmal („zählt als Vogel“ und Gäste nicht)', () => {
    expect(generaWithAnimals([])).toEqual([]);
    expect(generaWithAnimals(['bat'])).toEqual(['mammals']);
    expect(generaWithAnimals(['bat', 'vole', 'robin', 'bluetit', 'unknown'])).toEqual(['birds', 'mammals']);
    const state = stateOnWeather('storm', ['bat']);
    state.cycle.visitors = [{ id: 'cranes', remaining: 100 }];
    expect(weatherDamping(state).genera).toBe(1);
  });

  it('evaluate: Sturm −15 % 🌿 gedämpft, +25 % 🌰 voll; Harmonie unverändert', () => {
    // Wühlmaus (1 Gattung): −13,5 %; dazu Lichte Krone: −6,75 %.
    const state = stateOnWeather('storm', ['vole']);
    const live = evaluate(state);
    const off = evaluate(state, 'off');
    expect(live.growthBonus - off.growthBonus).toBeCloseTo(-0.135, 12);
    expect(live.seedsBonus - off.seedsBonus).toBeCloseTo(0.25, 12);
    expect(live.harmony).toBe(off.harmony);
    expect(live.avgHappiness).toBe(off.avgHappiness);
    expect(live.growth).toBeLessThan(off.growth);
    expect(live.seeds).toBeGreaterThan(off.seeds);
    state.cycle.care = { 'light-crown': 1 };
    expect(evaluate(state).growthBonus - evaluate(state, 'off').growthBonus).toBeCloseTo(-0.0675, 12);
    expect(sumPct(weatherEffects(state), 'growth')).toBeCloseTo(-6.75, 12);
  });

  it('Hain mit 5 Gattungen: −7,5 %; Kiefer bei Frost: kein Abzug, Samen voll', () => {
    const grove = stateOnWeather('storm', ['vole', 'robin', 'bee', 'earthworm', 'chanterelle']);
    expect(weatherDamping(grove).genera).toBe(5);
    expect(evaluate(grove).growthBonus - evaluate(grove, 'off').growthBonus).toBeCloseTo(-0.075, 12);
    const pine = stateOnWeather('frost');
    pine.cycle.mainTree = 'pine';
    expect(evaluate(pine).growthBonus - evaluate(pine, 'off').growthBonus).toBeCloseTo(0, 12);
    expect(evaluate(pine).seedsBonus - evaluate(pine, 'off').seedsBonus).toBeCloseTo(0.15, 12);
    pine.cycle.mainTree = 'oak';
    expect(evaluate(pine).growthBonus - evaluate(pine, 'off').growthBonus).toBeCloseTo(-0.1, 12);
  });

  it('Gruppen-Wirkungen: Nebel +30 % 🌿 für Moose & Farne, Sonne +20 % 🌰 für Blumen', () => {
    const fog = stateOnWeather('fog');
    fog.plants = ['moss'];
    const withFog = evaluate(fog);
    const without = evaluate(fog, 'off');
    expect(withFog.growthBonus - without.growthBonus).toBeCloseTo(0.05, 12);
    expect(withFog.plantGrowth / without.plantGrowth).toBeCloseTo((1.3 / 1) * (1 + withFog.growthBonus - without.damage) / (1 + without.growthBonus - without.damage), 9);
    const sun = stateOnWeather('sun');
    sun.plants = ['anemone'];
    expect(evaluate(sun).seedsBonus - evaluate(sun, 'off').seedsBonus).toBeCloseTo(0.1, 12);
  });

  it('Vorschauen sehen die Dämpfung des geänderten Ökosystems', () => {
    const state = stateOnWeather('storm');
    const now = evaluateEcosystem(ecosystemOf(state));
    const withVole = evaluateEcosystem(ecosystemOf(state, { niches: { ...state.niches, roots: ['vole'] } }));
    // Ohne Tier −15 %, mit Wühlmaus −13,5 % (plus deren eigene Wirkungen – nur der Wetteranteil zählt hier).
    const offNow = evaluateEcosystem(ecosystemOf(state, {}, 'off'));
    const offVole = evaluateEcosystem(ecosystemOf(state, { niches: { ...state.niches, roots: ['vole'] } }, 'off'));
    expect(now.growthBonus - offNow.growthBonus).toBeCloseTo(-0.15, 12);
    expect(withVole.growthBonus - offVole.growthBonus).toBeCloseTo(-0.135, 12);
  });
});

describe('Nacht (21.4, 21.6)', () => {
  it('Grenzen: Sekunde 81 bis 171 jedes Tages', () => {
    expect(NIGHT_START_SECOND).toBe(81);
    expect(NIGHT_END_SECOND).toBe(171);
    expect(isNight(0)).toBe(false);
    expect(isNight(80.999)).toBe(false);
    expect(isNight(81)).toBe(true);
    expect(isNight(170.999)).toBe(true);
    expect(isNight(171)).toBe(false);
    expect(isNight(179.999)).toBe(false);
    expect(isNight(180 + 81)).toBe(true);
    expect(isNight(1000 * YEAR_SECONDS + 100)).toBe(true);
    expect(isNight(NaN)).toBe(false);
    expect(isNight(-50)).toBe(false);
    expect(isNight(MAX_ELAPSED)).toBe(false);
    // Halbe Spielzeit ist Nacht.
    let n = 0;
    for (let t = 0; t < YEAR_SECONDS; t += 0.25) if (isNight(t)) n++;
    expect(n / (YEAR_SECONDS / 0.25)).toBeCloseTo(NIGHT_SHARE, 12);
  });

  it('nächster Wechsel: > jetzt, exakt auf den Grenzen; Infinity an der Obergrenze', () => {
    expect(secondsToNightChange(0)).toBe(81);
    expect(secondsToNightChange(80.5)).toBe(0.5);
    expect(secondsToNightChange(81)).toBe(90);
    expect(secondsToNightChange(171)).toBe(90);
    expect(nextNightChange(171)).toBe(261);
    expect(nextNightChange(179.5)).toBe(261);
    expect(secondsToNightChange(NaN)).toBe(81);
    expect(secondsToNightChange(-1)).toBe(81);
    expect(secondsToNightChange(MAX_ELAPSED)).toBe(Infinity);
    expect(secondsToNightChange(Infinity)).toBe(Infinity);
  });

  it('Waldkauz: nachts +10 % 🌿 × Zufriedenheit, auch im Winter; tagsüber nichts', () => {
    const state = stateAt(5, ['owl', 'vole'], 4);
    state.cycle.elapsed = 50; // Tag 0, Vormittag (Wechselhaft)
    const day = evaluate(state);
    const z = day.animals.owl!.happiness;
    expect(z).toBeGreaterThan(0);
    state.cycle.elapsed = 100; // Tag 0, Nacht
    const night = evaluate(state);
    expect(night.growthBonus - day.growthBonus).toBeCloseTo(0.1 * z, 12);
    expect(night.seedsBonus).toBe(day.seedsBonus);
    expect(night.harmony).toBe(day.harmony);
    // Winter (Tag 3, Schonzeit, kein rauer Tag): weiter aktiv.
    state.cycle.elapsed = 3 * SEASON_SECONDS + 100;
    const winterNight = evaluate(state);
    expect(winterNight.growthBonus - evaluate(state, 'off').growthBonus - sumPct(weatherEffects(state), 'growth') / 100).toBeCloseTo(
      0.1 * winterNight.animals.owl!.happiness,
      12,
    );
  });

  it('Langohr, Igel, Glühwürmchen: nicht im Winter', () => {
    for (const id of ['bat', 'hedgehog', 'glowworm']) {
      const state = stateAt(5, [id], 4);
      const n = NOCTURNAL_BY_SPECIES.get(id)!;
      const kind = n.effects[0]!.kind as 'growth' | 'seeds';
      const bonus = (ev: ReturnType<typeof evaluate>) => (kind === 'growth' ? ev.growthBonus : ev.seedsBonus);
      const ambient = (s: GameState) => sumPct(weatherEffects(s), kind) / 100;
      for (const season of SEASON_IDS) {
        state.cycle.elapsed = SEASON_IDS.indexOf(season) * SEASON_SECONDS + 100; // Nacht, Schonzeit
        const ev = evaluate(state);
        const extra = bonus(ev) - bonus(evaluate(state, 'off')) - ambient(state);
        const expected = season === 'winter' ? 0 : (n.effects[0]!.pct / 100) * ev.animals[id]!.happiness;
        expect(extra, `${id} ${season}`).toBeCloseTo(expected, 12);
        expect(nocturnalSpecies(state, season).map((x) => x.species), `${id} ${season}`).toEqual(season === 'winter' ? [] : [id]);
      }
    }
  });

  it('ohne Nachtarten ist die Nacht folgenlos', () => {
    const state = stateAt(5, ['vole', 'earthworm'], 4);
    state.cycle.elapsed = 50;
    const day = evaluate(state);
    state.cycle.elapsed = 100;
    expect(evaluate(state).growth).toBe(day.growth);
    expect(evaluate(state).seeds).toBe(day.seeds);
  });
});

describe('Mittel offline (21.5)', () => {
  it('Mittelwetter = Σ p_eff × gedämpfte Wirkung', () => {
    const state = stateAt(5, ['vole'], 4);
    state.cycle.care = { 'leaf-litter': 1 };
    for (const season of SEASON_IDS) {
      const p = weatherProbabilities(season);
      let growth = 0;
      let seeds = 0;
      for (const w of WEATHERS) {
        const e = weatherEffects(state, w);
        growth += (p[w.id] ?? 0) * sumPct(e, 'growth');
        seeds += (p[w.id] ?? 0) * sumPct(e, 'seeds');
      }
      const avg = averageWeatherEffects(state, season);
      expect(sumPct(avg, 'growth'), season).toBeCloseTo(growth, 12);
      expect(sumPct(avg, 'seeds'), season).toBeCloseTo(seeds, 12);
    }
    // Ungedämpft (ohne Tiere): Frühling +2,6 % 🌿 (Tabelle 21.3): 2,5 + 0,5 − 0,375.
    expect(sumPct(averageWeatherEffects(stateAt(5, [], 1), 'spring'), 'growth')).toBeCloseTo(2.625, 9);
  });

  it('evaluate im Modus „Mittel“: Mittelwetter der Jahreszeit + NIGHT_SHARE der Nachtwirkung, Tag und Nacht gleich', () => {
    const state = stateAt(5, ['owl', 'vole'], 4);
    state.cycle.elapsed = 5 * SEASON_SECONDS + 10; // Sommer, nach der Schonzeit
    const avg = evaluate(state, 'average');
    const off = evaluate(state, 'off');
    const z = off.animals.owl!.happiness;
    const weather = sumPct(averageWeatherEffects(state, 'summer'), 'growth') / 100;
    expect(avg.growthBonus - off.growthBonus).toBeCloseTo(weather + NIGHT_SHARE * 0.1 * z, 12);
    state.cycle.elapsed = 5 * SEASON_SECONDS + 100; // Sommernacht: dasselbe
    expect(evaluate(state, 'average').growthBonus).toBeCloseTo(avg.growthBonus, 12);
    expect(evaluate(state, 'average').harmony).toBe(avg.harmony);
  });

  it('Schonzeit offline: Tag 0 sein festes Wetter, Tage 1–3 Mittel ohne raue Lagen, danach Mittel', () => {
    for (const season of SEASON_IDS) {
      const gentle = weatherProbabilities(season, true);
      expect(Object.values(gentle).reduce((a, b) => a + b!, 0), season).toBeCloseTo(1, 12);
      for (const w of WEATHERS) if (w.rough) expect(gentle[w.id] ?? 0, `${season} ${w.id}`).toBe(0);
    }
    expect(weatherProbabilities('spring', true).mild).toBeCloseTo(0.45, 12); // 40 % + 5 % Frost
    // Gemessen: Tage 1–3 vieler Zyklen = Schonzeit-Mittel ± 1 Prozentpunkt.
    const counts = new Map<string, number>();
    let n = 0;
    for (let c = 1; c <= 4000; c++) {
      const seed = weatherSeed(cycleOf(c, 1_650_000_000_000 + c * 86_400_017));
      const w = weatherOfDayFromSeed(seed, 1); // Sommer
      counts.set(w, (counts.get(w) ?? 0) + 1);
      n++;
    }
    for (const [id, p] of Object.entries(weatherProbabilities('summer', true))) {
      expect(Math.abs((counts.get(id) ?? 0) / n - p!), id).toBeLessThan(0.01);
    }
    // evaluate im Modus „Mittel“ je Tag.
    const state = stateAt(5, ['vole'], 4);
    const avgGrowth = (t: number) => {
      state.cycle.elapsed = t;
      return evaluate(state, 'average').growthBonus - evaluate(state, 'off').growthBonus;
    };
    expect(avgGrowth(10)).toBeCloseTo(0, 12); // Tag 0: Wechselhaft, keine Nachtart
    expect(avgGrowth(SEASON_SECONDS + 10)).toBeCloseTo(sumPct(averageWeatherEffects(state, 'summer', true), 'growth') / 100, 12);
    expect(avgGrowth(5 * SEASON_SECONDS + 10)).toBeCloseTo(sumPct(averageWeatherEffects(state, 'summer'), 'growth') / 100, 12);
    // Sommer in der Schonzeit ohne Dürre und Sturm: besser als das Sommer-Mittel danach.
    expect(avgGrowth(SEASON_SECONDS + 10)).toBeGreaterThan(avgGrowth(5 * SEASON_SECONDS + 10));
    // Cache: Schonzeit-Sommer und späterer Sommer sind verschiedene Einträge.
    state.cycle.elapsed = SEASON_SECONDS + 10;
    const a = evaluate(state, 'average');
    state.cycle.elapsed = 5 * SEASON_SECONDS + 10;
    expect(evaluate(state, 'average')).not.toBe(a);
  });

  it('Schonzeit offline: kleine Ticks im Mittel = simulateOffline über das erste Jahr hinweg', () => {
    const start = stateAt(3, ['owl', 'vole', 'robin'], 21);
    const small = structuredClone(start);
    const offline = structuredClone(start);
    for (let i = 0; i < 2 * YEAR_SECONDS + 30; i++) tick(small, 1, 'average');
    simulateOffline(offline, 2 * YEAR_SECONDS + 30);
    expect(offline.waypoint).toBe(small.waypoint);
    expect(offline.rngState).toBe(small.rngState);
    expect(offline.totalGrowth).toBeCloseTo(small.totalGrowth, 6);
    expect(offline.seeds).toBeCloseTo(small.seeds, 6);
  });

  it('Einzelwetter über viele Zyklen gemittelt ≈ Mittelwetter (je Jahreszeit ± 0,3 Prozentpunkte)', () => {
    const state = stateAt(5, ['vole', 'robin'], 4);
    for (const season of SEASON_IDS) {
      let sum = 0;
      let n = 0;
      for (let c = 1; c <= 400; c++) {
        state.cycle.number = c;
        state.cycle.startedAt = 1_600_000_000_000 + c * 7_777_777;
        for (let year = 2; year < 30; year++) {
          state.cycle.elapsed = (year * 4 + SEASON_IDS.indexOf(season)) * SEASON_SECONDS + 10;
          sum += sumPct(weatherEffects(state), 'growth');
          n++;
        }
      }
      expect(Math.abs(sum / n - sumPct(averageWeatherEffects(state, season), 'growth')), season).toBeLessThan(0.3);
    }
  });

  it('simulateOffline: ab einem Tag gemittelt, darunter wie online', () => {
    const start = stateAt(5, ['owl', 'vole'], 4);
    start.cycle.elapsed = 60;
    const short = structuredClone(start);
    const shortOnline = structuredClone(start);
    const r = simulateOffline(short, OFFLINE_AVERAGE_MIN_SECONDS - 1);
    tick(shortOnline, OFFLINE_AVERAGE_MIN_SECONDS - 1);
    expect(r.averaged).toBe(false);
    expect(short).toEqual(shortOnline);
    const long = structuredClone(start);
    const longAvg = structuredClone(start);
    expect(simulateOffline(long, OFFLINE_AVERAGE_MIN_SECONDS).averaged).toBe(true);
    tick(longAvg, OFFLINE_AVERAGE_MIN_SECONDS, 'average');
    expect(long).toEqual(longAvg);
  });

  it('Mittel gegen Einzelwetter über 8 h: gleiche Größenordnung (± 3 %)', () => {
    const start = stateAt(7, ['owl', 'bat', 'vole', 'robin', 'bee'], 4);
    start.waypoint = WAYPOINT_COUNT;
    start.cycle.startedAt = 1_700_000_000_000;
    start.cycle.elapsed = 2 * YEAR_SECONDS;
    const live = structuredClone(start);
    const offline = structuredClone(start);
    tick(live, 8 * 3600);
    simulateOffline(offline, 8 * 3600);
    expect((offline.totalGrowth - start.totalGrowth) / (live.totalGrowth - start.totalGrowth)).toBeCloseTo(1, 1);
    expect(Math.abs((offline.seeds - start.seeds) / (live.seeds - start.seeds) - 1)).toBeLessThan(0.03);
  });
});

describe('tick: Halte und Bericht (21.9)', () => {
  it('hält bei Sonnenuntergang und -aufgang: Raten wechseln genau bei 81 und 171', () => {
    const state = stateAt(7, ['owl', 'vole'], 4);
    state.waypoint = WAYPOINT_COUNT;
    const g0 = state.totalGrowth;
    const day = evaluate(state).growth;
    state.cycle.elapsed = 100;
    const night = evaluate(state).growth;
    state.cycle.elapsed = 0;
    expect(night).toBeGreaterThan(day);
    tick(state, 175);
    // 81 s Tag, 90 s Nacht, 4 s Tag (alles Tag 0, „Wechselhaft“).
    expect(state.totalGrowth - g0).toBeCloseTo(85 * day + 90 * night, 6);
    // Exakt auf die Grenze gesetzt.
    const s = stateAt(7, [], 4);
    s.waypoint = WAYPOINT_COUNT;
    for (let i = 0; i < 81 * 7; i++) tick(s, 1 / 7);
    expect(Math.abs(s.cycle.elapsed - 81)).toBeLessThan(1e-9);
    const t = stateAt(7, [], 4);
    t.waypoint = WAYPOINT_COUNT;
    tick(t, 81);
    expect(t.cycle.elapsed).toBe(81);
    expect(isNight(t.cycle.elapsed)).toBe(true);
    tick(t, 90);
    expect(t.cycle.elapsed).toBe(171);
    expect(isNight(t.cycle.elapsed)).toBe(false);
  });

  it('Modus „Mittel“ hält nicht nachts: eine Rate je Jahreszeit', () => {
    const state = stateAt(7, ['owl', 'vole'], 4);
    state.waypoint = WAYPOINT_COUNT;
    const g0 = state.totalGrowth;
    const rate = evaluate(state, 'average').growth;
    tick(state, 175, 'average');
    expect(state.totalGrowth - g0).toBeCloseTo(175 * rate, 6);
  });

  it('TickReport.weather: Wetter jedes erreichten Tages, parallel zu seasons, gekürzt wie seasons', () => {
    const state = stateAt(7, [], 4);
    state.waypoint = WAYPOINT_COUNT;
    state.cycle.startedAt = 1_700_000_000_000;
    const r = tick(state, 10 * SEASON_SECONDS + 5);
    expect(r.seasons).toHaveLength(10);
    expect(r.weather).toEqual(Array.from({ length: 10 }, (_, i) => weatherOfDay(state.cycle, i + 1)));
    // Schnellvorlauf über Jahre (Mittel): dieselben Einträge wie schrittweise.
    const a = stateAt(7, [], 4);
    a.waypoint = WAYPOINT_COUNT;
    a.cycle.startedAt = 99;
    const b = structuredClone(a);
    const big = tick(a, 7 * YEAR_SECONDS + 20, 'average');
    const steps = { seasons: [] as SeasonId[], weather: [] as WeatherId[] };
    for (let i = 0; i < 28; i++) {
      const x = tick(b, SEASON_SECONDS, 'average');
      steps.seasons.push(...x.seasons);
      steps.weather.push(...x.weather);
    }
    tick(b, 20, 'average');
    expect(big.seasons).toEqual(steps.seasons);
    expect(big.weather).toEqual(steps.weather);
    expect(a.totalGrowth / b.totalGrowth).toBeCloseTo(1, 9);
    // 8 h offline: 160 Einträge (gekürzt auf MAX_REPORTED_SEASONS).
    const c = stateAt(7, [], 4);
    c.waypoint = WAYPOINT_COUNT;
    const long = tick(c, 200 * YEAR_SECONDS, 'average');
    expect(long.weather).toHaveLength(long.seasons.length);
    expect(long.weather.at(-1)).toBe(weatherOfDay(c.cycle, dayIndex(c.cycle.elapsed)));
  });

  it(`über MAX_LIVE_SECONDS rechnet tick gemittelt (endlich, schnell)`, () => {
    const a = stateAt(7, ['owl'], 4);
    a.waypoint = WAYPOINT_COUNT;
    const b = structuredClone(a);
    tick(a, MAX_LIVE_SECONDS + 1);
    tick(b, MAX_LIVE_SECONDS + 1, 'average');
    expect(a).toEqual(b);
    const c = stateAt(7, ['owl'], 4);
    tick(c, 1e15);
    expect(Number.isFinite(c.totalGrowth)).toBe(true);
  });

  it('an der Obergrenze der Spielzeit kein Nacht-Halt mehr (kein Hängenbleiben)', () => {
    const state = stateAt(7, ['owl'], 4);
    state.waypoint = WAYPOINT_COUNT;
    state.cycle.elapsed = MAX_ELAPSED;
    tick(state, 3 * SEASON_SECONDS);
    expect(state.cycle.elapsed).toBe(MAX_ELAPSED);
  });
});

describe('Cache und Samen-Sekunden (21.9)', () => {
  it('Cache: Treffer innerhalb von Tag bzw. Nacht, neu bei Nacht, neuem Wetter und Modus', () => {
    const state = stateAt(5, ['owl', 'vole'], 4);
    state.cycle.elapsed = 10;
    const first = evaluate(state);
    state.cycle.elapsed = 80;
    expect(evaluate(state)).toBe(first);
    state.cycle.elapsed = 81;
    const night = evaluate(state);
    expect(night).not.toBe(first);
    state.cycle.elapsed = 170;
    expect(evaluate(state)).toBe(night);
    expect(evaluate(state, 'average')).not.toBe(night);
    expect(evaluate(state, 'off')).not.toBe(evaluate(state, 'average'));
    // Neuer Tag mit anderem Wetter in derselben Jahreszeit: neuer Wert.
    state.cycle.startedAt = 1_700_000_000_000;
    const d1 = dayWith(state.cycle, 'storm');
    const d2 = dayWith(state.cycle, 'mild', d1 + 1);
    state.cycle.elapsed = d1 * SEASON_SECONDS + 5;
    const stormy = evaluate(state);
    state.cycle.elapsed = d2 * SEASON_SECONDS + 5;
    expect(evaluate(state)).not.toBe(stormy);
    // Pflege-Schutz ist im Schlüssel (über die Pflege-Ränge).
    state.cycle.elapsed = d1 * SEASON_SECONDS + 5;
    const unprotected = evaluate(state).growthBonus;
    state.cycle.care = { 'light-crown': 1 };
    expect(evaluate(state).growthBonus).toBeGreaterThan(unprotected);
  });

  it('Samen-Sekunden: ohne Wetter und Nacht – an rauen Tagen und nachts dieselbe Rate', () => {
    const state = stateOnWeather('storm', ['owl', 'bat', 'vole']);
    const stormDay = seedSecondsRate(state);
    expect(evaluate(state).seeds).toBeGreaterThan(evaluate(state, 'off').seeds); // der Sturm wirkt wirklich
    state.cycle.elapsed += 90; // Nacht
    expect(isNight(state.cycle.elapsed)).toBe(true);
    expect(seedSecondsRate(state)).toBe(stormDay);
    state.cycle.elapsed = 10;
    expect(seedSecondsRate(state)).toBe(stormDay);
  });
});

describe('Tagesziele ohne Wetter und Nacht (21, Review)', () => {
  it('gleiche Ziele am Tag, in der Nacht, an rauen und milden Tagen derselben Jahreszeit', () => {
    const state = stateOnWeather('storm', ['vole', 'robin', 'owl', 'bat', 'bee']);
    state.seeds = 5000;
    const stormDay = dayIndex(state.cycle.elapsed);
    const mildDay = (() => {
      for (let d = stormDay + 4; d < 100_000; d += 4) if (weatherOfDay(state.cycle, d) === 'mild') return d;
      throw new Error('kein milder Tag');
    })();
    const goalsAt = (t: number) => {
      state.cycle.elapsed = t;
      return Array.from({ length: 12 }, (_, i) => generateDailyGoals(state, `2026-10-${String(10 + i).padStart(2, '0')}`));
    };
    const base = goalsAt(stormDay * SEASON_SECONDS + 10);
    expect(evaluate(state).growth).not.toBe(evaluate(state, 'off').growth); // der Sturm wirkt
    expect(base.flat().some((g) => g.kind === 'growth')).toBe(true); // ein Ziel, das an der Rate hängt
    expect(goalsAt(stormDay * SEASON_SECONDS + 100)).toEqual(base); // Nacht
    expect(goalsAt(mildDay * SEASON_SECONDS + 10)).toEqual(base); // milder Tag
    expect(goalsAt(mildDay * SEASON_SECONDS + 100)).toEqual(base);
  });
});

describe('Grafik: sceneWeather (21.8)', () => {
  it('Tag 0 ohne Überblendung; am Tageswechsel 0 → 1 über WEATHER_BLEND_SECONDS', () => {
    const cycle = { number: 1, startedAt: 1_700_000_000_000, elapsed: 30 };
    expect(sceneWeather(cycle)).toEqual({ weather: 'mild', previous: 'mild', blend: 1 });
    const d = dayWith(cycle, 'storm');
    const prev = weatherOfDay(cycle, d - 1);
    expect(prev).not.toBe('storm');
    expect(sceneWeather({ ...cycle, elapsed: d * SEASON_SECONDS })).toEqual({ weather: 'storm', previous: prev, blend: 0 });
    expect(sceneWeather({ ...cycle, elapsed: d * SEASON_SECONDS + WEATHER_BLEND_SECONDS / 2 }).blend).toBeCloseTo(0.5, 12);
    expect(sceneWeather({ ...cycle, elapsed: d * SEASON_SECONDS + WEATHER_BLEND_SECONDS }).blend).toBe(1);
    expect(sceneWeather({ ...cycle, elapsed: NaN })).toEqual({ weather: 'mild', previous: 'mild', blend: 1 });
  });
});
