import { describe, expect, it } from 'vitest';
import { COMMUNITIES } from '../src/content/communities';
import { MEMORY_PER_REGULAR_SLOT, V1_KEEPSAKE_ID } from '../src/content/memory';
import { PLANTS } from '../src/content/plants';
import { COMMON_SPECIES, KENNARTEN, SPECIES } from '../src/content/species';
import { evaluate } from '../src/core/formulas';
import { toJournalView } from '../src/ui/adapters';
import { stateAt } from './helpers';

/** Alles, was im View steht, als Text – für Spoiler-Prüfungen. */
const allText = (value: unknown) => JSON.stringify(value);

describe('Kennarten im Naturtagebuch (26.3): erst mit der Landschaft', () => {
  it('vorher weder Silhouette noch Zähler noch Name; danach als Silhouette, entdeckt mit Namen', () => {
    const state = stateAt(5);
    const before = toJournalView(state, evaluate(state));
    expect(before.species).toHaveLength(COMMON_SPECIES.length);
    expect(before.tabCounts.species).toBe(`0/${COMMON_SPECIES.length}`);
    for (const k of KENNARTEN) expect(allText(before), k.name).not.toContain(k.name);
    // Landschaft frei: Urwald-Erfolg und genug Gedächtnis im Heimatwald.
    state.meta.achievements.push('ancient-forest');
    state.meta.forestMemory = 300;
    state.meta.journal.species.push('dormouse');
    const after = toJournalView(state, evaluate(state));
    expect(after.species).toHaveLength(SPECIES.length);
    expect(after.tabCounts.species).toBe(`1/${SPECIES.length}`);
    expect(after.species[SPECIES.findIndex((s) => s.id === 'dormouse')]).toMatchObject({ discovered: true, name: 'Haselmaus' });
    expect(after.species[SPECIES.findIndex((s) => s.id === 'beaver')]).toMatchObject({ discovered: false, name: '???' });
  });
});

