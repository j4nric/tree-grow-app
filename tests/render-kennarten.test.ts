import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPECIES, kennartSite } from '../src/content/species';
import { LANDSCAPE_SITES } from '../src/content/landscape';
import { createAnchorResolver, POND_DEPTH, type AnchorResolver } from '../src/render/anchors';
import { AnimalLayer, animalBounds, animalKind, animalKinds, animalRarity, spriteDefOf, type AnimalFrame, type SceneAnimal } from '../src/render/animals';
import { isKennart, KENNART_DEFS, KENNART_HOME, KENNART_IDS, KENNART_INFO, KENNART_PAINT } from '../src/render/kennart-sprites';
import { makeLayout, placeMainTree } from '../src/render/layout';
import { nocturnalPace, sleeping } from '../src/render/nocturnal';
import { dormouseAwake, moorfrogBlue, nightjarSeason } from '../src/render/phenology';
import { renderSpeciesSticker, stickerFit, stickerFrame, stickerKind, stickerPose } from '../src/render/sticker';

/**
 * Kennarten (DESIGN_V2.md 26.3, ROADMAP Phase 9, 2a): sechs eigene Zeichnungen, über ihre
 * Art-IDs erreichbar – in der Szene und als Sticker. Seit 2b stehen die Arten in den Daten.
 */

// ---------------------------------------------------------------------------
// Zeichen-Stub, der Pfade in Zeicheneinheiten mitrechnet (Transformationen inklusive)
// ---------------------------------------------------------------------------

type M = [number, number, number, number, number, number];

interface Recorder {
  ctx: CanvasRenderingContext2D;
  /** Ausdehnung aller gefüllten und gezogenen Pfade (Striche mit halber Linienbreite). */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Nicht endliche Zahlen in Aufrufen oder gesetzten Werten. */
  bad: string[];
  fills: number;
}

