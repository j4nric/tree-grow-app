import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../src/core/save';
import { createInitialState } from '../src/core/state';

describe('Speichern & Laden', () => {
  it('übersteht einen Roundtrip', () => {
    const state = createInitialState(123);
    state.resources.energy = 42;
    state.upgrades['root-hairs'] = 3;
    state.stage = 2;
    state.totalEnergy = 500;
    expect(deserialize(serialize(state), 999)).toEqual(state);
  });

  it('gibt bei Müll null zurück', () => {
    expect(deserialize(null, 0)).toBeNull();
    expect(deserialize('{kaputt', 0)).toBeNull();
    expect(deserialize('[1,2]', 0)).toBeNull();
  });

  it('repariert ungültige Felder statt abzustürzen', () => {
    const raw = JSON.stringify({
      resources: { water: 'viel', light: 5 },
      upgrades: { 'root-hairs': -2, cotyledon: 2.7 },
      stage: 99,
      totalEnergy: null,
    });
    const state = deserialize(raw, 7)!;
    expect(state.resources).toEqual({ water: 0, light: 5, energy: 0 });
    expect(state.upgrades).toEqual({ cotyledon: 2 });
    expect(state.stage).toBe(0);
    expect(state.totalEnergy).toBe(0);
    expect(state.lastTick).toBe(7);
  });

  it('leitet die Stufe aus der Gesamtenergie ab', () => {
    const tooHigh = deserialize(JSON.stringify({ stage: 7, totalEnergy: 0 }), 0)!;
    expect(tooHigh.stage).toBe(0);
    const tooLow = deserialize(JSON.stringify({ stage: 0, totalEnergy: 5_000 }), 0)!;
    expect(tooLow.stage).toBe(3);
  });
});
