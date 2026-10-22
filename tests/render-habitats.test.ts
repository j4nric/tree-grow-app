import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HABITAT_SPECIES } from '../src/content/habitats';
import {
  animalSize,
  createAnchorResolver,
  HABITAT_LIFT,
  midgroundGeometry,
  pileGeometry,
  pondGeometry,
  POND_DEPTH,
  POND_LIP,
  type AnchorResolver,
} from '../src/render/anchors';
import { AnimalLayer, animalBounds, animalKind, habitatPlaces, hitTestAnimals, type AnimalFrame, type SceneAnimal } from '../src/render/animals';
import { layoutFlora, PLANT_SPECIES, type ScenePlant } from '../src/render/flora';
import { makeLayout, placeMainTree } from '../src/render/layout';
import { TREE_SPECIES } from '../src/render/plant';
import { drawScene } from '../src/render/tree';

/**
 * Lebensräume (DESIGN_V2.md 23.8): Totholzhaufen im Erdschnitt rechts, Waldwiese und
 * Trockenmauer im Mittelgrund. Anker-Tests wie beim Tümpel (tests/render-anchors.test.ts):
 * Lage im Bild, keine Überlappung mit bestehenden Nischen und untereinander, Tippen.
 */

const SIZES: [number, number][] = [
  [320, 480],
  [360, 640],
  [390, 844],
  [800, 600],
  [1200, 700],
  [1920, 1080],
];
const STAGES = [3, 4, 5, 6, 7, 8];
/** Der Totholzhaufen öffnet ab Alter Baum (Pflege bzw. Käferjahr). */
const PILE_STAGES = [4, 4.5, 5, 6, 7, 8];
type Box = { x0: number; x1: number; y0: number; y1: number };
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
type Fam = SceneAnimal['family'];

const RESIDENTS: Record<'meadow' | 'deadwood' | 'wall', [string, Fam][]> = {
  meadow: [],
  deadwood: [],
  wall: [],
};
for (const s of HABITAT_SPECIES) RESIDENTS[s.niche].push([s.id, s.genus as Fam]);
// Ein unbekanntes Reptil (Ersatzbild Eidechse) an der Mauer – fünf Bewohner wie bei den anderen.
RESIDENTS.wall.push(['viper', 'reptiles']);

/** Alle Belegungen der Plätze 0..n−1 mit n verschiedenen Arten (Reihenfolge zählt; `step` dünnt aus). */
function residents(niche: keyof typeof RESIDENTS, n: number, step = 1): SceneAnimal[][] {
  const out: SceneAnimal[][] = [];
  const list = RESIDENTS[niche];
  const pick = (chosen: number[]) => {
    if (chosen.length === n) {
      out.push(chosen.map((k, slot) => ({ id: list[k]![0], family: list[k]![1], niche, slot, happiness: 1 })));
      return;
    }
    for (let k = 0; k < list.length; k++) if (!chosen.includes(k)) pick([...chosen, k]);
  };
  pick([]);
  return out.filter((_, i) => i % step === 0);
}

function resolver(w: number, h: number, g: number, species: (typeof TREE_SPECIES)[number] = 'oak'): AnchorResolver {
  const layout = makeLayout(w, h);
  return createAnchorResolver(layout, g, placeMainTree(layout, g, species));
}

/** Raum eines Lebensraums: Haufen bis zum Rand der Senke, Mittelgrund-Streifen mit Flughöhe. */
function habitatBox(anchors: AnchorResolver, niche: 'meadow' | 'deadwood' | 'wall'): Box {
  const S = anchors.size;
  if (niche === 'deadwood') {
    const p = anchors.pile();
    return { x0: p.x - p.halfWidth * S, x1: p.x + p.halfWidth * S, y0: p.lipY, y1: p.y + POND_DEPTH * S };
  }
  const m = anchors.midground(niche);
  return { x0: m.x - m.halfWidth * S, x1: m.x + m.halfWidth * S, y0: m.skyY - S, y1: m.y + 0.1 * S };
}

const OTHERS: [string, Fam, string][] = [
  ['robin', 'birds', 'litter'],
  ['hedgehog', 'mammals', 'litter'],
  ['woodant', 'insects', 'litter'],
  ['squirrel', 'mammals', 'litter'],
  ['deer', 'mammals', 'edge'],
  ['wolf', 'mammals', 'edge'],
  ['fox', 'mammals', 'edge'],
  ['bee', 'insects', 'edge'],
  ['earthworm', 'soil', 'roots'],
  ['mole', 'mammals', 'roots'],
  ['porcini', 'fungi', 'roots'],
  ['honeyfungus', 'fungi', 'roots'],
];
const TREE_DWELLERS: [string, Fam, string][] = [
  ['woodpecker', 'birds', 'bark'],
  ['blackwoodpecker', 'birds', 'bark'],
  ['tinder', 'fungi', 'bark'],
  ['owl', 'birds', 'hollows'],
  ['bat', 'mammals', 'hollows'],
];

