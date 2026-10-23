import { describe, expect, it, vi, afterEach } from 'vitest';
import type { TimedEffect } from '../src/content/events';
import { HOME_SITE, LANDSCAPE_SITES, SITE_IDS, type SiteId } from '../src/content/landscape';
import { WEATHER_EVENT_FACTORS } from '../src/content/predation';
import { SEASON_IDS, SEASON_SECONDS, YEAR_SECONDS } from '../src/content/seasons';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { GENTLE_DAYS, OFFLINE_AVERAGE_MIN_SECONDS, WEATHERS, WEATHER_WEIGHTS, type WeatherId } from '../src/content/weather';
import { evaluate } from '../src/core/formulas';
import { ANCIENT_STAGE } from '../src/core/landscape';
import { createSite, type GameState } from '../src/core/state';
import { eventWeight, simulateOffline, startNewCycle, tick } from '../src/core/tick';
import {
  averageWeatherEffects,
  averageWeatherEffectsFor,
  dayIndex,
  isRough,
  rawWeather,
  sceneWeather,
  siteWeatherWeights,
  weatherAt,
  weatherEffects,
  weatherForecast,
  weatherOfDay,
  weatherOfDayFromSeed,
  weatherProbabilities,
  weatherSeed,
  weatherSiteOf,
} from '../src/core/weather';
import { stateAt } from './helpers';

/**
 * Wetter je Waldtyp (DESIGN_V2.md 24.14, Phase 7, 3c): Gewichte des aktiven Waldes in
 * core/weather.ts. Heimatwald und Stände ohne Landschaft bleiben Tag für Tag wie vor 3c.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** FNV-1a über einen Text – kurzer Fingerabdruck langer Wetterfolgen. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const seedOf = (c: number) => weatherSeed({ number: c, startedAt: 1_600_000_000_000 + c * 86_400_017 });

/** Spielstand mit aktivem Wald `site` (gegründet), sonst wie stateAt. */
function stateIn(site: SiteId, stage = 5, animals: string[] = [], seed = 4): GameState {
  const state = stateAt(stage, animals, seed);
  state.cycle.startedAt = 1_700_000_000_000;
  if (site !== HOME_SITE) state.meta.landscape.sites.push(createSite(site));
  state.meta.landscape.active = site;
  return state;
}

/** Erster Tag ab `from`, an dem `pred(Wetter im Wald, Wetter im Heimatwald)` gilt. */
function dayWhere(cycle: { number: number; startedAt?: number }, site: SiteId, pred: (here: WeatherId, home: WeatherId) => boolean, from = GENTLE_DAYS + 1): number {
  for (let d = from; d < 100_000; d++) if (pred(weatherOfDay(cycle, d, site), weatherOfDay(cycle, d))) return d;
  throw new Error('kein passender Tag');
}

const sumPct = (effects: readonly TimedEffect[], kind: TimedEffect['kind']) =>
  effects.filter((e) => e.kind === kind).reduce((s, e) => s + e.pct, 0);

