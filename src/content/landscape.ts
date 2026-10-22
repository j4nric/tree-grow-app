import type { TreeTrait, MainTreeId } from './trees';
import type { Genus, Tag } from './types';

/**
 * Waldlandschaft – die Prestige-Ebene über dem Neuen Zyklus (docs/DESIGN_V2.md, Abschnitt
 * 24). Reine Daten, verdrahtet seit Spielstand v14 (Schritt A, 24.8): Regeln in
 * src/core/landscape.ts, Aktionen in core/tick.ts, Laden in core/save.ts. Gemessen mit
 * scripts/landscape.ts (24.10), Invarianten in tests/landscape.test.ts.
 *
 * Kurzfassung:
 * - Sechs Standorte rund um den Heimatwald. Jeder Standort ist ein eigener Wald mit eigenem
 *   Waldgedächtnis (je höchstens MAX_FOREST_MEMORY) und einem Waldtyp mit Eigenheit
 *   (Gewinn und Verzicht, nur dort) und Gabe (wirkt in allen Wäldern, sobald er gegründet ist).
 * - Währung 🪶 Hähersaat: verdient, nicht gesammelt – 1 je volle 100 Punkte eigenes
 *   Waldgedächtnis je Wald, +2 für den ersten Urwald je Wald. Ausgegeben für neue Wälder
 *   und Korridore. Die Summe ist begrenzt (MAX_JAY_SEEDS), es gibt nichts zu farmen.
 * - Korridore verbinden zwei Wälder: Ein Anteil des Gedächtnisses der Nachbarn fließt zu
 *   (Wildwechsel), das wirksame Gedächtnis bleibt bei MAX_FOREST_MEMORY gedeckelt.
 *   Kein neuer Multiplikator – die Zahlen bleiben in der Größenordnung von heute (24.9).
 */

export type SiteId = 'home' | 'floodplain' | 'carr' | 'beechwood' | 'mountain' | 'heath';
export const SITE_IDS: readonly SiteId[] = ['home', 'floodplain', 'carr', 'beechwood', 'mountain', 'heath'];

/** Der Standort des bisherigen Spiels (Migration v13 → v14). */
export const HOME_SITE: SiteId = 'home';

export interface ForestSite {
  id: SiteId;
  /** Name des Waldes in der Landschaft. */
  name: string;
  /** Waldtyp (botanisch), für Tooltip und Tagebuch. */
  forestType: string;
  icon: string;
  /** Stimmungstext (ein bis zwei Sätze). */
  text: string;
  /** Eigenheit in Kurzform für die Karte der Landschaft. */
  summary: string;
  /**
   * Leitbaum: Diese Hauptbaum-Art ist beim ersten Zyklus dort vorausgewählt (falls
   * freigeschaltet; eine Art mit `unlockSite` schaltet die Gründung im selben Schritt frei).
   * Keine Pflicht – jede freigeschaltete Art darf wachsen. null = Eiche.
   */
  leadTree: MainTreeId | null;
  /**
   * Eigenheit: wirkt nur, solange hier der aktive Wald wächst – wie die Eigenheiten der
   * Hauptbaum-Arten (gleiche Typen, gleiche Logik, ab `minStage`).
   */
  traits: readonly TreeTrait[];
  /** Merkmale, die der Standort immer bereitstellt (je 1 Einheit, wie `cycle.habitats`). */
  habitats: readonly Tag[];
  /** Gattungen, die hier häufiger als Karte kommen (Gewicht × FEATURED_GENUS_WEIGHT in ihrer Seltenheit). */
  featured: readonly Genus[];
  /**
   * Gabe: wirkt in **allen** Wäldern der Landschaft, sobald dieser Wald gegründet ist
   * (auch im Heimatwald). Klein und ohne Multiplikator.
   */
  gift: TreeTrait | null;
  /** Kurztext der Gabe. */
  giftSummary: string;
  /** Lage auf der Landschaftskarte (0–1, x nach rechts, y nach unten). */
  position: { x: number; y: number };
}

export type CorridorKind = 'hedge' | 'stream' | 'path' | 'ravine' | 'bridge';

export interface Corridor {
  id: string;
  /** Die beiden verbundenen Standorte (Reihenfolge egal). */
  sites: readonly [SiteId, SiteId];
  kind: CorridorKind;
  name: string;
  /** Kosten in Hähersaat. */
  cost: number;
  text: string;
}

