import { describe, expect, it } from 'vitest';
import { ENCOUNTER_WEIGHTS, PLANT_WEIGHT_RING_FULL } from '../src/content/encounters';
import { SEASONS_BY_ID, SEASON_SECONDS, YEAR_SECONDS, type SeasonId } from '../src/content/seasons';
import { SPECIES_BY_ID } from '../src/content/species';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import {
  appearsContext,
  cardStatus,
  ecosystemOf,
  environmentEffects,
  evaluate,
  evaluateEcosystem,
  seedSeconds,
  seedSecondsRate,
  slotBonuses,
  type Ecosystem,
} from '../src/core/formulas';
import { loadGame, serialize, v6Threshold } from '../src/core/save';
import {
  MAX_ELAPSED,
  nextSeasonBoundary,
  normalizeElapsed,
  sceneSeason,
  seasonIdAt,
  seasonIndex,
  secondsToNextSeason,
} from '../src/core/season';
import { SAVE_VERSION, emptyNiches, type GameState } from '../src/core/state';
import {
  chooseCard,
  drawEncounter,
  eligibleEvents,
  eligibleVisitors,
  isTreeUnlocked,
  previewNewCycle,
  simulateOffline,
  startNewCycle,
  tick,
  unlockedTrees,
} from '../src/core/tick';
import { fakeSpecies, stateAt, withFakeSpecies } from './helpers';

/** Spielzeit am Anfang der Jahreszeit (im ersten Jahr). */
const at = (season: SeasonId) => ({ spring: 0, summer: 1, autumn: 2, winter: 3 })[season] * SEASON_SECONDS;

/** Stand mit Jahreszeit und Baumart. */
function stateWith(stage: number, animals: string[], season: SeasonId, mainTree: GameState['cycle']['mainTree'] = 'oak', seed = 1): GameState {
  const state = stateAt(stage, animals, seed);
  state.cycle.elapsed = at(season);
  state.cycle.mainTree = mainTree;
  return state;
}

/** Reines Ökosystem (ohne Jahreszeit und Baumart) zum Vergleich. */
const plainEco = (stage: number, niches: Ecosystem['niches']): Ecosystem => ({ stage, niches, forestMemory: 0 });

