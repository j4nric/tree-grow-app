/**
 * Balancing-Simulator für das v2-Spiel – auf der ECHTEN Spiellogik aus src/core/
 * (tick, chooseCard, declineEncounter, rerollEncounter, sow, chooseSowing, evaluate,
 * previewChoice …) – er misst genau das, was der Spieler erlebt: Tierbegegnungen, die
 * Aussaat (Phase 10, 2b), Forschung, Ereignisse, Gäste, Jahreszeiten,
 * Baumarten und (runCycles) mehrere Zyklen mit Waldgedächtnis und Stammgästen. Das
 * frühere Referenzmodell scripts/v2/ ist seit Schritt 2.10 entfernt.
 *
 * Kennzahlen für Phase 11 (1e, DESIGN_V2.md 28.10): Takt der Käufe (purchaseTable), Anteil
 * ausgegebener Samen und Vorräte (economyTable), Gabel-Wahl (forkTable), Sitzungsprofil mit
 * simulateOffline (runSession, offlineAfterStage).
 * Seit Phase 11, 3a baut der Spieler mit Samen aus (Nischen und Baum, `RunOptions.upgrades`,
 * Standard wie `care`): Ausbau-Strategie spendSeeds (Zielzeile: billigstes Ziel zuerst mit
 * Meilenstein-Regel, Säen mit Vorrang, Zufallsspieler zufällig unter den bezahlbaren, Rücklage
 * SEED_RESERVE_SECONDS); Ausbaustufen in upgradeTable.
 *
 * Der Spieler löst jede Begegnung sofort auf (online) und sät, sobald die Samen reichen und
 * es sich nach seiner Strategie lohnt (planSow): bei freiem Ring, wenn eine freigeschaltete
 * Pflanze verbessert, bei vollem Ring, wenn ein Tausch verbessern könnte. Aus den gezogenen
 * Karten wählt er wie bei Tieren (decideSowing); passt keine, legt er sie zurück. Ereignisse und Durchreisende
 * (Schritt 2.4) kommen aus der echten Logik (drawEncounter, Zwischenhalt) und werden mit
 * chooseEventOption / hostVisitor / farewellVisitor aufgelöst. Die Zeit läuft
 * ereignisgesteuert von Halt zu Halt (Wegpunkt, Zwischenhalt, Ablauf eines Bonus,
 * nächste Aussaat); tick() rechnet dazwischen exakt.
 *
 * Ausführen (Tabellen im Protokoll, DESIGN_V2.md Abschnitt 15.4):
 *   npm run balance    # großer Lauf: alle Balancing-Tests mit vielen Durchgängen und Tabellen
 * Im normalen `npm run check` laufen dieselben Tests mit wenigen Durchgängen (feste Seeds,
 * Einstellungen in tests/balance-setup.ts).
 *
 * Jahreszeiten laufen immer mit (echte Logik, DESIGN_V2.md 16): Der Simulator hält an
 * jeder Jahreszeitgrenze an, damit Kauf-Zeitpunkte mit der richtigen Rate geplant werden.
 * `RunOptions.mainTree` wählt die Art des Hauptbaums für den (ersten) Zyklus – ohne
 * Freischaltung, damit die Arten vergleichbar sind (DESIGN_V2.md 17.4; Tabellen:
 * tests/seasons-balance.test.ts).
 */
import { COMMUNITIES } from '../src/content/communities';
import { GENUS_INFO, SPECIES_BY_ID } from '../src/content/species';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { STAGES } from '../src/content/stages';
import { GENERA, NICHE_IDS, type EncounterType, type Genus } from '../src/content/types';
import { RESEARCH, RESEARCH_BY_ID, RESEARCH_FORKS, type ResearchFork, type ResearchNode } from '../src/content/research';
import { EVENTS_BY_ID } from '../src/content/events';
import { REROLL_BASE_COST } from '../src/content/encounters';
import {
  cardStatus,
  evaluate,
  ecosystemOf,
  evaluateEcosystem,
  harmonyIncome,
  plantSlots,
  plantsAfterChoice,
  previewChoice,
  previewSowing,
  regularSlots,
  sowingCost,
  sowingRerollCost,
  secondsToNextWaypoint,
  type Evaluation,
} from '../src/core/formulas';
import { updateDaily } from '../src/core/daily';
import { normalizeSeed, randomInt, type RngHolder } from '../src/core/rng';
import { allAnimals, createInitialState, type GameState, type PendingEncounterType } from '../src/core/state';
import {
  allWaypointsReached,
  chooseCard,
  chooseEventOption,
  declineEncounter,
  farewellVisitor,
  hostBlocker,
  hostVisitor,
  interludeThreshold,
  nextExpiry,
  isTreeUnlocked,
  chooseSowing,
  discardSowing,
  previewNewCycle,
  previewResearch,
  rerollBlocker,
  rerollSowing,
  rerollSowingBlocker,
  rerollEncounter,
  research,
  researchBlocker,
  researchCost,
  researchRankOf,
  setRegulars,
  simulateOffline,
  sow,
  sowBlocker,
  startNewCycle,
  tick,
  unlockedPlants,
  upgradeCost,
  upgradeLevelOf,
  upgradeNiche,
  upgradeTree,
} from '../src/core/tick';
import { seasonIndex, secondsToNextSeason } from '../src/core/season';
import { secondsToNightChange, type AmbientMode } from '../src/core/weather';
import { effectiveForestMemory } from '../src/core/landscape';
import { goalCandidates, MILESTONE_GOAL_SECONDS, secondsUntilAffordable, type NextGoal } from '../src/core/goal';
import { upgradeMilestones } from '../src/core/upgrades';
import type { MainTreeId } from '../src/content/trees';
import { TREE_PART_IDS } from '../src/content/upgrades';

// ---------------------------------------------------------------------------
// Optionen einer Begegnung
// ---------------------------------------------------------------------------

/**
 * Eine Möglichkeit, eine Karte zu spielen (bei voller Nische je zu entlassendem Tier,
 * bei vollem Pflanzring je zu ersetzender Pflanze). `kind: 'sowing'`: Karte der offenen Aussaat.
 */
export interface Option {
  card: number;
  kind: PendingEncounterType | 'sowing';
  /** Art- oder Pflanzen-ID der Karte. */
  id: string;
  replace?: string;
  ev: Evaluation;
}

/** Alle gültigen Platzierungen der Karten der ersten offenen Begegnung. */
export function optionsFor(state: GameState): Option[] {
  const enc = state.pendingEncounters[0];
  if (!enc) return [];
  const out: Option[] = [];
  enc.cards.forEach((id, card) => {
    const status = cardStatus(state, 0, card);
    if (status === 'free') {
      const ev = previewChoice(state, 0, card);
      if (ev) out.push({ card, kind: enc.type, id, ev });
    } else if (status === 'full') {
      for (const replace of state.niches[SPECIES_BY_ID.get(id)!.niche]) {
        const ev = previewChoice(state, 0, card, replace);
        if (ev) out.push({ card, kind: enc.type, id, replace, ev });
      }
    }
  });
  return out;
}

