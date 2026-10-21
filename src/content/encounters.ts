import type { EncounterType } from './types';

/**
 * Begegnungen (docs/DESIGN_V2.md, Abschnitt 7): „Tier zieht ein“ und „Etwas keimt“.
 * Samen-Kosten und -Erträge sind vorerst fest – das Design koppelt sie später an die
 * Kosten der nächsten Pflanze (Ablehnen 25 %, Neu würfeln 50 % von 20 🌰).
 */

/** Karten je Begegnung (weniger, wenn nicht genug Arten in Frage kommen). */
export const CARDS_PER_ENCOUNTER = 3;

/**
 * Vorgegebene Begegnung (`nextEncounter` aus einem Ereignis): höchstens so viele Karten
 * kommen aus der Vorgabe, der Rest wird normal gezogen – so bleibt mindestens eine andere
 * Wahl, sofern eine andere Art bzw. Pflanze passt (Playtest Amphibien, DESIGN_V2.md 7.4).
 */
export const FORCED_MAX_CARDS = 2;

/** Höchstens so viele Begegnungen warten; überzählige werden automatisch abgelehnt. */
export const MAX_PENDING_ENCOUNTERS = 3;

/**
 * Ablehnen bringt die Samen von so vielen Sekunden (Samen-Sekunden wie bei Gästen und
 * Ereignissen, mindestens SEED_SECONDS_MIN_SEEDS aus events.ts) – auch beim
 * automatischen Ablehnen (Stapel voll, keine Karte). DESIGN_V2.md 7.9.
 */
export const DECLINE_SEED_SECONDS = 10;

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
 * (Reihenfolge wie ENCOUNTER_TYPES). Ereignisse (events.ts) ab Junger Baum, Gäste
 * (visitors.ts) ab Alter Baum – bewusst nur 10–20 % der Wegpunkte, damit sie keine
 * Tierbegegnungen verdrängen; ab dem Hain kommt der Zwischenhalt dazu (unten,
 * DESIGN_V2.md 7.2). Kommt für Ereignis bzw. Gast kein Kandidat in Frage, gibt es
 * stattdessen ein Tier (sonst eine Pflanze).
 */
export const ENCOUNTER_WEIGHTS: readonly (readonly [number, number, number, number])[] = [
  [60, 40, 0, 0], // Samen
  [60, 40, 0, 0], // Keimling
  [60, 40, 0, 0], // Setzling
  [65, 25, 10, 0], // Junger Baum
  [60, 20, 10, 10], // Alter Baum
  [60, 20, 10, 10], // Hain
  [60, 20, 10, 10], // Wald
  [60, 20, 10, 10], // Urwald
];

/**
 * Ist der Pflanzring voll, keimt seltener etwas („im Schatten der Begleitpflanzen“):
 * Das Gewicht von „Etwas keimt“ wird mit diesem Faktor multipliziert. Grund: Mit vollem
 * Ring kann eine Pflanzenkarte nur noch ersetzen und lohnt sich oft nicht (Playtest:
 * lange Strecken ohne lohnende Wahl, DESIGN_V2.md 7.7).
 */
export const PLANT_WEIGHT_RING_FULL = 0.5;

/**
 * Gewicht einer Pflanzenkarte, deren Pflanze schon im Ring wächst (sonst 1). Neue Arten
 * im Ring sind meist die lohnendere und abwechslungsreichere Wahl; Duplikate bleiben
 * möglich (DESIGN_V2.md 7.7).
 */
export const PLANT_WEIGHT_IN_RING = 0.35;

/** Die ersten Begegnungen sind festgelegt (Einführung): Wegpunkt 1, 2, 3 … */
export const SCRIPTED_ENCOUNTERS: readonly EncounterType[] = ['animal', 'plant', 'animal'];

/**
 * Zwischenhalt (Schritt 2.4, DESIGN_V2.md 7.2): Ab dieser Stufe kann auf halbem Weg
 * zwischen zwei Wegpunkten zusätzlich ein Ereignis oder ein Gast kommen – zusätzlich zur
 * Begegnung am Wegpunkt, ohne eine Tier- oder Pflanzenbegegnung zu verdrängen. Grund:
 * Nach dem Hain wird der Takt lang (~4,5 min) und volle Nischen erlauben nur noch
 * Tausch; die längsten Strecken ohne lohnende Wahl lagen im Wald bei 12 min (90 %).
 */
export const INTERLUDE_STAGE = 5;

/**
 * Lage des Zwischenhalts als Anteil des Wachstums zwischen Wegpunkt k und k+1:
 * Schwelle = thr(k) + INTERLUDE_POSITION · (thr(k+1) − thr(k)). Hängt nur vom
 * Gesamt-Wachstum ab – online und offline gleich.
 */
export const INTERLUDE_POSITION = 0.5;

/**
 * Wahrscheinlichkeit, dass am Zwischenhalt etwas kommt (Zufall des Spielstands). Seit dem
 * Balancing 2.10 0,7 statt 0,5: Mit der gestreckten Wegpunkt-Kurve wurde die längste
 * Strecke ohne lohnende Wahl im Hain (90 %) 11:15 min lang, mit 0,7 sind es 9:16 min.
 */
export const INTERLUDE_CHANCE = 0.7;

/**
 * Gewichte [Ereignis, Durchreisende] am Zwischenhalt. Kommt für einen Typ nichts in Frage
 * (alle schon gesehen oder Bedingungen nicht erfüllt), gilt der andere; sonst passiert
 * nichts (kein Samen-Ausgleich – es fehlt ja keine Begegnung).
 */
export const INTERLUDE_WEIGHTS: readonly [number, number] = [55, 45];
