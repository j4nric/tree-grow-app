import { describe, expect, it } from 'vitest';
import { CARE, CARE_BY_ID } from '../src/content/care';
import { appearsContext, ecosystemOf, evaluate } from '../src/core/formulas';
import { deserialize, serialize } from '../src/core/save';
import { SAVE_VERSION, createCycle, type GameState } from '../src/core/state';
import { buyCare, careBlocker, careRank, nextCareRank, previewCare, simulateOffline, startNewCycle, tick } from '../src/core/tick';
import { stateAt } from './helpers';

/** Spielstand mit genug Samen für alles. */
function rich(stage: number, animals: string[] = [], seed = 1): GameState {
  const state = stateAt(stage, animals, seed);
  state.seeds = 1e6;
  return state;
}

describe('Pflege: Blocker', () => {
  it('in der festgelegten Reihenfolge', () => {
    const state = stateAt(3, [], 1);
    expect(careBlocker(state, 'nope')).toBe('unknown-care');
    expect(careBlocker(state, 'pond')).toBe('stage'); // Waldtümpel ab Alter Baum
    expect(careBlocker(state, 'nest-boxes')).toBe('too-expensive');
    state.seeds = CARE_BY_ID.get('nest-boxes')!.ranks[0]!.cost;
    expect(careBlocker(state, 'nest-boxes')).toBeNull();
    // Insektenhotel braucht ein Insekt.
    const old = rich(4, ['earthworm']);
    expect(careBlocker(old, 'insect-hotel')).toBe('requires');
    expect(careBlocker(rich(4, ['bee']), 'insect-hotel')).toBeNull();
    // Voll ausgebaut
    old.cycle.care['leaf-litter'] = 2;
    expect(careBlocker(old, 'leaf-litter')).toBe('maxed');
    // Zweiter Rang erst ab seiner Stufe
    old.cycle.care['nest-boxes'] = 1;
    expect(careBlocker(old, 'nest-boxes')).toBe('stage');
  });

  it('Lichte und Dichte Krone schließen sich aus', () => {
    const state = rich(4);
    expect(buyCare(state, 'light-crown').ok).toBe(true);
    expect(careBlocker(state, 'dense-crown')).toBe('excluded');
    expect(buyCare(state, 'dense-crown')).toEqual({ ok: false, error: 'excluded' });
    // Die eigene Maßnahme geht weiter (nächster Rang ab Hain).
    expect(careBlocker(state, 'light-crown')).toBe('stage');
  });
});

