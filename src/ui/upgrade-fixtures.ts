/**
 * Beispielzustände für Ausbau und Zielzeile (Vorschau `upgrade-preview.html` und Tests).
 *
 * Auf echten Daten (seit Phase 11, 4b): Namen, Startpreise, Meilensteine und Baumteile aus
 * `content/upgrades.ts` und `content/niches.ts`, Preise und Kaufmengen aus den reinen Regeln in
 * `core/upgrades.ts` (`upgradePrice`, `upgradeCostFrom`, `affordableUpgrades`). Nur die Auswahl
 * des Ziels (`previewGoal`) ahmt `nextGoal` (28.7) nach, bis Phase 11, 2c es liefert. Im Spiel
 * kommt der Zustand aus dem Spielstand (`upgrade-adapters.ts`) – diese Datei wird dort nicht
 * benutzt.
 */
import { NICHES } from '../content/niches';
import type { NicheId } from '../content/types';
import { NICHE_MILESTONES, NICHE_UPGRADE_BASE, NICHE_UPGRADE_PCT, TREE_PARTS, type TreePartId } from '../content/upgrades';
import { affordableUpgrades, upgradeCostFrom, upgradePrice } from '../core/upgrades';
import { milestoneInputs, treePartWho } from './upgrade-adapters';
import type {
  BuyAmount,
  GoalInput,
  NicheUpgradeInput,
  TreePartInput,
  UpgradeContext,
  UpgradeMilestoneInput,
  UpgradePurchase,
} from './upgrade-view';

// ---------------------------------------------------------------------------------------
// Echte Inhalte in der Form der Ansicht
// ---------------------------------------------------------------------------------------

/** Meilensteine jeder Nische (10/25/50, Abzeichen 25/50/75). */
export const NICHE_MILESTONE_INPUTS: readonly UpgradeMilestoneInput[] = milestoneInputs(NICHE_MILESTONES);

/** Baumteile ohne Stufe und Kauf, mit Startpreis. */
export const TREE_PART_INPUTS: readonly (Omit<TreePartInput, 'level' | 'best' | 'purchase'> & { base: number })[] = TREE_PARTS.map((part) => ({
  id: part.id,
  icon: part.icon,
  name: part.name,
  ...treePartWho(part),
  pctPerLevel: part.effect.pct,
  text: part.text,
  base: part.base,
  milestones: milestoneInputs(part.milestones),
}));

/** Name und Symbol einer Nische aus content/. */
function nicheInfo(id: NicheId): { icon: string; label: string } {
  const niche = NICHES.find((n) => n.id === id);
  return { icon: niche?.icon ?? '❔', label: niche?.name ?? id };
}

/** Was der Knopf bei der Kaufmenge kauft (wie `upgradePurchases` im Spiel, nur ohne Spielstand). */
export function previewPurchase(base: number, level: number, amount: BuyAmount, seeds: number): UpgradePurchase {
  if (amount !== 'max') return { count: amount, cost: upgradeCostFrom(base, level, amount) };
  const affordable = affordableUpgrades(base, level, seeds, Infinity);
  return affordable.count > 0 ? affordable : { count: 1, cost: upgradePrice(base, level) };
}

// ---------------------------------------------------------------------------------------
// Beispielzustände
// ---------------------------------------------------------------------------------------

export interface UpgradeFixtureNiche {
  id: NicheId;
  level: number;
  best?: number;
  /** Plätze; 0 = verschlossen (Blocker `'closed'`). */
  capacity: number;
  /** Bewohner: Art-ID und Zufriedenheit. */
  animals: readonly { id: string; happiness: number }[];
  unlockHint?: string;
}

export interface UpgradeFixtureInput {
  stageName: string;
  seeds: number;
  seedsPerSecond: number;
  growthPerSecond: number;
  harmony: number;
  /** Bezahlbare Forschungsknoten (Zielzeile „🔍 2 erforschbar ›“). */
  research: number;
  tree: Readonly<Record<TreePartId, { level: number; best?: number }>>;
  niches: readonly UpgradeFixtureNiche[];
}

export interface UpgradeFixtureNicheState extends NicheUpgradeInput {
  capacity: number;
  animals: readonly { id: string; happiness: number }[];
  unlockHint?: string;
}

