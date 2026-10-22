import { describe, expect, it } from 'vitest';
import { GENUS_INFO, SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { evaluate } from '../src/core/formulas';
import { toJournalView } from '../src/ui/adapters';
import {
  GENUS_ORDER,
  discoveredIn,
  ofCount,
  plantNote,
  silhouetteHint,
  speciesGroups,
  speciesPageHeader,
  speciesPageKey,
  speciesStickerVariant,
} from '../src/ui/album/pages/species-view';
import { stateAt } from './helpers';

/** Reiter „Arten“ (docs/ALBUM_UI.md, B.2): Gruppen, Kennzahlen, Varianten, Hinweise ohne Spoiler. */

describe('Reiter Arten: Gruppen und Zähler', () => {
  it('jede Art steht genau einmal in ihrer Gattung, Gattungen in fester Reihenfolge', () => {
    const groups = speciesGroups();
    const all = groups.flatMap((g) => g.indices);
    expect(all.length).toBe(SPECIES.length);
    expect(new Set(all).size).toBe(SPECIES.length);
    for (const g of groups) {
      for (const i of g.indices) expect(SPECIES[i]!.genus).toBe(g.genus);
      expect(g.label).toBe(GENUS_INFO[g.genus].name);
    }
    const order = groups.map((g) => GENUS_ORDER.indexOf(g.genus));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('Kennzahlen im deutschen Format, Einzahl bei genau einer Art', () => {
    expect(speciesPageHeader(23, 53)).toBe('23 von 53 Arten');
    expect(speciesPageHeader(0, 1)).toBe('0 von 1 Art');
    expect(speciesPageHeader(1234, 2000)).toBe('1.234 von 2.000 Arten');
    expect(ofCount(3, 8)).toBe('3 von 8');
  });

  it('zählt entdeckte Arten je Gattung aus der Tagebuch-Ansicht', () => {
    const state = stateAt(6, ['bluetit', 'robin', 'earthworm']);
    const view = toJournalView(state, evaluate(state));
    const birds = speciesGroups().find((g) => g.genus === 'birds')!;
    expect(discoveredIn(view.species, birds.indices)).toBe(2);
    const soil = speciesGroups().find((g) => g.genus === 'soil')!;
    expect(discoveredIn(view.species, soil.indices)).toBe(1);
  });
});

describe('Reiter Arten: Sticker-Variante', () => {
  it('farbig im Wald, matt entdeckt und abwesend, Silhouette unentdeckt', () => {
    expect(speciesStickerVariant({ discovered: true, present: true })).toBe('color');
    expect(speciesStickerVariant({ discovered: true, present: false })).toBe('muted');
    expect(speciesStickerVariant({ discovered: false, present: false })).toBe('silhouette');
  });
});

describe('Reiter Arten: Hinweise statt Spoiler', () => {
  it('Silhouette nennt Gattung, Seltenheit und Nische, nie Namen oder ID', () => {
    const state = stateAt(1);
    SPECIES.forEach((sp, i) => {
      const hint = silhouetteHint(state, i);
      const text = [hint.title, ...hint.lines].join(' ');
      expect(text).not.toContain(sp.name);
      expect(text).not.toMatch(new RegExp(`\\b${sp.id}\\b`));
      expect(text).toContain(GENUS_INFO[sp.genus].name);
    });
  });

  it('nennt die Stufe, solange sie nicht erreicht ist, danach Bedingungen bzw. „halte die Augen offen“', () => {
    const i = SPECIES.findIndex((sp) => sp.unlock > 2 && !sp.appears);
    const sp = SPECIES[i]!;
    expect(silhouetteHint(stateAt(0), i).lines.join(' ')).toContain(`„${STAGES[sp.unlock]!.name}“`);
    expect(silhouetteHint(stateAt(sp.unlock), i).lines.join(' ')).toContain('halte die Augen offen');
    const special = SPECIES.findIndex((x) => x.appears && x.appears.length > 0);
    expect(silhouetteHint(stateAt(STAGES.length - 1), special).lines.join(' ')).toContain('besondere Bedingungen');
  });

  it('unbekannter Index: neutrale Notiz', () => {
    expect(silhouetteHint(stateAt(0), 999)).toEqual({ title: 'Unentdeckte Art', lines: [] });
  });

  it('Pflanzen-Notiz: entdeckt mit Fakten und Text, unentdeckt nur „ab …“', () => {
    const known = plantNote({ discovered: true, name: 'Moos', facts: ['Moose', 'ab „Keimling“'], text: 'Weich.', present: true });
    expect(known.title).toBe('Moos');
    expect(known.lines).toEqual(['Moose · ab „Keimling“', 'Weich.', 'Wächst gerade hier.']);
    const hidden = plantNote({ discovered: false, name: '???', facts: ['ab „Hain“'], present: false });
    expect(hidden.title).toContain('???');
    expect(hidden.lines.join(' ')).toContain('ab „Hain“');
  });
});

describe('Reiter Arten: Schlüssel für das Neuzeichnen', () => {
  it('ändert sich bei Entdeckung und Stammgast, nicht bei Samen oder Spielzeit', () => {
    const state = stateAt(6, ['bluetit']);
    const key = speciesPageKey(state);
    state.seeds += 100;
    state.cycle.elapsed += 30;
    expect(speciesPageKey(state)).toBe(key);
    state.meta.journal.species.push('robin');
    const discovered = speciesPageKey(state);
    expect(discovered).not.toBe(key);
    state.meta.regulars.push('bluetit');
    expect(speciesPageKey(state)).not.toBe(discovered);
  });
});