describe('Heimatwald unverändert (Goldwerte vor 3c)', () => {
  // Fingerabdrücke mit dem Stand vor 3c gemessen (origin/main nach PR #120).
  const GOLD_SEQUENCE = '38ea6bfa';
  const GOLD_PROBABILITIES = 'a7f68c29';
  const GOLD_FIRST = 'mild,sun,fog,snow,mild,drought,mild,mild,fog,mild,storm,snow,mild,mild,mild,mild,mild,mild,mild,mild,rain,sun,fog,mild';

  function sequence(site?: SiteId): string {
    let seq = '';
    for (let c = 1; c <= 300; c++) {
      const seed = seedOf(c);
      for (let d = 0; d < 80; d++) {
        const w = site === undefined ? weatherOfDayFromSeed(seed, d) : weatherOfDayFromSeed(seed, d, site);
        const r = site === undefined ? rawWeather(seed, d) : rawWeather(seed, d, site);
        seq += w[0]! + r[1]!;
      }
    }
    return seq;
  }

  it('Wetter Tag für Tag (300 Zyklen × 80 Tage): ohne Argument, Heimatwald und unbekannter Standort gleich', () => {
    expect(fnv(sequence())).toBe(GOLD_SEQUENCE);
    expect(fnv(sequence(HOME_SITE))).toBe(GOLD_SEQUENCE);
    expect(fnv(sequence('atlantis' as SiteId))).toBe(GOLD_SEQUENCE);
    const first = Array.from({ length: 24 }, (_, d) => weatherOfDay({ number: 3, startedAt: 1_700_000_000_000 }, d, HOME_SITE));
    expect(first.join(',')).toBe(GOLD_FIRST);
  });

  it('Mittel und Anteile im Heimatwald wie vor 3c', () => {
    let probs = '';
    for (const s of SEASON_IDS) {
      for (const g of [false, true]) {
        probs += JSON.stringify(weatherProbabilities(s, g, HOME_SITE));
        probs += JSON.stringify(averageWeatherEffectsFor(s, 3, { 'leaf-litter': 1 }, 'oak', g, HOME_SITE));
      }
    }
    expect(fnv(probs)).toBe(GOLD_PROBABILITIES);
  });

  it('Stand ohne Landschaft (Teil-Stand) und mit kaputtem aktivem Wald: Heimatwald', () => {
    const state = stateIn(HOME_SITE);
    state.cycle.elapsed = 37 * SEASON_SECONDS + 5;
    const home = weatherAt(state).id;
    expect(weatherSiteOf({})).toBe(HOME_SITE);
    expect(weatherAt({ cycle: state.cycle }).id).toBe(home);
    const noLandscape = structuredClone(state);
    Reflect.deleteProperty(noLandscape.meta, 'landscape');
    expect(weatherAt(noLandscape).id).toBe(home);
    expect(weatherSiteOf(noLandscape)).toBe(HOME_SITE);
    // Aktiv, aber nicht gegründet (kaputter Stand zur Laufzeit) → Heimatwald.
    const broken = stateIn(HOME_SITE);
    broken.meta.landscape.active = 'heath';
    expect(weatherSiteOf(broken)).toBe(HOME_SITE);
  });
});

describe('Gewichte je Standort (24.14)', () => {
  it('siteWeatherWeights = WEATHER_WEIGHTS × Faktor, Reihenfolge wie die Daten, nur Lagen der Jahreszeit', () => {
    for (const site of LANDSCAPE_SITES) {
      for (const season of SEASON_IDS) {
        const base = Object.entries(WEATHER_WEIGHTS[season]) as [WeatherId, number][];
        const weights = siteWeatherWeights(season, site.id);
        expect(weights.map(([id]) => id), `${site.id} ${season}`).toEqual(base.map(([id]) => id));
        for (const [i, [id, w]] of weights.entries()) expect(w, `${site.id} ${season} ${id}`).toBe(base[i]![1] * (site.weather[id] ?? 1));
      }
    }
    expect(siteWeatherWeights('summer', 'heath')).toContainEqual(['drought', 25]);
    expect(siteWeatherWeights('winter', 'mountain')).toContainEqual(['snow', 60]);
    // Neuschnee nie außerhalb des Winters, auch im Bergmischwald.
    expect(siteWeatherWeights('summer', 'mountain').some(([id]) => id === 'snow')).toBe(false);
    // Unbekannter Standort = Heimatwald = Grunddaten.
    expect(siteWeatherWeights('autumn', 'atlantis' as SiteId)).toEqual(Object.entries(WEATHER_WEIGHTS.autumn));
    expect(siteWeatherWeights('autumn')).toEqual(Object.entries(WEATHER_WEIGHTS.autumn));
  });

  it('p_eff je Standort: Summe 1, rauer Anteil der Vorjahreszeit mit den Gewichten des Standorts', () => {
    for (const site of SITE_IDS) {
      for (const season of SEASON_IDS) {
        for (const gentle of [false, true]) {
          const p = weatherProbabilities(season, gentle, site);
          expect(Object.values(p).reduce((a, b) => a + b!, 0), `${site} ${season}`).toBeCloseTo(1, 12);
          for (const id of Object.keys(p)) expect(id in WEATHER_WEIGHTS[season] || id === 'mild', `${site} ${season} ${id}`).toBe(true);
        }
      }
    }
    // Heide im Sommer: Dürre 25 / 122,5 (40 + 45 ☀️ + 7,5 🌧️ + 25 🌡️ + 5 🌬️) × (1 − rauer Anteil im Heide-Frühling).
    const spring = siteWeatherWeights('spring', 'heath');
    const springTotal = spring.reduce((s, [, w]) => s + w, 0);
    const roughSpring = spring.filter(([id]) => isRough(id)).reduce((s, [, w]) => s + w, 0) / springTotal;
    expect(weatherProbabilities('summer', false, 'heath').drought).toBeCloseTo((25 / 122.5) * (1 - roughSpring), 12);
  });
});