/** Alle gültigen Platzierungen der Karten der offenen Aussaat (bei vollem Ring je Ersatz). */
export function sowingOptionsFor(state: GameState): Option[] {
  const sowing = state.cycle.sowing;
  if (!sowing) return [];
  const out: Option[] = [];
  const full = state.plants.length >= plantSlots(state.stage);
  sowing.cards.forEach((id, card) => {
    for (const replace of full ? [...new Set(state.plants)] : [undefined]) {
      const ev = previewSowing(state, card, replace);
      if (ev) out.push(replace === undefined ? { card, kind: 'sowing', id, ev } : { card, kind: 'sowing', id, replace, ev });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Strategien
// ---------------------------------------------------------------------------

export type Action = { kind: 'choose'; option: Option } | { kind: 'decline' } | { kind: 'reroll' };

export interface Strategy {
  id: string;
  name: string;
  /** Entscheidet über die erste offene Begegnung. `rng` ist der eigene Zufall der Strategie. */
  decide(state: GameState, options: Option[], current: Evaluation, rng: RngHolder): Action;
  /**
   * Bewertung der Pflanzen bei der Aussaat (höher = besser; gesät und gewählt wird nur, was
   * verbessert). null = Zufallsspieler: sät bei freiem Ring und wählt eine beliebige Karte.
   */
  plantValue: ((ev: Evaluation) => number) | null;
  /**
   * Forschung (Phase 11, 1e): Gewicht des relativen Harmonie-Gewinns neben Wachstum und Samen
   * (researchValue). Der Harmonie-Spieler forscht auch für ⚖️ (1), der Wachstums-Spieler nur für
   * 🌿 und 🌰 (0). An den Gabeln wählt jede Strategie mit demselben Maß (forkChoice).
   */
  researchHarmony: number;
  /**
   * Aussaat (Phase 11, 1e): `improve` – säen und tauschen, sobald eine Pflanze die eigene Wertung
   * verbessern könnte; `spend` – Zufallsspieler: freien Ring immer füllen, bei vollem Ring
   * tauschen, sobald der Vorrat zwei Aussaaten deckt (ein Rest bleibt für Würfeln und Gäste).
   */
  sowPolicy: 'improve' | 'spend';
  /**
   * Feste Seite je Gabel (`ResearchFork.id` → 0 = Weg A, 1 = Weg B) statt der Wahl nach dem Maß
   * (forkChoice) – nur zum Messen einer Gabel (Phase 11, 3b: Saat, Samenbank gegen Anzuchtbeet).
   */
  forks?: Readonly<Record<string, 0 | 1>>;
  /**
   * Samen (nur mit Ausbau): `goal` – kauft genau, was die Zielzeile nennt (nextGoal: Säen nur bei
   * freiem Pflanzplatz, kein Tausch), sobald es bezahlbar ist, ohne Rücklage. Standard: die
   * Ausbau-Strategie spendSeeds (Säen mit Vorrang, Tausch, Rücklage).
   */
  seedPolicy?: 'goal';
}

/** Strategie mit fester Seite an einer Gabel (Messung, Strategy.forks). */
export function withFork(strategy: Strategy, fork: string, side: 0 | 1): Strategy {
  return { ...strategy, id: `${strategy.id}-${fork}-${side === 0 ? 'a' : 'b'}`, forks: { ...strategy.forks, [fork]: side } };
}

const byHarmony = (ev: Evaluation) => ev.harmony + 1e-6 * ev.growth;
const byGrowth = (ev: Evaluation) => ev.growth + 1e-6 * ev.harmony;

function best(options: Option[], value: (o: Option) => number): Option | null {
  let top: Option | null = null;
  let topValue = -Infinity;
  for (const o of options) {
    const v = value(o);
    if (v > topValue) {
      top = o;
      topValue = v;
    }
  }
  return top;
}

/**
 * Höchstens ein Wurf je Tierbegegnung (wie im früheren Prototyp scripts/v2), und nur,
 * wenn die Logik ihn zulässt (Samen reichen, es gibt andere Karten – rerollBlocker liefert sonst
 * 'too-expensive' / 'no-alternatives'). Aussaaten werden nicht neu gewürfelt.
 */
function canReroll(state: GameState): boolean {
  const enc = state.pendingEncounters[0];
  return !!enc && enc.type === 'animal' && enc.rerolls < 1 && rerollBlocker(state, 0) === null;
}

/** Nimmt die beste Option, wenn sie verbessert; sonst einmal neu würfeln, sonst ablehnen. */
function greedy(id: string, name: string, value: (ev: Evaluation) => number, researchHarmony: number): Strategy {
  return {
    id,
    name,
    plantValue: value,
    researchHarmony,
    sowPolicy: 'improve',
    decide(state, options, current) {
      const top = best(options, (o) => value(o.ev));
      if (top && value(top.ev) > value(current)) return { kind: 'choose', option: top };
      return canReroll(state) ? { kind: 'reroll' } : { kind: 'decline' };
    },
  };
}

export const RANDOM: Strategy = {
  id: 'random',
  name: 'Zufällig',
  plantValue: null,
  researchHarmony: 0,
  sowPolicy: 'spend',
  decide(state, options, _current, rng) {
    const cards = state.pendingEncounters[0]!.cards;
    const card = randomInt(rng, cards.length);
    const mine = options.filter((o) => o.card === card);
    if (mine.length === 0) return { kind: 'decline' };
    if (mine.length === 1 && mine[0]!.replace === undefined) return { kind: 'choose', option: mine[0]! };
    // Volle Nische / voller Ring: zufällig ersetzen oder ablehnen.
    const k = randomInt(rng, mine.length + 1);
    return k < mine.length ? { kind: 'choose', option: mine[k]! } : { kind: 'decline' };
  },
};

export const HARMONY = greedy('harmony', 'Gierig nach Harmonie', byHarmony, 1);
export const GROWTH = greedy('growth', 'Gierig nach Wachstum', byGrowth, 0);
/**
 * Naiver Spieler „folgt der Zielzeile“ (Phase 11, 3b; Playtest 5b, Fund F1): Karten, Aussaat und
 * Forschung wie der Harmonie-Spieler, die Samen aber nur für das, was die Zielzeile nennt
 * (`seedPolicy: 'goal'`), sofort und ohne Rücklage – kein Tausch im vollen Ring.
 */
export const GOAL: Strategy = { ...greedy('goal', 'Folgt der Zielzeile', byHarmony, 1), seedPolicy: 'goal' };

export const RAREST: Strategy = {
  id: 'rarest',
  name: 'Immer die seltenste Karte',
  plantValue: byHarmony,
  researchHarmony: 1,
  sowPolicy: 'improve',
  decide(_state, options) {
    if (options.length === 0) return { kind: 'decline' };
    const rarity = (o: Option) => SPECIES_BY_ID.get(o.id)!.rarity;
    const top = Math.max(...options.map(rarity));
    return { kind: 'choose', option: best(options, (o) => (rarity(o) === top ? byHarmony(o.ev) : -Infinity))! };
  },
};

export function stacker(genus: Genus): Strategy {
  return {
    id: `stack-${genus}`,
    name: `${GENUS_INFO[genus].name} stapeln`,
    plantValue: byHarmony,
    researchHarmony: 1,
    sowPolicy: 'improve',
    decide(state, options, current, rng) {
      // Pflanzen (Aussaat) wählt der Stapler wie der Harmonie-Spieler (decideSowing).
      const isOwn = (id: string) => SPECIES_BY_ID.get(id)!.genus === genus;
      const own = options.filter((o) => isOwn(o.id) && (o.replace === undefined || !isOwn(o.replace)));
      // Lieber ein freier Platz oder ein fremdes Tier ersetzen; nie ein eigenes.
      if (own.length > 0) return { kind: 'choose', option: best(own, (o) => byHarmony(o.ev))! };
      if (canReroll(state)) return { kind: 'reroll' };
      return HARMONY.decide(state, options, current, rng);
    },
  };
}

export const STRATEGIES: readonly Strategy[] = [RANDOM, HARMONY, GROWTH, RAREST, ...GENERA.map(stacker)];

// ---------------------------------------------------------------------------
// Ein Durchgang
// ---------------------------------------------------------------------------

/** Kennzahlen einer Begegnung: Wie „echt“ war die Wahl? (Definition wie im früheren Prototyp scripts/v2) */
export interface DecisionStat {
  /** Stufe, in der die Begegnung stattfand. */
  stage: number;
  /** Harmonie-Gewinn der besten und zweitbesten Karte (je mit bester Platzierung). */
  best: number;
  second: number;
  /** Relativer Wachstumsgewinn der besten Karte. */
  bestGrowth: number;
  /** Karten, die in Harmonie, Wachstum oder Samen von keiner anderen übertroffen werden. */
  pareto: number;
}

/** Zähler eines Durchgangs (kumuliert). */
export interface Counts {
  /** Begegnungen, die der Spieler gesehen hat (ohne automatisch abgelehnte; ohne Aussaaten). */
  encounters: number;
  /**
   * Aufgelöste Aussaaten (gekauft, Geschenk an Wegpunkt 2, Vogelsaat; seit Phase 10, 2b – bis
   * dahin „Etwas keimt“). Name bleibt wegen der Tabellen.
   */
  plantEncounters: number;
  /** … davon Tierbegegnungen mit mindestens einer Karte, deren Nische voll ist. */
  fullNiche: number;
  rerolls: number;
  declines: number;
  /** Automatisch abgelehnt (keine Art kam in Frage oder Warteschlange voll). */
  autoDeclined: number;
  /** Gewählte Tierkarten je Seltenheit. */
  rarityTaken: number[];
  /** Aus Aussaaten gesetzte Pflanzen und vom Spieler ausgelöste Aussaaten („Säen“, auch die erste gratis). */
  plantsTaken: number;
  plantsBought: number;
  /** … davon in den vollen Ring getauscht (Aussaat ersetzt eine Pflanze, 27.6). */
  plantsSwapped: number;
  /** Ereignisse, Gäste, davon bewirtet. */
  events: number;
  visitors: number;
  hosted: number;
  /** Nur mit `care`: erforschte Knoten (bis v16 gekaufte Pflege-Ränge). */
  careBought: number;
  /** Eingezogene Stammgäste (ab Zyklus 2). */
  regulars: number;
  /** Gekaufte Ausbaustufen (Nischen und Baum, Phase 11, 3a). */
  upgradesBought: number;
  /** Gratis-Würfe der Aussaat (Anzuchtbeet, freeSowingReroll; Phase 11, 3b). */
  sowingRerolls: number;
}

/** Schnappschuss des Durchgangs (beim Erreichen einer Stufe oder zu einer festen Zeit). */
export interface Snapshot {
  time: number;
  stage: number;
  harmony: number;
  growth: number;
  seedsRate: number;
  happiness: number;
  animals: number;
  /** Tiere (Art-IDs) und Pflanzen im Ökosystem. */
  animalIds: string[];
  /** Summe der 🌿-Boni (nach Fraß) und Anteil der Begleitpflanzen an 🌿/s. */
  growthBonus: number;
  plantGrowth: number;
  plantIds: string[];
  plants: number;
  /** Versorgung V der Begleitpflanzen (0–1). */
  supply: number;
  genus: Record<Genus, number>;
  /** Aktive Lebensgemeinschaften (IDs) und ihre Harmonie (inkl. Lichterabend). */
  communities: string[];
  communityHarmony: number;
  /** Im Naturtagebuch entdeckte Lebensgemeinschaften (auch gerade nicht aktive). */
  discovered: number;
  /** Samen-Bestand. */
  seeds: number;
  /** ⚖️-Vorrat (`harmonyPoints`) und sein Zufluss je Sekunde (mit Gedächtnis). */
  harmonyPoints: number;
  harmonyRate: number;
  /** Bisher verdient: passiv (Baum × Harmonie) und durch (automatisches) Ablehnen. */
  earnedPassive: number;
  earnedDecline: number;
  /** Bisher ausgegeben für Neu würfeln und für Aussaaten. */
  spent: number;
  spentPlants: number;
  /** Samen aus Ereignissen und Gästen bzw. fürs Bewirten ausgegeben. */
  earnedExtras: number;
  spentVisitors: number;
  /** Nur mit `care`: für Forschung ausgegeben (⚖️; bis v16 🌰 für Pflege). */
  spentCare: number;
  /** Für Ausbau ausgegeben (🌰, Nischen und Baum; Phase 11, 3a). */
  spentUpgrades: number;
  /** Ausbaustufen je Nische und Baumteil (fehlend = 0). */
  upgradeLevels: Record<string, number>;
  /** Nur mit `daily`: Samen aus erfüllten Tageszielen (DESIGN_V2.md 20.6). */
  earnedDaily: number;
  /** Nur mit `daily`: erfüllte Tagesziele. */
  dailyDone: number;
  /** Erforschte Knoten (ID → 1; bis v16 gekaufte Ränge je Maßnahme). */
  careRanks: Record<string, number>;
  /** Ereignisse und Gäste, die in diesem Zyklus schon gezogen wurden (`cycle.seen`). */
  seen: string[];
  counts: Counts;
}

export interface RunResult {
  /** Schnappschuss beim Erreichen jeder Stufe – vor der Wahl an diesem Wegpunkt. */
  stages: (Snapshot | null)[];
  /** Schnappschüsse zu den Zeiten SAMPLE_MINUTES (solange der Durchgang läuft). */
  samples: (Snapshot | null)[];
  /** Wartezeit vor jeder Begegnung, mit der Stufe, in der gewartet wurde. */
  gaps: { stage: number; seconds: number }[];
  decisions: DecisionStat[];
  /** Vielfalt: eine Zeile je Begegnung (erste Ziehung), siehe VarietyStat. */
  variety: VarietyStat[];
  /**
   * Vorschau „Neuer Zyklus“ ab dem Hain je Wegpunkt (Schritt 2.11b): Gedächtnis-Gewinn beim
   * Erreichen (`arrive`, vor der Wahl) und nach der Wahl (`after`), dazu H_max nach der Wahl.
   */
  memoryPath: MemoryPathPoint[];
  /**
   * Frühes Spiel (Playtest-Befund „zäher Abschnitt“): Zeitpunkte (s) aller Entscheidungen in
   * den ersten EARLY_SECONDS – aufgelöste Begegnung, gesetzte Pflanze, gekaufte Pflege –, und
   * der höchste Samenbestand vor EARLY_SEED_STAGE (Samen ohne Verwendung; danach spart der
   * Spieler gezielt auf Pflege).
   */
  early: { actions: number[]; seedPeak: number };
  /** Alle Käufe in zeitlicher Folge (Takt-Kennzahl „Zeit zwischen zwei Käufen“, DESIGN_V2.md 28.10). */
  purchases: Purchase[];
  final: Snapshot;
}

/**
 * Ein Kauf des Spielers: bezahlte Aussaat (`sow`; die erste gratis und geschenkte zählen nicht),
 * Neu würfeln (`reroll`), Gast bewirten (`host`), eine Ausbaustufe (`upgrade`, Phase 11, 3a) – die
 * 🌰-Käufe – und ein Forschungsknoten oder Rang (`research`, ⚖️). `cost` in der jeweiligen Währung.
 */
export interface Purchase {
  time: number;
  stage: number;
  kind: PurchaseKind;
  cost: number;
}

export type PurchaseKind = 'sow' | 'reroll' | 'host' | 'upgrade' | 'research';

/** Käufe mit Samen (Takt-Ziel 28.10: „Zeit zwischen zwei 🌰-Käufen“). */
export const SEED_PURCHASES: readonly PurchaseKind[] = ['sow', 'reroll', 'host', 'upgrade'];
/** Alle Käufe (Samen und ⚖️). */
export const ALL_PURCHASES: readonly PurchaseKind[] = ['sow', 'reroll', 'host', 'upgrade', 'research'];

/** Ein Punkt in RunResult.memoryPath. */
export interface MemoryPathPoint {
  waypoint: number;
  arrive: number;
  after: number;
  maxHarmony: number;
}

/**
 * Vielfalt einer Begegnung (Playtest-Befund „immer dieselben Karten“, DESIGN_V2.md 7.7).
 * Gemessen an der ersten Ziehung, „lohnend“ auch nach Neu würfeln.
 */
export interface VarietyStat {
  stage: number;
  /** Spielzeit (s), zu der die Begegnung aufgelöst wurde. */
  time: number;
  /** Begegnungstyp oder `'sowing'` (Aussaat, Phase 10, 2b). */
  type: EncounterType | 'sowing';
  /** Anzahl Karten der ersten Ziehung. */
  cards: number;
  /** Gleiches Karten-Set wie die vorige Begegnung desselben Typs. */
  sameAsPrevious: boolean;
  /** Warum „Neu würfeln“ bei der ersten Ziehung gesperrt war (null = möglich). */
  rerollBlocked: string | null;
  /** Mindestens eine angebotene Karte verbessert Harmonie oder Wachstum. */
  worthwhile: boolean;
  /** Eine Karte der ersten Ziehung kam als Wildwechsel über einen Korridor (24.6, `via`). */
  wildwechsel?: boolean;
  /** Karten der ersten Ziehung (Tierbegegnungen und Aussaaten), für die Vielfalt der Landschaft (2c). */
  ids?: string[];
}

export interface RunOptions {
  seed: number;
  /** Simulation endet mit Erreichen dieser Stufe. */
  targetStage: number;
  maxSeconds: number;
  /** Forschen (echte Logik, seit v17 mit ⚖️; bis v16 Pflege mit 🌰). Standard: aus – zum Vergleich. */
  care?: boolean;
  /**
   * Ausbau mit Samen (Phase 11, 3a; DESIGN_V2.md 28.4, 28.10): Nischen und Baum ausbauen nach
   * der Ausbau-Strategie (spendSeeds). Standard: wie `care` – „alle Systeme“ heißt mit Ausbau.
   */
  upgrades?: boolean;
  /** Art des Hauptbaums (Standard: Stieleiche wie im ersten Zyklus). */
  mainTree?: MainTreeId;
  /**
   * Wetter und Nacht (DESIGN_V2.md 21) wie in tick(): `live` (Standard, wie online),
   * `average` (Mittelwetter und halbe Nachtwirkung wie offline) oder `off` (ohne beides,
   * zum Vergleich).
   */
  ambient?: AmbientMode;
  /**
   * Tagesziele mitspielen (DESIGN_V2.md 20.6): die Ziele dieses Tages („JJJJ-MM-TT“) entstehen
   * beim Start; jede gespielte Sekunde zählt als aktiv. Der Spieler verfolgt sie nicht
   * gezielt – sie werden erfüllt, wenn seine Strategie sie ohnehin erfüllt. Standard: aus
   * (alle übrigen Tabellen ohne Tagesziele).
   */
  daily?: string;
  /** Mit `daily`: Tageswechsel nach so vielen Sekunden (der Folgetag bringt neue Ziele). */
  dailyNextDayAt?: number;
  dailyNextDay?: string;
}

/** Frühes Spiel: Kennzahlen „längste Pause ohne Entscheidung“ und „Samen ungenutzt“ (s). */
export const EARLY_SECONDS = 600;
/** „Samen ungenutzt“: höchster Bestand vor dieser Stufe (Junger Baum). */
export const EARLY_SEED_STAGE = 3;

/** Zeitpunkte (Minuten) für den Samen-Verlauf. */
export const SAMPLE_MINUTES: readonly number[] = [5, 10, 20, 30, 45, 60, 90, 120, 180];

/**
 * Stand eines Durchgangs genau dort, wo ein Lauf mit `targetStage` = erreichte Stufe enden
 * würde (nach dem Auflösen der Begegnungen am Wegpunkt): Spielstand, Zufall und Ergebnis
 * bis dahin – alles Kopien, der Durchgang läuft unabhängig weiter.
 */
export interface Checkpoint {
  state: GameState;
  rng: RngHolder;
  result: RunResult;
}

/** Was runGame an einer neu erreichten Stufe anbietet (onStage): Kopien auf Abruf. */
export interface StageCapture {
  result(): RunResult;
  state(): { state: GameState; rng: RngHolder };
}

/**
 * Ein Zyklus. Ohne `from` beginnt ein neues Spiel (erster Zyklus); mit `from` läuft der
 * Zyklus auf diesem Spielstand weiter (runCycles: nach startNewCycle) und mit dem Zufall
 * der Strategie aus dem vorigen Zyklus.
 *
 * `onStage` (optional) meldet jede neu erreichte Stufe unterhalb von `targetStage`; dort
 * liefert `capture.result()` das Ergebnis und `capture.state()` Spielstand und Zufall (Kopien).
 * Der Lauf ist bis dahin derselbe wie mit dieser Stufe als Ziel (die Ziel-Stufe beendet nur
 * die Schleife) – so teilen sich Läufe mit verschiedenen Ziel-Stufen ihren gemeinsamen Anfang
 * (branchCycles, tests/balance-runs.ts).
 */
export function runGame(
  strategy: Strategy,
  options: RunOptions,
  from?: { state: GameState; rng: RngHolder },
  onStage?: (stage: number, capture: StageCapture) => void,
): RunResult {
  const state = from?.state ?? createInitialState(0, options.seed);
  if (options.mainTree) state.cycle.mainTree = options.mainTree;
  const rng: RngHolder = from?.rng ?? { rngState: normalizeSeed(options.seed * 7919 + 17) };
  let time = 0;
  let lastWaypointTime = 0;
  const book = {
    earnedPassive: 0, earnedDecline: 0, spent: 0, spentPlants: 0, earnedExtras: 0, spentVisitors: 0, spentCare: 0, spentUpgrades: 0,
    earnedDaily: 0, dailyDone: 0,
  };
  const upgrades = options.upgrades ?? options.care ?? false;
  // Eigener Zufall für die Ausbau-Wahl des Zufallsspielers: Begegnungen ziehen dieselben Karten
  // wie ohne Ausbau (Seed, Zyklus), damit sich Läufe mit und ohne Ausbau vergleichen lassen.
  const upgradeRng: RngHolder = { rngState: normalizeSeed(options.seed * 104_729 + 31 * state.cycle.number + 5) };
  // Tagesziele (nur mit `daily`): Belohnungen getrennt verbuchen.
  const daily = (activeSeconds: number, produced?: { growth: number; seeds: number }) => {
    if (!options.daily) return;
    const day = options.dailyNextDay && time >= (options.dailyNextDayAt ?? Infinity) ? options.dailyNextDay : options.daily;
    const before = state.seeds;
    const result = updateDaily(state, day, { activeSeconds, produced });
    book.earnedDaily += state.seeds - before;
    book.dailyDone += result.completed.length;
  };
  daily(0);
  const counts: Counts = {
    encounters: 0,
    plantEncounters: 0,
    fullNiche: 0,
    rerolls: 0,
    declines: 0,
    autoDeclined: 0,
    rarityTaken: [0, 0, 0, 0],
    plantsTaken: 0,
    plantsBought: 0,
    plantsSwapped: 0,
    events: 0,
    visitors: 0,
    hosted: 0,
    careBought: 0,
    regulars: 0,
    upgradesBought: 0,
    sowingRerolls: 0,
  };
  const result: RunResult = {
    stages: Array(STAGES.length).fill(null),
    samples: SAMPLE_MINUTES.map(() => null),
    gaps: [],
    decisions: [],
    variety: [],
    memoryPath: [],
    early: { actions: [], seedPeak: 0 },
    purchases: [],
    final: null as unknown as Snapshot,
  };
  const act = () => {
    if (time <= EARLY_SECONDS) result.early.actions.push(time);
  };
  const cycleWaypoint = STAGES[NEW_CYCLE_MIN_STAGE]!.waypoint;
  const ambient: AmbientMode = options.ambient ?? 'live';
  const snapshot = (): Snapshot => {
    const ev = evaluate(state, ambient);
    const genus = Object.fromEntries(GENERA.map((g) => [g, 0])) as Record<Genus, number>;
    for (const id of allAnimals(state)) genus[SPECIES_BY_ID.get(id)!.genus]++;
    return {
      time,
      stage: state.stage,
      harmony: ev.harmony,
      growth: ev.growth,
      seedsRate: ev.seeds,
      happiness: ev.avgHappiness,
      animals: allAnimals(state).length,
      animalIds: allAnimals(state),
      growthBonus: ev.growthBonus - ev.damage,
      plantGrowth: ev.plantGrowth,
      plantIds: [...state.plants],
      plants: state.plants.length,
      supply: ev.supply,
      genus,
      communities: ev.communities.filter((c) => c.active).map((c) => c.id),
      communityHarmony: ev.breakdown.communities,
      discovered: state.meta.journal.communities.length,
      seeds: state.seeds,
      harmonyPoints: state.harmonyPoints,
      harmonyRate: harmonyIncome(ev.harmony, effectiveForestMemory(state)),
      ...book,
      upgradeLevels: upgradeLevelsOf(state),
      // Einmalige Knoten 1, wiederholbare ihr Rang (28.6).
      careRanks: Object.fromEntries(state.cycle.research.map((id) => [id, researchRankOf(state, id) || 1])),
      seen: [...state.cycle.seen],
      counts: { ...counts, rarityTaken: [...counts.rarityTaken] },
    };
  };
  result.stages[0] = snapshot();
  let sample = 0;

  // planSow bewertet jede Pflanze (teuer) und hängt nur vom Ökosystem (wie der
  // Cache-Schlüssel von evaluate), vom Wegpunkt und von der Zahl der Aussaaten ab –
  // darum je Zustand nur einmal rechnen (gleiche Ergebnisse; Idee aus dem Branch
  // claude/v2-tests-schneller).
  let planKey = '';
  let planValue = false;
  const nextPlan = (): boolean => {
    const c = state.cycle;
    const key = [
      state.waypoint,
      counts.plantsBought,
      state.cycle.sowings,
      state.plants.join(','),
      NICHE_IDS.map((n) => state.niches[n].join(',')).join(';'),
      JSON.stringify([c.research, c.bonuses, c.habitats, c.timed.map((t) => t.effect), c.visitors.map((v) => v.id)]),
      seasonIndex(c.elapsed),
    ].join('|');
    if (key !== planKey) {
      planKey = key;
      planValue = planSow(state, strategy, counts);
    }
    return planValue;
  };
  /** Offene Aussaat (gekauft, Geschenk, Vogelsaat) nach der Strategie auflösen. */
  const settleSowing = () => {
    const before = state.seeds;
    if (resolveSowingNow(state, strategy, rng, counts, result.variety, time)) act();
    book.earnedDecline += Math.max(0, state.seeds - before);
  };

  /** Säen (bezahlt oder gratis) und die Aussaat nach der Strategie auflösen. */
  const buySowing = (): boolean => {
    const cost = sowingCost(state);
    if (!sow(state).ok) return false;
    book.spentPlants += cost;
    counts.plantsBought++;
    if (cost > 0) result.purchases.push({ time, stage: state.stage, kind: 'sow', cost });
    settleSowing();
    return true;
  };
  /** Eine Ausbaustufe kaufen (Phase 11, 3a). */
  const buyUpgrade = (target: NonNullable<NextGoal['target']>): boolean => {
    const res = target.kind === 'niche' ? upgradeNiche(state, target.id, 1) : upgradeTree(state, target.id, 1);
    if (!res.ok) return false;
    const cost = -(res.seeds ?? 0);
    book.spentUpgrades += cost;
    counts.upgradesBought++;
    result.purchases.push({ time, stage: state.stage, kind: 'upgrade', cost });
    act();
    return true;
  };

  // Ausbau-Halte (spendSeeds): nur Samen und Stufen ändern sich – die letzte Forschungs-Entscheidung gilt weiter.
  let goalStop = false;
  let lastCare: { need: number | null } | null = null;
  while (state.stage < options.targetStage && time < options.maxSeconds && !allWaypointsReached(state)) {
    // Säen, solange es sich lohnt und die Samen reichen (eine offene Aussaat zuerst auflösen).
    settleSowing();
    let plan = false;
    if (!upgrades) {
      for (let guard = 0; guard < 50 && nextPlan() && sowBlocker(state) === null && state.seeds >= sowNeed(state, strategy); guard++) {
        if (!buySowing()) break;
      }
      const blocker = sowBlocker(state);
      plan = nextPlan() && (blocker === 'too-expensive' || (blocker === null && state.seeds < sowNeed(state, strategy)));
    }
    // Forschung (seit v17 mit ⚖️ aus dem Vorrat): erforschen, was die Strategie anspart,
    // sobald es reicht – an den Gabeln nur den Weg, den sie wählt (careTarget, forkChoice).
    let careNeed: number | null = null;
    // Halt nur für einen Ausbau-Kauf (Phase 11, 3a): Am Ökosystem hat sich nichts geändert außer
    // Samen und Ausbaustufen – die Forschung wird nicht neu bewertet, solange der Vorrat für das
    // angesparte Ziel nicht reicht (Laufzeit; ohne Ausbau gibt es diese Halte nicht).
    if (options.care && goalStop && lastCare && (lastCare.need === null || state.harmonyPoints < lastCare.need)) {
      careNeed = lastCare.need;
    } else if (options.care) {
      for (let target = careTarget(state, strategy); target; target = careTarget(state, strategy)) {
        const cost = researchCost(state, target) ?? Infinity;
        if (state.harmonyPoints < cost) {
          careNeed = cost;
          break;
        }
        const before = state.harmonyPoints;
        if (!research(state, target).ok) break;
        book.spentCare += before - state.harmonyPoints;
        counts.careBought++;
        result.purchases.push({ time, stage: state.stage, kind: 'research', cost: before - state.harmonyPoints });
        act();
      }
    }
    lastCare = { need: careNeed };
    // Mit Ausbau (Phase 11, 3a): Ziele nach der Ausbau-Strategie kaufen, solange es reicht; sonst
    // bis dahin warten (Halt, sobald die Samen reichen). Nach der Forschung: Sie ändert die Rate.
    const toGoal = upgrades ? spendSeeds(state, strategy, nextPlan, upgradeRng, ambient, buySowing, buyUpgrade) : Infinity;
    const ev = evaluate(state, ambient);
    // Bis die nächste geplante Aussaat bezahlbar ist (+1 µs gegen Rundung).
    const toPlant = plan && ev.seeds > 0 ? Math.max(0, (sowNeed(state, strategy) - state.seeds) / ev.seeds) + 1e-6 : toGoal;
    const stageBefore = state.stage;
    const nextSample = (SAMPLE_MINUTES[sample] ?? Infinity) * 60;
    const toWaypoint = secondsToNextWaypoint(state, ambient);
    // Zwischenhalt und Ablauf von Boni: dort anhalten, damit Zeitpunkte und Raten stimmen.
    const interlude = interludeThreshold(state);
    const toInterlude = interlude < Infinity && ev.growth > 0 ? Math.max(0, interlude - state.totalGrowth) / ev.growth : Infinity;
    // Jahreszeitgrenze: Raten wechseln, Käufe neu planen.
    const toSeason = secondsToNextSeason(state.cycle.elapsed);
    // Sonnenuntergang und -aufgang (nur mit Einzelwetter): Nachtarten ändern die Raten.
    const toNight = ambient === 'live' ? secondsToNightChange(state.cycle.elapsed) : Infinity;
    const harmonyRate = harmonyIncome(ev.harmony, effectiveForestMemory(state));
    const toCare = careNeed !== null && harmonyRate > 0 ? Math.max(0, (careNeed - state.harmonyPoints) / harmonyRate) + 1e-6 : Infinity;
    const others = Math.min(toWaypoint, nextSample - time, nextExpiry(state), toInterlude, toSeason, toNight, toCare, options.maxSeconds - time);
    const dt = Math.min(toPlant, others);
    goalStop = upgrades && toGoal < others;
    if (!(dt < Infinity)) break;
    const seedsBefore = state.seeds;
    const growthBefore = state.totalGrowth;
    const report = tick(state, dt, ambient);
    time += dt;
    // Samen steigen zwischen zwei Halten nur – der Höchststand liegt also an einem Halt.
    if (stageBefore < EARLY_SEED_STAGE) result.early.seedPeak = Math.max(result.early.seedPeak, state.seeds);
    const autoSeeds = report.declinedSeeds;
    book.earnedPassive += state.seeds - seedsBefore - autoSeeds;
    // Tagesziele erst nach der Buchung: ihre Belohnung zählt nur in earnedDaily.
    daily(dt, { growth: state.totalGrowth - growthBefore, seeds: state.seeds - seedsBefore - autoSeeds });
    book.earnedDecline += autoSeeds;
    counts.autoDeclined += report.autoDeclined;
    counts.regulars += report.regulars.length;
    if (time >= nextSample - 1e-9) result.samples[sample++] = snapshot();
    if (report.waypoints === 0) {
      // Zwischenhalt (ab Hain): zählt als Begegnung für Takt und Durststrecke.
      if (report.interludes > 0) {
        result.gaps.push({ stage: state.stage, seconds: time - lastWaypointTime });
        lastWaypointTime = time;
        const n = counts.encounters;
        resolveAll(state, strategy, rng, counts, book, result.decisions, result.variety, time, result.purchases);
        if (counts.encounters > n) act();
      }
      continue;
    }
    result.gaps.push({ stage: stageBefore, seconds: time - lastWaypointTime });
    lastWaypointTime = time;
    for (let s = stageBefore + 1; s <= state.stage; s++) result.stages[s] = snapshot();
    const arrive = state.waypoint >= cycleWaypoint ? previewNewCycle(state).memoryGain : null;
    const seen = counts.encounters;
    resolveAll(state, strategy, rng, counts, book, result.decisions, result.variety, time, result.purchases);
    if (counts.encounters > seen) act();
    if (arrive !== null) {
      const after = previewNewCycle(state);
      result.memoryPath.push({ waypoint: state.waypoint, arrive, after: after.memoryGain, maxHarmony: after.maxHarmony });
    }
    // Hier endete ein Lauf mit dieser Stufe als Ziel (Schleifenbedingung oben).
    if (onStage && state.stage > stageBefore && state.stage < options.targetStage) {
      onStage(state.stage, {
        result: () => ({
          stages: [...result.stages],
          samples: [...result.samples],
          gaps: [...result.gaps],
          decisions: [...result.decisions],
          variety: result.variety.map((v) => ({ ...v })),
          memoryPath: [...result.memoryPath],
          early: { actions: [...result.early.actions], seedPeak: result.early.seedPeak },
          purchases: result.purchases.map((p) => ({ ...p })),
          final: snapshot(),
        }),
        state: () => ({ state: structuredClone(state), rng: { ...rng } }),
      });
    }
  }
  result.final = snapshot();
  return result;
}

// ---------------------------------------------------------------------------
// Mehrere Zyklen am Stück (Neuer Zyklus, Waldgedächtnis, Stammgäste, Kartenpool)
// ---------------------------------------------------------------------------

/** Ein Zyklus aus runCycles. */
export interface CycleRun {
  /** Nummer des Zyklus (ab 1). */
  number: number;
  result: RunResult;
  /** Waldgedächtnis zu Beginn des Zyklus und Gewinn an seinem Ende (previewNewCycle). */
  memory: number;
  memoryGain: number;
  /** Höchste Harmonie des Zyklus (H_max, ungerundet) beim Neustart. */
  maxHarmony: number;
  /** Arten, die in diesem Zyklus neu ins Tagebuch kamen. */
  newSpecies: number;
  /** Gewählte Stammgäste in diesem Zyklus und wie viele davon eingezogen sind. */
  regulars: string[];
  regularsMovedIn: number;
}

export interface CycleOptions extends RunOptions {
  /** Anzahl Zyklen am Stück (jeder endet mit Erreichen von `targetStage`). */
  cycles: number;
  /** Wird am Ende des letzten Zyklus mit dem Spielstand aufgerufen (offlineAfterStage mit `cycle`). */
  afterLast?: (state: GameState, rng: RngHolder) => void;
}

/**
 * Stammgäste für den nächsten Zyklus: Tiere des Ökosystems am Ende des Zyklus, sortiert
 * nach ihrem Beitrag zum Maß der Strategie (Wert mit minus Wert ohne das Tier, echte
 * Logik). Der Zufallsspieler nimmt sie in fester, beliebiger Reihenfolge.
 */
export function rankRegulars(state: GameState, strategy: Strategy): string[] {
  const animals = allAnimals(state);
  if (!strategy.plantValue) return animals;
  const value = strategy.plantValue;
  const now = value(evaluate(state));
  const contribution = new Map<string, number>();
  for (const id of animals) {
    const copy = structuredClone(state);
    const niche = SPECIES_BY_ID.get(id)!.niche;
    copy.niches[niche] = copy.niches[niche].filter((x) => x !== id);
    contribution.set(id, now - value(evaluate(copy)));
  }
  return [...animals].sort((a, b) => contribution.get(b)! - contribution.get(a)!);
}

/**
 * Spielt `cycles` Zyklen am Stück mit der echten Logik: Jeder Zyklus endet mit Erreichen
 * von `targetStage` (mindestens Hain), danach `startNewCycle` (Waldgedächtnis, Tagebuch
 * bleibt, Kartenpool mit Tagebuch-Gewicht) und die Wahl der Stammgäste (rankRegulars,
 * so viele, wie Plätze da sind). Sie ziehen ab dem nächsten Wegpunkt ein.
 *
 * Mit `first` ist der erste Zyklus schon gespielt (Checkpoint aus runGame mit demselben Seed
 * und `targetStage`, siehe restartRuns) – das Ergebnis ist dasselbe wie ohne.
 */
export function runCycles(strategy: Strategy, options: CycleOptions, first?: Checkpoint): CycleRun[] {
  const state = first?.state ?? createInitialState(0, options.seed);
  const rng: RngHolder = first?.rng ?? { rngState: normalizeSeed(options.seed * 7919 + 17) };
  const out: CycleRun[] = [];
  let regulars: string[] = [];
  for (let n = 1; n <= options.cycles; n++) {
    // Das Waldgedächtnis ändert sich nur beim Neuen Zyklus – auch am Checkpoint gilt der Anfangswert.
    const memory = state.meta.forestMemory;
    const result = n === 1 && first ? first.result : runGame(strategy, options, { state, rng });
    const preview = previewNewCycle(state);
    out.push({
      number: n,
      result,
      memory,
      memoryGain: preview.memoryGain,
      maxHarmony: preview.maxHarmony,
      newSpecies: preview.newSpecies,
      regulars,
      regularsMovedIn: result.final.counts.regulars,
    });
    if (n === options.cycles) {
      options.afterLast?.(state, rng);
      break;
    }
    const ranked = rankRegulars(state, strategy);
    const started = startNewCycle(state, 0, isTreeUnlocked(state, options.mainTree ?? 'oak') ? options.mainTree : 'oak');
    if (!started.ok) throw new Error(`Neuer Zyklus gescheitert: ${started.error}`);
    regulars = ranked.slice(0, regularSlots(state.meta.forestMemory));
    if (!setRegulars(state, regulars).ok) throw new Error('Stammgäste nicht wählbar');
  }
  return out;
}

/** Wie viel Samen ist eine Sekunde Wachstum wert? (Bewertung der Ereignis-Optionen) */
const SEED_VALUE = 0.4;
/** Horizont für Wirkungen „bis zum Zyklusende“ (s). */
const CYCLE_HORIZON = 1800;
/** Pauschaler Wert (s Wachstum) einer vorgegebenen nächsten Begegnung bzw. geschenkten Aussaat. */
const FORCED_VALUE = 45;

/**
 * Wert einer Ereignis-Option in „Sekunden Wachstum“ – auf einer Kopie des Spielstands
 * mit der echten Aktion gerechnet: zusätzliche Wachstums-Sekunden plus SEED_VALUE ×
 * zusätzliche Samen-Sekunden über die Wirkdauer, sofortige Samen in Samen-Sekunden.
 */
function eventOptionValue(state: GameState, optionIndex: number): number {
  const before = evaluate(state);
  const copy = structuredClone(state);
  const result = chooseEventOption(copy, 0, optionIndex);
  if (!result.ok) return -Infinity;
  const after = evaluate(copy);
  const event = EVENTS_BY_ID.get(state.pendingEncounters[0]!.cards[0]!)!;
  let span = 0;
  let forced = 0;
  for (const e of event.options[optionIndex]!.effects) {
    if (e.kind === 'timed') span = Math.max(span, e.seconds);
    else if (e.kind === 'cycle' || e.kind === 'habitat') span = Math.max(span, CYCLE_HORIZON);
    else if (e.kind === 'nextEncounter' || e.kind === 'freeSowing') forced = FORCED_VALUE;
  }
  const seeds = Math.max(1e-9, before.seeds);
  const gain = after.growth / Math.max(1e-9, before.growth) - 1 + SEED_VALUE * (after.seeds / seeds - 1);
  return SEED_VALUE * ((result.seeds ?? 0) / seeds) + span * gain + forced;
}

/**
 * Ereignis oder Gast an der Spitze der Warteschlange auflösen (echte Logik). Ereignis:
 * Zufallsspieler wählt zufällig, alle anderen die Option mit dem höchsten Wert. Gast:
 * bewirten, wenn die Samen reichen (Zufallsspieler: in der Hälfte der Fälle), sonst
 * ziehen lassen. Ereignisse zählen als lohnend (jedes hat eine Option mit Wirkung außer
 * Samen), Gäste, wenn Bewirten bezahlbar ist.
 */
function resolveExtra(
  state: GameState,
  strategy: Strategy,
  rng: RngHolder,
  counts: Counts,
  book: { earnedExtras: number; spentVisitors: number },
  variety: VarietyStat[],
  time: number,
  purchases: Purchase[],
): void {
  const enc = state.pendingEncounters[0]!;
  counts.encounters++;
  let worthwhile = true;
  if (enc.type === 'event') {
    counts.events++;
    const n = EVENTS_BY_ID.get(enc.cards[0]!)?.options.length ?? 1;
    let choice = 0;
    if (strategy.plantValue === null) choice = randomInt(rng, n);
    else {
      let best = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = eventOptionValue(state, i);
        if (v > best) {
          best = v;
          choice = i;
        }
      }
    }
    const result = chooseEventOption(state, 0, choice);
    if (!result.ok) throw new Error(`Ereignis-Wahl gescheitert: ${result.error}`);
    book.earnedExtras += result.seeds ?? 0;
  } else {
    counts.visitors++;
    // Lohnend, wenn Bewirten bezahlbar ist (wie „lohnende Karte“ – egal, was gewählt wird).
    worthwhile = hostBlocker(state, 0) === null;
    const wants = strategy.plantValue === null ? randomInt(rng, 2) === 0 : true;
    const hosted = wants ? hostVisitor(state, 0) : null;
    if (hosted?.ok) {
      counts.hosted++;
      book.spentVisitors -= hosted.seeds ?? 0;
      purchases.push({ time, stage: state.stage, kind: 'host', cost: -(hosted.seeds ?? 0) });
    } else {
      const result = farewellVisitor(state, 0);
      if (result.ok) book.earnedExtras += result.seeds ?? 0;
    }
  }
  variety.push({ stage: state.stage, time, type: enc.type, cards: 1, sameAsPrevious: false, rerollBlocked: 'no-reroll', worthwhile });
}

/** Pauschaler Wert (relativer Gewinn) eines Platzes bzw. Merkmals – wirkt erst, wenn genutzt. */
const CARE_SLOT_VALUE = 0.03;
const CARE_HABITAT_VALUE = 0.02;
/**
 * Pauschaler Wert der Aussaat-Wirkungen (wirken nicht in `evaluate`): −25 % Preis, +1 Karte,
 * ein Wurf gratis – je Aussaat; geschätzt wie ein Platz, die Karte etwas weniger.
 */
const SOW_COST_VALUE = 0.03;
const SOW_CARDS_VALUE = 0.02;
const SOW_REROLL_VALUE = 0.01;

/** Gabel und Weg (0 = A, 1 = B) je Knoten eines Gabel-Wegs. */
const FORK_OF_NODE: ReadonlyMap<string, { fork: ResearchFork; index: number; side: 0 | 1 }> = new Map(
  RESEARCH_FORKS.flatMap((fork, index) =>
    fork.paths.flatMap((path, side) => path.map((id) => [id, { fork, index, side: side as 0 | 1 }] as const)),
  ),
);

/** Bis auf den Vorrat erforschbar (researchBlocker null oder nur „zu teuer“)? */
const researchOpen = (state: GameState, id: string) => {
  const b = researchBlocker(state, id);
  return b === null || b === 'too-expensive';
};

/**
 * Wert eines Knotens für eine bewertende Strategie: relativer Gewinn an 🌿, 🌰 (SEED_VALUE) und –
 * mit `researchHarmony` – ⚖️ über CYCLE_HORIZON je ⚖️ Kosten (Vorschau mit der echten Logik,
 * previewResearch); Plätze, Merkmale und Aussaat-Wirkungen pauschal.
 */
export function researchValue(state: GameState, strategy: Strategy, node: ResearchNode, now = evaluate(state)): number {
  const after = previewResearch(state, node.id);
  if (!after) return -Infinity;
  let nominal = 0;
  for (const e of node.effects) {
    if (e.kind === 'habitat') nominal += CARE_HABITAT_VALUE;
    else if (e.kind === 'cycle' && e.effect.kind === 'slot') nominal += CARE_SLOT_VALUE;
    else if (e.kind === 'sowCost') nominal += (SOW_COST_VALUE * -e.pct) / 25;
    else if (e.kind === 'sowCards') nominal += SOW_CARDS_VALUE * e.amount;
    else if (e.kind === 'sowFreeReroll') nominal += SOW_REROLL_VALUE * e.amount;
  }
  const rel = (a: number, b: number) => a / Math.max(1e-9, b) - 1;
  const gain =
    rel(after.growth, now.growth) +
    SEED_VALUE * rel(after.seeds, now.seeds) +
    strategy.researchHarmony * rel(after.harmony, now.harmony) +
    nominal;
  return (CYCLE_HORIZON * gain) / (researchCost(state, node.id) ?? node.cost);
}

/**
 * Gabel-Wahl je Strategie (Phase 11, 1e; ersetzt die alte Pflege-Reihenfolge, in der eine Gabel
 * nur „nebenbei“ entschieden wurde): Ist eine Seite schon erforscht, gilt sie. Sonst vergleicht
 * die Strategie die ersten Knoten beider Wege, die bis auf den Vorrat erforschbar sind, mit
 * ihrem Maß (researchValue) und spart auf den besseren; ist nur einer offen, auf diesen. Der
 * Zufallsspieler wirft eine je Zustand feste Münze (Wegpunkt und Gabel; ohne den Zufall der
 * Strategie zu verbrauchen). null = noch keine Seite erreichbar.
 */
export function forkChoice(state: GameState, strategy: Strategy, fork: ResearchFork, index: number, now?: Evaluation): 0 | 1 | null {
  const owned = forkSideOf(state.cycle.research, fork);
  if (owned !== null) return owned;
  const forced = strategy.forks?.[fork.id];
  if (forced !== undefined) return researchOpen(state, fork.paths[forced][0]!) ? forced : null;
  const open = ([0, 1] as const).filter((side) => researchOpen(state, fork.paths[side][0]!));
  if (open.length === 0) return null;
  if (open.length === 1) return open[0]!;
  if (!strategy.plantValue) return ((state.waypoint + index) % 2) as 0 | 1;
  const ev = now ?? evaluate(state);
  const value = (side: 0 | 1) => researchValue(state, strategy, RESEARCH_BY_ID.get(fork.paths[side][0]!)!, ev);
  return value(1) > value(0) ? 1 : 0;
}

/**
 * Welchen Forschungsknoten spart die Strategie als Nächstes an? Nur Knoten, die bis auf den
 * Vorrat erforschbar sind, und an jeder Gabel nur der Weg, den die Strategie wählt
 * (forkChoice). Bewertende Strategien: bester Wert je ⚖️ (researchValue), nur wenn er etwas
 * bringt. Zufallsspieler: ein beliebiger, aber je Zustand fester Knoten. null = nichts.
 */
function careTarget(state: GameState, strategy: Strategy): string | null {
  const now = strategy.plantValue ? evaluate(state) : undefined;
  const sides = new Map<string, 0 | 1 | null>();
  const allowed = (node: ResearchNode) => {
    const f = FORK_OF_NODE.get(node.id);
    if (!f) return true;
    if (!sides.has(f.fork.id)) sides.set(f.fork.id, forkChoice(state, strategy, f.fork, f.index, now));
    const side = sides.get(f.fork.id);
    return side === null || side === f.side;
  };
  const offers = RESEARCH.filter((n) => researchOpen(state, n.id) && allowed(n));
  if (offers.length === 0) return null;
  if (!strategy.plantValue) {
    const bought = state.cycle.research.length;
    return offers[(bought * 5 + state.waypoint) % offers.length]!.id;
  }
  let top: string | null = null;
  let topValue = 0;
  for (const n of offers) {
    const value = researchValue(state, strategy, n, now);
    if (value > topValue) {
      top = n.id;
      topValue = value;
    }
  }
  return top;
}

/** `sowPolicy: 'spend'`: bei vollem Ring säen (tauschen), sobald der Vorrat so viele Aussaaten deckt. */
export const SPEND_RESERVE = 2;

/** Ab welchem Vorrat sät die Strategie (bei `spend` und vollem Ring mit Reserve, sonst der Preis)? */
function sowNeed(state: GameState, strategy: Strategy): number {
  const cost = sowingCost(state);
  const full = state.plants.length >= plantSlots(state.stage);
  return strategy.sowPolicy === 'spend' && full ? SPEND_RESERVE * cost : cost;
}

/**
 * Würde die Strategie jetzt säen (wenn die Samen reichen)? Je Strategie (`sowPolicy`, Phase 11,
 * 1e): `improve` – bei freiem Ring, wenn eine freigeschaltete Pflanze die eigene Wertung
 * verbessert, bei vollem Ring (Tausch, 27.6), wenn eine freigeschaltete Pflanze eine im Ring mit
 * Gewinn ersetzen könnte (Obergrenze dessen, was die Karten bringen können). `spend`
 * (Zufallsspieler): freier Ring immer, voller Ring ab SPEND_RESERVE Aussaaten im Vorrat – die
 * Wahl unter den Karten ist dann zufällig (decideSowing).
 */
function planSow(state: GameState, strategy: Strategy, counts: Counts): boolean {
  void counts;
  const slots = plantSlots(state.stage);
  if (slots <= 0 || sowBlocker(state) === 'stage' || sowBlocker(state) === 'open') return false;
  const pool = unlockedPlants(state);
  if (pool.length === 0) return false;
  const full = state.plants.length >= slots;
  if (strategy.sowPolicy === 'spend') return true;
  if (!strategy.plantValue) return !full;
  const value = strategy.plantValue;
  const now = value(evaluate(state));
  for (const id of pool) {
    for (const replace of full ? [...new Set(state.plants)] : [undefined]) {
      const plants = plantsAfterChoice(state, id, replace);
      if (!plants) continue;
      if (value(evaluateEcosystem(ecosystemOf(state, { plants }))) > now + 1e-9) return true;
    }
  }
  return false;
}

/** Rücklage der Ausbau-Strategie in Samen-Sekunden (spendSeeds; teuerster Gast: 60). */
export const SEED_RESERVE_SECONDS = 60;

/** Rücklage in 🌰 bei dieser Samenrate: SEED_RESERVE_SECONDS Samen-Sekunden plus ein Wurf. */
export function seedReserve(seedsPerSecond: number): number {
  const rate = Number.isFinite(seedsPerSecond) && seedsPerSecond > 0 ? seedsPerSecond : 0;
  return SEED_RESERVE_SECONDS * rate + REROLL_BASE_COST;
}

/** Ausbaustufen je Ziel (Nischen- und Baumteil-IDs, nur Stufen > 0) für Schnappschüsse und Tabellen. */
export function upgradeLevelsOf(state: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of NICHE_IDS) {
    const level = state.cycle.upgrades.niches[id] ?? 0;
    if (level > 0) out[id] = level;
  }
  for (const id of TREE_PART_IDS) {
    const level = state.cycle.upgrades.tree[id] ?? 0;
    if (level > 0) out[id] = level;
  }
  return out;
}

/**
 * Kandidaten der Ausbau-Strategie: die Ausbau-Ziele der Zielzeile (goalCandidates, 28.7 Regel 1)
 * und „Säen“, wenn die Strategie heute säen würde (planSow: bei freiem Ring wie die Zielzeile,
 * bei vollem Ring auch der Tausch, 27.6). „Säen“ steht vorn: Bei Gleichstand gewinnt es (Regel 3).
 */
export function seedGoals(state: GameState, wantsSow: boolean, seedsPerSecond: number): NextGoal[] {
  const list = goalCandidates(state, seedsPerSecond).filter((c) => c.kind !== 'sow');
  const sow = wantsSow ? sowingGoal(state, seedsPerSecond) : null;
  if (sow) list.unshift(sow);
  return list;
}

/**
 * Auswahl wie die Zielzeile (nextGoal, 28.7 Regel 2 und 3): Ein Kandidat genau vor einem
 * Meilenstein mit Wirkung, der in ≤ MILESTONE_GOAL_SECONDS bezahlbar ist, gewinnt (der billigste
 * davon); sonst der billigste. Gleichstand: der frühere (Säen, Nischen, Baumteile).
 */
export function cheapestGoal(candidates: readonly NextGoal[]): NextGoal | null {
  const soon = candidates.filter((c) => c.milestones.length > 0 && c.seconds <= MILESTONE_GOAL_SECONDS);
  const pool = soon.length > 0 ? soon : candidates;
  let top: NextGoal | null = null;
  for (const c of pool) if (top === null || c.cost < top.cost) top = c;
  return top;
}

/**
 * Ausbau-Strategie (Phase 11, 3a; DESIGN_V2.md 28.10, „Simulator“): kauft Ziele, solange die
 * Samen reichen, und liefert die Sekunden, bis das nächste Ziel bezahlbar ist (+1 µs gegen
 * Rundung; Infinity ohne Ziel).
 *
 * - **Bewertende Strategien** folgen der Zielzeile: billigstes Ziel zuerst mit Meilenstein-Regel
 *   (cheapestGoal). Die Aussaat steht mit ihrem Preis unter den Kandidaten, wenn die Strategie
 *   heute säen würde, und hat **Vorrang**, sobald sie bezahlbar ist.
 * - **Zufallsspieler:** Ein freier Platz im Ring hat Vorrang (er füllt ihn immer, `spend`); sonst
 *   kauft er zufällig unter den bezahlbaren Zielen (Ausbau und Tausch, eigener Zufall `rng`) und
 *   wartet, wenn keins reicht, auf das billigste.
 * - **Rücklage** (alle Strategien): Gekauft wird nur, was eine Rücklage von SEED_RESERVE_SECONDS
 *   Samen-Sekunden plus einem Wurf (REROLL_BASE_COST) übrig lässt – sonst wären Neu würfeln und
 *   Bewirten am nächsten Wegpunkt nie bezahlbar (7.7; der teuerste Gast kostet 60 Samen-Sekunden).
 */
function spendSeeds(
  state: GameState,
  strategy: Strategy,
  wantsSow: () => boolean,
  rng: RngHolder,
  ambient: AmbientMode,
  buySowing: () => boolean,
  buyUpgrade: (target: NonNullable<NextGoal['target']>) => boolean,
): number {
  // Ausbau-Ziele einmal je Halt (goalCandidates prüft je Ziel die Sperre – teuer); nach einem Kauf
  // ändert sich nur das gekaufte Ziel, nach dem Säen wird neu gerechnet (Ring, Merkmale).
  let upgradeGoals: NextGoal[] | null = null;
  let wants: boolean | null = null;
  for (let guard = 0; guard < 2000; guard++) {
    const rate = evaluate(state, ambient).seeds;
    if (strategy.seedPolicy === 'goal') {
      // Wie die Zielzeile (nextGoal): Kandidaten mit „Säen“ bei freiem Platz, keine Rücklage.
      upgradeGoals ??= goalCandidates(state, rate);
      for (const g of upgradeGoals) g.seconds = secondsUntilAffordable(g.cost, state.seeds, rate);
      const goal = cheapestGoal(upgradeGoals);
      if (!goal) return Infinity;
      if (goal.cost > state.seeds) return rate > 0 ? (goal.cost - state.seeds) / rate + 1e-6 : Infinity;
      if (goal.kind === 'sow' ? !buySowing() : !buyUpgrade(goal.target!)) return Infinity;
      upgradeGoals = null;
      continue;
    }
    const budget = state.seeds - seedReserve(rate);
    upgradeGoals ??= seedGoals(state, false, rate);
    for (const g of upgradeGoals) g.seconds = secondsUntilAffordable(g.cost, state.seeds, rate);
    // Ob die Strategie säen würde, ändert sich nur mit dem Säen (planSow hängt nicht am Ausbau).
    wants ??= wantsSow();
    const sowGoal = wants ? sowingGoal(state, rate) : null;
    const candidates = sowGoal ? [sowGoal, ...upgradeGoals] : upgradeGoals;
    let goal: NextGoal | null;
    if (strategy.plantValue) {
      goal = sowGoal && sowGoal.cost <= budget ? sowGoal : cheapestGoal(candidates);
    } else if (sowGoal && state.plants.length < plantSlots(state.stage)) {
      goal = sowGoal;
    } else {
      const affordable = candidates.filter((c) => c.cost <= budget);
      goal = affordable.length > 0 ? affordable[randomInt(rng, affordable.length)]! : cheapestGoal(candidates.map((c) => ({ ...c, milestones: [] })));
    }
    if (!goal) return Infinity;
    // Gratis (geschenkte Aussaat, Vogelsaat) geht immer; sonst bis Preis + Rücklage warten.
    if (goal.cost > 0 && goal.cost > budget) return rate > 0 ? (goal.cost - budget) / rate + 1e-6 : Infinity;
    if (goal.kind === 'sow') {
      if (!buySowing()) return Infinity;
      upgradeGoals = null;
      wants = null;
    } else {
      const target = goal.target!;
      if (!buyUpgrade(target)) return Infinity;
      // Nur dieses Ziel ändert sich (Preis, Stufe, Meilenstein); fällt es weg, neu rechnen.
      const level = upgradeLevelOf(state, target) + 1;
      const cost = upgradeCost(state, target);
      if (Number.isFinite(cost)) {
        goal.level = level;
        goal.cost = cost;
        goal.milestones = upgradeMilestones(target).filter((m) => m.level === level && m.kind !== 'badge');
      } else upgradeGoals = null;
    }
  }
  return Infinity;
}

/** „Säen“ als Ziel (Preis der nächsten Aussaat, Zeit bis bezahlbar); null ohne endlichen Preis. */
function sowingGoal(state: GameState, seedsPerSecond: number): NextGoal | null {
  const cost = sowingCost(state);
  if (!Number.isFinite(cost)) return null;
  return { kind: 'sow', target: null, level: null, cost, milestones: [], seconds: secondsUntilAffordable(cost, state.seeds, seedsPerSecond) };
}

/**
 * Wahl bei der offenen Aussaat: Zufallsspieler nimmt eine zufällige Karte (bei vollem Ring
 * zufällig ersetzen oder zurücklegen), bewertende Strategien die beste Platzierung, wenn sie
 * verbessert – sonst würfeln sie neu, wenn der Wurf gratis ist (freeSowingReroll), sonst
 * zurücklegen.
 */
function decideSowing(strategy: Strategy, state: GameState, options: Option[], current: Evaluation, rng: RngHolder): Option | null {
  if (!strategy.plantValue) {
    const card = randomInt(rng, state.cycle.sowing!.cards.length);
    const mine = options.filter((o) => o.card === card);
    if (mine.length === 0) return null;
    if (mine.length === 1 && mine[0]!.replace === undefined) return mine[0]!;
    const k = randomInt(rng, mine.length + 1);
    return k < mine.length ? mine[k]! : null;
  }
  const value = strategy.plantValue;
  const top = best(options, (o) => value(o.ev));
  return top && value(top.ev) > value(current) + 1e-9 ? top : null;
}

/**
 * Gratis-Wurf der Aussaat (Anzuchtbeet, `sowFreeReroll`; Phase 11, 3b): Bewertende Strategien
 * würfeln eine Aussaat neu, wenn keine Karte verbessert und der Wurf nichts kostet – wie bei
 * Tieren höchstens so oft, wie es Gratis-Würfe gibt. Bezahlte Würfe nutzt der Simulator bei
 * der Aussaat nicht (wie bisher); der Zufallsspieler würfelt nie.
 */
function freeSowingReroll(state: GameState, strategy: Strategy): boolean {
  if (!strategy.plantValue || !state.cycle.sowing) return false;
  return sowingRerollCost(state) === 0 && rerollSowingBlocker(state) === null;
}

/**
 * Löst die offene Aussaat auf (falls eine offen ist; eine wartende Vogelsaat öffnet danach
 * und wird mit aufgelöst). Gibt zurück, ob etwas aufgelöst wurde.
 */
function resolveSowingNow(state: GameState, strategy: Strategy, rng: RngHolder, counts: Counts, variety: VarietyStat[], time: number): boolean {
  let any = false;
  for (let guard = 0; state.cycle.sowing && guard < 10; guard++) {
    any = true;
    const current = evaluate(state);
    const options = sowingOptionsFor(state);
    const cards = state.cycle.sowing.cards;
    const improves = options.some((o) => o.ev.harmony > current.harmony + 1e-9 || o.ev.growth > current.growth + 1e-9);
    // Vielfalt (7.7) an der ersten Ziehung; nach einem Gratis-Wurf zählt „lohnend“ wie bei Tieren nach.
    if (state.cycle.sowing.rerolls === 0) {
      variety.push({
        stage: state.stage,
        time,
        type: 'sowing',
        cards: cards.length,
        sameAsPrevious: sameCards(lastCards.get(variety) ?? {}, 'sowing', cards),
        rerollBlocked: rerollSowingBlocker(state),
        worthwhile: improves,
        ids: [...cards],
      });
      rememberCards(variety, 'sowing', cards);
      counts.plantEncounters++;
    } else if (improves) variety[variety.length - 1]!.worthwhile = true;
    const choice = decideSowing(strategy, state, options, current, rng);
    if (!choice && freeSowingReroll(state, strategy)) {
      if (!rerollSowing(state).ok) throw new Error(`Neu würfeln der Aussaat gescheitert (${strategy.id})`);
      counts.sowingRerolls++;
      continue;
    }
    if (choice) {
      if (!chooseSowing(state, choice.card, choice.replace).ok) throw new Error(`Ungültige Aussaat ${choice.id} (${strategy.id})`);
      counts.plantsTaken++;
      if (choice.replace !== undefined) counts.plantsSwapped++;
    } else {
      discardSowing(state);
      counts.declines++;
    }
  }
  return any;
}

function resolveAll(
  state: GameState,
  strategy: Strategy,
  rng: RngHolder,
  counts: Counts,
  book: { earnedDecline: number; spent: number; earnedExtras: number; spentVisitors: number },
  decisions: DecisionStat[],
  variety: VarietyStat[],
  time: number,
  purchases: Purchase[],
): void {
  // Schutz gegen Endlosschleifen: jede Strategie würfelt höchstens einmal je Begegnung.
  for (let guard = 0; (state.pendingEncounters.length > 0 || state.cycle.sowing) && guard < 50; guard++) {
    // Die offene Aussaat (Geschenk an Wegpunkt 2, Vogelsaat) liegt obenauf (27.12).
    if (state.cycle.sowing) {
      const before = state.seeds;
      resolveSowingNow(state, strategy, rng, counts, variety, time);
      book.earnedDecline += Math.max(0, state.seeds - before);
      continue;
    }
    const enc = state.pendingEncounters[0]!;
    if (enc.type === 'event' || enc.type === 'visitor') {
      resolveExtra(state, strategy, rng, counts, book, variety, time, purchases);
      continue;
    }
    const current = evaluate(state);
    const options = optionsFor(state);
    const improves = options.some((o) => o.ev.harmony > current.harmony + 1e-9 || o.ev.growth > current.growth + 1e-9);
    if (enc.rerolls === 0) {
      variety.push({
        stage: state.stage,
        time,
        type: enc.type,
        cards: enc.cards.length,
        sameAsPrevious: sameCards(lastCards.get(variety) ?? {}, enc.type, enc.cards),
        rerollBlocked: rerollBlocker(state, 0),
        worthwhile: improves,
        wildwechsel: enc.via !== undefined,
        ids: [...enc.cards],
      });
      rememberCards(variety, enc.type, enc.cards);
      counts.encounters++;
      if (enc.cards.some((_, c) => cardStatus(state, 0, c) === 'full')) counts.fullNiche++;
    }
    else if (improves) variety[variety.length - 1]!.worthwhile = true;
    recordDecision(state, options, current, decisions);
    const action = strategy.decide(state, options, current, rng);
    const before = state.seeds;
    if (action.kind === 'reroll' && rerollEncounter(state, 0).ok) {
      counts.rerolls++;
      book.spent += before - state.seeds;
      purchases.push({ time, stage: state.stage, kind: 'reroll', cost: before - state.seeds });
      continue;
    }
    if (action.kind === 'choose') {
      const { option } = action;
      if (!chooseCard(state, 0, option.card, option.replace).ok) {
        throw new Error(`Ungültige Wahl ${option.id} (${strategy.id})`);
      }
      if (option.kind !== 'animal') throw new Error('unerwarteter Begegnungstyp');
      else counts.rarityTaken[SPECIES_BY_ID.get(option.id)!.rarity]!++;
    } else {
      declineEncounter(state, 0);
      counts.declines++;
      book.earnedDecline += state.seeds - before;
    }
  }
}

/** Letztes Karten-Set je Begegnungstyp, je Durchgang (am variety-Array festgemacht). */
const lastCards = new WeakMap<VarietyStat[], Partial<Record<PendingEncounterType | 'sowing', string[]>>>();

function rememberCards(variety: VarietyStat[], type: PendingEncounterType | 'sowing', cards: readonly string[]): void {
  const map = lastCards.get(variety) ?? {};
  map[type] = [...cards];
  lastCards.set(variety, map);
}

function sameCards(
  map: Partial<Record<PendingEncounterType | 'sowing', string[]>>,
  type: PendingEncounterType | 'sowing',
  cards: readonly string[],
): boolean {
  const prev = map[type];
  return !!prev && prev.length === cards.length && cards.every((c) => prev.includes(c));
}

function recordDecision(state: GameState, options: Option[], current: Evaluation, decisions: DecisionStat[]): void {
  const cards = state.pendingEncounters[0]!.cards;
  const perCard = cards
    .map((_, i) => {
      const mine = options.filter((o) => o.card === i);
      if (mine.length === 0) return null;
      // Jede Karte mit ihrer besten Platzierung (nach Harmonie).
      const o = mine.reduce((a, b) => (b.ev.harmony > a.ev.harmony ? b : a));
      return {
        h: o.ev.harmony - current.harmony,
        g: o.ev.growth / current.growth - 1,
        s: o.ev.seeds / Math.max(current.seeds, 1e-9) - 1,
      };
    })
    .filter((c): c is { h: number; g: number; s: number } => c !== null);
  if (perCard.length < 2) return;
  const hs = perCard.map((c) => c.h).sort((a, b) => b - a);
  const eps = 1e-9;
  // Pareto-Front über (Harmonie, Wachstum, Samen): Karten, die keine andere klar übertrifft.
  const front = perCard.filter(
    (c) =>
      !perCard.some(
        (d) =>
          d !== c &&
          d.h >= c.h - eps &&
          d.g >= c.g - eps &&
          d.s >= c.s - eps &&
          (d.h > c.h + eps || d.g > c.g + eps || d.s > c.s + eps),
      ),
  );
  decisions.push({
    stage: state.stage,
    best: hs[0]!,
    second: hs[1]!,
    bestGrowth: Math.max(...perCard.map((c) => c.g)),
    pareto: front.length,
  });
}

// ---------------------------------------------------------------------------
// Monte Carlo und Auswertung
// ---------------------------------------------------------------------------

export interface Summary {
  strategy: Strategy;
  runs: RunResult[];
}

export function monteCarlo(
  strategies: readonly Strategy[],
  runs: number,
  options: Omit<RunOptions, 'seed'>,
): Summary[] {
  return strategies.map((strategy) => ({
    strategy,
    runs: Array.from({ length: runs }, (_, i) => runGame(strategy, { ...options, seed: 1000 + 7 * i })),
  }));
}

/**
 * Ein Durchgang für mehrere Ziel-Stufen auf einmal: läuft bis zur höchsten und liefert je
 * Stufe genau das Ergebnis von `runGame(strategy, { ...options, targetStage: stufe })`
 * (Checkpoints über `onStage`). Für Tests, die dieselben Seeds bis zu verschiedenen Stufen
 * brauchen (tests/balance-runs.ts).
 */
export function runStages(strategy: Strategy, stages: readonly number[], options: Omit<RunOptions, 'targetStage'>): Map<number, RunResult> {
  const top = Math.max(...stages);
  const out = new Map<number, RunResult>();
  const result = runGame(strategy, { ...options, targetStage: top }, undefined, (stage, capture) => {
    let copy: RunResult | null = null;
    for (const s of stages) if (s < top && s <= stage && !out.has(s)) out.set(s, (copy ??= capture.result()));
  });
  // Ohne Checkpoint endete der Lauf vorher (Sprung über mehrere Stufen, maxSeconds): gleiches Ende.
  for (const s of stages) if (!out.has(s)) out.set(s, result);
  return out;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? NaN : values.reduce((s, v) => s + v, 0) / values.length;
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '–';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
  // Ab einer Stunde mit Sekunden (h:mm:ss): Der Hain liegt um 60 min, Minuten zählen.
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} h`;
}

const fmt = (x: number, digits = 0) => (Number.isFinite(x) ? x.toFixed(digits).replace('.', ',') : '–');

const snapshotsAt = (summary: Summary, stage: number): Snapshot[] =>
  summary.runs.map((r) => r.stages[stage]).filter((s): s is Snapshot => s != null);

/** Kennzahlen einer Strategie beim Erreichen einer Stufe. */
export function stageStats(summary: Summary, stage: number) {
  const reached = snapshotsAt(summary, stage);
  const times = reached.map((s) => s.time);
  // Takt: Wartezeit vor den Begegnungen, die WÄHREND dieser Stufe erreicht werden.
  const gaps = summary.runs.flatMap((r) => r.gaps.filter((g) => g.stage === stage).map((g) => g.seconds));
  const m = (f: (s: Snapshot) => number) => mean(reached.map(f));
  return {
    reachedShare: reached.length / summary.runs.length,
    time: median(times),
    timeP10: quantile(times, 0.1),
    timeP90: quantile(times, 0.9),
    harmony: m((s) => s.harmony),
    growth: m((s) => s.growth),
    seedsRate: m((s) => s.seedsRate),
    happiness: m((s) => s.happiness),
    animals: m((s) => s.animals),
    plants: m((s) => s.plants),
    supply: m((s) => s.supply),
    genus: GENERA.map((g) => m((s) => s.genus[g])),
    communities: m((s) => s.communities.length),
    communityHarmony: m((s) => s.communityHarmony),
    discovered: m((s) => s.discovered),
    /** Anteil der Durchgänge, in denen die Lebensgemeinschaft gerade aktiv ist (je ID). */
    communityShare: Object.fromEntries(
      COMMUNITIES.map((c) => [c.id, reached.filter((s) => s.communities.includes(c.id)).length / Math.max(1, reached.length)]),
    ) as Record<string, number>,
    seeds: m((s) => s.seeds),
    earnedPassive: m((s) => s.earnedPassive),
    earnedDecline: m((s) => s.earnedDecline),
    spent: m((s) => s.spent),
    spentPlants: m((s) => s.spentPlants),
    spentCare: m((s) => s.spentCare),
    /** Anteil der bis hierher verdienten Samen, der ausgegeben wurde (Mittel je Durchgang, 28.10). */
    seedSpendShare: m(seedSpendShare),
    /** Samenbestand in Minuten Produktion (Mittel je Durchgang; 28.10: ≤ 5 min). */
    seedMinutes: m((s) => s.seeds / Math.max(1e-9, s.seedsRate) / 60),
    /** ⚖️-Vorrat und Vorrat in Minuten Zufluss (Mittel je Durchgang; 28.10: Hain ≤ 10, Urwald ≤ 15 min). */
    harmonyPoints: m((s) => s.harmonyPoints),
    harmonyMinutes: m((s) => s.harmonyPoints / Math.max(1e-9, s.harmonyRate) / 60),
    counts: {
      encounters: m((s) => s.counts.encounters),
      plantEncounters: m((s) => s.counts.plantEncounters),
      plantsTaken: m((s) => s.counts.plantsTaken),
      plantsBought: m((s) => s.counts.plantsBought),
      plantsSwapped: m((s) => s.counts.plantsSwapped),
      upgradesBought: m((s) => s.counts.upgradesBought),
      fullNiche: m((s) => s.counts.fullNiche),
      rerolls: m((s) => s.counts.rerolls),
      declines: m((s) => s.counts.declines),
      autoDeclined: m((s) => s.counts.autoDeclined),
      rarityTaken: [0, 1, 2, 3].map((i) => m((s) => s.counts.rarityTaken[i]!)),
    },
    gapMedian: median(gaps),
    gapMax: gaps.length > 0 ? Math.max(...gaps) : NaN,
    gapsPerRun: gaps.length / summary.runs.length,
  };
}

/** „Knapp“: Abstand der zwei besten Karten höchstens 2 Harmonie oder 30 %. */
export const CLOSE_ABSOLUTE = 2;
export const CLOSE_RELATIVE = 0.3;

/** Wie „echt“ ist die Wahl in den Begegnungen vor Erreichen von `beforeStage`? */
export function decisionStats(summary: Summary, beforeStage: number) {
  const ds = summary.runs.flatMap((r) => r.decisions.filter((d) => d.stage < beforeStage));
  const n = Math.max(1, ds.length);
  const close = (d: DecisionStat) => d.best - d.second <= Math.max(CLOSE_ABSOLUTE, CLOSE_RELATIVE * Math.abs(d.best));
  const worthIt = (d: DecisionStat) => d.best > 0 || d.bestGrowth > 0;
  return {
    /** Begegnungen (inkl. neu gewürfelter Karten) mit mindestens zwei spielbaren Karten. */
    count: ds.length,
    /** Echte Wahl: Zielkonflikt (Pareto ≥ 2) oder knapp – und mindestens eine Karte lohnt sich. */
    realShare: ds.filter((d) => (d.pareto >= 2 || close(d)) && worthIt(d)).length / n,
    /** Eine Karte ist in allem besser und deutlich vorn. */
    obviousShare: ds.filter((d) => d.pareto < 2 && !close(d)).length / n,
    /** Keine Karte verbessert Harmonie oder Wachstum. */
    allBadShare: ds.filter((d) => !worthIt(d)).length / n,
  };
}

/**
 * Vielfalt der Begegnungen in Stufe `stage` (Begegnungen, die in dieser Stufe stattfanden).
 * Durststrecke: Zeit seit der letzten lohnenden Begegnung (bzw. Spielstart), gemessen an
 * jeder lohnenden Begegnung dieser Stufe und am Ende der Stufe (Erreichen der nächsten).
 */
/**
 * Begegnungen mit Karten am Wegpunkt (seit Phase 10 nur Tiere) – nur dort zählen Kartenzahl und
 * Neu würfeln. Aussaaten kauft der Spieler selbst (direkt danach reichen die Samen oft nicht für
 * einen Wurf); sie zählen für Wiederholung, „lohnend“ und Durststrecke mit.
 */
const isCards = (v: VarietyStat) => v.type === 'animal';

export function varietyStats(summary: Summary, stage: number) {
  const vs = summary.runs.flatMap((r) => r.variety.filter((v) => v.stage === stage));
  const n = Math.max(1, vs.length);
  const cardsOnly = vs.filter(isCards);
  const droughts = summary.runs.map((r) => longestDrought(r, stage)).filter((d): d is number => d !== null);
  const share = (f: (v: VarietyStat) => boolean) => vs.filter(f).length / n;
  const cardShare = (f: (v: VarietyStat) => boolean) => cardsOnly.filter(f).length / Math.max(1, cardsOnly.length);
  return {
    count: vs.length,
    sameShare: share((v) => v.sameAsPrevious),
    sameAnimalShare:
      vs.filter((v) => v.type === 'animal' && v.sameAsPrevious).length / Math.max(1, vs.filter((v) => v.type === 'animal').length),
    samePlantShare:
      vs.filter((v) => v.type === 'sowing' && v.sameAsPrevious).length / Math.max(1, vs.filter((v) => v.type === 'sowing').length),
    fewCardsShare: cardShare((v) => v.cards <= 2),
    rerollOpenShare: cardShare((v) => v.rerollBlocked === null),
    rerollTooExpensiveShare: cardShare((v) => v.rerollBlocked === 'too-expensive'),
    rerollNoAltShare: cardShare((v) => v.rerollBlocked === 'no-alternatives' || v.rerollBlocked === 'no-cards'),
    worthShare: share((v) => v.worthwhile),
    /** Längste Durststrecke je Durchgang (s): Median, 90-%-Quantil, Maximum. */
    droughtMedian: median(droughts),
    droughtP90: quantile(droughts, 0.9),
    droughtMax: droughts.length > 0 ? Math.max(...droughts) : NaN,
  };
}

/** Längste Strecke (s) ohne lohnende Begegnung, die in Stufe `stage` endet; null, wenn die Stufe nie lief. */
export function longestDrought(run: RunResult, stage: number): number | null {
  const start = run.stages[stage]?.time;
  if (start === undefined) return null;
  const end = run.stages[stage + 1]?.time ?? run.final.time;
  let last = 0;
  let longest = 0;
  for (const v of run.variety) {
    if (!v.worthwhile) continue;
    if (v.time > start && v.time <= end) longest = Math.max(longest, v.time - last);
    if (v.time > end) break;
    last = v.time;
  }
  // Strecke, die beim Erreichen der nächsten Stufe noch läuft.
  return Math.max(longest, end - last);
}

/**
 * Längste Pause ohne Entscheidung (s) in den ersten `horizon` Sekunden eines Durchgangs:
 * größter Abstand zwischen Spielstart, den Entscheidungen (RunResult.early) und dem Ende
 * des Fensters (bzw. des Durchgangs, falls er früher endet).
 */
export function longestPause(run: RunResult, horizon = EARLY_SECONDS): number {
  const end = Math.min(horizon, run.final.time);
  const points = [0, ...run.early.actions.filter((t) => t <= end), end];
  let longest = 0;
  for (let i = 1; i < points.length; i++) longest = Math.max(longest, points[i]! - points[i - 1]!);
  return longest;
}

/** Frühes Spiel je Strategie: Pausen ohne Entscheidung, Entscheidungen, Samen ungenutzt. */
export function earlyStats(summary: Summary, horizon = EARLY_SECONDS) {
  const pauses = summary.runs.map((r) => longestPause(r, horizon));
  const at5 = summary.runs.map((r) => r.samples[SAMPLE_MINUTES.indexOf(5)]).filter((x): x is Snapshot => x != null);
  return {
    pauseMedian: median(pauses),
    pauseP90: quantile(pauses, 0.9),
    pauseMax: Math.max(...pauses),
    /** Entscheidungen im Fenster (Mittel). */
    actions: mean(summary.runs.map((r) => r.early.actions.filter((t) => t <= horizon).length)),
    /** Höchster Samenbestand vor EARLY_SEED_STAGE (Mittel und 90 %). */
    seedPeak: mean(summary.runs.map((r) => r.early.seedPeak)),
    seedPeakP90: quantile(summary.runs.map((r) => r.early.seedPeak), 0.9),
    /** Nach 5 Minuten: Stufe (Median), Harmonie (Mittel). */
    stageAt5: Math.round(median(at5.map((x) => x.stage))),
    harmonyAt5: mean(at5.map((x) => x.harmony)),
  };
}

export function earlyTable(summaries: Summary[], horizon = EARLY_SECONDS): string {
  const lines = [
    `| Strategie | längste Pause ohne Entscheidung (erste ${fmt(horizon / 60)} min) Median / 90 % / max | Entscheidungen | Samen ungenutzt: Höchststand vor ${STAGES[EARLY_SEED_STAGE]!.name} Ø / 90 % | nach 5 min: Stufe / ⚖️ |`,
    '|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const e = earlyStats(s, horizon);
    lines.push(
      `| ${s.strategy.name} | ${formatTime(e.pauseMedian)} / ${formatTime(e.pauseP90)} / ${formatTime(e.pauseMax)} | ${fmt(e.actions, 1)} | ${fmt(e.seedPeak)} / ${fmt(e.seedPeakP90)} | ${STAGES[e.stageAt5]?.name ?? '–'} / ${fmt(e.harmonyAt5, 1)} |`,
    );
  }
  return lines.join('\n');
}

/** Vielfalt aller Begegnungen vor Erreichen von `beforeStage` (Ziele: DESIGN_V2.md 7.7). */
export function varietyBefore(summary: Summary, beforeStage: number) {
  const vs = summary.runs.flatMap((r) => r.variety.filter((v) => v.stage < beforeStage));
  const n = Math.max(1, vs.length);
  const share = (f: (v: VarietyStat) => boolean) => vs.filter(f).length / n;
  // Kartenzahl und Neu würfeln nur bei Tierbegegnungen (Ereignisse/Gäste: eine Karte, kein Wurf; Aussaat: Kauf).
  const cards = vs.filter(isCards);
  const cardShare = (f: (v: VarietyStat) => boolean) => cards.filter(f).length / Math.max(1, cards.length);
  // Längste Durststrecke je Durchgang über alle Stufen vor `beforeStage`.
  const droughts = summary.runs.map((r) => {
    const ds = Array.from({ length: beforeStage - 1 }, (_, i) => longestDrought(r, i + 1) ?? 0);
    return Math.max(0, ...ds);
  });
  return {
    sameShare: share((v) => v.sameAsPrevious),
    /** Ab Setzling (im Keimling gibt es nur 2 Pflanzen und 3 Arten – gewollt). */
    fewCardsShare: cards.filter((v) => v.stage >= 2 && v.cards <= 2).length / Math.max(1, cards.filter((v) => v.stage >= 2).length),
    rerollOpenShare: cardShare((v) => v.rerollBlocked === null),
    worthShare: share((v) => v.worthwhile),
    droughtMedian: median(droughts),
    droughtP90: quantile(droughts, 0.9),
    droughtMax: Math.max(...droughts),
  };
}

export function varietySummaryTable(summaries: Summary[], beforeStage: number): string {
  const pct = (x: number) => `${fmt(x * 100)} %`;
  const lines = [
    '| Strategie | gleiches Set wie vorige | 1–2 Karten (ab Setzling) | Neu würfeln möglich | lohnend | längste Durststrecke Median / 90 % / max |',
    '|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const v = varietyBefore(s, beforeStage);
    lines.push(
      `| ${s.strategy.name} | ${pct(v.sameShare)} | ${pct(v.fewCardsShare)} | ${pct(v.rerollOpenShare)} | ${pct(v.worthShare)} | ${formatTime(v.droughtMedian)} / ${formatTime(v.droughtP90)} / ${formatTime(v.droughtMax)} |`,
    );
  }
  return lines.join('\n');
}

export function varietyTable(summary: Summary, upTo: number): string {
  const lines = [
    '| Stufe | Begegnungen | gleiches Set wie vorige (Tier / Pflanze) | nur 1–2 Karten | Neu würfeln möglich | gesperrt: zu teuer / keine Alternative | lohnend | längste Durststrecke Median / 90 % / max |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (let s = 1; s <= upTo; s++) {
    const v = varietyStats(summary, s);
    if (v.count === 0) continue;
    const pct = (x: number) => `${fmt(x * 100)} %`;
    lines.push(
      `| ${STAGES[s]!.name} | ${fmt(v.count / summary.runs.length, 1)} | ${pct(v.sameShare)} (${pct(v.sameAnimalShare)} / ${pct(v.samePlantShare)}) | ${pct(v.fewCardsShare)} | ${pct(v.rerollOpenShare)} | ${pct(v.rerollTooExpensiveShare)} / ${pct(v.rerollNoAltShare)} | ${pct(v.worthShare)} | ${formatTime(v.droughtMedian)} / ${formatTime(v.droughtP90)} / ${formatTime(v.droughtMax)} |`,
    );
  }
  return lines.join('\n');
}

export function strategyTable(summaries: Summary[], stage: number): string {
  const name = STAGES[stage]!.name;
  const lines = [
    `| Strategie | ${name} nach (Median) | ⚖️ Harmonie | 🌿/s | 🌰/s | Ø Zufriedenheit | Tiere ${GENERA.map((g) => GENUS_INFO[g].icon).join('/')} | Pflanzen | Versorgung | echte Wahl |`,
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const st = stageStats(s, stage);
    const d = decisionStats(s, stage);
    lines.push(
      `| ${s.strategy.name} | ${formatTime(st.time)} | ${fmt(st.harmony, 1)} | ${fmt(st.growth, 1)} | ${fmt(st.seedsRate, 2)} | ${fmt(st.happiness * 100)} % | ${st.genus.map((g) => fmt(g, 1)).join(' / ')} | ${fmt(st.plants, 1)} | ${fmt(st.supply * 100)} % | ${fmt(d.realShare * 100)} % |`,
    );
  }
  return lines.join('\n');
}

/** Lebensgemeinschaften beim Erreichen einer Stufe: Anzahl, Harmonie-Anteil, häufigste. */
export function communityTable(summaries: Summary[], stage: number): string {
  const lines = [
    '| Strategie | aktiv (Ø) | ⚖️ daraus | Anteil an ⚖️ | entdeckt (Ø) | häufigste (Anteil der Durchgänge) |',
    '|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const st = stageStats(s, stage);
    const top = COMMUNITIES.map((c) => ({ name: c.name, share: st.communityShare[c.id] ?? 0 }))
      .filter((c) => c.share >= 0.05)
      .sort((a, b) => b.share - a.share)
      .slice(0, 3)
      .map((c) => `${c.name} ${fmt(c.share * 100)} %`)
      .join(', ');
    lines.push(
      `| ${s.strategy.name} | ${fmt(st.communities, 2)} | ${fmt(st.communityHarmony, 1)} | ${fmt((st.communityHarmony / Math.max(1e-9, st.harmony)) * 100)} % | ${fmt(st.discovered, 2)} | ${top || '–'} |`,
    );
  }
  return lines.join('\n');
}

export function stageTable(summary: Summary, targets: readonly (string | null)[]): string {
  const lines = [
    '| Stufe | Ziel | Median | 10–90 % | ⚖️ | 🌿/s | 🌰/s | Ø Zufr. | Tiere / Pflanzen | Begegnungen im Abschnitt | Takt Median | Takt max |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (let s = 1; s < STAGES.length; s++) {
    const st = stageStats(summary, s);
    if (st.reachedShare === 0) continue;
    const share = st.reachedShare < 1 ? ` (${fmt(st.reachedShare * 100)} % erreicht)` : '';
    lines.push(
      `| ${STAGES[s]!.name}${share} | ${targets[s] ?? '–'} | ${formatTime(st.time)} | ${formatTime(st.timeP10)} – ${formatTime(st.timeP90)} | ${fmt(st.harmony)} | ${fmt(st.growth, 1)} | ${fmt(st.seedsRate, 2)} | ${fmt(st.happiness * 100)} % | ${fmt(st.animals, 1)} / ${fmt(st.plants, 1)} | ${fmt(st.gapsPerRun, 1)} | ${formatTime(st.gapMedian)} | ${formatTime(st.gapMax)} |`,
    );
  }
  return lines.join('\n');
}

/** Samen-Verlauf über die Spielzeit (Mittel über alle Durchgänge, die so lange liefen). */
export function seedTable(summary: Summary): string {
  const lines = [
    '| Zeit | Stufe (Median) | Bestand 🌰 | verdient passiv | verdient Ablehnen | ausgegeben Pflanzen | ausgegeben Neu würfeln | ausgegeben Ausbau | Pflanzen (gesetzt / gekeimt) | Bestand in Minuten Produktion |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  SAMPLE_MINUTES.forEach((minutes, i) => {
    const xs = summary.runs.map((r) => r.samples[i]).filter((s): s is Snapshot => s != null);
    if (xs.length < summary.runs.length / 2) return;
    const m = (f: (s: Snapshot) => number) => mean(xs.map(f));
    const stage = STAGES[Math.round(median(xs.map((s) => s.stage)))]!.name;
    lines.push(
      `| ${minutes} min | ${stage} | ${fmt(m((s) => s.seeds))} | ${fmt(m((s) => s.earnedPassive))} | ${fmt(m((s) => s.earnedDecline))} | ${fmt(m((s) => s.spentPlants))} | ${fmt(m((s) => s.spent))} | ${fmt(m((s) => s.spentUpgrades ?? 0))} | ${fmt(m((s) => s.counts.plantsBought), 1)} / ${fmt(m((s) => s.counts.plantsTaken), 1)} | ${fmt(m((s) => s.seeds) / Math.max(m((s) => s.seedsRate), 1e-9) / 60, 1)} |`,
    );
  });
  return lines.join('\n');
}

export function miscTable(summaries: Summary[], stage: number): string {
  const lines = [
    '| Strategie | Begegnungen | davon Pflanzen | Tier: Nische voll | neu gewürfelt | abgelehnt | autom. abgelehnt | gewählt g / s / b / l | Pflanzen gekeimt / gesetzt | eindeutig | keine Karte lohnt |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const c = stageStats(s, stage).counts;
    const d = decisionStats(s, stage);
    lines.push(
      `| ${s.strategy.name} | ${fmt(c.encounters, 1)} | ${fmt(c.plantEncounters, 1)} | ${fmt(c.fullNiche, 1)} | ${fmt(c.rerolls, 1)} | ${fmt(c.declines, 1)} | ${fmt(c.autoDeclined, 1)} | ${c.rarityTaken.map((x) => fmt(x, 1)).join(' / ')} | ${fmt(c.plantsTaken, 1)} / ${fmt(c.plantsBought, 1)} | ${fmt(d.obviousShare * 100)} % | ${fmt(d.allBadShare * 100)} % |`,
    );
  }
  return lines.join('\n');
}

/**
 * Zielzeiten (DESIGN_V2.md, Abschnitt 3 und 15.4) für den harmonie-orientierten Spieler
 * mit allen Systemen. Setzling seit Schritt 2.10 ~45 s (Wunsch des Nutzers: „45 Sekunden
 * sollte der Sweetspot sein“), vorher ~1 min.
 */
export const STAGE_TARGETS: readonly { stage: number; seconds: number; label: string }[] = [
  { stage: 1, seconds: 30, label: '< 30 s' },
  { stage: 2, seconds: 45, label: '~ 45 s' },
  { stage: 3, seconds: 4 * 60, label: '~ 4 min' },
  { stage: 4, seconds: 20 * 60, label: '~ 20 min' },
  { stage: 5, seconds: 60 * 60, label: '~ 60 min' },
  { stage: 6, seconds: 100 * 60, label: '~ 1:40 h' },
  { stage: 7, seconds: 140 * 60, label: '~ 2:20 h' },
];

export const TARGET_LABELS: readonly (string | null)[] = STAGES.map(
  (_, s) => STAGE_TARGETS.find((t) => t.stage === s)?.label ?? null,
);

/** Vollständiger Bericht als Markdown (Protokoll und DESIGN_V2.md 15.4). */
export function report(summaries: Summary[], focusStage: number): string {
  const harmony = summaries.find((s) => s.strategy.id === 'harmony') ?? summaries[0]!;
  const random = summaries.find((s) => s.strategy.id === 'random');
  const main = summaries.filter((s) => ['harmony', 'growth', 'random'].includes(s.strategy.id));
  const deep = summaries.filter((s) => s.runs.some((r) => r.stages[STAGES.length - 1] != null));
  const name = STAGES[focusStage]!.name;
  return [
    `#### Strategien beim Erreichen von „${name}“ (${harmony.runs.length} Durchgänge je Strategie)`,
    '',
    strategyTable(summaries, focusStage),
    '',
    `#### Lebensgemeinschaften beim Erreichen von „${name}“`,
    '',
    communityTable(summaries, focusStage),
    '',
    '#### Stufen und Takt – Gierig nach Harmonie',
    '',
    stageTable(harmony, TARGET_LABELS),
    ...(random ? ['', '#### Stufen und Takt – Zufällig', '', stageTable(random, TARGET_LABELS)] : []),
    '',
    '#### Samen über die Zeit – Gierig nach Harmonie',
    '',
    seedTable(harmony),
    ...(random ? ['', '#### Samen über die Zeit – Zufällig', '', seedTable(random)] : []),
    '',
    `#### Vielfalt der Begegnungen – Gierig nach Harmonie`,
    '',
    varietyTable(harmony, STAGES.length - 2),
    ...(random ? ['', '#### Vielfalt der Begegnungen – Zufällig', '', varietyTable(random, STAGES.length - 2)] : []),
    '',
    `#### Vielfalt bis ${name} je Strategie`,
    '',
    varietySummaryTable(summaries, focusStage),
    '',
    `#### Begegnungen bis ${name} (Mittel je Durchgang)`,
    '',
    miscTable(summaries, focusStage),
    '',
    '#### Frühes Spiel – Pausen ohne Entscheidung und ungenutzte Samen (erste 6 bzw. 10 Minuten)',
    '',
    earlyTable(summaries, 360),
    '',
    earlyTable(summaries),
    '',
    '#### Samen-Senke und Vorräte je Stufe (DESIGN_V2.md 28.10)',
    '',
    economyTable(main, [3, 4, 5, 6, 7]),
    '',
    '#### Ausbaustufen beim Erreichen der Stufen – Gierig nach Harmonie (Modell 28.5)',
    '',
    upgradeTable(harmony, [3, 4, 5, 6, 7]),
    ...(random ? ['', '#### Ausbaustufen – Zufällig', '', upgradeTable(random, [3, 4, 5, 6, 7])] : []),
    '',
    '#### Gabel-Wahl beim Wald und am Ende (27.11: Weg A beim Harmonie-Spieler 25–75 %)',
    '',
    // Nur Strategien, die bis zum Urwald laufen (seit Phase 11, 3b die Stapler nur bis zum Hain).
    forkTable(deep, 6),
    '',
    forkTable(deep, 'final'),
    '',
    '#### Takt der Käufe – Gierig nach Harmonie (28.10: Median 20–60 s, längste Pause bis Hain ≤ 2 min)',
    '',
    purchaseTable(harmony),
    ...(random ? ['', '#### Takt der Käufe – Zufällig', '', purchaseTable(random)] : []),
  ].join('\n');
}

