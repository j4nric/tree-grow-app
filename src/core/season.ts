import { SEASONS, SEASON_IDS, SEASON_SECONDS, type Season, type SeasonId } from '../content/seasons';

/*
 * Jahreszeiten (DESIGN_V2.md 16.2, 16.6): reine Rechnungen über die Spielzeit des
 * Zyklus (`cycle.elapsed`, Sekunden). Kein DOM, keine Uhr – darum auch im Renderer-Takt
 * (main.ts, jeden Frame) und in Tests nutzbar.
 */

/**
 * Obergrenze für `cycle.elapsed` (≈ 31.700 Jahre Spielzeit). Darüber wird die Zahl zu
 * grob, um Jahreszeitgrenzen sauber zu treffen; das Laden begrenzt darauf, und ab hier
 * steht das Jahr still (kein Halt mehr in tick).
 */
export const MAX_ELAPSED = 1e12;

/** Gültige Spielzeit: endlich, ≥ 0 und ≤ MAX_ELAPSED; alles andere zählt als 0 bzw. Grenze. */
export function normalizeElapsed(elapsed: number): number {
  if (Number.isNaN(elapsed) || !(elapsed > 0)) return 0;
  return Math.min(MAX_ELAPSED, elapsed);
}

/** Jahreszeit-Index 0 Frühling · 1 Sommer · 2 Herbst · 3 Winter: floor(elapsed / 180) mod 4. */
export function seasonIndex(elapsed: number): number {
  return Math.floor(normalizeElapsed(elapsed) / SEASON_SECONDS) % SEASON_IDS.length;
}

/** ID der Jahreszeit zur Spielzeit `elapsed`. */
export function seasonIdAt(elapsed: number): SeasonId {
  return SEASON_IDS[seasonIndex(elapsed)]!;
}

/** Die Jahreszeit (Daten) zur Spielzeit `elapsed`. */
export function seasonAt(elapsed: number): Season {
  return SEASONS[seasonIndex(elapsed)]!;
}

/** Spielzeit, zu der die laufende Jahreszeit endet (die nächste Grenze, > elapsed). */
export function nextSeasonBoundary(elapsed: number): number {
  return (Math.floor(normalizeElapsed(elapsed) / SEASON_SECONDS) + 1) * SEASON_SECONDS;
}

/**
 * Sekunden bis zum nächsten Wechsel der Jahreszeit (> 0). Infinity ab MAX_ELAPSED – dort
 * steht das Jahr still, damit tick() nie in einem Schritt der Länge 0 hängen bleibt.
 */
export function secondsToNextSeason(elapsed: number): number {
  const now = normalizeElapsed(elapsed);
  if (now >= MAX_ELAPSED) return Infinity;
  const left = nextSeasonBoundary(now) - now;
  return left > 0 ? left : Infinity;
}

/**
 * Stufenloser Wert für die Grafik (`SceneInput.season`): (elapsed / 180 − 0,5) mod 4 in
 * [0, 4). Zyklusbeginn = 3,5 (Schneeschmelze), Mitte Frühling = 0, Grenze Frühling/Sommer
 * = 0,5 – der harte Wechsel der Wirkungen fällt in die Mitte der Überblendung.
 */
export function sceneSeason(elapsed: number): number {
  const n = SEASON_IDS.length;
  const value = (((normalizeElapsed(elapsed) / SEASON_SECONDS - 0.5) % n) + n) % n;
  // Rundung kann genau n ergeben (z. B. −1e-17 + 4) – auf 0 zurückfalten.
  return value >= n ? 0 : value;
}
