/**
 * Reine Rechnung für die Stufenleiste (docs/ALBUM_UI.md, A.2 #22 und G-27): alle 8 Stufen
 * gleichmäßig verteilt (Samen links, Urwald rechts), der Balken steht an der Stelle des
 * Baums – Stufe plus Anteil bis zur nächsten Stufe, gemessen in Wegpunkten.
 */
import { STAGES } from '../../content/stages';

export interface StageLadderStep {
  name: string;
  /** reached = schon erreicht, current = jetzt, future = noch offen. */
  state: 'reached' | 'current' | 'future';
}

/** Stufen mit ihrem Zustand für die Beschriftung. */
export function ladderSteps(stage: number): StageLadderStep[] {
  return STAGES.map((s, i) => ({ name: s.name, state: i < stage ? 'reached' : i === stage ? 'current' : 'future' }));
}

/**
 * Anteil 0–1 der Leiste. `waypoint`: erreichte Wegpunkte, `waypointProgress`: Anteil
 * (0–1) bis zum nächsten Wegpunkt. Auf der letzten Stufe 1.
 */
export function ladderProgress(stage: number, waypoint: number, waypointProgress: number): number {
  const last = STAGES.length - 1;
  if (!Number.isFinite(stage) || stage >= last) return 1;
  const s = Math.max(0, Math.floor(stage));
  const start = STAGES[s]!.waypoint;
  const end = STAGES[s + 1]!.waypoint;
  const part = Number.isFinite(waypointProgress) ? Math.min(1, Math.max(0, waypointProgress)) : 0;
  const within = end > start ? Math.min(1, Math.max(0, (waypoint + part - start) / (end - start))) : 0;
  return Math.min(1, (s + within) / last);
}