describe('Lebensräume: Zeichnungen', () => {
  it('jede der 14 Arten hat eine eigene Zeichnung; unbekannte Reptilien die Eidechse', () => {
    expect(HABITAT_SPECIES).toHaveLength(14);
    for (const s of HABITAT_SPECIES) expect(animalKind({ id: s.id, family: s.genus as Fam, niche: s.niche }), s.id).toBe(s.id);
    expect(animalKind({ id: 'viper', family: 'reptiles', niche: 'wall' })).toBe('reptile');
    // Pilze im Totholzhaufen wachsen als Konsolen.
    expect(animalKind({ id: 'unknown', family: 'fungi', niche: 'deadwood' })).toBe('bracket');
  });
});

describe('Totholzhaufen im Erdschnitt', () => {
  it('liegt ganz im Bild, unter der Grasnarbe, rechts neben dem Stamm – Gegenstück zum Tümpel', () => {
    for (const [w, h] of SIZES) {
      const layout = makeLayout(w, h);
      const S = animalSize(w, h);
      const p = pileGeometry(layout, S);
      const pond = pondGeometry(layout, S);
      expect(p.x + p.halfWidth * S, `${w}×${h}`).toBeLessThanOrEqual(w);
      expect(p.x - p.halfWidth * S, `${w}×${h}`).toBeGreaterThan(layout.cx + S);
      expect(p.x).toBeGreaterThan(w / 2);
      expect(pond.x).toBeLessThan(w / 2);
      expect(p.halfWidth).toBeGreaterThanOrEqual(1.9);
      expect(p.lipY).toBeCloseTo(layout.groundY + POND_LIP * S, 6);
      expect(p.y + POND_DEPTH * S).toBeLessThan(h);
    }
  });

  it('1–5 Bewohner bleiben samt Bewegung und Lücken im Haufen und überlappen sich nie', { timeout: 30_000 }, () => {
    for (const [w, h] of SIZES) {
      for (const g of [4, 8]) {
        const anchors = resolver(w, h, g);
        const box = habitatBox(anchors, 'deadwood');
        for (let n = 1; n <= 5; n++) {
          for (const scene of residents('deadwood', n, n >= 4 ? 7 : 1)) {
            const boxes = scene.map((a) => animalBounds(a, anchors, [], scene)!);
            const names = scene.map((a) => a.id).join(', ');
            for (const b of boxes) {
              const where = `[${names}] ${w}×${h} g=${g}`;
              expect(b.y0, where).toBeGreaterThanOrEqual(box.y0 - 0.5);
              expect(b.y1, where).toBeLessThanOrEqual(box.y1 + 0.5);
              expect(b.x0, where).toBeGreaterThanOrEqual(box.x0 - 0.5);
              expect(b.x1, where).toBeLessThanOrEqual(box.x1 + 0.5);
            }
            for (let i = 0; i < boxes.length; i++) {
              for (let j = i + 1; j < boxes.length; j++) {
                expect(overlap(boxes[i]!, boxes[j]!), `${scene[i]!.id} / ${scene[j]!.id} in [${names}] ${w}×${h}`).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it('überlappt weder Tümpel noch Laubstreu, Waldsaum und Wurzelraum (Plätze 0–5, Stufen 4–8)', () => {
    for (const [w, h] of SIZES) {
      for (const g of PILE_STAGES) {
        const anchors = resolver(w, h, g);
        const S = anchors.size;
        const pile = habitatBox(anchors, 'deadwood');
        const p = anchors.pond();
        expect(overlap(pile, { x0: p.x - p.halfWidth * S, x1: p.x + p.halfWidth * S, y0: p.lipY, y1: p.y + POND_DEPTH * S })).toBe(false);
        for (const [id, family, niche] of OTHERS) {
          for (let slot = 0; slot < 6; slot++) {
            // Das Pilzgeflecht läuft hinter dem Haufen weiter (er wird danach gezeichnet).
            const b = animalBounds({ id, family, niche, slot, happiness: 1 }, anchors, ['mycel'])!;
            expect(overlap(b, pile), `${id} in ${niche}/${slot}, ${w}×${h}, g=${g}`).toBe(false);
          }
        }
      }
    }
  });

  it('Begleitpflanzen stehen auf der Narbe über dem Haufen', () => {
    const ring = ['hazel', 'anemone', 'fern', 'birch', 'foxglove', 'moss', 'bramble', 'beech', 'strawberry', 'rowan', 'elder', 'nettle', 'pine', 'hartstongue'];
    const plants: ScenePlant[] = ring.map((id, slot) => ({ id, group: PLANT_SPECIES[id]!, slot, vigor: 1 }));
    for (const [w, h] of SIZES) {
      for (const g of STAGES) {
        const layout = makeLayout(w, h);
        const p = pileGeometry(layout, animalSize(w, h));
        for (const pl of layoutFlora(layout, g, plants)) expect(pl.y, `${pl.id} ${w}×${h} g=${g}`).toBeLessThan(p.lipY - 2);
      }
    }
  });

  it('der erste Pilz sitzt am Stubben, Vögel oben im Haufen', () => {
    const anchors = resolver(390, 844, 6);
    const scene = residents('deadwood', 5)[0]!;
    const places = habitatPlaces(scene, anchors);
    const p = anchors.pile();
    const fungus = places[scene.findIndex((a) => a.family === 'fungi')]!;
    const bird = places[scene.findIndex((a) => a.family === 'birds')]!;
    expect(fungus.x).toBeGreaterThan(Math.max(...places.filter((q) => q !== fungus).map((q) => q!.x)));
    expect(bird.y).toBeLessThan(p.y + POND_DEPTH * p.size * 0.9);
  });
});

describe('Waldwiese und Trockenmauer im Mittelgrund', () => {
  it('liegen im Bild, Wiese rechts und Mauer links vom Stamm, über den Köpfen der Großtiere', () => {
    for (const [w, h] of SIZES) {
      const layout = makeLayout(w, h);
      const S = animalSize(w, h);
      const meadow = midgroundGeometry(layout, S, 1);
      const wall = midgroundGeometry(layout, S, -1);
      for (const m of [meadow, wall]) {
        expect(m.x - m.halfWidth * S, `${w}×${h}`).toBeGreaterThanOrEqual(0);
        expect(m.x + m.halfWidth * S, `${w}×${h}`).toBeLessThanOrEqual(w);
        expect(m.y).toBeCloseTo(layout.groundY - HABITAT_LIFT * S, 6);
        expect(m.skyY).toBeGreaterThan(0);
      }
      expect(meadow.x - meadow.halfWidth * S).toBeGreaterThan(layout.cx + 3 * S);
      expect(wall.x + wall.halfWidth * S).toBeLessThan(layout.cx - 3 * S);
    }
  });

  it('1–5 Bewohner bleiben in ihrem Streifen und überlappen sich nie', { timeout: 30_000 }, () => {
    for (const [w, h] of SIZES) {
      const anchors = resolver(w, h, 6);
      for (const niche of ['meadow', 'wall'] as const) {
        const box = habitatBox(anchors, niche);
        for (let n = 1; n <= 5; n++) {
          for (const scene of residents(niche, n, n >= 4 ? 7 : 1)) {
            const boxes = scene.map((a) => animalBounds(a, anchors, [], scene)!);
            const names = scene.map((a) => a.id).join(', ');
            for (const b of boxes) {
              const where = `${niche} [${names}] ${w}×${h}`;
              expect(b.x0, where).toBeGreaterThanOrEqual(box.x0 - 0.5);
              expect(b.x1, where).toBeLessThanOrEqual(box.x1 + 0.5);
              expect(b.y0, where).toBeGreaterThanOrEqual(box.y0);
              expect(b.y1, where).toBeLessThanOrEqual(box.y1);
            }
            for (let i = 0; i < boxes.length; i++) {
              for (let j = i + 1; j < boxes.length; j++) {
                expect(overlap(boxes[i]!, boxes[j]!), `${scene[i]!.id} / ${scene[j]!.id} in ${niche} [${names}] ${w}×${h}`).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it('Bewohner überlappen keine Tiere am Boden, am Stamm und im Erdschnitt (Plätze 0–5, Stufen 3–8, alle Baumarten)', { timeout: 30_000 }, () => {
    for (const [w, h] of SIZES) {
      for (const species of TREE_SPECIES) {
        for (const g of STAGES) {
          const anchors = resolver(w, h, g, species);
          const scenes = [residents('meadow', 5)[0]!, residents('wall', 5)[0]!];
          const own = scenes.flatMap((scene) => scene.map((a) => ({ a, b: animalBounds(a, anchors, [], scene)! })));
          for (const [id, family, niche] of [...OTHERS, ...TREE_DWELLERS]) {
            for (let slot = 0; slot < 6; slot++) {
              const b = animalBounds({ id, family, niche, slot, happiness: 1 }, anchors, ['mycel'])!;
              for (const o of own) expect(overlap(b, o.b), `${o.a.id} / ${id} in ${niche}/${slot}, ${species} ${w}×${h}, g=${g}`).toBe(false);
            }
          }
        }
      }
    }
  });

  it('der Turmfalke überlappt keine Tiere der Krone (Plätze 0–7, Stufen 3–8, alle Baumarten)', () => {
    for (const [w, h] of SIZES) {
      for (const species of TREE_SPECIES) {
        for (const g of STAGES) {
          const anchors = resolver(w, h, g, species);
          const kestrel: SceneAnimal = { id: 'kestrel', family: 'birds', niche: 'meadow', slot: 0, happiness: 1 };
          const k = animalBounds(kestrel, anchors)!;
          for (const [id, family] of [
            ['squirrel', 'mammals'],
            ['jay', 'birds'],
          ] as const) {
            for (let slot = 0; slot < 8; slot++) {
              const b = animalBounds({ id, family, niche: 'crown', slot, happiness: 1 }, anchors)!;
              expect(overlap(b, k), `${id} Krone ${slot}, ${species} ${w}×${h}, g=${g}`).toBe(false);
            }
          }
        }
      }
    }
  });

  it('Bewohner sind etwa 70 % groß, der Turmfalke rüttelt über der Wiese', () => {
    const anchors = resolver(1200, 700, 6);
    const scene = residents('meadow', 5)[0]!;
    const places = habitatPlaces(scene, anchors);
    const m = anchors.midground('meadow');
    scene.forEach((a, i) => {
      const q = places[i]!;
      expect(q.scale, a.id).toBeLessThanOrEqual(0.7);
      expect(q.scale, a.id).toBeGreaterThanOrEqual(0.5);
      if (a.id === 'kestrel') expect(q.y).toBeCloseTo(m.skyY, 6);
      else expect(q.y, a.id).toBeLessThanOrEqual(m.y + 0.01);
    });
  });
});

describe('Lebensräume: Tippen', () => {
  it('trifft jeden Bewohner an seiner gezeichneten Stelle (alle drei Lebensräume)', () => {
    for (const [w, h] of SIZES) {
      const anchors = resolver(w, h, 6);
      const scene = [...residents('meadow', 5)[3]!, ...residents('deadwood', 5)[11]!, ...residents('wall', 4)[5]!];
      scene.forEach((a, i) => {
        const b = animalBounds(a, anchors, ['pileGap', 'perchTwig', 'meadowTuft'], scene)!;
        const hit = hitTestAnimals(scene, anchors, { time: 0, windSkew: 0, reducedMotion: true }, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
        expect(hit?.listIndex, `${a.id} ${w}×${h}`).toBe(i);
        expect(hit?.nicheId).toBe(a.niche);
      });
    }
  });

  it('Lage der Bewohner hängt nicht von der Reihenfolge der Tierliste ab', () => {
    const anchors = resolver(390, 844, 6);
    const scene = [...residents('deadwood', 4)[9]!, ...residents('meadow', 3)[2]!];
    const a = habitatPlaces(scene, anchors);
    const b = habitatPlaces([...scene].reverse(), anchors).reverse();
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// Zeichnen mit Canvas-Stub
// ---------------------------------------------------------------------------

interface StubCanvas {
  width: number;
  height: number;
  calls: { name: string; args: unknown[] }[];
  getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
}

function makeCanvas(width = 0, height = 0): StubCanvas {
  const canvas: StubCanvas = { width, height, calls: [], getContext: () => ctx };
  const store: Record<string | symbol, unknown> = {};
  const helper = { addColorStop() {}, data: new Uint8ClampedArray(16) };
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        canvas.calls.push({ name: String(prop), args });
        totalCalls++;
        return helper;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

/** Zählt, wie viele Canvases angelegt werden (neue Sprites, Ebenen) und alle Zeichenaufrufe. */
let created = 0;
let totalCalls = 0;
beforeEach(() => {
  created = 0;
  vi.stubGlobal('document', {
    createElement: () => {
      created++;
      return makeCanvas();
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Lebensräume zeichnen', () => {
  const f: AnimalFrame = { time: 1, windSkew: 0, reducedMotion: true, dpr: 1, sx: 1, sy: 1 };

  it('Totholzhaufen auch ohne Bewohner – ein Sprite, im Winter eins mehr (Schnee)', () => {
    const anchors = resolver(800, 600, 5);
    const layer = new AnimalLayer();
    const summer = makeCanvas(800, 600);
    layer.draw(summer.getContext('2d'), [], anchors, f, false, true);
    expect(summer.calls.filter((c) => c.name === 'drawImage')).toHaveLength(1);
    const winter = makeCanvas(800, 600);
    layer.draw(winter.getContext('2d'), [], anchors, { ...f, season: 3.1 }, false, true);
    expect(winter.calls.filter((c) => c.name === 'drawImage')).toHaveLength(2);
    expect(anchors.pile()).toBe(anchors.pile());
  });

  it('Mittelgrund getrennt: drawMidground zeichnet nur Wiese und Mauer, draw den Rest', () => {
    const anchors = resolver(800, 600, 5);
    const layer = new AnimalLayer();
    const scene: SceneAnimal[] = [
      { id: 'rabbit', family: 'mammals', niche: 'meadow', slot: 0, happiness: 1 },
      { id: 'sandlizard', family: 'reptiles', niche: 'wall', slot: 0, happiness: 1 },
      { id: 'kestrel', family: 'birds', niche: 'meadow', slot: 1, happiness: 1 },
      { id: 'robin', family: 'birds', niche: 'litter', slot: 0, happiness: 1 },
    ];
    const back = makeCanvas(800, 600);
    layer.drawMidground(back.getContext('2d'), scene, anchors, f);
    // Kaninchen + Grasbüschel, Zauneidechse
    expect(back.calls.filter((c) => c.name === 'drawImage')).toHaveLength(3);
    const front = makeCanvas(800, 600);
    layer.draw(front.getContext('2d'), scene, anchors, f);
    // Turmfalke (in der Luft vor dem Laub), Rotkehlchen + Laub
    expect(front.calls.filter((c) => c.name === 'drawImage')).toHaveLength(3);
    expect(layer.builds).toBe(1);
  });

  it('Reptilien in der Winterstarre: halb versteckt und ruhend', () => {
    const anchors = resolver(800, 600, 6);
    const layer = new AnimalLayer();
    const scene: SceneAnimal[] = [{ id: 'grasssnake', family: 'reptiles', niche: 'wall', slot: 0, happiness: 1 }];
    const alphas = (season: number) => {
      const c = makeCanvas(800, 600);
      const ctx = c.getContext('2d');
      const seen: number[] = [];
      const draw = ctx.drawImage.bind(ctx);
      (ctx as unknown as { drawImage: (...a: unknown[]) => void }).drawImage = (...a: unknown[]) => {
        seen.push(ctx.globalAlpha);
        (draw as (...a: unknown[]) => void)(...a);
      };
      layer.drawMidground(ctx, scene, anchors, { ...f, reducedMotion: false, season });
      return seen;
    };
    expect(alphas(1)).toEqual([1]);
    expect(alphas(3)[0]).toBeCloseTo(0.5, 6);
  });

  it('drawScene: Kulisse nur beim Öffnen eines Lebensraums neu, alle Jahreszeiten ohne Fehler', () => {
    const canvas = makeCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    const animals = [...residents('meadow', 5)[0]!, ...residents('deadwood', 5)[0]!, ...residents('wall', 4)[0]!];
    const base = { growth: 6, animals, sizeSettled: true, reducedMotion: true } as const;
    drawScene(ctx, 800, 600, { ...base, time: 1 });
    const n0 = created;
    // Gleiches Bild, weitere Frames: keine neuen Canvases.
    drawScene(ctx, 800, 600, { ...base, time: 1.1 });
    drawScene(ctx, 800, 600, { ...base, time: 1.2 });
    expect(created).toBe(n0);
    let mark = totalCalls;
    drawScene(ctx, 800, 600, { ...base, time: 1.3 });
    const plain = totalCalls - mark;
    mark = totalCalls;
    drawScene(ctx, 800, 600, { ...base, time: 1.4, meadow: true, wall: true, deadwood: true });
    const opened = totalCalls - mark;
    mark = totalCalls;
    drawScene(ctx, 800, 600, { ...base, time: 1.5, meadow: true, wall: true, deadwood: true });
    const after = totalCalls - mark;
    // Beim Öffnen wird die Kulisse neu gezeichnet; danach nur noch der Haufen (ein Sprite) dazu.
    expect(opened).toBeGreaterThan(after * 3);
    expect(after).toBeLessThanOrEqual(plain + 8);
    for (const season of [0, 1, 2, 3, 3.5]) {
      expect(() => drawScene(ctx, 800, 600, { ...base, time: 2 + season, season, meadow: true, wall: true, deadwood: true, dayPhase: 0.9 })).not.toThrow();
    }
  });
});