/**
 * Ereignisse und Durchreisende (Schritt 2.4, echte Logik): je Strategie Stufenzeiten,
 * Harmonie beim Hain, längste Durststrecke je Stufe (90-%-Quantil und Maximum), Anzahl
 * je Durchgang.
 */
export function extrasTable(summaries: Summary[]): string {
  const lines = [
    '| Strategie | Alter Baum | Hain | Wald | Urwald | ⚖️ beim Hain | Durststrecke Alter Baum 90 % / max | Hain 90 % / max | Wald 90 % / max | Ereignisse / Gäste (bewirtet) je Durchgang |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const times = [4, 5, 6, 7].map((st) => formatTime(stageStats(s, st).time));
    const d = [4, 5, 6].map((st) => {
      const v = varietyStats(s, st);
      return `${formatTime(v.droughtP90)} / ${formatTime(v.droughtMax)}`;
    });
    const c = s.runs.map((r) => r.final.counts);
    const extra = `${fmt(mean(c.map((x) => x.events)), 1)} / ${fmt(mean(c.map((x) => x.visitors)), 1)} (${fmt(mean(c.map((x) => x.hosted)), 1)})`;
    lines.push(`| ${s.strategy.name} | ${times.join(' | ')} | ${fmt(stageStats(s, 5).harmony, 1)} | ${d.join(' | ')} | ${extra} |`);
  }
  return lines.join('\n');
}

