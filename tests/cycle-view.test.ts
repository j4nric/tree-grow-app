import { describe, expect, it } from 'vitest';
import { SPECIES } from '../src/content/species';
import {
  CYCLE_LOCKED_TEXT,
  cycleViewKey,
  memoryBonusLabel,
  memoryRuleText,
  newCycleBlockerText,
  fruitPhrase,
  newCycleToast,
  treeLabel,
  regularsArrivedText,
  toCyclePanelView,
  withRegulars,
} from '../src/ui/cycle-view';
import { cycleMemoryGain, memoryHarmonyBonus } from '../src/core/formulas';
import { MEMORY_HARMONY_DIVISOR } from '../src/content/memory';
import { stateAt } from './helpers';

const MEMORY_RULE =
  'Waldgedächtnis: 1 Punkt je 5 Punkte höchster Harmonie und je neue Art. Höchste Harmonie ab 101 zählt extra: bis zu +3 je Punkt (bis 115). Die Schwelle steigt mit dem Wachstum bis 150 im Urwald.';

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
    // Die Regel steht schon vor dem Hain da – man soll wissen, worauf man hinarbeitet.
    expect(view.memoryRule).toBe(MEMORY_RULE);
  });

  it('Regel nennt die erste Harmonie mit Bonus am erreichten Wegpunkt (Schritt 2.11b)', () => {
    const wald = stateAt(6, ['earthworm']);
    // Wegpunkt 28: Schwelle 125, Obergrenze 41,5 → ⌊140 / 5 + 41,5⌋ + 2 Arten = 69 + 2 = 71
    wald.cycle.maxHarmony = 140;
    wald.cycle.newSpecies = ['earthworm', 'robin'];
    const view = toCyclePanelView(wald);
    expect(view.memoryRule).toBe(MEMORY_RULE.replace('ab 101', 'ab 126').replace('bis 115', 'bis 139'));
    expect(view.gain).toBe('+71 Waldgedächtnis (+71 %)');
    // Wegpunkt 23: Schwelle 109,375 → „ab 110“ (dort +1, danach +3 je Punkt), voll ab 124.
    wald.waypoint = 23;
    wald.stage = 5;
    expect(toCyclePanelView(wald).memoryRule).toBe(MEMORY_RULE.replace('ab 101', 'ab 110').replace('bis 115', 'bis 124'));
    const urwald = stateAt(7, ['earthworm']);
    urwald.cycle.maxHarmony = 140;
    urwald.cycle.newSpecies = ['earthworm', 'robin'];
    // Oben angekommen: kein Hinweis mehr aufs Steigen.
    expect(toCyclePanelView(urwald).memoryRule).toBe(
      'Waldgedächtnis: 1 Punkt je 5 Punkte höchster Harmonie und je neue Art. Höchste Harmonie ab 151 zählt extra: bis zu +3 je Punkt (bis 163).',
    );
    expect(toCyclePanelView(urwald).gain).toBe('+30 Waldgedächtnis (+30 %)');
  });

  it('genannte Harmonie und Gewinn passen an jedem Wegpunkt zusammen (Hain bis Urwald)', () => {
    const base = (h: number) => Math.floor(h / MEMORY_HARMONY_DIVISOR);
    const shown = (w: number) => Number(/ab (\d+) zählt extra/.exec(memoryRuleText(memoryHarmonyBonus(w)))![1]);
    // Wegpunkt 23 (Schwelle 109,375): ab 110, dort +1 über dem Sockel.
    expect(shown(23)).toBe(110);
    expect(cycleMemoryGain(110, 0, 0, 23)).toBe(base(110) + 1);
    // Wegpunkt 27 (Schwelle 121,875): 122 bringt nach dem Abrunden nichts extra, erst 123.
    expect(shown(27)).toBe(123);
    expect(cycleMemoryGain(122, 0, 0, 27)).toBe(base(122));
    expect(cycleMemoryGain(123, 0, 0, 27)).toBeGreaterThan(base(123));
    for (let w = 20; w <= 36; w++) {
      const h = shown(w);
      expect(cycleMemoryGain(h, 0, 0, w), `Wegpunkt ${w}, H ${h}`).toBeGreaterThan(base(h));
      expect(cycleMemoryGain(h - 1, 0, 0, w), `Wegpunkt ${w}, H ${h - 1}`).toBe(base(h - 1));
      // Ab der genannten Zahl wächst das Extra bis „voll“ mit jedem Punkt, im Schnitt um 3
      // (einzelne Schritte 2–4, weil Sockel und Bonus zusammen abgerundet werden), und bleibt
      // höchstens bei der Obergrenze.
      const { fullAt, maxPoints, threshold } = memoryHarmonyBonus(w);
      const extra = (x: number) => cycleMemoryGain(x, 0, 0, w) - base(x);
      for (let x = h + 1; x <= fullAt; x++) {
        expect(extra(x), `Wegpunkt ${w}, H ${x}`).toBeGreaterThan(extra(x - 1));
        expect(extra(x), `Wegpunkt ${w}, H ${x}`).toBeLessThanOrEqual(Math.min(Math.ceil(maxPoints), Math.ceil(3 * (x - threshold))));
      }
      expect(extra(fullAt + 5)).toBeLessThanOrEqual(Math.ceil(maxPoints));
    }
  });

  it('ab dem Hain: Vorschau „+43 Waldgedächtnis (+43 %)“ und neue Stammgast-Plätze', () => {
    const state = stateAt(5, ['earthworm']);
    // 104 / 5 + 3 · (104 − 100) + 11 Arten = 20 + 12 + 11 = 43 (Formel seit Schritt 2.11)
    state.cycle.maxHarmony = 104.4;
    state.cycle.newSpecies = SPECIES.slice(0, 11).map((s) => s.id);
    const view = toCyclePanelView(state);
    expect(view.allowed).toBe(true);
    expect(view.blocker).toBeNull();
    expect(view.gain).toBe('+43 Waldgedächtnis (+43 %)');
    expect(view.memoryRule).toBe(MEMORY_RULE);
    expect(view.gainDetail).toBe('Höchste Harmonie 104 · 11 neue Arten');
    expect(view.slotsGain).toBe('+1 Platz für Stammgäste');
    state.meta.forestMemory = 20;
    expect(toCyclePanelView(state).slotsGain).toBe('+2 Plätze für Stammgäste');
    state.cycle.newSpecies = ['earthworm'];
    expect(toCyclePanelView(state).gainDetail).toBe('Höchste Harmonie 104 · 1 neue Art');
  });

  it('Anzeige und Gewinn nutzen dieselbe gerundete höchste Harmonie', () => {
    const state = stateAt(5, ['earthworm']);
    state.cycle.newSpecies = [];
    const at = (h: number) => {
      state.cycle.maxHarmony = h;
      const view = toCyclePanelView(state);
      return [view.gainDetail, view.gain];
    };
    // 100,4 → 100: kein Extra; 100,5 und 100,6 → 101: +3 extra, wie die Regel verspricht.
    expect(at(100.4)).toEqual(['Höchste Harmonie 100 · 0 neue Arten', '+20 Waldgedächtnis (+20 %)']);
    expect(at(100.5)).toEqual(['Höchste Harmonie 101 · 0 neue Arten', '+23 Waldgedächtnis (+23 %)']);
    expect(at(100.6)).toEqual(['Höchste Harmonie 101 · 0 neue Arten', '+23 Waldgedächtnis (+23 %)']);
    // 114,6 → 115: Bonus schon voll (23 + 45).
    expect(at(114.6)).toEqual(['Höchste Harmonie 115 · 0 neue Arten', '+68 Waldgedächtnis (+68 %)']);
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
    expect(memoryBonusLabel(33)).toBe('+33 %');
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
