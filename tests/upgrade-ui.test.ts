import { describe, expect, it } from 'vitest';
import { NICHE_MILESTONES, TREE_PARTS_BY_ID } from '../src/content/upgrades';
import { evaluate, sowingCost } from '../src/core/formulas';
import { nextGoal } from '../src/core/goal';
import { upgradeNiche } from '../src/core/tick';
import { goalCostNow, goalEpochKey, refreshEcosystemView, toEcosystemView, toGoalInput, treeUpgradeViews, upgradeMilestoneText } from '../src/ui/adapters';
import { goalLineView } from '../src/ui/upgrade-view';
import { stateAt } from './helpers';

/*
 * Einfache Ausbau-Ansicht im Reiter Nischen (Phase 11, 2a): Knopf „Ausbauen · Preis“ je offener
 * Nische, drei Baum-Zeilen ab dem Keimling, Meldung bei Meilensteinen. Die ausgefeilte Ansicht
 * (Kaufmenge, Balken, Abzeichen) folgt mit 4b.
 */

/** Geschützte Leerzeichen (Zahlenformat) als normale – für lesbare Erwartungen. */
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('Ausbau in der Ökosystem-Ansicht', () => {
  it('Knopf nur an offenen Nischen; Stufe, Wirkung, nächster Meilenstein, Preis', () => {
    const state = stateAt(1, ['earthworm']);
    state.cycle.upgrades.niches.roots = 24;
    const view = toEcosystemView(state, evaluate(state));
    const roots = view.niches.find((n) => n.id === 'roots')!;
    expect(plain(roots.upgrade!.effect)).toBe('je Tier +2,4 %');
    expect(roots.upgrade).toMatchObject({
      target: { kind: 'niche', id: 'roots' },
      id: 'roots',
      level: 24,
      next: 'St. 25: +1 Platz',
      cost: 287,
      costLabel: '287',
      affordable: false,
    });
    // Verschlossene Nischen (Laubstreu vor dem Setzling, Tümpel ohne Forschung) ohne Knopf.
    expect(view.niches.find((n) => n.id === 'litter')!.upgrade).toBeUndefined();
    expect(view.niches.find((n) => n.id === 'pond')!.upgrade).toBeUndefined();
  });

  it('„reicht es?“ folgt den Samen ohne Neuaufbau', () => {
    const state = stateAt(1);
    const view = toEcosystemView(state, evaluate(state));
    const roots = view.niches.find((n) => n.id === 'roots')!.upgrade!;
    expect(roots.affordable).toBe(false);
    expect(view.treeUpgrades.every((p) => !p.affordable)).toBe(true);
    state.seeds = 12;
    refreshEcosystemView(view, state);
    expect(roots.affordable).toBe(true);
    expect(view.treeUpgrades.every((p) => !p.affordable)).toBe(true);
    state.seeds = 15;
    refreshEcosystemView(view, state);
    expect(view.treeUpgrades.every((p) => p.affordable)).toBe(true);
  });

  it('Baum-Zeilen ab dem Keimling, Wirkung je Teil', () => {
    expect(treeUpgradeViews(stateAt(0))).toEqual([]);
    const state = stateAt(3);
    state.cycle.upgrades.tree = { rings: 22, leaves: 21, mycorrhiza: 22 };
    const rows = treeUpgradeViews(state);
    expect(rows.map((r) => [r.id, r.label, plain(r.effect)])).toEqual([
      ['rings', 'Jahresringe', 'Baum +8,8 % 🌿'],
      ['leaves', 'Blattwerk', 'Baum +21 % 🌰'],
      ['mycorrhiza', 'Pilzgeflecht', 'Pflanzen +11 % 🌿 🌰'],
    ]);
    expect(rows[0]!.next).toBe(`St. 25: ${TREE_PARTS_BY_ID.get('rings')!.milestones[0]!.summary}`);
  });

  it('Meldung bei Meilensteinen, leer ohne', () => {
    const state = stateAt(1);
    state.seeds = 1e6;
    const result = upgradeNiche(state, 'roots', 25);
    expect(result.ok && upgradeMilestoneText(result.upgrade!)).toBe(
      '🪱 Wurzelraum Stufe 10: öfter in den Karten. 🪱 Wurzelraum Stufe 25: +1 Platz, Abzeichen Bronze',
    );
    const plain = upgradeNiche(state, 'roots');
    expect(plain.ok && upgradeMilestoneText(plain.upgrade!)).toBe('');
    expect(NICHE_MILESTONES[0]!.summary).toBe('öfter in den Karten');
  });

  it('Stufe am Ende (MAX): kein Preis, nie bezahlbar', () => {
    const state = stateAt(1);
    state.seeds = Number.MAX_VALUE;
    state.cycle.upgrades.niches.roots = 1000;
    const view = toEcosystemView(state, evaluate(state));
    expect(view.niches.find((n) => n.id === 'roots')!.upgrade).toMatchObject({ cost: Infinity, costLabel: '–', affordable: false, next: '' });
  });
});

describe('Zielzeile im Spiel (Phase 11, 2c)', () => {
  it('nextGoal → Eingabe der Zielzeile: Name, Stufe, Meilenstein, Säen', () => {
    const state = stateAt(1, ['earthworm']);
    state.plants = ['moss'];
    state.cycle.upgrades.niches.roots = 24;
    state.seeds = 10_000;
    const goal = nextGoal(state, 1)!;
    expect(toGoalInput(goal)).toEqual({ kind: 'niche', id: 'roots', icon: '🪱', name: 'Wurzelraum', level: 25, cost: 287, milestone: '+1 Platz' });
    const line = goalLineView(toGoalInput(goal), { seeds: 10_000, seedsPerSecond: 1 }, 2)!;
    expect(plain(line.text)).toBe('Jetzt: 🪱 Wurzelraum St. 25 (+1 Platz) · 287 🌰 ›');
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
    expect(goalCostNow({ kind: 'niche', target: { kind: 'niche', id: 'roots' }, level: 1, cost: 10, milestones: [], seconds: 0 }, state)).toBe(12);
  });
});