describe('Jahreszeit aus der Spielzeit (DESIGN_V2.md 16.2)', () => {
  it('Grenzen: 179,999 Frühling, 180 Sommer, 720 wieder Frühling', () => {
    expect(seasonIndex(0)).toBe(0);
    expect(seasonIndex(179.999)).toBe(0);
    expect(seasonIndex(180)).toBe(1);
    expect(seasonIndex(359.999)).toBe(1);
    expect(seasonIndex(360)).toBe(2);
    expect(seasonIndex(540)).toBe(3);
    expect(seasonIndex(719.999)).toBe(3);
    expect(seasonIndex(720)).toBe(0);
    expect(seasonIdAt(8 * 3600)).toBe('spring'); // 8 h = 40 Jahre
    expect(YEAR_SECONDS).toBe(720);
  });

  it('ungültige Spielzeit zählt als Frühlingsbeginn, riesige Werte bleiben endlich', () => {
    for (const bad of [NaN, -1, -Infinity]) {
      expect(normalizeElapsed(bad)).toBe(0);
      expect(seasonIndex(bad)).toBe(0);
      expect(sceneSeason(bad)).toBeCloseTo(3.5);
    }
    expect(normalizeElapsed(Infinity)).toBe(MAX_ELAPSED);
    expect(normalizeElapsed(1e300)).toBe(MAX_ELAPSED);
    expect(seasonIndex(1e300)).toBeGreaterThanOrEqual(0);
    expect(seasonIndex(1e300)).toBeLessThan(4);
    // Ab der Obergrenze steht das Jahr still – kein Halt der Länge 0.
    expect(secondsToNextSeason(MAX_ELAPSED)).toBe(Infinity);
  });

  it('Restzeit bis zum Wechsel ist immer > 0', () => {
    expect(secondsToNextSeason(0)).toBe(180);
    expect(secondsToNextSeason(179.5)).toBeCloseTo(0.5);
    expect(secondsToNextSeason(180)).toBe(180);
    expect(nextSeasonBoundary(181)).toBe(360);
    for (let t = 0; t < 2000; t += 13.37) expect(secondsToNextSeason(t)).toBeGreaterThan(0);
  });

  it('Grafik blendet stufenlos über: Start 3,5, Mitte Frühling 0, Wechsel bei 0,5', () => {
    expect(sceneSeason(0)).toBeCloseTo(3.5);
    expect(sceneSeason(90)).toBeCloseTo(0);
    expect(sceneSeason(180)).toBeCloseTo(0.5);
    expect(sceneSeason(270)).toBeCloseTo(1);
    expect(sceneSeason(630)).toBeCloseTo(3);
    expect(sceneSeason(720)).toBeCloseTo(3.5);
    for (let t = 0; t < 3000; t += 7.1) {
      const v = sceneSeason(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
    }
    // Stetig (bis auf den Umlauf 4 → 0): kleine Schritte, kleine Änderungen.
    expect(Math.abs(sceneSeason(100.01) - sceneSeason(100))).toBeLessThan(0.001);
  });
});

describe('Wirkungen der Jahreszeiten (DESIGN_V2.md 16.3)', () => {
  const niches = { ...emptyNiches(), roots: ['earthworm'], edge: ['bee'], litter: ['woodlouse'] };
  const base = evaluateEcosystem(plainEco(3, niches));
  const inSeason = (season: SeasonId) => evaluateEcosystem({ ...plainEco(3, niches), season });

  it('Frühling: +10 % 🌿', () => {
    const ev = inSeason('spring');
    expect(ev.growthBonus).toBeCloseTo(base.growthBonus + 0.1);
    expect(ev.seedsBonus).toBeCloseTo(base.seedsBonus);
    expect(ev.growth).toBeGreaterThan(base.growth);
  });

  it('Sommer: +2 ☀️ (auch für „sonnig“), Insekten +10 % 😊', () => {
    const ev = inSeason('summer');
    expect(ev.light).toBeCloseTo(base.light + 2); // keines der Tiere hat Licht-Wirkungen
    expect(ev.animals.bee!.happiness).toBeCloseTo(Math.min(1, base.animals.bee!.happiness + 0.1));
    expect(ev.animals.earthworm!.happiness).toBeCloseTo(base.animals.earthworm!.happiness);
    expect(ev.growthBonus).toBeGreaterThanOrEqual(base.growthBonus);
  });

  it('Herbst: +20 % 🌰, Pilze +15 % 😊', () => {
    const ev = inSeason('autumn');
    expect(ev.seedsBonus).toBeCloseTo(base.seedsBonus + 0.2);
    expect(ev.seeds).toBeGreaterThan(base.seeds);
    const fungi = { ...emptyNiches(), roots: ['chanterelle'] };
    const plain = evaluateEcosystem(plainEco(3, fungi)).animals.chanterelle!.happiness;
    expect(evaluateEcosystem({ ...plainEco(3, fungi), season: 'autumn' }).animals.chanterelle!.happiness).toBeCloseTo(Math.min(1, plain + 0.15));
  });

  it('Winter: −10 % 🌿; Säugetiere +15 %, Bodenleben +10 % 😊', () => {
    const ev = inSeason('winter');
    // −10 %, etwas gemildert: Zufriedeneres Bodenleben wirkt stärker (🌿-Wirkung × z).
    let animals = 0;
    for (const id of ['earthworm', 'woodlouse']) {
      const pct = SPECIES_BY_ID.get(id)!.effects.reduce((sum, e) => sum + (e.kind === 'growth' ? e.pct / 100 : 0), 0);
      animals += pct * (ev.animals[id]!.happiness - base.animals[id]!.happiness);
    }
    expect(ev.growthBonus).toBeCloseTo(base.growthBonus - 0.1 + animals, 9);
    expect(ev.animals.earthworm!.happiness).toBeCloseTo(Math.min(1, base.animals.earthworm!.happiness + 0.1));
    expect(ev.animals.woodlouse!.happiness).toBeCloseTo(Math.min(1, base.animals.woodlouse!.happiness + 0.1));
    const mammals = { ...emptyNiches(), roots: ['vole'] };
    const plain = evaluateEcosystem(plainEco(3, mammals)).animals.vole!.happiness;
    const winter = evaluateEcosystem({ ...plainEco(3, mammals), season: 'winter' });
    expect(winter.animals.vole!.happiness).toBeCloseTo(Math.min(1, plain + 0.15));
    // Ohne Tiere bleibt nur der Abzug.
    expect(evaluateEcosystem({ ...plainEco(3, emptyNiches()), season: 'winter' }).growthBonus).toBeCloseTo(-0.1);
  });

  it('happiness wird auf 100 % begrenzt und wirkt vor der Begrenzung', () => {
    const fly = fakeSpecies({ id: 'testfly', niche: 'edge', genus: 'insects', level: 'herbivore', food: ['laub'] });
    withFakeSpecies([fly], () => {
      const n = { ...emptyNiches(), edge: ['testfly'] };
      expect(evaluateEcosystem(plainEco(3, n)).animals.testfly!.happiness).toBe(1);
      expect(evaluateEcosystem({ ...plainEco(3, n), season: 'summer' }).animals.testfly!.happiness).toBe(1);
      // Eiche (+10) und Sommer (+10) addieren sich.
      const sad = fakeSpecies({ id: 'testfly', niche: 'edge', genus: 'insects', level: 'herbivore', food: ['nektar'] });
      withFakeSpecies([sad], () => {
        const z0 = evaluateEcosystem(plainEco(3, n)).animals.testfly!.happiness;
        const z = evaluateEcosystem({ ...plainEco(3, n), season: 'summer', mainTree: 'oak' }).animals.testfly!.happiness;
        expect(z0).toBeLessThan(0.8);
        expect(z).toBeCloseTo(z0 + 0.2);
      });
    });
  });

  it('Durchreisende bekommen keine Zufriedenheit (sie sind nicht im Ökosystem)', () => {
    const { happiness } = environmentEffects(5, 'summer', 'oak');
    expect(happiness.map((h) => h.genus).sort()).toEqual(['insects', 'insects', 'reptiles']);
    const state = stateWith(5, ['bee'], 'summer');
    state.cycle.visitors = [{ id: 'hummingbird-moth', remaining: 100 }];
    state.cycle.seen = ['hummingbird-moth'];
    expect(Object.keys(evaluate(state).animals)).toEqual(['bee']);
  });

  it('Faktor 1, nicht mit Zufriedenheit skaliert; evaluate(state) nutzt die Spielzeit', () => {
    // Ohne Wetter und Nacht ('off'): hier zählt nur die Jahreszeit (Wetter: tests/weather.test.ts).
    const state = stateWith(4, [], 'autumn');
    expect(evaluate(state, 'off').seedsBonus).toBeCloseTo(0.2);
    state.cycle.elapsed = at('winter');
    expect(evaluate(state, 'off').growthBonus).toBeCloseTo(-0.1);
  });
});

describe('Hauptbaum-Arten (DESIGN_V2.md 17.3)', () => {
  it('Eiche: +1 Platz Krone ab Junger Baum, Insekten +10 % 😊, Eicheln ab Alter Baum', () => {
    const young = stateWith(3, [], 'spring', 'oak');
    expect(evaluate(young).slots.crown).toBe(3);
    expect(evaluate(stateWith(2, [], 'spring', 'oak')).slots.crown).toBe(0); // Krone noch zu
    expect(appearsContext(ecosystemOf(young)).tags.has('nuesse')).toBe(false);
    expect(appearsContext(ecosystemOf(stateWith(4, [], 'spring', 'oak'))).tags.has('nuesse')).toBe(true);
    expect(environmentEffects(0, undefined, 'oak').happiness).toEqual([{ kind: 'happiness', genus: 'insects', points: 10 }]);
  });

  it('Buche: +1 Platz Wurzelraum und −2 ☀️ erst ab Alter Baum, Pilze +15 % 😊', () => {
    // Seit Schritt 2.10 ab Alter Baum (vorher ab Keimling, DESIGN_V2.md 17.3).
    expect(evaluate(stateWith(3, [], 'spring', 'beech')).slots.roots).toBe(2);
    expect(evaluate(stateWith(3, [], 'spring', 'oak')).slots.roots).toBe(2);
    expect(evaluate(stateWith(4, [], 'spring', 'beech')).slots.roots).toBe(4);
    expect(evaluate(stateWith(4, [], 'spring', 'oak')).slots.roots).toBe(3);
    expect(evaluate(stateWith(3, [], 'spring', 'beech')).light).toBe(5);
    expect(evaluate(stateWith(4, [], 'spring', 'beech')).light).toBe(7 - 2);
    expect(environmentEffects(0, undefined, 'beech').happiness).toEqual([{ kind: 'happiness', genus: 'fungi', points: 15 }]);
  });

  it('Buche: der zusätzliche Platz gilt auch beim Wählen einer Karte', () => {
    const roots = ['earthworm', 'vole', 'mole'];
    for (const [tree, status] of [['beech', 'free'], ['oak', 'full']] as const) {
      const state = stateWith(4, roots, 'spring', tree);
      state.pendingEncounters = [{ type: 'animal', cards: ['chanterelle'], rerolls: 0 }];
      expect(cardStatus(state, 0, 0), tree).toBe(status);
      expect(slotBonuses(state).some((b) => b.niche === 'roots'), tree).toBe(tree === 'beech');
    }
    const state = stateWith(4, roots, 'spring', 'beech');
    state.pendingEncounters = [{ type: 'animal', cards: ['chanterelle'], rerolls: 0 }];
    expect(chooseCard(state, 0, 0).ok).toBe(true);
    expect(state.niches.roots).toEqual([...roots, 'chanterelle']);
  });

  it('Kiefer: +1 ☀️, +1 💧, Nadeln, keine Nüsse', () => {
    const pine = evaluate(stateWith(4, [], 'spring', 'pine'));
    expect(pine.light).toBe(7 + 1);
    expect(pine.water).toBe(7 + 1);
    const ctx = appearsContext(ecosystemOf(stateWith(4, [], 'spring', 'pine')));
    expect(ctx.tags.has('nadeln')).toBe(true);
    expect(ctx.tags.has('nuesse')).toBe(false);
    expect(ctx.tags.has('laub')).toBe(true);
  });

  it('Kiefer ohne Nüsse: Eichhörnchen hungrig, Mastjahr und Bergfinken bleiben aus', () => {
    expect(evaluate(stateWith(4, ['squirrel'], 'spring', 'pine')).animals.squirrel!.food).toBe(0);
    expect(evaluate(stateWith(4, ['squirrel'], 'spring', 'oak')).animals.squirrel!.food).toBeGreaterThan(0);
    expect(eligibleEvents(stateWith(5, [], 'autumn', 'oak')).map((e) => e.id)).toContain('mast-year');
    expect(eligibleEvents(stateWith(5, [], 'autumn', 'pine')).map((e) => e.id)).not.toContain('mast-year');
    expect(eligibleVisitors(stateWith(5, [], 'winter', 'oak')).map((v) => v.id)).toContain('bramblings');
    expect(eligibleVisitors(stateWith(5, [], 'winter', 'pine')).map((v) => v.id)).not.toContain('bramblings');
  });

  it('Kiefer ist winterfest: kein Abzug im Winter, die Zufriedenheit bleibt', () => {
    expect(evaluate(stateWith(4, [], 'winter', 'oak'), 'off').growthBonus).toBeCloseTo(-0.1);
    expect(evaluate(stateWith(4, [], 'winter', 'pine'), 'off').growthBonus).toBeCloseTo(0);
    const env = environmentEffects(4, 'winter', 'pine');
    expect(env.effects.some((e) => e.kind === 'growth')).toBe(false);
    expect(env.happiness.map((h) => h.genus).sort()).toEqual(['mammals', 'soil']);
    // Der Sommer wirkt für die Kiefer genauso: +2 ☀️ obendrauf.
    expect(evaluate(stateWith(4, [], 'summer', 'pine')).light).toBe(7 + 1 + 2);
  });

  it('ohne Baumart (reines Ökosystem) Merkmale der Eiche, aber keine Eigenheiten', () => {
    const n = { ...emptyNiches(), crown: ['bluetit'] };
    expect(evaluateEcosystem(plainEco(3, n)).slots.crown).toBe(2);
    expect(evaluateEcosystem({ ...plainEco(3, n), mainTree: 'oak' }).slots.crown).toBe(3);
    expect(appearsContext({ stage: 4, niches: n }).tags.has('nuesse')).toBe(true);
  });
});

describe('tick und Offline mit Jahreszeiten (DESIGN_V2.md 16.6)', () => {
  it('hält an der Grenze an: Raten wechseln genau dort, elapsed wird exakt gesetzt', () => {
    const state = stateWith(7, [], 'summer');
    state.waypoint = WAYPOINT_COUNT; // keine Wegpunkte mehr
    state.cycle.elapsed = at('autumn') - 1;
    const rate = (season: SeasonId) => evaluateEcosystem({ ...ecosystemOf(state), season }).seeds;
    const before = state.seeds;
    const report = tick(state, 2);
    expect(report.seasons).toEqual(['autumn']);
    expect(state.cycle.elapsed).toBe(at('autumn') + 1);
    expect(state.seeds - before).toBeCloseTo(rate('summer') + rate('autumn'), 9);
    // Genau bis zur Grenze: elapsed ist exakt die Grenze, kein Rundungsrest.
    const s2 = stateWith(7, [], 'spring');
    s2.waypoint = WAYPOINT_COUNT;
    for (let i = 0; i < 3; i++) tick(s2, 0.1);
    tick(s2, 180 - 0.30000000000000004);
    expect(s2.cycle.elapsed === 180 || Math.abs(s2.cycle.elapsed - 180) < 1e-9).toBe(true);
    expect(seasonIdAt(s2.cycle.elapsed + 1e-9)).toBe('summer');
  });

  it('meldet jede erreichte Jahreszeit in Reihenfolge', () => {
    const state = stateWith(7, [], 'spring');
    state.waypoint = WAYPOINT_COUNT;
    const report = tick(state, 3 * SEASON_SECONDS + 10);
    expect(report.seasons).toEqual(['summer', 'autumn', 'winter']);
    expect(tick(state, 1).seasons).toEqual([]);
  });

  // Seit Wetter und Nacht (DESIGN_V2.md 21.5) zweigeteilt: Frames = ein großer Tick mit
  // Einzelwetter, und Frames im Modus „Mittel“ = simulateOffline.
  it('Frames (dt = 1/60) gleich einem großen Tick bzw. simulateOffline über mehrere Jahre', () => {
    const start = stateAt(3, ['earthworm', 'bee', 'bluetit'], 2026);
    start.cycle.elapsed = 170; // kurz vor dem Sommer
    const seconds = 2 * YEAR_SECONDS + 100;
    for (const mode of ['live', 'average'] as const) {
      const online = structuredClone(start);
      const offline = structuredClone(start);
      const seen: SeasonId[] = [];
      const weather: string[] = [];
      for (let i = 0; i < seconds * 60; i++) {
        const r = tick(online, 1 / 60, mode);
        seen.push(...r.seasons);
        weather.push(...r.weather);
      }
      const report = mode === 'live' ? tick(offline, seconds) : simulateOffline(offline, seconds);
      expect(report.seasons, mode).toEqual(seen);
      expect(report.weather, mode).toEqual(weather);
      expect(seen.length).toBe(9);
      expect(offline.cycle.elapsed).toBeCloseTo(online.cycle.elapsed, 6);
      expect(offline.waypoint).toBe(online.waypoint);
      expect(offline.waypoint).toBeGreaterThan(stateAt(3).waypoint);
      expect(offline.stage).toBe(online.stage);
      expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
      expect(offline.cycle.seen).toEqual(online.cycle.seen);
      expect(offline.rngState).toBe(online.rngState);
      expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, 3);
      expect(offline.seeds).toBeCloseTo(online.seeds, 3);
    }
  });

  it('ein großer Tick = viele Jahres-Ticks (Schnellvorlauf ohne Unterschied)', () => {
    const a = stateWith(7, ['earthworm', 'vole', 'bee'], 'spring');
    a.waypoint = WAYPOINT_COUNT;
    const b = structuredClone(a);
    const report = tick(a, 10 * YEAR_SECONDS + 50);
    for (let i = 0; i < 10 * 4; i++) tick(b, SEASON_SECONDS);
    tick(b, 50);
    expect(a.cycle.elapsed).toBe(b.cycle.elapsed);
    expect(a.seeds / b.seeds).toBeCloseTo(1, 9);
    expect(a.totalGrowth / b.totalGrowth).toBeCloseTo(1, 9);
    expect(report.seasons.length).toBe(40);
    expect(report.seasons.at(-1)).toBe('spring');
  });

  it('Schnellvorlauf mit Zeit-Bonus und Gast im übersprungenen Zeitraum = kleine Schritte', () => {
    const a = stateWith(7, ['earthworm', 'vole', 'bee'], 'spring');
    a.waypoint = WAYPOINT_COUNT;
    a.cycle.seen = ['midsummer', 'cranes'];
    a.cycle.timed = [{ source: 'midsummer', effect: { kind: 'growth', pct: 30 }, remaining: 3 * YEAR_SECONDS + 100 }];
    a.cycle.visitors = [{ id: 'cranes', remaining: 5 * YEAR_SECONDS + 7 }];
    const b = structuredClone(a);
    const big = tick(a, 10 * YEAR_SECONDS + 50);
    const expired: string[] = [];
    for (let i = 0; i < 10 * 720 + 50; i++) expired.push(...tick(b, 1).expired);
    expect(big.expired).toEqual(['midsummer', 'cranes']);
    expect(expired).toEqual(big.expired);
    expect(a.cycle.timed).toEqual([]);
    expect(a.cycle.visitors).toEqual([]);
    expect(a.cycle.elapsed).toBeCloseTo(b.cycle.elapsed, 6);
    expect(a.seeds / b.seeds).toBeCloseTo(1, 9);
    expect(a.totalGrowth / b.totalGrowth).toBeCloseTo(1, 9);
  });

  it('an der Obergrenze steht das Jahr still: der letzte Wechsel wird genau einmal gemeldet', () => {
    const state = stateWith(7, [], 'winter');
    state.waypoint = WAYPOINT_COUNT;
    state.cycle.elapsed = MAX_ELAPSED - 10;
    expect(tick(state, 20).seasons).toEqual(['spring']);
    expect(state.cycle.elapsed).toBe(MAX_ELAPSED);
    expect(tick(state, 10 * YEAR_SECONDS).seasons).toEqual([]);
    expect(state.cycle.elapsed).toBe(MAX_ELAPSED);
  });

  it('8 h offline: 160 Wechsel, Ergebnis wie in Ein-Stunden-Schritten', () => {
    const a = stateAt(2, ['earthworm', 'robin'], 99);
    const b = structuredClone(a);
    const report = simulateOffline(a, 8 * 3600);
    // Offline rechnet ab einem Tag mit dem Mittelwetter (21.5) – die Stunden-Schritte auch.
    for (let h = 0; h < 8; h++) tick(b, 3600, 'average');
    expect(report.averaged).toBe(true);
    expect(report.weather.length).toBe(160);
    expect(report.seasons.length).toBe(160);
    expect(a.cycle.elapsed).toBeCloseTo(8 * 3600, 6);
    expect(b.cycle.elapsed).toBeCloseTo(a.cycle.elapsed, 6);
    expect(b.waypoint).toBe(a.waypoint);
    expect(b.pendingEncounters).toEqual(a.pendingEncounters);
    expect(b.rngState).toBe(a.rngState);
    expect(b.seeds / a.seeds).toBeCloseTo(1, 6);
  });

  it('kaputte Spielzeit im Stand: tick rechnet ab Frühlingsbeginn weiter', () => {
    const state = stateAt(3, [], 1);
    state.cycle.elapsed = NaN;
    tick(state, 10);
    expect(state.cycle.elapsed).toBeCloseTo(10);
    state.cycle.elapsed = -50;
    tick(state, 1);
    expect(state.cycle.elapsed).toBeCloseTo(1);
  });
});

