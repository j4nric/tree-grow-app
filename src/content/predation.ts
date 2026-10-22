import type { GameEvent } from './events';
import type { SeasonId } from './seasons';
import type { W3Effect, W3Tag } from './habitats';
import type { WeatherId } from './weather';

/**
 * Räuber und Beute (docs/DESIGN_V2.md 22, Phase 6 Welle 3). Reine Daten und Zahlen – die
 * Logik (Bestand, Überjagung, Bedingung `unhunted`, Wetter-Gewichte) steht in
 * `core/formulas.ts` (evaluateEcosystem, speciesAppears) und `core/tick.ts` (eventWeight).
 *
 * Verdrahtet (Schritt A und C, 22.8): Bestand, Überjagung, die vier Massenjahre (in
 * `EVENTS` und `EVENT_SEASONS`) und die Wetter-Gewichte. **Noch nicht verdrahtet**
 * (Schritt B mit Spielstand v13, 23.7): die Ergänzungen an vorhandenen Arten
 * (`PROVIDES_ADDITIONS`, `FOOD_ADDITIONS`, `EFFECT_ADDITIONS`) – ihre Beute bzw. ihr
 * Jäger lebt erst in den neuen Lebensräumen (Wildkaninchen, Ringelnatter). Inhaltstest:
 * `tests/habitats.test.ts`.
 */

// ---------------------------------------------------------------------------
// Bestand und Überjagung (22.3, 22.4)
// ---------------------------------------------------------------------------

/**
 * Bestand einer Beute-Art = STOCK_BASE + STOCK_RANGE · z⁰ (z⁰ = ihre Zufriedenheit ohne
 * Räuberdruck): 0,5 (kümmerlich) … 1,5 (reichlich). Eine zufriedene Wühlmaus ernährt
 * anderthalb Jäger. Ersetzt `SUPPLY_ANIMAL` (fest 1) als Futterangebot eines Tiers.
 */
export const STOCK_BASE = 0.5;
export const STOCK_RANGE = 1;
/** Anzeige: Bestand < 0,85 „knapp“, ≥ 1,25 „reichlich“, dazwischen „gut“. */
export const STOCK_LOW = 0.85;
export const STOCK_HIGH = 1.25;

/**
 * Überjagung statt Räuberdruck: Eine Beute verliert Zufriedenheit nur, wenn mehr Jäger ein
 * Merkmal fressen, als Bestand da ist – je fehlender Einheit OVERHUNT_PENALTY, höchstens
 * OVERHUNT_MAX_UNITS Einheiten (wie bisher höchstens −20 %).
 */
export const OVERHUNT_PENALTY = 0.1;
export const OVERHUNT_MAX_UNITS = 2;

// ---------------------------------------------------------------------------
// Neue Jagdbeziehungen zwischen vorhandenen Arten (22.2)
// ---------------------------------------------------------------------------

/** Zusätzliche `provides` vorhandener Arten (species.ts): Amphibien sind Futter der Ringelnatter. */
export const PROVIDES_ADDITIONS: Readonly<Record<string, readonly W3Tag[]>> = {
  toad: ['amphibien'],
  frog: ['amphibien'],
  newt: ['amphibien'],
  treefrog: ['amphibien'],
  crestednewt: ['amphibien'],
};

/** Zusätzliche Nahrung vorhandener Arten: Der Fuchs jagt auch Kaninchen. */
export const FOOD_ADDITIONS: Readonly<Record<string, readonly W3Tag[]>> = {
  fox: ['hasen'],
};

/** Zusätzliche Wirkungen vorhandener Arten (Summary in species.ts mit anpassen). */
export const EFFECT_ADDITIONS: Readonly<Record<string, readonly W3Effect[]>> = {
  fox: [{ kind: 'control', tag: 'hasen', pct: 70 }],
};

// ---------------------------------------------------------------------------
// Massenjahre: Beute ohne Jäger ruft ihre Jäger (22.5)
// ---------------------------------------------------------------------------

/**
 * Vier Ereignisse mit Wahl, die nur kommen, wenn eine Beute im Ökosystem lebt, die kein
 * Tier frisst oder klein hält (`unhunted`). Eine Option lädt die passenden Jäger ein (nächste Begegnung),
 * die andere nimmt das Massenjahr als Geschenk. Keine Option ist eine Strafe.
 *
 * Stand Schritt A (ohne Lebensräume): Schritt B ergänzt die Einladungen um Mauswiesel
 * (Mäusejahr) und Blindschleiche (Schneckenjahr) und das Käferjahr um „+1 Platz
 * Totholzhaufen (Zyklus)“ (Tabelle in DESIGN_V2.md 22.5).
 */
