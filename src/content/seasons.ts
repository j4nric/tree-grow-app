import { REPTILE_SUMMER_HAPPINESS } from './habitats';
import { PREDATION_EVENT_SEASONS } from './predation';
import type { Effect, EncounterType, Genus } from './types';

/**
 * Jahreszeiten (docs/DESIGN_V2.md, Abschnitt 16). Reine Daten; die Logik steht in
 * src/core/season.ts (Spielzeit → Jahreszeit), formulas.ts (Wirkungen) und tick.ts (Halt
 * an der Grenze, Ziehen).
 *
 * Regeln:
 * - Ein Jahr hat vier gleich lange Jahreszeiten zu SEASON_SECONDS Sekunden SPIELZEIT,
 *   gezählt ab Beginn des Zyklus (`cycle.elapsed`, nicht die Uhrzeit). Jeder Zyklus
 *   beginnt im Frühling – der Samen keimt im Frühjahr. Offline läuft das Jahr mit.
 * - Jahreszeit = SEASON_IDS[floor(elapsed / SEASON_SECONDS) mod 4]. Die Wirkungen
 *   wechseln hart an der Grenze (die Raten bleiben dazwischen konstant, wie bei Zeit-Boni).
 *   Nur die Grafik blendet stufenlos über (`SceneInput.season`, siehe `render`).
 * - Sanft und ohne Zwang zum Warten: Jede Jahreszeit bringt mindestens eine positive
 *   Wirkung; der einzige Abzug ist −10 % 🌿 im Winter (die Kiefer ist davon frei, trees.ts).
 *   Nichts, was man kauft oder wählt, wird in einer Jahreszeit billiger oder teurer:
 *   Samen-Sekunden (Ereignisse, Gäste) rechnen OHNE Jahreszeit, wie ohne Zeit-Boni.
 * - Über ein Jahr gemittelt: Wachstum ±0 (+10 / 0 / 0 / −10), Samen +5 %, dazu etwas
 *   mehr Zufriedenheit. Die Zeiten bis zum Hain bleiben damit praktisch gleich
 *   (Simulation DESIGN_V2.md 16.5).
 */

/** Die vier Jahreszeiten in ihrer Reihenfolge (Index = Jahreszeit 0–3). */
export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASON_IDS: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];

/** Dauer einer Jahreszeit in Sekunden Spielzeit (3 min; ein Jahr = 12 min). */
export const SEASON_SECONDS = 180;
/** Dauer eines Jahres in Sekunden Spielzeit. */
export const YEAR_SECONDS = SEASON_SECONDS * SEASON_IDS.length;

/**
 * Zufriedenheit aller Tiere einer Gattung steigt um `points` Prozentpunkte (vor der
 * Begrenzung auf 0–100 %, wie Fähigkeiten „König des Totholzes“ und „Baumeister“).
 * NEUER Wirkungstyp, nicht Teil von `Effect` – Formel in DESIGN_V2.md 16.6.
 * Beispiel: Igel bei 70 % + 15 Punkte Winterruhe → 85 %; bei 95 % → 100 %.
 */
export interface HappinessEffect {
  kind: 'happiness';
  genus: Genus;
  points: number;
}

/**
 * Wirkung einer Jahreszeit, Faktor 1 (nicht mit Zufriedenheit skaliert), solange die
 * Jahreszeit dauert:
 * - `growth` / `seeds` (%): zählen in B_🌿 bzw. B_🌰 wie Zeit-Boni der Ereignisse.
 * - `groupGrowth` / `groupSeeds` (%): Bonus auf eine Pflanzengruppe.
 * - `light` / `water`: zusätzliches Licht bzw. Wasser für die Begleitpflanzen
 *   (zählt auch für „sonnig“).
 * - `harmony`: Harmonie-Punkte.
 * - `happiness`: Zufriedenheit einer Gattung (neu, siehe HappinessEffect).
 */
export type SeasonEffect =
  | Extract<Effect, { kind: 'growth' | 'seeds' | 'groupGrowth' | 'groupSeeds' | 'light' | 'water' | 'harmony' }>
  | HappinessEffect;

export interface Season {
  id: SeasonId;
  name: string;
  icon: string;
  /** Stimmungstext (ein Satz), z. B. für den Hinweis beim Wechsel. */
  text: string;
  /** Wirkungen in Kurzform für die Anzeige. */
  summary: string;
  effects: readonly SeasonEffect[];
  /**
   * Faktoren auf die Gewichte der Begegnungstypen am Wegpunkt (ENCOUNTER_WEIGHTS),
   * fehlend = 1. Nie 0: keine Jahreszeit schließt einen Typ aus. Der Faktor für
   * „Etwas keimt“ gilt nur, solange der Pflanzring Platz hat – bei vollem Ring bleibt es
   * bei PLANT_WEIGHT_RING_FULL (sonst kämen mehr Karten, die nur ersetzen können, und die
   * Strecken ohne lohnende Wahl würden länger, DESIGN_V2.md 7.7).
   */
  encounterFactors?: Readonly<Partial<Record<EncounterType, number>>>;
  /**
   * Wert für `SceneInput.season` (0 Frühling · 1 Sommer · 2 Herbst · 3 Winter) in der
   * MITTE dieser Jahreszeit. Für die Grafik gilt stufenlos
   *   season = (elapsed / SEASON_SECONDS − 0,5) mod 4,
   * d. h. Spielbeginn = 3,5 (Schneeschmelze), Mitte Frühling = 0, Grenze Frühling/Sommer
   * = 0,5. So fällt der Wechsel der Wirkungen auf die Mitte der Überblendung.
   */
  renderValue: number;
}

