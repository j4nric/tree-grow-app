import type { DailyGoalKind } from '../content/daily';
import type { CycleEffect, ForcedEncounterType, TimedEffect } from '../content/events';
import type { SeasonId } from '../content/seasons';
import { HOME_SITE, type SiteId } from '../content/landscape';
import { DEFAULT_MAIN_TREE, type MainTreeId } from '../content/trees';
import { NICHE_IDS, type Genus, type NicheId, type Tag } from '../content/types';
import { normalizeSeed } from './rng';

/**
 * Spielstand v11 (v2-Spiel mit Begleitpflanzen, Neuem Zyklus, Ereignissen und Gästen,
 * Jahreszeiten und Hauptbaum-Arten; seit v7 mit der Wegpunkt-Kurve 3,5 · k^3,5 aus dem
 * Balancing 2.10; seit v8 mit der Langzeit-Statistik `meta.stats`; seit v9 mit den
 * Erfolgen `meta.achievements`; seit v10 mit der Sperrklinke `cycle.bestHarmonyMemory`;
 * seit v11 mit der Nische Waldtümpel `niches.pond` der Erweiterung Amphibien; seit v12 mit
 * den Tageszielen `meta.daily`; seit v13 mit den Lebensräumen `niches.meadow`,
 * `niches.deadwood` und `niches.wall`, DESIGN_V2.md 23.6; seit v14 mit der Waldlandschaft
 * `meta.landscape`, DESIGN_V2.md 24.8; seit v15 mit den Hauptbäumen der Landschaft `fir` und
 * `alder` in `MainTreeId`, der Wildwechsel-Markierung `PendingEncounter.via`, dem Zähler
 * `meta.stats.wildwechselChosen` und „Zuerst gesehen“ `meta.journal.firstSeen`, DESIGN_V2.md
 * 25.5, 24.6, 24.12, 25.10).
 * Reine Daten, JSON-serialisierbar – kein DOM, keine Klassen.
 * Abgeleitete Werte (Zufriedenheit, Harmonie, Raten) werden NICHT gespeichert, sondern
 * mit `evaluate(state)` berechnet.
 * Bei Änderungen am Format: SAVE_VERSION erhöhen und Migration in save.ts ergänzen.
 * Ausnahme ohne neue Version (Schritt 2.3): `meta.journal.plants` und
 * `meta.journal.communities` sind reine Ergänzungen; fehlen sie in einem v3-Stand,
 * ergänzt das Laden sie aus dem aktuellen Ökosystem (save.ts).
 */
export const SAVE_VERSION = 15;

/**
 * Obergrenze für das Waldgedächtnis beim Laden und Rechnen (+1 % je Punkt → höchstens
 * ×11). Schützt vor manipulierten oder kaputten Spielständen.
 */
export const MAX_FOREST_MEMORY = 1000;

/** Begegnungen mit Karten zum Auswählen (Tier- bzw. Pflanzenkarten, neu würfelbar). */
export type CardEncounterType = 'animal' | 'plant';

/** Alle Begegnungstypen (DESIGN_V2.md 7.1). */
export type PendingEncounterType = CardEncounterType | 'event' | 'visitor';

export interface PendingEncounter {
  /**
   * „Tier zieht ein“ (Karten = Art-IDs), „Etwas keimt“ (Karten = Pflanzen-IDs),
   * Ereignis (cards = [Ereignis-ID]) oder Durchreisende (cards = [Gast-ID]).
   */
  type: PendingEncounterType;
  /** IDs der angebotenen Karten (1–3, verschieden; bei Ereignis und Gast genau eine). */
  cards: string[];
  /** In dieser Begegnung schon neu gewürfelt (Ereignis und Gast: immer 0). */
  rerolls: number;
  /**
   * Wildwechsel (seit v15, DESIGN_V2.md 24.6): Karte `card` (Index in `cards`) kam über den
   * Korridor `corridor` (ID in CORRIDORS) aus dem Bestand eines Nachbarn. Nur bei
   * Tierbegegnungen, höchstens eine Karte; fehlt = keine Wildwechsel-Karte. Neu würfeln löscht es.
   */
  via?: { card: number; corridor: string };
}

