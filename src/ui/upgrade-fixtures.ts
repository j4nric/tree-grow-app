/**
 * Beispielzustände für Ausbau und Zielzeile (Vorschau `upgrade-preview.html` und Tests).
 *
 * PLATZHALTER bis Phase 11, 2a/2c: Die Daten hier spiegeln `content/upgrades.ts` aus 1a
 * (Startpreise, Faktor 1,15, Meilensteine, Baumteile – DESIGN_V2.md 28.4) und ahmen
 * `upgradeCost`, `upgradeBlocker` und `nextGoal` (28.7) nach, damit die Vorschau stimmige
 * Zustände zeigt. Im Spiel kommt der Zustand aus dem Spielstand – diese Datei wird dort nicht
 * benutzt. In 4b ersetzen die echten Inhalte die PLACEHOLDER_*-Werte.
 */
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
// Platzhalter-Inhalte (wie content/upgrades.ts aus 1a)
// ---------------------------------------------------------------------------------------

export const PLACEHOLDER_UPGRADE_GROWTH = 1.15;
export const PLACEHOLDER_NICHE_UPGRADE_PCT = 0.1;
/** Kauf „Max“ höchstens so viele Stufen auf einmal (Schutz vor Endlosschleifen). */
const MAX_BATCH = 1_000;

export type PlaceholderNicheId = 'roots' | 'litter' | 'edge' | 'crown' | 'bark' | 'hollows' | 'pond' | 'meadow' | 'deadwood' | 'wall';
export type PlaceholderTreePartId = 'rings' | 'leaves' | 'mycorrhiza';

export const PLACEHOLDER_NICHES: readonly { id: PlaceholderNicheId; icon: string; label: string; base: number }[] = [
  { id: 'roots', icon: '🪱', label: 'Wurzelraum', base: 10 },
  { id: 'litter', icon: '🍂', label: 'Laubstreu', base: 25 },
  { id: 'edge', icon: '🌼', label: 'Waldsaum', base: 25 },
  { id: 'crown', icon: '🌳', label: 'Krone', base: 60 },
  { id: 'bark', icon: '🪵', label: 'Stamm & Rinde', base: 60 },
  { id: 'hollows', icon: '🕳️', label: 'Höhlen & Totholz', base: 250 },
  { id: 'pond', icon: '🪷', label: 'Waldtümpel', base: 250 },
  { id: 'meadow', icon: '🌾', label: 'Waldwiese', base: 60 },
  { id: 'deadwood', icon: '🪵', label: 'Totholzhaufen', base: 250 },
  { id: 'wall', icon: '🪨', label: 'Trockenmauer', base: 600 },
];

const BADGES: readonly UpgradeMilestoneInput[] = [
  { level: 25, summary: 'Abzeichen Bronze', badge: 'bronze' },
  { level: 50, summary: 'Abzeichen Silber', badge: 'silver' },
  { level: 75, summary: 'Abzeichen Gold', badge: 'gold' },
];

export const PLACEHOLDER_NICHE_MILESTONES: readonly UpgradeMilestoneInput[] = [
  { level: 10, summary: 'öfter in den Karten' },
  { level: 25, summary: '+1 Platz' },
  BADGES[0]!,
  { level: 50, summary: 'Seltene öfter' },
  BADGES[1]!,
  BADGES[2]!,
];

export const PLACEHOLDER_TREE_PARTS: readonly (Omit<TreePartInput, 'level' | 'best' | 'purchase'> & { base: number })[] = [
  {
    id: 'rings', icon: '🪵', name: 'Jahresringe', who: 'Baum', pctPerLevel: 0.4, icons: '🌿', base: 15,
    text: 'Jedes Jahr ein Ring mehr – alte Stämme bekommen Höhlen.',
    milestones: [{ level: 25, summary: '+1 Höhle' }, ...BADGES],
  },
  {
    id: 'leaves', icon: '🍃', name: 'Blattwerk', who: 'Baum', pctPerLevel: 1, icons: '🌰', base: 15,
    text: 'Mehr Blätter, mehr Zucker – und im Herbst mehr Eicheln.',
    milestones: [{ level: 25, summary: '+1 Platz Krone' }, ...BADGES],
  },
  {
    id: 'mycorrhiza', icon: '🍄', name: 'Pilzgeflecht', who: 'Pflanzen', pctPerLevel: 0.5, icons: '', base: 15,
    text: 'Feine Pilzfäden verbinden die Wurzeln – der Baum teilt mit seinen Nachbarn.',
    milestones: [{ level: 25, summary: '+1 💧' }, ...BADGES],
  },
];

