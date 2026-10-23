import {
  ARCHITECT,
  CALM_MIN_HAPPINESS,
  COMMUNITY_BOOST_HARMONY,
  COUNTS_AS_GENUS,
  DECOMPOSER_BOOST,
  FEAR_LIGHT_FACTOR,
  MIN_SUPPLY_FLOOR,
  NIGHT_WATCH,
  NO_WATER_GROUP,
  RARITY_BOOST_POINTS,
} from '../content/abilities';
import { CARE, type CareCycleEffect } from '../content/care';
import { DAY_SECONDS, DAY_START_PHASE, NOCTURNAL_BY_SPECIES } from '../content/daytime';
import { COMMUNITIES, type CommunityMember } from '../content/communities';
import { DECLINE_SEED_SECONDS, RARITY_WEIGHTS, REROLL_BASE_COST, REROLL_COST_GROWTH } from '../content/encounters';
import { SEED_SECONDS_MIN_SEEDS } from '../content/events';
import {
  FOREST_MEMORY_BONUS,
  MEMORY_HARMONY_RULES,
  MEMORY_PER_HARMONY_POINT,
  MEMORY_PER_NEW_SPECIES,
  MEMORY_PER_REGULAR_SLOT,
} from '../content/memory';
import { NICHES_BY_ID } from '../content/niches';
import { PLANTS_BY_ID, PLANT_COST_BASE, PLANT_COST_GROWTH, type Plant } from '../content/plants';
import { OVERHUNT_MAX_UNITS, OVERHUNT_PENALTY, STOCK_BASE, STOCK_RANGE } from '../content/predation';
import { BASE_HAPPINESS, SPECIES, SPECIES_BY_ID, TAG_NAMES, type Species } from '../content/species';
import { SEASONS_BY_ID, type HappinessEffect, type SeasonId } from '../content/seasons';
import { MAIN_TREE_WEIGHT, STAGES } from '../content/stages';
import type { SiteId } from '../content/landscape';
import { DEFAULT_MAIN_TREE, MAIN_TREES_BY_ID, type MainTree, type MainTreeId } from '../content/trees';
import { TRAITS, TRAIT_THRESHOLDS } from '../content/traits';
import { VISITORS_BY_ID } from '../content/visitors';
import {
  GENERA,
  NICHE_IDS,
  type AbilityId,
  type Condition,
  type Effect,
  type Genus,
  type NicheId,
  type PlantGroup,
  type Tag,
} from '../content/types';
import { WAYPOINT_COUNT, WAYPOINT_THRESHOLDS, waypointThreshold } from '../content/waypoints';
import { activeSite, effectiveForestMemory, giftSites, landscapeOf, landscapeTraits, oldSiteOf, siteHabitats } from './landscape';
import { normalizeElapsed, seasonIdAt, seasonIndex } from './season';
import { MAX_FOREST_MEMORY, type CycleState, type GameState, type LandscapeState, type PendingEncounterType } from './state';
import type { WeatherId } from '../content/weather';
import {
  averageWeatherEffectsFor,
  dampedWeatherEffects,
  dayIndex,
  generaWithAnimals,
  nightShare,
  nocturnalInSeason,
  weatherById,
  weatherDampingFor,
  weatherOfDay,
  averageWeatherOf,
  type AmbientMode,
  type AverageWeather,
} from './weather';

/*
 * Rechenmodell v2: Zufriedenheit, Harmonie, Versorgung, Wachstum/s, Samen/s.
 * Formeln aus docs/DESIGN_V2.md, Abschnitt 2 und 9, mit allen 32 Arten, Störung,
 * Fähigkeiten, Lebensgemeinschaften, Ereignis-Boni und Durchreisenden (2.4).
 * Das frühere Referenzmodell scripts/v2/model.ts ist seit Schritt 2.10 entfernt; Invarianten
 * und Beispiele prüft tests/formulas.test.ts.
 */

/** Gewicht der Nahrung gegenüber einem einzelnen Lebensraum-Wunsch. */
export const FOOD_WEIGHT = 2;
/** Abzug je störender Art (Wirkung `disturb`). */
export const DISTURB_PENALTY = 0.15;
/** „Sonnig“: so viel Licht bleibt nach den Begleitpflanzen frei. */
export const SUNNY_MIN_LIGHT = 2;
/** „Schattig“: so viele Bäume (inkl. Hauptbaum). */
export const SHADY_MIN_TREES = 3;
/** Futtereinheiten je Anbieter. */
export const SUPPLY_MAIN_TREE = 2;
export const SUPPLY_PLANT = 1;
/**
 * Angebot je Tier im ersten Durchgang (Zufriedenheit z⁰, DESIGN_V2.md 22.3). Danach
 * stellt ein Tier max(SUPPLY_ANIMAL, Bestand) bereit (Bestand = STOCK_BASE + STOCK_RANGE · z⁰,
 * predation.ts) – mehr Futter bei reichlichem Bestand, nie weniger als vor Welle 3.
 */
export const SUPPLY_ANIMAL = 1;
/** Harmonie-Multiplikator: 1 + H / HARMONY_DIVISOR (Entscheidung PO). */
export const HARMONY_DIVISOR = 100;
/** Untergrenze für (1 + Wachstumsboni − Fraßschaden). */
export const MIN_GROWTH_FACTOR = 0.5;
/** Ein Schädling gilt als unbewacht, solange mehr als dieser Anteil seines Schadens wirkt. */
export const UNGUARDED_SHARE = 0.5;
/** Harmonie-Abzug je unbewachtem Schädling. */
export const UNGUARDED_PENALTY = 4;

/** Was evaluate() braucht – ein Ausschnitt des GameState (auch für Vorschauen). */
export interface Ecosystem {
  stage: number;
  niches: Record<NicheId, readonly string[]>;
  /** Begleitpflanzen (Duplikate erlaubt). Fehlt das Feld, wächst nur der Hauptbaum. */
  plants?: readonly string[];
  forestMemory: number;
  /**
   * Wirkungen aus Ereignissen und Gästen (Schritt 2.4), alle mit Faktor 1: Zyklus-Boni,
   * aktive Zeit-Boni und die Wirkungen bewirteter Gäste. `slot` zählt in nicheSlots.
   */
  extraEffects?: readonly Effect[];
  /** Merkmale aus Ereignissen (`habitat`), je SUPPLY_PLANT Angebot. */
  habitats?: readonly Tag[];
  /** Gattungen bewirteter Gäste: zählen für Gattungsboni, nicht für Erscheinungsbedingungen. */
  guestGenera?: readonly Genus[];
  /**
   * Laufende Jahreszeit (DESIGN_V2.md 16.3). Ihre Wirkungen kommen zu den Zusatz-Wirkungen
   * (Faktor 1), `happiness` hebt die Zufriedenheit einer Gattung. Fehlt sie, wirkt keine.
   */
  season?: SeasonId;
  /**
   * Art des Hauptbaums (DESIGN_V2.md 17.3): Merkmale (Futter, Erscheinungsbedingungen) und
   * Eigenheiten ab ihrer Stufe. Fehlt sie, stellt der Hauptbaum die Merkmale der Eiche
   * bereit, aber ohne Eigenheiten (reines Ökosystem, z. B. in Vorschau-Tests).
   */
  mainTree?: MainTreeId;
  /**
   * Wetter des Tages (DESIGN_V2.md 21.3) oder `'average'` = Mittelwetter der Jahreszeit
   * (offline, 21.5; braucht `season`), `'gentle-average'` = dasselbe in der Schonzeit. Wirkungen mit Faktor 1, Abzüge rauer Lagen gedämpft
   * (Gattungen mit Tier, Pflege `care`, Hauptbaum). Fehlt es, wirkt kein Wetter.
   */
  weather?: WeatherId | AverageWeather;
  /**
   * Anteil der Nachtwirkung nachtaktiver Arten (21.6): 1 nachts, 0 tagsüber, NIGHT_SHARE
   * im Mittel offline. Skaliert mit der Zufriedenheit der Art wie ihre Grundwirkung.
   * Fehlt er, wirkt keine Nacht.
   */
  night?: number;
  /** Pflege-Ränge des Zyklus – nur für den Schutz vor rauen Lagen (Wirkungen stecken in extraEffects). */
  care?: Readonly<Record<string, number>>;
  /**
   * Standort des aktiven Waldes (DESIGN_V2.md 24.2): seine Eigenheiten wirken wie die des
   * Hauptbaums ab ihrer Stufe. Seine Merkmale stecken schon in `habitats`. Fehlt er: keine.
   */
  site?: SiteId;
  /** Gegründete Wälder, deren Gabe wirkt (24.2, in allen Wäldern). Fehlt das Feld: keine. */
  gifts?: readonly SiteId[];
  /**
   * Der aktive Wald, wenn er für Kennarten alt genug ist (Bedingung `site`, DESIGN_V2.md 26.3:
   * Landschaft frei, schon einmal Urwald oder jetzt Urwald – oldSiteOf). Fehlt: keine Kennart.
   */
  oldSite?: SiteId;
}

/** Platz-Wirkung (Nische, Anzahl). */
export interface SlotBonus {
  niche: NicheId;
  amount: number;
}

/** Laufender Zyklus, soweit evaluate ihn braucht (fehlt er, gibt es keine Zusatz-Wirkungen). */
export type CycleExtras = Partial<
  Pick<CycleState, 'bonuses' | 'timed' | 'visitors' | 'habitats' | 'care' | 'elapsed' | 'mainTree' | 'number' | 'startedAt'>
>;

/** Daten des Hauptbaums; unbekannte oder fehlende Arten → DEFAULT_MAIN_TREE (Eiche). */
export function mainTreeOf(id: string | undefined): MainTree {
  return MAIN_TREES_BY_ID.get(id as MainTreeId) ?? MAIN_TREES_BY_ID.get(DEFAULT_MAIN_TREE)!;
}

/** Hat die Wirkung eine negative Zahl (ein Abzug)? */
function isPenalty(e: Effect | HappinessEffect): boolean {
  if ('pct' in e) return e.pct < 0;
  if ('amount' in e) return e.amount < 0;
  if ('points' in e) return e.points < 0;
  return false;
}

/**
 * Wirkungen von Jahreszeit, Baumart und Landschaft (DESIGN_V2.md 16.3, 17.3, 24.2), alle mit
 * Faktor 1: Eigenheiten des Hauptbaums ab ihrer Stufe, dann Eigenheiten des Standorts `site`
 * und Gaben der Wälder `gifts` (gleiche Typen, gleiche Regel), danach die der Jahreszeit. Ein winterfester
 * Hauptbaum (Kiefer) streicht die Abzüge der Jahreszeit. `happiness` getrennt, weil es
 * kein Effect ist (wirkt in der Zufriedenheit je Tier). Ohne Angaben: nichts.
 */
