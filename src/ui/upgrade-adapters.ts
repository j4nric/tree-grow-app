/**
 * Ausbau im Album (DESIGN_V2.md 28.4/28.9; ROADMAP Phase 11, 4b): Spielstand → Eingaben der
 * Ansicht `upgrade-view.ts`. Liest nur den Spielstand und ruft die reinen Abfragen aus core/
 * (`upgradeCost`, `upgradeAffordable`, `upgradeBlocker`) – keine eigenen Preise oder Regeln.
 *
 * Die Kaufmenge (×1 / ×10 / Max) ist eine Einstellung der Oberfläche; darum hält jede Ansicht
 * die Käufe für alle drei Mengen bereit (`purchases`), und die Seite wählt nur aus.
 */
import { NICHES } from '../content/niches';
import { MILESTONE_NAMES, NICHE_UPGRADE_PCT, TREE_PARTS, TREE_PARTS_BY_ID, type TreePart, type UpgradeMilestone } from '../content/upgrades';
import type { GameState } from '../core/state';
import { upgradeAffordable, upgradeBlocker, upgradeCost, upgradeLevelOf, type UpgradeOutcome } from '../core/tick';
import { upgradeLevel, upgradeMilestones, type UpgradeTarget } from '../core/upgrades';
import { formatNumber } from './format';
import {
  badgeOf,
  BADGE_LABELS,
  type BuyAmount,
  type NicheUpgradeInput,
  type TreePartInput,
  type UpgradeMilestoneInput,
  type UpgradePurchase,
} from './upgrade-view';

/** Kauf je Kaufmenge (`'1'`, `'10'`, `'max'`). */
export type UpgradePurchases = Record<`${BuyAmount}`, UpgradePurchase>;

interface UpgradeViewBase {
  /** Nische oder Baumteil – geht beim Kauf unverändert an die Aktion. */
  target: UpgradeTarget;
  /** Was die Knöpfe bei jeder Kaufmenge kaufen (Samen-abhängig, alle 200 ms aufgefrischt). */
  purchases: UpgradePurchases;
}

/**
 * Ausbau einer Nische: alles für `nicheFooterView` außer dem Kauf (`purchase` wählt die Seite
 * nach der Kaufmenge). `open: false` = Blocker `'closed'` – keine Fußzeile, kein Knopf, aber
 * das Abzeichen aus früheren Zyklen bleibt am Etikett.
 */
export interface NicheUpgradeView extends Omit<NicheUpgradeInput, 'purchase'>, UpgradeViewBase {
  open: boolean;
}

/** Ausbau eines Baumteils (Jahresringe, Blattwerk, Pilzgeflecht). */
export interface TreeUpgradeView extends Omit<TreePartInput, 'purchase'>, UpgradeViewBase {}

/** Meilensteine aus content/ in der Form der Ansicht (Abzeichen markiert). */
export function milestoneInputs(milestones: readonly UpgradeMilestone[]): UpgradeMilestoneInput[] {
  return milestones.map((m) => (m.kind === 'badge' ? { level: m.level, summary: m.summary, badge: m.badge } : { level: m.level, summary: m.summary }));
}

/** Wem ein Baumteil hilft und mit welchem Symbol („Baum … 🌿“, „Pflanzen … 🌿 🌰“). */
export function treePartWho(part: TreePart): { who: string; icons: string } {
  if (part.effect.kind === 'treeGrowth') return { who: 'Baum', icons: '🌿' };
  if (part.effect.kind === 'treeSeeds') return { who: 'Baum', icons: '🌰' };
  return { who: 'Pflanzen', icons: '🌿 🌰' };
}

/**
 * Was ein Knopf bei jeder Kaufmenge kauft (aus core/): ×1 und ×10 genau so viele Stufen
 * (der Knopf ist blass, solange die Samen nicht reichen), Max so viele, wie die Samen reichen –
 * reicht es für keine, die nächste Stufe (dann ist `cost` > Samen). Ab der Höchststufe
 * kostet jede Menge Infinity.
 */
export function upgradePurchases(state: GameState, target: UpgradeTarget): UpgradePurchases {
  const one = upgradeCost(state, target, 1);
  const affordable = upgradeAffordable(state, target);
  return {
    '1': { count: 1, cost: one },
    '10': { count: 10, cost: upgradeCost(state, target, 10) },
    max: affordable.count > 0 ? affordable : { count: 1, cost: one },
  };
}

/** Kauf der gewählten Menge. */
export function purchaseFor(purchases: UpgradePurchases, amount: BuyAmount): UpgradePurchase {
  return purchases[`${amount}`];
}

/** Samen-abhängige Teile neu (Käufe je Kaufmenge) – ohne Neuaufbau der Ansicht. */
export function refreshUpgradeView(view: UpgradeViewBase, state: GameState): void {
  view.purchases = upgradePurchases(state, view.target);
}

/**
 * Ausbau einer Nische (nur Nischen, in denen je jemand wohnen kann). `happiness`: Zufriedenheit
 * der Bewohner (ohne Gäste) – für „zusammen +x %“ in der Haftnotiz.
 */
export function nicheUpgradeView(state: GameState, nicheId: string, happiness: readonly number[]): NicheUpgradeView | undefined {
  const niche = NICHES.find((n) => n.id === nicheId);
  if (!niche) return undefined;
  const target: UpgradeTarget = { kind: 'niche', id: niche.id };
  return {
    target,
    id: niche.id,
    icon: niche.icon,
    label: niche.name,
    level: upgradeLevelOf(state, target),
    best: Math.max(upgradeLevelOf(state, target), upgradeBestLevel(state, target)),
    milestones: milestoneInputs(upgradeMilestones(target)),
    pctPerLevel: NICHE_UPGRADE_PCT,
    happiness: [...happiness],
    open: upgradeBlocker(state, target) !== 'closed',
    purchases: upgradePurchases(state, target),
  };
}