describe('Ziehen nach Jahreszeit (DESIGN_V2.md 16.4)', () => {
  const share = (season: SeasonId, plants: string[]) => {
    let n = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const state = stateWith(3, [], season, 'oak', seed);
      state.waypoint = 10;
      state.plants = plants;
      if (drawEncounter(state)!.type === 'plant') n++;
    }
    return n / 3000;
  };

  it('Frühling: „Etwas keimt“ × 1,5 – aber nur, solange der Ring Platz hat', () => {
    const [animal, plant, event, visitor] = ENCOUNTER_WEIGHTS[3]!;
    const factor = SEASONS_BY_ID.get('spring')!.encounterFactors!.plant!;
    expect(share('spring', [])).toBeCloseTo((plant * factor) / (animal + plant * factor + event + visitor), 1);
    expect(share('summer', [])).toBeCloseTo(plant / (animal + plant + event + visitor), 1);
    expect(share('spring', [])).toBeGreaterThan(share('summer', []) + 0.04);
    // Voller Ring: wie sonst PLANT_WEIGHT_RING_FULL, kein Frühlingsfaktor.
    const full = ['hazel', 'hazel', 'birch'];
    const expected = (plant * PLANT_WEIGHT_RING_FULL) / (animal + plant * PLANT_WEIGHT_RING_FULL + event + visitor);
    expect(share('spring', full)).toBeCloseTo(expected, 1);
    expect(Math.abs(share('spring', full) - share('summer', full))).toBeLessThan(0.03);
  });

  it('Kraniche nicht im Winter, Bergfinken nicht im Frühling; Ereignisse nach ihrer Jahreszeit', () => {
    const visitors = (season: SeasonId) => eligibleVisitors(stateWith(5, [], season)).map((v) => v.id);
    expect(visitors('winter')).not.toContain('cranes');
    expect(visitors('spring')).toContain('cranes');
    expect(visitors('autumn')).toContain('cranes');
    expect(visitors('spring')).not.toContain('bramblings');
    expect(visitors('winter')).toContain('bramblings');
    const events = (season: SeasonId) => eligibleEvents(stateWith(5, [], season)).map((e) => e.id);
    expect(events('spring')).toContain('rain');
    expect(events('summer')).not.toContain('rain');
    expect(events('summer')).toContain('midsummer');
    // Ganzjährig: Sturmnacht.
    for (const s of ['spring', 'summer', 'autumn', 'winter'] as const) expect(events(s)).toContain('storm');
  });

  it('ein schon gezogenes Ereignis bleibt über den Wechsel hinaus', () => {
    const state = stateWith(7, [], 'spring');
    state.waypoint = WAYPOINT_COUNT;
    state.pendingEncounters = [{ type: 'event', cards: ['rain'], rerolls: 0 }];
    state.cycle.seen = ['rain'];
    tick(state, 2 * SEASON_SECONDS);
    expect(state.pendingEncounters).toEqual([{ type: 'event', cards: ['rain'], rerolls: 0 }]);
  });
});

