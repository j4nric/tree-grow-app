import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { UPGRADES, UPGRADES_BY_ID } from '../src/content/upgrades';
import { BASE_PHOTOSYNTHESIS, getRates, growth, stageForEnergy, steadyEnergyRate, upgradeCost } from '../src/core/formulas';
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
    expect(getRates(state)).toEqual({ water: 0, light: 0, photosynthesis: BASE_PHOTOSYNTHESIS });
    state.upgrades['root-hairs'] = 4;
    state.upgrades['chlorophyll'] = 2;
    const rates = getRates(state);
    expect(rates.water).toBeCloseTo(2);
    expect(rates.photosynthesis).toBeCloseTo(BASE_PHOTOSYNTHESIS + 2);
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
