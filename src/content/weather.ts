import type { TimedEffect } from './events';
import type { SeasonId } from './seasons';
import type { MainTreeId } from './trees';

/**
 * Wetterlagen (docs/DESIGN_V2.md, Abschnitt 21). Reine Daten; die Rechnung (Auswahl aus
 * Seed und Spielzeit, Dämpfung, Mittelwetter für offline) steht in src/core/weather.ts
 * (Formeln in DESIGN_V2.md 21.4), die Wirkung in formulas.ts (evaluate) und tick.ts.
 *
 * Regeln:
 * - Ein Wetter gilt genau einen Tag = eine Jahreszeit (SEASON_SECONDS = DAY_SECONDS =
 *   180 s Spielzeit). Es wechselt also nur an der Grenze der Jahreszeit (am Vormittag) –
 *   kein zusätzlicher Halt in `tick` (die Nacht-Halte bei 81 und 171 s sind für Nachtarten).
 * - Auswahl deterministisch aus Zyklus und Tag (kein Math.random, kein neues Feld im
 *   Spielstand): Tag n = floor(elapsed / 180), Gewichte der Jahreszeit (WEATHER_WEIGHTS).
 *   Der erste Tag jedes Zyklus ist immer FIRST_DAY_WEATHER, im ersten Jahr (GENTLE_DAYS)
 *   gibt es keine rauen Lagen, und nach einem rauen Tag folgt nie ein zweiter (dann
 *   „Wechselhaft“).
 * - Wirkungen nur vom Typ TimedEffect (🌿, 🌰, Gruppen), Faktor 1 wie Jahreszeiten.
 *   Wetter berührt NIE Harmonie, Zufriedenheit, Licht oder Wasser: Es schiebt H_max und das
 *   Waldgedächtnis nicht, und das Mittelwetter für offline ist exakt (alles linear).
 * - Raue Lagen (`rough`) tauschen Wachstum gegen Samen. Ihr Abzug wird gedämpft: je
 *   vertretener Gattung um DIVERSITY_DAMPING_PER_GENUS (höchstens DIVERSITY_DAMPING_MAX),
 *   mit dem passenden Forschungsknoten (`protection`) zusätzlich halbiert.
 * - Offline (simulateOffline, ab OFFLINE_AVERAGE_MIN_SECONDS) gilt das Mittelwetter der
 *   Jahreszeit statt Einzelwetter, für Nachtarten der Nachtanteil (NIGHT_SHARE).
 * - Samen-Sekunden (Ereignisse, Gäste) rechnen OHNE Wetter, wie ohne Jahreszeit.
 */

export type WeatherId = 'mild' | 'rain' | 'sun' | 'fog' | 'snow' | 'drought' | 'storm' | 'frost';

export interface Weather {
  id: WeatherId;
  name: string;
  icon: string;
  /** Stimmungstext (ein Satz) für den Hinweis beim Wechsel. */
  text: string;
  /** Wirkungen in Kurzform für Abzeichen und Tooltip (ungedämpft). */
  summary: string;
  /** Wirkungen, Faktor 1, solange der Tag dauert. Leer = keine Wirkung. */
  effects: readonly TimedEffect[];
  /** Raue Lage: Abzüge werden gedämpft, nie zwei raue Tage hintereinander. */
  rough?: boolean;
  /**
   * Forschungsknoten (ID in research.ts), der erforscht den Abzug dieser rauen Lage zusätzlich
   * mit PROTECTION_FACTOR multipliziert.
   */
  protection?: string;
  /** Text zur Schutzwirkung für den Tooltip. */
  protectionText?: string;
  /** Hauptbaum-Arten (trees.ts), für die der Abzug ganz entfällt (winterfest). */
  immuneTrees?: readonly MainTreeId[];
}