describe('toJournalView (Naturtagebuch)', () => {
  it('Start: alles unentdeckt, Zähler 0/51 · 0/14 · 0/15, keine Namen und keine IDs', () => {
    const state = stateAt(0);
    const view = toJournalView(state, evaluate(state));
    expect(view.counts).toBe('0/51 Arten · 0/14 Pflanzen · 0/15 Gemeinschaften');
    expect(view.meta).toBe('Zyklus 1 · Waldgedächtnis 0');
    expect(view.regulars).toBeNull();
    // Vor der Landschaft ohne die Kennarten (DESIGN_V2.md 26.3): sie stehen hinten in SPECIES.
    expect(view.species).toHaveLength(COMMON_SPECIES.length);
    expect(SPECIES.slice(COMMON_SPECIES.length)).toEqual(KENNARTEN);
    expect(view.plants).toHaveLength(PLANTS.length);
    expect(view.communities).toHaveLength(COMMUNITIES.length);
    expect(view.keepsakes).toEqual([]);
    expect(view.tabCounts).toEqual({ species: '0/51', plants: '0/14', communities: '0/15', keepsakes: '1', achievements: '0/30', stats: '' });

    const text = allText(view);
    for (const sp of SPECIES) {
      expect(text, sp.name).not.toContain(`"${sp.name}"`);
      expect(text, sp.id).not.toContain(`"${sp.id}"`);
    }
    for (const p of PLANTS) expect(text, p.name).not.toContain(p.name);
    for (const c of COMMUNITIES) expect(text, c.name).not.toContain(c.name);
    // Unentdeckte: „???“, Seltenheit bleibt als Rahmen, Gemeinschaften mit Rätselhinweis.
    expect(view.species.every((e) => e.name === '???' && !e.discovered && !e.text && !e.regular)).toBe(true);
    expect(view.species.find((e) => e.rarity === 'legendary')!.facts).toEqual(['legendär']);
    expect(view.communities[0]).toMatchObject({ name: '???', discovered: false, hint: COMMUNITIES[0]!.hint });
    expect(view.communities[0]!.members).toBeUndefined();
  });

  it('entdeckte Arten und Pflanzen mit Gattung, Seltenheit, Nische und „lebt gerade hier“', () => {
    const state = stateAt(3, ['bluetit']);
    state.meta.journal.species.push('woodpecker'); // entdeckt, lebt aber nicht hier
    state.meta.journal.plants.push('hazel');
    state.plants = ['hazel'];
    const view = toJournalView(state, evaluate(state));
    expect(view.counts).toBe('2/51 Arten · 1/14 Pflanzen · 0/15 Gemeinschaften');
    const tit = view.species.find((e) => e.key === 'bluetit')!;
    expect(tit).toMatchObject({ name: 'Blaumeise', icon: '🐦', family: 'birds', rarity: 'common', discovered: true, present: true });
    expect(tit.facts).toEqual(['Vögel', 'gewöhnlich', 'Nische: Krone']);
    expect(tit.text).toBeTruthy();
    expect(view.species.find((e) => e.key === 'woodpecker')!.present).toBe(false);
    const hazel = view.plants.find((e) => e.key === 'hazel')!;
    expect(hazel).toMatchObject({ name: 'Hasel', family: 'shrubs', present: true });
    expect(hazel.facts[0]).toBe('Sträucher');
    // Ohne Waldgedächtnis keine Stammgast-Plätze → kein Schalter.
    expect(tit.regular).toBeUndefined();
  });

  it('Stammgäste: Schalter an entdeckten Arten, voll → gesperrt (abwählen geht immer)', () => {
    const state = stateAt(3, ['bluetit', 'robin']);
    state.meta.forestMemory = MEMORY_PER_REGULAR_SLOT; // 1 Platz
    state.meta.regulars = ['bluetit'];
    const view = toJournalView(state, evaluate(state));
    expect(view.regulars).toMatch(/^Stammgäste 1\/1/);
    expect(view.meta).toBe('Zyklus 1 · Waldgedächtnis 25 (+25 % Wachstum und Samen)');
    expect(view.species.find((e) => e.key === 'bluetit')!.regular).toEqual({ selected: true, disabled: false });
    expect(view.species.find((e) => e.key === 'robin')!.regular).toEqual({ selected: false, disabled: true });
    // Unentdeckte bekommen nie einen Schalter.
    expect(view.species.filter((e) => !e.discovered).every((e) => e.regular === undefined)).toBe(true);
  });

  it('Lebensgemeinschaften: entdeckte mit Mitgliedern, Wirkung und „besteht gerade“', () => {
    const state = stateAt(3, ['earthworm', 'woodlouse', 'chanterelle']);
    state.meta.journal.communities = ['humus', 'damp-ground'];
    const view = toJournalView(state, evaluate(state));
    expect(view.counts).toContain('2/15 Gemeinschaften');
    expect(view.communities.find((c) => c.key === 'humus')).toEqual({
      key: 'humus',
      discovered: true,
      icon: '🪱',
      name: 'Humusküche',
      active: true,
      members: 'Regenwurm, Rollassel, Pfifferling oder Steinpilz',
      effect: '+8 Harmonie · +5 % 🌿',
    });
    expect(view.communities.find((c) => c.key === 'damp-ground')).toMatchObject({
      name: 'Feuchter Grund',
      active: false,
      progress: '0/3 Mitglieder',
    });
    expect(view.communities.filter((c) => !c.discovered)).toHaveLength(13);
  });

  it('Fortschritt „x/y“ auch bei unentdeckten Gemeinschaften (wie in der Seitenleiste)', () => {
    // Raupenwacht 2/3 (Eichenwickler, Blaumeise), noch nicht entdeckt.
    const state = stateAt(3, ['oakmoth', 'bluetit']);
    const view = toJournalView(state, evaluate(state));
    const watch = view.communities[COMMUNITIES.findIndex((c) => c.id === 'caterpillar-watch')]!;
    expect(watch).toMatchObject({ discovered: false, name: '???', progress: '2/3 Mitglieder' });
    expect(watch.hint).toBe('Tags und nachts wird die Krone bewacht.');
    expect(view.communities.every((c) => c.progress !== undefined)).toBe(true);
  });

  it('Andenken „Die alte Eiche“ und unbekannte Andenken neutral', () => {
    const state = stateAt(0);
    state.meta.journal.keepsakes = [V1_KEEPSAKE_ID, 'mystery'];
    const view = toJournalView(state, evaluate(state));
    expect(view.tabCounts.keepsakes).toBe('3'); // 2 Erinnerungen + Stieleiche
    expect(view.keepsakes[0]).toMatchObject({ key: 'old-oak', name: 'Die alte Eiche', icon: '🌳' });
    expect(view.keepsakes[0]!.text).toContain('+5 Waldgedächtnis');
    expect(view.keepsakes[1]).toEqual({ key: 'mystery', icon: '🎁', name: 'Andenken', text: '' });
  });

  it('Zyklus-Nummer steht in der Kopfzeile', () => {
    const state = stateAt(0);
    state.cycle.number = 3;
    expect(toJournalView(state, evaluate(state)).meta).toMatch(/^Zyklus 3 · /);
  });
});