describe('Samen-Sekunden und Cache', () => {
  it('Samen-Sekunden rechnen ohne Jahreszeit (kein Warten auf den Herbst)', () => {
    const state = stateWith(5, ['earthworm', 'vole', 'bee'], 'autumn');
    const autumn = evaluate(state).seeds;
    const value = seedSeconds(state, 120);
    state.cycle.elapsed = at('winter');
    expect(evaluate(state).seeds).not.toBeCloseTo(autumn, 3);
    expect(seedSeconds(state, 120)).toBeCloseTo(value, 9);
    expect(seedSecondsRate(state)).toBeCloseTo(evaluateEcosystem({ ...ecosystemOf(state), season: undefined }).seeds, 9);
  });

  it('Samen-Sekunden: dieselbe Rate in allen vier Jahreszeiten', () => {
    const state = stateWith(5, ['chanterelle', 'vole', 'bee', 'earthworm'], 'spring');
    const rates = (['spring', 'summer', 'autumn', 'winter'] as const).map((x) => {
      state.cycle.elapsed = at(x);
      return seedSecondsRate(state);
    });
    expect(new Set(rates).size).toBe(1);
  });

  it('Baumart zählt für Samen-Sekunden mit (sie ist Teil des Ökosystems)', () => {
    const state = stateWith(5, ['chanterelle', 'bee'], 'spring', 'oak');
    const oak = seedSecondsRate(state);
    state.cycle.mainTree = 'beech';
    expect(seedSecondsRate(state)).not.toBe(oak);
  });

  it('Cache-Schlüssel: wechselt mit Jahreszeit und Baumart, nicht mit jeder Sekunde', () => {
    const state = stateWith(5, ['earthworm', 'bee'], 'spring');
    const first = evaluate(state);
    state.cycle.elapsed = 50;
    expect(evaluate(state)).toBe(first); // dieselbe Jahreszeit (und Tageszeit): Cache-Treffer
    state.cycle.elapsed = 180;
    const summer = evaluate(state);
    expect(summer).not.toBe(first);
    expect(summer.light).toBe(first.light + 2);
    state.cycle.mainTree = 'pine';
    expect(evaluate(state)).not.toBe(summer);
    expect(evaluate(state).light).toBe(summer.light + 1);
  });
});

