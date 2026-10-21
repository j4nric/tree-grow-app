import type { EncounterType } from './types';

/**
 * Begegnungen (docs/DESIGN_V2.md, Abschnitt 7): „Tier zieht ein“ und „Etwas keimt“.
 * Samen-Kosten und -Erträge sind vorerst fest – das Design koppelt sie später an die
 * Kosten der nächsten Pflanze (Ablehnen 25 %, Neu würfeln 50 % von 20 🌰).
 */

/** Karten je Begegnung (weniger, wenn nicht genug Arten in Frage kommen). */
export const CARDS_PER_ENCOUNTER = 3;

/** Höchstens so viele Begegnungen warten; überzählige werden automatisch abgelehnt. */
export const MAX_PENDING_ENCOUNTERS = 3;

/** Ablehnen bringt so viele Samen (auch beim automatischen Ablehnen). */
export const DECLINE_SEEDS = 5;

/** Neu würfeln kostet REROLL_BASE_COST · REROLL_COST_GROWTH^(bisherige Würfe dieser Begegnung). */
export const REROLL_BASE_COST = 10;
export const REROLL_COST_GROWTH = 2;

/** Seltenheitsgewichte [gewöhnlich, selten, besonders, legendär] je Stufe. */
export const RARITY_WEIGHTS: readonly (readonly [number, number, number, number])[] = [
  [90, 10, 0, 0], // Samen
  [90, 10, 0, 0], // Keimling
  [85, 15, 0, 0], // Setzling
  [72, 23, 5, 0], // Junger Baum
  [60, 28, 10, 2], // Alter Baum
  [50, 30, 14, 6], // Hain
  [45, 30, 17, 8], // Wald
  [40, 30, 20, 10], // Urwald
];

/**
 * Gewichte der Begegnungstypen je Stufe: [Tier, Pflanze, Ereignis, Durchreisende]
 * (Reihenfolge wie ENCOUNTER_TYPES). Typen, die es noch nicht gibt (Ereignis,
 * Durchreisende bis Schritt 2.4), fallen beim Ziehen weg – die übrigen Gewichte gelten
 * dann im Verhältnis zueinander (z. B. Alter Baum 55 : 20).
 */
export const ENCOUNTER_WEIGHTS: readonly (readonly [number, number, number, number])[] = [
  [60, 40, 0, 0], // Samen
  [60, 40, 0, 0], // Keimling
  [60, 40, 0, 0], // Setzling
  [60, 25, 15, 0], // Junger Baum
  [55, 20, 15, 10], // Alter Baum
  [55, 20, 15, 10], // Hain
  [55, 20, 15, 10], // Wald
  [55, 20, 15, 10], // Urwald
];

/** Die ersten Begegnungen sind festgelegt (Einführung): Wegpunkt 1, 2, 3 … */
export const SCRIPTED_ENCOUNTERS: readonly EncounterType[] = ['animal', 'plant', 'animal'];
