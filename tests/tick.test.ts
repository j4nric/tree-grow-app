import { describe, expect, it } from 'vitest';
import { BASE_LIGHT, BASE_PHOTOSYNTHESIS, BASE_WATER, CLICK_AMOUNT, CLICK_SECONDS, getRates } from '../src/core/formulas';
import { createInitialState } from '../src/core/state';
import { MAX_OFFLINE_SECONDS, buyUpgrade, clickGrow, simulateOffline, tick } from '../src/core/tick';

describe('tick', () => {
  it('wandelt Wasser und Licht in Energie um', () => {
    const state = createInitialState(0);
    state.resources.water = 2;
    state.resources.light = 2;
    tick(state, 1);
    // Photosynthese (1/s) begrenzt; Grundproduktion kommt obendrauf.
    expect(state.resources.energy).toBeCloseTo(BASE_PHOTOSYNTHESIS);
    expect(state.resources.water).toBeCloseTo(2 + BASE_WATER - BASE_PHOTOSYNTHESIS);
    expect(state.totalEnergy).toBeCloseTo(BASE_PHOTOSYNTHESIS);
  });

  it('läuft ohne Klicks: der Samen erreicht von selbst den Keimling', () => {
    const state = createInitialState(0);
    for (let i = 0; i < 300; i++) tick(state, 0.1);
    expect(state.totalEnergy).toBeCloseTo(30 * Math.min(BASE_WATER, BASE_LIGHT, BASE_PHOTOSYNTHESIS));
    expect(state.stage).toBe(1);
  });

  it('erzeugt nur so viel Energie, wie das knappste Glied hergibt', () => {
    const state = createInitialState(0);
    state.resources.water = 100;
    state.upgrades['chlorophyll'] = 10;
    tick(state, 1);
    // Viel Wasser, viel Kapazität – aber nur das Licht der Grundproduktion.
    expect(state.resources.energy).toBeCloseTo(BASE_LIGHT);
    expect(state.resources.light).toBeCloseTo(0);
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

describe('clickGrow', () => {
  it('bringt am Anfang CLICK_AMOUNT Wasser und Licht', () => {
    const state = createInitialState(0);
    clickGrow(state);
    expect(state.resources.water).toBeCloseTo(Math.max(CLICK_AMOUNT, CLICK_SECONDS * BASE_WATER));
    expect(state.resources.light).toBeCloseTo(Math.max(CLICK_AMOUNT, CLICK_SECONDS * BASE_LIGHT));
  });

  it('wächst mit der Produktion: ein Klick = CLICK_SECONDS Sekunden Wasser und Licht', () => {
    const state = createInitialState(0);
    state.upgrades['taproot'] = 10;
    state.upgrades['canopy'] = 5;
    const rates = getRates(state);
    clickGrow(state);
    expect(state.resources.water).toBeCloseTo(CLICK_SECONDS * rates.water);
    expect(state.resources.light).toBeCloseTo(CLICK_SECONDS * rates.light);
    expect(state.resources.water).toBeGreaterThan(CLICK_AMOUNT);
    // Kein Energie-Bonus: Klicks laufen wie alles andere durch die Photosynthese.
    expect(state.resources.energy).toBe(0);
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
