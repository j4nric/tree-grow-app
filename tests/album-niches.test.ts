import { describe, expect, it } from 'vitest';
import { HABITAT_NICHES } from '../src/content/habitats';
import { MEMORY_PER_REGULAR_SLOT } from '../src/content/memory';
import { NICHES } from '../src/content/niches';
import { SPECIES } from '../src/content/species';
import { evaluate } from '../src/core/formulas';
import { HARMONY_TIERS, toEcosystemView } from '../src/ui/adapters';
import { STICKER_TILT_MAX, happinessArc, stickerTilt, stickerVariant } from '../src/ui/album/sticker-rules';
import {
  HABITAT_NICHE_IDS,
  animalBasics,
  ecosystemLinksVisible,
  firstSeenText,
  isQuietLocked,
  lockedSummary,
  harmonyTierRows,
  nichesPageHeader,
  regularToggleView,
  splitNiches,
} from '../src/ui/album/pages/niches-view';
import type { AnimalView, NicheView } from '../src/ui/view-model';
import { stateAt } from './helpers';

/** Reiter „Nischen“ und seine Unterseiten (docs/ALBUM_UI.md, B.1, D.4, E.1). */

const animal = (id: string, visitor = false): AnimalView => ({
  id,
  name: id,
  family: 'birds',
  familyIcon: '🐦',
  rarity: 'common',
  happiness: 1,
  mood: '',
  visitor,
});
const niche = (id: string, capacity: number, animals: AnimalView[] = []): NicheView => ({ id, icon: '', label: id, capacity, animals });

describe('Sticker: Neigung und Variante', () => {
  it('Neigung fest je Art und Platz, ganze Grad im Bereich ±6°, nie 0°', () => {
    for (const sp of SPECIES) {
      for (let i = 0; i < 4; i++) {
        const tilt = stickerTilt(sp.id, i);
        expect(Number.isInteger(tilt)).toBe(true);
        expect(Math.abs(tilt)).toBeGreaterThanOrEqual(1);
        expect(Math.abs(tilt)).toBeLessThanOrEqual(STICKER_TILT_MAX);
        expect(stickerTilt(sp.id, i)).toBe(tilt);
      }
    }
  });

  it('streut: verschiedene Arten und Plätze liegen unterschiedlich schief, beide Richtungen', () => {
    const tilts = SPECIES.map((sp) => stickerTilt(sp.id, 0));
    expect(new Set(tilts).size).toBeGreaterThanOrEqual(8);
    expect(tilts.some((t) => t < 0)).toBe(true);
    expect(tilts.some((t) => t > 0)).toBe(true);
    const slots = [0, 1, 2, 3, 4, 5].map((i) => stickerTilt('robin', i));
    expect(new Set(slots).size).toBeGreaterThan(1);
  });

  it('ungültige Platznummern fallen auf Platz 0', () => {
    expect(stickerTilt('owl', Number.NaN)).toBe(stickerTilt('owl', 0));
    expect(stickerTilt('owl', -3)).toBe(stickerTilt('owl', 0));
  });

  it('matt nur bei ruhenden (Winterschlaf) oder ausgezogenen Arten', () => {
    expect(stickerVariant({})).toBe('color');
    expect(stickerVariant({ night: { resting: false } })).toBe('color');
    expect(stickerVariant({ night: { resting: true } })).toBe('muted');
    expect(stickerVariant({ gone: true })).toBe('muted');
  });

  it('Bogen der Zufriedenheit in Grad, begrenzt und ohne NaN', () => {
    expect(happinessArc(0)).toBe(0);
    expect(happinessArc(0.5)).toBe(180);
    expect(happinessArc(1)).toBe(360);
    expect(happinessArc(1.4)).toBe(360);
    expect(happinessArc(-1)).toBe(0);
    expect(happinessArc(Number.NaN)).toBe(0);
  });
});

