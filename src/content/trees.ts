import type { SiteId } from './landscape';
import type { HappinessEffect } from './seasons';
import type { Effect, Tag } from './types';

/**
 * Arten des Hauptbaums (docs/DESIGN_V2.md, Abschnitt 17). Reine Daten; die Logik steht in
 * src/core/formulas.ts (Merkmale, Eigenheiten) und tick.ts (unlockedTrees, startNewCycle).
 * Die Grafik nutzt dieselben IDs (`SceneInput.mainTree`, src/render/plant.ts, TREE_SPECIES).
 *
 * Regeln:
 * - Der erste Zyklus beginnt immer mit der Stieleiche.
 * - Eine Art ist freigeschaltet, sobald ihre Begleitpflanze `unlockPlant` im
 *   Naturtagebuch steht (`meta.journal.plants`, d. h. sie ist einmal im Pflanzring
 *   gewachsen): Aus ihren Samen kann der nächste Hauptbaum keimen. Kein neues Feld nötig.
 * - Arten der Landschaft (seit v15, DESIGN_V2.md 25.2) haben stattdessen `unlockSite`: Sie
 *   sind wählbar, sobald ihr Standort gegründet ist (`meta.landscape.sites`), und vor der
 *   Freischaltung der Landschaft verborgen (core/tick.ts, isTreeVisible).
 * - Gewählt wird beim Neuen Zyklus; die Wahl gilt für den ganzen Zyklus (`cycle.mainTree`).
 * - Jede Art hat eine kleine, klare Eigenheit – ein Gewinn und höchstens ein Verzicht.
 *   Keine ist „die beste“: Eiche für Vielfalt, Buche für Pilze und Bodenleben, Kiefer
 *   für Licht, Blüten und Insekten (Simulation DESIGN_V2.md 17.4).
 * - Grundwachstum und -samen je Stufe (STAGES) sind für alle Arten gleich.
 */

/** IDs wie `TreeSpecies` im Renderer. */
export type MainTreeId = 'oak' | 'beech' | 'pine' | 'fir' | 'alder';
export const MAIN_TREE_IDS: readonly MainTreeId[] = ['oak', 'beech', 'pine', 'fir', 'alder'];

/** Startbaum des ersten Zyklus und Rückfall für unbekannte Werte. */
export const DEFAULT_MAIN_TREE: MainTreeId = 'oak';

/**
 * Dauerhafte Wirkung der Art (Faktor 1, nicht mit Zufriedenheit skaliert), ab
 * `minStage` (Index in STAGES) bis zum Ende des Zyklus:
 * - `slot`: zusätzliche Plätze in einer Nische, sobald sie offen ist (wie Zyklus-Boni).
 * - `light` / `water`: Licht bzw. Wasser für die Begleitpflanzen (negativ = Verzicht).
 * - `groupGrowth` / `groupSeeds` (%): Bonus auf eine Pflanzengruppe.
 * - `happiness`: Zufriedenheit einer Gattung (neuer Typ, seasons.ts).
 */
export type TreeEffect =
  | Extract<Effect, { kind: 'slot' | 'light' | 'water' | 'groupGrowth' | 'groupSeeds' }>
  | HappinessEffect;

export interface TreeTrait {
  /** Ab dieser Stufe (Index in STAGES). Verzichte erst, wenn der Baum groß genug ist. */
  minStage: number;
  effect: TreeEffect;
}

export interface MainTree {
  id: MainTreeId;
  /** Name im Spiel (Artname). */
  name: string;
  icon: string;
  /** Frucht, aus der der Baum beim Neuen Zyklus keimt („Aus einer Buchecker …“). */
  fruit: string;
  /** Stimmungstext (ein Satz). */
  text: string;
  /** Eigenheit in Kurzform für die Auswahl beim Neuen Zyklus. */
  summary: string;
  /**
   * Begleitpflanze (plants.ts), die im Naturtagebuch stehen muss, damit die Art wählbar
   * ist. null = immer wählbar.
   */
  unlockPlant: string | null;
  /**
   * Standort der Landschaft (landscape.ts), der gegründet sein muss, damit die Art wählbar
   * ist (DESIGN_V2.md 25.2). Fehlt es, zählt nur `unlockPlant`. Der Standort hat diese Art
   * als Leitbaum (`leadTree`, Inhaltstest).
   */
  unlockSite?: SiteId;
  /** Hinweis für die gesperrte Auswahl (ohne Spoiler: die Pflanze bzw. der Standort ist bekannt). */
  unlockHint: string;
  /** Merkmale, die der Hauptbaum bereitstellt (je SUPPLY_MAIN_TREE). */
  tags: readonly Tag[];
  /** Ab dieser Stufe stellt er zusätzlich Nüsse bereit (Eicheln, Bucheckern); null = nie. */
  nutsFromStage: number | null;
  /** Eigenheiten der Art. */
  traits: readonly TreeTrait[];
  /** Winterfest: Abzüge der Jahreszeiten (negative Zahlen in SEASONS) gelten nicht. */
  winterHardy: boolean;
}

