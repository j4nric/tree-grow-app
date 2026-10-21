import { describe, expect, it } from 'vitest';
import { SPECIES } from '../src/content/species';
import {
  CYCLE_LOCKED_TEXT,
  cycleViewKey,
  memoryBonusLabel,
  newCycleBlockerText,
  fruitPhrase,
  newCycleToast,
  treeLabel,
  regularsArrivedText,
  toCyclePanelView,
  withRegulars,
} from '../src/ui/cycle-view';
import { stateAt } from './helpers';

describe('View-Model „Neuer Zyklus“', () => {
  it('gesperrt: zeigt den Grund, keine Vorschau, keinen Knopf', () => {
    const view = toCyclePanelView(stateAt(3, ['earthworm']));
    expect(view.allowed).toBe(false);
    expect(view.blocker).toBe('Ein neuer Zyklus ist ab der Stufe „Hain“ möglich (noch 14 Wegpunkte).');
    expect(view.gain).toBeNull();
    expect(view.gainDetail).toBeNull();
    expect(view.slotsGain).toBeNull();
    expect(view.title).toBe('Zyklus 1');
    expect(view.memory).toBe('Waldgedächtnis 0 · +0 % Wachstum und Samen');
  });

  it('ab dem Hain: Vorschau „+33 Waldgedächtnis (+66 %)“ und neue Stammgast-Plätze', () => {
    const state = stateAt(5, ['earthworm']);
    state.cycle.maxHarmony = 96.4;
    state.cycle.newSpecies = SPECIES.slice(0, 12).map((s) => s.id);
    const view = toCyclePanelView(state);
    expect(view.allowed).toBe(true);
    expect(view.blocker).toBeNull();
    expect(view.gain).toBe('+33 Waldgedächtnis (+66 %)');
    expect(view.gainDetail).toBe('Höchste Harmonie 96 · 12 neue Arten');
    expect(view.slotsGain).toBe('+1 Platz für Stammgäste');
    state.meta.forestMemory = 20;
    expect(toCyclePanelView(state).slotsGain).toBe('+2 Plätze für Stammgäste');
    state.cycle.newSpecies = ['earthworm'];
    expect(toCyclePanelView(state).gainDetail).toBe('Höchste Harmonie 96 · 1 neue Art');
  });

  it('Stammgäste: ohne Platz ausgeblendet, sonst alle entdeckten Arten zum Wählen', () => {
    const state = stateAt(2, ['earthworm', 'robin']);
    state.meta.journal.species.push('vole');
    expect(toCyclePanelView(state).regularSlots).toBe(0);
    state.meta.forestMemory = 30;
    state.meta.regulars = ['vole'];
    const view = toCyclePanelView(state);
    expect(view.regularSlots).toBe(1);
    expect(view.regularsTitle).toBe('Stammgäste 1/1');
    expect(view.regulars.map((r) => r.id)).toEqual(['earthworm', 'robin', 'vole']);
    const vole = view.regulars.find((r) => r.id === 'vole')!;
    expect(vole).toMatchObject({ name: 'Wühlmaus', selected: true, disabled: false, present: false, niche: 'Wurzelraum' });
    // Alle Plätze belegt: andere Arten gesperrt, die gewählte bleibt abwählbar.
    expect(view.regulars.find((r) => r.id === 'earthworm')).toMatchObject({ selected: false, disabled: true, present: true });
  });

  it('Schlüssel ändert sich nur mit dem Inhalt', () => {
    const state = stateAt(5, ['earthworm']);
    const a = cycleViewKey(toCyclePanelView(state));
    state.seeds += 100; // Samen spielen keine Rolle
    expect(cycleViewKey(toCyclePanelView(state))).toBe(a);
    state.cycle.maxHarmony = 50;
    expect(cycleViewKey(toCyclePanelView(state))).not.toBe(a);
  });

  it('Texte: Prozent und Toast', () => {
    expect(memoryBonusLabel(33)).toBe('+66 %');
    expect(memoryBonusLabel(0)).toBe('+0 %');
    expect(newCycleToast(33, 2)).toContain('Zyklus 2');
    expect(newCycleToast(33, 2)).toContain('+33 Waldgedächtnis');
  });

  it('Grund als Satz, Einzahl und Mehrzahl', () => {
    expect(newCycleBlockerText({ stage: 5, waypointsLeft: 1 })).toBe('Ein neuer Zyklus ist ab der Stufe „Hain“ möglich (noch 1 Wegpunkt).');
    expect(newCycleBlockerText({ stage: 5, waypointsLeft: 20 })).toContain('(noch 20 Wegpunkte)');
    expect(CYCLE_LOCKED_TEXT).toContain('„Hain“');
  });

  it('Meldung für eingezogene Stammgäste', () => {
    expect(regularsArrivedText([])).toBe('');
    expect(regularsArrivedText(['unbekannt'])).toBe('');
    expect(regularsArrivedText(['mole'])).toBe('Stammgast Maulwurf ist eingezogen.');
    expect(regularsArrivedText(['mole', 'vole'])).toBe('Stammgäste Maulwurf und Wühlmaus sind eingezogen.');
    expect(regularsArrivedText(['mole', 'vole', 'earthworm'])).toBe('Stammgäste Maulwurf, Wühlmaus und Regenwurm sind eingezogen.');
    expect(withRegulars('Willkommen zurück!', ['mole'])).toBe('Willkommen zurück! Stammgast Maulwurf ist eingezogen.');
    expect(withRegulars('Willkommen zurück!', [])).toBe('Willkommen zurück!');
    expect(newCycleToast(10, 3, ['mole'])).toMatch(/Waldgedächtnis\. Stammgast Maulwurf ist eingezogen\.$/);
  });
});