export function environmentEffects(
  stage: number,
  season?: SeasonId,
  mainTree?: MainTreeId,
  site?: SiteId,
  gifts?: readonly SiteId[],
): { effects: Effect[]; happiness: HappinessEffect[] } {
  const effects: Effect[] = [];
  const happiness: HappinessEffect[] = [];
  const tree = mainTree !== undefined ? mainTreeOf(mainTree) : null;
  const add = (e: Effect | HappinessEffect) => {
    if (e.kind === 'happiness') happiness.push(e);
    else effects.push(e);
  };
  if (tree) for (const t of tree.traits) if (t.minStage <= stage) add(t.effect);
  for (const t of landscapeTraits(site, gifts)) if (t.minStage <= stage) add(t.effect);
  const s = season !== undefined ? SEASONS_BY_ID.get(season) : undefined;
  for (const e of s?.effects ?? []) {
    if (tree?.winterHardy && isPenalty(e)) continue;
    add(e);
  }
  return { effects, happiness };
}

/**
 * Alle zusätzlichen Plätze eines Spielstands: Zyklus-Boni, Pflege, Eigenheiten des
 * Hauptbaums ab ihrer Stufe (z. B. Rotbuche: +1 Wurzelraum ab Alter Baum) und – seit v14 –
 * Eigenheit des aktiven Standorts und Gaben der Landschaft (z. B. Auwald: +2 Waldtümpel ab
 * Junger Baum). Gemeinsamer Helfer für evaluate, Kartenwahl, Stammgäste, vorgegebene
 * Begegnungen und das Laden.
 */
export function slotBonuses(state: { stage: number; cycle?: CycleExtras; meta?: { landscape?: LandscapeState } }): SlotBonus[] {
  const tree = state.cycle?.mainTree !== undefined ? mainTreeOf(state.cycle.mainTree) : null;
  const out = cycleSlotBonuses(state.cycle);
  const landscape = state.meta?.landscape;
  const site = landscape ? landscapeTraits(activeSite(landscape), giftSites(landscape)) : [];
  for (const t of [...(tree?.traits ?? []), ...site]) {
    if (t.minStage <= state.stage && t.effect.kind === 'slot') out.push({ niche: t.effect.niche, amount: t.effect.amount });
  }
  return out;
}

/**
 * Wirkungen der gekauften Pflege-Ränge (DESIGN_V2.md 8.2): je Maßnahme die Ränge
 * 0 … care[id]−1. Unbekannte IDs und unsinnige Ränge zählen nicht.
 */
export function careEffects(care: Readonly<Record<string, number>> | undefined): { effects: CareCycleEffect[]; habitats: Tag[] } {
  const effects: CareCycleEffect[] = [];
  const habitats: Tag[] = [];
  if (!care) return { effects, habitats };
  for (const measure of CARE) {
    const ranks = Math.min(measure.ranks.length, Math.max(0, Math.floor(finite(care[measure.id] ?? 0))));
    for (let r = 0; r < ranks; r++) {
      for (const e of measure.ranks[r]!.effects) {
        if (e.kind === 'cycle') effects.push(e.effect);
        else habitats.push(e.tag);
      }
    }
  }
  return { effects, habitats };
}

/** Zusatz-Wirkungen des Zyklus: Zyklus-Boni, Pflege, aktive Zeit-Boni, Wirkungen bewirteter Gäste. */
export function cycleEffects(cycle: CycleExtras | undefined): Effect[] {
  const out: Effect[] = [];
  if (!cycle) return out;
  for (const b of cycle.bonuses ?? []) out.push(b.effect);
  out.push(...careEffects(cycle.care).effects);
  for (const t of cycle.timed ?? []) if (t.remaining > 0) out.push(t.effect);
  for (const v of cycle.visitors ?? []) {
    const visitor = VISITORS_BY_ID.get(v.id);
    if (visitor && v.remaining > 0) out.push(...visitor.effects);
  }
  return out;
}

/** Zusätzliche Plätze aus Zyklus-Boni und Pflege (z. B. Sturmnacht: +1 Höhlen & Totholz). */
export function cycleSlotBonuses(cycle: CycleExtras | undefined): SlotBonus[] {
  return slotBonusesOf([...(cycle?.bonuses ?? []).map((b) => b.effect), ...careEffects(cycle?.care).effects]);
}

/** Platz-Wirkungen unter den Zusatz-Wirkungen. */
function slotBonusesOf(effects: readonly Effect[]): SlotBonus[] {
  const out: SlotBonus[] = [];
  for (const e of effects) if (e.kind === 'slot') out.push({ niche: e.niche, amount: e.amount });
  return out;
}

/** Das Ökosystem eines Spielstands (mit Ereignis-Boni und Gästen), optional mit geänderten Feldern. */
export function ecosystemOf(
  state: Pick<GameState, 'stage' | 'niches' | 'plants' | 'meta'> & { cycle?: CycleExtras },
  patch: Partial<Pick<Ecosystem, 'niches' | 'plants'>> = {},
  ambient: AmbientMode = 'live',
): Ecosystem {
  const genera: Genus[] = [];
  for (const v of state.cycle?.visitors ?? []) {
    const visitor = VISITORS_BY_ID.get(v.id);
    if (visitor && v.remaining > 0) genera.push(visitor.genus);
  }
  const landscape = landscapeOf(state);
  const active = activeSite(landscape);
  return {
    stage: state.stage,
    niches: patch.niches ?? state.niches,
    plants: patch.plants ?? state.plants,
    // Wirksames Gedächtnis des aktiven Waldes (eigenes + Korridor-Zufluss, 24.6).
    forestMemory: effectiveForestMemory(state),
    extraEffects: cycleEffects(state.cycle),
    habitats: [...(state.cycle?.habitats ?? []), ...careEffects(state.cycle?.care).habitats, ...siteHabitats(active)],
    guestGenera: genera,
    ...environmentOf(state.cycle, ambient, active),
    site: active,
    gifts: giftSites(landscape),
    ...oldSiteField(state),
  };
}

/** `oldSite` für ecosystemOf – nur gesetzt, wenn die Bedingung `site` gilt (sonst bleibt das Feld weg). */
function oldSiteField(state: Pick<GameState, 'stage' | 'meta'>): Pick<Ecosystem, 'oldSite'> {
  const site = oldSiteOf(state);
  return site !== undefined ? { oldSite: site } : {};
}

type Environment = Pick<Ecosystem, 'season' | 'mainTree' | 'weather' | 'night' | 'care'>;

/**
 * Jahreszeit, Wetter und Nacht (aus der Spielzeit) und Hauptbaum des Zyklus – nur, was
 * der Zyklus kennt. `ambient` wählt Einzelwetter (live), Mittel (offline) oder keins.
 */
function environmentOf(cycle: CycleExtras | undefined, ambient: AmbientMode, site: SiteId): Environment {
  const out: Environment = {};
  if (cycle?.elapsed !== undefined) {
    out.season = seasonIdAt(cycle.elapsed);
    if (ambient === 'average') out.weather = averageWeatherOf(cycle.elapsed);
    else if (ambient === 'live') out.weather = weatherOfDay({ number: cycle.number ?? 0, startedAt: cycle.startedAt }, dayIndex(cycle.elapsed), site);
    const night = nightShare(ambient, cycle.elapsed);
    if (night > 0) out.night = night;
  }
  if (cycle?.mainTree !== undefined) out.mainTree = mainTreeOf(cycle.mainTree).id;
  if (cycle?.care !== undefined) out.care = cycle.care;
  return out;
}

/**
 * Wirkungen des Wetters (21.3/21.5) für ein Ökosystem, Faktor 1: Einzelwetter oder
 * Mittelwetter der Jahreszeit, Abzüge gedämpft nach Gattungen mit Tier, Pflege und Baumart.
 */
function ecosystemWeatherEffects(eco: Ecosystem, animals: readonly Species[]): Effect[] {
  if (eco.weather === undefined) return [];
  const genera = generaWithAnimals(animals.map((a) => a.id)).length;
  const tree = eco.mainTree !== undefined ? mainTreeOf(eco.mainTree).id : undefined;
  if (eco.weather === 'average' || eco.weather === 'gentle-average') {
    const gentle = eco.weather === 'gentle-average';
    return eco.season !== undefined ? averageWeatherEffectsFor(eco.season, genera, eco.care, tree, gentle, eco.site) : [];
  }
  const weather = weatherById(eco.weather);
  return dampedWeatherEffects(weather, weatherDampingFor(weather, genera, eco.care, tree));
}

export interface AnimalStatus {
  /** Zufriedenheit 0–1. */
  happiness: number;
  /** Futter-Erfüllung 0–1. */
  food: number;
  /** Je Eintrag in `Species.needs`: erfüllt? */
  needs: boolean[];
  /** Anzahl anwesender Räuber, die diese Art jagen (für die Anzeige; der Abzug folgt aus `overhunt`). */
  hunters: number;
  /**
   * Bestand (DESIGN_V2.md 22.3): STOCK_BASE + STOCK_RANGE · z⁰, also 0,5 … 1,5 – so viel
   * Futter stellt die Art je Merkmal bereit. Nur bei Arten, die etwas bereitstellen (Beute).
   */
  stock?: number;
  /**
   * Überjagung (22.4): fehlende Einheiten Futter, 0 … OVERHUNT_MAX_UNITS – Jäger minus
   * Futterangebot (Σ max(1, Bestand)) im knappsten Merkmal. Abzug an der Zufriedenheit =
   * OVERHUNT_PENALTY · overhunt.
   */
  overhunt: number;
  /** Nur bei Überjagung: die Jäger des knappsten Merkmals (Art-IDs, Nischen-Reihenfolge). */
  overhuntedBy?: string[];
  /** Anzahl anwesender Arten, die diese Art stören (Wirkung `disturb`). */
  disturbers: number;
}

/**
 * Zustand eines Merkmals im Nahrungsnetz (DESIGN_V2.md 22.7): im Gleichgewicht (Jäger ≤
 * Bestand), überjagt (eine Beute verliert Zufriedenheit) oder ungejagt (kein Räuber frisst
 * es, keine Art hält es klein – dann kann ein Massenjahr kommen, 22.5).
 */
export type FoodWebState = 'balanced' | 'overhunted' | 'unhunted';

/** Eine Zeile des Nahrungsnetzes: ein Beute-Merkmal mit Beute im Ökosystem. */
export interface FoodWebEntry {
  tag: Tag;
  /** Tiere im Ökosystem, die das Merkmal bereitstellen (Nischen-Reihenfolge). */
  prey: string[];
  /** Räuber im Ökosystem, die es fressen (Nischen-Reihenfolge; kann eine Beute selbst sein). */
  hunters: string[];
  /** Arten, die es nur klein halten (`control`), ohne es zu fressen (z. B. Waldameise ⊘ Raupen). */
  controllers: string[];
  /** Summe der Bestände der Beute (0,5 … 1,5 je Art) – für „knapp/gut/reichlich“. */
  stock: number;
  /**
   * Futterangebot der Beute für die Jäger: Σ max(SUPPLY_ANIMAL, Bestand), also ≥ 1 je Art.
   * Danach richten sich Futter der Jäger und der Zustand („überjagt“: Jäger > supply).
   */
  supply: number;
  state: FoodWebState;
}

/** Zustand einer Lebensgemeinschaft (Reihenfolge wie COMMUNITIES). */
export interface CommunityStatus {
  id: string;
  /** Alle Mitglieder leben bzw. wachsen im Ökosystem. */
  active: boolean;
  /** Erfüllte Mitglieder (eine Alternative genügt) von `total`. */
  present: number;
  total: number;
  /**
   * Fehlende Mitglieder: je Eintrag die Art- oder Pflanzen-IDs, von denen eine genügt
   * (meist nur eine, z. B. ['bee'] oder ['chanterelle', 'porcini']). Leer, wenn aktiv.
   */
  missing: string[][];
  /** Harmonie, die sie gerade bringt (inkl. Lichterabend); 0, wenn nicht aktiv. */
  harmony: number;
}

