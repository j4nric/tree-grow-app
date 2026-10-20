import { UPGRADES_BY_ID } from '../content/upgrades';
import { clickYield, getRates, stageForEnergy, upgradeCost, upgradeLevel } from './formulas';
import type { GameState } from './state';

/** Offline-Fortschritt wird auf diese Dauer begrenzt. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;
/** Schrittweite der Offline-Simulation. */
const OFFLINE_STEP_SECONDS = 1;
/** Obergrenze der Simulationsschritte, damit das Laden schnell bleibt. */
const MAX_OFFLINE_STEPS = 2_000;

/**
 * Lässt `dt` Sekunden Spielzeit vergehen. Verändert `state` direkt.
 * Deterministisch: keine Zufallszahlen, keine Uhrzeit – Zeit kommt nur über `dt`.
 */
export function tick(state: GameState, dt: number): void {
  if (dt <= 0) return;
  const rates = getRates(state);
  const res = state.resources;

  res.water += rates.water * dt;
  res.light += rates.light * dt;

  // Photosynthese: Wasser + Licht → Energie, begrenzt durch Kapazität und Vorrat.
  const converted = Math.min(rates.photosynthesis * dt, res.water, res.light);
  if (converted > 0) {
    res.water -= converted;
    res.light -= converted;
    addEnergy(state, converted);
  }
}

/** Spieler klickt auf „Wachsen“: Wasser und Licht sofort (optionaler Schub, siehe clickYield). */
export function clickGrow(state: GameState): void {
  const gained = clickYield(getRates(state));
  state.resources.water += gained.water;
  state.resources.light += gained.light;
}

/** Kauft eine Stufe des Upgrades. Gibt false zurück, wenn gesperrt oder zu teuer. */
export function buyUpgrade(state: GameState, id: string): boolean {
  const upgrade = UPGRADES_BY_ID.get(id);
  if (!upgrade || upgrade.unlockStage > state.stage) return false;
  const cost = upgradeCost(upgrade, upgradeLevel(state, id));
  if (state.resources.energy < cost) return false;
  state.resources.energy -= cost;
  state.upgrades[id] = upgradeLevel(state, id) + 1;
  return true;
}

/**
 * Simuliert die Zeit, in der das Spiel geschlossen war.
 * Gibt die dabei erzeugte Energie zurück (für die „Willkommen zurück“-Meldung).
 */
export function simulateOffline(state: GameState, seconds: number): number {
  const total = Math.min(Math.max(seconds, 0), MAX_OFFLINE_SECONDS);
  const before = state.totalEnergy;
  const steps = Math.min(Math.ceil(total / OFFLINE_STEP_SECONDS), MAX_OFFLINE_STEPS);
  if (steps > 0) {
    const dt = total / steps;
    for (let i = 0; i < steps; i++) tick(state, dt);
  }
  return state.totalEnergy - before;
}

function addEnergy(state: GameState, amount: number): void {
  state.resources.energy += amount;
  state.totalEnergy += amount;
  // Stufen gehen innerhalb eines Durchgangs nie zurück.
  state.stage = Math.max(state.stage, stageForEnergy(state.totalEnergy));
}
