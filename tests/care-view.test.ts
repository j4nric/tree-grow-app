import { describe, expect, it } from 'vitest';
import { RESEARCH, RESEARCH_BY_ID } from '../src/content/research';
import { research } from '../src/core/tick';
import { researchBlockerText, sortCareViews, toCareViews } from '../src/ui/adapters';
import { barWidth, careOrder, carePreviewText, careSummaryText, careTabDot, harmonyWalletText, toCareItemView } from '../src/ui/care-view';
import { formatSignedPercent } from '../src/ui/view-format';
import type { CareView } from '../src/ui/view-model';
import { stateAt } from './helpers';

/*
 * Reiter „Pflege“: seit Spielstand v17 eine flache Notliste der Forschung (DESIGN_V2.md 27.7,
 * Phase 10, 2a); der Baum mit Ästen und Gabeln folgt in Phase 10, 4a.
 */

describe('View: Forschungs-Notliste', () => {
  it('wiederholbare Knoten (28.6): Rang am Ast, Kosten des nächsten Rangs, nie „erledigt“ vor Rang 200', () => {
    const state = stateAt(5, ['bee'], 1);
    state.cycle.research = ['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle'];
    state.harmonyPoints = 3_000;
    const row = () => toCareViews(state).find((v) => v.id === 'soil-life')!;
    expect(row()).toMatchObject({ rank: '🪱 Boden · ∞ Rang 0', cost: '1.500 ⚖️', costSeeds: 1_500, canBuy: true, group: 'buyable' });
    expect(research(state, 'soil-life').ok).toBe(true);
    expect(row()).toMatchObject({ rank: '🪱 Boden · ∞ Rang 1', cost: '1.950 ⚖️', canBuy: false, group: 'saving', blocker: 'Noch 450 ⚖️' });
    expect(row().preview!.growthDelta).toBeGreaterThan(0);
    expect(toCareItemView(state, 'soil-life')!.requirements.at(-1)).toMatchObject({ met: false, text: '1.950 ⚖️ (noch 450 ⚖️)' });
    state.cycle.researchRanks = { 'soil-life': 200 };
    expect(row()).toMatchObject({ group: 'maxed', cost: null, canBuy: false });
    expect(researchBlockerText('owned', 'soil-life', state)).toBe('Höchster Rang erreicht');
    // Ohne Gabel gesperrt wie jeder Knoten.
    const fresh = stateAt(5, [], 1);
    expect(toCareViews(fresh).find((v) => v.id === 'soil-life')).toMatchObject({ group: 'locked' });
  });

  it('zeigt nur Knoten ab ihrer Stufe, mit Ast, Kosten in ⚖️, Wirkung und Blocker', () => {
    expect(toCareViews(stateAt(1, [], 1))).toEqual([]);
    // Setzling: nur Kompost und Laub.
    expect(toCareViews(stateAt(2, [], 1)).map((v) => v.id)).toEqual(RESEARCH.filter((n) => n.minStage <= 2).map((n) => n.id));
    const state = stateAt(3, [], 1);
    state.harmonyPoints = 220;
    state.seeds = 1e9; // Samen zählen nicht
    const views = toCareViews(state);
    expect(views.map((v) => v.id)).toEqual(RESEARCH.filter((n) => n.minStage <= 3).map((n) => n.id));
    const litter = views.find((v) => v.id === 'leaf-litter')!;
    expect(litter).toMatchObject({ rank: '🪱 Boden', next: '+1 Platz Laubstreu', cost: '80 ⚖️', costSeeds: 80, blocker: null, canBuy: true });
    const boxes = views.find((v) => v.id === 'nest-boxes')!;
    expect(boxes).toMatchObject({ rank: '🌳 Krone', cost: '250 ⚖️', blocker: 'Noch 30 ⚖️', canBuy: false, group: 'saving' });
    // Aufgerundet: bei 249,2 ⚖️ fehlt noch mehr als 0 – „Noch 1 ⚖️“, nie „Noch 0“.
    state.harmonyPoints = 249.2;
    expect(toCareViews(state).find((v) => v.id === 'nest-boxes')!.blocker).toBe('Noch 1 ⚖️');
    state.harmonyPoints = 0;
    expect(toCareViews(state).find((v) => v.id === 'nest-boxes')!.blocker).toBe('Noch 250 ⚖️');
  });

  it('nach dem Erforschen: „erledigt“ ohne Knopf, Kosten und Vorschau', () => {
    const state = stateAt(4, ['bee'], 1);
    state.harmonyPoints = 1e6;
    research(state, 'leaf-litter');
    const litter = toCareViews(state).find((v) => v.id === 'leaf-litter')!;
    expect(litter).toMatchObject({ group: 'maxed', next: null, cost: null, costSeeds: null, blocker: null, canBuy: false, preview: null, boughtText: null });
    // Der Folgeknoten (Humusschicht, Hain) steht erst ab seiner Stufe in der Liste.
    expect(toCareViews(state).some((v) => v.id === 'humus')).toBe(false);
    state.stage = 5;
    expect(toCareViews(state).find((v) => v.id === 'humus')).toMatchObject({ group: 'locked', blocker: 'Braucht „Kompost“' });
  });

  it('Vorschau mit echten Zahlen; Blocker-Texte für Gabel, Voraussetzung und Bedingung', () => {
    const state = stateAt(4, ['bee', 'earthworm'], 1);
    state.harmonyPoints = 1e6;
    research(state, 'wildflower-hem');
    const hotel = toCareViews(state).find((v) => v.id === 'insect-hotel')!;
    expect(hotel.preview!.harmonyDelta).toBeCloseTo(3);
    expect(carePreviewText(hotel.preview)).toMatch(/^\+3 ⚖️/);
    expect(carePreviewText(null)).toBe('');
    research(state, 'nest-boxes');
    research(state, 'light-crown');
    expect(toCareViews(state).find((v) => v.id === 'dense-crown')!.blocker).toBe('Anderer Weg gewählt: „Lichte Krone“');
    const empty = stateAt(4, [], 1);
    expect(researchBlockerText('requires', 'insect-hotel', empty)).toBe('Braucht „Wildblumen-Saum“');
    expect(researchBlockerText('condition', 'insect-hotel', empty)).toMatch(/^Braucht /);
    expect(researchBlockerText('requires', 'insect-hotel-3', empty)).toBe('Braucht „Blütenvorrat“ oder „Wildbienenwand“');
    expect(researchBlockerText('stage', 'humus', empty)).toBe('Ab Stufe „Hain“');
    expect(researchBlockerText('owned', 'humus', empty)).toBe('Schon erforscht');
    expect(researchBlockerText('unknown-node', 'nope', empty)).toBe('Diesen Knoten gibt es nicht');
  });

  it('Vorschau als kurze Zeile „+3 ⚖️ / +2 % 🌿“, Zahl vor dem Symbol', () => {
    expect(carePreviewText({ harmonyDelta: 3, growthDelta: 0.02, seedDelta: 0 })).toBe(`+3 ⚖️ / ${formatSignedPercent(0.02)} 🌿`);
    expect(carePreviewText({ harmonyDelta: 0, growthDelta: 0, seedDelta: -0.05 })).toBe(`${formatSignedPercent(-0.05)} 🌰`);
    expect(carePreviewText({ harmonyDelta: 0.01, growthDelta: 0, seedDelta: 0 })).toBe('');
  });

  it('Gruppen: erforschbar, zu wenig ⚖️, gesperrt, erforscht', () => {
    const state = stateAt(4, ['bee'], 1);
    state.harmonyPoints = 1e6;
    research(state, 'nest-boxes');
    research(state, 'light-crown');
    research(state, 'leaf-litter');
    state.harmonyPoints = 600;
    const group = (id: string) => toCareViews(state).find((v) => v.id === id)!.group;
    expect(group('compost')).toBe('buyable'); // 100 ⚖️
    expect(group('deadwood-pile')).toBe('buyable'); // 600 ⚖️
    expect(group('hem-wide')).toBe('locked'); // braucht Wildblumen-Saum
    expect(group('dense-crown')).toBe('locked'); // anderer Weg
    expect(group('light-crown')).toBe('maxed');
    state.harmonyPoints = 100;
    expect(group('wildflower-hem')).toBe('saving'); // 300 ⚖️
  });

  it('Sortierung: Gruppen in fester Folge, erforschbare und zu teure nach Kosten', () => {
    const state = stateAt(4, ['bee'], 1);
    state.harmonyPoints = 400;
    const sorted = sortCareViews(toCareViews(state));
    const order = ['buyable', 'saving', 'locked', 'maxed'];
    const groups = sorted.map((v) => v.group);
    expect(groups).toEqual([...groups].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    const buyable = sorted.filter((v) => v.group === 'buyable').map((v) => v.costSeeds!);
    expect(buyable).toEqual([...buyable].sort((a, b) => a - b));
    expect(buyable[0]).toBe(80);
    const saving = sorted.filter((v) => v.group === 'saving').map((v) => v.costSeeds!);
    expect(saving).toEqual([...saving].sort((a, b) => a - b));
  });

  it('Reihenfolge bleibt stehen, solange die Liste festgehalten ist', () => {
    const view = (id: string, group: CareView['group'], costSeeds: number | null): CareView => ({
      id, icon: '', name: id, rank: '', next: null, cost: null, costSeeds, blocker: null,
      canBuy: group === 'buyable', group, boughtText: null, preview: null,
    });
    const before = [view('a', 'buyable', 100), view('b', 'buyable', 200), view('c', 'saving', 300)];
    const order = careOrder(before, [], false);
    expect(order).toEqual(['a', 'b', 'c']);
    // „a“ erforscht; „d“ ist neu dazugekommen.
    const after = [view('a', 'maxed', null), view('b', 'buyable', 200), view('c', 'saving', 300), view('d', 'buyable', 50)];
    expect(careOrder(after, order, true)).toEqual(['a', 'b', 'c', 'd']);
    expect(careOrder(after, order, false)).toEqual(['d', 'b', 'c', 'a']);
    expect(careOrder(after.slice(1), order, true)).toEqual(['b', 'c', 'd']);
  });

  it('Bestätigung nach dem Erforschen, Zusammenfassung und Vorrat im Kopf', () => {
    const state = stateAt(3, ['earthworm', 'bluetit'], 1);
    state.harmonyPoints = 200;
    const views = toCareViews(state);
    expect(views.find((v) => v.id === 'leaf-litter')!.boughtText).toBe(RESEARCH_BY_ID.get('leaf-litter')!.boughtText);
    // Kompost (100), Laub (80), Saatgut sortieren (200).
    expect(careSummaryText(views)).toBe('3 erforschbar');
    state.harmonyPoints = 0;
    expect(careSummaryText(toCareViews(state))).toBe('');
    expect(careSummaryText(views.map((v) => ({ ...v, group: 'maxed' as const })))).toBe('alles erforscht');
    state.harmonyPoints = 1234.9;
    expect(harmonyWalletText(state, { harmony: 60 })).toBe('⚖️ 1.234 · +60/min');
    state.meta.forestMemory = 100; // Gedächtnisfaktor ×2 auf den Zufluss
    expect(harmonyWalletText(state, { harmony: 60 })).toBe('⚖️ 1.234 · +120/min');
    state.harmonyPoints = Number.NaN;
    expect(harmonyWalletText(state, { harmony: -5 })).toBe('⚖️ 0 · +0/min');
  });

  it('Punkt am Reiter nur, wenn etwas erforschbar ist', () => {
    const state = stateAt(3, [], 1);
    state.harmonyPoints = 300;
    expect(careTabDot(toCareViews(state))).toBe(true);
    state.harmonyPoints = 0;
    expect(careTabDot(toCareViews(state))).toBe(false);
    expect(careTabDot([])).toBe(false);
  });

  it('Balkenbreite: begrenzt auf 0–100 %, eine Nachkommastelle', () => {
    expect(barWidth(0.5)).toBe('50%');
    expect(barWidth(0.12345)).toBe('12.3%');
    expect(barWidth(2)).toBe('100%');
    expect(barWidth(-1)).toBe('0%');
    expect(barWidth(Number.NaN)).toBe('0%');
  });
});

describe('View: U:Pflegemaßnahme (Forschungsknoten)', () => {
  it('Voraussetzungen mit Haken: Stufe, Knoten, Vorrat', () => {
    const state = stateAt(5, ['bee'], 1);
    state.harmonyPoints = 1e6;
    research(state, 'leaf-litter');
    state.harmonyPoints = 500;
    const view = toCareItemView(state, 'humus')!;
    expect(view.text).toBe(RESEARCH_BY_ID.get('humus')!.text);
    expect(view.ranks).toEqual([]);
    expect(view.requirements).toEqual([
      { key: 'stage', met: true, text: 'Stufe „Hain“' },
      { key: 'requires:compost', met: false, text: 'erforscht „Kompost“' },
      { key: 'requires:leaf-litter', met: true, text: 'erforscht „Laub liegen lassen“' },
      { key: 'harmony', met: true, text: '430 ⚖️' },
    ]);
    expect(view.item).toMatchObject({ id: 'humus', group: 'locked' });
  });

  it('Gabel, `requiresAny`, Bedingung und fehlende ⚖️', () => {
    const state = stateAt(6, [], 1);
    state.harmonyPoints = 1e6;
    research(state, 'nest-boxes');
    research(state, 'light-crown');
    const dense = toCareItemView(state, 'dense-crown')!;
    expect(dense.requirements.find((r) => r.key.startsWith('excludes:'))).toEqual({ key: 'excludes:light-crown', met: false, text: 'nicht zusammen mit „Lichte Krone“' });
    research(state, 'wildflower-hem');
    const hotel = toCareItemView(state, 'insect-hotel')!;
    const needs = hotel.requirements.filter((r) => r.key.startsWith('condition:'));
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.every((r) => !r.met && r.text.startsWith('braucht '))).toBe(true);
    const big = toCareItemView(state, 'insect-hotel-3')!;
    expect(big.requirements.find((r) => r.key === 'requires-any')).toEqual({
      key: 'requires-any',
      met: false,
      text: 'erforscht „Blütenvorrat“ oder „Wildbienenwand“',
    });
    state.harmonyPoints = 100;
    const pond = toCareItemView(state, 'compost')!;
    expect(pond.requirements.find((r) => r.key === 'harmony')).toEqual({ key: 'harmony', met: true, text: '100 ⚖️' });
    const boxes = toCareItemView(state, 'meadow')!;
    expect(boxes.requirements.find((r) => r.key === 'harmony')).toEqual({ key: 'harmony', met: false, text: '600 ⚖️ (noch 500 ⚖️)' });
  });

  it('erforscht: keine Voraussetzungen; unbekannt oder noch nicht dran: null', () => {
    const state = stateAt(5, [], 1);
    state.harmonyPoints = 1e6;
    research(state, 'compost');
    const compost = toCareItemView(state, 'compost')!;
    expect(compost.item.group).toBe('maxed');
    expect(compost.requirements).toEqual([]);
    expect(toCareItemView(state, 'gibt-es-nicht')).toBeNull();
    expect(toCareItemView(stateAt(1, [], 1), 'compost')).toBeNull();
  });
});
