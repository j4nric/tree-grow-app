/**
 * Funde aus dem Playtest (UI): Texte und View-Model für wartende Begegnungen, Pflege-Rang,
 * Legende, Vorschau-Hinweis bei Gästen, Stufen-Banner und weiche Trennstellen.
 */
import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { VISITORS_BY_ID } from '../src/content/visitors';
import { evaluate } from '../src/core/formulas';
import {
  progressHint,
  stageBannerView,
  toCareViews,
  toEcosystemView,
  toEncounterView,
  toEventView,
  toVisitorView,
  visitorPreviewNote,
} from '../src/ui/adapters';
import { SOFT_HYPHEN, hyphenPoints, hyphenate, stripHyphens } from '../src/ui/hyphenate';
import { legendEntries, waitingText } from '../src/ui/view-format';
import type { EncounterView } from '../src/ui/view-model';
import { stateAt } from './helpers';

const show = (text: string) => text.replaceAll(SOFT_HYPHEN, '-');

describe('Wartende Begegnungen in der Seitenleiste', () => {
  it('zeigt „N Begegnungen warten“ statt eines Countdowns, sobald welche warten', () => {
    const state = stateAt(3, ['earthworm'], 1);
    expect(progressHint(state)).toMatch(/^Nächste Begegnung in /);
    state.pendingEncounters = [{ type: 'animal', cards: ['bluetit'], rerolls: 0 }];
    expect(progressHint(state)).toBe('1 Begegnung wartet');
    state.pendingEncounters.push({ type: 'plant', cards: ['moss'], rerolls: 0 });
    const view = toEcosystemView(state, evaluate(state));
    expect(view.progressHint).toBe('2 Begegnungen warten');
    expect(view.progressHint).not.toContain('Nächste Begegnung');
    expect(view.pendingEncounters).toBe(2);
  });

  it('waitingText: Einzahl und Mehrzahl', () => {
    expect(waitingText(1)).toBe('1 Begegnung wartet');
    expect(waitingText(3)).toBe('3 Begegnungen warten');
  });
});

describe('Pflege: Rang eindeutig', () => {
  it('nennt die gekauften Ränge – vor dem Kauf „Rang 0/2“, danach „Rang 1/2“', () => {
    const state = stateAt(3, [], 1);
    state.seeds = 1e6;
    expect(toCareViews(state).find((v) => v.id === 'leaf-litter')!.rank).toBe('Rang 0/2');
    state.cycle.care = { 'leaf-litter': 1 };
    expect(toCareViews(state).find((v) => v.id === 'leaf-litter')!.rank).toBe('Rang 1/2');
    state.cycle.care = { 'leaf-litter': 2 };
    expect(toCareViews(state).find((v) => v.id === 'leaf-litter')!.rank).toBe('voll ausgebaut');
  });
});

describe('Legende: nur Symbole, die im Dialog vorkommen', () => {
  it('Tiere: Harmonie, Zufriedenheit und Bedingungen – keine Versorgung mit Licht und Wasser', () => {
    const state = stateAt(3, ['earthworm'], 1);
    state.pendingEncounters = [{ type: 'animal', cards: ['bluetit', 'oakmoth'], rerolls: 0 }];
    const keys = legendEntries(toEncounterView(state, 0)!).map((e) => e.key);
    expect(keys).toContain('happiness');
    expect(keys).toContain('conditions');
    expect(keys).not.toContain('supply');
    expect(keys).not.toContain('tone');
  });

  it('Ereignis: keine Zufriedenheit und keine Haken, dafür die ▲/▼-Markierung', () => {
    const state = stateAt(4, ['earthworm', 'bee'], 1);
    state.pendingEncounters = [{ type: 'event', cards: ['midsummer'], rerolls: 0 }];
    const view = toEventView(state, 0)!;
    const keys = legendEntries(view).map((e) => e.key);
    expect(keys).not.toContain('happiness');
    expect(keys).not.toContain('conditions');
    expect(keys).toContain('tone');
  });

  it('nichts zu erklären → leer (Legende wird ausgeblendet)', () => {
    const view: EncounterView = {
      kind: 'visitor',
      title: 'Test',
      cards: [
        {
          id: 'farewell',
          name: 'Ziehen lassen',
          family: 'birds',
          familyLabel: 'Vögel',
          familyIcon: '🐦',
          effects: [],
          preview: { harmonyDelta: 0, growthDelta: 0, seedDelta: 0 },
        },
      ],
      rerollCost: null,
      canReroll: false,
      declineReward: null,
    };
    expect(legendEntries(view)).toEqual([]);
  });

  it('feste Samen („+480 🌰 sofort“) gelten nicht als „Samen pro Sekunde“', () => {
    const base: EncounterView = {
      kind: 'event',
      title: 'Test',
      cards: [
        {
          id: 'x',
          name: 'x',
          family: 'event',
          familyLabel: 'x',
          familyIcon: '⛈️',
          effects: [{ label: '+480 🌰 sofort', tone: 'good' }],
          preview: { harmonyDelta: 0, growthDelta: 0, seedDelta: 0 },
        },
      ],
      rerollCost: null,
      canReroll: false,
      declineReward: null,
    };
    expect(legendEntries(base).map((e) => e.key)).toEqual(['tone']);
    base.cards[0]!.effects = [{ label: '+30 % 🌰 für 6 Min.', tone: 'good' }];
    expect(legendEntries(base).map((e) => e.key)).toEqual(['seeds', 'tone']);
  });
});