export interface UpgradePageState {
  ctx: UpgradeContext;
  tree: TreePartInput[];
  niches: UpgradeFixtureNicheState[];
  goal: GoalInput | null;
  research: number;
}

const MILESTONE_GOAL_SECONDS = 120;

/**
 * Wie `nextGoal` (28.7, kommt mit Phase 11, 2c): Meilenstein in ≤ 120 s zuerst, sonst der
 * billigste; Nischen vor Baumteilen.
 */
export function previewGoal(state: Pick<UpgradePageState, 'ctx' | 'tree' | 'niches'>): GoalInput | null {
  const candidates: (GoalInput & { atMilestone: boolean })[] = [];
  const add = (kind: 'niche' | 'tree', id: string, icon: string, name: string, base: number, level: number, milestones: readonly UpgradeMilestoneInput[]) => {
    const target = level + 1;
    const at = milestones.filter((m) => m.level === target && !m.badge);
    candidates.push({
      kind, id, icon, name, level: target, cost: upgradePrice(base, level),
      milestone: at.length > 0 ? at.map((m) => m.summary).join(' · ') : undefined,
      atMilestone: at.length > 0,
    });
  };
  for (const n of state.niches) {
    if (n.purchase === null) continue;
    add('niche', n.id, n.icon, n.label, NICHE_UPGRADE_BASE[n.id as NicheId], n.level, n.milestones);
  }
  for (const t of state.tree) {
    const base = TREE_PART_INPUTS.find((p) => p.id === t.id)!.base;
    add('tree', t.id, t.icon, t.name, base, t.level, t.milestones);
  }
  if (candidates.length === 0) return null;
  const { seeds, seedsPerSecond } = state.ctx;
  const soon = (c: GoalInput) => c.cost <= seeds || (seedsPerSecond > 0 && (c.cost - seeds) / seedsPerSecond <= MILESTONE_GOAL_SECONDS);
  const pool = candidates.filter((c) => c.atMilestone && soon(c));
  const list = pool.length > 0 ? pool : candidates;
  // Stabile Sortierung: Reihenfolge der Kandidaten entscheidet bei Gleichstand.
  const best = [...list].sort((a, b) => a.cost - b.cost)[0]!;
  const { atMilestone: _drop, ...goal } = best;
  void _drop;
  return goal;
}

/** Beispielzustand → Eingaben der Ansicht. */
export function fixtureUpgradeState(input: UpgradeFixtureInput, amount: BuyAmount): UpgradePageState {
  const ctx: UpgradeContext = { seeds: input.seeds, seedsPerSecond: input.seedsPerSecond, amount };
  const tree: TreePartInput[] = TREE_PART_INPUTS.map(({ base, ...part }) => {
    const { level, best } = input.tree[part.id as TreePartId];
    return { ...part, level, best: Math.max(level, best ?? 0), purchase: previewPurchase(base, level, amount, input.seeds) };
  });
  const niches: UpgradeFixtureNicheState[] = input.niches.map((n) => {
    const data = nicheInfo(n.id);
    return {
      id: n.id,
      icon: data.icon,
      label: data.label,
      level: n.level,
      best: Math.max(n.level, n.best ?? 0),
      milestones: NICHE_MILESTONE_INPUTS,
      pctPerLevel: NICHE_UPGRADE_PCT,
      happiness: n.animals.map((a) => a.happiness),
      purchase: n.capacity > 0 ? previewPurchase(NICHE_UPGRADE_BASE[n.id], n.level, amount, input.seeds) : null,
      capacity: n.capacity,
      animals: n.animals,
      unlockHint: n.unlockHint,
    };
  });
  const partial = { ctx, tree, niches };
  return { ...partial, goal: previewGoal(partial), research: input.research };
}

export type UpgradeFixtureId = 'start' | 'middle' | 'late';

const closed = (id: NicheId, unlockHint: string): UpgradeFixtureNiche => ({ id, level: 0, capacity: 0, animals: [], unlockHint });

