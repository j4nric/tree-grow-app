import { describe, expect, it } from 'vitest';
import { animalSize, createAnchorResolver, EDGE_BACK_LIFT, edgeFootprint, nicheAnchors, SCENE_NICHES } from '../src/render/anchors';
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
        for (const a of all.litter) expect(Math.abs(a.y - groundY)).toBeLessThan(4);
        // Waldsaum: vorn auf der Bodenlinie oder (schmal) in der hinteren Reihe auf der Wiese.
        const size = animalSize(w, h);
        for (const a of all.edge) {
          expect(a.y).toBeLessThan(groundY + 4);
          expect(a.y).toBeGreaterThan(groundY - EDGE_BACK_LIFT * size - 2);
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

describe('Waldsaum auf allen Bildschirmbreiten', () => {
  const WIDTHS: [number, number][] = [
    [320, 568],
    [390, 844],
    [800, 600],
    [1024, 768],
    [1060, 850],
    [1200, 700],
  ];
  const STAGES = [2, 4, 6, 7.5, 8];

  it('Großtiere (Reh, Fuchs, Wolf) auf Platz 0–3 überlappen sich nie und bleiben im Bild', () => {
    for (const [w, h] of WIDTHS) {
      const size = animalSize(w, h);
      for (const g of STAGES) {
        const edge = nicheAnchors(w, h, g, 4).edge;
        const feet = edge.map((a) => edgeFootprint(a, size));
        for (const [x0, x1] of feet) {
          expect(x0).toBeGreaterThanOrEqual(0);
          expect(x1).toBeLessThanOrEqual(w);
        }
        for (let i = 0; i < 4; i++) {
          for (let j = i + 1; j < 4; j++) {
            const [a0, a1] = feet[i]!;
            const [b0, b1] = feet[j]!;
            // Lücke zwischen den Bereichen, mindestens 0,15 Tiergrößen.
            const gap = Math.max(b0 - a1, a0 - b1);
            expect(gap, `Waldsaum ${i}/${j} bei g=${g}, ${w}×${h}`).toBeGreaterThanOrEqual(size * 0.15 - 1e-6);
          }
        }
      }
    }
  });

  it('auf schmalen Bildschirmen stehen Großtiere kleiner in der hinteren Reihe', () => {
    for (const [w, h] of WIDTHS) {
      const edge = nicheAnchors(w, h, 7, 4).edge;
      for (const a of edge) {
        if (w < 600) {
          expect(a.depth).toBe(1);
          expect(a.scale).toBeLessThan(1);
          expect(a.scale).toBeGreaterThanOrEqual(0.5);
        } else {
          expect(a.depth).toBe(0);
          expect(a.scale).toBe(1);
        }
      }
    }
  });

  it('typische Desktop-Canvases ab 800 px behalten die vordere Reihe; sehr breite bleiben wie bisher', () => {
    for (const [w, h] of [
      [800, 600],
      [1024, 768],
      [1060, 850],
      [1440, 900],
    ] as const) {
      for (const a of nicheAnchors(w, h, 6, 4).edge) expect(a.depth, `${w}×${h}`).toBe(0);
    }
    // Reicht der alte Abstand (7,5 % der Breite), stehen die Plätze wie bisher.
    const edge = nicheAnchors(1920, 1080, 6, 4).edge;
    expect(edge.map((a) => Math.round(a.x))).toEqual([1594, 326, 1738, 182]);
  });

  it('Pilze liegen außerhalb der Bereiche von Großtieren und Sonderplätzen (0–5)', () => {
    for (const [w, h] of WIDTHS) {
      const size = animalSize(w, h);
      for (const g of STAGES) {
        const all = nicheAnchors(w, h, g, 6);
        for (const r of all.roots.slice(0, 4)) {
          for (const e of all.edge) {
            const [x0, x1] = edgeFootprint(e, size);
            const gap = Math.max(x0 - (r.surfaceX + size * 0.48), r.surfaceX - size * 0.48 - x1);
            expect(gap, `Pilz ${r.slot} / Waldsaum ${e.slot} bei g=${g}, ${w}×${h}`).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('Pilze an der Oberfläche berühren die Blumentupfen des Waldsaums nicht', () => {
    for (const [w, h] of WIDTHS) {
      const size = animalSize(w, h);
      for (const g of STAGES) {
        const all = nicheAnchors(w, h, g, 4);
        for (const r of all.roots) {
          for (const e of all.edge) {
            // Pilz ≈ ±0,5 Tiergrößen, Blumentupfen ≈ ±0,55 (skaliert mit dem Platz).
            const d = Math.abs(r.surfaceX - e.x) - size * 0.5 - size * 0.55 * e.scale;
            expect(d, `Pilz ${r.slot} / Waldsaum ${e.slot} bei g=${g}, ${w}×${h}`).toBeGreaterThan(0);
          }
        }
      }
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