/**
 * Jahreszeiten und Baumarten (grobes Modell, DESIGN_V2.md 16.5 und 17.4): je Variante
 * Stufenzeiten, Harmonie, Ø Zufriedenheit und Wachstum beim Hain, längste Durststrecke
 * (90 %) im Alten Baum und im Hain, Pflanzenbegegnungen bis Hain, Ereignisse / Gäste.
 */
export function environmentTable(rows: readonly { label: string; summary: Summary }[]): string {
  const lines = [
    '| Variante | Junger Baum | Alter Baum | Hain | Wald | Urwald | ⚖️ beim Hain | Ø 😊 beim Hain | 🌿/s beim Hain | Durststrecke Alter Baum / Hain (90 %) | Pflanzenbegegnungen bis Hain | Ereignisse / Gäste |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const { label, summary } of rows) {
    const times = [3, 4, 5, 6, 7].map((st) => formatTime(stageStats(summary, st).time));
    const hain = stageStats(summary, 5);
    const d = [4, 5].map((st) => formatTime(varietyStats(summary, st).droughtP90)).join(' / ');
    const c = summary.runs.map((r) => r.final.counts);
    const extra = `${fmt(mean(c.map((x) => x.events)), 1)} / ${fmt(mean(c.map((x) => x.visitors)), 1)}`;
    lines.push(
      `| ${label} | ${times.join(' | ')} | ${fmt(hain.harmony, 1)} | ${fmt(100 * hain.happiness)} % | ${fmt(hain.growth, 1)} | ${d} | ${fmt(hain.counts.plantEncounters, 1)} | ${extra} |`,
    );
  }
  return lines.join('\n');
}

