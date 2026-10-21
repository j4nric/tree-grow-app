import { describe, expect, it } from 'vitest';
import { V1_KEEPSAKE_ID, V1_KEEPSAKE_MEMORY } from '../src/content/memory';
import { thresholdFor } from '../src/core/formulas';
import { isValidRngState, normalizeSeed } from '../src/core/rng';
import {
  deserialize,
  loadFromStorage,
  loadGame,
  saveToStorage,
  serialize,
  SAVE_KEY,
  V2_SEED_CAP,
  V2_WAYPOINT_BASE,
  V2_WAYPOINT_POWER,
  v2GrowthToV3,
} from '../src/core/save';
import { MAX_FOREST_MEMORY, SAVE_VERSION, createInitialState } from '../src/core/state';
import { tick } from '../src/core/tick';
import { fakeSpecies, stateAt, withFakeSpecies } from './helpers';

/** Gültiger aktueller Stand (v3) als Rohdaten, einzelne Felder überschreibbar. */
function rawV3(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...JSON.parse(serialize(stateAt(3, ['earthworm', 'robin'], 9))), ...patch });
}

/** Gesamt-Wachstum für Wegpunkt k auf der Kurve der v2-Stände (4 · k^3,2). */
const v2Threshold = (k: number) => Math.round(V2_WAYPOINT_BASE * Math.pow(k, V2_WAYPOINT_POWER));

/** Ein Spielstand des Prototyps (v2, ohne Pflanzen), wie ihn das Spiel vor 2.1 schrieb. */
function rawV2(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 2,
    totalGrowth: v2Threshold(12) + 10,
    seeds: 3091.5,
    waypoint: 12,
    stage: 4,
    niches: { roots: ['earthworm'], litter: ['robin'], edge: [], crown: ['bluetit'], bark: [], hollows: [] },
    pendingEncounters: [{ type: 'animal', cards: ['bee', 'woodpecker'], rerolls: 1 }],
    rngState: 4242,
    meta: { forestMemory: 5, journal: { species: ['earthworm', 'robin', 'bluetit', 'oakmoth'], keepsakes: ['old-oak'] } },
    lastTick: 1_000,
    ...patch,
  });
}

/** Ein echter v1-Spielstand, wie ihn das alte Spiel geschrieben hat. */
const V1_SAVE = {
  version: 1,
  resources: { water: 12, light: 3, energy: 4200 },
  upgrades: { 'root-hairs': 5, cotyledon: 4, chlorophyll: 2 },
  stage: 3,
  totalEnergy: 5000,
  lastTick: 1_000,
};

describe('Speichern & Laden v2', () => {
  it('übersteht einen Roundtrip', () => {
    const state = createInitialState(123, 77);
    tick(state, 200);
    state.niches.roots = ['earthworm'];
    state.plants = ['moss'];
    state.pendingEncounters[0] = { type: 'plant', cards: ['anemone', 'moss'], rerolls: 1 };
    state.meta.journal.species = ['earthworm'];
    state.meta.forestMemory = 5;
    expect(SAVE_VERSION).toBe(3);
    expect(deserialize(serialize(state), 999)).toEqual(state);
    expect(loadGame(serialize(state), 999)).toMatchObject({ migratedFromV1: false, keepsake: false });
  });

  it('gibt bei Müll null zurück', () => {
    expect(deserialize(null, 0)).toBeNull();
    expect(deserialize('', 0)).toBeNull();
    expect(deserialize('{kaputt', 0)).toBeNull();
    expect(deserialize('[1,2]', 0)).toBeNull();
    expect(deserialize('42', 0)).toBeNull();
    expect(deserialize('null', 0)).toBeNull();
  });

  it('localStorage-Kapselung: speichern, laden, blockierter Speicher', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    } as unknown as Storage;
    const state = stateAt(2, ['earthworm']);
    saveToStorage(state, storage);
    expect(data.has(SAVE_KEY)).toBe(true);
    expect(loadFromStorage(0, storage)?.state).toEqual(state);
    const broken = {
      getItem: () => {
        throw new Error('blockiert');
      },
      setItem: () => {
        throw new Error('voll');
      },
    } as unknown as Storage;
    expect(() => saveToStorage(state, broken)).not.toThrow();
    expect(loadFromStorage(0, broken)).toBeNull();
  });
});

