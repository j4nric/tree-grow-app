/**
 * Konto-Konfiguration aus der Build-Variable und kleine reine Helfer. Fehlt sie, gibt es
 * keine Konto-Funktion – das Spiel läuft rein lokal wie bisher.
 */
import { lifetimeGrowth } from '../core/formulas';
import type { GameState } from '../core/state';
import type { Progress } from './policy';

/**
 * Adresse des Sync-Servers aus `VITE_SYNC_URL` (z. B. `https://203-0-113-5.sslip.io`).
 * Nur http(s) ohne Leerraum; ein Schrägstrich am Ende wird entfernt. Sonst null.
 */
export function readSyncUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(url) ? url : null;
}

/** Fortschritt eines Spielstands (für den Vergleich bei der ersten Anmeldung). */
export function progressOfState(state: GameState): Progress {
  return {
    cycle: state.cycle.number,
    lifetimeGrowth: lifetimeGrowth(state),
    playSeconds: state.meta.stats.playSeconds,
  };
}
