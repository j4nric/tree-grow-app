/**
 * Adapter: übersetzt Spielstand und Auswertung aus `core/` in das View-Model der
 * v2-Komponenten (view-model.ts). Reine Funktionen ohne DOM – getestet in
 * tests/adapters.test.ts.
 *
 * Hier stehen nur Anzeige-Entscheidungen (Texte, Symbole, Reihenfolge). Alle Zahlen
 * (Zufriedenheit, Harmonie, Vorschau, Kosten) kommen aus core/formulas.ts.
 */
import { ABILITY_INFO } from '../content/abilities';
import { CARE, CARE_BY_ID, type CareEffect } from '../content/care';
import { COMMUNITIES, COMMUNITIES_BY_ID } from '../content/communities';
import { EVENTS_BY_ID, type CycleEffect, type EventOption, type TimedEffect } from '../content/events';
import { KEEPSAKE_INFO, MEMORY_PER_REGULAR_SLOT, NEW_CYCLE_MIN_STAGE } from '../content/memory';
import { SEASON_SECONDS, YEAR_SECONDS } from '../content/seasons';
import { MAIN_TREES, MAIN_TREES_BY_ID } from '../content/trees';
import { seasonAt, seasonIdAt } from '../core/season';
import { isNight } from '../core/weather';
import type { SeasonId } from '../content/seasons';
import {
  activeNightSpecies,
  averagedWeatherText,
  happinessFrom,
  careProtectionDetail,
  careProtectionText,
  nightBadge,
} from './weather-view';
import { NICHES, NICHES_BY_ID } from '../content/niches';
import { PLANT_GROUP_INFO, PLANTS, PLANTS_BY_ID, type Plant } from '../content/plants';
import { GENUS_INFO, SPECIES, SPECIES_BY_ID, TAG_NAMES, type Species } from '../content/species';
import { STAGES } from '../content/stages';
import { TRAITS, TRAIT_THRESHOLDS } from '../content/traits';
import { VISITORS_BY_ID, VISITOR_FAREWELL_LABEL, VISITOR_HOST_LABEL, type Visitor, type VisitorEffect } from '../content/visitors';
import {
  GENERA,
  PLANT_GROUPS,
  type Condition,
  type Effect,
  type NicheId,
  type PlantGroup,
  type Tag,
} from '../content/types';
import {
  UNGUARDED_PENALTY,
  cardStatus,
  choiceBlocker,
  communityChanges,
  declineReward,
  evaluate,
  ecosystemOf,
  evaluateEcosystem,
  hasSpecies,
  lifetimeGrowth,
  memberOptions,
  nextPlantCost,
  plantSlots,
  previewChoice,
  previewPlant,
  regularSlotsOf,
  rerollCost,
  secondsToNextWaypoint,
  slotEffects,
  waypointProgress,
  type AnimalStatus,
  type ChoiceError,
  type Evaluation,
  type FoodWebEntry,
} from '../core/formulas';
import { allAnimals, type GameState } from '../core/state';
import { achievementCountText, toJournalAchievements } from './achievement-view';
import type { SceneAnimal, ScenePlant, ScenePlantGroup, SceneVisitor } from '../render/tree';
import {
  MAX_OFFLINE_SECONDS,
  allWaypointsReached,
  careBlocker,
  careRank,
  chooseEventOption,
  nextCareRank,
  previewCare,
  type CareBlocker,
  eventOptionSeeds,
  hostBlocker,
  plantBlocker,
  regularBlocker,
  visitorSeeds,
  rerollBlocker,
  isTreeUnlocked,
  unlockedPlants,
  type OfflineReport,
} from '../core/tick';
import { formatDuration, formatNumber } from './format';
import { animalStock, foodWebView, huntFoodText, overhuntNotes, preyIcon, stockEffectView } from './food-web-view';
import { memoryBonusLabel, treeLabel } from './cycle-view';
import { effectiveForestMemory } from '../core/landscape';
import { RARITY_LABELS, formatSigned, formatSignedPercent, preferredReplaceOption, seedsLabel, waitingText } from './view-format';
import type { Genus } from '../content/types';
import type {
  ActiveBonusView,
  CareGroup,
  CareView,
  AnimalView,
  CardView,
  CommunityHintView,
  CommunityListView,
  CommunityView,
  ConditionView,
  EcosystemView,
  EffectView,
  EncounterView,
  FactView,
  FamilyView,
  HarmonyPartView,
  JournalCommunityView,
  JournalEntryView,
  JournalKeepsakeView,
  JournalStatView,
  JournalTreeView,
  JournalView,
  NicheView,
  PlantGroupCountView,
  PlantPickerView,
  PlantRingView,
  PlantSlotView,
  PreviewView,
  Rarity,
  ReplaceOptionView,
  SupplyMeterView,
} from './view-model';

/** Seltenheit aus dem Kern (0–3) als Schlüssel des View-Models. */
export const RARITY_KEYS: readonly Rarity[] = ['common', 'rare', 'special', 'legendary'];

export function rarityKey(rarity: number): Rarity {
  return RARITY_KEYS[rarity] ?? 'common';
}

/** Harmoniestufen (DESIGN_V2.md, 9.1) – reine Anzeige. */
export const HARMONY_TIERS: readonly { min: number; label: string }[] = [
  { min: 120, label: 'Ursprüngliche Wildnis' },
  { min: 90, label: 'Blühender Mischwald' },
  { min: 60, label: 'Stimmiges Ökosystem' },
  { min: 30, label: 'Lebendiges Gefüge' },
  { min: -Infinity, label: 'Zarte Anfänge' },
];

export function harmonyTier(harmony: number): string {
  return HARMONY_TIERS[HARMONY_TIERS.length - 1 - harmonyTierIndex(harmony)]!.label;
}

/**
 * Harmoniestufe als Index 0–4 für die Szene (`SceneInput.harmonyTier`): 0–29 → 0,
 * 30–59 → 1, 60–89 → 2, 90–119 → 3, ab 120 → 4. Negative und ungültige Werte → 0.
 */
export function harmonyTierIndex(harmony: number): number {
  const h = Number.isFinite(harmony) ? harmony : 0;
  return HARMONY_TIERS.length - 1 - HARMONY_TIERS.findIndex((t) => h >= t.min);
}

const GROUP_NAMES: Readonly<Record<PlantGroup, string>> = {
  trees: 'Bäume',
  shrubs: 'Sträucher',
  flowers: 'Blumen',
  mosses: 'Moose & Farne',
};

/** Symbole der Pflanzengruppen – dieselben wie auf Pflanzenkarten und im Pflanzring. */
const GROUP_ICONS: Readonly<Record<PlantGroup, string>> = {
  trees: PLANT_GROUP_INFO.trees.icon,
  shrubs: PLANT_GROUP_INFO.shrubs.icon,
  flowers: PLANT_GROUP_INFO.flowers.icon,
  mosses: PLANT_GROUP_INFO.mosses.icon,
};

/** Symbole für Lebensraum-Merkmale in Bedingungen. */
const TAG_ICONS: Partial<Record<Tag, string>> = {
  feucht: '💧',
  totholz: '🪵',
  hoehle: '🕳️',
  laub: '🍂',
  nektar: '🌸',
};

// ---------------------------------------------------------------------------
// Texte für Bedingungen, Wirkungen und Stimmungen
// ---------------------------------------------------------------------------

/** Kurzer Name eines Wunsches, z. B. „Totholz“, „2× Bäume“, „sonniger Platz“. */
export function conditionName(condition: Condition): string {
  switch (condition.kind) {
    case 'tag':
      return TAG_NAMES[condition.tag];
    case 'group':
      return condition.min > 1 ? `${condition.min}× ${GROUP_NAMES[condition.group]}` : GROUP_NAMES[condition.group];
    case 'sunny':
      return 'sonniger Platz';
    case 'shady':
      return 'schattiger Platz';
    case 'species':
      return SPECIES_BY_ID.get(condition.id)?.name ?? PLANTS_BY_ID.get(condition.id)?.name ?? condition.id;
    case 'genus':
      return `${condition.min > 1 ? `${condition.min}× ` : ''}${GENUS_INFO[condition.genus].name}`;
    case 'unhunted':
      return `${TAG_NAMES[condition.tag]} ohne Jäger`;
  }
}

/** Wunsch als Objekt im Satz „wünscht sich …“ (Akkusativ: „einen sonnigen Platz“). */
function wishName(condition: Condition): string {
  if (condition.kind === 'sunny') return 'einen sonnigen Platz';
  if (condition.kind === 'shady') return 'einen schattigen Platz';
  return conditionName(condition);
}

function conditionIcon(condition: Condition): string {
  switch (condition.kind) {
    case 'tag':
      return TAG_ICONS[condition.tag] ?? '🏡';
    case 'group':
      return GROUP_ICONS[condition.group];
    case 'sunny':
      return '☀️';
    case 'shady':
      return '🌲';
    case 'species':
      return SPECIES_BY_ID.has(condition.id) ? GENUS_INFO[SPECIES_BY_ID.get(condition.id)!.genus].icon : '🌱';
    case 'genus':
      return GENUS_INFO[condition.genus].icon;
    case 'unhunted':
      return preyIcon(condition.tag);
  }
}

/** Nahrung als Bedingungszeile: „🍽 Würmer / Insekten / Beeren“. */
export function foodLabel(species: Species): string {
  return `🍽 ${species.food.map((t) => TAG_NAMES[t]).join(' / ')}`;
}

/**
 * Bedingungen einer Art mit Haken/Kreuz. `status` ist der Zustand der Art im
 * (ggf. hypothetischen) Ökosystem; ohne Status gilt nichts als erfüllt. `present` sind die
 * übrigen Tiere dort – damit „(knapp)“ erklärt, mit wem sich die Art das Futter teilt.
 */
export function conditionViews(
  species: Species,
  status: AnimalStatus | undefined,
  present: readonly string[] = [],
  foodWeb?: readonly FoodWebEntry[],
): ConditionView[] {
  const food = status?.food ?? 0;
  const foodRow: ConditionView = { label: foodLabel(species), met: food > 0 };
  if (food > 0 && food < 1) {
    foodRow.label += ' (knapp)';
    foodRow.hint = scarceFoodText(species, present);
  }
  // Jäger: wie es um die Beute steht (Nahrungsnetz, DESIGN_V2.md 22.7), z. B.
  // „Kleinsäuger: Bestand gut für 2 Jäger“.
  const hunt = foodWeb ? huntFoodText(species.id, foodWeb) : '';
  if (hunt) foodRow.hint = foodRow.hint ? `${foodRow.hint} · ${hunt}` : hunt;
  const conditions: ConditionView[] = [foodRow];
  species.needs.forEach((need, i) => {
    conditions.push({ label: `${conditionIcon(need)} ${conditionName(need)}`, met: status?.needs[i] ?? false });
  });
  return conditions;
}

const pct = (value: number) => `${formatNumber(Math.abs(value))} %`;
const sign = (value: number) => (value < 0 ? '−' : '+');

/** Eine Wirkung als Kartenzeile, z. B. „+8 % 🌿“ (gut) oder „Fraß −10 % 🌿“ (schlecht). */
export function effectView(effect: Effect): EffectView {
  switch (effect.kind) {
    case 'growth':
      return { label: `${sign(effect.pct)}${pct(effect.pct)} 🌿`, tone: effect.pct < 0 ? 'bad' : 'good' };
    case 'seeds':
      return { label: `${sign(effect.pct)}${pct(effect.pct)} 🌰`, tone: effect.pct < 0 ? 'bad' : 'good' };
    case 'groupGrowth':
      return {
        label: `${GROUP_NAMES[effect.group]} ${sign(effect.pct)}${pct(effect.pct)} 🌿`,
        tone: effect.pct < 0 ? 'bad' : 'good',
      };
    case 'groupSeeds':
      return {
        label: `${GROUP_NAMES[effect.group]} ${sign(effect.pct)}${pct(effect.pct)} 🌰`,
        tone: effect.pct < 0 ? 'bad' : 'good',
      };
    case 'water':
      return { label: `${sign(effect.amount)}${formatNumber(Math.abs(effect.amount))} 💧`, tone: effect.amount < 0 ? 'bad' : 'good' };
    case 'light':
      return { label: `${sign(effect.amount)}${formatNumber(Math.abs(effect.amount))} ☀️`, tone: effect.amount < 0 ? 'bad' : 'good' };
    case 'damage':
      return { label: `Fraß −${pct(effect.pct)} 🌿`, tone: 'bad' };
    case 'control':
      return { label: `jagt ${TAG_NAMES[effect.tag]} (−${pct(effect.pct)} Fraß)`, tone: 'good' };
    case 'slot': {
      const name = NICHES_BY_ID.get(effect.niche)?.name ?? effect.niche;
      const places = Math.abs(effect.amount) === 1 ? 'Platz' : 'Plätze';
      return {
        label: `${sign(effect.amount)}${formatNumber(Math.abs(effect.amount))} ${places} ${name}`,
        tone: effect.amount < 0 ? 'bad' : 'good',
      };
    }
    case 'harmony':
      return { label: `${sign(effect.points)}${formatNumber(Math.abs(effect.points))} ⚖️`, tone: effect.points < 0 ? 'bad' : 'good' };
    case 'disturb':
      return { label: `stört ${SPECIES_BY_ID.get(effect.target)?.name ?? effect.target}`, tone: 'bad' };
    case 'ability': {
      const info = ABILITY_INFO[effect.id];
      return { label: `${info.name}: ${info.text}`, tone: 'good' };
    }
  }
}

/** Wirkungen einer Art plus „bietet …“ (Futter und Lebensraum für andere). */
export function effectViews(species: Species): EffectView[] {
  const effects = species.effects.map(effectView);
  // Nachtaktive Arten: „🌙 nachts +10 % 🌿“ (DESIGN_V2.md 21.8, Karte und Übersicht).
  const night = nightBadge(species.id);
  if (night) effects.push({ label: night.label, tone: 'good' });
  if (species.provides.length > 0) {
    effects.push({ label: `bietet ${species.provides.map((t) => TAG_NAMES[t]).join(', ')}`, tone: 'neutral' });
  }
  return effects;
}

/** Namen bekannter Arten (unbekannte IDs fallen weg). */
function speciesNames(ids: readonly string[]): string[] {
  return ids.map((id) => SPECIES_BY_ID.get(id)?.name).filter((n): n is string => n !== undefined);
}

