import type { DailyGoalKind } from '../content/daily';
import type { GameState } from './state';

/**
 * Zählt eine Spieleraktion für die Tagesziele (DESIGN_V2.md 20): erhöht den Fortschritt
 * aller offenen Ziele dieser Art um 1 (höchstens bis zum Zielwert). Erfüllt und belohnt wird
 * erst in `updateDaily` (core/daily.ts) – so gibt es genau eine Stelle für Belohnungen.
 * Eigenes Modul ohne Abhängigkeiten, damit tick.ts es nutzen kann, ohne daily.ts (das
 * seinerseits tick.ts braucht) zu importieren. Nur Aktionen zählen – automatisches Ablehnen
 * im Tick (online wie offline) nicht.
 */
export function countDailyAction(state: GameState, kind: Extract<DailyGoalKind, 'decide' | 'plant' | 'care'>): void {
  const goals = state.meta.daily?.goals;
  if (!Array.isArray(goals)) return;
  for (const goal of goals) {
    if (goal.kind === kind && !goal.done) goal.progress = Math.min(goal.target, goal.progress + 1);
  }
}
