/**
 * Konto-Konfiguration aus der Build-Variable und kleine reine Helfer. Fehlt sie, gibt es
 * keine Konto-Funktion – das Spiel läuft rein lokal wie bisher.
 */
import { lifetimeGrowth } from '../core/formulas';
import type { ImportResult } from '../core/save';
import type { GameState } from '../core/state';
import type { CodeCheck } from './engine';
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

/**
 * Uhr (`lastTick`) eines übernommenen Cloud-Stands in der Zeit dieses Geräts: `now − ageMs`,
 * wobei `ageMs` allein aus der Serverzeit stammt – so verschenkt oder verschluckt eine
 * falsch gehende Uhr eines Geräts keine Wachstumszeit. Ohne Alter: die Uhr des Codes, aber
 * nie in der Zukunft.
 */
export function adoptedLastTick(codeLastTick: number, now: number, ageMs?: number): number {
  if (ageMs !== undefined && Number.isFinite(ageMs)) return now - Math.max(0, ageMs);
  return Number.isFinite(codeLastTick) ? Math.min(codeLastTick, now) : now;
}

/** Ergebnis von importCode als Prüfung für den Abgleich. */
export function codeCheck(result: ImportResult): CodeCheck {
  if (result.ok) return 'ok';
  return result.error === 'newer' ? 'newer' : 'invalid';
}