describe('Seitenkopf und Abschnitte', () => {
  it('„9 von 14 Plätzen“: belegte von allen offenen Plätzen, Gäste zählen nicht', () => {
    const niches = [
      niche('roots', 3, [animal('earthworm'), animal('vole')]),
      niche('crown', 2, [animal('bluetit'), animal('cranes', true)]),
      niche('hollows', 0),
    ];
    expect(nichesPageHeader(niches)).toBe('3 von 5 Plätzen');
    expect(nichesPageHeader([niche('roots', 1, [animal('earthworm')])])).toBe('1 von 1 Platz');
    expect(nichesPageHeader([niche('roots', 0)])).toBe('noch keine Plätze');
  });

  it('passt zur echten Ansicht (Junger Baum mit drei Tieren)', () => {
    const state = stateAt(3, ['earthworm', 'woodlouse', 'bluetit']);
    const view = toEcosystemView(state, evaluate(state));
    const total = view.niches.reduce((s, n) => s + Math.max(0, n.capacity), 0);
    expect(nichesPageHeader(view.niches)).toBe(`3 von ${total} Plätzen`);
  });

  it('Lebensräume getrennt von den Nischen am Baum, Reihenfolge bleibt', () => {
    expect([...HABITAT_NICHE_IDS].sort()).toEqual(['pond', ...HABITAT_NICHES.map((n) => n.id)].sort());
    const split = splitNiches(NICHES.map((n) => ({ id: n.id })));
    expect(split.tree.map((n) => n.id)).toEqual(['roots', 'litter', 'edge', 'crown', 'bark', 'hollows']);
    expect(split.habitats.map((n) => n.id)).toEqual(NICHES.filter((n) => HABITAT_NICHE_IDS.has(n.id)).map((n) => n.id));
  });

  it('Harmoniestufen von unten nach oben, genau eine aktuell', () => {
    const rows = harmonyTierRows(64);
    expect(rows.map((r) => r.label)).toEqual([...HARMONY_TIERS].reverse().map((t) => t.label));
    expect(rows.filter((r) => r.current).map((r) => r.label)).toEqual(['Stimmiges Ökosystem']);
    expect(rows[0]!.range).toBe('unter 30');
    expect(rows[1]!.range).toBe('ab 30');
    expect(harmonyTierRows(-5).find((r) => r.current)!.label).toBe('Zarte Anfänge');
    expect(harmonyTierRows(Number.NaN).find((r) => r.current)!.label).toBe('Zarte Anfänge');
    expect(harmonyTierRows(500).find((r) => r.current)!.label).toBe('Ursprüngliche Wildnis');
  });
});

describe('U:Tier', () => {
  it('„Zuerst gesehen“ nur, wenn der Stand es kennt (seit v15)', () => {
    const state = stateAt(3, ['robin']);
    expect(firstSeenText(state, 'robin')).toBe('');
    state.meta.journal.firstSeen.species.robin = { cycle: 2, season: 'summer' };
    expect(firstSeenText(state, 'robin')).toBe('Zuerst gesehen: Zyklus 2, Sommer');
    // Robust gegen alte bzw. kaputte Stände ohne das Feld.
    const old = { meta: { ...state.meta, journal: { ...state.meta.journal, firstSeen: undefined } } } as never;
    expect(firstSeenText(old, 'robin')).toBe('');
  });

  it('Stammgast-Schalter wie im Tagebuch', () => {
    const state = stateAt(3, ['robin', 'earthworm']);
    expect(regularToggleView(state, 'robin')).toBeNull();
    state.meta.forestMemory = MEMORY_PER_REGULAR_SLOT;
    expect(regularToggleView(state, 'robin')).toEqual({ selected: false, disabled: false });
    state.meta.regulars = ['earthworm'];
    expect(regularToggleView(state, 'robin')).toEqual({ selected: false, disabled: true });
    expect(regularToggleView(state, 'earthworm')).toEqual({ selected: true, disabled: false });
    // Unentdeckte Arten bekommen keinen Schalter.
    expect(regularToggleView(state, 'owl')).toBeNull();
  });

  it('Grunddaten auch ohne lebende Art (ausgezogen)', () => {
    expect(animalBasics('owl')).toMatchObject({ id: 'owl', name: 'Waldkauz', familyLabel: 'Vögel', nicheLabel: '🕳️ Höhlen & Totholz' });
    expect(animalBasics('gibt-es-nicht')).toBeNull();
  });
});

describe('Erster Start: Verschlossenes zusammengefasst, Links erst mit Inhalt (Playtest Schritt 14, S10)', () => {
  it('nur verschlossene Nischen ohne Pflege-Knopf werden zusammengefasst', () => {
    expect(isQuietLocked({ capacity: 0, animals: [] })).toBe(true);
    expect(isQuietLocked({ capacity: 0, animals: [], careLink: 'meadow' })).toBe(false);
    expect(isQuietLocked({ capacity: 2, animals: [] })).toBe(false);
    expect(isQuietLocked({ capacity: 0, animals: [animal('fox')] })).toBe(false);
  });

  it('beim Samen: alle zehn Nischen und der Pflanzring in einer Zeile', () => {
    const state = stateAt(0);
    const view = toEcosystemView(state, evaluate(state));
    const quiet = view.niches.filter(isQuietLocked);
    expect(quiet).toHaveLength(view.niches.length);
    expect(view.plantRing.capacity).toBe(0);
    expect(lockedSummary(quiet.length, true)).toBe(`Noch ${quiet.length} Nischen und der Pflanzring verschlossen`);
  });

  it('Text der Zeile', () => {
    expect(lockedSummary(1, false)).toBe('Noch eine Nische verschlossen');
    expect(lockedSummary(3, false)).toBe('Noch 3 Nischen verschlossen');
    expect(lockedSummary(0, true)).toBe('Noch verschlossen: der Pflanzring');
    expect(lockedSummary(0, false)).toBe('');
  });

  it('Links zu Lebensgemeinschaften und Nahrungsnetz erst mit einem Tier oder einer entdeckten Gemeinschaft', () => {
    expect(ecosystemLinksVisible([{ animals: [] }, { animals: [] }], 0)).toBe(false);
    expect(ecosystemLinksVisible([{ animals: [] }, { animals: [animal('earthworm')] }], 0)).toBe(true);
    expect(ecosystemLinksVisible([{ animals: [] }], 1)).toBe(true);
  });
});