export interface Evaluation {
  /** 🌿 Wachstum pro Sekunde. */
  growth: number;
  /** 🌰 Samen pro Sekunde. */
  seeds: number;
  /** ⚖️ Harmonie. */
  harmony: number;
  /** 1 + H/100. */
  multiplier: number;
  /**
   * Bausteine der Harmonie (Summe = harmony): `pyramid` enthält den Abzug für
   * unbewachte Schädlinge, `communities` die Lebensgemeinschaften inkl. Lichterabend,
   * `extra` die Harmonie-Wirkungen der Tiere (Glühwürmchen, Hirschkäfer).
   */
  breakdown: { variety: number; happiness: number; pyramid: number; communities: number; extra: number };
  /** Alle Lebensgemeinschaften mit Zustand (aktive und fehlende Mitglieder). */
  communities: CommunityStatus[];
  /** Zustand je Tier (Art-ID → Status). */
  animals: Record<string, AnimalStatus>;
  /**
   * Nahrungsnetz (DESIGN_V2.md 22.7): je Beute-Merkmal (eines, das ein Räuber frisst oder
   * eine Art klein hält) mit Beute im Ökosystem eine Zeile, Reihenfolge wie TAG_NAMES.
   */
  foodWeb: FoodWebEntry[];
  /** Ø Zufriedenheit aller Tiere (0, wenn keine). */
  avgHappiness: number;
  /** Plätze je Nische auf der aktuellen Stufe. */
  slots: Record<NicheId, number>;
  /** Tiere je Gattung (das Braune Langohr zählt per Fähigkeit auch als Vogel). */
  genusCounts: Record<Genus, number>;
  /** Erreichte Gattungsbonus-Stufen (0–3) je Gattung. */
  traitTiers: Record<Genus, number>;
  /** Summe der Wachstumsboni (0,08 = +8 %), Samenboni und des Fraßschadens nach Räubern. */
  growthBonus: number;
  seedsBonus: number;
  damage: number;
  /** Schädlinge, deren Schaden zu mehr als der Hälfte wirkt. */
  unguarded: number;
  sunny: boolean;
  /** Schattig: mindestens SHADY_MIN_TREES Bäume (inkl. Hauptbaum). */
  shady: boolean;
  /** Wirksame Fähigkeiten (je einmal, in Nischen-Reihenfolge der Arten). */
  abilities: AbilityId[];
  /** Licht- und Wasserangebot (Stufe + Wirkungen der Tiere und Gattungsboni). */
  light: number;
  water: number;
  /** Licht- und Wasserbedarf aller Begleitpflanzen (Wasser negativ: Moos speichert). */
  lightNeed: number;
  waterNeed: number;
  /**
   * Versorgung V der Begleitpflanzen in [0, 1] = min(1, Licht/Bedarf, Wasser/Bedarf).
   * Bremst nur die Begleitpflanzen, nicht den Hauptbaum (DESIGN_V2.md 2.5).
   */
  supply: number;
  /** Pflanzen je Gruppe, Hauptbaum zählt als Baum. */
  groupCounts: Record<PlantGroup, number>;
  /** Anteil der Begleitpflanzen an 🌿/s und 🌰/s (schon mit V, Boni und Harmonie). */
  plantGrowth: number;
  plantSeeds: number;
  /** Pflanzplätze auf dieser Stufe (Größe des Pflanzrings). */
  plantSlots: number;
}

/** Wer jagt wen (Räuber frisst ein Merkmal, das die Beute bereitstellt)? Statisch vorberechnet. */
const HUNTERS_OF: ReadonlyMap<string, readonly string[]> = new Map(
  SPECIES.map((prey) => [
    prey.id,
    SPECIES.filter((p) => p.id !== prey.id && p.level === 'predator' && p.food.some((t) => prey.provides.includes(t))).map(
      (p) => p.id,
    ),
  ]),
);

/**
 * Beute-Merkmale: Merkmale, die irgendein Räuber frisst oder irgendeine Art klein hält
 * (Reihenfolge wie TAG_NAMES). Nur sie erscheinen im Nahrungsnetz.
 */
const PREY_TAGS: readonly Tag[] = (Object.keys(TAG_NAMES) as Tag[]).filter((t) =>
  SPECIES.some((s) => (s.level === 'predator' && s.food.includes(t)) || s.effects.some((e) => e.kind === 'control' && e.tag === t)),
);

/**
 * Merkmale, die die Tiere eines Ökosystems jagen: Räuber fressen sie oder eine Art hält
 * sie klein (`control`) – unabhängig von der Zufriedenheit, solange die Art lebt.
 */
function huntedTags(animals: readonly Species[]): Set<Tag> {
  const out = new Set<Tag>();
  for (const a of animals) {
    if (a.level === 'predator') for (const t of a.food) out.add(t);
    for (const e of a.effects) if (e.kind === 'control') out.add(e.tag);
  }
  return out;
}

/**
 * Ungejagte Merkmale (Bedingung `unhunted`, DESIGN_V2.md 22.5): ein Tier stellt sie bereit,
 * aber kein Tier frisst sie als Räuber oder hält sie klein.
 */
export function unhuntedTags(animals: readonly Species[]): Set<Tag> {
  const hunted = huntedTags(animals);
  const out = new Set<Tag>();
  for (const a of animals) for (const t of a.provides) if (!hunted.has(t)) out.add(t);
  return out;
}

/** Bestand einer Beute aus ihrer Zufriedenheit z⁰ ohne Überjagung: 0,5 … 1,5. */
export function stockFor(happiness: number): number {
  const z = Number.isNaN(happiness) ? 0 : Math.min(1, Math.max(0, happiness));
  return STOCK_BASE + STOCK_RANGE * z;
}

/**
 * Überjagung (fehlende Einheiten, 0 … OVERHUNT_MAX_UNITS) aus der Zahl der Jäger und dem
 * Bestand eines Merkmals: Jäger − Bestand, ohne Jäger 0.
 */
export function overhuntUnits(hunters: number, stock: number): number {
  if (!(hunters > 0)) return 0;
  const missing = hunters - (Number.isFinite(stock) ? Math.max(0, stock) : 0);
  return Math.min(OVERHUNT_MAX_UNITS, Math.max(0, missing));
}

/** Wer stört wen (Wirkung `disturb`)? Statisch vorberechnet. */
const DISTURBERS_OF: ReadonlyMap<string, readonly string[]> = new Map(
  SPECIES.map((target) => [
    target.id,
    SPECIES.filter((o) => o.effects.some((e) => e.kind === 'disturb' && e.target === target.id)).map((o) => o.id),
  ]),
);

/** Hat die Art diese Fähigkeit? */
export function hasAbility(sp: Pick<Species, 'effects'>, id: AbilityId): boolean {
  return sp.effects.some((e) => e.kind === 'ability' && e.id === id);
}

/**
 * Plätze, die eine Art schafft: ihre Wirkungen `slot` und die der Fähigkeit Baumeister.
 * Gilt, solange die Art lebt – unabhängig von ihrer Zufriedenheit.
 */
export function slotEffects(sp: Pick<Species, 'effects'>): { niche: NicheId; amount: number }[] {
  const out: { niche: NicheId; amount: number }[] = [];
  for (const e of sp.effects) {
    if (e.kind === 'slot') out.push({ niche: e.niche, amount: e.amount });
    if (e.kind === 'ability' && e.id === 'architect') out.push(...ARCHITECT.slots);
  }
  return out;
}

/**
 * Plätze je Nische auf einer Stufe. Mit `niches` zählen auch die Plätze, die Tiere
 * schaffen (Wirkung `slot`, z. B. Borkenkäfer → +1 Höhlen). Solche Plätze öffnen eine
 * geschlossene Nische nur, wenn sie `opensEarly` hat (DESIGN_V2.md, Abschnitt 3).
 */
export function nicheSlots(
  stage: number,
  niches?: Partial<Record<NicheId, readonly string[]>>,
  bonus: readonly SlotBonus[] = [],
): Record<NicheId, number> {
  const slots = {} as Record<NicheId, number>;
  for (const id of NICHE_IDS) slots[id] = NICHES_BY_ID.get(id)!.slots[stage] ?? 0;
  if (!niches && bonus.length === 0) return slots;
  const extra = {} as Record<NicheId, number>;
  for (const id of NICHE_IDS) extra[id] = 0;
  // Plätze aus Ereignissen (Zyklus-Boni) zählen wie die der Tiere (inkl. opensEarly).
  for (const b of bonus) if (b.niche in extra) extra[b.niche] += finite(b.amount);
  for (const id of NICHE_IDS) {
    for (const sid of niches?.[id] ?? []) {
      const sp = SPECIES_BY_ID.get(sid);
      if (sp) for (const e of slotEffects(sp)) extra[e.niche] += e.amount;
    }
  }
  for (const id of NICHE_IDS) {
    if (slots[id] > 0 || NICHES_BY_ID.get(id)!.opensEarly) slots[id] = Math.max(0, slots[id] + extra[id]);
  }
  return slots;
}

/** Wie viele Tiere je Nische keinen Platz haben (0, wenn alles passt). */
export function nicheOverflow(
  stage: number,
  niches: Partial<Record<NicheId, readonly string[]>>,
  bonus: readonly SlotBonus[] = [],
): Record<NicheId, number> {
  const slots = nicheSlots(stage, niches, bonus);
  const out = {} as Record<NicheId, number>;
  for (const id of NICHE_IDS) out[id] = Math.max(0, (niches[id]?.length ?? 0) - slots[id]);
  return out;
}

/** Bekannte Begleitpflanzen (unbekannte IDs werden übersprungen). */
function plantsIn(eco: Ecosystem): Plant[] {
  const out: Plant[] = [];
  for (const id of eco.plants ?? []) {
    const p = PLANTS_BY_ID.get(id);
    if (p) out.push(p);
  }
  return out;
}

/** Pflanzplätze auf einer Stufe (0 für unbekannte Stufen). */
export function plantSlots(stage: number): number {
  return STAGES[stage]?.plantSlots ?? 0;
}

/** Kosten der nächsten Pflanze, wenn schon `count` Begleitpflanzen wachsen: 20 · 1,9^count. */
export function plantCost(count: number): number {
  return PLANT_COST_BASE * Math.pow(PLANT_COST_GROWTH, Math.max(0, finite(count)));
}

/** Kosten der nächsten Pflanze in diesem Spielstand. */
export function nextPlantCost(state: Pick<GameState, 'plants'>): number {
  return plantCost(state.plants.length);
}

/** Bekannte Arten des Ökosystems in Nischen-Reihenfolge (unbekannte IDs werden übersprungen). */
function speciesIn(eco: Ecosystem): Species[] {
  const out: Species[] = [];
  for (const id of NICHE_IDS) {
    for (const sid of eco.niches[id] ?? []) {
      const sp = SPECIES_BY_ID.get(sid);
      if (sp) out.push(sp);
    }
  }
  return out;
}