describe('Migration v1 → v2', () => {
  it('v1 ab „Junger Baum“: Neustart mit Andenken (+5 Waldgedächtnis)', () => {
    const result = loadGame(JSON.stringify(V1_SAVE), 50_000)!;
    expect(result.migratedFromV1).toBe(true);
    expect(result.keepsake).toBe(true);
    const s = result.state;
    expect(s.version).toBe(3);
    expect(s.plants).toEqual([]);
    expect(s.totalGrowth).toBe(0);
    expect(s.seeds).toBe(0);
    expect(s.stage).toBe(0);
    expect(s.pendingEncounters).toEqual([]);
    expect(s.meta.forestMemory).toBe(V1_KEEPSAKE_MEMORY);
    expect(s.meta.journal.keepsakes).toEqual([V1_KEEPSAKE_ID]);
    // Keine Offline-Zeit aus dem alten Stand.
    expect(s.lastTick).toBe(50_000);
    expect(isValidRngState(s.rngState)).toBe(true);
    // Alte Felder verschwinden.
    expect(JSON.parse(serialize(s))).not.toHaveProperty('resources');
    expect(JSON.parse(serialize(s))).not.toHaveProperty('upgrades');
  });

  it('v1 unter „Junger Baum“: Neustart ohne Andenken', () => {
    const result = loadGame(JSON.stringify({ ...V1_SAVE, stage: 2, totalEnergy: 500 }), 0)!;
    expect(result).toMatchObject({ migratedFromV1: true, keepsake: false });
    expect(result.state.meta.forestMemory).toBe(0);
    expect(result.state.meta.journal.keepsakes).toEqual([]);
  });

  it('v1 ohne Versionsfeld und mit kaputten Werten', () => {
    const noVersion = loadGame(JSON.stringify({ resources: { water: 'viel' }, stage: 'drei', totalEnergy: null }), 0)!;
    expect(noVersion).toMatchObject({ migratedFromV1: true, keepsake: false });
    // Stufe fehlt, aber genug Energie für „Junger Baum“ (v1-Schwelle 3.000)
    const byEnergy = loadGame(JSON.stringify({ totalEnergy: 3_000 }), 0)!;
    expect(byEnergy.keepsake).toBe(true);
    expect(loadGame(JSON.stringify({ version: 1, stage: NaN, totalEnergy: 1e308 }), 0)!.keepsake).toBe(true);
    expect(loadGame(JSON.stringify({}), 0)).toMatchObject({ migratedFromV1: true, keepsake: false });
  });

  it('ein migrierter Stand wird danach als v2 geladen (Meldung nur einmal)', () => {
    const first = loadGame(JSON.stringify(V1_SAVE), 0)!;
    const second = loadGame(serialize(first.state), 10)!;
    expect(second.migratedFromV1).toBe(false);
    expect(second.state.meta.forestMemory).toBe(V1_KEEPSAKE_MEMORY);
  });
});

