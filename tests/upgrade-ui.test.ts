import { describe, expect, it } from 'vitest';
import { NICHE_MILESTONES, NICHE_UPGRADE_BASE, NICHE_UPGRADE_PCT, TREE_PARTS_BY_ID } from '../src/content/upgrades';
import { evaluate, sowingCost } from '../src/core/formulas';
import { nextGoal } from '../src/core/goal';
import { upgradeCost, upgradeNiche, upgradeTree } from '../src/core/tick';
import { goalCostNow, goalEpochKey, refreshEcosystemView, toEcosystemView, toGoalInput, toJournalStats } from '../src/ui/adapters';
import {
  milestoneInputs,
  purchaseFor,
  treeUpgradeViews,
  upgradeAddsSlot,
  upgradeBadgeCount,
  upgradeBestEntries,
  upgradeFloatText,
  upgradeMilestoneText,
  upgradePurchases,
} from '../src/ui/upgrade-adapters';
import { goalLineView, nicheFooterView, treeMilestoneHint, treePartView } from '../src/ui/upgrade-view';
import { stateAt } from './helpers';

/*
 * Ausbau im Album (Phase 11, 4b; DESIGN_V2.md 28.9): Spielstand → Eingaben der Ansicht
 * (upgrade-adapters.ts) mit Kaufmenge ×1/×10/Max, Abzeichen aus der Bestmarke, Stempeltext,
 * Statistik „Höchste Ausbaustufen“.
 */

