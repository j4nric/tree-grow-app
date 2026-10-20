import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/state';
import { MAX_OFFLINE_SECONDS, buyUpgrade, clickGrow, simulateOffline, tick } from '../src/core/tick';

describe('tick', () => {
  it('wandelt Wasser und Licht in Energie um', () => {
    const state = createInitialState(0);
    clickGrow(state);
    clickGrow(state);
    tick(state, 1);
    expect(state.resources.energy).toBeCloseTo(1);
    expect(state.resources.water).toBeCloseTo(1);
    expect(state.totalEnergy).toBeCloseTo(1);
  });

  it('erzeugt ohne Licht keine Energie', () => {
    const state = createInitialState(0);
    state.resources.water = 100;
    tick(state, 10);
    expect(state.resources.energy).toBe(0);
  });

  it('steigt in die nächste Stufe auf', () => {
    const state = createInitialState(0);
    state.resources.water = 20;
    state.resources.light = 20;
    state.upgrades['chlorophyll'] = 20;
    tick(state, 1);
    expect(state.stage).toBe(1);
  });
});

describe('buyUpgrade', () => {
  it('zieht Kosten ab und erhöht die Stufe', () => {
    const state = createInitialState(0);
    state.resources.energy = 100;
    expect(buyUpgrade(state, 'root-hairs')).toBe(true);
    expect(state.upgrades['root-hairs']).toBe(1);
    expect(state.resources.energy).toBe(88);
  });

  it('lehnt zu teure, gesperrte und unbekannte Upgrades ab', () => {
    const state = createInitialState(0);
    expect(buyUpgrade(state, 'root-hairs')).toBe(false);
    state.resources.energy = 1e6;
    expect(buyUpgrade(state, 'taproot')).toBe(false); // erst ab Setzling
    expect(buyUpgrade(state, 'gibt-es-nicht')).toBe(false);
  });
});

describe('simulateOffline', () => {
  it('liefert dieselbe Energie wie laufende Ticks', () => {
    const a = createInitialState(0);
    a.upgrades['root-hairs'] = 4;
    a.upgrades['cotyledon'] = 4;
    const b = structuredClone(a);
    for (let i = 0; i < 600; i++) tick(a, 1);
    const gained = simulateOffline(b, 600);
    expect(gained).toBeCloseTo(a.totalEnergy, 5);
  });

  it('ist auf die Maximaldauer begrenzt', () => {
    const a = createInitialState(0);
    a.upgrades['root-hairs'] = 1;
    a.upgrades['cotyledon'] = 1;
    const b = structuredClone(a);
    simulateOffline(a, MAX_OFFLINE_SECONDS);
    simulateOffline(b, MAX_OFFLINE_SECONDS * 10);
    expect(b.totalEnergy).toBeCloseTo(a.totalEnergy, 5);
  });
});
