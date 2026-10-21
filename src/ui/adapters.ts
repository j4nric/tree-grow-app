/**
 * Adapter: übersetzt Spielstand und Auswertung aus `core/` in das View-Model der
 * v2-Komponenten (view-model.ts). Reine Funktionen ohne DOM – getestet in
 * tests/adapters.test.ts.
 *
 * Hier stehen nur Anzeige-Entscheidungen (Texte, Symbole, Reihenfolge). Alle Zahlen
 * (Zufriedenheit, Harmonie, Vorschau, Kosten) kommen aus core/formulas.ts.
 */
import { ABILITY_INFO } from '../content/abilities';
import { COMMUNITIES, COMMUNITIES_BY_ID } from '../content/communities';
import { KEEPSAKE_INFO } from '../content/memory';
import { NICHES, NICHES_BY_ID } from '../content/niches';
import { PLANT_GROUP_INFO, PLANTS, PLANTS_BY_ID, type Plant } from '../content/plants';
import { GENUS_INFO, SPECIES, SPECIES_BY_ID, TAG_NAMES, type Species } from '../content/species';
import { STAGES } from '../content/stages';
import { TRAITS, TRAIT_THRESHOLDS } from '../content/traits';
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
  evaluateEcosystem,
  hasSpecies,
  memberOptions,
  nextPlantCost,
  plantSlots,
  previewChoice,
  previewPlant,
  regularSlots,
  rerollCost,
  secondsToNextWaypoint,
  slotEffects,
  waypointProgress,
  type AnimalStatus,
  type ChoiceError,
  type Evaluation,
} from '../core/formulas';
import { allAnimals, type GameState } from '../core/state';
import type { SceneAnimal, ScenePlant, ScenePlantGroup } from '../render/tree';
import {
  MAX_OFFLINE_SECONDS,
  allWaypointsReached,
  plantBlocker,
  regularBlocker,
  rerollBlocker,
  unlockedPlants,
  type OfflineReport,
} from '../core/tick';
import { formatDuration, formatNumber } from './format';
import { memoryBonusLabel } from './cycle-view';
import { RARITY_LABELS, preferredReplaceOption } from './view-format';
import type {
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
  { min: 120, label: 'Urwald' },
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
  }
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
): ConditionView[] {
  const food = status?.food ?? 0;
  const foodRow: ConditionView = { label: foodLabel(species), met: food > 0 };
  if (food > 0 && food < 1) {
    foodRow.label += ' (knapp)';
    foodRow.hint = scarceFoodText(species, present);
  }
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
 * die Anzahl (und damit den Abzug) liefert der Kern in `AnimalStatus.hunters`.
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
 * fehlende Wünsche, Störer, knappes Futter (Konkurrenz), Räuberdruck. Leer = alles erfüllt.
 */
export function moodReasons(species: Species, status: AnimalStatus, present: readonly string[] = []): string[] {
  const reasons: string[] = [];
  // Namen (Konkurrenz, Räuber, Störer) nur, wenn sie den Grund erklären müssen – sonst
  // bleiben die Kacheln in der Seitenleiste kurz.
  const detailed = status.happiness < MOOD_REASON_BELOW;
  const named = (ids: string[]) => (detailed ? speciesNames(ids) : []);
  if (status.food <= 0) reasons.push('sucht Futter');
  species.needs.forEach((need, i) => {
    if (!status.needs[i]) reasons.push(`wünscht sich ${conditionName(need)}`);
  });
  if (status.disturbers > 0) {
    const names = named(disturbersOf(species, present));
    reasons.push(names.length > 0 ? `wird gestört von ${listNames(names)}` : 'wird gestört');
  }
  if (status.food > 0 && status.food < 1) {
    const rivals = named(foodCompetitors(species, present));
    reasons.push(rivals.length > 0 ? `teilt sich das Futter mit ${listNames(rivals)}` : 'findet wenig Futter');
  }
  if (status.hunters > 0) {
    const hunters = named(huntersOf(species, present));
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
): AnimalView | null {
  const sp = SPECIES_BY_ID.get(speciesId);
  if (!sp) return null;
  const status = evaluation.animals[sp.id];
  return {
    id: sp.id,
    name: sp.name,
    family: sp.genus,
    familyIcon: GENUS_INFO[sp.genus].icon,
    rarity: rarityKey(sp.rarity),
    happiness: status?.happiness ?? 0,
    mood: moodText(sp, status, present),
  };
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
  return NICHES.map((niche) => {
    const capacity = evaluation.slots[niche.id] ?? 0;
    const animals = (state.niches[niche.id] ?? [])
      .map((id) => animalView(id, evaluation, present))
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
    }
    return view;
  });
}

/** Text unter dem Fortschrittsbalken: wann die nächste Begegnung kommt. */
export function progressHint(state: GameState): string {
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
export function toJournalView(state: GameState, evaluation: Readonly<Pick<Evaluation, 'communities'>>): JournalView {
  const journal = state.meta.journal;
  const present = new Set(allAnimals(state));
  const slots = regularSlots(state.meta.forestMemory);

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
  const tabCounts = {
    species: ofTotal(found.species, species.length),
    plants: ofTotal(found.plants, plants.length),
    communities: ofTotal(found.communities, communities.length),
    keepsakes: formatNumber(keepsakes.length),
  };
  const memory = state.meta.forestMemory;
  return {
    counts: `${tabCounts.species} Arten · ${tabCounts.plants} Pflanzen · ${tabCounts.communities} Gemeinschaften`,
    meta:
      `Zyklus ${formatNumber(state.cycle.number)} · Waldgedächtnis ${formatNumber(memory)}` +
      (memory > 0 ? ` (${memoryBonusLabel(memory)} Wachstum und Samen)` : ''),
    regulars:
      slots > 0
        ? `Stammgäste ${ofTotal(state.meta.regulars.length, slots)} – sie ziehen in jedem Zyklus von selbst ein. Wähle sie bei den Arten.`
        : null,
    species,
    plants,
    communities,
    keepsakes,
    tabCounts,
  };
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
    after = evaluateEcosystem({ stage: state.stage, niches, plants: state.plants, forestMemory: state.meta.forestMemory });
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
    ),
    effects: effectViews(sp),
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

/** Überschrift je Nische; bei gemischten Nischen eine allgemeine. */
const NICHE_TITLES: Readonly<Record<NicheId, string>> = {
  roots: 'Etwas regt sich in der Erde …',
  litter: 'Etwas raschelt im Laub …',
  edge: 'Etwas summt am Waldsaum …',
  crown: 'Etwas regt sich in der Krone …',
  bark: 'Etwas klopft an der Rinde …',
  hollows: 'Etwas huscht durchs Totholz …',
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
};

/** Warum „Neu würfeln“ gerade nicht geht – Pflanzenbegegnung („Etwas keimt“). */
export const PLANT_REROLL_BLOCKERS: Readonly<Record<NonNullable<ReturnType<typeof rerollBlocker>>, string>> = {
  'no-encounter': 'Diese Begegnung gibt es nicht mehr',
  'no-cards': 'Keine passenden Pflanzen',
  'no-alternatives': 'Keine anderen Pflanzen verfügbar',
  'too-expensive': 'Nicht genug Samen',
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
    declineReward: declineReward(),
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
 * Es gab nichts Passendes – oder der Stapel war voll. Dafür gibt es Samen wie beim Ablehnen.
 */
export function autoDeclineText(autoDeclined: number, stackFull: boolean): string {
  const n = Math.max(1, autoDeclined);
  const reward = `+${formatNumber(n * declineReward())} 🌰`;
  if (stackFull) return `Stapel voll – ${n === 1 ? 'eine Begegnung zog' : 'Begegnungen zogen'} weiter · ${reward}`;
  return `Niemand zog ein · ${reward}`;
}

/**
 * Hinweis für automatisch abgelehnte Begegnungen eines Ticks: „Stapel voll – …“ nur, wenn
 * der Stapel wirklich voll war (TickReport.declinedStackFull), sonst „Niemand zog ein“.
 */
export function tickDeclineText(report: Pick<OfflineReport, 'autoDeclined' | 'declinedStackFull'>): string {
  // Nur wenn alle wegen des vollen Stapels weiterzogen; bei gemischten Gründen neutral.
  return autoDeclineText(report.autoDeclined, report.declinedStackFull > 0 && report.declinedStackFull === report.autoDeclined);
}

/** Ab dieser Abwesenheit (s) gibt es eine Willkommens-Meldung. */
export const WELCOME_MIN_SECONDS = 60;

export type CatchUpNotice = { kind: 'welcome' | 'note'; text: string } | null;

/**
 * Was nach dem Nachrechnen (Start, Tab zurück, Ruhezustand) gemeldet wird: nach längerer
 * Abwesenheit die Willkommens-Meldung (sie nennt verpasste Begegnungen selbst), sonst –
 * falls Wegpunkte ohne Begegnung vorbeigingen – der kurze Hinweis wie im laufenden Spiel.
 */
export function catchUpNotice(
  away: number,
  report: Pick<OfflineReport, 'seconds' | 'growth' | 'seeds' | 'autoDeclined' | 'declinedStackFull'>,
  waiting: number,
): CatchUpNotice {
  if (away > WELCOME_MIN_SECONDS && report.growth > 0) {
    return { kind: 'welcome', text: welcomeText(away, report, waiting) };
  }
  if (report.autoDeclined > 0) return { kind: 'note', text: tickDeclineText(report) };
  return null;
}

/** Willkommens-Meldung nach Abwesenheit (DESIGN_V2.md, 7.6). */
export function welcomeText(
  away: number,
  report: Pick<OfflineReport, 'seconds' | 'growth' | 'seeds' | 'autoDeclined'>,
  waiting: number,
): string {
  // Simuliert werden höchstens MAX_OFFLINE_SECONDS – die Meldung nennt die tatsächliche Zeit.
  const capped = report.seconds < away ? ` (max. ${formatDuration(MAX_OFFLINE_SECONDS)})` : '';
  const parts = [`+${formatNumber(report.growth)} 🌿`, `+${formatNumber(report.seeds)} 🌰`];
  if (waiting > 0) parts.push(waiting === 1 ? '1 Begegnung wartet' : `${formatNumber(waiting)} Begegnungen warten`);
  let text = `Willkommen zurück! In ${formatDuration(report.seconds)}${capped}: ${parts.join(', ')}.`;
  if (report.autoDeclined > 0) {
    const n = report.autoDeclined;
    const who = n === 1 ? '1 Begegnung zog' : `${formatNumber(n)} Begegnungen zogen`;
    text += ` ${who} weiter: +${formatNumber(n * declineReward())} 🌰.`;
  }
  return text;
}
