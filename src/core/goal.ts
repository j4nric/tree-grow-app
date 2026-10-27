import { RESEARCH } from '../content/research';
import { NICHE_IDS } from '../content/types';
import { TREE_PART_IDS, type UpgradeMilestone } from '../content/upgrades';
import { evaluate, plantSlots, sowingCost } from './formulas';
import type { GameState } from './state';
import { researchBlocker, sowBlocker, upgradeBlocker, upgradeCost, upgradeLevelOf } from './tick';
import { upgradeBase, upgradeMilestones, upgradePrice, type UpgradeTarget } from './upgrades';

/*
 * Zielzeile (DESIGN_V2.md 28.7): „Was jetzt?“ in einem Satz. Reine Auswahlregel ohne Zufall
 * und ohne Uhr – die Oberfläche entscheidet, wann sie neu wählt (Regel 5: nach Kauf, Öffnen
 * einer Nische, Stufenwechsel, Laden) und lässt dazwischen nur die Zeit herunterlaufen.
 * Eigene Datei statt formulas.ts, weil die Kandidaten die Sperrgründe aus tick.ts brauchen
 * (upgradeBlocker, sowBlocker, researchBlocker) und tick.ts schon von formulas.ts abhängt.
 */

/** Alle Ausbau-Ziele in der Gleichstand-Reihenfolge: Nischen (NICHE_IDS), dann Baumteile. */
const UPGRADE_TARGETS: readonly UpgradeTarget[] = [
  ...NICHE_IDS.map((id): UpgradeTarget => ({ kind: 'niche', id })),
  ...TREE_PART_IDS.map((id): UpgradeTarget => ({ kind: 'tree', id })),
];

/** Ein Meilenstein-Kandidat gewinnt, wenn er in höchstens so vielen Sekunden bezahlbar ist. */
export const MILESTONE_GOAL_SECONDS = 120;

export interface NextGoal {
  /** Nischen-Ausbau, Baum-Ausbau oder „🌱 Säen“. */
  kind: 'niche' | 'tree' | 'sow';
  /** Ausbau-Ziel; `null` beim Säen. */
  target: UpgradeTarget | null;
  /** Stufe nach dem Kauf; `null` beim Säen. */
  level: number | null;
  /** Preis in 🌰 (endlich, ≥ 0). */
  cost: number;
  /** Meilensteine mit Wirkung genau auf `level` (ohne reine Abzeichen); leer sonst. */
  milestones: UpgradeMilestone[];
  /** Sekunden, bis die Samen reichen: 0 = jetzt, Infinity ohne Samenrate. */
  seconds: number;
}

/** Meilensteine mit Wirkung (Abzeichen allein zählen für Regel 2 nicht). */
function effectMilestonesAt(target: UpgradeTarget, level: number): UpgradeMilestone[] {
  return upgradeMilestones(target).filter((m) => m.level === level && m.kind !== 'badge');
}

/** Sekunden bis `cost` bezahlbar ist; 0 = jetzt, Infinity ohne (endliche, positive) Rate. */
export function secondsUntilAffordable(cost: number, seeds: number, perSecond: number): number {
  // NaN und negative Samen zählen als 0.
  const missing = cost - (seeds > 0 ? seeds : 0);
  if (!(missing > 0)) return 0;
  return Number.isFinite(perSecond) && perSecond > 0 ? missing / perSecond : Infinity;
}

/**
 * Alle Kandidaten der Zielzeile in der Gleichstand-Reihenfolge (28.7, Regel 1 und 3): „Säen“,
 * wenn ein Pflanzplatz frei ist und Säen nicht an Stufe oder offener Aussaat scheitert; der
 * nächste Ausbau jeder Nische ohne Sperrgrund (NICHE_IDS-Reihenfolge); die drei Baumteile.
 * Unbezahlbar teure Stufen (über MAX_UPGRADE_LEVEL) fallen weg.
 */