/** IDs, von denen eine ein Mitglied der Lebensgemeinschaft erfüllt. */
export function memberOptions(member: CommunityMember): readonly string[] {
  return typeof member === 'string' ? [member] : member;
}

/** IDs der aktiven Lebensgemeinschaften einer Auswertung. */
export function activeCommunities(ev: Pick<Evaluation, 'communities'>): string[] {
  return ev.communities.filter((c) => c.active).map((c) => c.id);
}

/**
 * Welche Lebensgemeinschaften entstehen bzw. zerfallen zwischen zwei Auswertungen (z. B.
 * jetzt und previewChoice)? `completed` mit der Harmonie danach, `broken` mit der
 * Harmonie davor – jeweils in der Reihenfolge von COMMUNITIES.
 */
export function communityChanges(
  before: Pick<Evaluation, 'communities'>,
  after: Pick<Evaluation, 'communities'>,
): { completed: CommunityStatus[]; broken: CommunityStatus[] } {
  const was = new Map(before.communities.map((c) => [c.id, c]));
  const is = new Map(after.communities.map((c) => [c.id, c]));
  return {
    completed: after.communities.filter((c) => c.active && !was.get(c.id)?.active),
    broken: before.communities.filter((c) => c.active && !is.get(c.id)?.active),
  };
}

/** Reine Berechnung ohne Cache – für Vorschauen und Tests. */
export function evaluateEcosystem(eco: Ecosystem): Evaluation {
  const stage = STAGES[eco.stage] ?? STAGES[0]!;
  const animals = speciesIn(eco);
  const plants = plantsIn(eco);
  const present = new Set(animals.map((a) => a.id));
  // Für Wünsche „bestimmte Art“ zählen auch Pflanzen (z. B. Große Brennnessel).
  const presentOrPlanted = new Set<string>([...present, ...plants.map((p) => p.id)]);

  // Pflanzengruppen (Hauptbaum zählt als Baum)
  const groupCount: Record<PlantGroup, number> = { trees: 1, shrubs: 0, flowers: 0, mosses: 0 };
  for (const p of plants) groupCount[p.group]++;

  // Futterangebot je Merkmal ohne Tiere; die Tiere kommen in zwei Durchgängen dazu (22.3).
  const plantSupply = new Map<Tag, number>();
  const addSupply = (supply: Map<Tag, number>, tag: Tag, n: number) => supply.set(tag, (supply.get(tag) ?? 0) + n);
  // Merkmale des Hauptbaums (Kiefer: Nadeln, aber keine Nüsse).
  for (const t of mainTreeTags(eco)) addSupply(plantSupply, t, SUPPLY_MAIN_TREE);
  for (const p of plants) for (const t of p.provides) addSupply(plantSupply, t, SUPPLY_PLANT);
  // Merkmale aus Ereignissen (z. B. Totholz nach der Sturmnacht) wie eine Begleitpflanze.
  for (const t of eco.habitats ?? []) addSupply(plantSupply, t, SUPPLY_PLANT);
  // Durchgang 1: jedes Tier mit SUPPLY_ANIMAL (für z⁰ und den Bestand).
  const firstSupply = new Map(plantSupply);
  for (const a of animals) for (const t of a.provides) addSupply(firstSupply, t, SUPPLY_ANIMAL);
  // Jahreszeit und Baumart wirken wie Zusatz-Wirkungen (Faktor 1); `happiness` unten je Tier.
  const environment = environmentEffects(eco.stage, eco.season, eco.mainTree, eco.site, eco.gifts);
  const extraEffects = [...(eco.extraEffects ?? []), ...environment.effects];
  const happinessBonus = {} as Record<Genus, number>;
  for (const g of GENERA) happinessBonus[g] = 0;
  for (const e of environment.happiness) if (e.genus in happinessBonus) happinessBonus[e.genus] += finite(e.points) / 100;
  const demand = new Map<Tag, number>();
  for (const a of animals) for (const t of a.food) demand.set(t, (demand.get(t) ?? 0) + 1);

  // Fähigkeiten wirken je einmal, solange ihre Art lebt.
  const abilities = new Set<AbilityId>();
  for (const a of animals) for (const e of a.effects) if (e.kind === 'ability') abilities.add(e.id);

  const genusCounts = {} as Record<Genus, number>;
  for (const g of GENERA) genusCounts[g] = 0;
  for (const a of animals) {
    genusCounts[a.genus]++;
    if (hasAbility(a, 'countsAsBird')) genusCounts[COUNTS_AS_GENUS]++;
  }
  // Bewirtete Gäste zählen für die Gattungsboni.
  for (const g of eco.guestGenera ?? []) if (g in genusCounts) genusCounts[g]++;

  // Sonnig: Licht, das nach allen Begleitpflanzen frei bleibt (Tier-Lichtboni zählen voll).
  let openLight = stage.light;
  for (const p of plants) openLight -= p.light;
  for (const a of animals) for (const e of a.effects) if (e.kind === 'light') openLight += e.amount;
  for (const e of extraEffects) if (e.kind === 'light') openLight += e.amount;
  const sunny = openLight >= SUNNY_MIN_LIGHT;
  const shady = groupCount.trees >= SHADY_MIN_TREES;

  const unhunted = unhuntedTags(animals);
  const condMet = (c: Condition, supply: ReadonlyMap<Tag, number>): boolean => {
    switch (c.kind) {
      case 'sunny':
        return sunny;
      case 'shady':
        return shady;
      case 'tag':
        return (supply.get(c.tag) ?? 0) > 0;
      case 'group':
        return groupCount[c.group] >= c.min;
      case 'species':
        return presentOrPlanted.has(c.id);
      case 'genus':
        return genusCounts[c.genus] >= c.min;
      case 'unhunted':
        // Für Wünsche nicht vorgesehen, aber gleich wie bei den Erscheinungsbedingungen.
        return unhunted.has(c.tag);
      case 'site':
        // Ebenso nur für Erscheinungsbedingungen (Kennarten).
        return eco.oldSite !== undefined && eco.oldSite === c.site;
    }
  };

  // Landschaft der Angst: Beute eines Jägers mit `fear` frisst nicht und lichtet doppelt.
  const fearful = new Set<string>();
  for (const hunter of animals) {
    if (!hasAbility(hunter, 'fear')) continue;
    for (const prey of animals) if (prey.provides.some((t) => hunter.food.includes(t))) fearful.add(prey.id);
  }

  /**
   * Zufriedenheit eines Tiers bei diesem Futterangebot und `penalty` Abzug durch Überjagung
   * (DESIGN_V2.md 2.3): Futter, Wünsche, Störung, Jahreszeit/Baumart, Fähigkeiten.
   */
  const happinessOf = (a: Species, supply: ReadonlyMap<Tag, number>, penalty: number) => {
    let food = 0;
    for (const t of a.food) {
      const s = supply.get(t) ?? 0;
      const d = demand.get(t) ?? 1;
      food = Math.max(food, Math.min(1, s / d));
    }
    const needs = a.needs.map((c) => condMet(c, supply));
    const met = needs.filter(Boolean).length;
    const q = (FOOD_WEIGHT * food + met) / (FOOD_WEIGHT + a.needs.length);
    const base = BASE_HAPPINESS[a.rarity] ?? 0;
    let z = base + (1 - base) * q;
    let disturbers = 0;
    for (const d of DISTURBERS_OF.get(a.id) ?? []) if (present.has(d)) disturbers++;
    z -= DISTURB_PENALTY * disturbers;
    z -= penalty;
    // Zufriedenheit der Gattung aus Jahreszeit und Baumart (Wirkung `happiness`).
    z += happinessBonus[a.genus] ?? 0;
    if (abilities.has('decomposerBoost') && a.level === DECOMPOSER_BOOST.level) z += DECOMPOSER_BOOST.happiness;
    if (abilities.has('architect') && a.niche === ARCHITECT.niche) z += ARCHITECT.happiness;
    if (hasAbility(a, 'calm')) z = Math.max(z, CALM_MIN_HAPPINESS);
    return { happiness: Math.min(1, Math.max(0, z)), food, needs, disturbers };
  };

  // Räuber und Beute (DESIGN_V2.md 22.3/22.4), genau ein Durchgang ohne Iteration:
  // (1) z⁰ mit dem Angebot aus Durchgang 1, (2) Bestand, (3) Angebot mit Bestand.
  const stock = new Map<string, number>();
  for (const a of animals) if (a.provides.length > 0) stock.set(a.id, stockFor(happinessOf(a, firstSupply, 0).happiness));
  // Futter je Beute = max(SUPPLY_ANIMAL, Bestand): Ein kümmerlicher Bestand senkt das Futter
  // nicht unter den Stand vor Welle 3 – kein Räuber wird schlechter (22.3).
  const foodSupply = new Map(plantSupply);
  const stockOf = new Map<Tag, number>();
  const shareOf = new Map<Tag, number>();
  for (const a of animals) {
    const own = stock.get(a.id);
    if (own === undefined) continue;
    const share = Math.max(SUPPLY_ANIMAL, own);
    for (const t of a.provides) {
      addSupply(foodSupply, t, share);
      addSupply(shareOf, t, share);
      addSupply(stockOf, t, own);
    }
  }
  // Räuber je Merkmal (in Nischen-Reihenfolge, eine Art kann selbst Beute sein).
  const eaters = new Map<Tag, Species[]>();
  for (const p of animals) {
    if (p.level !== 'predator') continue;
    for (const t of p.food) eaters.set(t, [...(eaters.get(t) ?? []), p]);
  }
  // Überjagung je Beute: das knappste Merkmal (Jäger ohne sie selbst minus Futterangebot
  // der Beute); dazu die Jäger dieses Merkmals (für die Anzeige).
  const overhuntOf = (a: Species): { units: number; by: string[] } => {
    let worst = { units: 0, by: [] as string[] };
    for (const t of a.provides) {
      const hunters = (eaters.get(t) ?? []).filter((p) => p.id !== a.id);
      const units = overhuntUnits(hunters.length, shareOf.get(t) ?? 0);
      if (units > worst.units) worst = { units, by: hunters.map((p) => p.id) };
    }
    return worst;
  };

  // (4) Zufriedenheit je Tier mit dem Angebot aus Bestand und mit Überjagung.
  const status: Record<string, AnimalStatus> = {};
  let happinessSum = 0;
  for (const a of animals) {
    let hunters = 0;
    for (const h of HUNTERS_OF.get(a.id) ?? []) if (present.has(h)) hunters++;
    const { units: overhunt, by } = overhuntOf(a);
    const { happiness: z, food, needs, disturbers } = happinessOf(a, foodSupply, OVERHUNT_PENALTY * overhunt);
    const own = stock.get(a.id);
    status[a.id] = { happiness: z, food, needs, hunters, disturbers, overhunt };
    if (own !== undefined) status[a.id]!.stock = own;
    if (overhunt > 0) status[a.id]!.overhuntedBy = by;
    happinessSum += z;
  }

  // Nahrungsnetz für die Anzeige (22.7): je Beute-Merkmal mit Beute im Ökosystem.
  const foodWeb: FoodWebEntry[] = [];
  for (const tag of PREY_TAGS) {
    const prey = animals.filter((a) => a.provides.includes(tag));
    if (prey.length === 0) continue;
    const hunterList = eaters.get(tag) ?? [];
    const controllers = animals.filter((a) => !hunterList.includes(a) && a.effects.some((e) => e.kind === 'control' && e.tag === tag));
    const tagSupply = shareOf.get(tag) ?? 0;
    const overhunted = prey.some((b) => overhuntUnits(hunterList.filter((p) => p.id !== b.id).length, tagSupply) > 0);
    foodWeb.push({
      tag,
      prey: prey.map((a) => a.id),
      hunters: hunterList.map((a) => a.id),
      controllers: controllers.map((a) => a.id),
      stock: stockOf.get(tag) ?? 0,
      supply: tagSupply,
      state: unhunted.has(tag) ? 'unhunted' : overhunted ? 'overhunted' : 'balanced',
    });
  }

  // Wirkungen sammeln
  let growthBonus = 0;
  let seedsBonus = 0;
  let harmonyExtra = 0;
  let light = stage.light;
  let water = stage.water;
  const groupGrowth: Record<PlantGroup, number> = { trees: 0, shrubs: 0, flowers: 0, mosses: 0 };
  const groupSeeds: Record<PlantGroup, number> = { trees: 0, shrubs: 0, flowers: 0, mosses: 0 };
  const controls: { tag: Tag; strength: number }[] = [];
  const apply = (e: Effect, scale: number) => {
    switch (e.kind) {
      case 'growth':
        growthBonus += (e.pct / 100) * scale;
        break;
      case 'seeds':
        seedsBonus += (e.pct / 100) * scale;
        break;
      case 'groupGrowth':
        groupGrowth[e.group] += (e.pct / 100) * scale;
        break;
      case 'groupSeeds':
        groupSeeds[e.group] += (e.pct / 100) * scale;
        break;
      case 'water':
        water += e.amount * scale;
        break;
      case 'light':
        light += e.amount * scale;
        break;
      case 'control':
        controls.push({ tag: e.tag, strength: (e.pct / 100) * scale });
        break;
      case 'harmony':
        harmonyExtra += e.points * scale;
        break;
      case 'damage':
      case 'slot':
      case 'disturb':
      case 'ability':
        break; // Fraß unten gesondert, Plätze in nicheSlots(), Störung und Fähigkeiten oben
    }
  };
  // Nachtwirkung nachtaktiver Arten (21.6): × Zufriedenheit × Nachtanteil, nur 🌿/🌰.
  const night = Math.min(1, Math.max(0, finite(eco.night ?? 0)));
  for (const a of animals) {
    const z = status[a.id]!.happiness;
    for (const e of a.effects) apply(e, z);
    const nocturnal = night > 0 ? NOCTURNAL_BY_SPECIES.get(a.id) : undefined;
    if (nocturnal && nocturnalInSeason(nocturnal, eco.season)) for (const e of nocturnal.effects) apply(e, z * night);
    if (fearful.has(a.id)) {
      for (const e of a.effects) if (e.kind === 'light') light += e.amount * z * (FEAR_LIGHT_FACTOR - 1);
    }
  }
  // Ereignis-Boni und Gäste wirken voll (Faktor 1, wie Lebensgemeinschaften).
  for (const e of extraEffects) apply(e, 1);
  // Wetter wie die Jahreszeit (Faktor 1); nur 🌿/🌰 und Gruppen, nie Harmonie oder Plätze.
  for (const e of ecosystemWeatherEffects(eco, animals)) apply(e, 1);
  const traitTiers = {} as Record<Genus, number>;
  for (const g of GENERA) {
    const tier = TRAIT_THRESHOLDS.filter((t) => genusCounts[g] >= t).length;
    traitTiers[g] = tier;
    for (let i = 0; i < tier; i++) for (const e of TRAITS[g][i]!.effects) apply(e, 1);
  }

  // Lebensgemeinschaften: Mitglieder sind Tiere oder Begleitpflanzen.
  const communityBonus = abilities.has('communityBoost') ? COMMUNITY_BOOST_HARMONY : 0;
  let communityPoints = 0;
  const communities: CommunityStatus[] = COMMUNITIES.map((c) => {
    const missing: string[][] = [];
    for (const m of c.members) {
      const options = memberOptions(m);
      if (!options.some((id) => presentOrPlanted.has(id))) missing.push([...options]);
    }
    const active = missing.length === 0;
    const points = active ? c.harmony + communityBonus : 0;
    if (active) {
      communityPoints += points;
      for (const e of c.effects) apply(e, 1);
    }
    return { id: c.id, active, present: c.members.length - missing.length, total: c.members.length, missing, harmony: points };
  });

  // Fraßschaden, gemindert durch Räuber (multiplikativ) und Fähigkeiten
  let damage = 0;
  let unguarded = 0;
  for (const a of animals) {
    for (const e of a.effects) {
      if (e.kind !== 'damage') continue;
      let d = e.pct / 100;
      if (fearful.has(a.id)) d = 0;
      for (const c of controls) if (a.provides.includes(c.tag)) d *= Math.max(0, 1 - c.strength);
      if (abilities.has('nightWatch') && a.level === NIGHT_WATCH.level) d *= 1 - NIGHT_WATCH.reduction;
      damage += d;
      if (d > (e.pct / 100) * UNGUARDED_SHARE) unguarded++;
    }
  }

  // Versorgung der Begleitpflanzen mit Licht und Wasser
  let lightNeed = 0;
  let waterNeed = 0;
  for (const p of plants) {
    lightNeed += p.light;
    // Hüter der Feuchte: Moose & Farne brauchen kein Wasser (Moos speichert weiter).
    waterNeed += abilities.has('mossNoWater') && p.group === NO_WATER_GROUP ? Math.min(0, p.water) : p.water;
  }
  // Negative Wirkungen (Dichte Krone: −2 ☀️) drücken Licht und Wasser nie unter 0.
  light = Math.max(0, light);
  water = Math.max(0, water);
  let supply = 1;
  if (lightNeed > 0) supply = Math.min(supply, light / lightNeed);
  if (waterNeed > 0) supply = Math.min(supply, water / waterNeed);
  if (abilities.has('minSupply')) supply = Math.max(supply, MIN_SUPPLY_FLOOR);
  supply = Math.max(0, Math.min(1, supply));

  // Nahrungspyramide (Hauptbaum zählt wie MAIN_TREE_WEIGHT Pflanzen)
  const herbivores = animals.filter((a) => a.level === 'herbivore').length;
  const predators = animals.filter((a) => a.level === 'predator');
  const decomposers = animals.filter((a) => a.level === 'decomposer').length;
  const plantWeight = MAIN_TREE_WEIGHT + plants.length;
  const levels = (5 * [herbivores, predators.length, decomposers].filter((n) => n > 0).length) / 3;
  const carrying = herbivores > 0 ? 5 * Math.min(1, plantWeight / (1.5 * herbivores)) : 5;
  const fed = predators.length > 0 ? (5 * predators.reduce((s, p) => s + status[p.id]!.food, 0)) / predators.length : 0;
  const consumers = plantWeight + herbivores + predators.length;
  const cycle = 5 * Math.min(1, decomposers / (consumers / 5));
  const pyramid = levels + carrying + fed + cycle - UNGUARDED_PENALTY * unguarded;

  // Harmonie = Vielfalt + Zufriedenheit + Pyramide + Lebensgemeinschaften + Harmonie-Wirkungen
  // Vielfalt: 3 je Gattung und je Pflanzengruppe mit Begleitpflanzen, 1 je verschiedene Art.
  const groups = new Set<string>(animals.map((a) => a.genus));
  for (const p of plants) groups.add(`plant:${p.group}`);
  const variety = 3 * groups.size + present.size + new Set(plants.map((p) => p.id)).size;
  const avgHappiness = animals.length > 0 ? happinessSum / animals.length : 0;
  const happinessPoints = 30 * avgHappiness;
  const harmony = variety + happinessPoints + pyramid + communityPoints + harmonyExtra;
  const multiplier = 1 + harmony / HARMONY_DIVISOR;

  // Wachstum und Samen (Waldgedächtnis: +1 % je Punkt, FOREST_MEMORY_BONUS)
  const memory = 1 + FOREST_MEMORY_BONUS * Math.min(MAX_FOREST_MEMORY, Math.max(0, finite(eco.forestMemory)));
  // Begleitpflanzen wachsen mit der Versorgung V, der Hauptbaum unabhängig davon.
  let companionGrowth = 0;
  let companionSeeds = 0;
  for (const p of plants) {
    companionGrowth += p.growth * (1 + groupGrowth[p.group]);
    companionSeeds += p.seeds * (1 + groupSeeds[p.group]);
  }
  const factor = Math.max(MIN_GROWTH_FACTOR, 1 + growthBonus - damage);
  const tree = stage.treeGrowth * (1 + groupGrowth.trees);
  const growthScale = factor * multiplier * memory;
  const growth = (tree + supply * companionGrowth) * growthScale;
  const treeSeeds = stage.treeSeeds * (1 + groupSeeds.trees);
  const seedsScale = (1 + seedsBonus) * multiplier * memory;
  const seeds = (treeSeeds + supply * companionSeeds) * seedsScale;

  return {
    growth,
    seeds,
    harmony,
    multiplier,
    breakdown: { variety, happiness: happinessPoints, pyramid, communities: communityPoints, extra: harmonyExtra },
    communities,
    animals: status,
    foodWeb,
    avgHappiness,
    slots: nicheSlots(eco.stage, eco.niches, slotBonusesOf(extraEffects)),
    genusCounts,
    traitTiers,
    growthBonus,
    seedsBonus,
    damage,
    unguarded,
    sunny,
    shady,
    abilities: [...abilities],
    light,
    water,
    lightNeed,
    waterNeed,
    supply,
    groupCounts: groupCount,
    plantGrowth: supply * companionGrowth * growthScale,
    plantSeeds: supply * companionSeeds * seedsScale,
    plantSlots: plantSlots(eco.stage),
  };
}