export const SEASONS: readonly Season[] = [
  {
    id: 'spring', name: 'Frühling', icon: '🌱', renderValue: 0,
    text: 'Der Saft steigt, überall bricht frisches Grün auf.',
    summary: '+10 % 🌿 · „Etwas keimt“ öfter · Amphibien +15 % 😊',
    // Laichzeit: Die Amphibien wandern zum Tümpel (DESIGN_V2.md 5.5).
    effects: [
      { kind: 'growth', pct: 10 },
      { kind: 'happiness', genus: 'amphibians', points: 15 },
    ],
    // Pflanzenbegegnungen ×1,5, solange der Ring Platz hat (Junger Baum: 25 → 37,5).
    encounterFactors: { plant: 1.5 },
  },
  {
    id: 'summer', name: 'Sommer', icon: '☀️', renderValue: 1,
    text: 'Lange, helle Tage – über dem Waldsaum summt und flattert es.',
    summary: '+2 ☀️ · Insekten +10 %, Reptilien +15 % 😊',
    // Sonnenbad: Reptilien sind wechselwarm (DESIGN_V2.md 23.3).
    effects: [
      { kind: 'light', amount: 2 },
      { kind: 'happiness', genus: 'insects', points: 10 },
      { kind: 'happiness', genus: 'reptiles', points: REPTILE_SUMMER_HAPPINESS },
    ],
  },
  {
    id: 'autumn', name: 'Herbst', icon: '🍂', renderValue: 2,
    text: 'Früchte reifen, und über Nacht stehen Hüte im Laub.',
    summary: '+20 % 🌰 · Pilze +15 % 😊',
    effects: [
      { kind: 'seeds', pct: 20 },
      { kind: 'happiness', genus: 'fungi', points: 15 },
    ],
  },
  {
    id: 'winter', name: 'Winter', icon: '❄️', renderValue: 3,
    text: 'Der Baum ruht. Unter Schnee und Laub ist es still und geschützt.',
    summary: '−10 % 🌿 · Säugetiere +15 %, Bodenleben +10 % 😊 · Zugvögel fort',
    effects: [
      { kind: 'growth', pct: -10 },
      { kind: 'happiness', genus: 'mammals', points: 15 },
      { kind: 'happiness', genus: 'soil', points: 10 },
    ],
  },
];

export const SEASONS_BY_ID: ReadonlyMap<SeasonId, Season> = new Map(SEASONS.map((s) => [s.id, s]));

/**
 * Durchreisende, die nur in bestimmten Jahreszeiten kommen (fehlt ein Gast: ganzjährig).
 * Zusätzliche Erscheinungsbedingung beim Ziehen (eligibleVisitors). Ein Gast, der schon
 * in der Warteschlange wartet oder rastet, bleibt auch über den Wechsel hinaus.
 * Zugvögel ziehen im Winter fort, dafür kommen Wintergäste aus dem Norden.
 */
export const VISITOR_SEASONS: Readonly<Record<string, readonly SeasonId[]>> = {
  cranes: ['spring', 'autumn'], // Kranichzug: hin im Frühjahr, zurück im Herbst
  swallows: ['summer', 'autumn'], // sammeln sich im Spätsommer vor dem Abflug
  'hummingbird-moth': ['summer', 'autumn'], // Wanderfalter aus dem Süden
  'stag-flight': ['summer'], // Hochzeitsflug an warmen Juniabenden
  bramblings: ['autumn', 'winter'], // Wintergäste aus Skandinavien
  waxwings: ['autumn', 'winter'], // Wintergäste aus der Taiga
};

/**
 * Ereignisse, die nur in bestimmten Jahreszeiten kommen (fehlt eins: ganzjährig).
 * Prüfung wie bei VISITOR_SEASONS. Sturm, Windwurf, Blitz und Vogelsaat bleiben ganzjährig,
 * damit in jeder Jahreszeit Ereignisse in Frage kommen. Dazu hat jede Jahreszeit ein
 * eigenes Ereignis ab Junger Baum ohne Bedingung (Spätfrost, Hitzewelle, Laubfall,
 * Schneebruch).
 */
export const EVENT_SEASONS: Readonly<Record<string, readonly SeasonId[]>> = {
  rain: ['spring'], // „Regenreicher Frühling“
  midsummer: ['summer'],
  'mushroom-autumn': ['autumn'],
  'mast-year': ['autumn'], // Eicheln reifen im Herbst
  'bee-swarm': ['spring', 'summer'], // Schwarmzeit Mai bis Juli
  'ant-trail': ['spring', 'summer', 'autumn'], // Waldameisen ruhen im Winter
  'late-frost': ['spring'], // „Eisheilige“: Frostnächte bis Mitte Mai
  heatwave: ['summer'],
  'leaf-fall': ['autumn'],
  'snow-break': ['winter'], // Nassschnee bricht Äste
  'toad-migration': ['spring'], // Laichwanderung in milden Regennächten im März/April
  ...PREDATION_EVENT_SEASONS, // Massenjahre (DESIGN_V2.md 22.5)
};
