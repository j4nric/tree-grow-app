import type { TimedEffect } from './events';
import { SEASON_SECONDS, type SeasonId } from './seasons';

/**
 * Tag und Nacht (docs/DESIGN_V2.md, Abschnitt 19). Reine Daten; die Rechnung steht in
 * src/core/formulas.ts (`dayPhaseAt`), das Bild in src/render/daylight.ts.
 *
 * Regeln:
 * - Die Tageszeit läuft wie die Jahreszeiten über die SPIELZEIT des Zyklus
 *   (`cycle.elapsed`, Sekunden), nicht über die Uhrzeit. Offline läuft sie mit.
 * - Ein Tag dauert so lange wie eine Jahreszeit (DAY_SECONDS = SEASON_SECONDS = 180 s):
 *   Jede Jahreszeit erlebt genau einen ganzen Tag mit Morgen, Mittag, Abend und Nacht,
 *   jedes Jahr gleich. (Mit 240 s, drei Tagen je Jahr, sähe eine Jahreszeit z. B. nie
 *   Mitternacht.)
 * - Tagesanteil (`SceneInput.dayPhase`): 0 = Mitternacht, 0,25 = Sonnenaufgang,
 *   0,5 = Mittag, 0,75 = Sonnenuntergang. Jeder Zyklus beginnt am Morgen
 *   (DAY_START_PHASE), kurz nach der Morgendämmerung.
 * - Wirkung (DESIGN_V2.md 21, noch NICHT umgesetzt): Nachts (NIGHT_START_PHASE bis
 *   NIGHT_END_PHASE, die halbe Spielzeit) bekommen nachtaktive Arten (NOCTURNAL) eine
 *   kleine Zusatzwirkung. Ohne sie ist die Nacht folgenlos – keine Strafe.
 */

/** Dauer eines Tages in Sekunden Spielzeit: eine Jahreszeit (3 min; vier Tage je Jahr). */
export const DAY_SECONDS = SEASON_SECONDS;

/**
 * Tagesanteil zu Beginn eines Zyklus (0,3 = früher Vormittag, die Dämmerung ist vorbei).
 * Weil ein Tag genau eine Jahreszeit dauert, beginnt auch jede Jahreszeit am Vormittag.
 */
export const DAY_START_PHASE = 0.3;

/** Tagesanteil „Mittag“ – so zeigt die Einstellung „Immer Tag“ die Szene. */
export const NOON_PHASE = 0.5;

/**
 * Spielerische Nacht: von Sonnenuntergang (0,75) bis Sonnenaufgang (0,25), also genau
 * die halbe Spielzeit. Mit DAY_START_PHASE = 0,3 heißt das: Sekunde 81 bis 171 jedes
 * Tages (elapsed mod 180). Die Grafik zeigt volle Nacht nur ~0,83–0,17; die Dämmerung
 * zählt spielerisch schon zur Nacht (die Tiere werden bei Sonnenuntergang wach).
 */
export const NIGHT_START_PHASE = 0.75;
export const NIGHT_END_PHASE = 0.25;
/** Anteil der Nacht an der Spielzeit (für das Mittel offline). */
export const NIGHT_SHARE = 0.5;

/**
 * Nachtaktive Art: Zusatzwirkung nur nachts, mit der Zufriedenheit der Art skaliert wie
 * ihre Grundwirkung. Nur TimedEffect-Wirkungen (🌿, 🌰) – nie Harmonie, damit die Nacht
 * H_max und das Waldgedächtnis nicht verschiebt.
 */
export interface Nocturnal {
  /** Art-ID aus species.ts. */
  species: string;
  /** Name der Nachtwirkung für Karte und Tooltip. */
  name: string;
  effects: readonly TimedEffect[];
  /** Jahreszeiten, in denen die Art nachts aktiv ist (fehlt: ganzjährig). */
  seasons?: readonly SeasonId[];
  /** Kurzform für Karten, z. B. „nachts +6 % 🌿“. */
  summary: string;
  text: string;
}

export const NOCTURNAL: readonly Nocturnal[] = [
  {
    species: 'owl', name: 'Nachtjagd',
    effects: [{ kind: 'growth', pct: 10 }],
    summary: 'nachts +10 % 🌿',
    text: 'Im Dunkeln hält der Kauz die Mäuse von den Wurzeln fern – auch im Winter.',
  },
  {
    species: 'bat', name: 'Nachtfalterjagd',
    effects: [{ kind: 'seeds', pct: 12 }],
    seasons: ['spring', 'summer', 'autumn'],
    summary: 'nachts +12 % 🌰 (nicht im Winter)',
    text: 'Fängt die Falter, deren Raupen sonst an den Früchten fressen. Im Winter schläft es.',
  },
  {
    species: 'hedgehog', name: 'Nachtschmaus',
    effects: [{ kind: 'growth', pct: 6 }],
    seasons: ['spring', 'summer', 'autumn'],
    summary: 'nachts +6 % 🌿 (nicht im Winter)',
    text: 'Schmatzt nachts Schnecken weg. Den Winter verschläft er im Laubhaufen.',
  },
  {
    species: 'glowworm', name: 'Leuchtende Jäger',
    effects: [{ kind: 'growth', pct: 6 }],
    seasons: ['spring', 'summer', 'autumn'],
    summary: 'nachts +6 % 🌿 (nicht im Winter)',
    text: 'Die leuchtenden Larven jagen nachts Schnecken am Waldsaum.',
  },
];

export const NOCTURNAL_BY_SPECIES: ReadonlyMap<string, Nocturnal> = new Map(NOCTURNAL.map((n) => [n.species, n]));