/**
 * Andere anwesende Arten, die dasselbe Futter fressen – nur zur Erklärung von „knapp“.
 * Wie knapp es ist, rechnet der Kern (`AnimalStatus.food`).
 */
export function foodCompetitors(species: Species, present: readonly string[]): string[] {
  return present.filter((id) => {
    if (id === species.id) return false;
    const other = SPECIES_BY_ID.get(id);
    return other !== undefined && other.food.some((t) => species.food.includes(t));
  });
}

/**
 * Anwesende Räuber, die etwas fressen, das diese Art bietet – nur für die Namen im Text;
 * die Anzahl liefert der Kern in `AnimalStatus.hunters`, den Abzug (Überjagung,
 * DESIGN_V2.md 22.4) in `AnimalStatus.overhunt`.
 */
export function huntersOf(species: Species, present: readonly string[]): string[] {
  return present.filter((id) => {
    if (id === species.id) return false;
    const other = SPECIES_BY_ID.get(id);
    return other?.level === 'predator' && other.food.some((t) => species.provides.includes(t));
  });
}

/**
 * Anwesende Arten, die diese Art stören (Wirkung `disturb` mit `target` = diese Art) – nur
 * für die Namen; die Anzahl (und damit den Abzug) liefert der Kern in `AnimalStatus.disturbers`.
 */
export function disturbersOf(species: Species, present: readonly string[]): string[] {
  return present.filter((id) => {
    if (id === species.id) return false;
    return (SPECIES_BY_ID.get(id)?.effects ?? []).some((e) => e.kind === 'disturb' && e.target === species.id);
  });
}

/** Erklärung für knappes Futter: „teilt sich das Futter mit Amsel“ oder „wenig Futter da“. */
export function scarceFoodText(species: Species, present: readonly string[]): string {
  const rivals = speciesNames(foodCompetitors(species, present));
  return rivals.length > 0 ? `teilt sich das Futter mit ${listNames(rivals)}` : 'wenig Futter da';
}

/** Unter dieser Zufriedenheit nennt die Stimmung bis zu zwei Gründe statt einem. */
export const MOOD_REASON_BELOW = 0.7;

/**
 * Gründe, warum ein Tier nicht ganz zufrieden ist – wichtigste zuerst: kein Futter,
 * fehlende Wünsche, Störer, knappes Futter (Konkurrenz), Überjagung. Leer = alles erfüllt.
 */
export function moodReasons(species: Species, status: AnimalStatus, present: readonly string[] = []): string[] {
  const reasons: string[] = [];
  // Namen (Konkurrenz, Räuber, Störer) nur, wenn sie den Grund erklären müssen – sonst
  // bleiben die Kacheln in der Seitenleiste kurz.
  const detailed = status.happiness < MOOD_REASON_BELOW;
  const named = (ids: string[]) => (detailed ? speciesNames(ids) : []);
  if (status.food <= 0) reasons.push('sucht Futter');
  species.needs.forEach((need, i) => {
    if (!status.needs[i]) reasons.push(`wünscht sich ${wishName(need)}`);
  });
  if (status.disturbers > 0) {
    const names = named(disturbersOf(species, present));
    reasons.push(names.length > 0 ? `wird gestört von ${listNames(names)}` : 'wird gestört');
  }
  if (status.food > 0 && status.food < 1) {
    const rivals = named(foodCompetitors(species, present));
    reasons.push(rivals.length > 0 ? `teilt sich das Futter mit ${listNames(rivals)}` : 'findet wenig Futter');
  }
  // Jäger stören erst, wenn sie mehr fressen, als Bestand da ist (Überjagung, 22.4).
  // Genannt werden nur die Jäger des überjagten Merkmals (Kern: `overhuntedBy`).
  if (status.overhunt > 0) {
    const hunters = named(status.overhuntedBy ?? huntersOf(species, present));
    reasons.push(hunters.length > 0 ? `ist auf der Hut vor ${listNames(hunters)}` : 'ist auf der Hut');
  }
  return reasons;
}

/**
 * Kurze, freundliche Stimmung eines Tiers – nie traurig, eher ein Hinweis. Unter ~70 %
 * Zufriedenheit nennt sie bis zu zwei Gründe, z. B. „wünscht sich Feuchte ·
 * teilt sich das Futter mit Amsel“. `present`: alle Tiere im Ökosystem.
 */
export function moodText(species: Species, status: AnimalStatus | undefined, present: readonly string[] = []): string {
  if (!status) return 'schaut sich um';
  const reasons = moodReasons(species, status, present);
  if (reasons.length === 0) return 'fühlt sich wohl';
  return reasons.slice(0, status.happiness < MOOD_REASON_BELOW ? 2 : 1).join(' · ');
}

// ---------------------------------------------------------------------------
// Ökosystem-Übersicht
// ---------------------------------------------------------------------------

/** Namen der Arten, die in dieser Nische Plätze schaffen (Wirkung `slot`). */
function slotProviders(nicheId: NicheId): string[] {
  return SPECIES.filter((s) => slotEffects(s).some((e) => e.niche === nicheId && e.amount > 0)).map(
    (s) => s.name,
  );
}

/**
 * Pflegemaßnahmen, deren erster Rang Plätze in der Nische schafft (z. B. „Waldtümpel“) –
 * für Nischen ohne Plätze aus der Stufe und ohne Tiere, die sie öffnen.
 */
function careSlotMeasures(nicheId: NicheId) {
  return CARE.filter((m) =>
    m.ranks[0]?.effects.some((e) => e.kind === 'cycle' && e.effect.kind === 'slot' && e.effect.niche === nicheId && e.effect.amount > 0),
  );
}

function careSlotProviders(nicheId: NicheId): string[] {
  return careSlotMeasures(nicheId).map((m) => `Pflege „${m.name}“ (ab „${STAGES[m.ranks[0]!.minStage]?.name ?? '?'}“)`);
}

/** Name der Stufe, ab der eine Nische Plätze hat (oder null, wenn nie). */
function nicheOpensAt(nicheId: NicheId): string | null {
  const niche = NICHES_BY_ID.get(nicheId);
  const at = niche ? niche.slots.findIndex((n) => n > 0) : -1;
  return at >= 0 ? (STAGES[at]?.name ?? null) : null;
}

/** `present`: alle Tiere im Ökosystem – für die Gründe in der Stimmung (Futterkonkurrenz, Räuber). */
export function animalView(
  speciesId: string,
  evaluation: Readonly<Evaluation>,
  present: readonly string[] = [],
  moment?: { season: SeasonId; night: boolean },
): AnimalView | null {
  const sp = SPECIES_BY_ID.get(speciesId);
  if (!sp) return null;
  const status = evaluation.animals[sp.id];
  const view: AnimalView = {
    id: sp.id,
    name: sp.name,
    family: sp.genus,
    familyIcon: GENUS_INFO[sp.genus].icon,
    rarity: rarityKey(sp.rarity),
    happiness: status?.happiness ?? 0,
    mood: moodText(sp, status, present),
  };
  // Nachtarten (DESIGN_V2.md 21.6): 🌙 an der Kachel, leuchtet, solange die Nachtwirkung gilt.
  const night = nightBadge(sp.id, moment?.season, moment?.night ?? false, status?.happiness ?? 0);
  if (night) view.night = night;
  // Beute im Wald: Bestand in Worten (DESIGN_V2.md 22.7).
  const stock = animalStock(sp.id, evaluation);
  if (stock) view.stock = stock;
  return view;
}

export function harmonyParts(evaluation: Readonly<Evaluation>): HarmonyPartView[] {
  const penalty = UNGUARDED_PENALTY * evaluation.unguarded;
  const parts: HarmonyPartView[] = [
    { label: 'Vielfalt', value: evaluation.breakdown.variety },
    { label: 'Zufriedenheit', value: evaluation.breakdown.happiness },
    // Die Pyramide enthält den Abzug für unbewachte Schädlinge – hier getrennt gezeigt.
    { label: 'Nahrungspyramide', value: evaluation.breakdown.pyramid + penalty },
  ];
  if (penalty > 0) parts.push({ label: 'Unbewachte Schädlinge', value: -penalty });
  if (evaluation.breakdown.communities > 0) parts.push({ label: 'Lebensgemeinschaften', value: evaluation.breakdown.communities });
  // Harmonie-Wirkungen besonderer Arten (Glühwürmchen, Hirschkäfer).
  if (evaluation.breakdown.extra !== 0) parts.push({ label: 'Besondere Arten', value: evaluation.breakdown.extra });
  return parts;
}

export function familyViews(evaluation: Readonly<Evaluation>): FamilyView[] {
  return GENERA.map((g) => ({
    id: g,
    icon: GENUS_INFO[g].icon,
    label: GENUS_INFO[g].name,
    count: evaluation.genusCounts[g] ?? 0,
    thresholds: [...TRAIT_THRESHOLDS],
    bonuses: TRAITS[g].map((t) => t.text),
  }));
}

export function nicheViews(state: GameState, evaluation: Readonly<Evaluation>): NicheView[] {
  const present = allAnimals(state);
  const moment = { season: seasonIdAt(state.cycle.elapsed), night: isNight(state.cycle.elapsed) };
  return NICHES.map((niche) => {
    const capacity = evaluation.slots[niche.id] ?? 0;
    const animals = (state.niches[niche.id] ?? [])
      .map((id) => animalView(id, evaluation, present, moment))
      .filter((a): a is AnimalView => a !== null);
    // Nischen ohne mögliche Bewohner (Höhlen im Prototyp) bleiben verschlossen statt „0/1 belegt“.
    const inhabitable = animals.length > 0 || SPECIES.some((s) => s.niche === niche.id);
    const view: NicheView = {
      id: niche.id,
      icon: niche.icon,
      label: niche.name,
      capacity: inhabitable ? capacity : 0,
      animals,
    };
    if (!inhabitable) {
      view.unlockHint = 'Bewohner folgen bald';
    } else if (capacity <= 0) {
      const at = nicheOpensAt(niche.id);
      if (at) view.unlockHint = `öffnet bei „${at}“`;
      // Nischen, die Tiere früher öffnen können (Höhlen & Totholz): Wer schafft Platz?
      const openers = niche.opensEarly ? slotProviders(niche.id) : [];
      if (openers.length > 0) {
        const who = openers.join(' oder ');
        view.unlockHint = view.unlockHint ? `${view.unlockHint} – oder früher durch ${who}` : `öffnet durch ${who}`;
      }
      // Waldtümpel: öffnet nur durch Pflege (oder Ereignisse – die bleiben eine Überraschung).
      const care = !view.unlockHint && niche.opensEarly ? careSlotProviders(niche.id) : [];
      if (care.length > 0) {
        view.unlockHint = `öffnet durch ${care.join(' oder ')}`;
        // Playtest Amphibien: Steht die Maßnahme schon in der Pflege-Liste, führt ein Knopf hin.
        const ready = careSlotMeasures(niche.id).find((m) => m.ranks[0]!.minStage <= state.stage);
        if (ready) view.careLink = ready.id;
      }
    } else if (animals.length === 0) {
      // Offen, aber noch niemand darf einziehen (Waldtümpel aus dem Regen im Jungen Baum):
      // ab wann die ersten Bewohner kommen.
      const first = Math.min(...SPECIES.filter((s) => s.niche === niche.id).map((s) => s.unlock));
      if (first > state.stage) view.unlockHint = `Bewohner ab „${STAGES[first]?.name ?? '?'}“`;
    }
    return view;
  });
}

/**
 * Text unter dem Fortschrittsbalken: wann die nächste Begegnung kommt – oder, wenn schon
 * welche warten, wie viele (ein Countdown daneben wäre missverständlich).
 */
export function progressHint(state: GameState): string {
  const waiting = state.pendingEncounters.length;
  if (waiting > 0) return waitingText(waiting);
  const seconds = secondsToNextWaypoint(state);
  if (allWaypointsReached(state) || !Number.isFinite(seconds)) return 'Alle Wegpunkte erreicht – dein Wald wächst weiter.';
  return `Nächste Begegnung in ${formatDuration(Math.ceil(seconds))}`;
}

/**
 * Alles für die Seitenleiste. `evaluation` ist `evaluate(state)` – wird übergeben,
 * damit main.ts sie nur einmal pro Frame holt.
 */
export function toEcosystemView(state: GameState, evaluation: Readonly<Evaluation>): EcosystemView {
  const view: EcosystemView = {
    stageName: STAGES[state.stage]?.name ?? STAGES[0]!.name,
    stageProgress: 0,
    progressHint: '',
    pendingEncounters: 0,
    growthPerSec: evaluation.growth,
    seeds: 0,
    seedsPerSec: evaluation.seeds,
    harmony: evaluation.harmony,
    harmonyTier: harmonyTier(evaluation.harmony),
    harmonyMultiplier: evaluation.multiplier,
    harmonyParts: harmonyParts(evaluation),
    families: familyViews(evaluation),
    niches: nicheViews(state, evaluation),
    plantRing: plantRingView(state, evaluation),
    communities: communityListView(evaluation, state.meta.journal.communities),
    foodWeb: foodWebView(evaluation, state),
    night: activeNightSpecies(state, happinessFrom(evaluation)),
  };
  refreshEcosystemView(view, state);
  return view;
}

/**
 * Aktualisiert nur die Werte, die sich jeden Frame ändern (Samen, Fortschritt).
 * Der Rest hängt allein an der Auswertung und wird nur bei Änderungen neu gebaut.
 */
export function refreshEcosystemView(view: EcosystemView, state: GameState): void {
  view.seeds = state.seeds;
  view.stageProgress = waypointProgress(state);
  view.progressHint = progressHint(state);
  view.pendingEncounters = state.pendingEncounters.length;
  refreshPlantRing(view.plantRing, state);
}

// ---------------------------------------------------------------------------
// Lebensgemeinschaften
// ---------------------------------------------------------------------------

/** Symbol einer Lebensgemeinschaft (aus content; Fallback ✨). */
export function communityIcon(id: string): string {
  return COMMUNITIES_BY_ID.get(id)?.icon ?? '✨';
}

/** Ab diesem Anteil erfüllter Mitglieder gilt eine Gemeinschaft als „fast fertig“. */
export const COMMUNITY_NEAR_AT = 0.5;