/** Ist das eine Begegnung mit Tier- oder Pflanzenkarten? */
export function isCardEncounter(type: PendingEncounterType | undefined): type is CardEncounterType {
  return type === 'animal' || type === 'plant';
}

/** Zyklus-Bonus aus einer Ereignis-Option (`cycle`). */
export interface CycleBonus {
  /** Herkunft, z. B. „windthrow“ (Ereignis-ID). */
  source: string;
  effect: CycleEffect;
}

/** Zeit-Bonus aus einer Ereignis-Option (`timed`). */
export interface TimedBonus {
  source: string;
  effect: TimedEffect;
  /** Restdauer in Sekunden Spielzeit (> 0). */
  remaining: number;
}

/** Bewirteter Gast. Seine Wirkungen kommen aus VISITORS_BY_ID. */
export interface ActiveVisitor {
  id: string;
  /** Restdauer in Sekunden Spielzeit (> 0). */
  remaining: number;
}

/** Vorgabe für die nächste Begegnung (Ereignis-Option `nextEncounter`). */
export interface ForcedEncounter {
  type: ForcedEncounterType;
  ids: string[];
}

/**
 * Langzeit-Statistik über alle Zyklen (seit v8, DESIGN_V2.md 12.5) – Grundlage für
 * Erfolge. Nur Zahlen (endlich, ≥ 0; Zähler ganzzahlig) und eine kleine Liste. Wird nie
 * zurückgesetzt. Abgeschlossene Zyklen stehen schon in `cycle.number − 1`.
 */
export interface LifetimeStats {
  /** Spielzeit aller Zyklen in Sekunden (wie `cycle.elapsed`, online und offline gleich). */
  playSeconds: number;
  /**
   * Wachstum aller abgeschlossenen Zyklen (Summe ihrer `totalGrowth` beim Neuen Zyklus).
   * Gesamt-Wachstum über alle Zyklen = dieses Feld + `totalGrowth` (lifetimeGrowth).
   */
  completedCyclesGrowth: number;
  /** Höchste Harmonie aller Zyklen (wie `cycle.maxHarmony`, nie kleiner). */
  bestHarmony: number;
  /** Angenommene Begegnungen: Tier- oder Pflanzenkarte gewählt (chooseCard). */
  cardsChosen: number;
  /** Entschiedene Ereignisse (chooseEventOption). */
  eventsDecided: number;
  /** Bewirtete Gäste (hostVisitor). */
  visitorsHosted: number;
  /** Für Samen gesetzte Pflanzen (plantSeed; gekeimte zählen als Karte). */
  plantsPlanted: number;
  /** Gekaufte Pflege-Ränge (buyCare). */
  careRanksBought: number;
  /** Gewählte Wildwechsel-Karten (chooseCard mit `PendingEncounter.via`, seit v15). */
  wildwechselChosen: number;
  /** Hauptbaum-Arten, die schon einmal Hauptbaum waren (inkl. der aktuellen), je einmal. */
  grownTrees: MainTreeId[];
}

/** Wann eine Art oder Pflanze zuerst entdeckt wurde (Album, DESIGN_V2.md 25.10). */
export interface FirstSeen {
  /** Zyklus-Nummer (`cycle.number`, ganzzahlig ≥ 1). */
  cycle: number;
  /** Jahreszeit im Moment der Entdeckung. */
  season: SeasonId;
}

/** „Zuerst gesehen“ getrennt nach Tieren und Pflanzen (die IDs dürfen sich überschneiden). */
export interface FirstSeenJournal {
  species: Record<string, FirstSeen>;
  plants: Record<string, FirstSeen>;
}

/** Leeres „Zuerst gesehen“ (neues Spiel, Migration v14 → v15). */
export function createFirstSeen(): FirstSeenJournal {
  return { species: {}, plants: {} };
}

