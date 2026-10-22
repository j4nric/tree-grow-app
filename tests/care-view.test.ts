import { describe, expect, it } from 'vitest';
import { CARE } from '../src/content/care';
import { buyCare } from '../src/core/tick';
import { careBlockerText, careBoughtText, sortCareViews, toCareViews } from '../src/ui/adapters';
import { barWidth, careOrder, carePreviewText, careSummaryText, careTabDot, toCareItemView } from '../src/ui/care-view';
import { formatSignedPercent } from '../src/ui/view-format';
import type { CareView } from '../src/ui/view-model';
import { stateAt } from './helpers';

describe('View: Pflege-Liste', () => {
  it('zeigt nur Maßnahmen ab ihrer Stufe, mit Rang, Kosten, Wirkung und Blocker', () => {
    expect(toCareViews(stateAt(1, [], 1))).toEqual([]);
    // Setzling: nur die kleinen ersten Ränge (Kompost, Laub liegen lassen).
    expect(toCareViews(stateAt(2, [], 1)).map((v) => v.id)).toEqual(CARE.filter((c) => c.ranks[0]!.minStage <= 2).map((c) => c.id));
    const state = stateAt(3, [], 1);
    state.seeds = 500;
    const views = toCareViews(state);
    expect(views.map((v) => v.id)).toEqual(CARE.filter((c) => c.ranks[0]!.minStage <= 3).map((c) => c.id));
    const litter = views.find((v) => v.id === 'leaf-litter')!;
    expect(litter).toMatchObject({ rank: 'Rang 0/2', next: '+1 Platz Laubstreu', cost: '200 🌰', blocker: null, canBuy: true });
    const boxes = views.find((v) => v.id === 'nest-boxes')!;
    expect(boxes).toMatchObject({ cost: '650 🌰', blocker: 'Noch 150 🌰', canBuy: false });
    // Aufgerundet: bei 649,2 Samen fehlt noch mehr als 0 – „Noch 1 🌰“, nie „Noch 0“.
    state.seeds = 649.2;
    expect(toCareViews(state).find((v) => v.id === 'nest-boxes')!.blocker).toBe('Noch 1 🌰');
    state.seeds = 0;
    expect(toCareViews(state).find((v) => v.id === 'nest-boxes')!.blocker).toBe('Noch 650 🌰');
  });

  it('nach dem Kauf: nächster Rang mit Stufen-Blocker, voll ausgebaut ohne Knopf', () => {
    const state = stateAt(4, ['bee'], 1);
    state.seeds = 1e6;
    buyCare(state, 'leaf-litter');
    let litter = toCareViews(state).find((v) => v.id === 'leaf-litter')!;
    expect(litter).toMatchObject({ rank: 'Rang 1/2', blocker: 'Ab Stufe „Hain“', canBuy: false });
    state.stage = 5;
    buyCare(state, 'leaf-litter');
    litter = toCareViews(state).find((v) => v.id === 'leaf-litter')!;
    expect(litter).toMatchObject({ rank: 'voll ausgebaut', next: null, cost: null, blocker: null, canBuy: false, preview: null });
  });

  it('Vorschau mit echten Zahlen; Blocker-Texte für Ausschluss und Bedingung', () => {
    const state = stateAt(4, ['bee', 'earthworm'], 1);
    state.seeds = 1e6;
    const hotel = toCareViews(state).find((v) => v.id === 'insect-hotel')!;
    expect(hotel.preview!.harmonyDelta).toBeCloseTo(3);
    expect(carePreviewText(hotel.preview)).toMatch(/^\+3 ⚖️/);
    expect(carePreviewText(null)).toBe('');
    buyCare(state, 'light-crown');
    expect(toCareViews(state).find((v) => v.id === 'dense-crown')!.blocker).toBe('Verträgt sich nicht mit „Lichte Krone“');
    expect(careBlockerText('requires', 'insect-hotel')).toMatch(/^Braucht /);
  });

  it('Vorschau als kurze Zeile „+3 ⚖️ / +2 % 🌿“, Zahl vor dem Symbol', () => {
    expect(carePreviewText({ harmonyDelta: 3, growthDelta: 0.02, seedDelta: 0 })).toBe(`+3 ⚖️ / ${formatSignedPercent(0.02)} 🌿`);
    expect(carePreviewText({ harmonyDelta: 0, growthDelta: 0, seedDelta: -0.05 })).toBe(`${formatSignedPercent(-0.05)} 🌰`);
    expect(carePreviewText({ harmonyDelta: 0.01, growthDelta: 0, seedDelta: 0 })).toBe('');
  });

  it('Gruppen: kaufbar, zu wenig Samen, gesperrt, voll ausgebaut', () => {
    const state = stateAt(4, ['bee'], 1);
    state.seeds = 2500;
    buyCare(state, 'light-crown'); // 4.000 🌰 – reicht nicht
    state.seeds = 1e6;
    buyCare(state, 'light-crown');
    buyCare(state, 'leaf-litter');
    state.seeds = 1200;
    const group = (id: string) => toCareViews(state).find((v) => v.id === id)!.group;
    expect(group('nest-boxes')).toBe('buyable'); // 650 🌰
    expect(group('pond')).toBe('saving'); // 5.500 🌰
    expect(group('dense-crown')).toBe('locked'); // Ausschluss
    expect(group('light-crown')).toBe('locked'); // Rang 2 erst im Hain
    state.stage = 5;
    state.seeds = 1e6;
    buyCare(state, 'leaf-litter');
    expect(group('leaf-litter')).toBe('maxed');
  });

  it('Sortierung: Gruppen in fester Folge, kaufbare und zu teure nach Kosten', () => {
    const state = stateAt(4, ['bee'], 1);
    state.seeds = 2600;
    const sorted = sortCareViews(toCareViews(state));
    const groups = sorted.map((v) => v.group);
    expect(groups).toEqual([...groups].sort((a, b) => ['buyable', 'saving', 'locked', 'maxed'].indexOf(a) - ['buyable', 'saving', 'locked', 'maxed'].indexOf(b)));
    const buyable = sorted.filter((v) => v.group === 'buyable').map((v) => v.costSeeds!);
    expect(buyable).toEqual([...buyable].sort((a, b) => a - b));
    expect(buyable[0]).toBe(200);
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
    // „a“ gekauft → voll ausgebaut; „d“ ist neu dazugekommen.
    const after = [view('a', 'maxed', null), view('b', 'buyable', 200), view('c', 'saving', 300), view('d', 'buyable', 50)];
    expect(careOrder(after, order, true)).toEqual(['a', 'b', 'c', 'd']);
    expect(careOrder(after, order, false)).toEqual(['d', 'b', 'c', 'a']);
    // Verschwundene Einträge fallen auch beim Festhalten heraus.
    expect(careOrder(after.slice(1), order, true)).toEqual(['b', 'c', 'd']);
  });

  it('Bestätigung nach dem Kauf und Zusammenfassung im Kopf', () => {
    for (const measure of CARE) expect(careBoughtText(measure.id, 1), measure.id).not.toContain('Rang');
    expect(careBoughtText('nest-boxes', 1)).toBe('Nistkästen angebracht');
    expect(careBoughtText('nest-boxes', 2)).toBe('Nistkästen angebracht (Rang 2)');
    expect(careBoughtText('unbekannt', 1)).toBe('unbekannt: Rang 1');
    const state = stateAt(3, [], 1);
    state.seeds = 300;
    const views = toCareViews(state);
    expect(views.find((v) => v.id === 'leaf-litter')!.boughtText).toBe('Laub bleibt liegen');
    expect(careSummaryText(views)).toBe('2 kaufbar'); // Kompost und Laub, je 200 🌰
    state.seeds = 0;
    expect(careSummaryText(toCareViews(state))).toBe('');
    expect(careSummaryText(views.map((v) => ({ ...v, group: 'maxed' as const })))).toBe('alles ausgebaut');
  });

  it('Punkt am Reiter nur, wenn etwas kaufbar ist', () => {
    const state = stateAt(3, [], 1);
    state.seeds = 300;
    expect(careTabDot(toCareViews(state))).toBe(true);
    state.seeds = 0;
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

describe('View: U:Pflegemaßnahme', () => {
  it('Ränge mit Zustand, Kosten und Stufe; Voraussetzungen mit Haken', () => {
    const state = stateAt(4, ['bee'], 1);
    state.seeds = 1e6;
    buyCare(state, 'leaf-litter');
    const view = toCareItemView(state, 'leaf-litter')!;
    expect(view.text).toBe(CARE.find((c) => c.id === 'leaf-litter')!.text);
    expect(view.ranks.map((r) => r.state)).toEqual(['done', 'next']);
    expect(view.ranks[0]).toMatchObject({ rank: 1, cost: '200 🌰', summary: '+1 Platz Laubstreu' });
    expect(view.ranks[1]!.stage).toBe('ab Hain');
    // Rang 2 erst im Hain: Stufe fehlt, Samen reichen.
    expect(view.requirements).toEqual([
      { key: 'stage', met: false, text: 'Stufe „Hain“' },
      { key: 'seeds', met: true, text: '7.000 🌰' },
    ]);
    expect(view.item).toMatchObject({ id: 'leaf-litter', group: 'locked' });
  });

  it('Ausschluss, Bedingung und fehlende Samen', () => {
    const state = stateAt(4, [], 1);
    state.seeds = 1e6;
    buyCare(state, 'light-crown');
    const dense = toCareItemView(state, 'dense-crown')!;
    expect(dense.requirements.find((r) => r.key === 'excludes:light-crown')).toEqual({ key: 'excludes:light-crown', met: false, text: 'nicht zusammen mit „Lichte Krone“' });
    const hotel = toCareItemView(state, 'insect-hotel')!;
    const needs = hotel.requirements.filter((r) => r.key.startsWith('requires:'));
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.every((r) => !r.met && r.text.startsWith('braucht '))).toBe(true);
    state.seeds = 100;
    const boxes = toCareItemView(state, 'nest-boxes')!;
    expect(boxes.requirements.find((r) => r.key === 'seeds')).toEqual({ key: 'seeds', met: false, text: '650 🌰 (noch 550 🌰)' });
  });

  it('voll ausgebaut: keine Voraussetzungen; unbekannt oder noch nicht dran: null', () => {
    const state = stateAt(5, [], 1);
    state.seeds = 1e6;
    buyCare(state, 'compost');
    const compost = toCareItemView(state, 'compost')!;
    expect(compost.item.group).toBe('maxed');
    expect(compost.requirements).toEqual([]);
    expect(compost.ranks.every((r) => r.state === 'done')).toBe(true);
    expect(toCareItemView(state, 'gibt-es-nicht')).toBeNull();
    expect(toCareItemView(stateAt(1, [], 1), 'compost')).toBeNull();
  });
});