/** Name einer Art oder Pflanze (unbekannte IDs bleiben, wie sie sind). */
function memberName(id: string): string {
  return SPECIES_BY_ID.get(id)?.name ?? PLANTS_BY_ID.get(id)?.name ?? id;
}

/**
 * Fehlende Mitglieder als Text: je Mitglied die Alternativen mit „oder“, die Mitglieder mit
 * Komma, z. B. „Rollassel, Pfifferling oder Steinpilz“.
 */
export function missingMembersText(missing: readonly (readonly string[])[]): string {
  return missing.map((options) => options.map(memberName).join(' oder ')).join(', ');
}

/** Name einer Gemeinschaft (Fallback: ID). */
function communityName(id: string): string {
  return COMMUNITIES_BY_ID.get(id)?.name ?? id;
}

/**
 * Lebensgemeinschaften für die Seitenleiste aus `evaluate(state).communities`.
 * `discovered`: IDs im Naturtagebuch (`meta.journal.communities`). Noch nicht entdeckte
 * Gemeinschaften erscheinen als „???“ mit Fortschritt und Rätselhinweis. Fehlt nur noch
 * wenig (≥ 50 %), nennt die Zeile die fehlenden Arten bzw. Pflanzen.
 * Reihenfolge: aktive, dann nach Fortschritt (bei Gleichstand wie im Inhalt).
 */
export function communityListView(
  evaluation: Readonly<Pick<Evaluation, 'communities'>>,
  discovered: readonly string[],
): CommunityListView {
  const items: CommunityView[] = evaluation.communities.map((status) => {
    const community = COMMUNITIES_BY_ID.get(status.id);
    const known = status.active || discovered.includes(status.id);
    const progress = status.total > 0 ? Math.min(1, Math.max(0, status.present / status.total)) : 0;
    const state = status.active ? 'active' : progress >= COMMUNITY_NEAR_AT ? 'near' : 'open';
    const view: CommunityView = {
      id: status.id,
      icon: known ? communityIcon(status.id) : '❔',
      name: known ? communityName(status.id) : '???',
      discovered: known,
      state,
      present: status.present,
      total: status.total,
      progress,
      harmony: status.active ? status.harmony : 0,
      effects: (community?.effects ?? []).map((e) => effectView(e).label).join(' · '),
    };
    // „fehlt: …“ nur für schon entdeckte – Unentdeckte verraten nur Hinweis und Fortschritt.
    if (state === 'near' && known && status.missing.length > 0) {
      view.missingText = `fehlt: ${missingMembersText(status.missing)}`;
    }
    if (!known && community) view.hint = community.hint;
    return view;
  });
  const rank = (v: CommunityView) => (v.state === 'active' ? 2 : v.progress);
  const order = new Map(items.map((v, i) => [v.id, i]));
  items.sort((a, b) => rank(b) - rank(a) || order.get(a.id)! - order.get(b.id)!);
  const active = items.filter((v) => v.state === 'active');
  const harmony = active.reduce((sum, v) => sum + v.harmony, 0);
  const count = `${formatNumber(active.length)} von ${formatNumber(items.length)} aktiv`;
  const summary = count + (harmony > 0 ? ` · +${formatNumber(harmony)} ⚖️` : '');
  const summaryText = count + (harmony > 0 ? `, +${formatNumber(harmony)} Harmonie` : '');
  return { items, activeCount: active.length, harmony, summary, summaryText };
}

/**
 * Was eine Wahl an Lebensgemeinschaften ändert (Vergleich jetzt ↔ Vorschau aus dem Kern):
 * ✨ „vervollständigt Humusküche (+8 Harmonie)“ bzw. ⚠️ „löst Humusküche auf (−8 Harmonie)“.
 * Der Name wird auch bei noch unentdeckten genannt – das ist der Moment der Entdeckung.
 */
export function communityPreview(
  now: Readonly<Pick<Evaluation, 'communities'>>,
  after: Readonly<Pick<Evaluation, 'communities'>>,
): CommunityHintView[] {
  const { completed, broken } = communityChanges(now, after);
  return [
    ...completed.map((c) => ({
      icon: '✨',
      label: `vervollständigt ${communityName(c.id)} (+${formatNumber(c.harmony)} Harmonie)`,
      tone: 'good' as const,
    })),
    ...broken.map((c) => ({
      icon: '⚠️',
      label: `löst ${communityName(c.id)} auf (−${formatNumber(c.harmony)} Harmonie)`,
      tone: 'bad' as const,
    })),
  ];
}

/** Entdeckungs-Meldung, z. B. „Neue Lebensgemeinschaft: Humusküche 🌱“ – null, wenn nichts neu ist. */
export function discoveryText(ids: readonly string[] | undefined): string | null {
  if (!ids || ids.length === 0) return null;
  const names = ids.map(communityName);
  if (names.length === 1) return `Neue Lebensgemeinschaft: ${names[0]} 🌱`;
  return `Neue Lebensgemeinschaften: ${listNames(names, names.length)} 🌱`;
}

// ---------------------------------------------------------------------------
// Naturtagebuch
// ---------------------------------------------------------------------------

/** „12/32“ */
const ofTotal = (n: number, total: number) => `${formatNumber(n)}/${formatNumber(total)}`;

/**
 * Das Naturtagebuch (DESIGN_V2.md 10, 11.2): alle Arten, Pflanzen und Lebensgemeinschaften,
 * entdeckte mit Angaben, unentdeckte als Silhouette mit „???“ – ohne Namen und ohne ID
 * (Spoiler-Regel). Entdeckte Arten tragen den Stammgast-Schalter, sobald es Plätze gibt.
 * `evaluation` (= evaluate(state)) liefert, welche Gemeinschaften gerade bestehen.
 */
export function toJournalView(
  state: GameState,
  evaluation: Readonly<Pick<Evaluation, 'communities' | 'harmony'>>,
): JournalView {
  const journal = state.meta.journal;
  const present = new Set(allAnimals(state));
  const slots = regularSlotsOf(state);

  let hiddenSpecies = 0;
  const species: JournalEntryView[] = SPECIES.map((sp) => {
    const rarity = rarityKey(sp.rarity);
    const icon = GENUS_INFO[sp.genus].icon;
    if (!journal.species.includes(sp.id)) {
      return {
        key: `unknown-species-${hiddenSpecies++}`,
        discovered: false,
        icon,
        name: '???',
        family: sp.genus,
        rarity,
        facts: [RARITY_LABELS[rarity]],
        present: false,
      };
    }
    const entry: JournalEntryView = {
      key: sp.id,
      discovered: true,
      icon,
      name: sp.name,
      family: sp.genus,
      rarity,
      facts: [GENUS_INFO[sp.genus].name, RARITY_LABELS[rarity], `Nische: ${NICHES_BY_ID.get(sp.niche)?.name ?? sp.niche}`],
      text: sp.text,
      present: present.has(sp.id),
    };
    if (slots > 0) {
      const selected = state.meta.regulars.includes(sp.id);
      entry.regular = { selected, disabled: !selected && regularBlocker(state, sp.id) !== null };
    }
    return entry;
  });

  let hiddenPlants = 0;
  const plants: JournalEntryView[] = PLANTS.map((plant) => {
    const group = PLANT_GROUP_INFO[plant.group];
    if (!journal.plants.includes(plant.id)) {
      return {
        key: `unknown-plant-${hiddenPlants++}`,
        discovered: false,
        icon: group.icon,
        name: '???',
        family: plant.group,
        facts: [`ab „${STAGES[plant.unlock]?.name ?? '…'}“`],
        present: false,
      };
    }
    return {
      key: plant.id,
      discovered: true,
      icon: group.icon,
      name: plant.name,
      family: plant.group,
      facts: [group.name, `ab „${STAGES[plant.unlock]?.name ?? '…'}“`],
      text: plant.text,
      present: state.plants.includes(plant.id),
    };
  });

  const statusById = new Map(evaluation.communities.map((c) => [c.id, c]));
  const active = new Set(evaluation.communities.filter((c) => c.active).map((c) => c.id));
  /** Fortschritt „x/y“ wie in der Seitenleiste (nur, solange sie nicht besteht). */
  const progressOf = (id: string, total: number) => {
    const status = statusById.get(id);
    return status && !status.active ? `${ofTotal(status.present, status.total || total)} Mitglieder` : undefined;
  };
  let hiddenCommunities = 0;
  const communities: JournalCommunityView[] = COMMUNITIES.map((c) => {
    if (!journal.communities.includes(c.id)) {
      const hidden: JournalCommunityView = {
        key: `unknown-community-${hiddenCommunities++}`,
        discovered: false,
        icon: '❔',
        name: '???',
        active: false,
        hint: c.hint,
      };
      const progress = progressOf(c.id, c.members.length);
      if (progress) hidden.progress = progress;
      return hidden;
    }
    const effect = [`+${formatNumber(c.harmony)} Harmonie`, ...c.effects.map((e) => effectView(e).label)].join(' · ');
    const known: JournalCommunityView = {
      key: c.id,
      discovered: true,
      icon: c.icon,
      name: c.name,
      active: active.has(c.id),
      // Alle Mitglieder, auch noch unentdeckte – gewollt, wie „fehlt: …“ (DESIGN_V2.md 9.2).
      members: missingMembersText(c.members.map((m) => memberOptions(m))),
      effect,
    };
    const progress = progressOf(c.id, c.members.length);
    if (progress) known.progress = progress;
    return known;
  });

  const keepsakes: JournalKeepsakeView[] = journal.keepsakes.map((id) => {
    // Nur eigene Einträge: IDs wie „__proto__“ oder „toString“ dürfen nichts Geerbtes finden.
    const info = Object.hasOwn(KEEPSAKE_INFO, id) ? KEEPSAKE_INFO[id] : undefined;
    return { key: id, icon: info?.icon ?? '🎁', name: info?.name ?? 'Andenken', text: info?.text ?? '' };
  });

  const found = {
    species: species.filter((e) => e.discovered).length,
    plants: plants.filter((e) => e.discovered).length,
    communities: communities.filter((e) => e.discovered).length,
  };
  const trees = toJournalTrees(state);
  const tabCounts = {
    species: ofTotal(found.species, species.length),
    plants: ofTotal(found.plants, plants.length),
    communities: ofTotal(found.communities, communities.length),
    // Andenken: Erinnerungen plus freigeschaltete Hauptbaum-Arten (die Eiche immer).
    keepsakes: formatNumber(keepsakes.length + trees.filter((t) => t.unlocked).length),
    achievements: achievementCountText(state),
    stats: '',
  };
  // Bonus aus dem wirksamen Gedächtnis (eigenes + Zufluss über Korridore, 24.6).
  const effectiveMemory = effectiveForestMemory(state);
  return {
    counts: `${tabCounts.species} Arten · ${tabCounts.plants} Pflanzen · ${tabCounts.communities} Gemeinschaften`,
    meta:
      `Zyklus ${formatNumber(state.cycle.number)} · Waldgedächtnis ${formatNumber(state.meta.forestMemory)}` +
      (effectiveMemory > state.meta.forestMemory ? `, wirksam ${formatNumber(effectiveMemory)}` : '') +
      (effectiveMemory > 0 ? ` (${memoryBonusLabel(effectiveMemory)} Wachstum und Samen)` : ''),
    regulars:
      slots > 0
        ? `Stammgäste ${ofTotal(state.meta.regulars.length, slots)} – sie ziehen in jedem Zyklus von selbst ein. Wähle sie bei den Arten.`
        : null,
    species,
    plants,
    communities,
    keepsakes,
    trees,
    stats: toJournalStats(state, evaluation),
    achievements: toJournalAchievements(state),
    tabCounts,
  };
}

/** Wie viele Einträge aus `all` im Tagebuch stehen (unbekannte IDs zählen nicht). */
const known = (all: readonly { id: string }[], ids: readonly string[]) => all.filter((x) => ids.includes(x.id)).length;

/** „1 Jahr“ / „2 Jahre“ – Einzahl nur bei genau 1. */
const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/**
 * Spielzeit des Zyklus in Jahren und Jahreszeiten (je 180 s Spielzeit, DESIGN_V2.md 16.2),
 * z. B. „1 Jahr, 2 Jahreszeiten“; unter einer Jahreszeit „weniger als eine Jahreszeit“.
 */
export function cycleAgeText(elapsed: number): string {
  const e = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  const years = Math.floor(e / YEAR_SECONDS);
  const seasons = Math.floor((e - years * YEAR_SECONDS) / SEASON_SECONDS);
  const parts: string[] = [];
  if (years > 0) parts.push(plural(years, 'Jahr', 'Jahre'));
  if (seasons > 0) parts.push(plural(seasons, 'Jahreszeit', 'Jahreszeiten'));
  return parts.length > 0 ? parts.join(', ') : 'weniger als eine Jahreszeit';
}

/**
 * Hauptbaum-Arten für den Reiter „Andenken“ (DESIGN_V2.md 17.2). Freigeschaltete mit
 * Eigenheit und Text, gesperrte mit Hinweis wie bei „Neuer Zyklus“. Solange der Spieler
 * die Auswahl dort noch nie sehen konnte (vor „Hain“ im ersten Zyklus), bleiben gesperrte
 * Arten „???“ – ihr Name ist zugleich der Name einer Begleitpflanze (Spoiler-Regel).
 */
export function toJournalTrees(state: GameState): JournalTreeView[] {
  const reveal = state.cycle.number > 1 || state.stage >= NEW_CYCLE_MIN_STAGE;
  let hidden = 0;
  return MAIN_TREES.map((t) => {
    const unlocked = isTreeUnlocked(state, t.id);
    const current = t.id === state.cycle.mainTree;
    // Schon einmal Hauptbaum (Langzeit-Statistik, seit v8); die aktuelle Art zählt mit.
    const grown = current || state.meta.stats.grownTrees.includes(t.id);
    if (!unlocked && !reveal && !current) {
      return {
        key: `unknown-tree-${hidden++}`,
        icon: '🌳',
        name: '???',
        hidden: true,
        unlocked: false,
        current: false,
        grown: false,
        hint: 'Wächst eine bestimmte Baumart einmal im Pflanzring, kann aus ihren Samen ein neuer Hauptbaum keimen.',
      };
    }
    const view: JournalTreeView = { key: t.id, icon: t.icon, name: t.name, hidden: false, unlocked, current, grown, summary: t.summary };
    if (unlocked) view.text = t.text;
    else view.hint = t.unlockHint;
    return view;
  });
}