/**
 * Forschung (seit v17, echte Logik; bis v16 Pflege): Vergleich ohne/mit – Stufenzeiten,
 * Harmonie, Samenbestand (absolut und in Minuten Produktion) beim Hain und im Wald, für
 * Forschung ausgegeben (⚖️), Anteil der Durchgänge je Knoten beim Hain / am Ende.
 */
export function careTable(without: Summary[], withCare: Summary[]): string {
  const lines = [
    '| Strategie | Forschung | Alter Baum | Hain | Wald | Urwald | ⚖️ beim Hain | 🌰-Bestand beim Hain (min Produktion) | im Wald | ⚖️ für Forschung bis Hain / Wald | Knoten bis Hain / Urwald |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const bank = (s: Summary, stage: number) => {
    const st = stageStats(s, stage);
    return `${fmt(st.seeds)} (${fmt(st.seeds / st.seedsRate / 60, 1)})`;
  };
  for (const [label, list] of [['ohne', without], ['mit', withCare]] as const) {
    for (const s of list) {
      const times = [4, 5, 6, 7].map((st) => formatTime(stageStats(s, st).time));
      const ranks = (pick: (r: RunResult) => Snapshot | null) =>
        fmt(mean(s.runs.map((r) => Object.values(pick(r)?.careRanks ?? {}).reduce((a, b) => a + b, 0))), 1);
      const care =
        label === 'ohne'
          ? '– | –'
          : `${fmt(stageStats(s, 5).spentCare)} / ${fmt(stageStats(s, 6).spentCare)} | ${ranks((r) => r.stages[5] ?? null)} / ${ranks((r) => r.final)}`;
      lines.push(`| ${s.strategy.name} | ${label} | ${times.join(' | ')} | ${fmt(stageStats(s, 5).harmony, 1)} | ${bank(s, 5)} | ${bank(s, 6)} | ${care} |`);
    }
  }
  lines.push('', '| Knoten | ' + withCare.map((s) => `${s.strategy.name}: bis Hain / Urwald`).join(' | ') + ' |');
  lines.push('|---|' + withCare.map(() => '---|').join(''));
  for (const c of RESEARCH) {
    const cells = withCare.map((s) => {
      const at = (pick: (r: RunResult) => Snapshot | null) => fmt(mean(s.runs.map((r) => pick(r)?.careRanks[c.id] ?? 0)), 2);
      return `${at((r) => r.stages[5] ?? null)} / ${at((r) => r.final)}`;
    });
    lines.push(`| ${c.icon} ${c.name} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

const signedPct = (x: number) => `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x) * 100, 1)} %`;

/**
 * Baumarten (DESIGN_V2.md 17, Balancing 2.10): je Strategie Hain-Zeit (Median), Abstand zur
 * Eiche und Harmonie beim Hain. `rows`: Strategie → Ergebnis je Art (gleiche Seeds).
 */
export function treeTable(rows: readonly { strategy: Strategy; trees: Record<MainTreeId, Summary> }[]): string {
  const lines = [
    '| Strategie | Eiche: Hain / ⚖️ | Buche: Hain / ⚖️ / gegenüber Eiche | Kiefer: Hain / ⚖️ / gegenüber Eiche |',
    '|---|---|---|---|',
  ];
  for (const { strategy, trees } of rows) {
    const oak = stageStats(trees.oak, 5);
    const cell = (id: 'beech' | 'pine') => {
      const st = stageStats(trees[id], 5);
      return `${formatTime(st.time)} / ${fmt(st.harmony, 1)} / ${signedPct(st.time / oak.time - 1)}`;
    };
    lines.push(`| ${strategy.name} | ${formatTime(oak.time)} / ${fmt(oak.harmony, 1)} | ${cell('beech')} | ${cell('pine')} |`);
  }
  return lines.join('\n');
}

/**
 * Mehrere Zyklen am Stück (runCycles): je Strategie und Zyklus Stufenzeiten (Median),
 * Hain gegenüber Zyklus 1, Waldgedächtnis zu Beginn und Gewinn, neu entdeckte Arten,
 * Stammgäste (gewählt / eingezogen) und Harmonie beim Hain.
 */
export function cycleTable(rows: readonly { strategy: Strategy; runs: CycleRun[][] }[]): string {
  const lines = [
    '| Strategie | Zyklus | Setzling | Junger Baum | Alter Baum | Hain | Hain gegenüber Zyklus 1 | Waldgedächtnis zu Beginn / Gewinn | neue Arten | Stammgäste gewählt / eingezogen | ⚖️ beim Hain |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const { strategy, runs } of rows) {
    const cycles = runs[0]?.length ?? 0;
    const hainOf = (c: number) => median(runs.map((r) => r[c]!.result.stages[5]?.time ?? NaN));
    for (let c = 0; c < cycles; c++) {
      const cs = runs.map((r) => r[c]!);
      const at = (stage: number) => formatTime(median(cs.map((r) => r.result.stages[stage]?.time ?? NaN)));
      const m = (f: (r: CycleRun) => number) => mean(cs.map(f));
      lines.push(
        `| ${strategy.name} | ${c + 1} | ${at(2)} | ${at(3)} | ${at(4)} | ${at(5)} | ${c === 0 ? '–' : signedPct(hainOf(c) / hainOf(0) - 1)} | ${fmt(m((r) => r.memory), 1)} / +${fmt(m((r) => r.memoryGain), 1)} | ${fmt(m((r) => r.newSpecies), 1)} | ${fmt(m((r) => r.regulars.length), 2)} / ${fmt(m((r) => r.regularsMovedIn), 2)} | ${fmt(m((r) => r.result.stages[5]?.harmony ?? NaN), 1)} |`,
      );
    }
  }
  return lines.join('\n');
}

/** Ein Lauf über mehrere Zyklen mit Neustart in einer bestimmten Stufe (restartTable). */
export interface RestartRow {
  /** Stufe (Index in STAGES), in der jeder Zyklus neu beginnt (= targetStage). */
  stage: number;
  strategy: Strategy;
  runs: CycleRun[][];
}

/** Zeit bis zur Ziel-Stufe in Zyklus `c` (Median, s). */
export function restartTime(row: RestartRow, c: number): number {
  return median(row.runs.map((r) => r[c]?.result.stages[row.stage]?.time ?? NaN));
}

/** Mittlerer Gedächtnis-Gewinn am Ende von Zyklus `c`. */
export function restartGain(row: RestartRow, c: number): number {
  return mean(row.runs.map((r) => r[c]?.memoryGain ?? NaN));
}

/**
 * Neustart in verschiedenen Stufen (Schritt 2.11b): je Stufe und Strategie die Zeit bis zur
 * Ziel-Stufe je Zyklus (Median), H_max und Gedächtnis-Gewinn je Zyklus (Mittel), die Summe
 * über alle Zyklen, das Verhältnis Wachstum/Harmonie je Zyklus und der Gewinn in Zyklus 1
 * gegenüber dem Neustart im Hain derselben Strategie.
 */
export function restartTable(rows: readonly RestartRow[]): string {
  const cycles = rows[0]?.runs[0]?.length ?? 0;
  const list = (f: (c: number) => string) => Array.from({ length: cycles }, (_, c) => f(c)).join(' / ');
  const lines = [
    '| Neustart | Strategie | Ziel-Stufe je Zyklus | H_max je Zyklus | Gedächtnis-Gewinn je Zyklus | Gewinn Zyklus 1 / Hain | Summe | Wachstum / Harmonie je Zyklus |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const hain = rows.find((r) => r.strategy === row.strategy && r.stage === NEW_CYCLE_MIN_STAGE);
    const harmony = rows.find((r) => r.stage === row.stage && r.strategy.id === HARMONY.id);
    const growth = rows.find((r) => r.stage === row.stage && r.strategy.id === GROWTH.id);
    const ratio = row.strategy.id === HARMONY.id && harmony && growth ? list((c) => fmt(restartTime(growth, c) / restartTime(harmony, c), 3)) : '';
    const total = Array.from({ length: cycles }, (_, c) => restartTime(row, c)).reduce((a, b) => a + b, 0);
    lines.push(
      `| ${STAGES[row.stage]?.name ?? row.stage} | ${row.strategy.name} | ${list((c) => formatTime(restartTime(row, c)))} | ${list((c) => fmt(mean(row.runs.map((r) => r[c]!.maxHarmony)), 1))} | ${list((c) => fmt(restartGain(row, c), 1))} | ${hain ? fmt(restartGain(row, 0) / restartGain(hain, 0), 2) : '–'} | ${formatTime(total)} | ${ratio} |`,
    );
  }
  return lines.join('\n');
}

/** Verlauf der Vorschau „Neuer Zyklus“ zwischen Hain und Ziel-Stufe (memoryPath) je Zyklus. */
export interface MemoryPathStats {
  /** Anteil der Wegpunkte, an denen die Vorschau beim Erreichen unter dem Wert davor liegt. */
  dropShare: number;
  /** Mittlerer Rückgang in diesen Fällen (negativ) und der größte. */
  meanDrop: number;
  worstDrop: number;
  /** Mittelwert der Vorschau (nach der Wahl) je Wegpunkt ab dem Hain. */
  meanPath: number[];
  /** Größte Delle im Mittelwert-Verlauf (≤ 0). */
  worstMeanDip: number;
}

export function memoryPathStats(runs: readonly CycleRun[][], c: number): MemoryPathStats {
  let steps = 0;
  let drops = 0;
  let sum = 0;
  let worst = 0;
  const byWaypoint = new Map<number, number[]>();
  for (const run of runs) {
    const path = run[c]?.result.memoryPath ?? [];
    for (const p of path) byWaypoint.set(p.waypoint, [...(byWaypoint.get(p.waypoint) ?? []), p.after]);
    for (let i = 1; i < path.length; i++) {
      steps++;
      const d = path[i]!.arrive - path[i - 1]!.after;
      if (d < 0) {
        drops++;
        sum += d;
        worst = Math.min(worst, d);
      }
    }
  }
  const meanPath = [...byWaypoint.keys()].sort((a, b) => a - b).map((w) => mean(byWaypoint.get(w)!));
  const worstMeanDip = Math.min(0, ...meanPath.slice(1).map((v, i) => v - meanPath[i]!));
  return { dropShare: steps ? drops / steps : 0, meanDrop: drops ? sum / drops : 0, worstDrop: worst, meanPath, worstMeanDip };
}

/** Tabelle zu memoryPathStats: je Zeile Strategie und Zyklus. */
export function memoryPathTable(rows: readonly RestartRow[]): string {
  const lines = [
    '| Neustart | Strategie | Zyklus | Vorschau sinkt beim Erreichen | Rückgang Mittel / größter | Mittelwert je Wegpunkt ab Hain | größte Delle im Mittel |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    if (row.stage === NEW_CYCLE_MIN_STAGE) continue;
    const cycles = row.runs[0]?.length ?? 0;
    for (let c = 0; c < cycles; c++) {
      const st = memoryPathStats(row.runs, c);
      lines.push(
        `| ${STAGES[row.stage]?.name ?? row.stage} | ${row.strategy.name} | ${c + 1} | ${fmt(st.dropShare * 100)} % | ${fmt(st.meanDrop, 1)} / ${fmt(st.worstDrop)} | ${st.meanPath.map((v) => fmt(v)).join(' ')} | ${fmt(st.worstMeanDip, 1)} |`,
      );
    }
  }
  return lines.join('\n');
}

/** runCycles für mehrere Durchgänge (Seeds wie monteCarlo). */
export function monteCarloCycles(strategy: Strategy, runs: number, options: Omit<CycleOptions, 'seed'>): CycleRun[][] {
  return Array.from({ length: runs }, (_, i) => runCycles(strategy, { ...options, seed: 1000 + 7 * i }));
}

/**
 * runCycles mit Neustart in mehreren Stufen auf einmal (Seed `seed`): Der erste Zyklus läuft
 * nur einmal bis zur höchsten Stufe; an den übrigen Stufen zweigt ein Checkpoint ab (runGame,
 * `onStage`), von dem aus die weiteren Zyklen mit dieser Ziel-Stufe laufen. Ergebnis je Stufe
 * genau wie `runCycles(strategy, { ...options, seed, targetStage: stufe })` – nur ohne den
 * gemeinsamen Anfang mehrfach zu rechnen (Laufzeit der Balancing-Tests).
 */
export function branchCycles(
  strategy: Strategy,
  stages: readonly number[],
  options: Omit<CycleOptions, 'targetStage'>,
): Map<number, CycleRun[]> {
  const top = Math.max(...stages);
  const state = createInitialState(0, options.seed);
  const rng: RngHolder = { rngState: normalizeSeed(options.seed * 7919 + 17) };
  const checkpoints = new Map<number, Checkpoint>();
  const result = runGame(strategy, { ...options, targetStage: top }, { state, rng }, (stage, capture) => {
    // Mehrere Stufen auf einmal übersprungen: jede bekommt ihre eigene Kopie.
    for (const s of stages) {
      if (s < top && s <= stage && !checkpoints.has(s)) checkpoints.set(s, { ...capture.state(), result: capture.result() });
    }
  });
  const out = new Map<number, CycleRun[]>();
  for (const s of stages) {
    if (s === top) continue;
    // Ohne Checkpoint endete der Lauf, bevor er weiterlief (Sprung über mehrere Stufen oder
    // maxSeconds) – dann ist das Ende auch das Ende des kürzeren Laufs.
    const cp = checkpoints.get(s) ?? structuredClone({ state, rng, result });
    out.set(s, runCycles(strategy, { ...options, targetStage: s }, cp));
  }
  out.set(top, runCycles(strategy, { ...options, targetStage: top }, { state, rng, result }));
  return out;
}

/** branchCycles für mehrere Durchgänge (Seeds wie monteCarlo): je Stufe die Durchgänge. */
export function monteCarloBranches(
  strategy: Strategy,
  runs: number,
  stages: readonly number[],
  options: Omit<CycleOptions, 'seed' | 'targetStage'>,
): Map<number, CycleRun[][]> {
  const out = new Map<number, CycleRun[][]>(stages.map((s) => [s, []]));
  for (let i = 0; i < runs; i++) {
    for (const [s, run] of branchCycles(strategy, stages, { ...options, seed: 1000 + 7 * i })) out.get(s)!.push(run);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Takt, Samen-Senke, Gabeln und Sitzungsprofil (Phase 11, 1e; DESIGN_V2.md 27.11, 28.10)
// ---------------------------------------------------------------------------

/** Samen bisher verdient (passiv, Ablehnen/Zurücklegen, Ereignisse und Gäste, Tagesziele). */
export function seedsEarned(s: Snapshot): number {
  return s.earnedPassive + s.earnedDecline + s.earnedExtras + s.earnedDaily;
}

/** Samen bisher ausgegeben (Aussaat, Neu würfeln, Bewirten, Ausbau). */
export function seedsSpent(s: Snapshot): number {
  return s.spentPlants + s.spent + s.spentVisitors + (s.spentUpgrades ?? 0);
}

/** Anteil der verdienten Samen, der ausgegeben wurde (0–1; ohne Einnahmen 0). */
export function seedSpendShare(s: Snapshot): number {
  const earned = seedsEarned(s);
  return earned > 0 ? seedsSpent(s) / earned : 0;
}

/**
 * Abstände zwischen zwei Käufen der Arten `kinds`, die in Stufe `stage` enden (s). Käufe im
 * selben Augenblick (Wegpunkt: würfeln und bewirten; mehrere Aussaaten hintereinander) zählen
 * als ein Kaufmoment – der Spieler erlebt sie als eine Pause. Der erste Abstand misst ab dem
 * vorigen Kauf (auch aus einer früheren Stufe) bzw. ab Spielstart. `open`: die Strecke seit dem
 * letzten Kauf, die beim Erreichen der nächsten Stufe (bzw. am Ende) noch läuft – sie zählt nur
 * für die längste Pause (wie die Durststrecke, longestDrought).
 * null, wenn die Stufe nie lief.
 */
export function purchaseGaps(
  run: RunResult,
  stage: number,
  kinds: readonly PurchaseKind[] = SEED_PURCHASES,
): { gaps: number[]; open: number } | null {
  const start = run.stages[stage]?.time;
  if (start === undefined) return null;
  // Fenster [Beginn, Beginn der nächsten Stufe): Käufe direkt am Wegpunkt der neuen Stufe gehören zu ihr.
  const next = run.stages[stage + 1]?.time;
  const end = next ?? run.final.time;
  const gaps: number[] = [];
  let last = 0;
  let any = false;
  for (const p of run.purchases) {
    if (!kinds.includes(p.kind)) continue;
    if (next !== undefined ? p.time >= next : p.time > end) break;
    if (any && p.time - last < 1e-6) continue;
    if (p.time >= start) gaps.push(p.time - last);
    last = p.time;
    any = true;
  }
  return { gaps, open: Math.max(0, end - last) };
}

/** Längste Pause ohne Kauf (s) in Stufe `stage` eines Durchgangs, inkl. der offenen Strecke am Ende. */
export function longestPurchasePause(run: RunResult, stage: number, kinds: readonly PurchaseKind[] = SEED_PURCHASES): number | null {
  const g = purchaseGaps(run, stage, kinds);
  if (!g) return null;
  return Math.max(g.open, ...g.gaps);
}

/**
 * Takt der Käufe je Stufe (DESIGN_V2.md 28.10, Ziel 20–60 s): Median aller Abstände zwischen
 * zwei Kaufmomenten in der Stufe (alle Durchgänge zusammen), Käufe je Durchgang, die längste
 * Pause je Durchgang (Median, 90 %, Maximum).
 */
export function purchaseStats(summary: Summary, stage: number, kinds: readonly PurchaseKind[] = SEED_PURCHASES) {
  const per = summary.runs.map((r) => purchaseGaps(r, stage, kinds)).filter((g): g is { gaps: number[]; open: number } => g !== null);
  const all = per.flatMap((g) => g.gaps);
  const longest = per.map((g) => Math.max(g.open, ...g.gaps));
  return {
    runs: per.length,
    perRun: per.length > 0 ? all.length / per.length : NaN,
    median: median(all),
    longestMedian: median(longest),
    longestP90: quantile(longest, 0.9),
    longestMax: longest.length > 0 ? Math.max(...longest) : NaN,
  };
}

/** Längste Pause ohne Kauf je Durchgang über die Stufen `from` bis vor `beforeStage` (s). */
export function longestPurchasePauseBefore(
  run: RunResult,
  beforeStage: number,
  kinds: readonly PurchaseKind[] = SEED_PURCHASES,
  from = SOWING_MIN_STAGE_FOR_TAKT,
): number {
  let longest = 0;
  for (let s = from; s < beforeStage; s++) longest = Math.max(longest, longestPurchasePause(run, s, kinds) ?? 0);
  return longest;
}

/**
 * Ab dieser Stufe zählt der Takt der 🌰-Käufe: Im Keimling gibt es nur die geschenkte Aussaat
 * (Wegpunkt 2) und nichts zu kaufen – die Pause bis zum Setzling ist kein Befund.
 */
export const SOWING_MIN_STAGE_FOR_TAKT = 2;

/**
 * Tabelle „Takt der Käufe“ je Stufe für eine Strategie: 🌰-Käufe (Aussaat, Neu würfeln,
 * Bewirten) und alle Käufe (mit Forschung) – Median der Abstände, Käufe je Durchgang, längste
 * Pause (Median / 90 % / max über die Durchgänge).
 */
export function purchaseTable(summary: Summary): string {
  const lines = [
    '| Stufe | 🌰-Käufe je Durchgang | Takt 🌰 Median | längste Pause 🌰 Median / 90 % / max | alle Käufe (mit ⚖️) je Durchgang | Takt alle Median | längste Pause alle Median / max |',
    '|---|---|---|---|---|---|---|',
  ];
  for (let s = 1; s < STAGES.length - 1; s++) {
    const seeds = purchaseStats(summary, s, SEED_PURCHASES);
    if (seeds.runs === 0) continue;
    const all = purchaseStats(summary, s, ALL_PURCHASES);
    lines.push(
      `| ${STAGES[s]!.name} | ${fmt(seeds.perRun, 1)} | ${formatTime(seeds.median)} | ${formatTime(seeds.longestMedian)} / ${formatTime(seeds.longestP90)} / ${formatTime(seeds.longestMax)} | ${fmt(all.perRun, 1)} | ${formatTime(all.median)} | ${formatTime(all.longestMedian)} / ${formatTime(all.longestMax)} |`,
    );
  }
  return lines.join('\n');
}

/**
 * Samen-Senke und Vorräte je Strategie beim Erreichen der Stufen (28.10): Anteil der verdienten
 * Samen ausgegeben, Samenbestand in Minuten Produktion, ⚖️-Vorrat in Minuten Zufluss, Aussaaten
 * (gekauft inkl. der ersten gratis) und erforschte Knoten, längste Pause ohne 🌰-Kauf bis dorthin
 * (ab Setzling, Median / 90 %).
 */
export function economyTable(summaries: Summary[], stages: readonly number[]): string {
  const lines = [
    '| Strategie | Stufe | erreicht nach | H | 🌰 ausgegeben (davon Ausbau) | 🌰-Bestand (min Produktion) | ⚖️-Vorrat (min Zufluss) | Aussaaten (Tausch) | Knoten (Ränge) | Ausbaustufen | längste Pause ohne 🌰-Kauf bis dahin Median / 90 % |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    for (const stage of stages) {
      const st = stageStats(s, stage);
      if (st.reachedShare === 0) continue;
      const snaps = snapshotsAt(s, stage);
      const knots = mean(snaps.map((x) => Object.keys(x.careRanks).length));
      const ranks = mean(snaps.map((x) => repeatableRanks(x)));
      const upgradeShare = mean(snaps.map((x) => (seedsEarned(x) > 0 ? (x.spentUpgrades ?? 0) / seedsEarned(x) : 0)));
      const pauses = s.runs.filter((r) => r.stages[stage]).map((r) => longestPurchasePauseBefore(r, stage));
      lines.push(
        `| ${s.strategy.name} | ${STAGES[stage]!.name} | ${formatTime(st.time)} | ${fmt(st.harmony, 1)} | ${fmt(st.seedSpendShare * 100)} % (${fmt(upgradeShare * 100)} %) | ${fmt(st.seedMinutes, 1)} | ${fmt(st.harmonyMinutes, 1)} | ${fmt(st.counts.plantsBought, 1)} (${fmt(st.counts.plantsSwapped, 1)}) | ${fmt(knots, 1)} (${fmt(ranks, 1)}) | ${fmt(st.counts.upgradesBought)} | ${formatTime(median(pauses))} / ${formatTime(quantile(pauses, 0.9))} |`,
      );
    }
  }
  return lines.join('\n');
}

/** Gekaufte Ränge der wiederholbaren Forschungsknoten in einem Schnappschuss (28.6). */
export function repeatableRanks(s: Snapshot): number {
  let n = 0;
  for (const [id, rank] of Object.entries(s.careRanks)) if (RESEARCH_BY_ID.get(id)?.repeatable) n += rank;
  return n;
}

/**
 * Ausbaustufen je Nische und Baumteil beim Erreichen der Stufen (Mittel; Phase 11, 3a, Vergleich
 * mit dem Modell 28.5) und Anteil der Durchgänge mit Meilenstein 25 (+1 Platz) in einer Nische.
 */
export function upgradeTable(summary: Summary, stages: readonly number[]): string {
  const ids = [...NICHE_IDS, ...TREE_PART_IDS];
  const lines = [
    `| Stufe | ${ids.join(' | ')} | Nischen mit Stufe ≥ 25 (Ø) |`,
    `|---|${ids.map(() => '---|').join('')}---|`,
  ];
  for (const stage of stages) {
    const snaps = snapshotsAt(summary, stage);
    if (snaps.length === 0) continue;
    const at = (id: string) => mean(snaps.map((x) => x.upgradeLevels?.[id] ?? 0));
    const slot25 = mean(snaps.map((x) => NICHE_IDS.filter((n) => (x.upgradeLevels?.[n] ?? 0) >= 25).length));
    lines.push(`| ${STAGES[stage]!.name} | ${ids.map((id) => fmt(at(id), 1)).join(' | ')} | ${fmt(slot25, 1)} |`);
  }
  return lines.join('\n');
}

/** Welche Seite einer Gabel ist erforscht? 0 = Weg A, 1 = Weg B, null = keine. */
export function forkSideOf(researched: readonly string[], fork: ResearchFork): 0 | 1 | null {
  if (fork.paths[0].some((id) => researched.includes(id))) return 0;
  if (fork.paths[1].some((id) => researched.includes(id))) return 1;
  return null;
}

/**
 * Anteile der Gabel-Wege (A / B / keiner) beim Erreichen einer Stufe bzw. am Ende des
 * Durchgangs (`'final'`; 27.11: Weg A beim Harmonie-Spieler 25–75 %).
 */
export function forkStats(summary: Summary, at: number | 'final'): { fork: ResearchFork; a: number; b: number; none: number }[] {
  const snaps = at === 'final' ? summary.runs.map((r) => r.final) : snapshotsAt(summary, at);
  const n = Math.max(1, snaps.length);
  return RESEARCH_FORKS.map((fork) => {
    const sides = snaps.map((x) => forkSideOf(Object.keys(x.careRanks), fork));
    return {
      fork,
      a: sides.filter((x) => x === 0).length / n,
      b: sides.filter((x) => x === 1).length / n,
      none: sides.filter((x) => x === null).length / n,
    };
  });
}

/** Tabelle der Gabel-Wahl: je Strategie und Gabel Anteil Weg A / B / offen (Stufe oder Ende). */
export function forkTable(summaries: Summary[], at: number | 'final'): string {
  const lines = [
    `| Strategie | ${RESEARCH_FORKS.map((f) => `${f.name}: ${RESEARCH_BY_ID.get(f.paths[0][0]!)!.name} / ${RESEARCH_BY_ID.get(f.paths[1][0]!)!.name} / offen`).join(' | ')} |`,
    `|---|${RESEARCH_FORKS.map(() => '---|').join('')}`,
  ];
  for (const s of summaries) {
    const cells = forkStats(s, at).map((f) => `${fmt(f.a * 100)} / ${fmt(f.b * 100)} / ${fmt(f.none * 100)} %`);
    lines.push(`| ${s.strategy.name} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** Ein Tag im Sitzungsprofil: aktive Sitzung, dann Abwesenheit über simulateOffline. */
