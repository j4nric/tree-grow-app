/**
 * Adapter: übersetzt Spielstand und Auswertung aus `core/` in das View-Model der
 * v2-Komponenten (view-model.ts). Reine Funktionen ohne DOM – getestet in
 * tests/adapters.test.ts.
 *
 * Hier stehen nur Anzeige-Entscheidungen (Texte, Symbole, Reihenfolge). Alle Zahlen
 * (Zufriedenheit, Harmonie, Vorschau, Kosten) kommen aus core/formulas.ts.
 */
import { NICHES, NICHES_BY_ID } from '../content/niches';
import { GENUS_INFO, SPECIES, SPECIES_BY_ID, TAG_NAMES, type Species } from '../content/species';
import { STAGES } from '../content/stages';
import { TRAITS, TRAIT_THRESHOLDS } from '../content/traits';
import { GENERA, type Condition, type Effect, type NicheId, type PlantGroup, type Tag } from '../content/types';
import {
  UNGUARDED_PENALTY,
  cardStatus,
  declineReward,
  evaluate,
  evaluateEcosystem,
  previewChoice,
  rerollCost,
  secondsToNextWaypoint,
  waypointProgress,
  type AnimalStatus,
  type Evaluation,
} from '../core/formulas';
import type { GameState } from '../core/state';
import type { SceneAnimal } from '../render/tree';
import { allWaypointsReached, rerollBlocker } from '../core/tick';
import { formatDuration, formatNumber } from './format';
import type {
  AnimalView,
  CardView,
  ConditionView,
  EcosystemView,
  EffectView,
  EncounterView,
  FamilyView,
  HarmonyPartView,
  NicheView,
  PreviewView,
  Rarity,
  ReplaceOptionView,
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
  const h = Number.isFinite(harmony) ? harmony : 0;
  return HARMONY_TIERS.find((t) => h >= t.min)!.label;
}

const GROUP_NAMES: Readonly<Record<PlantGroup, string>> = {
  trees: 'Bäume',
  shrubs: 'Sträucher',
  flowers: 'Blumen',
  mosses: 'Moose & Farne',
};

const GROUP_ICONS: Readonly<Record<PlantGroup, string>> = {
  trees: '🌳',
  shrubs: '🌿',
  flowers: '🌼',
  mosses: '🌱',
};

/** Symbole für Lebensraum-Merkmale in Bedingungen. */
const TAG_ICONS: Partial<Record<Tag, string>> = {
  feucht: '💧',
  totholz: '🪵',
  hoehle: '🕳️',
  laub: '🍃',
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
  }
}

/** Nahrung als Bedingungszeile: „🍽 Würmer / Insekten / Beeren“. */
export function foodLabel(species: Species): string {
  return `🍽 ${species.food.map((t) => TAG_NAMES[t]).join(' / ')}`;
}

/**
 * Bedingungen einer Art mit Haken/Kreuz. `status` ist der Zustand der Art im
 * (ggf. hypothetischen) Ökosystem; ohne Status gilt nichts als erfüllt.
 */
