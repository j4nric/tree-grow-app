import { describe, expect, it } from 'vitest';
import { animalSize, createAnchorResolver, nicheAnchors, SCENE_NICHES } from '../src/render/anchors';
import { animalKind } from '../src/render/animals';
import { makeLayout, placeMainTree } from '../src/render/layout';

const SIZES: [number, number][] = [
  [1200, 700],
  [390, 844],
  [320, 480],
  [1920, 1080],
];
const GROWTHS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4.5, 5.5, 6.5, 7.2, 7.9, 8];

describe('Tier-Ankerpunkte', () => {
  it('sind deterministisch', () => {
    for (const g of [1.3, 3.7, 6.2]) {
      expect(nicheAnchors(1200, 700, g, 6)).toEqual(nicheAnchors(1200, 700, g, 6));
    }
  });

  it('liegen immer innerhalb des Canvas', () => {
    for (const [w, h] of SIZES) {
      for (const g of GROWTHS) {
        const all = nicheAnchors(w, h, g, 6);
        for (const niche of SCENE_NICHES) {
          for (const a of all[niche]) {
            expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
            expect(a.x).toBeGreaterThanOrEqual(0);
            expect(a.x).toBeLessThanOrEqual(w);
            expect(a.y).toBeGreaterThanOrEqual(0);
            expect(a.y).toBeLessThanOrEqual(h);
            expect(a.surfaceX).toBeGreaterThanOrEqual(0);
            expect(a.surfaceX).toBeLessThanOrEqual(w);
          }
        }
      }
    }
  });

  it('liegen über bzw. unter der Erde passend zur Nische', () => {
    for (const [w, h] of SIZES) {
      const groundY = makeLayout(w, h).groundY;
      for (const g of [3, 5, 7.5]) {
        const all = nicheAnchors(w, h, g, 4);
        for (const a of all.roots) expect(a.y).toBeGreaterThan(groundY);
        for (const n of ['crown', 'bark', 'hollows'] as const) {
          for (const a of all[n]) {
            expect(a.y).toBeLessThan(groundY);
            expect(a.onTree).toBe(true);
          }
        }
        for (const n of ['litter', 'edge'] as const) {
          for (const a of all[n]) expect(Math.abs(a.y - groundY)).toBeLessThan(4);
        }
      }
    }
  });

  it('geben jedem Platz einer Nische eine eigene Stelle', () => {
    for (const [w, h] of SIZES) {
      for (const g of [3, 4, 5, 6, 7, 8]) {
        const all = nicheAnchors(w, h, g, 4);
        for (const niche of SCENE_NICHES) {
          const list = all[niche];
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              const d = Math.hypot(list[i]!.x - list[j]!.x, list[i]!.y - list[j]!.y);
              expect(d, `${niche} ${i}/${j} bei g=${g}, ${w}×${h}`).toBeGreaterThan(4);
            }
          }
        }
      }
    }
  });

  it('wachsen stufenlos mit dem Baum (keine Sprünge)', { timeout: 15000 }, () => {
    const step = 0.01;
    for (const [w, h] of [
      [1200, 700],
      [390, 844],
    ] as const) {
      // Jedes Ergebnis wird als nächstes `a` wiederverwendet (halbiert die Arbeit).
      let a = nicheAnchors(w, h, 1, 4);
      for (let k = 1; k <= 700; k++) {
        const g = 1 + k * step;
        const b = nicheAnchors(w, h, g, 4);
        for (const niche of SCENE_NICHES) {
          for (let i = 0; i < 4; i++) {
            const d = Math.hypot(a[niche][i]!.x - b[niche][i]!.x, a[niche][i]!.y - b[niche][i]!.y);
            expect(d, `${niche} Platz ${i} bei g=${(g - step).toFixed(2)}`).toBeLessThan(2.5);
          }
        }
        a = b;
      }
    }
  });

  it('ignorieren unbekannte Nischen und ungültige Plätze', () => {
    const layout = makeLayout(800, 600);
    const r = createAnchorResolver(layout, 4, placeMainTree(layout, 4));
    expect(r.get('ocean', 0)).toBeNull();
    expect(r.get('crown', -1)).toBeNull();
    expect(r.get('crown', Number.NaN)).toBeNull();
    expect(r.get('crown', 2)).toEqual(r.get('crown', 2));
  });

  it('Tiergröße bleibt zwischen 20 und 36 px', () => {
    for (const [w, h] of [...SIZES, [100, 100] as [number, number], [4000, 3000] as [number, number]]) {
      const s = animalSize(w, h);
      expect(s).toBeGreaterThanOrEqual(20);
      expect(s).toBeLessThanOrEqual(36);
    }
  });
});

describe('Tier-Zeichnungen', () => {
  it('nutzen eigene Zeichnungen je Art und für unbekannte Arten die Gattung', () => {
    expect(animalKind({ id: 'robin', family: 'birds', niche: 'litter' })).toBe('robin');
    expect(animalKind({ id: 'centipede', family: 'soil', niche: 'litter' })).toBe('centipede');
    expect(animalKind({ id: 'owl', family: 'birds', niche: 'hollows' })).toBe('owl');
    expect(animalKind({ id: 'fox', family: 'mammals', niche: 'edge' })).toBe('fox');
    expect(animalKind({ id: 'chanterelle', family: 'fungi', niche: 'roots' })).toBe('chanterelle');
    expect(animalKind({ id: 'tinder', family: 'fungi', niche: 'bark' })).toBe('tinder');
    expect(animalKind({ id: 'raven', family: 'birds', niche: 'crown' })).toBe('bird');
    expect(animalKind({ id: 'lynx', family: 'mammals', niche: 'edge' })).toBe('mammal');
    // Hutpilze am Holz werden zu Konsolen, Konsolen am Boden zu Hutpilzen.
    expect(animalKind({ id: 'flyagaric', family: 'fungi', niche: 'bark' })).toBe('bracket');
    expect(animalKind({ id: 'tinder', family: 'fungi', niche: 'roots' })).toBe('mushroom');
    expect(animalKind({ id: 'unknown', family: 'fungi', niche: 'hollows' })).toBe('bracket');
  });
});