/**
 * Kennzahlen für den Reiter „Statistik“ – alles aus dem vorhandenen Spielstand abgeleitet.
 * Zahlen im eingestellten Zahlenformat (kurz/ausgeschrieben). Nennt nur Zähler und Namen
 * entdeckter Arten, nichts Unentdecktes. Am Ende der Abschnitt „Über alle Zyklen“
 * (`section: 'total'`, aus `meta.stats`).
 */
export function toJournalStats(state: GameState, evaluation: Readonly<Pick<Evaluation, 'harmony'>>): JournalStatView[] {
  const journal = state.meta.journal;
  const elapsed = state.cycle.elapsed;
  const season = seasonAt(elapsed);
  const stage = STAGES[state.stage];
  const cycles = state.cycle.number;
  const memory = state.meta.forestMemory;
  // Bonus und Plätze aus dem wirksamen Gedächtnis (eigenes + Zufluss über Korridore, 24.6).
  const effective = effectiveForestMemory(state);
  const slots = regularSlotsOf(state);
  // Wie die Seitenleiste: angezeigt gerundet, Stufe aus dem Rohwert.
  const harmonyRaw = Number.isFinite(evaluation.harmony) ? evaluation.harmony : 0;
  const newSpecies = state.cycle.newSpecies.length;
  const regularNames = state.meta.regulars.map((id) => SPECIES_BY_ID.get(id)?.name).filter((n): n is string => !!n);

  const stats: JournalStatView[] = [
    {
      key: 'cycle',
      label: 'Zyklus',
      value: formatNumber(cycles),
      detail: cycles > 1 ? `${plural(cycles - 1, 'Zyklus', 'Zyklen')} abgeschlossen` : 'dein erster Zyklus',
    },
    {
      key: 'time',
      label: 'Alter dieses Zyklus',
      value: cycleAgeText(elapsed),
      detail: `${formatDuration(Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0)} Spielzeit · jetzt ${season.icon} ${season.name}`,
    },
    { key: 'tree', label: 'Hauptbaum', value: treeLabel(state.cycle.mainTree) },
    {
      key: 'stage',
      label: 'Stufe',
      value: stage?.name ?? '…',
      detail: `${ofTotal(state.stage + 1, STAGES.length)} · Wegpunkt ${formatNumber(state.waypoint)}`,
    },
    { key: 'growth', label: 'Gesamt-Wachstum', value: `${formatNumber(Math.floor(state.totalGrowth))} 🌿`, detail: 'in diesem Zyklus' },
    { key: 'seeds', label: 'Samen', value: `${formatNumber(Math.floor(state.seeds))} 🌰` },
    {
      key: 'harmony',
      label: 'Harmonie',
      value: `${formatNumber(Math.round(harmonyRaw))} ⚖️`,
      detail: `${harmonyTier(harmonyRaw)} · Höchstwert ${formatNumber(Math.round(state.cycle.maxHarmony))}`,
    },
    {
      key: 'species',
      label: 'Entdeckte Arten',
      value: ofTotal(known(SPECIES, journal.species), SPECIES.length),
      detail: newSpecies > 0 ? `${formatNumber(newSpecies)} neu in diesem Zyklus` : undefined,
    },
    { key: 'plants', label: 'Pflanzen', value: ofTotal(known(PLANTS, journal.plants), PLANTS.length) },
    { key: 'communities', label: 'Lebensgemeinschaften', value: ofTotal(known(COMMUNITIES, journal.communities), COMMUNITIES.length) },
    {
      key: 'memory',
      label: 'Waldgedächtnis',
      value: formatNumber(memory),
      detail:
        effective > 0
          ? `${effective > memory ? `${formatNumber(effective)} wirksam (+${formatNumber(effective - memory)} über Korridore) · ` : ''}${memoryBonusLabel(effective)} Wachstum und Samen`
          : 'wächst mit jedem Neuen Zyklus',
    },
    {
      key: 'regulars',
      label: 'Stammgäste',
      value: slots > 0 ? ofTotal(state.meta.regulars.length, slots) : '–',
      detail:
        slots > 0
          ? regularNames.length > 0
            ? regularNames.join(', ')
            : 'noch keiner gewählt'
          : `erster Platz ab ${formatNumber(MEMORY_PER_REGULAR_SLOT)} Waldgedächtnis`,
    },
    ...toLifetimeStats(state),
  ];
  // Optionale Zusätze ohne Inhalt weglassen (JSON-stabil, kein „undefined“).
  for (const s of stats) if (s.detail === undefined) delete s.detail;
  return stats;
}

/** Zahl ≥ 0 für die Anzeige (kaputte Werte → 0). */
const shown = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Abschnitt „Über alle Zyklen“ im Reiter „Statistik“ (Langzeit-Statistik, seit v8). */
function toLifetimeStats(state: GameState): JournalStatView[] {
  const s = state.meta.stats;
  const seconds = shown(s.playSeconds);
  const best = shown(s.bestHarmony);
  const trees = s.grownTrees.map((id) => MAIN_TREES_BY_ID.get(id)?.name).filter((n): n is string => !!n);
  const count = (key: string, label: string, n: number, detail?: string): JournalStatView => {
    const view: JournalStatView = { key, label, value: formatNumber(Math.floor(shown(n))), section: 'total' };
    if (detail) view.detail = detail;
    return view;
  };
  return [
    { key: 'total-time', label: 'Spielzeit', value: formatDuration(seconds), detail: cycleAgeText(seconds), section: 'total' },
    { key: 'total-growth', label: 'Gesamt-Wachstum', value: `${formatNumber(Math.floor(lifetimeGrowth(state)))} 🌿`, section: 'total' },
    {
      key: 'total-harmony',
      label: 'Beste Harmonie',
      value: `${formatNumber(Math.round(best))} ⚖️`,
      detail: harmonyTier(best),
      section: 'total',
    },
    count('total-cards', 'Angenommene Begegnungen', s.cardsChosen, 'Tier- und Pflanzenkarten gewählt'),
    count('total-events', 'Ereignisse entschieden', s.eventsDecided),
    count('total-visitors', 'Gäste bewirtet', s.visitorsHosted),
    count('total-plants', 'Pflanzen gesetzt', s.plantsPlanted),
    count('total-care', 'Pflege-Ränge gekauft', s.careRanksBought),
    {
      key: 'total-trees',
      label: 'Gewachsene Hauptbaum-Arten',
      value: ofTotal(trees.length, MAIN_TREES.length),
      detail: trees.join(', '),
      section: 'total',
    },
    ...toDailyStats(state),
  ];
}

/** Tagesziele im Abschnitt „Über alle Zyklen“ (seit v12): erfüllte Ziele, beste Serie, perfekte Tage. */
function toDailyStats(state: GameState): JournalStatView[] {
  const d = state.meta.daily;
  const n = (x: number) => Math.floor(shown(x));
  const best = n(d.bestStreak);
  return [
    {
      key: 'total-daily-goals',
      label: 'Tagesziele erfüllt',
      value: formatNumber(n(d.goalsDone)),
      detail: `an ${plural(n(d.perfectDays), 'Tag', 'Tagen')} alle`,
      section: 'total',
    },
    {
      key: 'total-daily-streak',
      label: 'Längste Serie',
      value: plural(best, 'Tag', 'Tage'),
      detail: 'in Folge mit mindestens einem Tagesziel',
      section: 'total',
    },
  ];
}

// ---------------------------------------------------------------------------
// Begegnungen
// ---------------------------------------------------------------------------

/** Vorschau als Differenz zwischen jetzt und nach der Wahl. */
export function previewView(
  now: Readonly<Evaluation>,
  after: Readonly<Evaluation>,
  speciesId?: string,
): PreviewView {
  const relative = (a: number, b: number) => (b > 0 && Number.isFinite(a) ? a / b - 1 : 0);
  const preview: PreviewView = {
    harmonyDelta: after.harmony - now.harmony,
    growthDelta: relative(after.growth, now.growth),
    seedDelta: relative(after.seeds, now.seeds),
  };
  const happiness = speciesId === undefined ? undefined : after.animals[speciesId]?.happiness;
  if (happiness !== undefined) preview.happiness = happiness;
  const communities = communityPreview(now, after);
  if (communities.length > 0) preview.communities = communities;
  return preview;
}

/** Grund, warum ein Tier bei voller Nische nicht weichen kann (nichesAfterChoice → null). */
export const REPLACE_BLOCKED = 'Höhlenbewohner verlören ihren Platz';

const NO_CHANGE: PreviewView = { harmonyDelta: 0, growthDelta: 0 };

const DISABLED_REASONS: Record<string, string> = {
  present: 'Schon im Ökosystem',
  closed: 'Nische noch verschlossen',
  invalid: 'Nicht verfügbar',
};

/**
 * Eine Tierkarte der Begegnung `encounterIndex`. Null, wenn es die Karte nicht gibt;
 * eine unbekannte Art wird als gesperrte Karte gezeigt, damit die Indizes zum Kern passen.
 */
export function toCardView(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  now: Readonly<Evaluation> = evaluate(state),
): CardView | null {
  const id = state.pendingEncounters[encounterIndex]?.cards[cardIndex];
  if (id === undefined) return null;
  const sp = SPECIES_BY_ID.get(id);
  if (!sp) {
    return {
      id,
      name: 'Unbekannter Gast',
      family: 'unknown',
      familyLabel: 'Unbekannt',
      familyIcon: '❔',
      effects: [],
      preview: NO_CHANGE,
      disabledReason: DISABLED_REASONS.invalid,
    };
  }
  const niche = NICHES_BY_ID.get(sp.niche)!;
  const status = cardStatus(state, encounterIndex, cardIndex);

  let preview: PreviewView = NO_CHANGE;
  let replaceOptions: ReplaceOptionView[] | undefined;
  /** Zustand der Art nach dem Einzug – für Bedingungen ✓/✗. */
  let after: Readonly<Evaluation> | null = null;
  /** Wer für `after` weicht – teilt sich danach kein Futter mehr. */
  let afterReplaced: string | null = null;
  let blockedFree = false;

  if (status === 'free') {
    after = previewChoice(state, encounterIndex, cardIndex);
    if (after) preview = previewView(now, after, sp.id);
    else blockedFree = true; // Der Kern lehnt den Einzug ab (z. B. Plätze gingen verloren)
  } else if (status === 'full') {
    // Nur Tausche, die der Kern erlaubt: Wer z. B. Höhlenplätze schafft, die noch
    // bewohnt sind, kann nicht entlassen werden (previewChoice → null) – gesperrt zeigen.
    replaceOptions = (state.niches[sp.niche] ?? []).map((occupant) => {
      const option: ReplaceOptionView = { id: occupant, name: SPECIES_BY_ID.get(occupant)?.name ?? occupant };
      const result = previewChoice(state, encounterIndex, cardIndex, occupant);
      if (result) {
        if (!after) {
          after = result;
          afterReplaced = occupant;
        }
        option.preview = previewView(now, result, sp.id);
        // Bedingungen je Tausch: Wer weicht, teilt danach kein Futter mehr.
        option.conditions = conditionViews(
          sp,
          result.animals[sp.id],
          allAnimals(state).filter((id) => id !== occupant),
          result.foodWeb,
        );
      } else {
        option.disabledReason = REPLACE_BLOCKED;
      }
      return option;
    });
    preview = preferredReplaceOption(replaceOptions)?.preview ?? NO_CHANGE;
  } else if (status === 'present') {
    after = now;
  } else if (status === 'closed') {
    // Nur für die Bedingungen: Wie ginge es der Art, wenn sie schon einziehen dürfte?
    const niches = { ...state.niches, [sp.niche]: [...(state.niches[sp.niche] ?? []), sp.id] };
    after = evaluateEcosystem(ecosystemOf(state, { niches }));
  }

  const card: CardView = {
    id: sp.id,
    name: sp.name,
    family: sp.genus,
    familyLabel: GENUS_INFO[sp.genus].name,
    familyIcon: GENUS_INFO[sp.genus].icon,
    rarity: rarityKey(sp.rarity),
    niche: sp.niche,
    nicheLabel: `${niche.icon} ${niche.name}`,
    conditions: conditionViews(
      sp,
      after?.animals[sp.id],
      allAnimals(state).filter((id) => id !== afterReplaced),
      after?.foodWeb,
    ),
    effects: [...effectViews(sp), ...predationEffects(sp, now, after, state.meta.journal, status === 'present')],
    preview,
    flavor: sp.text,
  };
  if (status === 'full') {
    card.nicheFull = true;
    card.replaceOptions = replaceOptions;
  }
  const noSwap = status === 'full' && !replaceOptions?.some((o) => !o.disabledReason);
  const reason = blockedFree ? 'Gerade nicht möglich' : noSwap ? 'Kein Tausch möglich' : DISABLED_REASONS[status];
  if (reason) card.disabledReason = reason;
  return card;
}

/**
 * Räuber und Beute auf der Tierkarte (DESIGN_V2.md 22.7), gerechnet mit dem Wald nach
 * dem Einzug: Beute zeigt ihren Bestand und wen sie ernährt, ein Jäger einen freundlichen
 * Hinweis, wenn er eine Beute überjagen würde. Ohne Vorschau (`after`) nichts.
 */
function predationEffects(
  sp: Species,
  now: Readonly<Evaluation>,
  after: Readonly<Evaluation> | null,
  journal: EncounterJournal,
  present: boolean,
): EffectView[] {
  if (!after) return [];
  const out: EffectView[] = [];
  const stock = stockEffectView(sp, after, journal);
  if (stock) out.push(stock);
  if (!present) out.push(...overhuntNotes(sp.id, now, after));
  return out;
}

/** Überschrift je Nische; bei gemischten Nischen eine allgemeine. */
const NICHE_TITLES: Readonly<Record<NicheId, string>> = {
  roots: 'Etwas regt sich in der Erde …',
  litter: 'Etwas raschelt im Laub …',
  edge: 'Etwas summt am Waldsaum …',
  crown: 'Etwas regt sich in der Krone …',
  bark: 'Etwas klopft an der Rinde …',
  hollows: 'Etwas huscht durchs Totholz …',
  pond: 'Etwas plätschert im Tümpel …',
  meadow: 'Etwas zirpt auf der Wiese …',
  deadwood: 'Etwas raschelt im Reisig …',
  wall: 'Etwas sonnt sich auf den Steinen …',
};