/** Baum-Ausbau (28.4): drei Teile ab dem Keimling, vorher keine. */
export function treeUpgradeViews(state: GameState): TreeUpgradeView[] {
  return TREE_PARTS.flatMap((part) => {
    const target: UpgradeTarget = { kind: 'tree', id: part.id };
    if (upgradeBlocker(state, target) === 'closed') return [];
    const level = upgradeLevelOf(state, target);
    return [
      {
        target,
        id: part.id,
        icon: part.icon,
        name: part.name,
        ...treePartWho(part),
        pctPerLevel: part.effect.pct,
        text: part.text,
        level,
        best: Math.max(level, upgradeBestLevel(state, target)),
        milestones: milestoneInputs(part.milestones),
        purchases: upgradePurchases(state, target),
      },
    ];
  });
}

/** Name mit Symbol eines Ausbau-Ziels („🪱 Wurzelraum“). */
export function upgradeTargetName(target: UpgradeTarget): string {
  const info = target.kind === 'niche' ? NICHES.find((n) => n.id === target.id) : TREE_PARTS_BY_ID.get(target.id);
  return info ? `${info.icon} ${info.name}` : target.id;
}

/**
 * Stempel nach einem Ausbau mit neuem Meilenstein (28.9), z. B. „🪱 Wurzelraum: Gut bewohnt! +1
 * Platz · Abzeichen Bronze“ bzw. „🪵 Jahresringe 25: +1 Platz Höhlen“ – je Meilenstein-Stufe ein
 * Satz; '' ohne Meilenstein (dann reichen Aufleuchten und „+1 Stufe“). `bestBefore`: Bestmarke
 * vor dem Kauf – ein Abzeichen, das schon ein früherer Zyklus gebracht hat, nennt der Stempel
 * nicht noch einmal.
 */
export function upgradeMilestoneText(outcome: Pick<UpgradeOutcome, 'target' | 'milestones'>, bestBefore = 0): string {
  const milestones = outcome.milestones.filter((m) => m.kind !== 'badge' || m.level > bestBefore);
  if (milestones.length === 0) return '';
  const { target } = outcome;
  const name = upgradeTargetName(target);
  const levels = [...new Set(milestones.map((m) => m.level))];
  return levels
    .map((level) => {
      const at = milestones.filter((m) => m.level === level);
      const what = at.map((m) => m.summary).join(' · ');
      const title = target.kind === 'niche' ? MILESTONE_NAMES[level] : undefined;
      return title ? `${name}: ${title}! ${what}` : `${name} ${formatNumber(level)}: ${what}`;
    })
    .join('. ');
}

/** Höchste je erreichte Stufe eines Ziels (`meta.upgrades.best`). */
export function upgradeBestLevel(state: GameState, target: UpgradeTarget): number {
  return upgradeLevel(state.meta.upgrades.best, target);
}

/** Kurzer schwebender Text über der Zeile: „+1 Stufe“, „+10 Stufen“. */
export function upgradeFloatText(bought: number): string {
  return bought === 1 ? '+1 Stufe' : `+${formatNumber(bought)} Stufen`;
}

/** Kauf, der einen Platz-Meilenstein für diese Nische erreicht hat (Einkleben, 28.9)? */
export function upgradeAddsSlot(outcome: Pick<UpgradeOutcome, 'target' | 'milestones'>): string | null {
  for (const m of outcome.milestones) {
    if (m.kind !== 'slot') continue;
    const niche = m.niche ?? (outcome.target.kind === 'niche' ? outcome.target.id : null);
    if (niche) return niche;
  }
  return null;
}

/** Eine Zeile „Höchste Ausbaustufen“ (Statistik, über alle Zyklen). */
export interface UpgradeBestEntry {
  name: string;
  level: number;
  badge: string;
}

/**
 * Höchste je erreichte Ausbaustufen (`meta.upgrades.best`), absteigend, mit Abzeichen – für
 * die Statistik „Über alle Zyklen“ (28.9).
 */
export function upgradeBestEntries(state: GameState): UpgradeBestEntry[] {
  const best = state.meta.upgrades.best;
  const targets: UpgradeTarget[] = [
    ...NICHES.map((n): UpgradeTarget => ({ kind: 'niche', id: n.id })),
    ...TREE_PARTS.map((p): UpgradeTarget => ({ kind: 'tree', id: p.id })),
  ];
  const out: (UpgradeBestEntry & { order: number })[] = [];
  targets.forEach((target, order) => {
    const level = upgradeLevel(best, target);
    if (level <= 0) return;
    const tier = badgeOf(level, milestoneInputs(upgradeMilestones(target)));
    out.push({ name: upgradeTargetName(target), level, badge: tier ? BADGE_LABELS[tier] : '', order });
  });
  return out.sort((a, b) => b.level - a.level || a.order - b.order).map(({ order: _order, ...e }) => e);
}

/** Wie viele Abzeichen (Bronze, Silber, Gold zählen je einzeln) je erreicht wurden. */
export function upgradeBadgeCount(state: GameState): number {
  const best = state.meta.upgrades.best;
  let count = 0;
  const add = (target: UpgradeTarget) => {
    const level = upgradeLevel(best, target);
    for (const m of upgradeMilestones(target)) if (m.kind === 'badge' && level >= m.level) count++;
  };
  for (const n of NICHES) add({ kind: 'niche', id: n.id });
  for (const p of TREE_PARTS) add({ kind: 'tree', id: p.id });
  return count;
}

