import { describe, expect, it } from 'vitest';
import { HABITAT_NICHES } from '../src/content/habitats';
import { STAGES } from '../src/content/stages';
import { evaluate } from '../src/core/formulas';
import type { GameState } from '../src/core/state';
import { buyCare } from '../src/core/tick';
import { careOpensText, familyViews, isHabitatNiche, toCareViews, toEcosystemView, toJournalView } from '../src/ui/adapters';
import { dailyGoalText } from '../src/ui/daily-view';
import { guideSections } from '../src/ui/guide-view';
import { HYPHENATION, hyphenate, stripHyphens } from '../src/ui/hyphenate';
import { regularNextCycleHint, regularWaitReason, regularWaitText } from '../src/ui/regular-wait';
import { NEWER_STORED_SAVE_TEXT } from '../src/ui/save-transfer';
import { stateAt } from './helpers';

/**
 * Lebensräume in der Oberfläche (DESIGN_V2.md 23.7 Punkt 5): verschlossene Nischen mit
 * Hinweis und „Zur Pflege“, Pflegekarten „Öffnet Lebensraum …“, Gattung Reptilien,
 * Stammgast-Hinweise und die Spielanleitung. Nur View-Logik – die Regeln testet
 * tests/habitats-core.test.ts.
 */

const YOUNG = 3;
const OLD = 4;
const GROVE = 5;

const niche = (state: GameState, id: string) => toEcosystemView(state, evaluate(state)).niches.find((n) => n.id === id)!;
const care = (state: GameState, id: string) => toCareViews(state).find((c) => c.id === id);

describe('Nischenliste: drei verschlossene Lebensräume', () => {
  it('stehen nach dem Waldtümpel in der Übersicht, mit Symbol und Namen', () => {
    const view = toEcosystemView(stateAt(1), evaluate(stateAt(1)));
    expect(view.niches.slice(-3).map((n) => `${n.icon} ${n.label}`)).toEqual(['🌾 Waldwiese', '🪵 Totholzhaufen', '🪨 Trockenmauer']);
  });

  it('verschlossen mit Hinweis auf die Pflege; „Zur Pflege“ erst, wenn die Maßnahme in der Liste steht', () => {
    const cases = [
      { id: 'meadow', care: 'meadow', name: 'Waldwiese', from: YOUNG },
      { id: 'deadwood', care: 'deadwood-pile', name: 'Totholzhaufen', from: OLD },
      { id: 'wall', care: 'drystone-wall', name: 'Trockenmauer', from: GROVE },
    ];
    for (const c of cases) {
      for (let stage = 1; stage < STAGES.length; stage++) {
        const view = niche(stateAt(stage), c.id);
        expect(view.capacity, `${c.id} Stufe ${stage}`).toBe(0);
        expect(view.unlockHint).toBe(`öffnet durch Pflege „${c.name}“ (ab „${STAGES[c.from]!.name}“)`);
        expect(view.careLink, `${c.id} Stufe ${stage}`).toBe(stage >= c.from ? c.care : undefined);
        // Die Maßnahme steht genau dann in der Pflege-Liste, wenn der Knopf erscheint.
        expect(care(stateAt(stage), c.care) !== undefined, `${c.care} Stufe ${stage}`).toBe(stage >= c.from);
      }
    }
  });

  it('nach dem Kauf offen wie jede Nische: Plätze, kein Hinweis, kein Knopf; Bewohner mit Gattung', () => {
    const state = stateAt(YOUNG);
    state.seeds = 1e6;
    expect(buyCare(state, 'meadow').ok).toBe(true);
    expect(niche(state, 'meadow')).toMatchObject({ capacity: 2, animals: [] });
    expect(niche(state, 'meadow').unlockHint).toBeUndefined();
    expect(niche(state, 'meadow').careLink).toBeUndefined();
    state.niches.meadow.push('lizard');
    expect(niche(state, 'meadow').animals).toEqual([expect.objectContaining({ id: 'lizard', family: 'reptiles', familyIcon: '🦎' })]);
  });

  it('Totholzhaufen offen aus dem Käferjahr (1 Platz): kein Knopf, die Pflegekarte nennt keine Öffnung', () => {
    const state = stateAt(OLD);
    state.cycle.bonuses.push({ source: 'beetle-year', effect: { kind: 'slot', niche: 'deadwood', amount: 1 } });
    expect(niche(state, 'deadwood')).toMatchObject({ capacity: 1 });
    expect(niche(state, 'deadwood').careLink).toBeUndefined();
    expect(care(state, 'deadwood-pile')!.opens).toBeNull();
  });

  it('offener Lebensraum vor der Stufe seiner Bewohner: „Bewohner ab …“ wie beim Tümpel', () => {
    // Eine Wiese mit Platz schon im Keimling (nur über Testdaten): Bewohner erst ab Junger Baum.
    const state = stateAt(2);
    state.cycle.bonuses.push({ source: 'test', effect: { kind: 'slot', niche: 'meadow', amount: 1 } });
    expect(niche(state, 'meadow')).toMatchObject({ capacity: 1, unlockHint: `Bewohner ab „${STAGES[YOUNG]!.name}“` });
  });
});