export function encounterTitle(nicheIds: readonly string[]): string {
  const unique = [...new Set(nicheIds)];
  if (unique.length === 1 && unique[0]! in NICHE_TITLES) return NICHE_TITLES[unique[0] as NicheId];
  return 'Etwas regt sich am Baum … wer darf einziehen?';
}

/** Warum „Neu würfeln“ gerade nicht geht – Tierbegegnung. */
export const REROLL_BLOCKERS: Readonly<Record<NonNullable<ReturnType<typeof rerollBlocker>>, string>> = {
  'no-encounter': 'Diese Begegnung gibt es nicht mehr',
  'no-cards': 'Keine passenden Tiere',
  'no-alternatives': 'Keine anderen Tiere verfügbar',
  'too-expensive': 'Nicht genug Samen',
  'wrong-type': 'Hier gibt es nichts neu zu würfeln',
};

/** Warum „Neu würfeln“ gerade nicht geht – Pflanzenbegegnung („Etwas keimt“). */
export const PLANT_REROLL_BLOCKERS: Readonly<Record<NonNullable<ReturnType<typeof rerollBlocker>>, string>> = {
  'no-encounter': 'Diese Begegnung gibt es nicht mehr',
  'no-cards': 'Keine passenden Pflanzen',
  'no-alternatives': 'Keine anderen Pflanzen verfügbar',
  'too-expensive': 'Nicht genug Samen',
  'wrong-type': 'Hier gibt es nichts neu zu würfeln',
};

/** Überschrift der Begegnung „Etwas keimt“. */
export const PLANT_ENCOUNTER_TITLE = 'Etwas keimt am Fuß des Baums …';

/** Eine wartende Begegnung für den Kartenwahl-Dialog. Null, wenn es sie nicht gibt. */
export function toEncounterView(
  state: GameState,
  encounterIndex: number,
  now: Readonly<Evaluation> = evaluate(state),
): EncounterView | null {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return null;
  if (encounter.type === 'event') return toEventView(state, encounterIndex, now);
  if (encounter.type === 'visitor') return toVisitorView(state, encounterIndex, now);
  const isPlant = encounter.type === 'plant';
  const cards = encounter.cards
    .map((_, c) =>
      isPlant ? toPlantCardView(state, encounterIndex, c, now) : toCardView(state, encounterIndex, c, now),
    )
    .filter((c): c is CardView => c !== null);
  const blocker = rerollBlocker(state, encounterIndex);
  const view: EncounterView = {
    kind: isPlant ? 'plant' : 'animal',
    title: isPlant ? PLANT_ENCOUNTER_TITLE : encounterTitle(cards.map((c) => c.niche ?? '')),
    cards,
    rerollCost: rerollCost(state, encounterIndex),
    canReroll: blocker === null,
    declineReward: declineReward(state),
  };
  if (isPlant) view.subtitle = plantEncounterSubtitle(state, now);
  if (blocker) view.rerollDisabledReason = (isPlant ? PLANT_REROLL_BLOCKERS : REROLL_BLOCKERS)[blocker];
  return view;
}

// ---------------------------------------------------------------------------
// Pflanzen: Karten, Pflanzring, „Pflanze setzen“
// ---------------------------------------------------------------------------

/** Symbole für das, was Pflanzen bieten (nur Anzeige auf Pflanzenkarten). */
const PROVIDE_ICONS: Partial<Record<Tag, string>> = {
  laub: '🍂',
  nuesse: '🥜',
  nadeln: '🌲',
  beeren: '🍒',
  nektar: '🌸',
  kraut: '🌱',
  feucht: '💧',
};