/**
 * Abgeleitete Werte des Spielstands. Gecacht: Sie ändern sich nur durch Aktionen und
 * Stufenwechsel, nicht pro Tick. Das Ergebnis wird geteilt und ist darum tief
 * eingefroren – Schreibversuche werfen im Strict Mode einen Fehler.
 */
export function evaluate(state: GameState, ambient: AmbientMode = 'live'): Readonly<Evaluation> {
  const key = ecosystemKey(state, ambient);
  if (cache && cache.key === key) return cache.value;
  const value = deepFreeze(evaluateEcosystem(ecosystemOf(state, {}, ambient)));
  cache = { key, value };
  return value;
}

/** Friert ein Objekt samt aller verschachtelten Objekte und Arrays ein. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

let cache: { key: string; value: Evaluation } | null = null;

/**
 * Cache-Schlüssel: alles, was die Auswertung ändert – auch Zyklus-Boni, Habitate, aktive
 * Zeit-Boni und Gäste (ihre IDs bzw. Wirkungen, nicht die Restdauer). `null` = ohne
 * Jahreszeit, Wetter und Nacht (Samen-Sekunden).
 */
function ecosystemKey(state: GameState, ambient: AmbientMode | null): string {
  const landscape = landscapeOf(state);
  // Wirksames Gedächtnis (24.6), Standort und Gaben (24.2) – ändern sich nur beim Neuen Zyklus
  // und beim Korridorbau.
  let key = `${state.stage}|${effectiveForestMemory(state)}|${(state.plants ?? []).join(',')}`;
  key += `|l:${activeSite(landscape)}|g:${giftSites(landscape).join(',')}`;
  // Jahreszeit, Wetter und Nacht nur als Index bzw. ID (nicht `elapsed` – sonst wäre der
  // Cache jede Sekunde ungültig). Die Dämpfung hängt an Nischen, Pflege und Baumart – alle
  // im Schlüssel.
  if (state.cycle) {
    if (ambient !== null) {
      key += `|s:${seasonIndex(state.cycle.elapsed)}`;
      if (ambient === 'live') {
        key += `|w:${weatherOfDay(state.cycle, dayIndex(state.cycle.elapsed), activeSite(landscape))}|n:${nightShare('live', state.cycle.elapsed) > 0 ? 1 : 0}`;
      } else {
        key += ambient === 'average' ? `|w:avg:${averageWeatherOf(state.cycle.elapsed)}:${activeSite(landscape)}` : '|w:off';
      }
    }
    key += `|m:${mainTreeOf(state.cycle.mainTree).id}`;
  }
  for (const id of NICHE_IDS) key += `|${(state.niches[id] ?? []).join(',')}`;
  const c = state.cycle;
  if (c) {
    key += `|h:${(c.habitats ?? []).join(',')}|v:${(c.visitors ?? []).map((v) => v.id).join(',')}`;
    if ((c.bonuses ?? []).length > 0) key += `|b:${keyJson(c.bonuses.map((b) => b.effect))}`;
    if ((c.timed ?? []).length > 0) key += `|t:${keyJson(c.timed.map((t) => t.effect))}`;
    const care = Object.entries(c.care ?? {}).filter(([, r]) => r > 0);
    if (care.length > 0) key += `|c:${care.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, r]) => `${id}=${r}`).join(',')}`;
  }
  return key;
}