describe('Häufigkeiten nach den Regeln (Tabelle 24.14)', () => {
  // Reihenfolge: ⛅ 🌧️ ☀️ 🌫️ 🌨️ 🌡️ 🌬️ 🧊 (Prozent, Tage nach der Schonzeit).
  const ORDER: WeatherId[] = ['mild', 'rain', 'sun', 'fog', 'snow', 'drought', 'storm', 'frost'];
  const TABLE: Record<SiteId, number[][]> = {
    home: [
      [41.4, 24.9, 20.0, 10.0, 0, 0, 0, 3.7],
      [40.7, 14.9, 30.1, 0, 0, 9.4, 4.8, 0],
      [37.9, 10.0, 10.0, 25.0, 0, 0, 17.0, 0],
      [39.9, 0, 0, 10.0, 30.1, 0, 4.0, 16.0],
    ],
    floodplain: [
      [33.2, 39.8, 16.0, 8.0, 0, 0, 0, 3.0],
      [36.7, 27.2, 27.3, 0, 0, 4.3, 4.4, 0],
      [33.5, 18.2, 9.1, 22.7, 0, 0, 16.4, 0],
      [39.5, 0, 0, 10.0, 30.1, 0, 4.1, 16.4],
    ],
    carr: [
      [37.5, 22.6, 18.2, 18.1, 0, 0, 0, 3.5],
      [42.5, 15.7, 31.7, 0, 0, 5.0, 5.0, 0],
      [29.7, 8.1, 8.0, 39.9, 0, 0, 14.3, 0],
      [35.4, 0, 0, 18.1, 27.3, 0, 3.9, 15.3],
    ],
    beechwood: [
      [39.3, 23.7, 19.0, 14.3, 0, 0, 0, 3.7],
      [41.6, 15.3, 30.9, 0, 0, 9.7, 2.4, 0],
      [35.4, 9.8, 9.8, 36.5, 0, 0, 8.6, 0],
      [36.3, 0, 0, 14.6, 29.3, 0, 2.2, 17.7],
    ],
    mountain: [
      [36.6, 33.2, 17.8, 8.8, 0, 0, 0, 3.6],
      [37.8, 20.9, 27.9, 0, 0, 8.8, 4.5, 0],
      [36.0, 14.3, 9.6, 23.8, 0, 0, 16.4, 0],
      [30.5, 0, 0, 7.6, 46.2, 0, 3.2, 12.5],
    ],
    heath: [
      [42.5, 12.7, 30.7, 10.3, 0, 0, 0, 3.8],
      [33.9, 6.1, 36.8, 0, 0, 19.3, 3.9, 0],
      [39.9, 5.0, 15.1, 25.0, 0, 0, 15.1, 0],
      [39.9, 0, 0, 10.0, 30.1, 0, 4.0, 16.0],
    ],
  };

  for (const site of SITE_IDS) {
    it(`${site}: gemessen (50 000 Tage je Jahreszeit) = Tabelle = p_eff ± 1 Punkt; nie zwei raue Tage`, () => {
      const counts = SEASON_IDS.map(() => new Map<WeatherId, number>());
      const totals = [0, 0, 0, 0];
      let twoRough = 0;
      for (let c = 1; c <= 1000; c++) {
        const seed = seedOf(c);
        let prev: WeatherId | null = null;
        for (let d = 0; d < 200 + GENTLE_DAYS; d++) {
          const w = weatherOfDayFromSeed(seed, d, site);
          if (prev !== null && isRough(prev) && isRough(w)) twoRough++;
          prev = w;
          if (d < GENTLE_DAYS) continue;
          const i = d % 4;
          counts[i]!.set(w, (counts[i]!.get(w) ?? 0) + 1);
          totals[i]!++;
        }
      }
      expect(twoRough).toBe(0);
      SEASON_IDS.forEach((season, i) => {
        expect(totals[i]).toBeGreaterThanOrEqual(10_000);
        const p = weatherProbabilities(season, false, site);
        ORDER.forEach((id, k) => {
          const measured = (counts[i]!.get(id) ?? 0) / totals[i]!;
          expect(Math.abs(measured - TABLE[site][i]![k]! / 100), `${site} ${season} ${id} Tabelle`).toBeLessThan(0.01);
          expect(Math.abs(measured - (p[id] ?? 0)), `${site} ${season} ${id} p_eff`).toBeLessThan(0.01);
        });
      });
    });
  }
});