describe('Gäste: Erklärung, wenn die Vorschau vom Nennwert abweicht', () => {
  it('Bergfinken bei zwei Vögeln im Wald: der dritte Vogel schaltet +15 % Samen frei', () => {
    const state = stateAt(4, ['earthworm', 'robin', 'bluetit'], 1);
    state.pendingEncounters = [{ type: 'visitor', cards: ['bramblings'], rerolls: 0 }];
    const view = toVisitorView(state, 0)!;
    const host = view.cards[0]!;
    expect(host.note).toMatch(/^Vorschau weicht vom Nennwert ab, weil er als Vogel für den Gattungsbonus zählt/);
  });

  it('keine Erklärung, wenn Vorschau und Nennwert übereinstimmen', () => {
    const bramblings = VISITORS_BY_ID.get('bramblings')!;
    const same = { harmonyDelta: 0, growthDelta: 0.12, seedDelta: 0.12 };
    expect(visitorPreviewNote(bramblings, same, same)).toBeNull();
  });

  it('nur Verrechnung mit übrigen Boni (Gattung ändert nichts)', () => {
    const bramblings = VISITORS_BY_ID.get('bramblings')!;
    const p = { harmonyDelta: 0, growthDelta: 0.095, seedDelta: 0.1 };
    expect(visitorPreviewNote(bramblings, p, p)).toBe(
      'Vorschau weicht vom Nennwert ab, weil sich die Wirkung mit Harmonie und deinen übrigen Boni verrechnet.',
    );
  });

  it('beide Gründe in einem Satz', () => {
    const bramblings = VISITORS_BY_ID.get('bramblings')!;
    const text = visitorPreviewNote(
      bramblings,
      { harmonyDelta: 0, growthDelta: 0.095, seedDelta: 0.175 },
      { harmonyDelta: 0, growthDelta: 0.095, seedDelta: 0.1 },
    );
    expect(text).toBe(
      'Vorschau weicht vom Nennwert ab, weil er als Vogel für den Gattungsbonus zählt und sich die Wirkung mit Harmonie und deinen übrigen Boni verrechnet.',
    );
  });
});

describe('Stufen-Banner mit gleichzeitigem Erfolg', () => {
  it('nennt den Erfolg als dritte Zeile im Banner', () => {
    expect(stageBannerView(3)).toEqual({ title: STAGES[3]!.name, text: STAGES[3]!.description, extra: null });
    expect(stageBannerView(3, '🏅 Erfolg: „Ein dünner Stamm“').extra).toBe('🏅 Erfolg: „Ein dünner Stamm“');
    expect(stageBannerView(3, '').extra).toBeNull();
  });
});

describe('Weiche Trennstellen in langen Namen', () => {
  it('trennt lange Namen an Silben, kurze bleiben unverändert', () => {
    expect(show(hyphenate('Buschwindröschen'))).toBe('Busch-wind-rö-schen');
    expect(show(hyphenate('Frauenhaarmoos'))).toBe('Frauen-haar-moos');
    expect(show(hyphenate('Schwarzspecht'))).toBe('Schwarz-specht');
    expect(show(hyphenate('Bienenschwarm'))).toBe('Bie-nen-schwarm');
    expect(show(hyphenate('Nachtflieger'))).toBe('Nacht-flie-ger');
    expect(hyphenate('Rotkehlchen')).toBe('Rotkehlchen');
    expect(hyphenate('Eiche')).toBe('Eiche');
  });

  it('lässt an den Rändern mindestens drei Buchstaben und behält Leer- und Satzzeichen', () => {
    for (const word of ['Taubenschwänzchen', 'Weinbergschnecke', 'Lebensgemeinschaften']) {
      for (const p of hyphenPoints(word)) {
        expect(p).toBeGreaterThanOrEqual(3);
        expect(word.length - p).toBeGreaterThanOrEqual(3);
      }
    }
    expect(show(hyphenate('Kleiner Buschwindröschen-Saum'))).toBe('Kleiner Busch-wind-rö-schen-Saum');
  });

  it('nur für die Anzeige: ohne Trennzeichen wieder der Originalname', () => {
    const name = 'Taubenschwänzchen';
    expect(hyphenate(name)).not.toBe(name);
    expect(stripHyphens(hyphenate(name))).toBe(name);
  });
});