describe('Hauptbaum wählen und freischalten (DESIGN_V2.md 17.2, 17.5)', () => {
  const ready = () => {
    const state = stateAt(5, ['earthworm'], 3);
    state.cycle.elapsed = 1234;
    return state;
  };

  it('Freischaltung über das Naturtagebuch: Eiche immer, Buche/Kiefer über ihre Begleitpflanze', () => {
    const state = ready();
    expect(unlockedTrees(state)).toEqual(['oak']);
    state.meta.journal.plants.push('pine');
    expect(unlockedTrees(state)).toEqual(['oak', 'pine']);
    state.meta.journal.plants.push('beech');
    expect(unlockedTrees(state)).toEqual(['oak', 'beech', 'pine']);
    expect(isTreeUnlocked(state, 'maple')).toBe(false);
    expect(previewNewCycle(state).trees).toEqual([
      { id: 'oak', unlocked: true },
      { id: 'beech', unlocked: true },
      { id: 'pine', unlocked: true },
    ]);
    expect(previewNewCycle(state).mainTree).toBe('oak');
  });

  it('gesperrte oder unbekannte Art: Fehler tree-locked, nichts ändert sich', () => {
    const state = ready();
    const before = structuredClone(state);
    expect(startNewCycle(state, 99, 'beech')).toEqual({ ok: false, error: 'tree-locked' });
    expect(startNewCycle(state, 99, 'maple' as never)).toEqual({ ok: false, error: 'tree-locked' });
    expect(state).toEqual(before);
  });

  it('Neuer Zyklus: gewählte Art, Frühling, ohne Angabe die bisherige Art', () => {
    const state = ready();
    state.meta.journal.plants.push('beech');
    expect(startNewCycle(state, 99, 'beech').ok).toBe(true);
    expect(state.cycle.mainTree).toBe('beech');
    expect(state.cycle.elapsed).toBe(0);
    // Buche: +1 Platz Wurzelraum ab Alter Baum.
    expect(evaluate({ ...state, stage: 4 }).slots.roots).toBe(4);
    Object.assign(state, { stage: 5, waypoint: 20 });
    expect(startNewCycle(state, 100).ok).toBe(true);
    expect(state.cycle.mainTree).toBe('beech');
    expect(state.cycle.number).toBe(3);
  });
});