/** Die drei Beispielstände der Vorschau. */
export const UPGRADE_FIXTURES: Readonly<Record<UpgradeFixtureId, { name: string; input: UpgradeFixtureInput }>> = {
  // Keimling, erster Kaufrausch: nur der Wurzelraum ist offen.
  start: {
    name: 'Anfang (Keimling)',
    input: {
      stageName: 'Keimling',
      seeds: 42,
      seedsPerSecond: 0.3,
      growthPerSecond: 1.8,
      harmony: 4,
      research: 0,
      tree: { rings: { level: 1 }, leaves: { level: 2 }, mycorrhiza: { level: 0 } },
      niches: [
        { id: 'roots', level: 3, capacity: 1, animals: [{ id: 'earthworm', happiness: 0.9 }] },
        closed('litter', 'öffnet bei „Setzling“'),
        closed('edge', 'öffnet bei „Setzling“'),
        closed('crown', 'öffnet bei „Junger Baum“'),
        closed('pond', 'öffnet mit Forschung „Waldtümpel“'),
      ],
    },
  },
  // Hain, typischer Stand nach 28.5 (Skizze 28.9): Wurzelraum kurz vor 25, Waldsaum vor 10.
  // Samen und Rate seit Phase 11, 3a (Preise ×2, Faktor 1,2; Hain ~27 🌰/s): Waldsaum 10 ist
  // bezahlbar, Wurzelraum 25 (1.590 🌰) in ~3 s.
  middle: {
    name: 'Mitte (Hain)',
    input: {
      stageName: 'Hain',
      seeds: 1_500,
      seedsPerSecond: 30,
      growthPerSecond: 236,
      harmony: 62,
      research: 2,
      tree: { rings: { level: 22 }, leaves: { level: 21 }, mycorrhiza: { level: 22 } },
      niches: [
        {
          id: 'roots', level: 24, best: 31, capacity: 3,
          animals: [{ id: 'earthworm', happiness: 0.95 }, { id: 'mole', happiness: 0.8 }, { id: 'porcini', happiness: 0.9 }],
        },
        { id: 'litter', level: 14, capacity: 3, animals: [{ id: 'woodlouse', happiness: 0.85 }, { id: 'hedgehog', happiness: 0.6 }] },
        { id: 'edge', level: 9, capacity: 3, animals: [{ id: 'bee', happiness: 1 }, { id: 'peacock', happiness: 0.7 }, { id: 'fox', happiness: 0.5 }] },
        { id: 'crown', level: 13, capacity: 3, animals: [{ id: 'bluetit', happiness: 0.9 }, { id: 'squirrel', happiness: 0.75 }] },
        { id: 'bark', level: 6, capacity: 2, animals: [{ id: 'woodpecker', happiness: 0.8 }] },
        { id: 'hollows', level: 0, capacity: 2, animals: [] },
        closed('pond', 'öffnet mit Forschung „Waldtümpel“'),
      ],
    },
  },
  // Urwald, ausgebaut: Abzeichen Bronze bis Gold, „Max“ kauft viele Stufen auf einmal.
  late: {
    name: 'Spät (Urwald, Abzeichen)',
    input: {
      stageName: 'Urwald',
      seeds: 48_000,
      seedsPerSecond: 260,
      growthPerSecond: 21_400,
      harmony: 148,
      research: 0,
      tree: { rings: { level: 52, best: 78 }, leaves: { level: 49 }, mycorrhiza: { level: 47 } },
      niches: [
        {
          id: 'roots', level: 58, best: 81, capacity: 5,
          animals: [
            { id: 'earthworm', happiness: 1 }, { id: 'mole', happiness: 0.9 }, { id: 'porcini', happiness: 0.95 },
            { id: 'flyagaric', happiness: 0.8 }, { id: 'honeyfungus', happiness: 0.7 },
          ],
        },
        { id: 'litter', level: 44, best: 52, capacity: 5, animals: [{ id: 'woodlouse', happiness: 1 }, { id: 'woodant', happiness: 0.9 }, { id: 'salamander', happiness: 0.85 }] },
        { id: 'crown', level: 36, capacity: 5, animals: [{ id: 'bluetit', happiness: 1 }, { id: 'jay', happiness: 0.9 }, { id: 'dormouse', happiness: 0.8 }] },
        { id: 'pond', level: 25, capacity: 3, animals: [{ id: 'toad', happiness: 0.9 }, { id: 'newt', happiness: 0.8 }] },
        { id: 'wall', level: 12, capacity: 2, animals: [] },
      ],
    },
  },
};