/** Startwerte der Langzeit-Statistik (alles 0, nur die erste Baumart ist gewachsen). */
export function createStats(mainTree: MainTreeId = DEFAULT_MAIN_TREE): LifetimeStats {
  return {
    playSeconds: 0,
    completedCyclesGrowth: 0,
    bestHarmony: 0,
    cardsChosen: 0,
    eventsDecided: 0,
    visitorsHosted: 0,
    plantsPlanted: 0,
    careRanksBought: 0,
    wildwechselChosen: 0,
    grownTrees: [mainTree],
  };
}

/** Belohnung eines Tagesziels: Samen-Sekunden oder eine Begegnung mit selteneren Arten. */
export type DailyReward = 'seeds' | 'rare';

/**
 * Ein Tagesziel (seit v12, DESIGN_V2.md 20). Die Parameter hängen von der Art ab (siehe
 * content/daily.ts); fehlende gelten als „nicht gebraucht“.
 */
export interface DailyGoal {
  kind: DailyGoalKind;
  /** Zielwert (> 0): Anzahl, Prozent, Sekunden, 🌿 bzw. 🌰. */
  target: number;
  /** Fortschritt (0 … target). Bei Zuständen der höchste gesehene Wert des Tages. */
  progress: number;
  /** Gattung (observe, satisfaction). */
  genus?: Genus;
  /** Jahreszeit (observe). */
  season?: SeasonId;
  /** Lebensgemeinschaft (community). */
  community?: string;
  /** Harmonie-Schwelle (harmony). */
  harmony?: number;
  reward: DailyReward;
  /** Erfüllt und belohnt (Belohnung kommt sofort, kein eigener Knopf). */
  done: boolean;
}

/**
 * Tagesziele und Serie (seit v12, DESIGN_V2.md 20). Gehört zu `meta`: überdauert den Neuen
 * Zyklus – die Ziele eines Tages bleiben auch nach einem Neustart des Baums dieselben.
 */
export interface DailyState {
  /** Fester Startwert je Spielstand (uint32 ≠ 0); Ziele = f(seed, Tag, Spielstand beim Tageswechsel). */
  seed: number;
  /** Tag der aktuellen Ziele („JJJJ-MM-TT“, lokale Zeit); '' = noch keine. */
  day: string;
  goals: DailyGoal[];
  /** Tage in Folge mit mindestens einem erfüllten Ziel (0 nach einer Lücke). */
  streak: number;
  bestStreak: number;
  /** Letzter Tag mit mindestens einem erfüllten Ziel ('' = noch nie). */
  lastDay: string;
  /** Erfüllte Ziele insgesamt. */
  goalsDone: number;
  /** Tage, an denen alle Ziele erfüllt wurden. */
  perfectDays: number;
}

/** Startwerte der Tagesziele: noch kein Tag, keine Serie. */
export function createDaily(seed: number): DailyState {
  return { seed: normalizeSeed(seed), day: '', goals: [], streak: 0, bestStreak: 0, lastDay: '', goalsDone: 0, perfectDays: 0 };
}

/**
 * Startwert der Tagesziele aus dem Startwert des Spiels: eigener, fester Wert (der
 * Zufallsgenerator `rngState` läuft im Spiel weiter und taugt dafür nicht).
 */
export function dailySeedOf(seed: number): number {
  return normalizeSeed((Math.floor(Math.abs(Number.isFinite(seed) ? seed : 0)) ^ 0x7a6e5d1c) >>> 0);
}

/**
 * Ein gegründeter Wald der Landschaft (seit v14, DESIGN_V2.md 24.8). Beim aktiven Wald
 * stehen Gedächtnis und Stammgäste in `meta.forestMemory` bzw. `meta.regulars` (eine
 * Wahrheit je Wert) – sein Eintrag hält dort 0 bzw. [].
 */