/** Geschützte Leerzeichen (Zahlenformat) als normale – für lesbare Erwartungen. */
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('Ausbau in der Ökosystem-Ansicht', () => {
  it('Nischen-Fußzeile aus dem Spielstand: Stufe, Balken, Wirkung, Preis; verschlossen ohne Knopf', () => {
    const state = stateAt(1, ['earthworm']);
    state.cycle.upgrades.niches.roots = 24;
    const view = toEcosystemView(state, evaluate(state));
    const roots = view.niches.find((n) => n.id === 'roots')!.upgrade!;
    expect(roots).toMatchObject({ target: { kind: 'niche', id: 'roots' }, id: 'roots', label: 'Wurzelraum', level: 24, best: 24, open: true, pctPerLevel: NICHE_UPGRADE_PCT });
    expect(roots.happiness).toHaveLength(1);
    const footer = nicheFooterView({ ...roots, purchase: purchaseFor(roots.purchases, 1) }, { seeds: 0, seedsPerSecond: 1, amount: 1 });
    expect(footer.closed).toBe(false);
    expect(footer.levelText).toBe('St. 24');
    expect(footer.progress.label).toBe('25: +1 Platz');
    // Zahlen seit der Messung Phase 11, 3a: 24 · 0,06 % = 1,44 %, Stufe 25 kostet ⌈20 · 1,2²⁴⌉ = 1.590 🌰.
    expect(plain(footer.effectText)).toBe('je Tier +1,4 %');
    expect(plain(footer.button!.label)).toBe('Ausbauen · 1.590 🌰');
    expect(footer.button!.affordable).toBe(false);
    expect(footer.button!.wait).toBe('in 26:30');
    // Laubstreu vor dem Setzling: verschlossen (keine Fußzeile), aber eine Ansicht fürs Abzeichen.
    const litter = view.niches.find((n) => n.id === 'litter')!.upgrade!;
    expect(litter.open).toBe(false);
    expect(nicheFooterView({ ...litter, purchase: null }, { seeds: 0, seedsPerSecond: 0, amount: 1 }).closed).toBe(true);
  });

  it('Kaufmenge: ×1 und ×10 genau, Max so viele wie die Samen reichen (sonst die nächste Stufe)', () => {
    const state = stateAt(1);
    const target = { kind: 'niche', id: 'roots' } as const;
    state.seeds = 5;
    let p = upgradePurchases(state, target);
    expect(p['1']).toEqual({ count: 1, cost: NICHE_UPGRADE_BASE.roots });
    expect(p['10']).toEqual({ count: 10, cost: upgradeCost(state, target, 10) });
    expect(p.max).toEqual({ count: 1, cost: NICHE_UPGRADE_BASE.roots });
    state.seeds = upgradeCost(state, target, 7);
    p = upgradePurchases(state, target);
    expect(p.max).toEqual({ count: 7, cost: state.seeds });
    expect(purchaseFor(p, 'max')).toBe(p.max);
    expect(purchaseFor(p, 10)).toBe(p['10']);
  });

  it('Käufe folgen den Samen ohne Neuaufbau', () => {
    const state = stateAt(1);
    const view = toEcosystemView(state, evaluate(state));
    const roots = view.niches.find((n) => n.id === 'roots')!.upgrade!;
    expect(roots.purchases.max.count).toBe(1);
    state.seeds = 1e4;
    refreshEcosystemView(view, state);
    expect(roots.purchases.max.count).toBeGreaterThan(10);
    expect(view.treeUpgrades.every((t) => t.purchases.max.count > 10)).toBe(true);
  });

  it('Höchste Stufe: Knopf ohne Preis, nie bezahlbar', () => {
    const state = stateAt(1);
    state.seeds = Number.MAX_VALUE;
    state.cycle.upgrades.niches.roots = 1000;
    const roots = toEcosystemView(state, evaluate(state)).niches.find((n) => n.id === 'roots')!.upgrade!;
    const footer = nicheFooterView({ ...roots, purchase: purchaseFor(roots.purchases, 1) }, { seeds: state.seeds, seedsPerSecond: 1, amount: 1 });
    expect(footer.button).toMatchObject({ label: 'Höchste Stufe', affordable: false, wait: '' });
    expect(footer.progress.label).toBe('alle Meilensteine');
  });

  it('Baumteile ab dem Keimling, Wirkung je Teil, nächster Meilenstein', () => {
    expect(treeUpgradeViews(stateAt(0))).toEqual([]);
    const state = stateAt(3);
    state.cycle.upgrades.tree = { rings: 22, leaves: 21, mycorrhiza: 23 };
    const parts = treeUpgradeViews(state);
    const ctx = { seeds: 0, seedsPerSecond: 0, amount: 1 as const };
    const views = parts.map((p) => treePartView({ ...p, purchase: purchaseFor(p.purchases, 1) }, ctx));
    expect(views.map((v) => [v.id, v.title, plain(v.effectText)])).toEqual([
      ['rings', '🪵 Jahresringe', 'Baum +8,8 % 🌿'],
      ['leaves', '🍃 Blattwerk', 'Baum +21 % 🌰'],
      ['mycorrhiza', '🍄 Pilzgeflecht', 'Pflanzen +11,5 % 🌿 🌰'],
    ]);
    expect(views[0]!.progress.label).toBe(`25: ${TREE_PARTS_BY_ID.get('rings')!.milestones[0]!.summary}`);
    expect(treeMilestoneHint(parts.map((p) => ({ ...p, purchase: null })))).toBe('nächster Meilenstein: Pilzgeflecht 25 · +1 💧');
  });

  it('Abzeichen aus der Bestmarke (bleibt über den Zyklus)', () => {
    const state = stateAt(1, ['earthworm']);
    state.meta.upgrades.best.niches.roots = 52;
    const roots = toEcosystemView(state, evaluate(state)).niches.find((n) => n.id === 'roots')!.upgrade!;
    expect(roots.level).toBe(0);
    expect(roots.best).toBe(52);
    const footer = nicheFooterView({ ...roots, purchase: purchaseFor(roots.purchases, 1) }, { seeds: 0, seedsPerSecond: 0, amount: 1 });
    expect(footer.badge).toMatchObject({ tier: 'silver', text: '⭑ Silber' });
  });

  it('Meilenstein-Stempel, schwebender Text und Einkleben des Platzes', () => {
    const state = stateAt(1);
    state.seeds = 1e6;
    const result = upgradeNiche(state, 'roots', 25);
    expect(result.ok && upgradeMilestoneText(result.upgrade!)).toBe(
      '🪱 Wurzelraum: Eingelebt! öfter in den Karten. 🪱 Wurzelraum: Gut bewohnt! +1 Platz · Abzeichen Bronze',
    );
    expect(result.ok && upgradeAddsSlot(result.upgrade!)).toBe('roots');
    // Abzeichen aus einem früheren Zyklus (Bestmarke 52) nennt der Stempel nicht noch einmal.
    expect(result.ok && upgradeMilestoneText(result.upgrade!, 52)).toBe(
      '🪱 Wurzelraum: Eingelebt! öfter in den Karten. 🪱 Wurzelraum: Gut bewohnt! +1 Platz',
    );
    expect(result.ok && upgradeFloatText(result.upgrade!.bought)).toBe('+25 Stufen');
    expect(upgradeFloatText(1)).toBe('+1 Stufe');
    const one = upgradeNiche(state, 'roots');
    expect(one.ok && upgradeMilestoneText(one.upgrade!)).toBe('');
    expect(one.ok && upgradeAddsSlot(one.upgrade!)).toBeNull();
    // Baumteil: Platz in einer anderen Nische, Stempel mit Stufe.
    const rings = upgradeTree(state, 'rings', 25);
    expect(rings.ok && upgradeMilestoneText(rings.upgrade!)).toBe('🪵 Jahresringe 25: +1 Platz Höhlen · Abzeichen Bronze');
    expect(rings.ok && upgradeAddsSlot(rings.upgrade!)).toBe('hollows');
  });

  it('Meilensteine als Eingabe der Ansicht: Abzeichen markiert', () => {
    expect(milestoneInputs(NICHE_MILESTONES)).toEqual([
      { level: 10, summary: 'öfter in den Karten' },
      { level: 25, summary: '+1 Platz' },
      { level: 25, summary: 'Abzeichen Bronze', badge: 'bronze' },
      { level: 50, summary: 'Seltene öfter' },
      { level: 50, summary: 'Abzeichen Silber', badge: 'silver' },
      { level: 75, summary: 'Abzeichen Gold', badge: 'gold' },
    ]);
  });
});