export interface SessionDay {
  day: number;
  /** Stufe und Wegpunkt zu Beginn der aktiven Sitzung, an ihrem Ende. */
  stageStart: number;
  stageActive: number;
  waypointsActive: number;
  /** Käufe in der aktiven Sitzung (alle Arten). */
  purchases: number;
  /** Abwesenheit: Wegpunkte, Stufe danach, Erträge (aus dem OfflineReport). */
  offlineSeconds: number;
  offlineWaypoints: number;
  stageOffline: number;
  offlineSeeds: number;
  offlineHarmony: number;
  /** Bei der Rückkehr wartende Begegnungen und Aussaat (vor dem Auflösen). */
  pendingOnReturn: number;
  /** Samen und ⚖️-Vorrat bei der Rückkehr. */
  seedsOnReturn: number;
  harmonyOnReturn: number;
}

export interface SessionOptions {
  seed: number;
  /** Aktive Minuten je Tag (Standard 30) und Abwesenheit (Standard 8 h). */
  activeSeconds?: number;
  offlineSeconds?: number;
  /** Höchstens so viele Tage (Standard 10). */
  days?: number;
  /** Endet mit Erreichen dieser Stufe (Standard: Urwald). */
  targetStage?: number;
  care?: boolean;
  mainTree?: MainTreeId;
}