/** Namen aufzählen: „A“, „A und B“, „A, B und 2 weitere“. */
export function listNames(names: readonly string[], max = 2): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(', ')} und ${formatNumber(names.length - max)} weitere`;
}

/** Arten, die schon im Ökosystem leben, zuerst – sie profitieren sofort. */
function byPresence(state: Pick<GameState, 'niches'>, species: readonly Species[]): Species[] {
  const present = species.filter((s) => hasSpecies(state, s.id));
  return [...present, ...species.filter((s) => !present.includes(s))];
}

/**
 * Was eine Pflanze Tieren bietet, z. B. „🌸 Nektar für Wildbiene“. Gut (▲), wenn ein Tier,
 * das schon lebt, davon frisst oder es sich wünscht; sonst neutral. Dazu Arten, die sich
 * die Pflanzengruppe wünschen („Rotkehlchen wünscht sich Sträucher“).
 */
export function plantProvidesViews(plant: Plant, state: Pick<GameState, 'niches'>): EffectView[] {
  const out: EffectView[] = [];
  for (const tag of plant.provides) {
    const users = byPresence(
      state,
      SPECIES.filter((s) => s.food.includes(tag) || s.needs.some((n) => n.kind === 'tag' && n.tag === tag)),
    );
    const icon = PROVIDE_ICONS[tag] ?? '🏡';
    const name = TAG_NAMES[tag];
    out.push({
      label: users.length > 0 ? `${icon} ${name} für ${listNames(users.map((u) => u.name))}` : `${icon} bietet ${name}`,
      tone: users.some((u) => hasSpecies(state, u.id)) ? 'good' : 'neutral',
    });
  }
  const fans = byPresence(
    state,
    SPECIES.filter((s) => s.needs.some((n) => n.kind === 'group' && n.group === plant.group)),
  );
  if (fans.length > 0) {
    const verb = fans.length === 1 ? 'wünscht' : 'wünschen';
    out.push({
      label: `${GROUP_ICONS[plant.group]} ${listNames(fans.map((f) => f.name))} ${verb} sich ${GROUP_NAMES[plant.group]}`,
      tone: fans.some((f) => hasSpecies(state, f.id)) ? 'good' : 'neutral',
    });
  }
  return out;
}

/** Kennzahlen einer Pflanze: Wachstum, Samen, Licht- und Wasserbedarf (Grundwerte). */
export function plantFacts(plant: Plant): FactView[] {
  const facts: FactView[] = [
    {
      label: 'Wachstum',
      icon: '🌿',
      value: `${formatNumber(plant.growth)}/s`,
      text: `Wachstum ${formatNumber(plant.growth)} pro Sekunde`,
    },
    {
      label: 'Samen',
      icon: '🌰',
      value: `${formatNumber(plant.seeds)}/s`,
      text: `Samen ${formatNumber(plant.seeds)} pro Sekunde`,
    },
    {
      label: 'braucht Licht',
      icon: '☀️',
      value: formatNumber(plant.light),
      text: plant.light > 0 ? `braucht ${formatNumber(plant.light)} Licht` : 'braucht kein Licht',
    },
  ];
  if (plant.water < 0) {
    const stored = formatNumber(-plant.water);
    facts.push({ label: 'speichert Wasser', icon: '💧', value: `+${stored}`, text: `speichert ${stored} Wasser` });
  } else {
    facts.push({
      label: 'braucht Wasser',
      icon: '💧',
      value: formatNumber(plant.water),
      text: plant.water > 0 ? `braucht ${formatNumber(plant.water)} Wasser` : 'braucht kein Wasser',
    });
  }
  return facts;
}

/** Vorschau einer Pflanze: Harmonie, 🌿, 🌰 und die Versorgung danach. */
export function plantPreviewView(now: Readonly<Evaluation>, after: Readonly<Evaluation>): PreviewView {
  return { ...previewView(now, after), supply: after.supply, supplyDelta: after.supply - now.supply };
}

/** Pflanzenkarte ohne Zustand (Name, Gruppe, Kennzahlen, was sie bietet). */
function plantCardBase(plant: Plant, state: GameState): CardView {
  const group = PLANT_GROUP_INFO[plant.group];
  return {
    id: plant.id,
    name: plant.name,
    family: plant.group,
    familyLabel: group.name,
    familyIcon: group.icon,
    facts: plantFacts(plant),
    effects: plantProvidesViews(plant, state),
    preview: NO_CHANGE,
    flavor: plant.text,
  };
}

/** Gesperrt-Gründe für Karten aus `choiceBlocker`. */
export const CHOICE_BLOCKERS: Readonly<Record<ChoiceError, string>> = {
  'no-encounter': 'Nicht verfügbar',
  'no-card': 'Nicht verfügbar',
  present: 'Schon im Ökosystem',
  closed: 'Noch verschlossen',
  'niche-full': 'Nische voll',
  'ring-full': 'Pflanzring voll',
  'invalid-replace': 'Kann nicht weichen',
  'would-evict': REPLACE_BLOCKED,
};

/** Grund für eine gesperrte Pflanzenkarte bzw. Ersetzen-Option. */
function plantChoiceReason(error: ChoiceError): string {
  return error === 'closed' ? 'Pflanzring noch verschlossen' : (CHOICE_BLOCKERS[error] ?? 'Nicht verfügbar');
}

/**
 * Eine Pflanzenkarte der Begegnung „Etwas keimt“. Null, wenn es die Karte nicht gibt;
 * eine unbekannte Pflanze wird als gesperrte Karte gezeigt (Indizes passen zum Kern).
 * Ist der Ring voll, bietet die Karte jede Pflanze im Ring (einmal je Art) zum Ersetzen an.
 */
export function toPlantCardView(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  now: Readonly<Evaluation> = evaluate(state),
): CardView | null {
  const id = state.pendingEncounters[encounterIndex]?.cards[cardIndex];
  if (id === undefined) return null;
  const plant = PLANTS_BY_ID.get(id);
  if (!plant) {
    return {
      id,
      name: 'Unbekannte Pflanze',
      family: 'unknown',
      familyLabel: 'Unbekannt',
      familyIcon: '❔',
      effects: [],
      preview: NO_CHANGE,
      disabledReason: DISABLED_REASONS.invalid,
    };
  }
  const card = plantCardBase(plant, state);
  const status = cardStatus(state, encounterIndex, cardIndex);
  if (status === 'full') {
    const options = [...new Set(state.plants)].map((occupant) => {
      const option: ReplaceOptionView = { id: occupant, name: PLANTS_BY_ID.get(occupant)?.name ?? occupant };
      const after = previewChoice(state, encounterIndex, cardIndex, occupant);
      if (after) option.preview = plantPreviewView(now, after);
      else if (occupant === plant.id) option.disabledReason = 'dieselbe Pflanze';
      else option.disabledReason = plantChoiceReason(choiceBlocker(state, encounterIndex, cardIndex, occupant) ?? 'no-card');
      return option;
    });
    card.nicheFull = true;
    card.replaceOptions = options;
    card.fullText = 'Pflanzring voll';
    card.replacePrompt = 'Welche Pflanze weicht?';
    card.preview = preferredReplaceOption(options)?.preview ?? NO_CHANGE;
    if (!options.some((o) => !o.disabledReason)) card.disabledReason = 'Kein Tausch möglich';
    return card;
  }
  const blocker = choiceBlocker(state, encounterIndex, cardIndex);
  const after = blocker ? null : previewChoice(state, encounterIndex, cardIndex);
  if (after) card.preview = plantPreviewView(now, after);
  else if (blocker === 'closed' && plant.unlock > state.stage && plantSlots(state.stage) > 0) {
    card.disabledReason = `Wächst erst ab „${STAGES[plant.unlock]?.name ?? '…'}“`;
  } else card.disabledReason = plantChoiceReason(blocker ?? 'no-card');
  return card;
}

/** Untertitel der Pflanzenbegegnung: gratis, und wie voll der Ring ist. */
export function plantEncounterSubtitle(state: Pick<GameState, 'plants'>, now: Readonly<Evaluation>): string {
  const used = formatNumber(state.plants.length);
  const slots = formatNumber(now.plantSlots);
  if (now.plantSlots > 0 && state.plants.length >= now.plantSlots) {
    return `Eine Pflanze keimt kostenlos – der Pflanzring ist voll (${used}/${slots}), sie ersetzt eine andere.`;
  }
  return `Eine Pflanze keimt kostenlos im Pflanzring (${used}/${slots} belegt).`;
}

/** Name der ersten Stufe mit Pflanzplätzen. */
function plantRingOpensAt(): string | null {
  return STAGES.find((s) => s.plantSlots > 0)?.name ?? null;
}

/** Anteil 0–1, wie gut ein Bedarf gedeckt ist (kein oder negativer Bedarf = voll gedeckt). */
function coverage(have: number, need: number): number {
  if (!(need > 0) || !Number.isFinite(have)) return 1;
  return Math.min(1, Math.max(0, have / need));
}

function supplyMeter(key: 'light' | 'water', have: number, need: number): SupplyMeterView {
  const detail =
    need < 0
      ? `Moos speichert ${formatNumber(-need)} · ${formatNumber(have)} vorhanden`
      : `Bedarf ${formatNumber(need)} von ${formatNumber(have)}`;
  return {
    key,
    icon: key === 'light' ? '☀️' : '💧',
    label: key === 'light' ? 'Licht' : 'Wasser',
    ratio: coverage(have, need),
    detail,
  };
}

/** Anteil als ganze Prozent: 0,8 → „80 %“. */
const wholePercent = (fraction: number) =>
  `${formatNumber(Math.round(Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0)) * 100))} %`;

/** Erklärung bei Mangel an Licht und/oder Wasser – null, wenn alles reicht. */
export function shortageHint(lightRatio: number, waterRatio: number, supply: number): string | null {
  const lowLight = lightRatio < 0.995;
  const lowWater = waterRatio < 0.995;
  if (!lowLight && !lowWater) return null;
  const speed = `Begleitpflanzen wachsen nur mit ${wholePercent(supply)}.`;
  if (lowLight && lowWater) return `Zu wenig Licht und Wasser – ${speed} Schattenpflanzen und Moos helfen.`;
  if (lowLight) return `Zu wenig Licht – ${speed} Schattenpflanzen helfen.`;
  return `Zu wenig Wasser – ${speed} Moos speichert Wasser.`;
}

/** Pflanzring für die Seitenleiste. */
export function plantRingView(state: GameState, evaluation: Readonly<Evaluation>): PlantRingView {
  const capacity = evaluation.plantSlots;
  const plants: PlantSlotView[] = [];
  for (const id of state.plants) {
    const plant = PLANTS_BY_ID.get(id);
    if (!plant) {
      // Belegt trotzdem einen Platz – sonst stünde „2/3 belegt“ bei vollem Ring.
      plants.push({ id, name: 'Unbekannte Pflanze', group: 'unknown', groupIcon: '❔', groupLabel: 'Unbekannt' });
      continue;
    }
    const group = PLANT_GROUP_INFO[plant.group];
    plants.push({ id, name: plant.name, group: plant.group, groupIcon: group.icon, groupLabel: group.name });
  }
  const light = supplyMeter('light', evaluation.light, evaluation.lightNeed);
  const water = supplyMeter('water', evaluation.water, evaluation.waterNeed);
  const groups: PlantGroupCountView[] = PLANT_GROUPS.map((g) => ({
    id: g,
    icon: PLANT_GROUP_INFO[g].icon,
    label: PLANT_GROUP_INFO[g].name,
    count: evaluation.groupCounts[g] ?? 0,
  }));
  const ring: PlantRingView = {
    capacity,
    plants,
    supply: evaluation.supply,
    supplyText: `☀️ Licht ${wholePercent(light.ratio)} · 💧 Wasser ${wholePercent(water.ratio)}`,
    meters: [light, water],
    groups,
    plantCost: 0,
    plantCostLabel: '',
    canOpenPicker: capacity > 0 && state.plants.length < capacity && unlockedPlants(state).length > 0,
    affordable: false,
    plantHint: '',
  };
  const hint = shortageHint(light.ratio, water.ratio, evaluation.supply);
  if (hint) ring.shortageHint = hint;
  if (capacity <= 0) {
    const at = plantRingOpensAt();
    if (at) ring.unlockHint = `öffnet bei „${at}“`;
  }
  refreshPlantRing(ring, state);
  return ring;
}

/** Samen-abhängige Teile des Pflanzrings (Kosten, reicht es?, Hinweis). */
export function refreshPlantRing(ring: PlantRingView, state: GameState): void {
  const cost = nextPlantCost(state);
  ring.plantCost = cost;
  ring.plantCostLabel = plantCostLabel(cost);
  ring.affordable = state.seeds >= cost;
  if (ring.capacity <= 0) ring.plantHint = '';
  else if (state.plants.length >= ring.capacity) {
    ring.plantHint = 'Alle Plätze belegt – neue Pflanzen keimen über Begegnungen und ersetzen dann eine andere.';
  } else if (!ring.canOpenPicker) ring.plantHint = 'Noch keine Pflanze zum Setzen freigeschaltet.';
  else if (!ring.affordable) ring.plantHint = `Noch ${formatNumber(Math.ceil(cost - state.seeds))} 🌰 bis zur nächsten Pflanze`;
  else ring.plantHint = '';
}

/**
 * Pflanzkosten zur Anzeige: aufgerundet, damit „Noch X 🌰“ und die Kosten nie weniger
 * versprechen, als abgezogen wird. Vergleiche laufen immer mit dem exakten Wert.
 */
export function plantCostLabel(cost: number): string {
  return formatNumber(Math.ceil(cost));
}

/** Sperrgründe für „Pflanze setzen“ (plantBlocker). */
export const PLANT_BLOCKERS: Readonly<Record<NonNullable<ReturnType<typeof plantBlocker>>, string>> = {
  'unknown-plant': 'Nicht verfügbar',
  locked: 'Noch nicht freigeschaltet',
  'ring-full': 'Pflanzring voll',
  'too-expensive': 'Nicht genug Samen',
};

/**
 * Auswahl „Pflanze setzen“: alle freigeschalteten Pflanzen mit Vorschau und Sperrgrund.
 * Die Kosten sind für alle gleich (nextPlantCost); reichen die Samen nicht, steht das in
 * `disabledReason` – wie viele fehlen, zeigt der Dialog live.
 */
export function toPlantPickerView(state: GameState, now: Readonly<Evaluation> = evaluate(state)): PlantPickerView {
  const cost = nextPlantCost(state);
  const costLabel = plantCostLabel(cost);
  const offers = unlockedPlants(state)
    .map((id) => PLANTS_BY_ID.get(id))
    .filter((p): p is Plant => p !== undefined)
    .map((plant) => {
      const card = plantCardBase(plant, state);
      const after = previewPlant(state, plant.id);
      if (after) card.preview = plantPreviewView(now, after);
      const blocker = plantBlocker(state, plant.id);
      if (blocker) card.disabledReason = PLANT_BLOCKERS[blocker];
      return { card, cost, costLabel };
    });
  return {
    title: 'Pflanze setzen',
    subtitle: `Pflanzring ${formatNumber(state.plants.length)}/${formatNumber(now.plantSlots)} belegt · jede Pflanze kostet jetzt ${costLabel} 🌰`,
    cost,
    offers,
  };
}

// ---------------------------------------------------------------------------
// Szene: Tiere für den Renderer
// ---------------------------------------------------------------------------

/**
 * Tiere für `drawScene` – Art, Gattung, Nische, Platz, Zufriedenheit und Seltenheit
 * (0 gewöhnlich … 3 legendär; besondere und legendäre Tiere schimmern in der Szene).
 * Nur neu bauen, wenn sich die Auswertung ändert (main.ts cacht das Array).
 */
export function toSceneAnimals(state: GameState, evaluation: Readonly<Evaluation>): SceneAnimal[] {
  const out: SceneAnimal[] = [];
  for (const niche of NICHES) {
    (state.niches[niche.id] ?? []).forEach((id, slot) => {
      const sp = SPECIES_BY_ID.get(id);
      if (!sp) return;
      out.push({
        id,
        family: sp.genus,
        niche: niche.id,
        slot,
        happiness: evaluation.animals[id]?.happiness ?? 0,
        rarity: sp.rarity,
      });
    });
  }
  return out;
}

/** Zeigt die Szene den Waldtümpel? Ja, sobald die Nische Plätze hat (Pflege oder Ereignis). */
export function scenePond(evaluation: Readonly<Pick<Evaluation, 'slots'>>): boolean {
  return (evaluation.slots.pond ?? 0) > 0;
}

/**
 * Pflanzengruppe aus content → Gruppe der Szene. Heute gleich benannt; die Tabelle hält
 * beide Seiten getrennt, damit eine neue Gruppe beim Typecheck auffällt.
 */
export const SCENE_GROUP_OF: Readonly<Record<PlantGroup, ScenePlantGroup>> = {
  trees: 'trees',
  shrubs: 'shrubs',
  flowers: 'flowers',
  mosses: 'mosses',
};

/**
 * Begleitpflanzen für `drawScene`: Art, Gruppe, Platz im Pflanzring und Wuchskraft
 * (Versorgung V mit Licht und Wasser aus der Auswertung). Unbekannte Pflanzen fehlen,
 * die übrigen behalten ihren Ring-Index als Platz. Nur bei Änderungen am Ökosystem
 * neu bauen (main.ts cacht das Array wie die Tiere).
 */
export function toScenePlants(state: Pick<GameState, 'plants'>, evaluation: Readonly<Evaluation>): ScenePlant[] {
  const vigor = Number.isFinite(evaluation.supply) ? Math.min(1, Math.max(0, evaluation.supply)) : 1;
  const out: ScenePlant[] = [];
  state.plants.forEach((id, slot) => {
    const plant = PLANTS_BY_ID.get(id);
    if (!plant) return;
    out.push({ id, group: SCENE_GROUP_OF[plant.group], slot, vigor });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------

/**
 * Kurzer Hinweis, wenn ein Wegpunkt ohne Begegnung vorbeiging (TickReport.autoDeclined):
 * Es gab nichts Passendes – oder der Stapel war voll. Dafür gibt es Samen wie beim Ablehnen;
 * `seeds` ist deren Summe (TickReport.declinedSeeds – die Rate kann je Wegpunkt steigen).
 */
export function autoDeclineText(autoDeclined: number, stackFull: boolean, seeds: number): string {
  const n = Math.max(1, autoDeclined);
  const reward = `+${seedsLabel(Math.max(0, seeds))} 🌰`;
  if (stackFull) return `Stapel voll – ${n === 1 ? 'eine Begegnung zog' : 'Begegnungen zogen'} weiter · ${reward}`;
  return `Niemand zog ein · ${reward}`;
}

/**
 * Hinweis für automatisch abgelehnte Begegnungen eines Ticks: „Stapel voll – …“ nur, wenn
 * der Stapel wirklich voll war (TickReport.declinedStackFull), sonst „Niemand zog ein“.
 */
export function tickDeclineText(report: Pick<OfflineReport, 'autoDeclined' | 'declinedStackFull' | 'declinedSeeds'>): string {
  // Nur wenn alle wegen des vollen Stapels weiterzogen; bei gemischten Gründen neutral.
  const stackFull = report.declinedStackFull > 0 && report.declinedStackFull === report.autoDeclined;
  return autoDeclineText(report.autoDeclined, stackFull, report.declinedSeeds);
}

/** Inhalt des Stufen-Banners in der Szene. */
export interface StageBannerView {
  title: string;
  text: string;
  /** Zusatzzeile, z. B. der gleichzeitig freigeschaltete Erfolg; null ohne. */
  extra: string | null;
}

/**
 * Stufen-Banner: Name und Beschreibung der Stufe. Kommt im selben Moment ein Erfolg dazu,
 * steht er als dritte Zeile im Banner – statt eines zweiten Hinweises, der gleichzeitig
 * aufpoppt.
 */
export function stageBannerView(stage: number, achievement: string | null = null): StageBannerView {
  const info = STAGES[stage] ?? STAGES[0]!;
  return { title: info.name, text: info.description, extra: achievement || null };
}

/** Ab dieser Abwesenheit (s) gibt es eine Willkommens-Meldung. */
export const WELCOME_MIN_SECONDS = 60;

/**
 * `namesStage`: Die Willkommens-Meldung nennt die offline erreichte Stufe – dann zeigt
 * main.ts kein zusätzliches Stufen-Banner (sonst käme dieselbe Nachricht doppelt).
 */
export type CatchUpNotice = { kind: 'welcome'; text: string; namesStage: boolean } | { kind: 'note'; text: string } | null;

/**
 * Was nach dem Nachrechnen (Start, Tab zurück, Ruhezustand) gemeldet wird: nach längerer
 * Abwesenheit die Willkommens-Meldung (sie nennt verpasste Begegnungen selbst), sonst –
 * falls Wegpunkte ohne Begegnung vorbeigingen – der kurze Hinweis wie im laufenden Spiel.
 */
export function catchUpNotice(
  away: number,
  report: Pick<OfflineReport, 'seconds' | 'growth' | 'seeds' | 'autoDeclined' | 'declinedStackFull' | 'declinedSeeds'> &
    Partial<Pick<OfflineReport, 'averaged' | 'weather'>>,
  waiting: number,
  stages?: StageProgress,
): CatchUpNotice {
  if (away > WELCOME_MIN_SECONDS && report.growth > 0) {
    return { kind: 'welcome', text: welcomeText(away, report, waiting, stages), namesStage: reachedStage(stages) !== undefined };
  }
  if (report.autoDeclined > 0) return { kind: 'note', text: tickDeclineText(report) };
  return null;
}

/** Stufen vor und nach dem Nachrechnen – für „… wuchs bis zur Stufe „Hain““. */
export interface StageProgress {
  from: number;
  to: number;
}

/** Name der offline erreichten Stufe; undefined, wenn keine neue Stufe dazukam. */
function reachedStage(stages: StageProgress | undefined): string | undefined {
  return stages && stages.to > stages.from ? STAGES[stages.to]?.name : undefined;
}

/**
 * Ertrag für die Willkommens-Meldung: ab 10 ganze Zahlen (abgerundet), darunter eine
 * Nachkommastelle – so wird aus 0,4 kein „+0“. '' , wenn gerundet nichts bleibt.
 */
function welcomeAmount(value: number, icon: string): string {
  const shown = value >= 10 ? Math.floor(value) : Math.round(value * 10) / 10;
  return shown > 0 ? `+${formatNumber(shown)} ${icon}` : '';
}

/**
 * Willkommens-Meldung nach Abwesenheit (DESIGN_V2.md, 7.6). Vorne steht, was gewachsen
 * ist (erreichte Stufe, Ertrag), dann die wartenden Begegnungen; weitergezogene stehen nur
 * als Nebensatz mit ihrem Dank in Samen – das soll sich nicht nach Verlust anfühlen.
 */
export function welcomeText(
  away: number,
  report: Pick<OfflineReport, 'seconds' | 'growth' | 'seeds' | 'autoDeclined' | 'declinedSeeds'> &
    Partial<Pick<OfflineReport, 'averaged' | 'weather'>>,
  waiting: number,
  stages?: StageProgress,
): string {
  // Simuliert werden höchstens MAX_OFFLINE_SECONDS – die Meldung nennt die tatsächliche Zeit.
  const capped = report.seconds < away ? ` (max. ${formatDuration(MAX_OFFLINE_SECONDS)})` : '';
  // Einträge, die gerundet 0 wären, fallen weg („+0 🌰“ wirkt wie ein Fehler).
  const yields = [welcomeAmount(report.growth, '🌿'), welcomeAmount(report.seeds, '🌰')].filter(Boolean);
  const yieldText = yields.length > 0 ? `: ${yields.join(', ')}` : '';
  const reached = reachedStage(stages);
  const grew = reached ? `wuchs dein Baum bis zur Stufe „${reached}“` : 'ist dein Wald gewachsen';
  let text = `Willkommen zurück! In ${formatDuration(report.seconds)}${capped} ${grew}${yieldText}.`;
  const n = report.autoDeclined;
  const thanks = `+${seedsLabel(Math.max(0, report.declinedSeeds))} 🌰`;
  if (waiting > 0) {
    text += ` ${waiting === 1 ? '1 Begegnung wartet' : `${formatNumber(waiting)} Begegnungen warten`} auf dich`;
    if (n > 0) text += ` – ${formatNumber(n)} weitere ${n === 1 ? 'zog' : 'zogen'} weiter und ${n === 1 ? 'ließ' : 'ließen'} ${thanks} da`;
    text += '.';
  } else if (n > 0) {
    text += ` ${n === 1 ? '1 Begegnung zog' : `${formatNumber(n)} Begegnungen zogen`} weiter und ${n === 1 ? 'ließ' : 'ließen'} ${thanks} da.`;
  }
  // Offline zählt das Mittelwetter (DESIGN_V2.md 21.5) – ehrlich dazusagen.
  const weather = averagedWeatherText(report);
  if (weather) text += ` ${weather}`;
  return text;
}

// ---------------------------------------------------------------------------
// Ereignisse und Durchreisende (Schritt 2.4)
// ---------------------------------------------------------------------------

/** Samen für Knöpfe und Karten – der Helfer liegt in view-format.ts (auch für declineLabel). */
export { seedsLabel };

/** Relative Änderung (0,05 = +5 %); 0, wenn vorher nichts da war. */
function relative(after: number, before: number): number {
  return before > 0 && Number.isFinite(after / before) ? after / before - 1 : 0;
}

/**
 * Wirkungszeilen einer Ereignis-Option, aus den Daten statt aus dem Kurztext:
 * „+480 🌰 sofort“, „+30 % 🌿 für 6 Min.“, „Totholz, +1 Platz Höhlen & Totholz – bis zum
 * Neuen Zyklus“, „nächste Begegnung: Pfifferling, Steinpilz oder …“ (aus Typ und IDs).
 * `journal` (= `meta.journal`): Unentdeckte erscheinen ohne Namen (siehe `nextEncounterText`).
 */
export function eventOptionEffects(option: EventOption, seeds: number, journal: EncounterJournal): EffectView[] {
  const out: EffectView[] = [];
  const lasting: string[] = [];
  for (const e of option.effects) {
    if (e.kind === 'timed') out.push({ label: `${bonusEffectLabel(e.effect)} für ${formatDuration(e.seconds)}`, tone: 'good' });
    else if (e.kind === 'habitat') lasting.unshift(TAG_NAMES[e.tag] ?? e.tag);
    else if (e.kind === 'cycle') lasting.push(bonusEffectLabel(e.effect));
    else if (e.kind === 'nextEncounter') out.push({ label: nextEncounterText(e.type, e.ids, journal), tone: 'good' });
  }
  if (lasting.length > 0) out.unshift({ label: `${lasting.join(', ')} – ${UNTIL_NEW_CYCLE}`, tone: 'good' });
  if (seeds > 0) out.push({ label: `+${seedsLabel(seeds)} 🌰 sofort`, tone: 'good' });
  return out;
}

/** „A, B oder C“ – Aufzählung von Alternativen. */
function orList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} oder ${names[names.length - 1]}`;
}

