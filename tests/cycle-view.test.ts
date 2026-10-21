import { describe, expect, it } from 'vitest';
import { SPECIES } from '../src/content/species';
import { cycleViewKey, memoryBonusLabel, newCycleToast, toCyclePanelView } from '../src/ui/cycle-view';
import { stateAt } from './helpers';

describe('View-Model „Neuer Zyklus“', () => {
  it('gesperrt: zeigt den Grund, keine Vorschau, keinen Knopf', () => {
    const view = toCyclePanelView(stateAt(3, ['earthworm']));
    expect(view.allowed).toBe(false);
    expect(view.blocker).toContain('„Hain“');
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
});