/**
 * Sitzungsprofil „wie fühlt sich ein Tag an“ (DESIGN_V2.md 28.10): Tag für Tag
 * `activeSeconds` aktiv (runGame mit derselben Strategie, Spielstand und Zufall laufen weiter),
 * dann `offlineSeconds` Abwesenheit über die echte `simulateOffline` (welche Offline-Regel gilt,
 * entscheidet allein der Core – nichts wird hier nachgebaut). Bei der Rückkehr löst der Spieler
 * die wartenden Begegnungen und die Aussaat nach seiner Strategie auf, dann beginnt die nächste
 * aktive Sitzung. Endet mit Erreichen von `targetStage` (auch offline) oder nach `days` Tagen.
 */
export function runSession(strategy: Strategy, options: SessionOptions): SessionDay[] {
  const active = options.activeSeconds ?? 1800;
  const offline = options.offlineSeconds ?? 8 * 3600;
  const target = options.targetStage ?? STAGES.length - 1;
  const state = createInitialState(0, options.seed);
  if (options.mainTree) state.cycle.mainTree = options.mainTree;
  const rng: RngHolder = { rngState: normalizeSeed(options.seed * 7919 + 17) };
  const days: SessionDay[] = [];
  for (let day = 1; day <= (options.days ?? 10) && state.stage < target; day++) {
    if (day > 1) resolveOnReturn(state, strategy, rng);
    const stageStart = state.stage;
    const waypointStart = state.waypoint;
    const run = runGame(strategy, { seed: options.seed, targetStage: target, maxSeconds: active, care: options.care ?? true }, { state, rng });
    const stageActive = state.stage;
    const waypointsActive = state.waypoint - waypointStart;
    const report = state.stage < target && !allWaypointsReached(state) ? simulateOffline(state, offline) : null;
    days.push({
      day,
      stageStart,
      stageActive,
      waypointsActive,
      purchases: run.purchases.length,
      offlineSeconds: report?.seconds ?? 0,
      offlineWaypoints: report?.waypoints ?? 0,
      stageOffline: state.stage,
      offlineSeeds: report?.seeds ?? 0,
      offlineHarmony: report?.harmony ?? 0,
      pendingOnReturn: state.pendingEncounters.length + (state.cycle.sowing ? 1 : 0),
      seedsOnReturn: state.seeds,
      harmonyOnReturn: state.harmonyPoints,
    });
  }
  return days;
}

