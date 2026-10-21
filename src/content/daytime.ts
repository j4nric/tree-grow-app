/**
 * Tag und Nacht (docs/DESIGN_V2.md, Abschnitt 19). Reine Daten; die Rechnung steht in
 * src/core/formulas.ts (`dayPhaseAt`), das Bild in src/render/daylight.ts.
 *
 * Regeln:
 * - Die Tageszeit läuft wie die Jahreszeiten über die SPIELZEIT des Zyklus
 *   (`cycle.elapsed`, Sekunden), nicht über die Uhrzeit. Offline läuft sie mit.
 * - Ein Tag dauert DAY_SECONDS Sekunden Spielzeit; ein Jahr (720 s) hat genau drei Tage.
 * - Tagesanteil (`SceneInput.dayPhase`): 0 = Mitternacht, 0,25 = Sonnenaufgang,
 *   0,5 = Mittag, 0,75 = Sonnenuntergang. Jeder Zyklus beginnt am Morgen
 *   (DAY_START_PHASE), kurz nach der Morgendämmerung.
 * - Vorerst nur Grafik: Die Tageszeit hat (noch) keine Wirkung auf Raten oder Tiere.
 */

/** Dauer eines Tages in Sekunden Spielzeit (4 min; drei Tage je Jahr zu 12 min). */
export const DAY_SECONDS = 240;

/** Tagesanteil zu Beginn eines Zyklus (0,3 = früher Vormittag, die Dämmerung ist vorbei). */
export const DAY_START_PHASE = 0.3;

/** Tagesanteil „Mittag“ – so zeigt die Einstellung „Immer Tag“ die Szene. */
export const NOON_PHASE = 0.5;