export interface LandscapeSite {
  id: SiteId;
  /** Ruhendes, eigenes Waldgedächtnis (0 … MAX_FOREST_MEMORY, ganzzahlig). Beim aktiven Wald 0. */
  memory: number;
  /** Geparkte Stammgäste. Beim aktiven Wald []. */
  regulars: string[];
  /** Hier wurde schon einmal der Urwald erreicht (gesetzt beim Neuen Zyklus). */
  ancient: boolean;
  /** Zuletzt hier gewachsene Hauptbaum-Art (Vorauswahl beim Wechsel, Bild in der Karte). */
  mainTree: MainTreeId;
  /** Bestand beim letzten Verlassen (Tier-IDs, höchstens MAX_SITE_FAUNA) – für den Wildwechsel. */
  fauna: string[];
}

/** Waldlandschaft (seit v14): überdauert jeden Neuen Zyklus. */
export interface LandscapeState {
  /** Wald, in dem der laufende Zyklus wächst (immer gegründet). */
  active: SiteId;
  /** Gegründete Wälder in Gründungs-Reihenfolge, der Heimatwald immer zuerst. */
  sites: LandscapeSite[];
  /** Gebaute Korridore (IDs aus CORRIDORS) in Bau-Reihenfolge, je einmal. */
  corridors: string[];
  /** Korridore, die mit einer Gründung kamen (kosten nichts; Teilmenge von `corridors`). */
  freeCorridors: string[];
  /**
   * Die Meldung zur Freischaltung (24.3) wurde gezeigt. Die UI zeigt sie, solange
   * `landscapeUnlocked(state) && !announced`, und ruft danach `markLandscapeAnnounced`.
   * So geht sie nicht verloren, auch wenn die Freischaltung ohne Karte (vor der UI) geschah.
   */
  announced: boolean;
}

/** Ein frisch gegründeter Wald (ohne Gedächtnis, ohne Stammgäste). */
export function createSite(id: SiteId, mainTree: MainTreeId = DEFAULT_MAIN_TREE): LandscapeSite {
  return { id, memory: 0, regulars: [], ancient: false, mainTree, fauna: [] };
}

/** Startwert der Landschaft: nur der Heimatwald, aktiv, keine Korridore. */
export function createLandscape(mainTree: MainTreeId = DEFAULT_MAIN_TREE): LandscapeState {
  return { active: HOME_SITE, sites: [createSite(HOME_SITE, mainTree)], corridors: [], freeCorridors: [], announced: false };
}