export const WEATHERS: readonly Weather[] = [
  {
    id: 'mild', name: 'Wechselhaft', icon: '⛅',
    text: 'Wolken ziehen, mal Sonne, mal ein Schauer – ein ganz gewöhnlicher Tag.',
    summary: 'keine Wirkung',
    effects: [],
  },
  {
    id: 'rain', name: 'Landregen', icon: '🌧️',
    text: 'Ein langer, sanfter Regen. Der Boden trinkt sich satt.',
    summary: '+10 % 🌿',
    effects: [{ kind: 'growth', pct: 10 }],
  },
  {
    id: 'sun', name: 'Sonnenschein', icon: '☀️',
    text: 'Blauer Himmel – die Blüten öffnen sich weit.',
    summary: '+10 % 🌰, Blumen +20 % 🌰',
    effects: [{ kind: 'seeds', pct: 10 }, { kind: 'groupSeeds', group: 'flowers', pct: 20 }],
  },
  {
    id: 'fog', name: 'Nebel', icon: '🌫️',
    text: 'Feuchter Nebel hängt zwischen den Stämmen. Moose und Farne lieben es.',
    summary: '+5 % 🌿, Moose & Farne +30 % 🌿',
    effects: [{ kind: 'growth', pct: 5 }, { kind: 'groupGrowth', group: 'mosses', pct: 30 }],
  },
  {
    id: 'snow', name: 'Neuschnee', icon: '🌨️',
    text: 'Eine weiche Schneedecke hält die Wurzeln warm.',
    summary: '+5 % 🌿',
    effects: [{ kind: 'growth', pct: 5 }],
  },
  {
    id: 'drought', name: 'Dürre', icon: '🌡️', rough: true,
    text: 'Seit Tagen kein Tropfen. Der Baum spart Wasser und lässt früh Früchte reifen.',
    summary: '−15 % 🌿, +20 % 🌰',
    effects: [{ kind: 'growth', pct: -15 }, { kind: 'seeds', pct: 20 }],
    protection: 'pond', protectionText: 'Der Waldtümpel hält den Boden feucht.',
  },
  {
    id: 'storm', name: 'Sturm', icon: '🌬️', rough: true,
    text: 'Böen zerren an der Krone – und tragen Samen weit ins Land.',
    summary: '−15 % 🌿, +25 % 🌰',
    effects: [{ kind: 'growth', pct: -15 }, { kind: 'seeds', pct: 25 }],
    protection: 'light-crown', protectionText: 'Durch die lichte Krone pfeift der Wind hindurch.',
  },
  {
    id: 'frost', name: 'Frost', icon: '🧊', rough: true,
    text: 'Raureif glitzert an jedem Zweig. Die Kälte bricht die Keimruhe der Samen.',
    summary: '−10 % 🌿, +15 % 🌰',
    effects: [{ kind: 'growth', pct: -10 }, { kind: 'seeds', pct: 15 }],
    protection: 'leaf-litter', protectionText: 'Die Laubdecke schützt die Wurzeln vor Frost.',
    immuneTrees: ['pine'],
  },
];

export const WEATHERS_BY_ID: ReadonlyMap<WeatherId, Weather> = new Map(WEATHERS.map((w) => [w.id, w]));

/**
 * Gewichte je Jahreszeit (Summe je 100 = Prozent vor der Regel „nie zwei raue Tage
 * hintereinander“). Fehlt ein Wetter, kommt es in dieser Jahreszeit nicht vor.
 * Raue Lagen: Frühling 5 %, Sommer 15 %, Herbst 20 %, Winter 25 %.
 */
export const WEATHER_WEIGHTS: Readonly<Record<SeasonId, Readonly<Partial<Record<WeatherId, number>>>>> = {
  spring: { mild: 40, rain: 25, sun: 20, fog: 10, frost: 5 },
  summer: { mild: 40, sun: 30, rain: 15, drought: 10, storm: 5 },
  autumn: { mild: 35, fog: 25, storm: 20, rain: 10, sun: 10 },
  winter: { mild: 35, snow: 30, frost: 20, fog: 10, storm: 5 },
};

/** Der erste Tag jedes Zyklus (der Samen keimt in Ruhe; frühes Spiel unverändert). */
export const FIRST_DAY_WEATHER: WeatherId = 'mild';

/**
 * Schonzeit: In den ersten GENTLE_DAYS Tagen jedes Zyklus (dem ersten Jahr, 12 min) gibt
 * es keine rauen Lagen – das frühe Spiel bis etwa zum Alten Baum bleibt wie getestet.
 */
export const GENTLE_DAYS = 4;

/** Ersatz, wenn auf einen rauen Tag ein zweiter rauer folgen würde (oder in der Schonzeit). */
export const AFTER_ROUGH_WEATHER: WeatherId = 'mild';

/** Dämpfung der Abzüge rauer Lagen je Gattung mit mindestens einem Tier (0,1 = 10 %). */
export const DIVERSITY_DAMPING_PER_GENUS = 0.1;
/** Höchstens so viel Dämpfung durch Vielfalt (ab 5 Gattungen). */
export const DIVERSITY_DAMPING_MAX = 0.5;
/** Schutz durch den passenden Forschungsknoten: Abzug × PROTECTION_FACTOR. */
export const PROTECTION_FACTOR = 0.5;

/**
 * Offline: Ab dieser Abwesenheit (Sekunden, ein Tag) rechnet simulateOffline mit dem
 * Mittelwetter der Jahreszeit; kürzere Lücken (Tab kurz verdeckt) mit dem Einzelwetter.
 */
export const OFFLINE_AVERAGE_MIN_SECONDS = 180;

/** Überblendung der Grafik beim Wetterwechsel in Sekunden Spielzeit (nur Darstellung). */
export const WEATHER_BLEND_SECONDS = 6;