export function conditionViews(species: Species, status: AnimalStatus | undefined): ConditionView[] {
  const food = status?.food ?? 0;
  const conditions: ConditionView[] = [
    { label: food > 0 && food < 1 ? `${foodLabel(species)} (knapp)` : foodLabel(species), met: food > 0 },
  ];
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

/** Kurze, freundliche Stimmung eines Tiers – nie traurig, eher ein Hinweis. */
export function moodText(species: Species, status: AnimalStatus | undefined): string {
  if (!status) return 'schaut sich um';
  if (status.food <= 0) return 'sucht Futter';
  const unmet = species.needs.findIndex((_, i) => !status.needs[i]);
  if (unmet >= 0) return `wünscht sich ${conditionName(species.needs[unmet]!)}`;
  if (status.food < 1) return 'findet wenig Futter';
  if (status.hunters > 0) return 'ist auf der Hut';
  return 'fühlt sich wohl';
}

// ---------------------------------------------------------------------------
// Ökosystem-Übersicht
// ---------------------------------------------------------------------------

/** Namen der Arten, die in dieser Nische Plätze schaffen (Wirkung `slot`). */
function slotProviders(nicheId: NicheId): string[] {
  return SPECIES.filter((s) => s.effects.some((e) => e.kind === 'slot' && e.niche === nicheId && e.amount > 0)).map(
    (s) => s.name,
  );
}

/** Name der Stufe, ab der eine Nische Plätze hat (oder null, wenn nie). */
function nicheOpensAt(nicheId: NicheId): string | null {
  const niche = NICHES_BY_ID.get(nicheId);
  const at = niche ? niche.slots.findIndex((n) => n > 0) : -1;
  return at >= 0 ? (STAGES[at]?.name ?? null) : null;
}

export function animalView(speciesId: string, evaluation: Readonly<Evaluation>): AnimalView | null {
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
    mood: moodText(sp, status),
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
  return NICHES.map((niche) => {
    const capacity = evaluation.slots[niche.id] ?? 0;
    const animals = (state.niches[niche.id] ?? [])
      .map((id) => animalView(id, evaluation))
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
}

// ---------------------------------------------------------------------------
// Begegnungen
// ---------------------------------------------------------------------------

/** Vorschau als Differenz zwischen jetzt und nach der Wahl. */
export function previewView(
  now: Readonly<Evaluation>,
  after: Readonly<Evaluation>,
  speciesId: string,
): PreviewView {
  const relative = (a: number, b: number) => (b > 0 && Number.isFinite(a) ? a / b - 1 : 0);
  const preview: PreviewView = {
    harmonyDelta: after.harmony - now.harmony,
    growthDelta: relative(after.growth, now.growth),
    seedDelta: relative(after.seeds, now.seeds),
  };
  const happiness = after.animals[speciesId]?.happiness;
  if (happiness !== undefined) preview.happiness = happiness;
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

  if (status === 'free') {
    after = previewChoice(state, encounterIndex, cardIndex);
    if (after) preview = previewView(now, after, sp.id);
  } else if (status === 'full') {
    // Nur Tausche, die der Kern erlaubt: Wer z. B. Höhlenplätze schafft, die noch
    // bewohnt sind, kann nicht entlassen werden (previewChoice → null) – gesperrt zeigen.
    replaceOptions = state.niches[sp.niche].map((occupant) => {
      const option: ReplaceOptionView = { id: occupant, name: SPECIES_BY_ID.get(occupant)?.name ?? occupant };
      const result = previewChoice(state, encounterIndex, cardIndex, occupant);
      if (result) {
        after ??= result;
        option.preview = previewView(now, result, sp.id);
      } else {
        option.disabledReason = REPLACE_BLOCKED;
      }
      return option;
    });
    preview = replaceOptions.find((o) => o.preview)?.preview ?? NO_CHANGE;
  } else if (status === 'present') {
    after = now;
  } else if (status === 'closed') {
    // Nur für die Bedingungen: Wie ginge es der Art, wenn sie schon einziehen dürfte?
    const niches = { ...state.niches, [sp.niche]: [...state.niches[sp.niche], sp.id] };
    after = evaluateEcosystem({ stage: state.stage, niches, forestMemory: state.meta.forestMemory });
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
    conditions: conditionViews(sp, after?.animals[sp.id]),
    effects: effectViews(sp),
    preview,
    flavor: sp.text,
  };
  if (status === 'full') {
    card.nicheFull = true;
    card.replaceOptions = replaceOptions;
  }
  const reason =
    status === 'full' && !replaceOptions?.some((o) => !o.disabledReason) ? 'Kein Tausch möglich' : DISABLED_REASONS[status];
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

/** Warum „Neu würfeln“ gerade nicht geht. */
export const REROLL_BLOCKERS: Readonly<Record<NonNullable<ReturnType<typeof rerollBlocker>>, string>> = {
  'no-encounter': 'Diese Begegnung gibt es nicht mehr',
  'no-cards': 'Keine passenden Tiere',
  'no-alternatives': 'Keine anderen Tiere verfügbar',
  'too-expensive': 'Nicht genug Samen',
};

/** Eine wartende Begegnung für den Kartenwahl-Dialog. Null, wenn es sie nicht gibt. */
export function toEncounterView(
  state: GameState,
  encounterIndex: number,
  now: Readonly<Evaluation> = evaluate(state),
): EncounterView | null {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return null;
  const cards = encounter.cards
    .map((_, c) => toCardView(state, encounterIndex, c, now))
    .filter((c): c is CardView => c !== null);
  const blocker = rerollBlocker(state, encounterIndex);
  const view: EncounterView = {
    kind: 'animal',
    title: encounterTitle(cards.map((c) => c.niche ?? '')),
    cards,
    rerollCost: rerollCost(state, encounterIndex),
    canReroll: blocker === null,
    declineReward: declineReward(),
  };
  if (blocker) view.rerollDisabledReason = REROLL_BLOCKERS[blocker];
  return view;
}

// ---------------------------------------------------------------------------
// Szene: Tiere für den Renderer
// ---------------------------------------------------------------------------

/**
 * Tiere für `drawScene` – Art, Gattung, Nische, Platz und Zufriedenheit.
 * Nur neu bauen, wenn sich die Auswertung ändert (main.ts cacht das Array).
 */
export function toSceneAnimals(state: GameState, evaluation: Readonly<Evaluation>): SceneAnimal[] {
  const out: SceneAnimal[] = [];
  for (const niche of NICHES) {
    (state.niches[niche.id] ?? []).forEach((id, slot) => {
      const sp = SPECIES_BY_ID.get(id);
      if (!sp) return;
      out.push({ id, family: sp.genus, niche: niche.id, slot, happiness: evaluation.animals[id]?.happiness ?? 0 });
    });
  }
  return out;
}