function recorder(): Recorder {
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  let path: [number, number][] = [];
  let last: [number, number] = [0, 0];
  const r: Recorder = { ctx: null as unknown as CanvasRenderingContext2D, box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, bad: [], fills: 0 };
  const props: Record<string, unknown> = { lineWidth: 1 };
  const tp = (x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const add = (x: number, y: number) => {
    path.push(tp(x, y));
    last = [x, y];
  };
  const scaleOf = () => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const flush = (pad: number) => {
    for (const [x, y] of path) {
      r.box.x0 = Math.min(r.box.x0, x - pad);
      r.box.x1 = Math.max(r.box.x1, x + pad);
      r.box.y0 = Math.min(r.box.y0, y - pad);
      r.box.y1 = Math.max(r.box.y1, y + pad);
    }
  };
  const curve = (pts: number[]) => {
    const [x0, y0] = last;
    const n = pts.length / 2;
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      // De Casteljau über Start + Kontrollpunkte
      let xs = [x0, ...pts.filter((_, k) => k % 2 === 0)];
      let ys = [y0, ...pts.filter((_, k) => k % 2 === 1)];
      while (xs.length > 1) {
        xs = xs.slice(1).map((v, k) => xs[k]! + (v - xs[k]!) * t);
        ys = ys.slice(1).map((v, k) => ys[k]! + (v - ys[k]!) * t);
      }
      path.push(tp(xs[0]!, ys[0]!));
    }
    last = [pts[2 * n - 2]!, pts[2 * n - 1]!];
  };
  const methods: Record<string, (...a: number[]) => unknown> = {
    save: () => stack.push([...m]),
    restore: () => {
      m = stack.pop() ?? m;
    },
    setTransform: (a, b, c, d, e, f) => {
      m = [a!, b!, c!, d!, e!, f!];
    },
    translate: (x, y) => {
      m = [m[0], m[1], m[2], m[3], m[0] * x! + m[2] * y! + m[4], m[1] * x! + m[3] * y! + m[5]];
    },
    scale: (x, y) => {
      m = [m[0] * x!, m[1] * x!, m[2] * y!, m[3] * y!, m[4], m[5]];
    },
    rotate: (a) => {
      const c = Math.cos(a!);
      const s = Math.sin(a!);
      m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[2] * c - m[0] * s, m[3] * c - m[1] * s, m[4], m[5]];
    },
    beginPath: () => {
      path = [];
    },
    closePath: () => undefined,
    moveTo: (x, y) => add(x!, y!),
    lineTo: (x, y) => add(x!, y!),
    quadraticCurveTo: (...a) => curve(a),
    bezierCurveTo: (...a) => curve(a),
    ellipse: (x, y, rx, ry, rot, s, e) => {
      const span = Math.min(Math.PI * 2, Math.abs(e! - s!));
      for (let i = 0; i <= 32; i++) {
        const t = s! + (span * i) / 32;
        const px = rx! * Math.cos(t);
        const py = ry! * Math.sin(t);
        add(x! + px * Math.cos(rot!) - py * Math.sin(rot!), y! + px * Math.sin(rot!) + py * Math.cos(rot!));
      }
    },
    arc: (x, y, rad, s, e) => methods.ellipse!(x!, y!, rad!, rad!, 0, s!, e!),
    fill: () => {
      r.fills++;
      flush(0);
    },
    stroke: () => flush((Number(props.lineWidth) * scaleOf()) / 2),
    clip: () => undefined,
    fillRect: () => undefined,
    drawImage: () => undefined,
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  r.ctx = new Proxy(props, {
    get(target, prop) {
      const fn = methods[String(prop)];
      if (fn) {
        return (...args: unknown[]) => {
          for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) r.bad.push(`${String(prop)}(${args.join(',')})`);
          return fn(...(args as number[]));
        };
      }
      return target[String(prop)];
    },
    set(target, prop, value) {
      if (typeof value === 'number' && !Number.isFinite(value)) r.bad.push(`${String(prop)}=${value}`);
      target[String(prop)] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return r;
}

// ---------------------------------------------------------------------------

describe('Kennarten: Zeichnungen', () => {
  it('sechs Kennarten mit den Art-IDs aus DESIGN_V2.md 26.3', () => {
    expect([...KENNART_IDS]).toEqual(['dormouse', 'beaver', 'moorfrog', 'hericium', 'lynx', 'nightjar']);
    for (const id of KENNART_IDS) {
      expect(isKennart(id)).toBe(true);
      expect(KENNART_INFO[id]).toBeDefined();
      expect(KENNART_DEFS[id].paint).toBe(KENNART_PAINT[id]);
      expect(KENNART_DEFS[id].frames).toBe(KENNART_INFO[id].frames);
    }
    expect(isKennart('robin')).toBe(false);
    expect(isKennart('toString')).toBe(false);
  });

  it('jede Kennart hat ihre eigene Zeichnung in Szene und Album', () => {
    const kinds = new Set(animalKinds());
    for (const id of KENNART_IDS) {
      const { niche, family } = KENNART_HOME[id];
      expect(animalKind({ id, family, niche }), id).toBe(id);
      expect(kinds.has(id), id).toBe(true);
      expect(stickerKind(id, family), id).toBe(id);
      expect(stickerKind(id), id).toBe(id);
      expect(spriteDefOf(id), id).toBe(KENNART_DEFS[id]);
      // Kennarten sind „besonders“ (Schimmer), auch ohne `rarity`.
      expect(animalRarity({ id }), id).toBe(2);
    }
  });

  it('keine Kennart teilt ihre Zeichnung mit einer anderen Art', () => {
    const paints = new Map<unknown, string>();
    for (const kind of animalKinds()) {
      const p = spriteDefOf(kind)!.paint;
      if (!paints.has(p)) paints.set(p, kind);
    }
    for (const id of KENNART_IDS) expect(paints.get(KENNART_PAINT[id]), id).toBe(id);
  });

  it('passen genau zu den Daten (2b): jede Kennart der Daten hat ihre Zeichnung, Nische, Gattung und Wald', () => {
    // Scharf seit 2b: Die Kennarten der Daten sind genau KENNART_IDS – keine fehlt, keine zu viel.
    const data = SPECIES.filter((s) => kennartSite(s) !== null);
    expect(data.map((s) => s.id).sort()).toEqual([...KENNART_IDS].sort());
    expect(LANDSCAPE_SITES.map((site) => site.kennart).sort()).toEqual([...KENNART_IDS].sort());
    for (const id of KENNART_IDS) {
      const s = SPECIES.find((x) => x.id === id)!;
      expect(s, id).toBeDefined();
      expect(s.niche, id).toBe(KENNART_HOME[id].niche);
      expect(s.genus, id).toBe(KENNART_HOME[id].family);
      expect(kennartSite(s), id).toBe(KENNART_HOME[id].site);
      expect(stickerKind(id, s.genus), id).toBe(id);
      expect(animalKind({ id, family: s.genus, niche: s.niche }), id).toBe(id);
    }
  });

  it('jedes Bild zeichnet endliche Werte und bleibt in seinem Rahmen (samt Umriss)', () => {
    for (const id of KENNART_IDS) {
      const def = KENNART_DEFS[id];
      const u = { x0: Infinity, x1: -Infinity, y0: Infinity };
      for (let frame = 0; frame < (def.frames ?? 1); frame++) {
        const r = recorder();
        def.paint(r.ctx, frame);
        const where = `${id} Bild ${frame}`;
        expect(r.bad, where).toEqual([]);
        expect(r.fills, where).toBeGreaterThan(5);
        const tol = 0.012;
        expect(r.box.x0, `${where} links`).toBeGreaterThanOrEqual(def.x0 - tol);
        expect(r.box.x1, `${where} rechts`).toBeLessThanOrEqual(def.x1 + tol);
        expect(r.box.y0, `${where} oben`).toBeGreaterThanOrEqual(def.y0 - tol);
        expect(r.box.y1, `${where} unten`).toBeLessThanOrEqual(def.y1 + tol);
        u.x0 = Math.min(u.x0, r.box.x0);
        u.x1 = Math.max(u.x1, r.box.x1);
        u.y0 = Math.min(u.y0, r.box.y0);
      }
      // Der Rahmen ist eng: höchstens 0,08 Luft je Seite über alle Bilder (Sticker sitzen mittig).
      expect(u.x0 - def.x0, `${id} Luft links`).toBeLessThan(0.08);
      expect(def.x1 - u.x1, `${id} Luft rechts`).toBeLessThan(0.08);
      expect(u.y0 - def.y0, `${id} Luft oben`).toBeLessThan(0.08);
    }
  });

  it('Tiere stehen mit den Füßen auf dem Anker, der Stachelbart wächst von der Rinde nach rechts', () => {
    for (const id of KENNART_IDS) {
      const def = KENNART_DEFS[id];
      if (id === 'hericium') {
        expect(def.x0).toBeLessThan(0);
        expect(def.x0).toBeGreaterThan(-0.1);
        expect(def.y0).toBeLessThan(0);
        expect(def.y1).toBeGreaterThan(0);
        continue;
      }
      expect(def.y1, id).toBeGreaterThan(0);
      expect(def.y1, id).toBeLessThanOrEqual(0.08);
      expect(def.x0, id).toBeLessThan(0);
      expect(def.x1, id).toBeGreaterThan(0);
    }
  });
});

describe('Kennarten: Jahreszeit und Tageszeit', () => {
  it('Moorfrosch ist nur im zeitigen Frühling blau, stufenlos und ohne Sprung über den Jahreswechsel', () => {
    expect(moorfrogBlue(null)).toBe(0);
    expect(moorfrogBlue(3.9)).toBeCloseTo(1, 5);
    expect(moorfrogBlue(0.05)).toBeCloseTo(1, 5);
    for (const s of [0.5, 1, 1.5, 2, 2.5, 3, 3.5]) expect(moorfrogBlue(s), String(s)).toBe(0);
    expect(Math.abs(moorfrogBlue(3.9999) - moorfrogBlue(0))).toBeLessThan(1e-3);
    // Ohne Sprünge: kleine Schritte ändern den Wert nur wenig.
    for (let s = 0; s < 4; s += 0.01) expect(Math.abs(moorfrogBlue(s + 0.01) - moorfrogBlue(s)), String(s)).toBeLessThan(0.15);
  });

  it('Haselmaus hält Winterschlaf, der Ziegenmelker ruht im Winter; im Sommer beide munter', () => {
    for (const f of [dormouseAwake, nightjarSeason]) {
      expect(f(null)).toBe(1);
      expect(f(1)).toBe(1);
      expect(f(3)).toBe(0);
      expect(Math.abs(f(3.9999) - f(0))).toBeLessThan(1e-3);
    }
    // „Schläft sieben Monate“: länger als die Amphibien-Winterstarre (2,45 … 3,4).
    expect(dormouseAwake(2.4)).toBe(0);
    expect(dormouseAwake(3.6)).toBe(0);
  });

  it('Schlafbild tagsüber und in der Ruhezeit, nachts wach; andere Arten schlafen nie', () => {
    for (const kind of ['dormouse', 'nightjar']) {
      expect(sleeping(kind, null, 1)).toBe(false);
      expect(sleeping(kind, null, 0)).toBe(true);
      expect(sleeping(kind, 0, 1)).toBe(true);
      expect(sleeping(kind, 1, 1)).toBe(false);
      expect(sleeping(kind, 1, 0)).toBe(true);
      expect(sleeping(kind, 1, Number.NaN)).toBe(false);
      expect(nocturnalPace(kind, null)).toBe(1);
      expect(nocturnalPace(kind, 0)).toBe(0);
      expect(nocturnalPace(kind, 1, 1)).toBe(1);
    }
    for (const kind of ['owl', 'hedgehog', 'lynx', 'moorfrog', 'beaver']) expect(sleeping(kind, 0, 0), kind).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Szene
// ---------------------------------------------------------------------------

const SIZES: [number, number][] = [
  [320, 480],
  [390, 844],
  [800, 600],
  [1200, 700],
  [1920, 1080],
];

function resolver(w: number, h: number, g: number): AnchorResolver {
  const layout = makeLayout(w, h);
  return createAnchorResolver(layout, g, placeMainTree(layout, g, 'oak'));
}

function kennart(id: (typeof KENNART_IDS)[number], slot = 0): SceneAnimal {
  return { id, family: KENNART_HOME[id].family, niche: KENNART_HOME[id].niche, slot, happiness: 1 };
}

describe('Kennarten in der Szene', () => {
  it('Biber und Moorfrosch bleiben mit anderen Amphibien in der Senke und überlappen nicht', () => {
    type Box = { x0: number; x1: number; y0: number; y1: number };
    const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const others: [string, SceneAnimal['family']][] = [
      ['toad', 'amphibians'],
      ['newt', 'amphibians'],
      ['frog', 'amphibians'],
    ];
    for (const [w, h] of SIZES) {
      for (const g of [5, 6, 8]) {
        const anchors = resolver(w, h, g);
        const p = anchors.pond();
        const S = anchors.size;
        for (let n = 0; n <= others.length; n++) {
          for (const first of ['beaver', 'moorfrog'] as const) {
            const scene: SceneAnimal[] = [kennart(first, 0), kennart(first === 'beaver' ? 'moorfrog' : 'beaver', 1)];
            others.slice(0, n).forEach(([id, family], i) => scene.push({ id, family, niche: 'pond', slot: i + 2, happiness: 1 }));
            const boxes = scene.map((a) => animalBounds(a, anchors, [], scene)!);
            const where = `${scene.map((a) => a.id).join(',')} ${w}×${h} g=${g}`;
            for (const b of boxes) {
              expect(b.y0, where).toBeGreaterThanOrEqual(p.lipY - 0.5);
              expect(b.y1, where).toBeLessThanOrEqual(p.y + POND_DEPTH * S + 0.5);
              expect(b.x0, where).toBeGreaterThanOrEqual(p.x - p.halfWidth * S - 0.5);
              expect(b.x1, where).toBeLessThanOrEqual(p.x + p.halfWidth * S + 0.5);
            }
            for (let i = 0; i < boxes.length; i++) {
              for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!), where).toBe(false);
            }
          }
        }
      }
    }
  });

  it('Luchs, Ziegenmelker, Haselmaus und Stachelbart bleiben im Bild', () => {
    for (const [w, h] of SIZES) {
      for (const g of [5, 6, 7, 8]) {
        const anchors = resolver(w, h, g);
        for (const id of ['lynx', 'nightjar', 'dormouse', 'hericium'] as const) {
          for (let slot = 0; slot < 4; slot++) {
            const b = animalBounds(kennart(id, slot), anchors);
            if (!b) continue;
            const where = `${id}/${slot} ${w}×${h} g=${g}`;
            for (const v of [b.x0, b.x1, b.y0, b.y1]) expect(Number.isFinite(v), where).toBe(true);
            expect(b.x0, where).toBeGreaterThanOrEqual(-0.5);
            expect(b.x1, where).toBeLessThanOrEqual(w + 0.5);
            expect(b.y0, where).toBeGreaterThanOrEqual(0);
            expect(b.y1, where).toBeLessThanOrEqual(h);
          }
        }
      }
    }
  });
});

// Canvas-Stub für Sprites und Sticker: zählt Sprites und protokolliert Blits.
interface StubCanvas {
  width: number;
  height: number;
  blits: { alpha: number; src: StubCanvas }[];
  frame: number;
  getContext: () => CanvasRenderingContext2D;
  toDataURL: () => string;
}

let created = 0;
function makeCanvas(): StubCanvas {
  const canvas: StubCanvas = { width: 0, height: 0, blits: [], frame: -1, getContext: () => ctx, toDataURL: () => 'data:' };
  const rec = recorder();
  const props: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(props, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop === 'drawImage') return (src: StubCanvas) => canvas.blits.push({ alpha: Number(target.globalAlpha), src });
      if (prop === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (prop === 'putImageData') return () => undefined;
      if (prop in target) return target[String(prop)];
      return (rec.ctx as unknown as Record<string, unknown>)[String(prop)];
    },
    set(target, prop, value) {
      target[String(prop)] = value;
      (rec.ctx as unknown as Record<string, unknown>)[String(prop)] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

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

describe('Kennarten zeichnen (Sprites gecacht)', () => {
  const f: AnimalFrame = { time: 1, windSkew: 0, reducedMotion: true, dpr: 1, sx: 1, sy: 1 };
  const all = (): SceneAnimal[] => [kennart('dormouse'), kennart('beaver', 0), kennart('moorfrog', 1), kennart('hericium'), kennart('lynx', 0), kennart('nightjar', 1)];

  it('zeichnet alle sechs, im zweiten Frame ohne neue Canvases', () => {
    const anchors = resolver(800, 600, 6);
    const layer = new AnimalLayer();
    const out = makeCanvas();
    layer.draw(out.getContext(), all(), anchors, f, true);
    expect(out.blits.length).toBeGreaterThanOrEqual(6);
    const before = created;
    const again = makeCanvas();
    layer.draw(again.getContext(), all(), anchors, { ...f, time: 2 }, true);
    // Keine neuen Sprites – alles kommt aus dem Cache.
    expect(created - before).toBe(0);
    expect(again.blits.length).toBe(out.blits.length);
  });

  it('Moorfrosch: im Frühling blau ohne Mehraufwand, nur beim Umfärben ein zweiter Blit', () => {
    const anchors = resolver(800, 600, 6);
    const frog = [kennart('moorfrog', 0)];
    const count = (season: number) => {
      const layer = new AnimalLayer();
      const out = makeCanvas();
      layer.draw(out.getContext(), frog, anchors, { ...f, season }, true);
      return out.blits.length;
    };
    const summer = count(1);
    expect(count(3.9)).toBe(summer);
    // Mitten im Umfärben (0,2): Bild 1 halb über Bild 0.
    expect(moorfrogBlue(0.2)).toBeGreaterThan(0.05);
    expect(moorfrogBlue(0.2)).toBeLessThan(0.95);
    expect(count(0.2)).toBe(summer + 1);
  });

  it('Haselmaus schläft tagsüber (eigenes Sprite-Bild), nachts nicht', () => {
    const anchors = resolver(800, 600, 6);
    const mouse = [kennart('dormouse', 0)];
    const sprites = (nocturnal: number) => {
      const layer = new AnimalLayer();
      const out = makeCanvas();
      layer.draw(out.getContext(), mouse, anchors, { ...f, season: 1, nocturnal }, true);
      return out.blits.map((b) => b.src);
    };
    const day = sprites(0);
    const night = sprites(1);
    expect(day.length).toBe(night.length);
    // Gleiche Größe, aber andere Zeichnung (Bild 1 statt Bild 0).
    expect(day.some((s, i) => s !== night[i])).toBe(true);
  });
});

describe('Kennarten als Sticker', () => {
  it('jede Kennart hat einen eigenen, eingepassten Sticker (Moorfrosch blau)', () => {
    expect(stickerPose('moorfrog')).toBe(1);
    for (const id of ['dormouse', 'beaver', 'hericium', 'lynx', 'nightjar']) expect(stickerPose(id), id).toBe(0);
    for (const id of KENNART_IDS) {
      const frame = stickerFrame(id)!;
      expect(frame, id).toBeDefined();
      const fit = stickerFit(frame, 64);
      for (const v of [fit.scale, fit.ox, fit.oy]) expect(Number.isFinite(v), id).toBe(true);
      const c = renderSpeciesSticker(id, 64, { dpr: 2 }) as unknown as StubCanvas;
      expect(c.width, id).toBe(128);
      expect(renderSpeciesSticker(id, 64, { dpr: 2 }), id).toBe(c);
      for (const variant of ['muted', 'silhouette'] as const) expect(() => renderSpeciesSticker(id, 48, { variant, family: KENNART_HOME[id].family })).not.toThrow();
    }
  });
});