/** Was das Naturtagebuch schon kennt (`meta.journal`) – entscheidet über Namen oder „unbekannt“. */
export type EncounterJournal = Pick<GameState['meta']['journal'], 'species' | 'plants'>;

/** Name und Symbol (Gattung bzw. Gruppe, wie die Tagebuch-Silhouette) einer Art oder Pflanze. */
function encounterEntry(type: 'animal' | 'plant', id: string): { name: string; icon: string } | null {
  if (type === 'animal') {
    const sp = SPECIES_BY_ID.get(id);
    return sp ? { name: sp.name, icon: GENUS_INFO[sp.genus].icon } : null;
  }
  const plant = PLANTS_BY_ID.get(id);
  return plant ? { name: plant.name, icon: PLANT_GROUP_INFO[plant.group].icon } : null;
}

/**
 * Vorgabe für die nächste Begegnung als Text, z. B. „nächste Begegnung: Eichelhäher oder
 * Eichhörnchen“; unbekannte IDs fallen weg. Ohne bekannte Namen: „nächste Begegnung: ein Tier“.
 * Spoiler-Regel wie im Naturtagebuch: Noch nicht entdeckte Arten bzw. Pflanzen werden nicht
 * genannt, sondern zusammengefasst – mit Gattungs- bzw. Gruppensymbol wie die Silhouetten
 * dort: „Zunderschwamm oder 2 unbekannte Arten (🍄)“, „eine unbekannte Pflanze (🌳)“.
 */
export function nextEncounterText(type: 'animal' | 'plant', ids: readonly string[], journal: EncounterJournal): string {
  const known = type === 'animal' ? journal.species : journal.plants;
  const names: string[] = [];
  const hiddenIcons: string[] = [];
  let hidden = 0;
  for (const id of ids) {
    const entry = encounterEntry(type, id);
    if (!entry) continue;
    if (known.includes(id)) {
      names.push(entry.name);
    } else {
      hidden++;
      if (!hiddenIcons.includes(entry.icon)) hiddenIcons.push(entry.icon);
    }
  }
  if (hidden > 0) {
    const noun = type === 'animal' ? ['eine unbekannte Art', 'unbekannte Arten'] : ['eine unbekannte Pflanze', 'unbekannte Pflanzen'];
    const label = hidden === 1 ? noun[0] : `${formatNumber(hidden)}\u00a0${noun[1]}`;
    names.push(`${label} (${hiddenIcons.join(' ')})`);
  }
  if (names.length === 0) return `nächste Begegnung: ${type === 'animal' ? 'ein Tier' : 'eine Pflanze'}`;
  return `nächste Begegnung: ${orList(names)}`;
}

/** Wirkung eines Gastes mit Dauer, z. B. „+12 % 🌿, +12 % 🌰 für 7 Min.“. */
export function visitorEffectText(visitor: Visitor): string {
  return `${visitor.effects.map(bonusEffectLabel).join(', ')} für ${formatDuration(visitor.stay)}`;
}

/**
 * Ereignis mit Wahl als Begegnung im Kartenwahl-Dialog: eine Karte je Option, der Knopf
 * trägt den Text der Option. Wirkung in Kurzform, Samen-Optionen mit konkreter Zahl.
 * Die Vorschau rechnet die echte Aktion auf einer Kopie des Spielstands.
 */
export function toEventView(
  state: GameState,
  encounterIndex: number,
  now: Readonly<Evaluation> = evaluate(state),
): EncounterView | null {
  const encounter = state.pendingEncounters[encounterIndex];
  const event = encounter?.type === 'event' ? EVENTS_BY_ID.get(encounter.cards[0] ?? '') : undefined;
  if (!event) return null;
  const cards: CardView[] = event.options.map((option, i) => {
    const effects = eventOptionEffects(option, eventOptionSeeds(state, event.id, i), state.meta.journal);
    const copy = structuredClone(state);
    const ok = chooseEventOption(copy, encounterIndex, i).ok;
    const after = ok ? evaluate(copy) : now;
    // evaluate() teilt sich einen Cache: wieder auf den echten Stand setzen.
    evaluate(state);
    return {
      id: `${event.id}:${i}`,
      name: option.label,
      family: 'event',
      familyLabel: event.name,
      familyIcon: event.icon,
      effects,
      preview: {
        harmonyDelta: after.harmony - now.harmony,
        growthDelta: relative(after.growth, now.growth),
        seedDelta: relative(after.seeds, now.seeds),
      },
      chooseLabel: option.label,
    };
  });
  return {
    kind: 'event',
    title: event.name,
    icon: event.icon,
    subtitle: event.text,
    cards,
    rerollCost: null,
    canReroll: false,
    declineReward: null,
  };
}

/**
 * Durchreisende als Begegnung: zwei Karten „Bewirten (−X 🌰)“ und „Ziehen lassen
 * (+Y 🌰)“ mit den konkreten Samen zur aktuellen Rate. Reichen die Samen nicht, ist
 * „Bewirten“ gesperrt.
 */
export function toVisitorView(
  state: GameState,
  encounterIndex: number,
  now: Readonly<Evaluation> = evaluate(state),
): EncounterView | null {
  const encounter = state.pendingEncounters[encounterIndex];
  const visitor = encounter?.type === 'visitor' ? VISITORS_BY_ID.get(encounter.cards[0] ?? '') : undefined;
  const costs = visitor ? visitorSeeds(state, visitor.id) : null;
  if (!visitor || !costs) return null;
  const genus = GENUS_INFO[visitor.genus];
  const hostLabel = `${VISITOR_HOST_LABEL} (−${seedsLabel(costs.host)} 🌰)`;
  const blocker = hostBlocker(state, encounterIndex);
  // Vorschau fürs Bewirten: Gast aktiv, Samen spielen für die Raten keine Rolle.
  const hosted = ecosystemOf({
    ...state,
    cycle: { ...state.cycle, visitors: [...state.cycle.visitors, { id: visitor.id, remaining: visitor.stay }] },
  });
  const after = evaluateEcosystem(hosted);
  // Zum Vergleich: dieselbe Wirkung, ohne dass der Gast für seine Gattung zählt. Der neue
  // Gast steht (mit voller Rastzeit) als letzter in `guestGenera` – ohne ihn bleiben genau
  // die Gattungen des Ist-Zustands, den `now` bewertet (kein zweites ecosystemOf(state)).
  const withoutGenus = evaluateEcosystem({ ...hosted, guestGenera: (hosted.guestGenera ?? []).slice(0, -1) });
  const hostPreview = {
    harmonyDelta: after.harmony - now.harmony,
    growthDelta: relative(after.growth, now.growth),
    seedDelta: relative(after.seeds, now.seeds),
  };
  const genusPreview = {
    harmonyDelta: withoutGenus.harmony - now.harmony,
    growthDelta: relative(withoutGenus.growth, now.growth),
    seedDelta: relative(withoutGenus.seeds, now.seeds),
  };
  const host: CardView = {
    id: 'host',
    name: VISITOR_HOST_LABEL,
    family: visitor.genus,
    familyLabel: genus.name,
    familyIcon: visitor.icon,
    effects: [
      { label: visitorEffectText(visitor), tone: 'good' },
      { label: `zählt für ${genus.name}`, tone: 'good' },
    ],
    preview: hostPreview,
    chooseLabel: hostLabel,
  };
  const note = visitorPreviewNote(visitor, hostPreview, genusPreview);
  if (note) host.note = note;
  if (blocker === 'too-expensive') host.disabledReason = `Nicht genug Samen (${seedsLabel(costs.host)} 🌰)`;
  const farewell: CardView = {
    id: 'farewell',
    name: VISITOR_FAREWELL_LABEL,
    family: visitor.genus,
    familyLabel: genus.name,
    familyIcon: visitor.icon,
    // Der Dank steht schon im Knopftext „Ziehen lassen (+Y 🌰)“.
    effects: [],
    preview: { harmonyDelta: 0, growthDelta: 0, seedDelta: 0 },
    chooseLabel: `${VISITOR_FAREWELL_LABEL} (+${seedsLabel(costs.farewell)} 🌰)`,
  };
  return {
    kind: 'visitor',
    title: visitor.name,
    icon: visitor.icon,
    subtitle: visitor.text,
    // Dauer und Wirkung stehen auf dem Knopf „Bewirten“ – im Kopf nur die Gattung.
    facts: [`${genus.icon} ${genus.name}`],
    cards: [host, farewell],
    rerollCost: null,
    canReroll: false,
    declineReward: null,
  };
}

/** Gattung in der Einzahl – für „zählt als Vogel für den Gattungsbonus“. */
export const GENUS_SINGULAR: Readonly<Record<Genus, string>> = {
  birds: 'Vogel',
  insects: 'Insekt',
  mammals: 'Säugetier',
  soil: 'Bodenlebewesen',
  fungi: 'Pilz',
  amphibians: 'Amphibie',
  reptiles: 'Reptil',
};

type RatePreview = { harmonyDelta: number; growthDelta: number; seedDelta?: number };

/**
 * Weicht die Vorschau fürs Bewirten vom Nennwert des Gastes ab (z. B. „+12 % 🌿, +12 % 🌰“
 * gegenüber Vorschau +9,5 % / +17,5 %), erklärt eine kurze Zeile warum: Der Gast zählt für
 * den Gattungsbonus (`withGenus` ≠ `withoutGenus`) und/oder die Wirkung verrechnet sich mit
 * Harmonie und übrigen Boni. null, wenn Vorschau und Nennwert (gerundet) übereinstimmen.
 */
export function visitorPreviewNote(visitor: Visitor, withGenus: RatePreview, withoutGenus: RatePreview): string | null {
  const shown = (p: RatePreview) =>
    [formatSigned(p.harmonyDelta), formatSignedPercent(p.growthDelta), formatSignedPercent(p.seedDelta ?? 0)].join('|');
  const genusCounts = shown(withGenus) !== shown(withoutGenus);
  // Nennwerte der Wirkungen, die sich direkt mit der Vorschau vergleichen lassen.
  const nominal = { harmony: 0, growth: 0, seeds: 0 };
  for (const e of visitor.effects) {
    if (e.kind === 'harmony') nominal.harmony += e.points;
    else if (e.kind === 'growth') nominal.growth += e.pct / 100;
    else if (e.kind === 'seeds') nominal.seeds += e.pct / 100;
  }
  const kinds = new Set(visitor.effects.map((e) => e.kind));
  const differs = (p: RatePreview) =>
    (kinds.has('harmony') && formatSigned(p.harmonyDelta) !== formatSigned(nominal.harmony)) ||
    (kinds.has('growth') && formatSignedPercent(p.growthDelta) !== formatSignedPercent(nominal.growth)) ||
    (kinds.has('seeds') && formatSignedPercent(p.seedDelta ?? 0) !== formatSignedPercent(nominal.seeds));
  // Nur wenn die angezeigte Vorschau tatsächlich vom Nennwert abweicht.
  if (!differs(withGenus)) return null;
  const reasons: string[] = [];
  if (genusCounts) reasons.push(`der Gast als ${GENUS_SINGULAR[visitor.genus]} für den Gattungsbonus zählt`);
  if (differs(withoutGenus)) reasons.push('sich die Wirkung mit Harmonie und deinen übrigen Boni verrechnet');
  if (reasons.length === 0) return null;
  return `Vorschau weicht vom Nennwert ab, weil ${reasons.join(' und ')}.`;
}