export const MAIN_TREES: readonly MainTree[] = [
  {
    id: 'oak', name: 'Stieleiche', icon: '🌳', fruit: 'Eichel',
    text: 'Keine Baumart beherbergt mehr Leben – in ihrer Krone wimmelt es.',
    summary: 'Ausgewogen · Eicheln ab Alter Baum · +1 Platz Krone · Insekten +10 % 😊',
    unlockPlant: null,
    unlockHint: '',
    tags: ['laub', 'wurzeln'],
    nutsFromStage: 4,
    // Eichen beherbergen mehr Insekten als jede andere Baumart, die Krone ist voller Leben.
    traits: [
      { minStage: 3, effect: { kind: 'slot', niche: 'crown', amount: 1 } },
      { minStage: 0, effect: { kind: 'happiness', genus: 'insects', points: 10 } },
    ],
    winterHardy: false,
  },
  {
    id: 'beech', name: 'Rotbuche', icon: '🍂', fruit: 'Buchecker',
    text: 'Unter ihrem dichten Dach ist es kühl und feucht – ein Paradies für Pilze und Moose.',
    summary: 'Schattig · Pilze +15 % 😊 · ab Alter Baum: Bucheckern, +1 Platz Wurzelraum, −2 ☀️',
    unlockPlant: 'beech',
    unlockHint: 'Lass einmal eine Rotbuche im Pflanzring wachsen.',
    tags: ['laub', 'wurzeln'],
    nutsFromStage: 4,
    traits: [
      // Buchenwurzeln sind dicht von Pilzfäden umsponnen (Mykorrhiza) – das weite
      // Wurzelwerk trägt erst der große Baum. Ab Keimling war die Buche für Wachstums-
      // Spieler 7 % schneller als die Eiche (Schritt 2.10, DESIGN_V2.md 15.4).
      { minStage: 4, effect: { kind: 'slot', niche: 'roots', amount: 1 } },
      { minStage: 0, effect: { kind: 'happiness', genus: 'fungi', points: 15 } },
      // Die Krone schließt sich erst, wenn der Baum groß ist – vorher kein Verzicht.
      { minStage: 4, effect: { kind: 'light', amount: -2 } },
    ],
    winterHardy: false,
  },
  {
    id: 'pine', name: 'Waldkiefer', icon: '🌲', fruit: 'Kiefernsamen',
    text: 'Genügsam und immergrün – durch ihre lichte Krone fällt die Sonne bis auf den Boden.',
    summary: 'Lichtbaum · winterfest · Nadeln · +1 ☀️, +1 💧 · keine Nüsse',
    unlockPlant: 'pine',
    unlockHint: 'Lass einmal eine Waldkiefer im Pflanzring wachsen.',
    // Nadelstreu zählt wie bei der Begleit-Kiefer auch als Laub (Futter der Zersetzer).
    tags: ['laub', 'wurzeln', 'nadeln'],
    nutsFromStage: null,
    traits: [
      { minStage: 0, effect: { kind: 'light', amount: 1 } },
      // „Genügsam“: Der Hauptbaum braucht kaum Wasser – mehr bleibt für die Begleitpflanzen.
      { minStage: 0, effect: { kind: 'water', amount: 1 } },
    ],
    winterHardy: true,
  },
  // --- Landschaft (seit v15, DESIGN_V2.md 25.3) ------------------------------
  {
    id: 'fir', name: 'Weißtanne', icon: '🎄', fruit: 'Tannensamen',
    text: 'Geduldig wächst sie im Schatten der Buchen – und überragt sie am Ende alle.',
    summary: 'Schattenbaum · winterfest · Nadeln · Vögel +10 % 😊 · +1 Platz Stamm & Rinde · ab Alter Baum −1 ☀️ · keine Nüsse',
    unlockPlant: null,
    unlockSite: 'mountain',
    unlockHint: 'Gründe den Bergmischwald – dort keimt sie.',
    // Nadelstreu zählt wie bei der Kiefer auch als Laub; die geflügelten Samen sind keine Nüsse.
    tags: ['laub', 'wurzeln', 'nadeln'],
    nutsFromStage: null,
    traits: [
      // Tannen- und Haubenmeise, Goldhähnchen leben in ihren Zweigen.
      { minStage: 0, effect: { kind: 'happiness', genus: 'birds', points: 10 } },
      // Flechten auf der glatten Borke.
      { minStage: 3, effect: { kind: 'slot', niche: 'bark', amount: 1 } },
      // Schattbaum: Die dichte Krone schließt sich erst, wenn der Baum groß ist.
      { minStage: 4, effect: { kind: 'light', amount: -1 } },
    ],
    winterHardy: true,
  },
  {
    id: 'alder', name: 'Schwarzerle', icon: '🌿', fruit: 'Erlensamen',
    text: 'Sie steht mit den Füßen im Wasser – und ihre Wurzeln düngen den Boden.',
    summary: 'Nassbaum · Amphibien +10 % 😊 · Blumen +15 % 🌿 · ab Junger Baum +1 Platz Waldtümpel · keine Nüsse',
    unlockPlant: null,
    unlockSite: 'carr',
    unlockHint: 'Gründe den Erlenbruch – dort keimt sie.',
    tags: ['laub', 'wurzeln'],
    nutsFromStage: null,
    traits: [
      { minStage: 0, effect: { kind: 'happiness', genus: 'amphibians', points: 10 } },
      // Stickstoff aus den Wurzelknöllchen (Frankia): Sumpfdotterblume und Mädesüß blühen üppig.
      { minStage: 0, effect: { kind: 'groupGrowth', group: 'flowers', pct: 15 } },
      // Tümpel zwischen den Stelzwurzeln – der Waldtümpel öffnet sich ohne Pflege (opensEarly).
      { minStage: 3, effect: { kind: 'slot', niche: 'pond', amount: 1 } },
    ],
    winterHardy: false,
  },
];

export const MAIN_TREES_BY_ID: ReadonlyMap<MainTreeId, MainTree> = new Map(MAIN_TREES.map((t) => [t.id, t]));
