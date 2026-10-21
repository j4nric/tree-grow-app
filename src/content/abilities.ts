import type { AbilityId, Genus, Level, NicheId, PlantGroup } from './types';

/**
 * Fähigkeiten besonderer und legendärer Arten (DESIGN_V2.md 5.3). Reine Daten: Name,
 * Text und die Zahlen, mit denen core/formulas.ts rechnet. Eine Fähigkeit wirkt, solange
 * die Art im Ökosystem lebt – sie wird NICHT mit der Zufriedenheit skaliert und wirkt
 * nicht doppelt, wenn zwei Arten dieselbe Fähigkeit hätten. Zahlen aus scripts/v2/model.ts.
 */
export interface AbilityInfo {
  name: string;
  text: string;
}

export const ABILITY_INFO: Readonly<Record<AbilityId, AbilityInfo>> = {
  minSupply: { name: 'Waldweites Netz', text: 'Versorgung aller Pflanzen mindestens 90 %' },
  rarityBoost: { name: 'Glückspilz', text: 'seltene, besondere und legendäre Karten je +5 Prozentpunkte' },
  countsAsBird: { name: 'Nachtflieger', text: 'zählt zusätzlich als Vogel' },
  decomposerBoost: { name: 'König des Totholzes', text: 'alle Zersetzer & Partner +20 % Zufriedenheit' },
  communityBoost: { name: 'Lichterabend', text: 'jede Lebensgemeinschaft +3 Harmonie' },
  mossNoWater: { name: 'Hüter der Feuchte', text: 'Moose & Farne brauchen kein Wasser' },
  calm: { name: 'Gelassen', text: 'Zufriedenheit nie unter 50 %' },
  nightWatch: { name: 'Nachtwache', text: 'Schaden aller Pflanzenfresser −20 %' },
  architect: { name: 'Baumeister', text: '+1 Platz Krone und Höhlen; Höhlenbewohner +20 % Zufriedenheit' },
  fear: { name: 'Landschaft der Angst', text: 'Reh-Schaden entfällt, Reh-Licht ×2' },
};

/** Waldweites Netz: Untergrenze der Versorgung V. */
export const MIN_SUPPLY_FLOOR = 0.9;

/**
 * Glückspilz: Prozentpunkte mehr für selten, besonders und legendär; gewöhnlich verliert
 * das Dreifache (Seltenheitsgewichte, DESIGN_V2.md 7.3).
 */
export const RARITY_BOOST_POINTS = 5;

/** Nachtflieger: zählt zusätzlich als diese Gattung (Gattungsboni, Wünsche „n× Gattung“). */
export const COUNTS_AS_GENUS: Genus = 'birds';

/** König des Totholzes: Zufriedenheit dieser Ebene steigt um so viel. */
export const DECOMPOSER_BOOST: Readonly<{ level: Level; happiness: number }> = { level: 'decomposer', happiness: 0.2 };

/** Lichterabend: zusätzliche Harmonie je aktiver Lebensgemeinschaft (communities.ts). */
export const COMMUNITY_BOOST_HARMONY = 3;

/** Hüter der Feuchte: Pflanzen dieser Gruppe brauchen kein Wasser (Speicher bleibt). */
export const NO_WATER_GROUP: PlantGroup = 'mosses';

/** Gelassen: Zufriedenheit dieser Art nie darunter. */
export const CALM_MIN_HAPPINESS = 0.5;

/** Nachtwache: Schaden aller Pflanzenfresser mal (1 − Anteil). */
export const NIGHT_WATCH: Readonly<{ level: Level; reduction: number }> = { level: 'herbivore', reduction: 0.2 };

/** Baumeister: zusätzliche Plätze und Zufriedenheit der Bewohner einer Nische. */
export const ARCHITECT: Readonly<{
  slots: readonly { niche: NicheId; amount: number }[];
  niche: NicheId;
  happiness: number;
}> = {
  slots: [
    { niche: 'crown', amount: 1 },
    { niche: 'hollows', amount: 1 },
  ],
  niche: 'hollows',
  happiness: 0.2,
};

/**
 * Landschaft der Angst: Beute des Jägers (Arten, die ein Nahrungsmerkmal von ihm
 * bereitstellen – beim Wolf das Reh) richtet keinen Fraßschaden an, ihre Licht-Wirkung
 * zählt FEAR_LIGHT_FACTOR-mal (für „sonnig“ zählt sie weiter einfach).
 */
export const FEAR_LIGHT_FACTOR = 2;