export const LANDSCAPE_SITES: readonly ForestSite[] = [
  {
    id: 'home', name: 'Heimatwald', forestType: 'Eichen-Hainbuchenwald', icon: '🌳',
    text: 'Hier hat alles begonnen: Eichen und Hainbuchen, im Frühling ein Teppich aus Buschwindröschen.',
    summary: 'Ausgewogen – der Wald, den du kennst.',
    leadTree: null,
    traits: [],
    habitats: [],
    featured: [],
    gift: null,
    giftSummary: '–',
    position: { x: 0.5, y: 0.5 },
  },
  {
    id: 'floodplain', name: 'Auwald am Fluss', forestType: 'Hartholzaue', icon: '🌊',
    text: 'Stieleichen, Eschen und Ulmen am Fluss. Jedes Frühjahr steigt das Wasser – und lässt fruchtbaren Schlick zurück.',
    summary: 'Feuchte · +2 💧 · ab Junger Baum +2 Plätze Waldtümpel · Pilze −15 % 😊',
    leadTree: null,
    traits: [
      { minStage: 0, effect: { kind: 'water', amount: 2 } },
      // Altwasser und Flutmulden: der Tümpel ist schon da, er muss nicht angelegt werden.
      { minStage: 3, effect: { kind: 'slot', niche: 'pond', amount: 2 } },
      // Das Hochwasser spült die Streu fort – das Pilzgeflecht kommt kaum hinterher.
      { minStage: 0, effect: { kind: 'happiness', genus: 'fungi', points: -15 } },
    ],
    habitats: ['feucht'],
    featured: ['amphibians', 'birds'],
    gift: { minStage: 4, effect: { kind: 'slot', niche: 'pond', amount: 1 } },
    giftSummary: 'Ab Alter Baum +1 Platz Waldtümpel in allen Wäldern – Kröten wandern den Bach hinauf.',
    position: { x: 0.85, y: 0.35 },
  },
  {
    id: 'carr', name: 'Erlenbruch', forestType: 'Schwarzerlen-Bruchwald', icon: '🌫️',
    text: 'Schwarzerlen auf nassen Bulten, dazwischen Torfmoos und Sumpfdotterblumen. Das Wasser steht hier fast das ganze Jahr.',
    summary: 'Feuchte · Moose & Farne +30 % 🌿 · ab Alter Baum +1 Platz Waldtümpel · Bodenleben −10 % 😊',
    leadTree: 'alder',
    traits: [
      { minStage: 0, effect: { kind: 'groupGrowth', group: 'mosses', pct: 30 } },
      { minStage: 4, effect: { kind: 'slot', niche: 'pond', amount: 1 } },
      // Staunasser, sauerstoffarmer Boden: Regenwürmer und Asseln meiden ihn.
      { minStage: 0, effect: { kind: 'happiness', genus: 'soil', points: -10 } },
    ],
    habitats: ['feucht'],
    featured: ['amphibians', 'fungi'],
    gift: { minStage: 0, effect: { kind: 'happiness', genus: 'amphibians', points: 5 } },
    giftSummary: 'Amphibien +5 % 😊 in allen Wäldern – im Bruch laichen sie sicher.',
    position: { x: 0.75, y: 0.8 },
  },
  {
    id: 'beechwood', name: 'Buchenhallen', forestType: 'Hallenbuchenwald', icon: '🍂',
    text: 'Glatte graue Stämme wie Säulen, darüber ein geschlossenes Dach. Der Boden blüht im Frühling, bevor das Laub austreibt.',
    summary: 'Vögel +10 % 😊 · ab Alter Baum +1 Platz Höhlen & Totholz · Blumen −15 % 🌰',
    leadTree: 'beech',
    traits: [
      { minStage: 0, effect: { kind: 'happiness', genus: 'birds', points: 10 } },
      // Alte Buchen: Der Schwarzspecht zimmert hier am liebsten.
      { minStage: 4, effect: { kind: 'slot', niche: 'hollows', amount: 1 } },
      // Unter dem geschlossenen Dach blüht im Sommer kaum etwas (das Licht nimmt schon die Rotbuche).
      { minStage: 0, effect: { kind: 'groupSeeds', group: 'flowers', pct: -15 } },
    ],
    habitats: [],
    featured: ['birds', 'fungi'],
    gift: { minStage: 5, effect: { kind: 'slot', niche: 'hollows', amount: 1 } },
    giftSummary: 'Ab Hain +1 Platz Höhlen & Totholz in allen Wäldern – Spechte streifen weit umher.',
    position: { x: 0.15, y: 0.35 },
  },
  {
    id: 'mountain', name: 'Bergmischwald', forestType: 'Buchen-Tannen-Fichtenwald', icon: '⛰️',
    text: 'Buche, Tanne und Fichte am Hang. Kühle Luft, viel Regen – und im Winter liegt der Schnee lange.',
    summary: '+2 💧 · ab Junger Baum +1 Platz Krone · Säugetiere +10 % 😊 · Insekten −15 % 😊',
    leadTree: 'fir',
    traits: [
      // Steigungsregen: Am Hang regnet es mehr.
      { minStage: 0, effect: { kind: 'water', amount: 2 } },
      { minStage: 3, effect: { kind: 'slot', niche: 'crown', amount: 1 } },
      { minStage: 0, effect: { kind: 'happiness', genus: 'mammals', points: 10 } },
      // Kühles Klima: weniger warme Tage für Falter und Bienen.
      { minStage: 0, effect: { kind: 'happiness', genus: 'insects', points: -15 } },
    ],
    habitats: [],
    featured: ['mammals', 'birds'],
    gift: { minStage: 0, effect: { kind: 'water', amount: 1 } },
    giftSummary: '+1 💧 in allen Wäldern – Quellwasser aus den Bergen.',
    position: { x: 0.5, y: 0.12 },
  },
  {
    id: 'heath', name: 'Kiefernheide', forestType: 'Sand-Kiefernwald', icon: '🌲',
    text: 'Lichte Kiefern auf Sand, dazwischen Heidekraut und summende Wildbienen. Wasser ist knapp, Sonne gibt es reichlich.',
    summary: '+2 ☀️ · Blumen +10 % 🌰 · Insekten +10 % 😊 · −3 💧, Bodenleben −10 % 😊',
    leadTree: 'pine',
    traits: [
      { minStage: 0, effect: { kind: 'light', amount: 2 } },
      { minStage: 0, effect: { kind: 'groupSeeds', group: 'flowers', pct: 10 } },
      { minStage: 0, effect: { kind: 'happiness', genus: 'insects', points: 10 } },
      // Sandboden hält kein Wasser – Regenwürmer und Asseln finden kaum Feuchte.
      { minStage: 0, effect: { kind: 'water', amount: -3 } },
      { minStage: 0, effect: { kind: 'happiness', genus: 'soil', points: -10 } },
    ],
    habitats: [],
    featured: ['insects'],
    gift: { minStage: 0, effect: { kind: 'light', amount: 1 } },
    giftSummary: '+1 ☀️ in allen Wäldern – lichte Ränder wie in der Heide.',
    position: { x: 0.25, y: 0.8 },
  },
];