/**
 * JSON für Cache-Schlüssel, aber mit unterscheidbaren Sonderzahlen: JSON.stringify macht
 * aus Infinity, -Infinity und NaN gleichermaßen `null` – zwei kaputte Zustände hintereinander
 * bekämen sonst den Cache-Wert des ersten. Sonderzahlen werden zu `"#NaN"` usw.
 */
function keyJson(value: unknown): string {
  const plain = JSON.stringify(value);
  // Ohne `null` gab es keine Sonderzahl (Normalfall) – kein Replacer nötig.
  if (!plain.includes('null')) return plain;
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? `#${v}` : v,
  );
}

// ---------------------------------------------------------------------------
// Tierkarten: Erscheinungsbedingungen und Seltenheitsgewichte
// ---------------------------------------------------------------------------

/**
 * Was im Ökosystem da ist – Grundlage für Erscheinungsbedingungen. Einmal berechnen und
 * für viele Arten nutzen (z. B. beim Ziehen der Tierkarten).
 */
export interface AppearsContext {
  tags: ReadonlySet<Tag>;
  /** Arten und Pflanzen im Ökosystem. */
  ids: ReadonlySet<string>;
  /** Pflanzen je Gruppe, Hauptbaum zählt als Baum. */
  groups: Readonly<Record<PlantGroup, number>>;
  /** Tiere je Gattung – ohne Fähigkeiten (das Langohr zählt hier nicht als Vogel). */
  genera: Readonly<Record<Genus, number>>;
  /** Merkmale, die ein Tier bereitstellt, aber keines jagt oder klein hält (`unhunted`, 22.5). */
  unhunted: ReadonlySet<Tag>;
  /** Alter aktiver Wald (Bedingung `site`, 26.3) – fehlt: keine Kennart erscheint. */
  oldSite?: SiteId;
}

/** Merkmale, die der Hauptbaum auf dieser Stufe bereitstellt (ohne Art: wie die Eiche). */
export function mainTreeTags(eco: Pick<Ecosystem, 'stage' | 'mainTree'>): Tag[] {
  const tree = mainTreeOf(eco.mainTree);
  const tags = [...tree.tags];
  if (tree.nutsFromStage !== null && eco.stage >= tree.nutsFromStage && !tags.includes('nuesse')) tags.push('nuesse');
  return tags;
}

export function appearsContext(eco: Pick<Ecosystem, 'stage' | 'niches' | 'plants' | 'habitats' | 'mainTree' | 'oldSite'>): AppearsContext {
  const animals = speciesIn({ ...eco, forestMemory: 0 });
  const plants = plantsIn({ ...eco, forestMemory: 0 });
  const tags = new Set<Tag>(mainTreeTags(eco));
  for (const p of plants) for (const t of p.provides) tags.add(t);
  for (const a of animals) for (const t of a.provides) tags.add(t);
  for (const t of eco.habitats ?? []) tags.add(t);
  const groups: Record<PlantGroup, number> = { trees: 1, shrubs: 0, flowers: 0, mosses: 0 };
  for (const p of plants) groups[p.group]++;
  const genera = {} as Record<Genus, number>;
  for (const g of GENERA) genera[g] = 0;
  for (const a of animals) genera[a.genus]++;
  const ids = new Set<string>([...animals.map((a) => a.id), ...plants.map((p) => p.id)]);
  const ctx: AppearsContext = { tags, ids, groups, genera, unhunted: unhuntedTags(animals) };
  if (eco.oldSite !== undefined) ctx.oldSite = eco.oldSite;
  return ctx;
}

/**
 * Ist die Erscheinungsbedingung der Art erfüllt (DESIGN_V2.md 5.2, 7.3)? Arten ohne
 * `appears` erscheinen immer. Geprüft wird nur, was im Ökosystem da ist: Merkmale
 * (Hauptbaum, Pflanzen, Tiere), Pflanzengruppen, Arten/Pflanzen und Gattungen (ohne
 * Fähigkeiten) und ungejagte Beute (`unhunted`: kein Räuber frisst sie, keine Art hält sie
 * klein). „sonnig“ und „schattig“ gelten hier immer als erfüllt. Gilt nur fürs
 * Anbieten: Eine schon gezogene Karte bleibt wählbar, auch wenn die Bedingung wegfällt.
 * `eco` darf ein vorberechneter Kontext (appearsContext) sein.
 */
export function speciesAppears(
  eco: Pick<Ecosystem, 'stage' | 'niches' | 'plants' | 'habitats' | 'mainTree' | 'oldSite'> | AppearsContext,
  sp: Pick<Species, 'appears'>,
): boolean {
  if (!sp.appears || sp.appears.length === 0) return true;
  const ctx = 'tags' in eco ? eco : appearsContext(eco);
  const met = (c: Condition): boolean => {
    switch (c.kind) {
      case 'sunny':
      case 'shady':
        return true;
      case 'tag':
        return ctx.tags.has(c.tag);
      case 'group':
        return ctx.groups[c.group] >= c.min;
      case 'species':
        return ctx.ids.has(c.id);
      case 'genus':
        return ctx.genera[c.genus] >= c.min;
      case 'unhunted':
        return ctx.unhunted.has(c.tag);
      case 'site':
        return ctx.oldSite !== undefined && ctx.oldSite === c.site;
    }
  };
  return sp.appears.every(met);
}

/**
 * Seltenheitsgewichte [gewöhnlich, selten, besonders, legendär] für Tierkarten auf der
 * Stufe des Ökosystems (DESIGN_V2.md 7.3; RARITY_WEIGHTS in content/encounters.ts). Glückspilz (`rarityBoost`): selten, besonders
 * und legendär je +RARITY_BOOST_POINTS, gewöhnlich −3 × so viel (nie unter 0).
 */
export function rarityWeights(eco: Pick<Ecosystem, 'stage' | 'niches'>): [number, number, number, number] {
  // Ungültige Stufen: auf die Tabelle begrenzen (NaN → Samen).
  const row = Math.min(Math.max(0, Math.floor(finite(eco.stage))), RARITY_WEIGHTS.length - 1);
  const base = RARITY_WEIGHTS[row]!;
  const lucky = speciesIn({ ...eco, forestMemory: 0 }).some((sp) => hasAbility(sp, 'rarityBoost'));
  const b = lucky ? RARITY_BOOST_POINTS : 0;
  return [Math.max(0, base[0] - 3 * b), base[1] + b, base[2] + b, base[3] + b];
}

// ---------------------------------------------------------------------------
// Wegpunkte und Stufen
// ---------------------------------------------------------------------------

/** Benötigtes Gesamt-Wachstum für Wegpunkt k (0 für k ≤ 0, Infinity hinter dem letzten). */
export function thresholdFor(k: number): number {
  if (k <= 0) return 0;
  if (k > WAYPOINT_COUNT) return Infinity;
  return WAYPOINT_THRESHOLDS[k] ?? waypointThreshold(k);
}

/**
 * Gesamt-Wachstum über alle Zyklen (Langzeit-Statistik, DESIGN_V2.md 12.5): abgeschlossene
 * Zyklen + laufender Zyklus. Kaputte Teile zählen als 0, das Ergebnis bleibt endlich.
 */
export function lifetimeGrowth(state: GameState): number {
  const part = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return Math.min(Number.MAX_VALUE, part(state.meta.stats.completedCyclesGrowth) + part(state.totalGrowth));
}

/** Wie viele Wegpunkte hat dieses Gesamt-Wachstum erreicht? */
export function waypointsForGrowth(totalGrowth: number): number {
  let k = 0;
  while (k < WAYPOINT_COUNT && totalGrowth >= thresholdFor(k + 1)) k++;
  return k;
}

/** Höchste Stufe, deren Wegpunkt erreicht ist. */
export function stageForWaypoint(waypoint: number): number {
  let stage = 0;
  for (let i = 0; i < STAGES.length; i++) if (waypoint >= STAGES[i]!.waypoint) stage = i;
  return stage;
}

/** Fortschritt zum nächsten Wegpunkt in [0, 1]; 1 nach dem letzten. */
export function waypointProgress(state: GameState): number {
  return fraction(state.totalGrowth, thresholdFor(state.waypoint), thresholdFor(state.waypoint + 1));
}

/** Sekunden bis zum nächsten Wegpunkt bei aktuellem Wachstum (Infinity nach dem letzten). */
export function secondsToNextWaypoint(state: GameState, ambient: AmbientMode = 'live'): number {
  const next = thresholdFor(state.waypoint + 1);
  if (!Number.isFinite(next)) return Infinity;
  // Rate im selben Modus wie tick (sonst endet ein Schritt knapp vor dem Wegpunkt).
  const rate = evaluate(state, ambient).growth;
  return rate > 0 ? Math.max(0, next - state.totalGrowth) / rate : Infinity;
}

/** Fortschritt zur nächsten Stufe in [0, 1] (linear im Gesamt-Wachstum). 1 auf der letzten Stufe. */
export function stageProgress(state: GameState): number {
  const current = STAGES[state.stage];
  const next = STAGES[state.stage + 1];
  if (!current || !next) return 1;
  return fraction(state.totalGrowth, thresholdFor(current.waypoint), thresholdFor(next.waypoint));
}

/**
 * Kontinuierlicher Wachstumswert für die Darstellung:
 * Stufen-Index + Fortschritt zur nächsten Stufe (z. B. 2.5 = halb vom Setzling zum jungen Baum).
 */