/** Der laufende Zyklus (DESIGN_V2.md, Abschnitt 10). Wird beim Neuen Zyklus neu angelegt. */
export interface CycleState {
  /** Nummer des Zyklus, ab 1. */
  number: number;
  /**
   * Höchste Harmonie dieses Zyklus (H_max, nie unter 0). Wird nach jeder Änderung am
   * Ökosystem nachgeführt (Karte wählen, Pflanze setzen, Stammgäste, Stufenwechsel, Laden).
   */
  maxHarmony: number;
  /**
   * „Sperrklinke“ der Vorschau (seit v10, DESIGN_V2.md 10): bester Harmonie-Anteil des
   * Waldgedächtnis-Gewinns in diesem Zyklus (harmonyMemoryGain aus H_max und Wegpunkt, ohne
   * neue Arten – die zählen ohnehin nur nach oben). Ganzzahlig, 0 … MAX_FOREST_MEMORY.
   * Wird an denselben Stellen wie H_max nachgeführt und nach jedem Wegpunkt; gezählt wird
   * max(gemerkt, aktuell). So sinkt die Vorschau nie, wenn die Schwelle mit dem Wegpunkt steigt.
   */
  bestHarmonyMemory: number;
  /** Arten, die in diesem Zyklus zum ersten Mal ins Naturtagebuch kamen (je einmal). */
  newSpecies: string[];
  /** Beginn des Zyklus (ms seit Epoch); fehlt bei Ständen aus der Zeit vor v4. */
  startedAt?: number;
  /** IDs der in diesem Zyklus gezogenen Ereignisse und Gäste (je höchstens einmal). */
  seen: string[];
  /** Wirkungen bis zum Neuen Zyklus (Ereignis-Option `cycle`). */
  bonuses: CycleBonus[];
  /** Merkmale aus Ereignissen (`habitat`), je 1 Einheit Angebot. */
  habitats: Tag[];
  /** Zeit-Boni mit Restdauer (Ereignis-Option `timed`). */
  timed: TimedBonus[];
  /** Bewirtete Gäste mit Restdauer. */
  visitors: ActiveVisitor[];
  /** Vorgabe für die nächste Begegnung (`nextEncounter`), sonst null. */
  forced: ForcedEncounter | null;
  /** Wegpunkt, nach dem der Zwischenhalt schon ausgewertet wurde (Start: 0). */
  interlude: number;
  /**
   * Gekaufte Pflege-Ränge je Maßnahme (ID → 1 … ranks.length; fehlt = 0). Seit Schritt
   * 2.7 additiv in v5: fehlt das Feld in einem gespeicherten v5-Stand, ergänzt das Laden
   * ein leeres Objekt. Die Wirkungen kommen immer aus CARE_BY_ID.
   */
  care: Record<string, number>;
  /**
   * Spielzeit des Zyklus in Sekunden (seit v6, endlich und ≥ 0). Bestimmt die Jahreszeit
   * (DESIGN_V2.md 16.2): Jeder Zyklus beginnt im Frühling, offline läuft das Jahr mit.
   */
  elapsed: number;
  /**
   * Art des Hauptbaums (seit v6, DESIGN_V2.md 17). Gewählt beim Neuen Zyklus, gilt für den
   * ganzen Zyklus. Nur freigeschaltete Arten (unlockedTrees); das Laden fällt sonst auf
   * DEFAULT_MAIN_TREE zurück.
   */
  mainTree: MainTreeId;
}

export interface GameState {
  version: 15;
  /** Gesamt-Wachstum in diesem Zyklus (bestimmt Wegpunkte und Stufe). */
  totalGrowth: number;
  /** 🌰 Samen – einzige Währung. */
  seeds: number;
  /** Erreichte Wegpunkte (Begegnungen ausgelöst). */
  waypoint: number;
  /** Index in STAGES, immer aus `waypoint` abgeleitet. */
  stage: number;
  /**
   * Begleitpflanzen um den Hauptbaum (Pflanzen-IDs, Duplikate erlaubt), höchstens
   * `Stage.plantSlots` viele. Reihenfolge = Reihenfolge des Setzens.
   */
  plants: string[];
  /** Nische → Art-IDs. Jede Art höchstens einmal im Ökosystem. */
  niches: Record<NicheId, string[]>;
  /** Bereits gezogene, noch offene Begegnungen (max. MAX_PENDING_ENCOUNTERS). */
  pendingEncounters: PendingEncounter[];
  /**
   * Zustand des Zufallsgenerators (mulberry32, ganze Zahl in 0 … 2³²−1).
   * Startwerte sind ≠ 0 (normalizeSeed). Der Zustand läuft aber mit ungerader Schrittweite
   * durch alle 2³² Werte und kann darum im Spiel 0 erreichen (1 : 2³² je Zug) – für
   * mulberry32 unschädlich. Wird genau dann gespeichert, setzt das Laden den Zustand aus
   * lastTick neu (isValidRngState lehnt 0 ab); das kostet nur die Reproduzierbarkeit.
   */
  rngState: number;
  /** Der laufende Zyklus (H_max, neu entdeckte Arten). */
  cycle: CycleState;
  /** Überdauert den Neuen Zyklus. */
  meta: {
    /**
     * Dauerhafter Bonus: je Punkt +1 % Wachstum und Samen (FOREST_MEMORY_BONUS in
     * content/memory.ts; bis Schritt 2.10 +2 %).
     */
    forestMemory: number;
    /**
     * Stammgäste: entdeckte Arten, die automatisch einziehen, sobald in ihrer Nische ein
     * Platz frei ist. Höchstens `regularSlots(forestMemory)` viele, in Wahl-Reihenfolge.
     */
    regulars: string[];
    journal: {
      /** Arten, die schon einmal im Ökosystem gelebt haben. */
      species: string[];
      /** Pflanzen, die schon einmal im Pflanzring gewachsen sind (gekeimt oder gesetzt). */
      plants: string[];
      /** Lebensgemeinschaften, die schon einmal bestanden haben (entdeckt). */
      communities: string[];
      /** Andenken, z. B. „old-oak“ für einen v1-Spielstand. */
      keepsakes: string[];
      /**
       * „Zuerst gesehen“ (seit v15, DESIGN_V2.md 25.10): Zyklus und Jahreszeit der ersten
       * Entdeckung je Art bzw. Pflanze. Nur, was seit v15 entdeckt wurde – ältere Einträge des
       * Tagebuchs haben keinen Wert (nichts Erfundenes).
       */
      firstSeen: FirstSeenJournal;
    };
    /** Langzeit-Statistik über alle Zyklen (seit v8). */
    stats: LifetimeStats;
    /**
     * Freigeschaltete Erfolge (seit v9, DESIGN_V2.md 18): IDs aus ACHIEVEMENTS, je einmal,
     * in Freischalt-Reihenfolge. Wird nie zurückgesetzt (`checkAchievements`).
     */
    achievements: string[];
    /** Tagesziele und Serie (seit v12). */
    daily: DailyState;
    /**
     * Waldlandschaft (seit v14, DESIGN_V2.md 24.8): gegründete Wälder, aktiver Wald,
     * Korridore. `forestMemory` und `regulars` oben gehören immer dem **aktiven** Wald.
     */
    landscape: LandscapeState;
  };
  /** Zeitpunkt des letzten Ticks (ms seit Epoch), für Offline-Fortschritt. */
  lastTick: number;
}