export const LANDSCAPE_SITES_BY_ID: ReadonlyMap<SiteId, ForestSite> = new Map(LANDSCAPE_SITES.map((s) => [s.id, s]));

/**
 * Korridore: fünf „Speichen“ vom Heimatwald (je 2 🪶) und ein Ring (3–5 🪶). Jeder neue Wald
 * liegt am Heimatwald – die Reihenfolge der Gründung ist frei.
 */
export const CORRIDORS: readonly Corridor[] = [
  { id: 'home-floodplain', sites: ['home', 'floodplain'], kind: 'stream', name: 'Mühlbach', cost: 2,
    text: 'Ein Bach mit Erlen am Ufer – Wanderweg für Kröten und Molche.' },
  { id: 'home-carr', sites: ['home', 'carr'], kind: 'stream', name: 'Wiesengraben', cost: 2,
    text: 'Ein Graben voller Kopfweiden zieht sich bis in den Bruch.' },
  { id: 'home-beechwood', sites: ['home', 'beechwood'], kind: 'hedge', name: 'Schlehenhecke', cost: 2,
    text: 'Dornig und dicht – Deckung für alles, was nicht übers offene Feld will.' },
  { id: 'home-mountain', sites: ['home', 'mountain'], kind: 'path', name: 'Hohlweg', cost: 2,
    text: 'Ein alter, tief eingeschnittener Weg den Hang hinauf, überwachsen von Hasel.' },
  { id: 'home-heath', sites: ['home', 'heath'], kind: 'hedge', name: 'Feldhecke', cost: 2,
    text: 'Weißdorn, Holunder und Brombeere – ein grünes Band über die Felder.' },
  { id: 'floodplain-carr', sites: ['floodplain', 'carr'], kind: 'stream', name: 'Altwasser', cost: 3,
    text: 'Ein abgeschnittener Flussarm, still und voller Leben.' },
  { id: 'carr-heath', sites: ['carr', 'heath'], kind: 'bridge', name: 'Grünbrücke', cost: 5,
    text: 'Über die Straße hinweg, bepflanzt mit Sträuchern – Rehe und Füchse nehmen sie gern.' },
  { id: 'heath-beechwood', sites: ['heath', 'beechwood'], kind: 'hedge', name: 'Wallhecke', cost: 3,
    text: 'Ein Erdwall mit Hecke darauf, so alt wie die Dörfer ringsum.' },
  { id: 'beechwood-mountain', sites: ['beechwood', 'mountain'], kind: 'path', name: 'Wildpfad', cost: 3,
    text: 'Ein schmaler Pfad am Hang, getreten von Generationen von Rehen.' },
  { id: 'mountain-floodplain', sites: ['mountain', 'floodplain'], kind: 'ravine', name: 'Bachschlucht', cost: 4,
    text: 'Der Bach aus den Bergen hat sich tief eingegraben – kühl, moosig, voller Farne.' },
];