describe('Pflegekarten: „Öffnet Lebensraum …“', () => {
  it('Waldwiese, Totholzhaufen, Trockenmauer (und Waldtümpel) nennen den Lebensraum, solange er zu ist', () => {
    const grove = stateAt(GROVE);
    expect(care(grove, 'meadow')!.opens).toBe('Öffnet Lebensraum 🌾 Waldwiese');
    expect(care(grove, 'deadwood-pile')!.opens).toBe('Öffnet Lebensraum 🪵 Totholzhaufen');
    expect(care(grove, 'drystone-wall')!.opens).toBe('Öffnet Lebensraum 🪨 Trockenmauer');
    expect(care(grove, 'pond')!.opens).toBe('Öffnet Lebensraum 🫧 Waldtümpel');
    // Andere Pflege mit Plätzen (Nistkästen → Höhlen) öffnet keinen Lebensraum.
    expect(care(grove, 'nest-boxes')!.opens).toBeNull();
    expect(care(grove, 'compost')!.opens).toBeNull();
  });

  it('nach Rang 1 ist der Lebensraum offen: Rang 2 bringt nur noch Plätze', () => {
    const state = stateAt(GROVE);
    state.seeds = 1e6;
    expect(buyCare(state, 'meadow').ok).toBe(true);
    const view = care(state, 'meadow')!;
    expect(view.next).toBe('+2 Plätze Waldwiese, +2 ☀️');
    expect(view.opens).toBeNull();
  });

  it('careOpensText: nur Plätze in Lebensräumen ohne Plätze', () => {
    const slot = (niche: 'meadow' | 'hollows', amount: number) => ({ kind: 'cycle', effect: { kind: 'slot', niche, amount } }) as const;
    expect(careOpensText([slot('meadow', 2)], { slots: { meadow: 0 } as never })).toBe('Öffnet Lebensraum 🌾 Waldwiese');
    expect(careOpensText([slot('meadow', 2)], { slots: { meadow: 1 } as never })).toBeNull();
    expect(careOpensText([slot('meadow', -1)], { slots: { meadow: 0 } as never })).toBeNull();
    expect(careOpensText([slot('hollows', 1)], { slots: { hollows: 0 } as never })).toBeNull();
    expect(careOpensText([{ kind: 'habitat', tag: 'totholz' }], { slots: {} as never })).toBeNull();
  });

  it('isHabitatNiche: Tümpel und die drei neuen, sonst nichts', () => {
    expect((['pond', ...HABITAT_NICHES.map((n) => n.id)] as const).every((id) => isHabitatNiche(id))).toBe(true);
    expect(['roots', 'litter', 'edge', 'crown', 'bark', 'hollows'].some((id) => isHabitatNiche(id as never))).toBe(false);
  });
});

describe('Gattung Reptilien in der Oberfläche', () => {
  it('Gattungsleiste: siebte Gattung mit 🦎 und Zähler', () => {
    const state = stateAt(GROVE, ['sandlizard', 'grasssnake']);
    state.cycle.care = { 'drystone-wall': 1 };
    const reptiles = familyViews(evaluate(state)).find((f) => f.id === 'reptiles');
    expect(reptiles).toMatchObject({ icon: '🦎', label: 'Reptilien', count: 2 });
  });

  it('Naturtagebuch: Reptilien mit Gattung, Nische und CSS-Klasse `reptiles`', () => {
    const state = stateAt(OLD, ['slowworm']);
    const entry = toJournalView(state, evaluate(state)).species.find((s) => s.key === 'slowworm')!;
    expect(entry).toMatchObject({ family: 'reptiles', icon: '🦎' });
    expect(entry.facts).toEqual(['Reptilien', 'gewöhnlich', 'Nische: Totholzhaufen']);
  });

  it('Tagesziele: „der Reptilien“ / „deiner Reptilien“', () => {
    const reward = { kind: 'seeds', seconds: 60 } as never;
    expect(dailyGoalText({ kind: 'observe', target: 2, progress: 0, genus: 'reptiles', season: 'summer', reward, done: false } as never)).toBe(
      'Beobachte im Sommer 2 Arten der Reptilien in deinem Wald.',
    );
    expect(dailyGoalText({ kind: 'satisfaction', target: 80, progress: 0, genus: 'reptiles', reward, done: false } as never)).toBe(
      'Bring die Zufriedenheit deiner Reptilien auf 80 %.',
    );
  });
});