export const PREDATION_EVENTS: readonly GameEvent[] = [
  {
    id: 'caterpillar-year', name: 'Raupenjahr', icon: '🐛', minStage: 4,
    text: 'Fraßgeräusche in der Krone – Raupenkot rieselt wie feiner Regen.',
    appears: [{ kind: 'unhunted', tag: 'raupen' }],
    options: [
      {
        label: 'Meisen und Ameisen einladen', summary: 'nächste Begegnung: Raupenjäger',
        effects: [{ kind: 'nextEncounter', type: 'animal', ids: ['bluetit', 'woodant'] }],
      },
      {
        label: 'Den Kot düngen lassen', summary: '+25 % 🌿 für 5 min',
        effects: [{ kind: 'timed', seconds: 300, effect: { kind: 'growth', pct: 25 } }],
      },
    ],
  },
  {
    id: 'vole-year', name: 'Mäusejahr', icon: '🐭', minStage: 4,
    text: 'Unter dem Laub raschelt es überall – die Mäuse haben ein gutes Jahr.',
    appears: [{ kind: 'unhunted', tag: 'kleinsaeuger' }],
    options: [
      {
        label: 'Sitzwarten für Jäger lassen', summary: 'nächste Begegnung: Mäusejäger',
        effects: [{ kind: 'nextEncounter', type: 'animal', ids: ['owl', 'fox'] }],
      },
      {
        label: 'Vorräte anlegen lassen', summary: '+40 % 🌰 für 6 min',
        effects: [{ kind: 'timed', seconds: 360, effect: { kind: 'seeds', pct: 40 } }],
      },
    ],
  },
  {
    id: 'beetle-year', name: 'Käferjahr', icon: '🪲', minStage: 5,
    text: 'Die Käfer schwärmen – an der Rinde rieselt braunes Bohrmehl.',
    appears: [{ kind: 'unhunted', tag: 'kaefer' }],
    options: [
      {
        label: 'Spechte anlocken', summary: 'nächste Begegnung: Spechte',
        effects: [{ kind: 'nextEncounter', type: 'animal', ids: ['woodpecker', 'blackwoodpecker'] }],
      },
      {
        label: 'Das Holz vermodern lassen', summary: 'Totholz (Zyklus)',
        effects: [{ kind: 'habitat', tag: 'totholz' }],
      },
    ],
  },
  {
    id: 'slug-year', name: 'Schneckenjahr', icon: '🐌', minStage: 4,
    text: 'Nach dem warmen Regen glänzen überall Schleimspuren im Moos.',
    appears: [{ kind: 'unhunted', tag: 'schnecken' }],
    options: [
      {
        label: 'Schneckenjäger einladen', summary: 'nächste Begegnung: Schneckenjäger',
        effects: [{ kind: 'nextEncounter', type: 'animal', ids: ['hedgehog', 'glowworm'] }],
      },
      {
        label: 'Die Feuchte genießen', summary: '+2 💧 (Zyklus)',
        effects: [{ kind: 'cycle', effect: { kind: 'water', amount: 2 } }],
      },
    ],
  },
];

/** Jahreszeiten der Massenjahre (EVENT_SEASONS in seasons.ts). */
export const PREDATION_EVENT_SEASONS: Readonly<Record<string, readonly SeasonId[]>> = {
  'caterpillar-year': ['spring', 'summer'], // Raupen fressen im Mai und Juni
  'vole-year': ['summer', 'autumn'], // nach einem Mastjahr: im Herbst wimmelt es
  'beetle-year': ['summer'], // Schwärmzeit in warmen, trockenen Sommern
  'slug-year': ['spring', 'autumn'], // nasse, milde Wochen
};

// ---------------------------------------------------------------------------
// Wetter → Begegnungen (22.6, nach der Wetter-Logik aus 21)
// ---------------------------------------------------------------------------

/**
 * Gewicht eines Ereignisses beim Ziehen, wenn am Tag des Wegpunkts bzw. Zwischenhalts
 * dieses Wetter herrscht (`weatherOfDay`, auch offline); fehlt der Eintrag: 1. Nur Gewichte –
 * kein Ereignis kommt dadurch außerhalb seiner Jahreszeit oder Bedingung, und jedes bleibt
 * einmal pro Zyklus.
 */
export const WEATHER_EVENT_FACTORS: Readonly<Partial<Record<WeatherId, Readonly<Record<string, number>>>>> = {
  rain: { 'toad-migration': 3, rain: 2, 'slug-year': 2, 'mushroom-autumn': 2 },
  storm: { storm: 3, windthrow: 3 },
  drought: { 'beetle-year': 3, heatwave: 2 },
  frost: { 'late-frost': 3, 'snow-break': 2 },
  fog: { 'mushroom-autumn': 2 },
  sun: { midsummer: 2, 'bee-swarm': 2 },
  snow: { 'snow-break': 2 },
};