describe('Migration v2 → v3 (Pflanzen)', () => {
  it('Wegpunkt und Stufe bleiben: Gesamt-Wachstum wird auf die neue Kurve umgerechnet', () => {
    // Hain im Prototyp: 4 · 20^3,2 + 10 – mit der neuen Kurve wäre das nur Wegpunkt 17.
    const full = {
      roots: ['earthworm'],
      litter: ['robin', 'woodlouse', 'centipede'],
      edge: ['bee'],
      crown: ['bluetit', 'oakmoth'],
      bark: ['barkbeetle', 'woodpecker'],
      hollows: [],
    };
    const s = deserialize(rawV2({ totalGrowth: v2Threshold(20) + 10, niches: full }), 0)!;
    expect(s).toMatchObject({ waypoint: 20, stage: 5 });
    expect(s.niches).toEqual(full); // niemand wird entlassen
    expect(s.totalGrowth).toBeGreaterThanOrEqual(thresholdFor(20));
    expect(s.totalGrowth).toBeLessThan(thresholdFor(21));
    // Weiterspielen: der nächste Wegpunkt ist 21, nicht noch einmal 18.
    s.pendingEncounters = [];
    const report = tick(s, 3600);
    expect(report.waypoints).toBeGreaterThan(0);
    expect(s.waypoint).toBe(20 + report.waypoints);
  });

  it('v2GrowthToV3: gleicher Wegpunkt, gleicher Bruchteil, Grenzfälle', () => {
    for (let k = 0; k < 36; k++) {
      expect(v2GrowthToV3(v2Threshold(k)), `k=${k}`).toBe(thresholdFor(k));
      const mid = (v2Threshold(k) + v2Threshold(k + 1)) / 2;
      expect(v2GrowthToV3(mid), `k=${k}`).toBeCloseTo((thresholdFor(k) + thresholdFor(k + 1)) / 2, 6);
    }
    expect(v2GrowthToV3(v2Threshold(36))).toBe(thresholdFor(36));
    expect(v2GrowthToV3(2 * v2Threshold(36))).toBeCloseTo(2 * thresholdFor(36));
    for (const bad of [0, -5, NaN]) expect(v2GrowthToV3(bad)).toBe(0);
    expect(v2GrowthToV3(Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
    // monoton
    let last = 0;
    for (let g = 0; g < 2e6; g += 997) {
      const v = v2GrowthToV3(g);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('Prototyp-Stand: Fortschritt bleibt, Samen werden auf die ersten zwei Pflanzen begrenzt', () => {
    expect(V2_SEED_CAP).toBeCloseTo(20 + 38);
    const result = loadGame(rawV2(), 5_000)!;
    expect(result).toMatchObject({ migratedFromV1: false, keepsake: false });
    const s = result.state;
    expect(s.version).toBe(3);
    expect(s.seeds).toBe(V2_SEED_CAP);
    expect(s.plants).toEqual([]);
    expect(s).toMatchObject({ stage: 4, waypoint: 12, rngState: 4242, lastTick: 1_000 });
    expect(s.niches.crown).toEqual(['bluetit']);
    expect(s.pendingEncounters).toEqual([{ type: 'animal', cards: ['bee', 'woodpecker'], rerolls: 1 }]);
    expect(s.meta.forestMemory).toBe(5);
    expect(s.meta.journal.species).toEqual(['earthworm', 'robin', 'bluetit', 'oakmoth']);
    // Danach ist es ein v3-Stand: Samen werden nicht noch einmal begrenzt.
    s.seeds = 5000;
    expect(deserialize(serialize(s), 0)!.seeds).toBe(5000);
  });

  it('kleine Bestände bleiben, kaputte werden 0, unendliche begrenzt', () => {
    expect(deserialize(rawV2({ seeds: 12 }), 0)!.seeds).toBe(12);
    expect(deserialize(rawV2({ seeds: 0 }), 0)!.seeds).toBe(0);
    expect(deserialize(rawV2({ seeds: NaN }), 0)!.seeds).toBe(0);
    expect(deserialize(rawV2({ seeds: 'viel' }), 0)!.seeds).toBe(0);
    expect(deserialize(rawV2().replace('"seeds":3091.5', '"seeds":1e400'), 0)!.seeds).toBe(V2_SEED_CAP);
  });

  it('Pflanzen in einem v2-Stand (gab es nicht) werden ignoriert', () => {
    expect(deserialize(rawV2({ plants: ['hazel'] }), 0)!.plants).toEqual([]);
  });

  it('v2-Stand ohne Nische „hollows“ und ohne Typ in Begegnungen lädt', () => {
    const s = deserialize(
      rawV2({ niches: { roots: ['earthworm'] }, pendingEncounters: [{ cards: ['robin'], rerolls: 0 }] }),
      0,
    )!;
    expect(s.niches.hollows).toEqual([]);
    expect(s.pendingEncounters).toEqual([{ type: 'animal', cards: ['robin'], rerolls: 0 }]);
  });
});

describe('Robustes Laden v3: Pflanzen', () => {
  it('unbekannte Pflanzen verworfen, Duplikate erlaubt, auf den Pflanzring gekürzt', () => {
    // Junger Baum: 3 Pflanzplätze
    const s = deserialize(rawV3({ plants: ['hazel', 'drache', 'hazel', 42, 'moss', 'fern', 'birch'] }), 0)!;
    expect(s.plants).toEqual(['hazel', 'hazel', 'moss']);
    for (const plants of [undefined, null, 'hazel', { 0: 'hazel' }]) {
      expect(deserialize(rawV3({ plants }), 0)!.plants).toEqual([]);
    }
    // Samen-Stufe: Ring geschlossen
    expect(deserialize(rawV3({ totalGrowth: 0, plants: ['moss'] }), 0)!.plants).toEqual([]);
  });

  it('Pflanzen-Begegnungen: nur bekannte Pflanzen, unbekannte Typen fallen weg', () => {
    const pending = [
      { type: 'plant', cards: ['hazel', 'drache', 'hazel', 'earthworm'], rerolls: 1 },
      { type: 'plant', cards: ['earthworm'], rerolls: 0 }, // Tier-ID in Pflanzen-Begegnung
      { type: 'event', cards: ['storm'], rerolls: 0 }, // Typ aus einer späteren Version
      { type: 'animal', cards: ['hazel', 'robin'], rerolls: 0 }, // Pflanzen-ID in Tierbegegnung
      { type: 'plant', cards: ['moss', 'anemone', 'fern', 'nettle'], rerolls: 0 },
    ];
    // Junger Baum: Rotbuche (ab Alter Baum) ist gesperrt und fällt weg.
    expect(
      deserialize(rawV3({ pendingEncounters: [{ type: 'plant', cards: ['beech', 'birch'], rerolls: 0 }] }), 0)!
        .pendingEncounters,
    ).toEqual([{ type: 'plant', cards: ['birch'], rerolls: 0 }]);
    const s = deserialize(rawV3({ pendingEncounters: pending }), 0)!;
    expect(s.pendingEncounters).toEqual([
      { type: 'plant', cards: ['hazel'], rerolls: 1 },
      { type: 'animal', cards: ['robin'], rerolls: 0 },
      { type: 'plant', cards: ['moss', 'anemone', 'fern'], rerolls: 0 },
    ]);
  });
});

describe('Robustes Laden v2 (DESIGN_V2.md 12.3)', () => {
  it('unbekannte Arten werden verworfen', () => {
    const s = deserialize(rawV3({ niches: { roots: ['earthworm', 'drache'], litter: ['robin', 42, null] } }), 0)!;
    expect(s.niches.roots).toEqual(['earthworm']);
    expect(s.niches.litter).toEqual(['robin']);
  });

  it('Duplikate werden entfernt (auch über Nischen hinweg)', () => {
    const s = deserialize(rawV3({ niches: { roots: ['earthworm', 'earthworm'], litter: ['robin', 'earthworm'] } }), 0)!;
    expect(s.niches.roots).toEqual(['earthworm']);
    expect(s.niches.litter).toEqual(['robin']);
  });

  it('Arten in falscher Nische kommen in ihre eigene', () => {
    const s = deserialize(rawV3({ niches: { roots: ['bluetit'] } }), 0)!;
    expect(s.niches.roots).toEqual([]);
    expect(s.niches.crown).toEqual(['bluetit']);
  });

  it('Nischen werden auf die aktuelle Platzzahl gekürzt', () => {
    // Junger Baum: Laubstreu 2 Plätze
    const s = deserialize(rawV3({ niches: { litter: ['robin', 'woodlouse', 'centipede'] } }), 0)!;
    expect(s.niches.litter).toEqual(['robin', 'woodlouse']);
    // Samen: alle Nischen geschlossen
    const seed = deserialize(rawV3({ totalGrowth: 0, niches: { roots: ['earthworm'] } }), 0)!;
    expect(seed.niches.roots).toEqual([]);
  });

  it('fehlende oder kaputte Nischen ergeben leere Nischen', () => {
    for (const niches of [undefined, null, 'x', [1, 2], { roots: 'earthworm' }]) {
      const s = deserialize(rawV3({ niches }), 0)!;
      expect(Object.values(s.niches).flat()).toEqual([]);
    }
  });

  it('pendingEncounters: höchstens 3, ungültige Karten und leere Begegnungen entfernt', () => {
    const pending = [
      { type: 'animal', cards: ['bluetit', 'drache', 'bluetit'], rerolls: 2 },
      { type: 'animal', cards: ['drache'], rerolls: 0 },
      'kaputt',
      { cards: ['robin', 'bee', 'oakmoth', 'woodlouse'], rerolls: -3 },
      { type: 'animal', cards: ['earthworm'], rerolls: NaN },
      { type: 'animal', cards: ['woodlouse'], rerolls: 0 },
    ];
    const s = deserialize(rawV3({ pendingEncounters: pending }), 0)!;
    expect(s.pendingEncounters).toEqual([
      { type: 'animal', cards: ['bluetit'], rerolls: 2 },
      { type: 'animal', cards: ['robin', 'bee', 'oakmoth'], rerolls: 0 },
      { type: 'animal', cards: ['earthworm'], rerolls: 0 },
    ]);
    expect(deserialize(rawV3({ pendingEncounters: 'x' }), 0)!.pendingEncounters).toEqual([]);
  });

  it('rngState 0 oder ungültig → aus lastTick neu gesetzt', () => {
    for (const rngState of [0, -1, 1.5, 2 ** 32, 'abc', null, undefined]) {
      const s = deserialize(rawV3({ rngState, lastTick: 12_345 }), 0)!;
      expect(s.rngState, String(rngState)).toBe(normalizeSeed(12_345));
    }
    expect(deserialize(rawV3({ rngState: 99 }), 0)!.rngState).toBe(99);
  });

  it('Wegpunkt und Stufe werden aus totalGrowth abgeleitet', () => {
    const tooHigh = deserialize(rawV3({ totalGrowth: 0, stage: 7, waypoint: 36 }), 0)!;
    expect(tooHigh).toMatchObject({ stage: 0, waypoint: 0 });
    const tooLow = deserialize(rawV3({ totalGrowth: thresholdFor(12), stage: 0, waypoint: 0 }), 0)!;
    expect(tooLow).toMatchObject({ stage: 4, waypoint: 12 });
    const huge = deserialize(rawV3({ totalGrowth: 1e308 }), 0)!;
    expect(huge).toMatchObject({ stage: 7, waypoint: 36 });
  });

  it('kaputte Zahlen werden ersetzt', () => {
    const s = deserialize(
      rawV3({ totalGrowth: 'viel', seeds: -5, lastTick: 'gestern', meta: { forestMemory: -1, journal: 'x' } }),
      777,
    )!;
    expect(s.totalGrowth).toBe(0);
    expect(s.seeds).toBe(0);
    expect(s.lastTick).toBe(777);
    expect(s.meta.forestMemory).toBe(0);
    // Tagebuch kaputt: Die Arten aus den Nischen bleiben trotzdem verzeichnet.
    expect(s.meta.journal).toEqual({ species: ['earthworm', 'robin'], keepsakes: [] });
    const nan = deserialize(rawV3({ seeds: Infinity, totalGrowth: NaN }), 0)!;
    expect(nan.seeds).toBe(0);
  });

  it('Tagebuch: unbekannte Arten verworfen, lebende Arten ergänzt', () => {
    const s = deserialize(
      rawV3({ meta: { forestMemory: 3, journal: { species: ['bee', 'drache', 'bee'], keepsakes: ['old-oak', 1] } } }),
      0,
    )!;
    expect(s.meta.forestMemory).toBe(3);
    expect(s.meta.journal.species).toEqual(['bee', 'earthworm', 'robin']);
    expect(s.meta.journal.keepsakes).toEqual(['old-oak']);
  });

  it('v2-Stand ohne Nische „hollows“ (vor Höhlen & Totholz) lädt mit leerer Höhle', () => {
    const old = JSON.parse(rawV3());
    delete old.niches.hollows;
    const s = deserialize(JSON.stringify(old), 0)!;
    expect(s.niches.hollows).toEqual([]);
    expect(s.niches.roots).toEqual(['earthworm']);
    expect(deserialize(rawV3({ niches: { roots: ['earthworm'], hollows: 'kaputt' } }), 0)!.niches.hollows).toEqual([]);
  });

  it('Platz-Schaffer zählen beim Kürzen, die gespeicherte Reihenfolge bleibt', () => {
    const owl = fakeSpecies({ id: 'test-owl', niche: 'hollows' });
    withFakeSpecies([owl], () => {
      // Junger Baum: Höhle nur offen, weil der Borkenkäfer lebt – auch wenn er später steht.
      const s = deserialize(rawV3({ niches: { roots: ['test-owl', 'barkbeetle'] } }), 0)!;
      expect(s.niches.bark).toEqual(['barkbeetle']);
      expect(s.niches.hollows).toEqual(['test-owl']);
      const without = deserialize(rawV3({ niches: { hollows: ['test-owl'] } }), 0)!;
      expect(without.niches.hollows).toEqual([]);
      expect(without.meta.journal.species).toContain('test-owl'); // hat hier gelebt
    });
    const grown = deserialize(rawV3({ totalGrowth: thresholdFor(12), niches: { bark: ['woodpecker', 'barkbeetle'] } }), 0)!;
    expect(grown.niches.bark).toEqual(['woodpecker', 'barkbeetle']);
  });

  it('Waldgedächtnis, Samen und Wachstum: Grenzen und Unendlich', () => {
    const big = deserialize(rawV3({ meta: { forestMemory: 1e9 } }), 0)!;
    expect(big.meta.forestMemory).toBe(MAX_FOREST_MEMORY);
    // „1e400“ ergibt in JSON.parse Infinity – wird begrenzt statt verworfen.
    const raw = rawV3({ seeds: 1, totalGrowth: 2, meta: { forestMemory: 3 } })
      .replace('"seeds":1', '"seeds":1e400')
      .replace('"totalGrowth":2', '"totalGrowth":1e400')
      .replace('"forestMemory":3', '"forestMemory":-1e400');
    const s = deserialize(raw, 0)!;
    expect(s.seeds).toBe(Number.MAX_VALUE);
    expect(s.totalGrowth).toBe(Number.MAX_VALUE);
    expect(s.meta.forestMemory).toBe(0);
    expect(s.stage).toBe(7);
    // Weiterspielen bleibt endlich.
    tick(s, 3600);
    expect(Number.isFinite(s.seeds) && Number.isFinite(s.totalGrowth)).toBe(true);
  });

  it('zukünftige Versionen werden so gut wie möglich geladen', () => {
    const s = deserialize(rawV3({ version: 4, somethingNew: true, plants: ['hazel'] }), 0)!;
    expect(s.version).toBe(3);
    expect(s.plants).toEqual(['hazel']);
    expect(s.niches.roots).toEqual(['earthworm']);
    expect(s).not.toHaveProperty('somethingNew');
  });
});