describe('Spielstand: aktiver Wald bestimmt das Wetter', () => {
  it('weatherAt, Vorhersage und Szene nutzen den aktiven Wald', () => {
    const state = stateIn('heath');
    const day = dayWhere(state.cycle, 'heath', (here, home) => here !== home);
    state.cycle.elapsed = day * SEASON_SECONDS + 10;
    expect(weatherAt(state).id).toBe(weatherOfDay(state.cycle, day, 'heath'));
    expect(weatherAt(state).id).not.toBe(weatherOfDay(state.cycle, day));
    expect(weatherForecast(state).id).toBe(weatherOfDay(state.cycle, day + 1, 'heath'));
    const scene = sceneWeather(state.cycle, 'heath');
    expect(scene.weather).toBe(weatherAt(state).id);
    expect(scene.previous).toBe(weatherOfDay(state.cycle, day - 1, 'heath'));
    expect(sceneWeather(state.cycle).weather).toBe(weatherOfDay(state.cycle, day));
  });

  it('Ereignis-Gewichte: Faktor des Wetters im aktiven Wald (Käferjahr bei Dürre in der Heide)', () => {
    const state = stateIn('heath');
    const day = dayWhere(state.cycle, 'heath', (here, home) => here === 'drought' && home !== 'drought');
    state.cycle.elapsed = day * SEASON_SECONDS + 10;
    expect(eventWeight(state, 'beetle-year')).toBe(WEATHER_EVENT_FACTORS.drought!['beetle-year']);
    const home = structuredClone(state);
    home.meta.landscape.active = HOME_SITE;
    const homeFactor = WEATHER_EVENT_FACTORS[weatherAt(home).id]?.['beetle-year'] ?? 1;
    expect(eventWeight(home, 'beetle-year')).toBe(homeFactor);
    expect(eventWeight(state, 'beetle-year', 'off')).toBe(1);
  });

  it('Dämpfung und Wirkungen des Tages im aktiven Wald; evaluate live sieht sie', () => {
    const state = stateIn('heath', 5, ['vole']);
    const day = dayWhere(state.cycle, 'heath', (here, home) => here === 'drought' && home !== 'drought');
    state.cycle.elapsed = day * SEASON_SECONDS + 10;
    const home = structuredClone(state);
    home.meta.landscape.active = HOME_SITE;
    home.meta.landscape.sites = home.meta.landscape.sites.filter((s) => s.id === HOME_SITE);
    expect(sumPct(weatherEffects(state), 'seeds')).not.toBe(sumPct(weatherEffects(home), 'seeds'));
    // Wetter-Anteil von evaluate (live − off) = Wirkung des Tages im aktiven Wald.
    const live = evaluate(state, 'live').growthBonus - evaluate(state, 'off').growthBonus;
    expect(live).toBeCloseTo(sumPct(weatherEffects(state), 'growth') / 100, 12);
  });

  it('Mittel = Σ p_eff × gedämpfte Wirkung je Standort; evaluate „Mittel“ und Cache kennen den Wald', () => {
    for (const site of SITE_IDS) {
      const state = stateIn(site, 5, ['vole']);
      state.cycle.care = { 'leaf-litter': 1 };
      for (const season of SEASON_IDS) {
        const p = weatherProbabilities(season, false, site);
        let growth = 0;
        let seeds = 0;
        for (const w of WEATHERS) {
          const e = weatherEffects(state, w);
          growth += (p[w.id] ?? 0) * sumPct(e, 'growth');
          seeds += (p[w.id] ?? 0) * sumPct(e, 'seeds');
        }
        const avg = averageWeatherEffects(state, season);
        expect(sumPct(avg, 'growth'), `${site} ${season}`).toBeCloseTo(growth, 12);
        expect(sumPct(avg, 'seeds'), `${site} ${season}`).toBeCloseTo(seeds, 12);
      }
    }
    // Heide im Sommer: mehr Samen, weniger Wachstum als der Heimatwald (Dürre).
    const heath = stateIn('heath', 5, ['vole']);
    const home = stateIn(HOME_SITE, 5, ['vole']);
    expect(sumPct(averageWeatherEffects(heath, 'summer'), 'seeds')).toBeGreaterThan(sumPct(averageWeatherEffects(home, 'summer'), 'seeds'));
    expect(sumPct(averageWeatherEffects(heath, 'summer'), 'growth')).toBeLessThan(sumPct(averageWeatherEffects(home, 'summer'), 'growth'));
    // evaluate im Modus „Mittel“: Wetter-Anteil = Mittel des Standorts; erst Heimatwald, dann Heide
    // mit sonst gleichem Stand (Cache darf nicht das alte Mittel liefern).
    const state = stateIn(HOME_SITE, 5, ['vole']);
    state.meta.landscape.sites.push(createSite('heath'));
    state.cycle.elapsed = 5 * SEASON_SECONDS + 10; // Sommer, nach der Schonzeit
    const weatherPart = () => evaluate(state, 'average').growthBonus - evaluate(state, 'off').growthBonus;
    const atHome = weatherPart();
    state.meta.landscape.active = 'heath';
    const atHeath = weatherPart();
    expect(atHeath).not.toBeCloseTo(atHome, 9);
    expect(atHome).toBeCloseTo(sumPct(averageWeatherEffects({ ...state, meta: { ...state.meta, landscape: { ...state.meta.landscape, active: HOME_SITE } } }, 'summer'), 'growth') / 100, 12);
    expect(atHeath).toBeCloseTo(sumPct(averageWeatherEffects(state, 'summer'), 'growth') / 100, 12);
  });

  it('Wechsel des Waldes mit startNewCycle → Wetter des neuen Waldes', () => {
    const state = stateAt(ANCIENT_STAGE, ['earthworm', 'robin', 'bee'], 11);
    state.meta.forestMemory = 300;
    state.meta.achievements.push('ancient-forest');
    state.meta.regulars = ['earthworm'];
    expect(startNewCycle(state, 1_700_000_000_000, undefined, 'mountain').ok).toBe(true);
    expect(state.meta.landscape.active).toBe('mountain');
    const days = Array.from({ length: 200 }, (_, d) => {
      state.cycle.elapsed = d * SEASON_SECONDS + 1;
      return weatherAt(state).id;
    });
    expect(days).toEqual(Array.from({ length: 200 }, (_, d) => weatherOfDay(state.cycle, d, 'mountain')));
    expect(days).not.toEqual(Array.from({ length: 200 }, (_, d) => weatherOfDay(state.cycle, d)));
  });

  it('TickReport.weather nennt das Wetter im aktiven Wald (live und über ganze Jahre)', () => {
    const state = stateIn('mountain', 7);
    state.waypoint = WAYPOINT_COUNT;
    const r = tick(state, 40 * SEASON_SECONDS + 5);
    expect(r.weather).toEqual(Array.from({ length: 40 }, (_, i) => weatherOfDay(state.cycle, i + 1, 'mountain')));
    const big = stateIn('mountain', 7);
    big.waypoint = WAYPOINT_COUNT;
    const long = tick(big, 50 * YEAR_SECONDS, 'average');
    expect(long.weather.at(-1)).toBe(weatherOfDay(big.cycle, dayIndex(big.cycle.elapsed), 'mountain'));
    const n = long.weather.length;
    const last = dayIndex(big.cycle.elapsed);
    expect(long.weather).toEqual(Array.from({ length: n }, (_, i) => weatherOfDay(big.cycle, last - n + 1 + i, 'mountain')));
  });

  for (const site of ['heath', 'carr'] as SiteId[]) {
    it(`${site}: kleine Ticks = großer Tick (live) und simulateOffline = kleine Ticks im Mittel`, () => {
      const start = stateIn(site, 3, ['owl', 'vole', 'robin'], 21);
      const small = structuredClone(start);
      const big = structuredClone(start);
      for (let i = 0; i < 3 * YEAR_SECONDS; i++) tick(small, 1);
      tick(big, 3 * YEAR_SECONDS);
      expect(big.waypoint).toBe(small.waypoint);
      expect(big.rngState).toBe(small.rngState);
      expect(big.totalGrowth).toBeCloseTo(small.totalGrowth, 6);
      expect(big.seeds).toBeCloseTo(small.seeds, 6);

      const avgSmall = structuredClone(start);
      const offline = structuredClone(start);
      for (let i = 0; i < 2 * YEAR_SECONDS + 30; i++) tick(avgSmall, 1, 'average');
      expect(simulateOffline(offline, 2 * YEAR_SECONDS + 30).averaged).toBe(2 * YEAR_SECONDS + 30 >= OFFLINE_AVERAGE_MIN_SECONDS);
      expect(offline.waypoint).toBe(avgSmall.waypoint);
      expect(offline.rngState).toBe(avgSmall.rngState);
      expect(offline.totalGrowth).toBeCloseTo(avgSmall.totalGrowth, 6);
      expect(offline.seeds).toBeCloseTo(avgSmall.seeds, 6);
    });
  }

  it('Einzelwetter über viele Zyklen gemittelt ≈ Mittel des Standorts (Heide, Sommer, ± 0,3 Punkte)', () => {
    const state = stateIn('heath', 5, ['vole', 'robin']);
    let sum = 0;
    let n = 0;
    for (let c = 1; c <= 400; c++) {
      state.cycle.number = c;
      state.cycle.startedAt = 1_600_000_000_000 + c * 7_777_777;
      for (let year = 2; year < 30; year++) {
        state.cycle.elapsed = (year * 4 + 1) * SEASON_SECONDS + 10;
        sum += sumPct(weatherEffects(state), 'growth');
        n++;
      }
    }
    expect(Math.abs(sum / n - sumPct(averageWeatherEffects(state, 'summer'), 'growth'))).toBeLessThan(0.3);
  });

  it('kein Math.random, Spielstand-Zufall unberührt, Grenzfälle (Zeit NaN, negativ, unendlich)', () => {
    const spy = vi.spyOn(Math, 'random');
    const state = stateIn('floodplain');
    const rng = state.rngState;
    for (const t of [0, 179.9, 180, NaN, -5, Infinity, 1e300]) {
      state.cycle.elapsed = t;
      expect(() => weatherAt(state)).not.toThrow();
      expect(() => weatherForecast(state)).not.toThrow();
    }
    expect(weatherOfDay(state.cycle, NaN, 'floodplain')).toBe('mild');
    expect(weatherOfDay(state.cycle, -3, 'heath')).toBe('mild');
    expect(state.rngState).toBe(rng);
    expect(spy).not.toHaveBeenCalled();
  });
});
