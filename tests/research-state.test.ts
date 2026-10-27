import { describe, expect, it } from 'vitest';
import { RESEARCH } from '../src/content/research';
import { evaluate } from '../src/core/formulas';
import { research } from '../src/core/tick';
import {
  PLAN_EMPTY_TEXT,
  createResearchStateSource,
  planResearchText,
  researchPlanNumbers,
  researchPlanView,
  researchTreeState,
} from '../src/ui/research-state';
import { researchHeader, researchNodeView } from '../src/ui/research-view';
import { stateAt } from './helpers';

/*
 * Forschung im Album (Phase 11, 4a): Spielstand → Zustand des Baums (Blocker, Rang, Kosten,
 * Plan-Nummern), Zeile unter „Plan des letzten Zyklus folgen“, Hinweis nach Plan-Käufen.
 */

const NBSP = ' ';
const SOIL_FORK = ['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle'];

function grove() {
  const state = stateAt(5, ['earthworm', 'robin', 'bee', 'vole', 'chanterelle'], 1);
  state.cycle.research = [...SOIL_FORK];
  return state;
}

describe('researchTreeState', () => {
  it('Blocker aus dem Spielstand: erforscht, erforschbar, sparen, gesperrt, ausgeschlossen', () => {
    const state = grove();
    state.harmonyPoints = 700;
    const tree = researchTreeState(state);
    expect(Object.keys(tree.nodes).sort()).toEqual(RESEARCH.map((n) => n.id).sort());
    expect(tree.nodes.compost!.status).toBe('researched');
    expect(tree.nodes['fungus-garden']!.status).toBe('excluded');
    expect(tree.nodes.humus!.status).toBe('available');
    expect(tree.nodes['soil-life']).toMatchObject({ status: 'saving', rank: 0, cost: 1_500 });
    expect(tree.nodes['light-crown']).toMatchObject({ status: 'locked', lock: 'requires' });
    expect(tree.nodes['hem-bloom']).toMatchObject({ status: 'locked', lock: 'stage' });
    expect(tree.harmony).toBe(700);
    expect(tree.perMinute).toBeGreaterThan(0);
    expect(tree.planActive).toBe(false);
  });

  it('wiederholbar: Rang und Kosten des nächsten Rangs; ⚖️ entscheidet ohne neue Blocker', () => {
    const state = grove();
    state.harmonyPoints = 10_000;
    expect(research(state, 'soil-life').ok).toBe(true);
    expect(research(state, 'soil-life').ok).toBe(true);
    const source = createResearchStateSource();
    const ev = evaluate(state);
    const tree = source(state, ev);
    expect(tree.nodes['soil-life']).toMatchObject({ status: 'available', rank: 2, cost: 2_535 + 1 });
    expect(researchNodeView('soil-life', tree)).toMatchObject({ stampText: 'Rang 2', showStamp: true });
    // Vorrat sinkt (ohne Kauf): gleiche Blocker, jetzt „sparen“.
    state.harmonyPoints = 100;
    expect(source(state, ev).nodes['soil-life']!.status).toBe('saving');
    expect(researchNodeView('soil-life', source(state, ev)).actionText).toMatch(/^Noch 2\.436/);
  });

  it('Kopf zählt auch den nächsten Rang als erforschbar', () => {
    const state = grove();
    state.harmonyPoints = 1_600;
    const header = researchHeader(researchTreeState(state));
    expect(header.count).toBeGreaterThanOrEqual(2);
  });
});

describe('Plan-Nummern', () => {
  it('offene Einträge je Knoten, wiederholte Ränge einzeln; Erledigtes und Unerreichbares fehlt', () => {
    const state = grove();
    state.meta.research.plan = ['compost', 'humus', 'soil-life', 'fungus-garden', 'soil-life', 'nest-boxes', 'soil-life'];
    state.cycle.researchRanks = { 'soil-life': 1 };
    state.cycle.research.push('soil-life');
    const numbers = researchPlanNumbers(state);
    expect(numbers.get('compost')).toBeUndefined(); // erforscht
    expect(numbers.get('fungus-garden')).toBeUndefined(); // anderer Weg
    expect(numbers.get('humus')).toEqual([2]);
    expect(numbers.get('soil-life')).toEqual([5, 7]); // Rang 1 (Nr. 3) erledigt
    expect(numbers.get('nest-boxes')).toEqual([6]);
    state.harmonyPoints = 1e6;
    const tree = researchTreeState(state);
    expect(tree.nodes.humus).toMatchObject({ plan: [2], planNext: true });
    expect(tree.nodes['soil-life']!.planNext).toBeUndefined();
    expect(researchNodeView('soil-life', tree).plan!.text).toBe(`5 · 7`);
  });
});

describe('Schalter „Plan des letzten Zyklus folgen“', () => {
  it('ohne Plan: Hinweis, kein Schalter', () => {
    const state = grove();
    expect(researchPlanView(state, 60)).toEqual({ hasPlan: false, on: false, status: PLAN_EMPTY_TEXT });
  });

  it('aus, an mit Sparen, gleich, wartet, erledigt, unerreichbar', () => {
    const state = grove();
    state.meta.research.plan = ['compost', 'soil-life', 'light-crown'];
    state.harmonyPoints = 500;
    expect(researchPlanView(state, 100).status).toBe('Aus – du forschst selbst. Der Plan hat 3 Schritte; die Nummern stehen an den Karten.');
    state.meta.research.auto = true;
    expect(researchPlanView(state, 100)).toEqual({
      hasPlan: true,
      on: true,
      status: `Als Nächstes (Nr. 2): 🐛 Bodenleben fördern – noch 1.000${NBSP}⚖️ · ~10 Min.`,
    });
    state.harmonyPoints = 1_500;
    expect(researchPlanView(state, 100).status).toBe('Als Nächstes (Nr. 2): 🐛 Bodenleben fördern – gleich.');
    state.cycle.researchRanks = { 'soil-life': 1 };
    expect(researchPlanView(state, 100).status).toBe('Als Nächstes (Nr. 3): ☀️ Lichte Krone – wartet auf eine Voraussetzung.');
    state.meta.research.plan = ['compost'];
    expect(researchPlanView(state, 100).status).toBe('Plan erledigt – alles Weitere wählst du selbst.');
    state.meta.research.plan = ['soil-life', 'soil-life'];
    state.cycle.researchRanks = { 'soil-life': 150 };
    state.meta.research.plan = Array.from({ length: 151 }, () => 'soil-life');
    expect(researchPlanView(state, 100).status).toBe('Als Nächstes (Nr. 151): 🐛 Bodenleben fördern – unerreichbar, hier hält der Plan.');
  });
});

describe('Hinweis nach Plan-Käufen', () => {
  it('fasst wiederholte Ränge zusammen, höchstens drei Namen', () => {
    expect(planResearchText([])).toBe('');
    expect(planResearchText(['humus'])).toBe('🔍 Nach Plan erforscht: 🟫 Humusschicht');
    expect(planResearchText(['humus', 'soil-life', 'soil-life'])).toBe('🔍 Nach Plan erforscht: 🟫 Humusschicht und 🐛 Bodenleben fördern ×2');
    expect(planResearchText(['compost', 'humus', 'pond', 'nest-boxes'])).toMatch(/und 1 weitere$/);
  });
});
