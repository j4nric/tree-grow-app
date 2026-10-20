import { STAGES } from '../content/stages';
import { UPGRADES, type Upgrade } from '../content/upgrades';
import type { GameState } from './state';

/** Grundwerte ohne Upgrades: Der Samen zieht von Anfang an selbst etwas Wasser und Licht. */
export const BASE_WATER = 1;
export const BASE_LIGHT = 1;
export const BASE_PHOTOSYNTHESIS = 1;
/** Mindestmenge Wasser und Licht, die ein Klick auf „Wachsen“ bringt. */
export const CLICK_AMOUNT = 1;
/** Ein Klick bringt zusätzlich so viele Sekunden der eigenen Wasser- bzw. Lichtproduktion. */
export const CLICK_SECONDS = 1;

export interface Rates {
  /** Wasser pro Sekunde. */
  water: number;
  /** Licht pro Sekunde. */
  light: number;
  /** Maximale Umwandlung Wasser + Licht → Energie pro Sekunde. */
  photosynthesis: number;
}

export function upgradeLevel(state: GameState, id: string): number {
  return state.upgrades[id] ?? 0;
}

/** Kosten der nächsten Stufe: baseCost · costGrowth^level */
export function upgradeCost(upgrade: Upgrade, level: number): number {
  return upgrade.baseCost * Math.pow(upgrade.costGrowth, level);
}

export function getRates(state: GameState): Rates {
  const rates: Rates = { water: BASE_WATER, light: BASE_LIGHT, photosynthesis: BASE_PHOTOSYNTHESIS };
  for (const upgrade of UPGRADES) {
    const level = upgradeLevel(state, upgrade.id);
    if (level === 0) continue;
    const effect = upgrade.effect;
    switch (effect.type) {
      case 'produce':
        rates[effect.resource] += effect.perLevel * level;
        break;
      case 'photosynthesis':
        rates.photosynthesis += effect.perLevel * level;
        break;
    }
  }
  return rates;
}

/**
 * Ertrag eines Klicks auf „Wachsen“: je Ressource max(CLICK_AMOUNT, CLICK_SECONDS · Rate).
 * Wächst mit der Produktion, damit Klicken später nicht bedeutungslos wird.
 */
export function clickYield(rates: Rates): { water: number; light: number } {
  return {
    water: Math.max(CLICK_AMOUNT, CLICK_SECONDS * rates.water),
    light: Math.max(CLICK_AMOUNT, CLICK_SECONDS * rates.light),
  };
}

/** Energie pro Sekunde im Gleichgewicht: begrenzt durch das knappste Glied. */
export function steadyEnergyRate(rates: Rates): number {
  return Math.min(rates.water, rates.light, rates.photosynthesis);
}

/** Höchste Stufe, deren Schwelle `totalEnergy` erreicht. */
export function stageForEnergy(totalEnergy: number): number {
  let stage = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (totalEnergy >= STAGES[i]!.threshold) stage = i;
  }
  return stage;
}

/** Fortschritt zur nächsten Stufe in [0, 1] (logarithmisch). 1 auf der letzten Stufe. */
export function stageProgress(state: GameState): number {
  const current = STAGES[state.stage];
  const next = STAGES[state.stage + 1];
  if (!current || !next) return 1;
  const from = Math.log10(Math.max(current.threshold, 1));
  const to = Math.log10(next.threshold);
  const at = Math.log10(Math.max(state.totalEnergy, 1));
  return Math.min(1, Math.max(0, (at - from) / (to - from)));
}

/**
 * Kontinuierlicher Wachstumswert für die Darstellung:
 * Stufen-Index + Fortschritt zur nächsten Stufe (z. B. 2.5 = halb vom Setzling zum jungen Baum).
 */
export function growth(state: GameState): number {
  return state.stage + stageProgress(state);
}
