import { describe, expect, it } from 'vitest';
import { CARE } from '../src/content/care';
import { buyCare } from '../src/core/tick';
import { careBlockerText, toCareViews } from '../src/ui/adapters';
import { carePreviewText } from '../src/ui/care-panel';
import { stateAt } from './helpers';

describe('View: Pflege-Liste', () => {
  it('zeigt nur Maßnahmen ab ihrer Stufe, mit Rang, Kosten, Wirkung und Blocker', () => {
    expect(toCareViews(stateAt(2, [], 1))).toEqual([]);
    const state = stateAt(3, [], 1);
    state.seeds = 650;
    const views = toCareViews(state);
    expect(views.map((v) => v.id)).toEqual(CARE.filter((c) => c.ranks[0]!.minStage <= 3).map((c) => c.id));
    const litter = views.find((v) => v.id === 'leaf-litter')!;
    expect(litter).toMatchObject({ rank: 'Rang 1/2', next: '+1 Platz Laubstreu', cost: '600 🌰', blocker: null, canBuy: true });
    const boxes = views.find((v) => v.id === 'nest-boxes')!;
    expect(boxes).toMatchObject({ cost: '900 🌰', blocker: 'Nicht genug Samen', canBuy: false });
  });

  it('nach dem Kauf: nächster Rang mit Stufen-Blocker, voll ausgebaut ohne Knopf', () => {
    const state = stateAt(4, ['bee'], 1);
    state.seeds = 1e6;
    buyCare(state, 'leaf-litter');
    let litter = toCareViews(state).find((v) => v.id === 'leaf-litter')!;
    expect(litter).toMatchObject({ rank: 'Rang 2/2', blocker: 'Ab Stufe „Hain“', canBuy: false });
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
    expect(carePreviewText(hotel.preview)).toContain('⚖️ +3');
    expect(carePreviewText(null)).toBe('');
    buyCare(state, 'light-crown');
    expect(toCareViews(state).find((v) => v.id === 'dense-crown')!.blocker).toBe('Verträgt sich nicht mit „Lichte Krone“');
    expect(careBlockerText('requires', 'insect-hotel')).toMatch(/^Braucht /);
  });
});