describe('Pflege: Kauf und Wirkung', () => {
  it('zieht genau die Kosten ab und erhöht den Rang', () => {
    const state = stateAt(3, [], 1);
    state.seeds = 1000;
    const result = buyCare(state, 'leaf-litter');
    expect(result).toEqual({ ok: true, seeds: -200 });
    expect(state.seeds).toBe(800);
    expect(careRank(state, 'leaf-litter')).toBe(1);
    expect(state.cycle.care).toEqual({ 'leaf-litter': 1 });
    expect(nextCareRank(state, 'leaf-litter')).toBe(CARE_BY_ID.get('leaf-litter')!.ranks[1]);
  });

  it('Wirkungen addieren sich über die Ränge (Lichte Krone: +3, +2, +2 ☀️)', () => {
    const state = rich(6);
    const base = evaluate(state).light;
    buyCare(state, 'light-crown');
    expect(evaluate(state).light).toBeCloseTo(base + 3);
    buyCare(state, 'light-crown');
    buyCare(state, 'light-crown');
    expect(evaluate(state).light).toBeCloseTo(base + 7);
    expect(careBlocker(state, 'light-crown')).toBe('maxed');
  });

  it('negative Lichtwirkung (Dichte Krone) – Licht fällt nie unter 0', () => {
    const state = rich(4);
    const base = evaluate(state).light;
    buyCare(state, 'dense-crown');
    const after = evaluate(state);
    expect(after.light).toBeCloseTo(Math.max(0, base - 2));
    expect(after.slots.crown).toBe(evaluate(rich(4)).slots.crown + 1);
    const dark = rich(4);
    dark.cycle.care['dense-crown'] = 1;
    dark.stage = 0; // Samen: 0 Licht
    expect(evaluate(dark).light).toBe(0);
  });

  it('Nistkästen öffnen Höhlen schon im Jungen Baum und bringen das Merkmal Baumhöhle', () => {
    const state = rich(3);
    expect(evaluate(state).slots.hollows).toBe(0);
    expect(appearsContext(ecosystemOf(state)).tags.has('hoehle')).toBe(false);
    buyCare(state, 'nest-boxes');
    expect(evaluate(state).slots.hollows).toBe(1);
    expect(appearsContext(ecosystemOf(state)).tags.has('hoehle')).toBe(true);
  });

  it('Gruppen- und Harmonie-Wirkungen; die Bedingung gilt nur beim Kauf', () => {
    const state = rich(4, ['bee', 'earthworm']);
    const before = evaluate(state).harmony;
    buyCare(state, 'insect-hotel');
    expect(evaluate(state).harmony).toBeCloseTo(before + 3);
    // Biene weg: die Wirkung bleibt.
    state.niches.edge = [];
    const without = evaluate(state).harmony;
    state.cycle.care = {};
    expect(evaluate(state).harmony).toBeCloseTo(without - 3);
  });

  it('Kauf führt H_max nach; Vorschau = Zustand nach dem Kauf', () => {
    const state = rich(4, ['bee', 'earthworm']);
    const preview = previewCare(state, 'insect-hotel')!;
    buyCare(state, 'insect-hotel');
    expect(evaluate(state).harmony).toBeCloseTo(preview.harmony);
    expect(state.cycle.maxHarmony).toBeGreaterThanOrEqual(preview.harmony - 1e-9);
    expect(previewCare(state, 'nope')).toBeNull();
    state.cycle.care['leaf-litter'] = 2;
    expect(previewCare(state, 'leaf-litter')).toBeNull();
  });

  it('Neuer Zyklus setzt die Pflege zurück', () => {
    const state = rich(5, ['earthworm']);
    buyCare(state, 'leaf-litter');
    startNewCycle(state, 0);
    expect(state.cycle.care).toEqual({});
    expect(state.cycle).toEqual({ ...createCycle(2, 0), maxHarmony: state.cycle.maxHarmony });
  });

  it('Pflege wirkt dauerhaft: nichts läuft ab, online gleich offline', () => {
    const online = rich(5, ['earthworm', 'robin', 'bee'], 77);
    online.seeds = 50_000;
    for (const m of CARE) while (buyCare(online, m.id).ok) {
      // alles kaufen, was geht
    }
    const offline = structuredClone(online);
    for (let i = 0; i < 3600; i++) tick(online, 1);
    simulateOffline(offline, 3600);
    expect(offline.cycle.care).toEqual(online.cycle.care);
    expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
    expect(offline.rngState).toBe(online.rngState);
    expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, 4);
  });
});