export function growth(state: GameState): number {
  return state.stage + stageProgress(state);
}

// ---------------------------------------------------------------------------
// Begegnungen: Kosten, Erträge, Zustand einer Karte
// ---------------------------------------------------------------------------

export type CardStatus =
  /** Freier Platz – „Wählen“ geht direkt. */
  | 'free'
  /** Nische bzw. Pflanzring voll – nur mit Ersatz (ein Tier entlassen / eine Pflanze ersetzen). */
  | 'full'
  /** Die Art lebt schon im Ökosystem (nur Tiere; Pflanzen dürfen mehrfach wachsen). */
  | 'present'
  /** Nische bzw. Pflanzring auf dieser Stufe noch geschlossen. */
  | 'closed'
  /** Unbekannte Begegnung, Karte, Art oder Pflanze. */
  | 'invalid';

/** Typ einer offenen Begegnung (undefined, wenn es sie nicht gibt). */
export function encounterType(state: GameState, encounterIndex: number): PendingEncounterType | undefined {
  return state.pendingEncounters[encounterIndex]?.type;
}

/**
 * Zustand einer Karte. Für Tierkarten zählt die Nische der Art, für Pflanzenkarten
 * („Etwas keimt“) der Pflanzring. Ob ein bestimmter Tausch erlaubt ist, sagt
 * `choiceBlocker` (z. B. 'would-evict').
 */
export function cardStatus(state: GameState, encounterIndex: number, cardIndex: number): CardStatus {
  const encounter = state.pendingEncounters[encounterIndex];
  const id = encounter?.cards[cardIndex];
  if (encounter === undefined || id === undefined) return 'invalid';
  if (encounter.type === 'event' || encounter.type === 'visitor') return 'invalid';
  if (encounter.type === 'plant') {
    const plant = PLANTS_BY_ID.get(id);
    if (!plant) return 'invalid';
    const slots = plantSlots(state.stage);
    // Gesperrte Pflanzen (später freigeschaltet) behandeln wie einen geschlossenen Ring.
    if (slots <= 0 || plant.unlock > state.stage) return 'closed';
    return state.plants.length < slots ? 'free' : 'full';
  }
  const sp = SPECIES_BY_ID.get(id);
  if (!sp) return 'invalid';
  if (hasSpecies(state, sp.id)) return 'present';
  const slots = nicheSlots(state.stage, state.niches, slotBonuses(state))[sp.niche];
  if (slots <= 0) return 'closed';
  return (state.niches[sp.niche]?.length ?? 0) < slots ? 'free' : 'full';
}

/** Lebt die Art irgendwo im Ökosystem? */
export function hasSpecies(state: Pick<GameState, 'niches'>, speciesId: string): boolean {
  return NICHE_IDS.some((n) => (state.niches[n] ?? []).includes(speciesId));
}

/** Warum eine Karte nicht gewählt werden kann (gleiche Codes wie die Aktion chooseCard). */
export type ChoiceError =
  | 'no-encounter'
  | 'no-card'
  | 'present'
  | 'closed'
  /** Nische voll, kein Tier zum Entlassen genannt. */
  | 'niche-full'
  /** Pflanzring voll, keine Pflanze zum Ersetzen genannt. */
  | 'ring-full'
  /** Der genannte Ersatz lebt nicht in dieser Nische bzw. wächst nicht im Pflanzring. */
  | 'invalid-replace'
  /**
   * Der Tausch nähme anderen Tieren den Platz: Das entlassene Tier schafft Plätze
   * (Borkenkäfer → Höhlen), die noch bewohnt sind.
   */
  | 'would-evict';

/** Ökosystem nach einer Wahl – oder der Grund, warum sie nicht geht. */
export type ChoiceOutcome =
  | { ok: true; niches: Record<NicheId, string[]>; plants: string[] }
  | { ok: false; error: ChoiceError };

/**
 * Rechnet die Wahl einer Karte durch, ohne den Spielstand zu ändern. Grundlage für
 * chooseCard, previewChoice und choiceBlocker – alle drei sind darum immer einig.
 * `replaceId`: bei Tierkarten eine Art der Nische, bei Pflanzenkarten eine Pflanze im Ring.
 */
export function resolveChoice(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  replaceId?: string,
): ChoiceOutcome {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return { ok: false, error: 'no-encounter' };
  const status = cardStatus(state, encounterIndex, cardIndex);
  if (status === 'invalid') return { ok: false, error: 'no-card' };
  if (status === 'present') return { ok: false, error: 'present' };
  if (status === 'closed') return { ok: false, error: 'closed' };
  const id = encounter.cards[cardIndex]!;
  if (encounter.type === 'plant') {
    if (replaceId === undefined && status === 'full') return { ok: false, error: 'ring-full' };
    const plants = plantsAfterChoice(state, id, replaceId);
    if (!plants) return { ok: false, error: 'invalid-replace' };
    return { ok: true, niches: copyNiches(state.niches), plants };
  }
  const sp = SPECIES_BY_ID.get(id)!;
  if (replaceId !== undefined && !(state.niches[sp.niche] ?? []).includes(replaceId)) {
    return { ok: false, error: 'invalid-replace' };
  }
  if (replaceId === undefined && status === 'full') return { ok: false, error: 'niche-full' };
  // Entlassene Tiere können Plätze mitnehmen (Borkenkäfer → Höhlen): nur erlaubt,
  // wenn danach kein Tier ohne Platz dasteht.
  const niches = nichesAfterChoice(state, sp.id, replaceId);
  if (!niches) return { ok: false, error: 'would-evict' };
  return { ok: true, niches, plants: [...state.plants] };
}

/** Warum diese Wahl nicht geht – null, wenn chooseCard sie annähme. */
export function choiceBlocker(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  replaceId?: string,
): ChoiceError | null {
  const outcome = resolveChoice(state, encounterIndex, cardIndex, replaceId);
  return outcome.ok ? null : outcome.error;
}

/**
 * Wie sähe das Ökosystem aus, wenn diese Karte gewählt würde? null genau dann, wenn
 * chooseCard die Wahl ablehnen würde (Grund: choiceBlocker). Für Vorschauen auf
 * Tier- und Pflanzenkarten (Zufriedenheit, Harmonie, 🌿/s, 🌰/s).
 */
export function previewChoice(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  replaceId?: string,
): Evaluation | null {
  const outcome = resolveChoice(state, encounterIndex, cardIndex, replaceId);
  if (!outcome.ok) return null;
  return evaluateEcosystem(ecosystemOf(state, { niches: outcome.niches, plants: outcome.plants }));
}

/**
 * Vorschau für „Pflanze setzen“ (Aktion plantSeed): das Ökosystem mit einer weiteren
 * Pflanze. Prüft weder Kosten noch Freischaltung (siehe plantBlocker); null bei
 * unbekannter Pflanze oder vollem Ring.
 */
export function previewPlant(state: GameState, plantId: string): Evaluation | null {
  const plants = plantsAfterChoice(state, plantId);
  if (!plants) return null;
  return evaluateEcosystem(ecosystemOf(state, { plants }));
}

/**
 * Pflanzring nach dem Keimen von `plantId` (optional anstelle von `replacePlantId`,
 * dessen erstes Vorkommen ersetzt wird). null, wenn die Pflanze unbekannt ist, der
 * Ersatz nicht im Ring wächst oder dieselbe Pflanze ist (Tausch ohne Wirkung), ein
 * Ersatz bei freiem Ring genannt wird (Pflanzen sterben nicht – bei Platz wird nur
 * dazugesetzt) oder der Ring ohne Ersatz voll ist.
 */
export function plantsAfterChoice(
  state: Pick<GameState, 'stage' | 'plants'>,
  plantId: string,
  replacePlantId?: string,
): string[] | null {
  if (!PLANTS_BY_ID.has(plantId)) return null;
  const plants = [...state.plants];
  if (replacePlantId !== undefined) {
    const at = plants.indexOf(replacePlantId);
    if (at < 0 || replacePlantId === plantId || plants.length < plantSlots(state.stage)) return null;
    plants[at] = plantId;
    return plants;
  }
  if (plants.length >= plantSlots(state.stage)) return null;
  plants.push(plantId);
  return plants;
}

/**
 * Nischen nach dem Einzug von `speciesId` (optional anstelle von `replaceSpeciesId`).
 * null, wenn der Ersatz nicht in der Nische lebt oder danach irgendwo mehr Tiere ohne
 * Platz wären als vorher – die Nische ist voll, oder der entlassene Borkenkäfer hat
 * Höhlenplätze geschaffen, die noch belegt sind.
 * Prüft nicht, ob die Art schon lebt oder die Nische offen ist (siehe cardStatus).
 */
export function nichesAfterChoice(
  state: Pick<GameState, 'stage' | 'niches'> & { cycle?: CycleExtras },
  speciesId: string,
  replaceSpeciesId?: string,
): Record<NicheId, string[]> | null {
  const sp = SPECIES_BY_ID.get(speciesId);
  if (!sp) return null;
  const niches = copyNiches(state.niches);
  const occupants = niches[sp.niche];
  if (replaceSpeciesId !== undefined) {
    const at = occupants.indexOf(replaceSpeciesId);
    if (at < 0) return null;
    occupants[at] = sp.id;
  } else {
    occupants.push(sp.id);
  }
  const bonus = slotBonuses(state);
  const before = nicheOverflow(state.stage, state.niches, bonus);
  const after = nicheOverflow(state.stage, niches, bonus);
  return NICHE_IDS.every((id) => after[id] <= before[id]) ? niches : null;
}

function copyNiches(niches: Partial<Record<NicheId, readonly string[]>>): Record<NicheId, string[]> {
  const out = {} as Record<NicheId, string[]>;
  for (const id of NICHE_IDS) out[id] = [...(niches[id] ?? [])];
  return out;
}

/**
 * Samenrate, nach der Samen-Sekunden gerechnet werden: ohne Zeit-Boni, ohne Gäste und
 * ohne Jahreszeit, Wetter und Nacht (sonst ließen sich Samen-Optionen durch vorher gewählte Zeit-Boni
 * aufblähen, und es lohnte sich, mit einer Wahl auf den Herbst zu warten).
 * Zyklus-Boni, Habitate, Pflege und die Baumart zählen mit – sie sind Teil des Ökosystems.
 * Gecacht wie evaluate (die UI fragt jeden Frame).
 */
export function seedSecondsRate(state: GameState): number {
  const c = state.cycle;
  if (!c) return evaluate(state).seeds;
  // Ohne Jahreszeit, Wetter und Nacht im Schlüssel: Die Rate hängt nicht von ihnen ab.
  const key = ecosystemKey(state, null);
  if (seedRateCache && seedRateCache.key === key) return seedRateCache.value;
  const eco = ecosystemOf({ ...state, cycle: { ...c, timed: [], visitors: [] } }, {}, 'off');
  delete eco.season;
  const value = evaluateEcosystem(eco).seeds;
  seedRateCache = { key, value };
  return value;
}

let seedRateCache: { key: string; value: number } | null = null;

/**
 * Samen-Sekunden in Samen: Sekunden × Samenrate ohne Zeit-Boni und Gäste
 * (seedSecondsRate), mindestens SEED_SECONDS_MIN_SEEDS (Ereignisse und Gäste,
 * DESIGN_V2.md 7.4/7.5). NaN und negative Sekunden zählen als 0; das Ergebnis ist
 * immer endlich.
 */