/** Rückkehr: wartende Begegnungen und Aussaat nach der Strategie auflösen (ohne Buchführung). */
function resolveOnReturn(state: GameState, strategy: Strategy, rng: RngHolder): void {
  const counts: Counts = {
    encounters: 0, plantEncounters: 0, fullNiche: 0, rerolls: 0, declines: 0, autoDeclined: 0, rarityTaken: [0, 0, 0, 0],
    plantsTaken: 0, plantsBought: 0, plantsSwapped: 0, events: 0, visitors: 0, hosted: 0, careBought: 0, regulars: 0, upgradesBought: 0, sowingRerolls: 0,
  };
  const book = { earnedDecline: 0, spent: 0, earnedExtras: 0, spentVisitors: 0 };
  resolveAll(state, strategy, rng, counts, book, [], [], 0, []);
}

/**
 * Abwesenheit ab einer Stufe (28.10, „8 h offline am Hain“): Durchgang bis `stage` (runGame,
 * Begegnungen am Wegpunkt aufgelöst), dann `seconds` über simulateOffline. Mit `cycle` > 1
 * (Phase 11, 3b: Offline-Tag mit Waldgedächtnis) laufen davor `cycle − 1` Zyklen bis `stage`
 * mit Neustart dort (runCycles, Stammgäste wie dort) – gemessen wird im Zyklus `cycle`.
 */
export function offlineAfterStage(
  strategy: Strategy,
  options: { seed: number; stage: number; seconds: number; care?: boolean; maxSeconds?: number; cycle?: number },
): { stage: number; waypoint: number; waypoints: number; stageAfter: number; seeds: number; harmony: number; memory: number } {
  let state = createInitialState(0, options.seed);
  const rng: RngHolder = { rngState: normalizeSeed(options.seed * 7919 + 17) };
  const run = { seed: options.seed, targetStage: options.stage, maxSeconds: options.maxSeconds ?? 6 * 3600, care: options.care ?? true };
  if ((options.cycle ?? 1) > 1) {
    runCycles(strategy, { ...run, cycles: options.cycle!, afterLast: (s) => (state = s) });
  } else {
    runGame(strategy, run, { state, rng });
  }
  const stage = state.stage;
  const waypoint = state.waypoint;
  const report = simulateOffline(state, options.seconds);
  return { stage, waypoint, waypoints: report.waypoints, stageAfter: state.stage, seeds: report.seeds, harmony: report.harmony, memory: state.meta.forestMemory };
}

/** Tabelle Sitzungsprofil: je Tag Median über die Durchgänge. */
export function sessionTable(label: string, sessions: readonly SessionDay[][]): string {
  const lines = [
    '| Spieler | Tag | Durchgänge an diesem Tag | Stufe nach aktiv | Wegpunkte aktiv | Käufe aktiv | Wegpunkte offline | Stufe nach offline | 🌰 offline | ⚖️ offline | wartend bei Rückkehr |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const maxDays = Math.max(0, ...sessions.map((s) => s.length));
  for (let d = 0; d < maxDays; d++) {
    const rows = sessions.map((s) => s[d]).filter((x): x is SessionDay => x !== undefined);
    const med = (f: (x: SessionDay) => number) => median(rows.map(f));
    const stageName = (f: (x: SessionDay) => number) => STAGES[Math.round(med(f))]?.name ?? '–';
    lines.push(
      `| ${label} | ${d + 1} | ${fmt((rows.length / sessions.length) * 100)} % | ${stageName((x) => x.stageActive)} | ${fmt(med((x) => x.waypointsActive), 1)} | ${fmt(med((x) => x.purchases), 1)} | ${fmt(med((x) => x.offlineWaypoints), 1)} | ${stageName((x) => x.stageOffline)} | ${fmt(med((x) => x.offlineSeeds))} | ${fmt(med((x) => x.offlineHarmony))} | ${fmt(med((x) => x.pendingOnReturn), 1)} |`,
    );
  }
  return lines.join('\n');
}