export function goalCandidates(state: GameState, seedsPerSecond: number): NextGoal[] {
  const out: NextGoal[] = [];
  const seconds = (cost: number) => secondsUntilAffordable(cost, state.seeds, seedsPerSecond);
  const blocked = sowBlocker(state);
  if (blocked !== 'stage' && blocked !== 'open' && state.plants.length < plantSlots(state.stage)) {
    const cost = sowingCost(state);
    if (Number.isFinite(cost)) out.push({ kind: 'sow', target: null, level: null, cost, milestones: [], seconds: seconds(cost) });
  }
  for (const target of UPGRADE_TARGETS) {
    if (upgradeBlocker(state, target) === 'closed') continue;
    const cost = upgradeCost(state, target);
    if (!Number.isFinite(cost)) continue;
    const level = upgradeLevelOf(state, target) + 1;
    out.push({ kind: target.kind, target, level, cost, milestones: effectMilestonesAt(target, level), seconds: seconds(cost) });
  }
  return out;
}

/**
 * Das nächste lohnende Ziel (28.7): Ist ein Kandidat genau eine Stufe vor einem Meilenstein mit
 * Wirkung (Nischen 10/25/50, Baumteile 25) und in ≤ MILESTONE_GOAL_SECONDS bezahlbar, gewinnt
 * der billigste davon; sonst der billigste Kandidat. Gleichstand: Säen, Nischen in
 * NICHE_IDS-Reihenfolge, Baumteile. Zeit aus der Samenrate (`seedsPerSecond`, Vorgabe: live aus
 * `evaluate`). `null` ohne Kandidat (vor dem Keimling).
 */
export function nextGoal(state: GameState, seedsPerSecond: number = evaluate(state).seeds): NextGoal | null {
  const candidates = goalCandidates(state, seedsPerSecond);
  const soon = candidates.filter((c) => c.milestones.length > 0 && c.seconds <= MILESTONE_GOAL_SECONDS);
  const pool = soon.length > 0 ? soon : candidates;
  let best: NextGoal | null = null;
  // Strikt kleiner: bei Gleichstand bleibt der frühere Kandidat (Reihenfolge = Regel 3).
  for (const c of pool) if (best === null || c.cost < best.cost) best = c;
  return best;
}

/**
 * Wie viele Forschungsknoten gerade erforschbar sind (Anhang „🔍 2 erforschbar ›“, 28.7
 * Regel 6). Fragt nur researchBlocker – Ränge, Kosten und Gabeln stecken dort.
 */
export function researchAvailable(state: GameState): number {
  let n = 0;
  for (const node of RESEARCH) if (researchBlocker(state, node.id) === null) n++;
  return n;
}

/** Rechenschutz für `affordableUpgradeSteps` (mehr Stufen nennt der Bericht nicht genau). */
export const MAX_AFFORDABLE_STEPS = 999;

/**
 * Wie viele Ausbaustufen die Samen gerade bezahlen, wenn immer die billigste nächste Stufe
 * aller offenen Nischen und Baumteile gekauft wird (wie Regel 3 der Zielzeile, ohne Säen) –
 * das ist zugleich die größte mögliche Zahl, weil die Preise je Ziel nur steigen. Für den
 * Rückkehr-Bericht („Genug für 6 Ausbaustufen“, 28.7/28.9). Verändert den Spielstand nicht;
 * höchstens `max`.
 */
export function affordableUpgradeSteps(state: GameState, max = MAX_AFFORDABLE_STEPS): number {
  const open = UPGRADE_TARGETS.filter((t) => upgradeBlocker(state, t) !== 'closed').map((t) => ({
    base: upgradeBase(t) ?? NaN,
    level: upgradeLevelOf(state, t),
  }));
  let budget = Number.isFinite(state.seeds) && state.seeds > 0 ? state.seeds : 0;
  let steps = 0;
  while (steps < max) {
    let pick = -1;
    let price = Infinity;
    open.forEach((o, i) => {
      const p = upgradePrice(o.base, o.level);
      if (p < price) {
        price = p;
        pick = i;
      }
    });
    if (pick < 0 || !(price <= budget)) break;
    budget -= price;
    open[pick]!.level++;
    steps++;
  }
  return steps;
}
