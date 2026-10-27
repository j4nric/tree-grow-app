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
  treeChoiceFor,
  withRegulars,
  type CyclePanelView,
} from '../src/ui/cycle-view';
import { ANCIENT_STAGE } from '../src/core/landscape';
import { createSite, type GameState } from '../src/core/state';
import { cycleMemoryGain, memoryHarmonyBonus } from '../src/core/formulas';
import { stateAt } from './helpers';

const MEMORY_RULE =
  'Waldgedächtnis: 1 Punkt je 5 Punkte höchster Harmonie und je neue Art. Höchste Harmonie ab 113 zählt extra: etwa +3 je Punkt (bis 127). Die Schwelle steigt mit dem Wachstum bis 196 im Urwald, dort 1 Punkt je 7 – Erreichtes bleibt.';

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

  it('Regel nennt Teiler und erste Harmonie mit Bonus am erreichten Wegpunkt', () => {
    const wald = stateAt(6, ['earthworm']);
    // Wegpunkt 28: Teiler 6, Schwelle 168 → ⌊140 / 6⌋ + 2 Arten = 23 + 2 = 25 (ohne gemerkten Wert).
    wald.cycle.maxHarmony = 140;
    wald.cycle.bestHarmonyMemory = 0;
    wald.cycle.newSpecies = ['earthworm', 'robin'];
    const view = toCyclePanelView(wald);
    expect(view.memoryRule).toBe(MEMORY_RULE.replace('je 5 Punkte', 'je 6 Punkte').replace('ab 113', 'ab 169').replace('bis 127', 'bis 184'));
    expect(view.gain).toBe('+25 Waldgedächtnis (+25 %)');
    // Wegpunkt 23: Teiler 5,375 (angezeigt 5,4), Schwelle 133 → „ab 134“, voll ab 149.
    wald.waypoint = 23;
    wald.stage = 5;
    expect(toCyclePanelView(wald).memoryRule).toBe(MEMORY_RULE.replace('je 5 Punkte', 'je 5,4 Punkte').replace('ab 113', 'ab 134').replace('bis 127', 'bis 149'));
    const urwald = stateAt(7, ['earthworm']);
    urwald.cycle.maxHarmony = 140;
    urwald.cycle.bestHarmonyMemory = 0;
    urwald.cycle.newSpecies = ['earthworm', 'robin'];
    // Oben angekommen: kein Hinweis mehr aufs Steigen.
    expect(toCyclePanelView(urwald).memoryRule).toBe(
      'Waldgedächtnis: 1 Punkt je 7 Punkte höchster Harmonie und je neue Art. Höchste Harmonie ab 197 zählt extra: etwa +3 je Punkt (bis 212).',
    );
    expect(toCyclePanelView(urwald).gain).toBe('+22 Waldgedächtnis (+22 %)'); // ⌊140 / 7⌋ + 2
  });

  it('genannte Harmonie und Gewinn passen an jedem Wegpunkt zusammen (Hain bis Urwald)', () => {
    let w = 0;
    const base = (h: number) => Math.floor(h / memoryHarmonyBonus(w).divisor);
    const shown = (wp: number) => Number(/ab (\d+) zählt extra/.exec(memoryRuleText(memoryHarmonyBonus(wp)))![1]);
    // Wegpunkt 23 (Teiler 5,375, Schwelle 133): ab 134, dort +3 über dem Sockel.
    w = 23;
    expect(shown(23)).toBe(134);
    expect(cycleMemoryGain(134, 0, 0, 23)).toBe(base(134) + 3);
    expect(cycleMemoryGain(133, 0, 0, 23)).toBe(base(133));
    for (w = 20; w <= 36; w++) {
      const h = shown(w);
      expect(cycleMemoryGain(h, 0, 0, w), `Wegpunkt ${w}, H ${h}`).toBeGreaterThan(base(h));
      expect(cycleMemoryGain(h - 1, 0, 0, w), `Wegpunkt ${w}, H ${h - 1}`).toBe(base(h - 1));
      // Ab der genannten Zahl wächst das Extra bis „voll“ mit jedem Punkt, im Schnitt um 3
      // (einzelne Schritte 2–4, weil Sockel und Bonus zusammen abgerundet werden), und bleibt
      // höchstens bei der Obergrenze.
      const { fullAt, maxPoints, threshold } = memoryHarmonyBonus(w);
      const extra = (x: number) => cycleMemoryGain(x, 0, 0, w) - base(x);
      for (let x = h + 1; x <= fullAt; x++) {
        // Der letzte Schritt bis „voll“ kann bei krummer Obergrenze unter 1 Punkt liegen (Wegpunkt
        // 21: Obergrenze 45,375 – von 45 auf 45,375 bringt nach dem Abrunden nichts).
        if (x === fullAt) expect(extra(x), `Wegpunkt ${w}, H ${x}`).toBeGreaterThanOrEqual(extra(x - 1));
        else expect(extra(x), `Wegpunkt ${w}, H ${x}`).toBeGreaterThan(extra(x - 1));
        expect(extra(x), `Wegpunkt ${w}, H ${x}`).toBeLessThanOrEqual(Math.min(Math.ceil(maxPoints), Math.ceil(3 * (x - threshold))));
      }
      expect(extra(fullAt + 5)).toBeLessThanOrEqual(Math.ceil(maxPoints));
    }
  });

  it('ab dem Hain: Vorschau „+46 Waldgedächtnis (+46 %)“ und neue Stammgast-Plätze', () => {
    const state = stateAt(5, ['earthworm']);
    // ⌊116 / 5 + 3 · (116 − 112)⌋ + 11 Arten = ⌊23,2 + 12⌋ + 11 = 46 (Schwelle 112 seit Phase 11, 3b)
    state.cycle.maxHarmony = 116.4;
    state.cycle.newSpecies = SPECIES.slice(0, 11).map((s) => s.id);
    const view = toCyclePanelView(state);
    expect(view.allowed).toBe(true);
    expect(view.blocker).toBeNull();
    expect(view.gain).toBe('+46 Waldgedächtnis (+46 %)');
    expect(view.memoryRule).toBe(MEMORY_RULE);
    expect(view.gainDetail).toBe('Höchste Harmonie 116 · 11 neue Arten');
    expect(view.slotsGain).toBe('+1 Platz für Stammgäste');
    state.meta.forestMemory = 20;
    expect(toCyclePanelView(state).slotsGain).toBe('+2 Plätze für Stammgäste');
    state.cycle.newSpecies = ['earthworm'];
    expect(toCyclePanelView(state).gainDetail).toBe('Höchste Harmonie 116 · 1 neue Art');
  });

  it('Anzeige und Gewinn nutzen dieselbe gerundete höchste Harmonie', () => {
    const state = stateAt(5, ['earthworm']);
    state.cycle.newSpecies = [];
    const at = (h: number) => {
      state.cycle.maxHarmony = h;
      const view = toCyclePanelView(state);
      return [view.gainDetail, view.gain];
    };
    // 112,4 → 112: kein Extra; 112,5 und 112,6 → 113: +3 extra, wie die Regel verspricht.
    expect(at(112.4)).toEqual(['Höchste Harmonie 112 · 0 neue Arten', '+22 Waldgedächtnis (+22 %)']);
    expect(at(112.5)).toEqual(['Höchste Harmonie 113 · 0 neue Arten', '+25 Waldgedächtnis (+25 %)']);
    expect(at(112.6)).toEqual(['Höchste Harmonie 113 · 0 neue Arten', '+25 Waldgedächtnis (+25 %)']);
    // 126,6 → 127: Bonus schon voll (25 + 45).
    expect(at(126.6)).toEqual(['Höchste Harmonie 127 · 0 neue Arten', '+70 Waldgedächtnis (+70 %)']);
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

describe('View-Model „Neuer Zyklus“: Baumwahl je Ziel in der Landschaft (DESIGN_V2.md 25.2)', () => {
  /** Urwald im Heimatwald, Landschaft frei: Bergmischwald und Erlenbruch sind gründbar. */
  function ancientHome(): GameState {
    const state = stateAt(ANCIENT_STAGE, ['earthworm']);
    state.meta.forestMemory = 300;
    state.meta.achievements.push('ancient-forest');
    return state;
  }
  const siteOf = (view: CyclePanelView, id: string) => view.landscape!.sites.find((s) => s.id === id)!;

  it('Bergmischwald gründen: Weißtanne vorausgewählt und wählbar, ohne Ziel gesperrt', () => {
    const view = toCyclePanelView(ancientHome());
    const mountain = siteOf(view, 'mountain');
    expect(mountain).toMatchObject({ action: 'found', mainTree: 'fir', unlockedTrees: ['oak', 'fir'] });
    const choice = treeChoiceFor(view, mountain);
    expect(choice.current).toBe('fir');
    expect(choice.trees.find((t) => t.id === 'fir')).toMatchObject({ unlocked: true, hint: null });
    expect(choice.trees.find((t) => t.id === 'alder')).toMatchObject({ unlocked: false, hint: 'Gründe den Erlenbruch – dort keimt sie.' });
    // Hier weiter (kein Ziel): Weißtanne gesperrt mit Hinweis, Vorauswahl die laufende Art.
    const here = treeChoiceFor(view, undefined);
    expect(here.current).toBe('oak');
    expect(here.trees.find((t) => t.id === 'fir')).toMatchObject({ unlocked: false, hint: 'Gründe den Bergmischwald – dort keimt sie.' });
  });

  it('Spieler mit Buche: Bergmischwald wählt trotzdem die Weißtanne vor, Buche bleibt wählbar', () => {
    const state = ancientHome();
    state.meta.journal.plants.push('beech');
    const view = toCyclePanelView(state);
    const choice = treeChoiceFor(view, siteOf(view, 'mountain'));
    expect(choice.current).toBe('fir');
    expect(choice.trees.filter((t) => t.unlocked).map((t) => t.id)).toEqual(['oak', 'beech', 'fir']);
  });

  it('Erlenbruch gründen: Schwarzerle; Buchenhallen ohne Buche: Eiche', () => {
    const view = toCyclePanelView(ancientHome());
    expect(treeChoiceFor(view, siteOf(view, 'carr')).current).toBe('alder');
    expect(treeChoiceFor(view, siteOf(view, 'beechwood')).current).toBe('oak');
  });

  it('Rückkehr in einen gegründeten Wald: die zuletzt dort gewachsene Art, wenn wählbar', () => {
    const state = ancientHome();
    state.meta.landscape.sites.push({ ...createSite('mountain', 'fir'), memory: 0 });
    state.meta.landscape.corridors = ['home-mountain'];
    state.meta.landscape.freeCorridors = ['home-mountain'];
    const view = toCyclePanelView(state);
    const mountain = siteOf(view, 'mountain');
    expect(mountain.action).not.toBe('found');
    expect(treeChoiceFor(view, mountain).current).toBe('fir');
    // Weißtanne jetzt überall wählbar, auch hier.
    expect(treeChoiceFor(view, undefined).trees.find((t) => t.id === 'fir')!.unlocked).toBe(true);
  });
});