export function seedSeconds(state: GameState, seconds: number): number {
  const rate = seedSecondsRate(state);
  const value = Math.max(0, finite(seconds)) * (Number.isFinite(rate) && rate > 0 ? rate : 0);
  return Math.min(Number.MAX_VALUE, Math.max(SEED_SECONDS_MIN_SEEDS, value));
}

/**
 * Samen für „Ablehnen“ (von Hand und automatisch): DECLINE_SEED_SECONDS Samen-Sekunden,
 * mindestens SEED_SECONDS_MIN_SEEDS (DESIGN_V2.md 7.9). Hängt von der Rate im Moment ab –
 * offline also genau so viel wie online am selben Wegpunkt.
 */
export function declineReward(state: GameState): number {
  return seedSeconds(state, DECLINE_SEED_SECONDS);
}

/** Kosten für „Neu würfeln“ dieser Begegnung (verdoppelt sich je Wurf). */
export function rerollCost(state: GameState, encounterIndex: number): number {
  const rerolls = state.pendingEncounters[encounterIndex]?.rerolls ?? 0;
  return REROLL_BASE_COST * Math.pow(REROLL_COST_GROWTH, Math.max(0, rerolls));
}

function fraction(value: number, from: number, to: number): number {
  if (!Number.isFinite(to) || to <= from) return 1;
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

// ---------------------------------------------------------------------------
// Neuer Zyklus: Waldgedächtnis und Stammgäste (DESIGN_V2.md, Abschnitt 10)
// ---------------------------------------------------------------------------

/** Harmonie-Bonus beim Neuen Zyklus für einen erreichten Wegpunkt (content/memory.ts). */
export interface MemoryHarmonyBonus {
  /** Wegpunkt, für den die Regel gilt (begrenzt auf die Stützstellen, ganzzahlig). */
  waypoint: number;
  /** Sockel: 1 Punkt je so viele Punkte höchster Harmonie, zwischen den Stützstellen krumm (z. B. 5,375). */
  divisor: number;
  /** Schwelle (mit den jetzigen Stützstellen an jedem Wegpunkt ganz, z. B. 118 an Wegpunkt 23). */
  threshold: number;
  /** Obergrenze, zwischen den Stützstellen krumm (z. B. 46,125). */
  maxPoints: number;
  /**
   * Ganze Zahl fürs Panel: kleinste (gerundete) höchste Harmonie, die wirklich mehr bringt als
   * der Sockel ⌊H / D⌋. An ganzen Schwellen T + 1; an krummen Schwellen (2.11b) oft ⌈T⌉,
   * manchmal ⌈T⌉ + 1 (dort Wegpunkt 27, T 121,875: 122 brachte nach dem Abrunden nichts).
   */
  bonusFrom: number;
  /** Ab dieser (gerundeten) höchsten Harmonie ist der Bonus voll: ⌈Schwelle + Obergrenze / 3⌉. */
  fullAt: number;
}

/** Stützstellen: Wegpunkt der Stufe jeder Regel aus MEMORY_HARMONY_RULES, aufsteigend (einmal beim Laden berechnet). */
const MEMORY_RULE_POINTS: readonly { waypoint: number; divisor: number; threshold: number; maxPoints: number }[] = MEMORY_HARMONY_RULES.flatMap((r) => {
  const stage = STAGES.find((s) => s.id === r.stage);
  return stage ? [{ waypoint: stage.waypoint, divisor: r.divisor, threshold: r.threshold, maxPoints: r.maxPoints }] : [];
}).sort((a, b) => a.waypoint - b.waypoint);

/**
 * Gedächtnis aus der (schon gerundeten) Harmonie H: ⌊H / D + min(C, 3 · max(0, H − T))⌋.
 * Erst summieren, dann abrunden: So wächst der Gewinn mit H ohne Rundungsdellen. Kleiner
 * Puffer gegen Gleitkomma.
 */
function harmonyMemoryPoints(harmony: number, divisor: number, threshold: number, maxPoints: number): number {
  const above = Math.max(0, harmony - threshold);
  return Math.floor(harmony / divisor + Math.min(maxPoints, MEMORY_PER_HARMONY_POINT * above) + 1e-9);
}

/**
 * Regel des Waldgedächtnisses für den erreichten Wegpunkt (Schritt 2.11b, Sockel-Teiler seit
 * dem Abgleich mit der Sperrklinke): Teiler D, Schwelle T und Obergrenze C gleiten linear
 * zwischen den Stützstellen aus MEMORY_HARMONY_RULES (Hain, Wegpunkt 20: 5 / 100 / 45 →
 * Wald, 28: 6 / 148 / 48 → Urwald, 36: 7 / 164 / 48). Davor gilt die erste, danach die
 * letzte Stützstelle; NaN zählt wie Wegpunkt 0, Infinity wie der letzte.
 */
export function memoryHarmonyBonus(waypoint: number): MemoryHarmonyBonus {
  const points = MEMORY_RULE_POINTS;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  // NaN zählt wie 0, ±Infinity landet an der ersten bzw. letzten Stützstelle.
  const w = Math.min(last.waypoint, Math.max(first.waypoint, Number.isNaN(waypoint) ? 0 : Math.floor(waypoint)));
  let divisor = first.divisor;
  let threshold = first.threshold;
  let maxPoints = first.maxPoints;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (w > b.waypoint) continue;
    const t = b.waypoint > a.waypoint ? (w - a.waypoint) / (b.waypoint - a.waypoint) : 1;
    divisor = a.divisor + t * (b.divisor - a.divisor);
    threshold = a.threshold + t * (b.threshold - a.threshold);
    maxPoints = a.maxPoints + t * (b.maxPoints - a.maxPoints);
    break;
  }
  const fullAt = Math.ceil(threshold + maxPoints / MEMORY_PER_HARMONY_POINT - 1e-9);
  // Erste ganze Harmonie mit Gewinn über dem Sockel – exakt wie cycleMemoryGain rechnet.
  let bonusFrom = fullAt;
  for (let h = Math.max(0, Math.ceil(threshold)); h <= fullAt; h++) {
    if (harmonyMemoryPoints(h, divisor, threshold, maxPoints) > harmonyMemoryPoints(h, divisor, Infinity, 0)) {
      bonusFrom = h;
      break;
    }
  }
  return { waypoint: w, divisor, threshold, maxPoints, bonusFrom, fullAt };
}

/**
 * Harmonie-Anteil des Waldgedächtnis-Gewinns (ohne neue Arten, ohne Obergrenze des Bestands):
 * mit H = round(H_max): `⌊H / D + min(C, 3 · max(0, H − T))⌋`, Teiler D, Schwelle T und
 * Obergrenze C je Wegpunkt (memoryHarmonyBonus). Steigt mit H_max, sinkt mit dem Wegpunkt – darum merkt
 * sich der Zyklus den besten Wert (`cycle.bestHarmonyMemory`, „Sperrklinke“ seit v10).
 * Negative Harmonie zählt als 0, NaN ergibt 0.
 */
export function harmonyMemoryGain(maxHarmony: number, waypoint: number): number {
  // Einmal kaufmännisch runden – dieselbe ganze Zahl, die Panel, Statistik und Seitenleiste
  // als „Höchste Harmonie“ zeigen (100,6 → 101 zählt also schon extra).
  const harmony = Math.round(Math.max(0, finite(maxHarmony)));
  const bonus = memoryHarmonyBonus(waypoint);
  return harmonyMemoryPoints(harmony, bonus.divisor, bonus.threshold, bonus.maxPoints);
}

/**
 * Waldgedächtnis, das ein Neuer Zyklus einbringt (Schritt 2.11, gleitende Schwelle seit 2.11b,
 * gleitender Sockel-Teiler seit dem Abgleich mit der Sperrklinke): mit H = round(H_max):
 * `⌊H / D + min(C, 3 · max(0, H − T))⌋ + neue Arten`, Teiler D, Schwelle T und Obergrenze C
 * je erreichtem Wegpunkt `waypoint` (memoryHarmonyBonus, Zahlen in content/memory.ts). Im
 * Hain (5 / 100 / 45) ist das genau `⌊H / 5⌋ + min(45, 3 · max(0, H − 100))` wie in 2.11. Begrenzt, sodass der Bestand
 * MAX_FOREST_MEMORY nicht übersteigt. Negative Harmonie zählt als 0; NaN und Unsinn ergeben
 * 0 statt kaputter Spielstände.
 * Sperrklinke (seit v10): `bestHarmonyMemory` ist der beste Harmonie-Anteil, den der Zyklus
 * schon erreicht hatte (`cycle.bestHarmonyMemory`); gezählt wird der größere der beiden
 * Werte. So sinkt die Vorschau nie, auch wenn die Schwelle mit dem Wegpunkt steigt.
 */
export function cycleMemoryGain(
  maxHarmony: number,
  newSpeciesCount: number,
  forestMemory: number,
  waypoint: number,
  bestHarmonyMemory = 0,
): number {
  const best = Math.min(MAX_FOREST_MEMORY, Math.max(0, Math.floor(finite(bestHarmonyMemory))));
  const harmonyPoints = Math.max(best, harmonyMemoryGain(maxHarmony, waypoint));
  const speciesPoints = MEMORY_PER_NEW_SPECIES * Math.max(0, Math.floor(finite(newSpeciesCount)));
  const room = MAX_FOREST_MEMORY - Math.min(MAX_FOREST_MEMORY, Math.max(0, finite(forestMemory)));
  return Math.min(room, harmonyPoints + speciesPoints);
}

/** Plätze für Stammgäste: einer je 25 Punkte Waldgedächtnis. */
export function regularSlots(forestMemory: number): number {
  const memory = Math.min(MAX_FOREST_MEMORY, Math.max(0, finite(forestMemory)));
  return Math.floor(memory / MEMORY_PER_REGULAR_SLOT);
}

/**
 * Plätze für Stammgäste im aktiven Wald – aus dem **wirksamen** Gedächtnis (eigenes +
 * Korridor-Zufluss, DESIGN_V2.md 24.6). Ohne Korridore wie `regularSlots(meta.forestMemory)`.
 */
export function regularSlotsOf(state: Pick<GameState, 'meta'>): number {
  return regularSlots(effectiveForestMemory(state));
}

/**
 * Tageszeit für die Grafik (`SceneInput.dayPhase`, DESIGN_V2.md 19): Tagesanteil in [0, 1)
 * aus der Spielzeit des Zyklus – 0 Mitternacht, 0,5 Mittag. Ein Tag dauert DAY_SECONDS
 * Spielzeit, der Zyklus beginnt bei DAY_START_PHASE (Vormittag). Ungültige Zeit (NaN,
 * negativ) zählt wie 0, sehr große wie MAX_ELAPSED (wie die Jahreszeiten).
 */
export function dayPhaseAt(elapsed: number): number {
  const days = normalizeElapsed(elapsed) / DAY_SECONDS + DAY_START_PHASE;
  const phase = days - Math.floor(days);
  // Rundung kann genau 1 ergeben – auf 0 zurückfalten.
  return phase >= 1 ? 0 : phase;
}