describe('Statistik „Höchste Ausbaustufen“', () => {
  it('absteigend mit Abzeichen, gekaufte Stufen und Samen', () => {
    const state = stateAt(1);
    state.meta.upgrades.best = { niches: { roots: 81, litter: 52, edge: 3 }, tree: { rings: 30 } };
    state.meta.stats.upgradesBought = 166;
    state.meta.stats.upgradeSeeds = 12_345;
    expect(upgradeBestEntries(state)).toEqual([
      { name: '🪱 Wurzelraum', level: 81, badge: 'Gold' },
      { name: '🍂 Laubstreu', level: 52, badge: 'Silber' },
      { name: '🪵 Jahresringe', level: 30, badge: 'Bronze' },
      { name: '🌼 Waldsaum', level: 3, badge: '' },
    ]);
    // Gold zählt mit Silber und Bronze darunter: 3 + 2 + 1.
    expect(upgradeBadgeCount(state)).toBe(6);
    const stats = toJournalStats(state, evaluate(state));
    const best = stats.find((s) => s.key === 'total-upgrade-best')!;
    expect(best.value).toBe('🪱 Wurzelraum 81 · Gold');
    expect(plain(best.detail!)).toBe('6 Abzeichen · 🍂 Laubstreu 52 (Silber), 🪵 Jahresringe 30 (Bronze), 🌼 Waldsaum 3');
    const bought = stats.find((s) => s.key === 'total-upgrades')!;
    expect(bought.value).toBe('166');
    expect(plain(bought.detail!)).toBe('für 12.345 🌰');
  });
});

describe('Zielzeile im Spiel (Phase 11, 2c)', () => {
  it('nextGoal → Eingabe der Zielzeile: Name, Stufe, Meilenstein, Säen', () => {
    const state = stateAt(1, ['earthworm']);
    state.plants = ['moss'];
    state.cycle.upgrades.niches.roots = 24;
    state.seeds = 10_000;
    const goal = nextGoal(state, 1)!;
    expect(toGoalInput(goal)).toEqual({ kind: 'niche', id: 'roots', icon: '🪱', name: 'Wurzelraum', level: 25, cost: 1_590, milestone: '+1 Platz' });
    const line = goalLineView(toGoalInput(goal), { seeds: 10_000, seedsPerSecond: 1 }, 2)!;
    expect(plain(line.text)).toBe('Jetzt: 🪱 Wurzelraum St. 25 (+1 Platz) · 1.590 🌰 ›');
    expect(line.research).toBe('🔍 2 erforschbar ›');
    // Baumteil ohne Meilenstein, Säen ohne Stufe.
    const tree = toGoalInput({ kind: 'tree', target: { kind: 'tree', id: 'leaves' }, level: 3, cost: 20, milestones: [], seconds: 0 });
    expect(tree).toEqual({ kind: 'tree', id: 'leaves', icon: '🍃', name: 'Blattwerk', level: 3, cost: 20 });
    expect(toGoalInput({ kind: 'sow', target: null, level: null, cost: 0, milestones: [], seconds: 0 })).toMatchObject({ kind: 'sow', name: 'Säen', level: null });
  });

  it('Regel 5: neu gewählt nach Kauf, Stufenwechsel, Säen – nicht, wenn nur Samen oder Zeit laufen', () => {
    const state = stateAt(1, ['earthworm']);
    state.seeds = 100;
    const key = goalEpochKey(state);
    state.seeds = 5;
    state.cycle.elapsed += 30;
    expect(goalEpochKey(state)).toBe(key);
    state.seeds = 100;
    upgradeNiche(state, 'roots');
    const bought = goalEpochKey(state);
    expect(bought).not.toBe(key);
    state.stage = 2;
    expect(goalEpochKey(state)).not.toBe(bought);
  });

  it('gehaltenes Ziel: Preis immer aktuell (Ausbau und Säen)', () => {
    const state = stateAt(1, ['earthworm']);
    state.plants = [];
    state.cycle.sowings = 1;
    expect(goalCostNow({ kind: 'sow', target: null, level: null, cost: 0, milestones: [], seconds: 0 }, state)).toBe(sowingCost(state));
    state.cycle.upgrades.niches.roots = 1;
    expect(goalCostNow({ kind: 'niche', target: { kind: 'niche', id: 'roots' }, level: 1, cost: 20, milestones: [], seconds: 0 }, state)).toBe(24);
  });
});