/** Kurzform einer Bonus-Wirkung, z. B. „+30 % 🌿“, „Blumen +60 % 🌰“, „+3 ☀️“. */
export function bonusEffectLabel(effect: CycleEffect | TimedEffect | VisitorEffect): string {
  switch (effect.kind) {
    case 'growth':
      return `+${formatNumber(effect.pct)} % 🌿`;
    case 'seeds':
      return `+${formatNumber(effect.pct)} % 🌰`;
    case 'groupGrowth':
      return `${PLANT_GROUP_INFO[effect.group].name} +${formatNumber(effect.pct)} % 🌿`;
    case 'groupSeeds':
      return `${PLANT_GROUP_INFO[effect.group].name} +${formatNumber(effect.pct)} % 🌰`;
    case 'light':
      return `+${formatNumber(effect.amount)} ☀️`;
    case 'water':
      return `+${formatNumber(effect.amount)} 💧`;
    case 'harmony':
      return `+${formatNumber(effect.points)} ⚖️`;
    case 'slot':
      return `+${formatNumber(effect.amount)} ${effect.amount === 1 ? 'Platz' : 'Plätze'} ${NICHES_BY_ID.get(effect.niche)?.name ?? ''}`.trim();
  }
}

/**
 * Signatur der Bezahlbarkeit der Aktionen einer Begegnung: Neu würfeln (Tier/Pflanze)
 * bzw. Bewirten (Gast). Ändert sie sich (z. B. weil die Samen jetzt reichen), muss der
 * Dialog neu gebaut werden – sonst bleibt ein Knopf gesperrt.
 */
export function encounterActionKey(state: GameState, encounterIndex: number): string {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return '';
  if (encounter.type === 'visitor') return `host:${hostBlocker(state, encounterIndex) ?? 'ok'}`;
  if (encounter.type === 'event') return 'event';
  return `reroll:${state.seeds >= rerollCost(state, encounterIndex)}`;
}

/** Restzeit für die Seitenleiste: ab einer Minute auf ganze Minuten aufgerundet. */
export function remainingLabel(seconds: number): string {
  const s = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  return s >= 60 ? `noch ${formatNumber(Math.ceil(s / 60))} Min.` : `noch ${formatNumber(s)} Sek.`;
}

/** Symbol je Merkmal aus Ereignissen (Habitate). */
const HABITAT_ICONS: Partial<Record<Tag, string>> = { totholz: '🪵', feucht: '💧', hoehle: '🕳️' };

/** Text für „gilt bis zum Neuen Zyklus“. */
export const UNTIL_NEW_CYCLE = 'bis zum Neuen Zyklus';

/** Gleiche Wirkung (Art, Stärke, Gruppe)? Zum Wiederfinden der Dauer eines Zeit-Bonus. */
function sameTimed(a: TimedEffect, b: TimedEffect): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Volle Dauer eines Zeit-Bonus laut Ereignis (für den Fortschrittsbalken); 0, wenn unbekannt. */
function timedDuration(source: string, effect: TimedEffect): number {
  for (const option of EVENTS_BY_ID.get(source)?.options ?? []) {
    for (const e of option.effects) if (e.kind === 'timed' && sameTimed(e.effect, effect)) return e.seconds;
  }
  return 0;
}

/** Anteil der Restzeit (1 = gerade begonnen, 0 = abgelaufen), auf 0 … 1 begrenzt. */
function leftFraction(remaining: number, total: number): number | null {
  if (!(total > 0) || !Number.isFinite(remaining)) return null;
  return Math.min(1, Math.max(0, remaining / total));
}

/**
 * Aktive Boni für die Seitenleiste, je Quelle eine Zeile:
 * - Zeit-Boni eines Ereignisses und bewirtete Gäste mit Restzeit und Restanteil für den
 *   Balken (kürzeste Restzeit oben),
 * - danach Wirkungen bis zum Neuen Zyklus, je Ereignis zusammengefasst – ein Lebensraum
 *   (z. B. Totholz) steht bei dem Ereignis, dessen Option ihn mit diesen Wirkungen vergibt.
 *   Ohne passendes Ereignis bekommt er eine eigene Zeile.
 * Leer, wenn nichts wirkt.
 */
export function activeBonusViews(state: GameState): ActiveBonusView[] {
  const timed: (ActiveBonusView & { left: number })[] = [];
  const timedBySource = new Map<string, ActiveBonusView & { left: number; total: number; effects: string[] }>();
  for (const t of state.cycle.timed) {
    const event = EVENTS_BY_ID.get(t.source);
    const total = timedDuration(t.source, t.effect);
    let row = timedBySource.get(t.source);
    if (!row) {
      row = {
        id: `timed:${t.source}`,
        icon: event?.icon ?? '⏳',
        name: event?.name ?? t.source,
        effect: '',
        remaining: '',
        timed: true,
        progress: null,
        left: t.remaining,
        total,
        effects: [],
      };
      timedBySource.set(t.source, row);
    }
    row.effects.push(bonusEffectLabel(t.effect));
    // Zusammengefasst zählt der längste Rest (meist gleich: dieselbe Wahl).
    if (t.remaining >= row.left) {
      row.left = t.remaining;
      row.total = total;
    }
  }
  for (const row of timedBySource.values()) {
    const { total, effects, ...view } = row;
    timed.push({ ...view, effect: effects.join(', '), remaining: remainingLabel(row.left), progress: leftFraction(row.left, total) });
  }
  for (const v of state.cycle.visitors) {
    const visitor = VISITORS_BY_ID.get(v.id);
    if (!visitor) continue;
    timed.push({
      id: `visitor:${v.id}`,
      icon: visitor.icon,
      name: visitor.name,
      effect: visitor.effects.map(bonusEffectLabel).join(', '),
      remaining: remainingLabel(v.remaining),
      timed: true,
      progress: leftFraction(v.remaining, visitor.stay),
      left: v.remaining,
    });
  }
  timed.sort((a, b) => a.left - b.left);
  const out: ActiveBonusView[] = timed.map(({ left: _left, ...view }) => view);

  // Zyklus-Wirkungen je Quelle sammeln (Reihenfolge: erste Wirkung der Quelle).
  const cycleRows = new Map<string, { source: string; habitats: string[]; effects: string[] }>();
  for (const b of state.cycle.bonuses) {
    let row = cycleRows.get(b.source);
    if (!row) cycleRows.set(b.source, (row = { source: b.source, habitats: [], effects: [] }));
    row.effects.push(bonusEffectLabel(b.effect));
  }
  const loose: Tag[] = [];
  const usedHabitats = new Set<string>();
  for (const tag of state.cycle.habitats) {
    // Ein Ereignis, dessen Option diesen Lebensraum vergibt und dessen Zyklus-Wirkung hier steht.
    // Genau die Option, die gewählt wurde: Lebensraum plus alle ihre Zyklus-Wirkungen.
    const owner = [...cycleRows.values()].find((row) => {
      if (usedHabitats.has(row.source)) return false;
      return (EVENTS_BY_ID.get(row.source)?.options ?? []).some(
        (o) =>
          o.effects.some((e) => e.kind === 'habitat' && e.tag === tag) &&
          o.effects.every((e) => e.kind !== 'cycle' || row.effects.includes(bonusEffectLabel(e.effect))),
      );
    });
    if (!owner) {
      loose.push(tag);
      continue;
    }
    usedHabitats.add(owner.source);
    owner.habitats.push(TAG_NAMES[tag] ?? tag);
  }
  for (const row of cycleRows.values()) {
    const event = EVENTS_BY_ID.get(row.source);
    out.push({
      id: `cycle:${row.source}`,
      icon: event?.icon ?? '🌳',
      name: event?.name ?? row.source,
      effect: [...row.habitats, ...row.effects].join(', '),
      remaining: UNTIL_NEW_CYCLE,
      timed: false,
      progress: null,
    });
  }
  loose.forEach((tag, i) => {
    out.push({ id: `habitat:${i}`, icon: HABITAT_ICONS[tag] ?? '🌿', name: TAG_NAMES[tag] ?? tag, effect: 'Lebensraum', remaining: UNTIL_NEW_CYCLE, timed: false, progress: null });
  });
  return out;
}

/** Bewirtete Gäste für den Renderer (nur neu bauen, wenn sich das Ökosystem ändert). */
export function toSceneVisitors(state: GameState): SceneVisitor[] {
  return state.cycle.visitors.map((v, i) => ({ id: v.id, slot: i }));
}

// ---------------------------------------------------------------------------
// Pflegemaßnahmen (Schritt 2.7)
// ---------------------------------------------------------------------------

/** Blocker-Texte für die Pflege-Liste; `requires` nennt die Bedingung der Maßnahme. */
export function careBlockerText(blocker: CareBlocker, id: string): string {
  const measure = CARE_BY_ID.get(id);
  switch (blocker) {
    case 'unknown-care':
      return 'Diese Pflege gibt es nicht';
    case 'maxed':
      return 'Voll ausgebaut';
    case 'stage':
      return 'Erst auf einer späteren Stufe';
    case 'excluded': {
      const other = measure?.excludes?.map((x) => CARE_BY_ID.get(x)?.name).filter(Boolean)[0];
      return other ? `Verträgt sich nicht mit „${other}“` : 'Verträgt sich nicht mit anderer Pflege';
    }
    case 'requires':
      return `Braucht ${(measure?.requires ?? []).map(conditionName).join(', ')}`;
    case 'too-expensive':
      return 'Nicht genug Samen';
  }
}

/** Kurze Bestätigung für den Kauf von Rang `rank` (1-basiert), z. B. „Nistkästen angebracht (Rang 2)“. */
export function careBoughtText(id: string, rank: number): string {
  const text = CARE_BY_ID.get(id)?.boughtText;
  if (!text) return `${id}: Rang ${formatNumber(rank)}`;
  return rank > 1 ? `${text} (Rang ${formatNumber(rank)})` : text;
}

/** Sortier-Rang der Gruppen: kaufbar zuerst, dann sparen, gesperrt, voll ausgebaut. */
export const CARE_GROUP_ORDER: Readonly<Record<CareGroup, number>> = { buyable: 0, saving: 1, locked: 2, maxed: 3 };

/**
 * Anzeige-Reihenfolge der Pflege-Liste: nach Gruppe, innerhalb von „kaufbar“ und
 * „sparen“ nach Kosten (günstigste zuerst), sonst in Katalog-Reihenfolge (stabil).
 */
export function sortCareViews(items: readonly CareView[]): CareView[] {
  const cost = (v: CareView) => v.costSeeds ?? 0;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const g = CARE_GROUP_ORDER[a.item.group] - CARE_GROUP_ORDER[b.item.group];
      if (g !== 0) return g;
      if (a.item.group === 'buyable' || a.item.group === 'saving') {
        const c = cost(a.item) - cost(b.item);
        if (c !== 0) return c;
      }
      return a.index - b.index;
    })
    .map((x) => x.item);
}

/**
 * Lebensräume (DESIGN_V2.md 23, 5.5): Nischen ohne Plätze aus der Stufe – Waldtümpel,
 * Waldwiese, Totholzhaufen, Trockenmauer. Sie öffnen nur durch Pflege oder Ereignisse.
 */
export function isHabitatNiche(nicheId: NicheId): boolean {
  const niche = NICHES_BY_ID.get(nicheId);
  return !!niche && niche.slots.every((n) => n <= 0);
}

/**
 * „Öffnet Lebensraum 🌾 Waldwiese“ auf der Pflegekarte: Der nächste Rang schafft Plätze in
 * einem Lebensraum, der gerade noch verschlossen ist. Ist er schon offen (z. B. durch ein
 * Ereignis), bleibt die Zeile weg – dann sagt „+2 Plätze …“ genug. null ohne solche Plätze.
 */
export function careOpensText(effects: readonly CareEffect[], now: Readonly<Pick<Evaluation, 'slots'>>): string | null {
  const opened: string[] = [];
  for (const e of effects) {
    if (e.kind !== 'cycle' || e.effect.kind !== 'slot' || e.effect.amount <= 0) continue;
    const id = e.effect.niche;
    if (!isHabitatNiche(id) || (now.slots[id] ?? 0) > 0) continue;
    const niche = NICHES_BY_ID.get(id)!;
    const label = `${niche.icon} ${niche.name}`;
    if (!opened.includes(label)) opened.push(label);
  }
  return opened.length > 0 ? `Öffnet Lebensraum ${listNames(opened, opened.length)}` : null;
}

/**
 * Pflege-Liste für die Seitenleiste: alle Maßnahmen, die auf dieser Stufe schon gekauft
 * wurden oder deren nächster Rang höchstens eine Stufe entfernt ist. Mit Kosten,
 * Kurzwirkung, Blocker-Text und Vorschau (previewCare).
 */
export function toCareViews(state: GameState, now: Readonly<Evaluation> = evaluate(state)): CareView[] {
  const out: CareView[] = [];
  for (const measure of CARE) {
    const rank = careRank(state, measure.id);
    const next = nextCareRank(state, measure.id);
    const first = measure.ranks[0]!;
    // Ganz neue Maßnahmen erst zeigen, wenn ihre Stufe erreicht ist (nicht alles auf einmal).
    if (rank === 0 && first.minStage > state.stage) continue;
    const blocker = careBlocker(state, measure.id);
    let blockerText = blocker ? careBlockerText(blocker, measure.id) : null;
    if (blocker === 'stage' && next) blockerText = `Ab Stufe „${STAGES[next.minStage]?.name ?? ''}“`;
    // Wie beim Pflanzring: aufgerundet, damit „Noch X“ nie weniger verspricht als nötig.
    if (blocker === 'too-expensive' && next) blockerText = `Noch ${formatNumber(Math.ceil(next.cost - state.seeds))} 🌰`;
    const after = next ? previewCare(state, measure.id) : null;
    out.push({
      id: measure.id,
      icon: measure.icon,
      name: measure.name,
      rank: next ? `Rang ${rank}/${measure.ranks.length}` : 'voll ausgebaut',
      next: next?.summary ?? null,
      cost: next ? `${formatNumber(next.cost)} 🌰` : null,
      costSeeds: next?.cost ?? null,
      blocker: blocker === 'maxed' ? null : blockerText,
      canBuy: blocker === null,
      group: blocker === null ? 'buyable' : blocker === 'too-expensive' ? 'saving' : !next ? 'maxed' : 'locked',
      boughtText: next ? careBoughtText(measure.id, rank + 1) : null,
      protects: careProtectionText(measure.id),
      protectsDetail: careProtectionDetail(measure.id),
      opens: next ? careOpensText(next.effects, now) : null,
      preview: after
        ? {
            harmonyDelta: after.harmony - now.harmony,
            growthDelta: now.growth > 0 ? after.growth / now.growth - 1 : 0,
            seedDelta: now.seeds > 0 ? after.seeds / now.seeds - 1 : 0,
          }
        : null,
    });
  }
  return out;
}