export const CORRIDORS_BY_ID: ReadonlyMap<string, Corridor> = new Map(CORRIDORS.map((c) => [c.id, c]));

/**
 * Freischaltung (24.3): Der Erfolg „Uralt und voller Leben“ (einmal Urwald) und mindestens
 * so viel Waldgedächtnis im Heimatwald. Beides wird nie kleiner – abgeleitet, kein Feld.
 */
export const LANDSCAPE_UNLOCK_ACHIEVEMENT = 'ancient-forest';
export const LANDSCAPE_UNLOCK_MEMORY = 250;

/** 🪶 Hähersaat: 1 je volle so viele Punkte eigenes Waldgedächtnis eines Waldes. */
export const JAY_SEEDS_MEMORY_STEP = 100;
/** 🪶 Hähersaat für den ersten Urwald in einem Wald (je Wald einmal). */
export const JAY_SEEDS_FIRST_ANCIENT = 2;
/** Kosten des 2., 3., … 6. Waldes (Gründung nur aus einem Urwald, 24.4). */
export const FOUNDING_COSTS: readonly number[] = [3, 5, 7, 9, 11];

/**
 * Korridor-Zufluss: Anteil des eigenen Waldgedächtnisses eines verbundenen Nachbarn, der im
 * aktiven Wald mitzählt. Wirksam = min(MAX_FOREST_MEMORY, eigenes + Σ Anteil · Nachbar).
 */
export const CORRIDOR_INFLOW = 0.5;
/** Höchstens so viel Zufluss über alle Korridore zusammen – das eigene Gedächtnis zählt immer mit. */
export const CORRIDOR_INFLOW_CAP = 500;

/**
 * Wildwechsel-Karte: Je Korridor am aktiven Wald so viel Chance, dass eine Tierbegegnung eine
 * Karte aus dem Bestand eines Nachbarn zeigt, höchstens WILDWECHSEL_MAX_CHANCE.
 */
export const WILDWECHSEL_CHANCE = 0.1;
export const WILDWECHSEL_MAX_CHANCE = 0.3;
/** Höchstens so viele Tiere merkt sich ein ruhender Wald (sein Bestand für den Wildwechsel). */
export const MAX_SITE_FAUNA = 40;
/** Gewicht der Gattungen eines Waldtyps beim Ziehen (innerhalb ihrer Seltenheit). */
export const FEATURED_GENUS_WEIGHT = 1.5;

/**
 * Höchstens so viel Hähersaat kann es überhaupt geben (Prüfung beim Laden, Inhaltstest):
 * je Wald 10 (= MAX_FOREST_MEMORY 1000 / JAY_SEEDS_MEMORY_STEP, der Test prüft das) + 2.
 */
export const MAX_JAY_SEEDS = SITE_IDS.length * (10 + JAY_SEEDS_FIRST_ANCIENT);