describe('Spielstand v6 (Migration v5 → v6)', () => {
  /** Ein v5-Stand: ohne die neuen Felder. */
  const v5 = (patch: (raw: Record<string, any>) => void = () => {}) => {
    const s = stateAt(4, ['earthworm', 'bluetit'], 5);
    s.plants = ['beech'];
    s.meta.journal.plants = ['beech'];
    const raw = JSON.parse(serialize(s));
    raw.version = 5;
    raw.totalGrowth = v6Threshold(s.waypoint); // Kurve bis v6 (3,5 · k^3,4)
    delete raw.cycle.elapsed;
    delete raw.cycle.mainTree;
    patch(raw);
    return JSON.stringify(raw);
  };

  it('v5 → v6: Frühlingsbeginn und Stieleiche, sonst unverändert', () => {
    const s = loadGame(v5(), 0)!.state;
    expect(SAVE_VERSION).toBe(15);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.waypoint).toBe(12);
    expect(s.cycle.elapsed).toBe(0);
    expect(s.cycle.mainTree).toBe('oak');
    expect(s.niches.crown).toEqual(['bluetit']);
    expect(s.plants).toEqual(['beech']);
  });

  it('v5 mit (unerwarteten) neuen Feldern: die Migration setzt trotzdem Frühling und Eiche', () => {
    const s = loadGame(v5((raw) => Object.assign(raw.cycle, { elapsed: 500, mainTree: 'beech' })), 0)!.state;
    expect(s.cycle).toMatchObject({ elapsed: 0, mainTree: 'oak' });
  });

  it('v6: Spielzeit und Art bleiben erhalten (Roundtrip)', () => {
    const state = stateAt(4, ['earthworm'], 5);
    state.meta.journal.plants = ['pine'];
    state.cycle.mainTree = 'pine';
    state.cycle.elapsed = 1234.5;
    const loaded = loadGame(serialize(state), 0)!.state;
    expect(loaded.cycle.elapsed).toBe(1234.5);
    expect(loaded.cycle.mainTree).toBe('pine');
    expect(evaluate(loaded)).toEqual(evaluate(state));
  });

  it('robust: ungültige Spielzeit → 0, unbekannte oder gesperrte Art → Eiche', () => {
    const v6 = (cycle: Record<string, unknown>, plants: string[] = []) => {
      const s = stateAt(4, [], 5);
      const raw = JSON.parse(serialize(s));
      Object.assign(raw.cycle, cycle);
      raw.meta.journal.plants = plants;
      return loadGame(JSON.stringify(raw).replace('"__INF__"', '1e400'), 0)!.state.cycle;
    };
    expect(v6({ elapsed: -5 }).elapsed).toBe(0);
    expect(v6({ elapsed: 'abc' }).elapsed).toBe(0);
    expect(v6({ elapsed: null }).elapsed).toBe(0);
    // +Infinity wie normalizeElapsed: Obergrenze (ein Vielfaches eines Jahres).
    expect(v6({ elapsed: '__INF__' }).elapsed).toBe(MAX_ELAPSED);
    expect(MAX_ELAPSED % YEAR_SECONDS).toBe(0);
    expect(v6({ elapsed: 1e20 }).elapsed).toBe(MAX_ELAPSED);
    expect(v6({ mainTree: 'maple' }).mainTree).toBe('oak');
    expect(v6({ mainTree: 42 }).mainTree).toBe('oak');
    expect(v6({ mainTree: 'beech' }).mainTree).toBe('oak'); // nicht freigeschaltet
    expect(v6({ mainTree: 'beech' }, ['beech']).mainTree).toBe('beech');
  });

  it('Pflanzen jenseits der Ringgröße schalten nichts frei (kein Setzen gesperrter Arten per Import)', () => {
    const s = stateAt(1, [], 5); // Keimling: 1 Pflanzplatz
    const raw = JSON.parse(serialize(s));
    raw.plants = ['anemone', 'beech', 'pine'];
    raw.meta.journal.plants = [];
    raw.cycle.mainTree = 'pine';
    let loaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(loaded.plants).toEqual(['anemone']);
    expect(loaded.cycle.mainTree).toBe('oak');
    expect(loaded.meta.journal.plants).toEqual(['anemone']);
    // Wächst die Kiefer wirklich im Ring, zählt sie.
    raw.plants = ['pine'];
    loaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(loaded.cycle.mainTree).toBe('pine');
    // Unbekannte IDs im Tagebuch zählen nicht.
    raw.plants = [];
    raw.meta.journal.plants = ['pine-x'];
    expect(loadGame(JSON.stringify(raw), 0)!.state.cycle.mainTree).toBe('oak');
  });

  it('v5 mit fremder Art in den Rohdaten: Nischen werden mit den Plätzen der Eiche gekürzt', () => {
    const s = stateAt(1, [], 5);
    s.niches.roots = ['earthworm', 'vole'];
    s.meta.journal.plants = ['beech'];
    const raw = JSON.parse(serialize(s));
    raw.version = 5;
    raw.cycle.mainTree = 'beech';
    raw.cycle.elapsed = 400;
    const loaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(loaded.cycle).toMatchObject({ mainTree: 'oak', elapsed: 0 });
    expect(loaded.niches.roots).toEqual(['earthworm']);
    expect(evaluate(loaded).slots.roots).toBe(1);
  });

  it('Laden kürzt Nischen mit den Plätzen der Baumart (Buche: 4 im Wurzelraum ab Alter Baum)', () => {
    const s = stateAt(4, [], 5);
    s.niches.roots = ['earthworm', 'vole', 'mole', 'chanterelle'];
    s.meta.journal.plants = ['beech'];
    s.cycle.mainTree = 'beech';
    expect(loadGame(serialize(s), 0)!.state.niches.roots).toEqual(['earthworm', 'vole', 'mole', 'chanterelle']);
    s.cycle.mainTree = 'oak';
    expect(loadGame(serialize(s), 0)!.state.niches.roots).toEqual(['earthworm', 'vole', 'mole']);
  });
});