// ---------------------------------------------------------------------------------------
// Nachgeahmte Logik (später core: upgradeCost, nextGoal)
// ---------------------------------------------------------------------------------------

/** Preis der Stufe L → L+1: ⌈b · 1,15^L⌉ 🌰. */
export function placeholderPrice(base: number, level: number): number {
  return Math.ceil(base * PLACEHOLDER_UPGRADE_GROWTH ** level);
}

/** Summe von `count` Stufen ab `level`. */
export function placeholderCost(base: number, level: number, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += placeholderPrice(base, level + i);
  return sum;
}

/** Was der Knopf bei der Kaufmenge kauft (Max: so viele, wie die Samen reichen, sonst eine). */
export function placeholderPurchase(base: number, level: number, amount: BuyAmount, seeds: number): UpgradePurchase {
  if (amount !== 'max') return { count: amount, cost: placeholderCost(base, level, amount) };
  let count = 0;
  let cost = 0;
  while (count < MAX_BATCH) {
    const next = placeholderPrice(base, level + count);
    if (cost + next > seeds) break;
    cost += next;
    count++;
  }
  return count > 0 ? { count, cost } : { count: 1, cost: placeholderPrice(base, level) };
}

// ---------------------------------------------------------------------------------------
// Beispielzustände
// ---------------------------------------------------------------------------------------

export interface UpgradeFixtureNiche {
  id: PlaceholderNicheId;
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
  tree: Readonly<Record<PlaceholderTreePartId, { level: number; best?: number }>>;
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

/** Wie `nextGoal` (28.7): Meilenstein in ≤ 120 s zuerst, sonst der billigste; Nischen vor Baumteilen. */
export function placeholderGoal(state: Pick<UpgradePageState, 'ctx' | 'tree' | 'niches'>): GoalInput | null {
  const candidates: (GoalInput & { atMilestone: boolean })[] = [];
  const add = (kind: 'niche' | 'tree', id: string, icon: string, name: string, base: number, level: number, milestones: readonly UpgradeMilestoneInput[]) => {
    const target = level + 1;
    const at = milestones.filter((m) => m.level === target && !m.badge);
    candidates.push({
      kind, id, icon, name, level: target, cost: placeholderPrice(base, level),
      milestone: at.length > 0 ? at.map((m) => m.summary).join(' · ') : undefined,
      atMilestone: at.length > 0,
    });
  };
  for (const n of state.niches) {
    if (n.purchase === null) continue;
    const base = PLACEHOLDER_NICHES.find((p) => p.id === n.id)!.base;
    add('niche', n.id, n.icon, n.label, base, n.level, n.milestones);
  }
  for (const t of state.tree) {
    const base = PLACEHOLDER_TREE_PARTS.find((p) => p.id === t.id)!.base;
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
  const tree: TreePartInput[] = PLACEHOLDER_TREE_PARTS.map(({ base, ...part }) => {
    const { level, best } = input.tree[part.id as PlaceholderTreePartId];
    return { ...part, level, best: Math.max(level, best ?? 0), purchase: placeholderPurchase(base, level, amount, input.seeds) };
  });
  const niches: UpgradeFixtureNicheState[] = input.niches.map((n) => {
    const data = PLACEHOLDER_NICHES.find((p) => p.id === n.id)!;
    return {
      id: n.id,
      icon: data.icon,
      label: data.label,
      level: n.level,
      best: Math.max(n.level, n.best ?? 0),
      milestones: PLACEHOLDER_NICHE_MILESTONES,
      pctPerLevel: PLACEHOLDER_NICHE_UPGRADE_PCT,
      happiness: n.animals.map((a) => a.happiness),
      purchase: n.capacity > 0 ? placeholderPurchase(data.base, n.level, amount, input.seeds) : null,
      capacity: n.capacity,
      animals: n.animals,
      unlockHint: n.unlockHint,
    };
  });
  const partial = { ctx, tree, niches };
  return { ...partial, goal: placeholderGoal(partial), research: input.research };
}

export type UpgradeFixtureId = 'start' | 'middle' | 'late';

const closed = (id: PlaceholderNicheId, unlockHint: string): UpgradeFixtureNiche => ({ id, level: 0, capacity: 0, animals: [], unlockHint });

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
  middle: {
    name: 'Mitte (Hain)',
    input: {
      stageName: 'Hain',
      seeds: 240,
      seedsPerSecond: 20,
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
