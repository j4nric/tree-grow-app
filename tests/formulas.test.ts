import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { UPGRADES, UPGRADES_BY_ID } from '../src/content/upgrades';
import {
  BASE_LIGHT,
  BASE_PHOTOSYNTHESIS,
  BASE_WATER,
  CLICK_AMOUNT,
  CLICK_SECONDS,
  clickYield,
  getRates, growth, stageForEnergy, steadyEnergyRate, upgradeCost } from '../src/core/formulas';
import { createInitialState } from '../src/core/state';

describe('Inhalte', () => {
  it('Stufen sind aufsteigend sortiert und beginnen bei 0', () => {
    expect(STAGES[0]!.threshold).toBe(0);
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i]!.threshold).toBeGreaterThan(STAGES[i - 1]!.threshold);
    }
  });

  it('Upgrade-IDs sind eindeutig und freischaltbar', () => {
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
    for (const u of UPGRADES) {
      expect(u.unlockStage).toBeLessThan(STAGES.length);
      expect(u.costGrowth).toBeGreaterThan(1);
    }
  });
});

describe('Formeln', () => {
  it('Kosten wachsen exponentiell', () => {
    const u = UPGRADES_BY_ID.get('root-hairs')!;
    expect(upgradeCost(u, 0)).toBe(u.baseCost);
    expect(upgradeCost(u, 2)).toBeCloseTo(u.baseCost * u.costGrowth ** 2);
  });

  it('Raten summieren Upgrade-Effekte', () => {
    const state = createInitialState(0);
    expect(getRates(state)).toEqual({ water: BASE_WATER, light: BASE_LIGHT, photosynthesis: BASE_PHOTOSYNTHESIS });
    state.upgrades['root-hairs'] = 4;
    state.upgrades['chlorophyll'] = 2;
    const rates = getRates(state);
    expect(rates.water).toBeCloseTo(BASE_WATER + 2);
    expect(rates.light).toBeCloseTo(BASE_LIGHT);
    expect(rates.photosynthesis).toBeCloseTo(BASE_PHOTOSYNTHESIS + 2);
  });

  it('Der Samen wächst ohne Upgrades und ohne Klicks von selbst', () => {
    const rates = getRates(createInitialState(0));
    expect(BASE_WATER).toBeGreaterThan(0);
    expect(BASE_LIGHT).toBeGreaterThan(0);
    expect(steadyEnergyRate(rates)).toBeGreaterThan(0);
  });

  it('Klick-Ertrag: mindestens CLICK_AMOUNT, später CLICK_SECONDS Sekunden Produktion', () => {
    expect(clickYield({ water: 0, light: 0, photosynthesis: 1 })).toEqual({ water: CLICK_AMOUNT, light: CLICK_AMOUNT });
    const late = clickYield({ water: 200, light: 150, photosynthesis: 180 });
    expect(late.water).toBeCloseTo(CLICK_SECONDS * 200);
    expect(late.light).toBeCloseTo(CLICK_SECONDS * 150);
    expect(late.water).toBeGreaterThan(CLICK_AMOUNT);
  });

  it('Energie wird durch das knappste Glied begrenzt', () => {
    expect(steadyEnergyRate({ water: 5, light: 1, photosynthesis: 3 })).toBe(1);
  });

  it('Stufe folgt der Gesamtenergie', () => {
    expect(stageForEnergy(0)).toBe(0);
    expect(stageForEnergy(10)).toBe(1);
    expect(stageForEnergy(299)).toBe(1);
    expect(stageForEnergy(300)).toBe(2);
    expect(stageForEnergy(1e12)).toBe(STAGES.length - 1);
  });

  it('Wachstum liegt zwischen aktueller und nächster Stufe', () => {
    const state = createInitialState(0);
    state.stage = 2;
    state.totalEnergy = 949; // halbe log-Strecke zwischen 300 und 3000
    expect(growth(state)).toBeCloseTo(2.5, 1);
  });
});