describe('Stammgäste aus Lebensräumen', () => {
  it('Hinweis fürs nächste Mal nennt den Lebensraum mit Artikel', () => {
    expect(regularNextCycleHint('lizard')).toBe('zieht erst ein, wenn die Waldwiese wieder angelegt ist (Pflege ab „Junger Baum“)');
    expect(regularNextCycleHint('slowworm')).toBe('zieht erst ein, wenn der Totholzhaufen wieder angelegt ist (Pflege ab „Alter Baum“)');
    expect(regularNextCycleHint('grasssnake')).toBe('zieht erst ein, wenn die Trockenmauer wieder angelegt ist (Pflege ab „Hain“)');
    expect(regularNextCycleHint('earthworm')).toBeNull();
  });

  it('wartender Stammgast: „wartet auf die Trockenmauer“, vor dem Hain mit Hinweis auf die Pflege', () => {
    const early = stateAt(OLD);
    early.meta.regulars = ['sandlizard'];
    expect(regularWaitText(early, regularWaitReason(early, 'sandlizard')!)).toBe('wartet auf die Trockenmauer (Pflege ab „Hain“)');
    const grove = stateAt(GROVE);
    grove.meta.regulars = ['wren'];
    expect(regularWaitText(grove, regularWaitReason(grove, 'wren')!)).toBe('wartet auf den Totholzhaufen');
  });
});

describe('Spielanleitung „Lebensräume“', () => {
  const text = guideSections().find((s) => s.id === 'habitats')!.paragraphs.join(' ');

  it('nennt alle vier Lebensräume mit Pflege und Stufe, den Knopf und die Reptilien', () => {
    expect(text).toContain('4 Nischen wachsen nicht mit dem Baum');
    expect(text).toContain('🌾 Waldwiese (Pflege „Waldwiese“ ab „Junger Baum“)');
    expect(text).toContain('🪵 Totholzhaufen (Pflege „Totholzhaufen“ ab „Alter Baum“)');
    expect(text).toContain('🫧 Waldtümpel (Pflege „Waldtümpel“ ab „Alter Baum“)');
    expect(text).toContain('🪨 Trockenmauer (Pflege „Trockenmauer“ ab „Hain“)');
    expect(text).toContain('„Zur Pflege“');
    expect(text).toContain('Öffnet Lebensraum');
    expect(text).toContain('bis zum Neuen Zyklus');
    expect(text).toContain('🦎 Reptilien – 5 Arten – leben nur in Lebensräumen: Waldwiese, Totholzhaufen und Trockenmauer');
    expect(text).toContain('+15 Prozentpunkte Zufriedenheit');
  });
});

describe('Spielanleitung „Ereignisse“', () => {
  it('nennt das Käferjahr als Ereignis, das einen Lebensraum öffnet', () => {
    const text = guideSections().find((s) => s.id === 'events')!.paragraphs.join(' ');
    expect(text).toContain('manche Lebensräume öffnen auch durch Ereignisse wie „Käferjahr“, ebenfalls bis zum Neuen Zyklus');
  });
});

describe('Lange Namen und Hinweise', () => {
  it('neue lange Namen trennen sauber', () => {
    for (const word of ['Schmetterlingstramete', 'Trockenmauer', 'Totholzhaufen', 'Wiesenkonzert', 'Wildkaninchen']) {
      expect(HYPHENATION[word], word).toBeDefined();
      expect(stripHyphens(hyphenate(word))).toBe(word);
    }
  });

  it('Neuer-Stand-Schutz: beruhigt zuerst, sagt, was zu tun ist und dass nichts gespeichert wird', () => {
    expect(NEWER_STORED_SAVE_TEXT).toMatch(/^Dein Wald wurde mit einer neueren Spielversion gespeichert und bleibt unverändert erhalten\./);
    expect(NEWER_STORED_SAVE_TEXT).toContain('lade die Seite neu');
    expect(NEWER_STORED_SAVE_TEXT).toContain('bis dahin wird hier nichts gespeichert');
  });
});