export function emptyNiches(): Record<NicheId, string[]> {
  const niches = {} as Record<NicheId, string[]>;
  for (const id of NICHE_IDS) niches[id] = [];
  return niches;
}

/**
 * Neuer Spielstand. `seed` ist der Startwert des Zufallsgenerators – main.ts setzt ihn
 * einmal beim neuen Spiel (z. B. aus der Uhrzeit), Tests übergeben feste Werte.
 */
export function createInitialState(now: number, seed: number = now): GameState {
  return {
    version: SAVE_VERSION,
    totalGrowth: 0,
    seeds: 0,
    waypoint: 0,
    stage: 0,
    plants: [],
    niches: emptyNiches(),
    pendingEncounters: [],
    rngState: normalizeSeed(seed),
    cycle: createCycle(1, now),
    meta: {
      forestMemory: 0,
      regulars: [],
      journal: { species: [], plants: [], communities: [], keepsakes: [], firstSeen: createFirstSeen() },
      stats: createStats(),
      achievements: [],
      daily: createDaily(dailySeedOf(seed)),
      landscape: createLandscape(),
    },
    lastTick: now,
  };
}

/** Ein frischer Zyklus mit dieser Nummer (beginnt im Frühling, Standard: Stieleiche). */
export function createCycle(number: number, now?: number, mainTree: MainTreeId = DEFAULT_MAIN_TREE): CycleState {
  const cycle: CycleState = {
    number,
    maxHarmony: 0,
    bestHarmonyMemory: 0,
    newSpecies: [],
    seen: [],
    bonuses: [],
    habitats: [],
    timed: [],
    visitors: [],
    forced: null,
    interlude: 0,
    care: {},
    elapsed: 0,
    mainTree,
  };
  if (now !== undefined && Number.isFinite(now)) cycle.startedAt = now;
  return cycle;
}

/** Alle Tiere im Ökosystem in Nischen-Reihenfolge. */
export function allAnimals(state: Pick<GameState, 'niches'>): string[] {
  const out: string[] = [];
  for (const id of NICHE_IDS) out.push(...(state.niches[id] ?? []));
  return out;
}