describe('View-Model „Neuer Zyklus“: Wahl des Hauptbaums (DESIGN_V2.md 17.2)', () => {
  it('drei Arten, die laufende vorausgewählt, gesperrte mit Hinweis statt Eigenheit', () => {
    const state = stateAt(5, ['earthworm']);
    const view = toCyclePanelView(state);
    expect(view.tree).toBe('🌳 Stieleiche');
    expect(view.trees.map((t) => t.id)).toEqual(['oak', 'beech', 'pine']);
    expect(view.trees.map((t) => t.unlocked)).toEqual([true, false, false]);
    expect(view.trees.find((t) => t.current)!.id).toBe('oak');
    const beech = view.trees.find((t) => t.id === 'beech')!;
    expect(beech.hint).toBe('Lass einmal eine Rotbuche im Pflanzring wachsen.');
    expect(view.trees[0]!.hint).toBeNull();
    expect(view.trees[0]!.summary).toContain('+1 Platz Krone');
  });

  it('freigeschaltet über das Naturtagebuch; der Schlüssel ändert sich damit', () => {
    const state = stateAt(5, ['earthworm']);
    const before = cycleViewKey(toCyclePanelView(state));
    state.meta.journal.plants.push('beech');
    const view = toCyclePanelView(state);
    expect(view.trees.find((t) => t.id === 'beech')).toMatchObject({ unlocked: true, hint: null });
    expect(cycleViewKey(view)).not.toBe(before);
    state.cycle.mainTree = 'beech';
    expect(toCyclePanelView(state).tree).toBe('🍂 Rotbuche');
    expect(toCyclePanelView(state).trees.find((t) => t.current)!.id).toBe('beech');
  });

  it('Vorauswahl: die laufende Art, ist sie gesperrt, die erste freie', () => {
    const state = stateAt(5, ['earthworm']);
    state.meta.journal.plants.push('pine');
    expect(toCyclePanelView(state).defaultTree).toBe('oak');
    state.cycle.mainTree = 'pine';
    expect(toCyclePanelView(state).defaultTree).toBe('pine');
    state.cycle.mainTree = 'beech'; // gesperrt (nicht im Tagebuch)
    expect(toCyclePanelView(state).defaultTree).toBe('oak');
  });

  it('Toast und Frucht nennen die Art des neuen Zyklus', () => {
    expect(newCycleToast(5, 2)).toContain('Aus einer Eichel wächst ein neuer Baum.');
    expect(newCycleToast(5, 2, [], 'beech')).toContain('Aus einer Buchecker wächst ein neuer Baum.');
    expect(newCycleToast(5, 2, [], 'pine')).toContain('Aus einem Kiefernsamen wächst ein neuer Baum.');
    expect(fruitPhrase('maple')).toBe('einer Eichel');
    expect(treeLabel('pine')).toBe('🌲 Waldkiefer');
  });
});
