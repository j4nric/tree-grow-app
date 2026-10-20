import { describe, expect, it } from 'vitest';
import { V1_KEEPSAKE_ID, V1_KEEPSAKE_MEMORY } from '../src/content/memory';
import { thresholdFor } from '../src/core/formulas';
import { isValidRngState, normalizeSeed } from '../src/core/rng';
import { deserialize, loadFromStorage, loadGame, saveToStorage, serialize, SAVE_KEY } from '../src/core/save';
import { MAX_FOREST_MEMORY, SAVE_VERSION, createInitialState } from '../src/core/state';
import { tick } from '../src/core/tick';
import { fakeSpecies, stateAt, withFakeSpecies } from './helpers';

/** Gültiger v2-Stand als Rohdaten, einzelne Felder überschreibbar. */
function rawV2(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...JSON.parse(serialize(stateAt(3, ['earthworm', 'robin'], 9))), ...patch });
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
    state.meta.journal.species = ['earthworm'];
    state.meta.forestMemory = 5;
    expect(SAVE_VERSION).toBe(2);
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
    expect(s.version).toBe(2);
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

describe('Robustes Laden v2 (DESIGN_V2.md 12.3)', () => {
  it('unbekannte Arten werden verworfen', () => {
    const s = deserialize(rawV2({ niches: { roots: ['earthworm', 'drache'], litter: ['robin', 42, null] } }), 0)!;
    expect(s.niches.roots).toEqual(['earthworm']);
    expect(s.niches.litter).toEqual(['robin']);
  });

  it('Duplikate werden entfernt (auch über Nischen hinweg)', () => {
    const s = deserialize(rawV2({ niches: { roots: ['earthworm', 'earthworm'], litter: ['robin', 'earthworm'] } }), 0)!;
    expect(s.niches.roots).toEqual(['earthworm']);
    expect(s.niches.litter).toEqual(['robin']);
  });

  it('Arten in falscher Nische kommen in ihre eigene', () => {
    const s = deserialize(rawV2({ niches: { roots: ['bluetit'] } }), 0)!;
    expect(s.niches.roots).toEqual([]);
    expect(s.niches.crown).toEqual(['bluetit']);
  });

  it('Nischen werden auf die aktuelle Platzzahl gekürzt', () => {
    // Junger Baum: Laubstreu 2 Plätze
    const s = deserialize(rawV2({ niches: { litter: ['robin', 'woodlouse', 'centipede'] } }), 0)!;
    expect(s.niches.litter).toEqual(['robin', 'woodlouse']);
    // Samen: alle Nischen geschlossen
    const seed = deserialize(rawV2({ totalGrowth: 0, niches: { roots: ['earthworm'] } }), 0)!;
    expect(seed.niches.roots).toEqual([]);
  });

  it('fehlende oder kaputte Nischen ergeben leere Nischen', () => {
    for (const niches of [undefined, null, 'x', [1, 2], { roots: 'earthworm' }]) {
      const s = deserialize(rawV2({ niches }), 0)!;
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
    const s = deserialize(rawV2({ pendingEncounters: pending }), 0)!;
    expect(s.pendingEncounters).toEqual([
      { type: 'animal', cards: ['bluetit'], rerolls: 2 },
      { type: 'animal', cards: ['robin', 'bee', 'oakmoth'], rerolls: 0 },
      { type: 'animal', cards: ['earthworm'], rerolls: 0 },
    ]);
    expect(deserialize(rawV2({ pendingEncounters: 'x' }), 0)!.pendingEncounters).toEqual([]);
  });

  it('rngState 0 oder ungültig → aus lastTick neu gesetzt', () => {
    for (const rngState of [0, -1, 1.5, 2 ** 32, 'abc', null, undefined]) {
      const s = deserialize(rawV2({ rngState, lastTick: 12_345 }), 0)!;
      expect(s.rngState, String(rngState)).toBe(normalizeSeed(12_345));
    }
    expect(deserialize(rawV2({ rngState: 99 }), 0)!.rngState).toBe(99);
  });

  it('Wegpunkt und Stufe werden aus totalGrowth abgeleitet', () => {
    const tooHigh = deserialize(rawV2({ totalGrowth: 0, stage: 7, waypoint: 36 }), 0)!;
    expect(tooHigh).toMatchObject({ stage: 0, waypoint: 0 });
    const tooLow = deserialize(rawV2({ totalGrowth: thresholdFor(12), stage: 0, waypoint: 0 }), 0)!;
    expect(tooLow).toMatchObject({ stage: 4, waypoint: 12 });
    const huge = deserialize(rawV2({ totalGrowth: 1e308 }), 0)!;
    expect(huge).toMatchObject({ stage: 7, waypoint: 36 });
  });

  it('kaputte Zahlen werden ersetzt', () => {
    const s = deserialize(
      rawV2({ totalGrowth: 'viel', seeds: -5, lastTick: 'gestern', meta: { forestMemory: -1, journal: 'x' } }),
      777,
    )!;
    expect(s.totalGrowth).toBe(0);
    expect(s.seeds).toBe(0);
    expect(s.lastTick).toBe(777);
    expect(s.meta.forestMemory).toBe(0);
    // Tagebuch kaputt: Die Arten aus den Nischen bleiben trotzdem verzeichnet.
    expect(s.meta.journal).toEqual({ species: ['earthworm', 'robin'], keepsakes: [] });
    const nan = deserialize(rawV2({ seeds: Infinity, totalGrowth: NaN }), 0)!;
    expect(nan.seeds).toBe(0);
  });

  it('Tagebuch: unbekannte Arten verworfen, lebende Arten ergänzt', () => {
    const s = deserialize(
      rawV2({ meta: { forestMemory: 3, journal: { species: ['bee', 'drache', 'bee'], keepsakes: ['old-oak', 1] } } }),
      0,
    )!;
    expect(s.meta.forestMemory).toBe(3);
    expect(s.meta.journal.species).toEqual(['bee', 'earthworm', 'robin']);
    expect(s.meta.journal.keepsakes).toEqual(['old-oak']);
  });

  it('v2-Stand ohne Nische „hollows“ (vor Höhlen & Totholz) lädt mit leerer Höhle', () => {
    const old = JSON.parse(rawV2());
    delete old.niches.hollows;
    const s = deserialize(JSON.stringify(old), 0)!;
    expect(s.niches.hollows).toEqual([]);
    expect(s.niches.roots).toEqual(['earthworm']);
    expect(deserialize(rawV2({ niches: { roots: ['earthworm'], hollows: 'kaputt' } }), 0)!.niches.hollows).toEqual([]);
  });

  it('Platz-Schaffer zählen beim Kürzen, die gespeicherte Reihenfolge bleibt', () => {
    const owl = fakeSpecies({ id: 'test-owl', niche: 'hollows' });
    withFakeSpecies([owl], () => {
      // Junger Baum: Höhle nur offen, weil der Borkenkäfer lebt – auch wenn er später steht.
      const s = deserialize(rawV2({ niches: { roots: ['test-owl', 'barkbeetle'] } }), 0)!;
      expect(s.niches.bark).toEqual(['barkbeetle']);
      expect(s.niches.hollows).toEqual(['test-owl']);
      const without = deserialize(rawV2({ niches: { hollows: ['test-owl'] } }), 0)!;
      expect(without.niches.hollows).toEqual([]);
      expect(without.meta.journal.species).toContain('test-owl'); // hat hier gelebt
    });
    const grown = deserialize(rawV2({ totalGrowth: thresholdFor(12), niches: { bark: ['woodpecker', 'barkbeetle'] } }), 0)!;
    expect(grown.niches.bark).toEqual(['woodpecker', 'barkbeetle']);
  });

  it('Waldgedächtnis, Samen und Wachstum: Grenzen und Unendlich', () => {
    const big = deserialize(rawV2({ meta: { forestMemory: 1e9 } }), 0)!;
    expect(big.meta.forestMemory).toBe(MAX_FOREST_MEMORY);
    // „1e400“ ergibt in JSON.parse Infinity – wird begrenzt statt verworfen.
    const raw = rawV2({ seeds: 1, totalGrowth: 2, meta: { forestMemory: 3 } })
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
    const s = deserialize(rawV2({ version: 3, somethingNew: true }), 0)!;
    expect(s.version).toBe(2);
    expect(s.niches.roots).toEqual(['earthworm']);
    expect(s).not.toHaveProperty('somethingNew');
  });
});