describe('Pflege: Speichern und Laden (additiv in v5)', () => {
  it('Ränge überstehen Speichern und Laden; Cache sieht die Wirkung', () => {
    const state = rich(4, ['bee']);
    buyCare(state, 'pond');
    buyCare(state, 'insect-hotel');
    const loaded = deserialize(serialize(state), 0)!;
    expect(loaded.cycle.care).toEqual({ pond: 1, 'insect-hotel': 1 });
    expect(evaluate(loaded)).toEqual(evaluate(state));
  });

  it('v5-Stand ohne `care`: leeres Objekt (Pflege kam ohne neue Version)', () => {
    const raw = JSON.parse(serialize(stateAt(4, ['bee'], 1)));
    raw.version = 5;
    delete raw.cycle.care;
    delete raw.cycle.elapsed;
    delete raw.cycle.mainTree;
    const s = deserialize(JSON.stringify(raw), 0)!;
    // Geladen wird als aktuelle Version, Pflege bleibt leer.
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.cycle.care).toEqual({});
  });

  it('kaputte Ränge: begrenzt oder verworfen', () => {
    const raw = JSON.parse(serialize(stateAt(4, [], 1)));
    raw.cycle.care = { pond: 99, 'leaf-litter': 1.7, nope: 1, 'nest-boxes': -3, 'light-crown': 'zwei', 'dense-crown': NaN };
    // Alter Baum (Stufe 4): Waldtümpel Rang 2 gibt es erst ab Stufe 5 → Rang 1.
    expect(deserialize(JSON.stringify(raw), 0)!.cycle.care).toEqual({ pond: 1, 'leaf-litter': 1 });
    for (const care of [null, [1, 2], 'x']) {
      raw.cycle.care = care;
      expect(deserialize(JSON.stringify(raw), 0)!.cycle.care).toEqual({});
    }
  });

  it('Rang über der Stufe: auf den höchsten erlaubten Rang gekappt', () => {
    const raw = JSON.parse(serialize(stateAt(5, [], 1)));
    // Stufe 5: Lichte Krone Rang 3 erst ab 6; Insektenhotel 3 → 2; Totholz Rang 1 ab 4.
    raw.cycle.care = { 'light-crown': 3, 'insect-hotel': 3, 'deadwood-pile': 2 };
    expect(deserialize(JSON.stringify(raw), 0)!.cycle.care).toEqual({ 'light-crown': 2, 'insect-hotel': 2, 'deadwood-pile': 2 });
    // Unter der Freischalt-Stufe (Junger Baum = 3): Maßnahmen ab Alter Baum fallen weg.
    const young = JSON.parse(serialize(stateAt(3, [], 1)));
    young.cycle.care = { pond: 2, 'leaf-litter': 2, 'wildflower-hem': 3 };
    expect(deserialize(JSON.stringify(young), 0)!.cycle.care).toEqual({ 'leaf-litter': 1, 'wildflower-hem': 1 });
  });

  it('beide Kronen: nur die erste in CARE-Reihenfolge bleibt', () => {
    const raw = JSON.parse(serialize(stateAt(6, [], 1)));
    // Reihenfolge im JSON egal – maßgeblich ist CARE (Lichte vor Dichte Krone).
    raw.cycle.care = { 'dense-crown': 3, 'light-crown': 1 };
    expect(deserialize(JSON.stringify(raw), 0)!.cycle.care).toEqual({ 'light-crown': 1 });
    // Ungültige Lichte Krone verdrängt die Dichte nicht.
    raw.cycle.care = { 'dense-crown': 2, 'light-crown': 0 };
    expect(deserialize(JSON.stringify(raw), 0)!.cycle.care).toEqual({ 'dense-crown': 2 });
    const idx = (id: string) => CARE.findIndex((m) => m.id === id);
    expect(idx('light-crown')).toBeLessThan(idx('dense-crown'));
  });

  it('`requires` wird beim Laden nicht geprüft (gilt nur beim Kauf)', () => {
    const raw = JSON.parse(serialize(stateAt(4, [], 1))); // kein Insekt
    raw.cycle.care = { 'insect-hotel': 1 };
    expect(deserialize(JSON.stringify(raw), 0)!.cycle.care).toEqual({ 'insect-hotel': 1 });
  });

  it('unmögliche Pflege lässt H_max nicht künstlich steigen', () => {
    const base = stateAt(4, ['bee', 'earthworm'], 1);
    const raw = JSON.parse(serialize(base));
    raw.cycle.maxHarmony = 0;
    const legit = structuredClone(raw);
    legit.cycle.care = { 'insect-hotel': 1, 'leaf-litter': 1, pond: 1 };
    raw.cycle.care = { 'insect-hotel': 3, 'leaf-litter': 2, pond: 2, 'deadwood-pile': 0 };
    const cheated = deserialize(JSON.stringify(raw), 0)!;
    const fair = deserialize(JSON.stringify(legit), 0)!;
    expect(cheated.cycle.care).toEqual(fair.cycle.care);
    expect(fair.cycle.maxHarmony).toBeGreaterThan(0);
    expect(cheated.cycle.maxHarmony).toBe(fair.cycle.maxHarmony);
    expect(evaluate(cheated)).toEqual(evaluate(fair));
  });
});
