import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPECIES } from '../src/content/species';
import { VISITORS } from '../src/content/visitors';
import { animalKinds, spriteDefOf } from '../src/render/animals';
import {
  clearStickerCache,
  renderSpeciesSticker,
  renderSpeciesStickerUrl,
  SILHOUETTE_FILL,
  STICKER_CACHE_MAX,
  STICKER_FILL,
  STICKER_FILL_SLENDER,
  stickerCacheSize,
  stickerFit,
  stickerFrame,
  stickerKind,
  stickerPose,
} from '../src/render/sticker';

/** Canvas-Stub, der alle Zeichenaufrufe protokolliert. */
interface StubCanvas {
  width: number;
  height: number;
  calls: string[];
  getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
  toDataURL: (type?: string) => string;
  encodes?: number;
}

function makeCanvas(): StubCanvas {
  const canvas: StubCanvas = {
    width: 0,
    height: 0,
    calls: [],
    getContext: () => ctx,
    // PNG-Kodieren: protokolliert und eindeutig je Canvas (Größe + Zeichenbefehle).
    toDataURL: (type?: string) => {
      canvas.encodes = (canvas.encodes ?? 0) + 1;
      return `data:${type ?? 'image/png'};${canvas.width}x${canvas.height};${canvas.calls.length}`;
    },
  };
  const store: Record<string | symbol, unknown> = {};
  const helper = { addColorStop: (o: number, c: string) => canvas.calls.push(`stop(${o},${c})`), data: new Uint8ClampedArray(16) };
  const fmt = (a: unknown) => (typeof a === 'number' ? a.toFixed(4) : typeof a === 'string' ? a : typeof a);
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        canvas.calls.push(`${String(prop)}(${args.map(fmt).join(',')})`);
        return helper;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      canvas.calls.push(`${String(prop)}=${fmt(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

const asStub = (c: HTMLCanvasElement) => c as unknown as StubCanvas;

beforeEach(() => {
  clearStickerCache();
  vi.stubGlobal('document', { createElement: () => makeCanvas() });
});
afterEach(() => {
  clearStickerCache();
  vi.unstubAllGlobals();
});

/** Alle Arten (inkl. Lebensräume) und alle Gäste mit ihrer Gattung. */
const ALL_IDS: [string, (typeof SPECIES)[number]['genus']][] = [
  ...SPECIES.map((s): [string, (typeof SPECIES)[number]['genus']] => [s.id, s.genus]),
  ...VISITORS.map((v): [string, (typeof SPECIES)[number]['genus']] => [v.id, v.genus]),
];

/** Gattungs-Ersatzzeichnungen, die keine Art als eigene Zeichnung nutzt. */
const FALLBACK_ONLY = ['bird', 'insect', 'mammal', 'mushroom', 'bracket', 'reptile'];

/** Zeichenbefehle ab dem ersten Einpassen (ohne Größe des Canvas). */
const paintCalls = (c: HTMLCanvasElement) => asStub(c).calls;

describe('stickerKind: jede Art und jeder Gast hat eine eigene Zeichnung', () => {
  it('jede ID findet ihre Zeichnung auch ohne Gattung, unabhängig vom Gattungs-Ersatz', () => {
    for (const [id, genus] of ALL_IDS) {
      const kind = stickerKind(id);
      expect(kind, id).not.toBeNull();
      expect(stickerKind(id, genus), id).toBe(kind);
      expect(FALLBACK_ONLY, id).not.toContain(kind);
      expect(spriteDefOf(kind!), id).toBeDefined();
    }
  });

  it('keine zwei IDs teilen sich eine Zeichnung', () => {
    const kinds = ALL_IDS.map(([id]) => stickerKind(id));
    expect(new Set(kinds).size).toBe(ALL_IDS.length);
  });

  it('unbekannte Arten: mit Gattung deren Ersatz, ohne Gattung null', () => {
    expect(stickerKind('unbekannt', 'birds')).toBe('bird');
    expect(stickerKind('unbekannt', 'reptiles')).toBe('reptile');
    expect(stickerKind('unbekannt')).toBeNull();
    expect(stickerKind('toString')).toBeNull();
    expect(stickerKind('__proto__')).toBeNull();
  });
});

describe('renderSpeciesSticker', () => {
  it('jede Art zeichnet ein nicht leeres, eigenes Bild in der gewünschten Pixelgröße', () => {
    const seen = new Map<string, string>();
    for (const [id] of ALL_IDS) {
      const c = renderSpeciesSticker(id, 48, { dpr: 2 });
      expect(c.width, id).toBe(96);
      expect(c.height, id).toBe(96);
      const calls = paintCalls(c);
      expect(calls.some((s) => s.startsWith('fill(') || s.startsWith('stroke(') || s.startsWith('fillRect(')), id).toBe(true);
      const sig = calls.join('|');
      expect(seen.get(sig), `${id} gleicht ${seen.get(sig)}`).toBeUndefined();
      seen.set(sig, id);
    }
  });

  it('ist deterministisch: gleiche Eingabe → gleiche Zeichenbefehle, auch nach Leeren des Caches', () => {
    for (const variant of ['color', 'muted', 'silhouette'] as const) {
      for (const [id] of ALL_IDS) {
        const a = paintCalls(renderSpeciesSticker(id, 40, { dpr: 1.5, variant })).join('|');
        clearStickerCache();
        const b = paintCalls(renderSpeciesSticker(id, 40, { dpr: 1.5, variant })).join('|');
        expect(b, `${id} ${variant}`).toBe(a);
      }
    }
  });

  it('unbekannte ID ohne Gattung: leeres, durchsichtiges Bild in passender Größe', () => {
    const c = renderSpeciesSticker('gibt-es-nicht', 32);
    expect(c.width).toBe(32);
    expect(paintCalls(c)).toEqual([]);
  });

  it('robust bei schrägen Größen und Pixeldichten', () => {
    expect(renderSpeciesSticker('robin', 0).width).toBe(1);
    expect(renderSpeciesSticker('robin', Number.NaN).width).toBe(1);
    expect(renderSpeciesSticker('robin', 1e6).width).toBe(1024);
    expect(renderSpeciesSticker('robin', 10, { dpr: 0 }).width).toBe(10);
    expect(renderSpeciesSticker('robin', 10, { dpr: Number.NaN }).width).toBe(10);
  });

  it('muted: entsättigte Kopie des farbigen Stickers', () => {
    const color = renderSpeciesSticker('fox', 48);
    const muted = renderSpeciesSticker('fox', 48, { variant: 'muted' });
    expect(muted).not.toBe(color);
    expect(muted.width).toBe(color.width);
    expect(asStub(muted).calls).toContain('drawImage(object,0.0000,0.0000)');
    expect(asStub(muted).calls.some((s) => s.startsWith('putImageData('))).toBe(true);
  });

  it('silhouette: nach dem Zeichnen alles in einer einzigen Farbe (source-in)', () => {
    for (const [id] of ALL_IDS) {
      const calls = paintCalls(renderSpeciesSticker(id, 48, { variant: 'silhouette' }));
      const at = calls.lastIndexOf('globalCompositeOperation=source-in');
      expect(at, id).toBeGreaterThan(0);
      const after = calls.slice(at + 1);
      // Genau eine Füllfarbe, eine Fläche über das ganze Bild – danach nichts mehr in Farbe.
      expect(after.filter((s) => s.startsWith('fillStyle=')), id).toEqual([`fillStyle=${SILHOUETTE_FILL}`]);
      expect(after.filter((s) => /^(fill|stroke|drawImage|fillText|putImageData)\(/.test(s)), id).toEqual([]);
      expect(after, id).toContain('fillRect(0.0000,0.0000,48.0000,48.0000)');
      expect(calls.slice(0, at), id).not.toContain('globalAlpha=0.0000');
    }
  });
});

describe('Sticker-Cache (LRU)', () => {
  it('gleiche Art, Größe, Pixeldichte und Variante → dasselbe Canvas', () => {
    const a = renderSpeciesSticker('owl', 48, { dpr: 2 });
    expect(renderSpeciesSticker('owl', 48, { dpr: 2 })).toBe(a);
    expect(renderSpeciesSticker('owl', 48, { dpr: 2, family: 'birds' })).toBe(a);
    // Gleiche Gerätepixel ergeben dasselbe Bild.
    expect(renderSpeciesSticker('owl', 96, { dpr: 1 })).toBe(a);
    expect(renderSpeciesSticker('owl', 48, { dpr: 1 })).not.toBe(a);
    expect(renderSpeciesSticker('owl', 48, { dpr: 2, variant: 'silhouette' })).not.toBe(a);
    expect(renderSpeciesSticker('bat', 48, { dpr: 2 })).not.toBe(a);
  });

  it('ein Treffer zeichnet nichts neu', () => {
    const created = vi.fn(() => makeCanvas());
    vi.stubGlobal('document', { createElement: created });
    renderSpeciesSticker('deer', 64, { variant: 'muted' });
    const n = created.mock.calls.length;
    expect(n).toBe(2); // farbig + matt
    for (let i = 0; i < 10; i++) renderSpeciesSticker('deer', 64, { variant: 'muted' });
    renderSpeciesSticker('deer', 64);
    expect(created.mock.calls.length).toBe(n);
  });

  it('verdrängt bei Überlauf das am längsten unbenutzte Bild, nie mehr als STICKER_CACHE_MAX', () => {
    const first = renderSpeciesSticker('robin', 10);
    const second = renderSpeciesSticker('robin', 11);
    for (let s = 12; s < 10 + STICKER_CACHE_MAX; s++) renderSpeciesSticker('robin', s);
    expect(stickerCacheSize()).toBe(STICKER_CACHE_MAX);
    // „first“ frisch benutzen – dann trifft die Verdrängung „second“.
    expect(renderSpeciesSticker('robin', 10)).toBe(first);
    renderSpeciesSticker('robin', 500);
    expect(stickerCacheSize()).toBe(STICKER_CACHE_MAX);
    expect(renderSpeciesSticker('robin', 10)).toBe(first);
    expect(renderSpeciesSticker('robin', 11)).not.toBe(second);
    for (let s = 600; s < 600 + 3 * STICKER_CACHE_MAX; s++) renderSpeciesSticker('bee', s % 1024);
    expect(stickerCacheSize()).toBeLessThanOrEqual(STICKER_CACHE_MAX);
  });
});

describe('stickerFit', () => {
  const frames = [
    ...animalKinds().map((k) => spriteDefOf(k)!),
    ...ALL_IDS.map(([id]) => stickerFrame(stickerKind(id)!)!),
    { x0: -1, y0: -1, x1: 1, y1: 1 },
    { x0: 0, y0: 0, x1: 4, y1: 1 },
    { x0: -0.1, y0: -3, x1: 0.1, y1: 0 },
  ];

  it('passt jeden Rahmen mittig ein, ohne Überstand und mit gleichem Seitenverhältnis', () => {
    for (const size of [24, 48, 96, 137]) {
      for (const f of frames) {
        const { scale, ox, oy } = stickerFit(f, size);
        const left = ox + f.x0 * scale;
        const right = ox + f.x1 * scale;
        const top = oy + f.y0 * scale;
        const bottom = oy + f.y1 * scale;
        const w = right - left;
        const h = bottom - top;
        // ein Maßstab für beide Achsen → Seitenverhältnis bleibt
        expect(w / h).toBeCloseTo((f.x1 - f.x0) / (f.y1 - f.y0), 9);
        // zentriert
        expect((left + right) / 2).toBeCloseTo(size / 2, 9);
        expect((top + bottom) / 2).toBeCloseTo(size / 2, 9);
        // längere Seite 80 % (schlanke bis 90 %), alles im Quadrat und im Kreis
        const long = Math.max(w, h);
        expect(long).toBeGreaterThanOrEqual(size * STICKER_FILL - 1e-9);
        expect(long).toBeLessThanOrEqual(size * STICKER_FILL_SLENDER + 1e-9);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(right).toBeLessThanOrEqual(size);
        expect(bottom).toBeLessThanOrEqual(size);
        if (long / Math.min(w, h) >= 3) expect(Math.hypot(w, h)).toBeLessThan(size);
      }
    }
  });

  it('kompakte Zeichnungen füllen genau 80 %', () => {
    const { scale } = stickerFit({ x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 }, 100);
    expect(scale).toBeCloseTo(80, 9);
  });

  it('Sticker-Rahmen liegen nahe am Rahmen der Zeichnung und Posen gibt es wirklich', () => {
    for (const [id] of ALL_IDS) {
      const kind = stickerKind(id)!;
      const def = spriteDefOf(kind)!;
      const f = stickerFrame(kind)!;
      expect(f.x1, id).toBeGreaterThan(f.x0);
      expect(f.y1, id).toBeGreaterThan(f.y0);
      expect(f.x0, id).toBeGreaterThanOrEqual(def.x0 - 0.1);
      expect(f.y0, id).toBeGreaterThanOrEqual(def.y0 - 0.1);
      expect(f.x1, id).toBeLessThanOrEqual(def.x1 + 0.1);
      expect(f.y1, id).toBeLessThanOrEqual(def.y1 + 0.1);
      expect(stickerPose(kind), id).toBeLessThan(def.frames ?? 1);
    }
  });
});

describe('renderSpeciesStickerUrl (Album-Bilder als <img>, R3)', () => {
  it('kodiert jedes gecachte Bild genau einmal als PNG und liefert dann dieselbe URL', () => {
    const url = renderSpeciesStickerUrl('fox', 48, { dpr: 2 });
    expect(url.startsWith('data:image/png')).toBe(true);
    const canvas = asStub(renderSpeciesSticker('fox', 48, { dpr: 2 }));
    expect(canvas.encodes).toBe(1);
    expect(renderSpeciesStickerUrl('fox', 48, { dpr: 2 })).toBe(url);
    expect(canvas.encodes).toBe(1);
  });

  it('gleiche Gerätepixel → gleiche URL, andere Variante → eigenes Bild', () => {
    const a = renderSpeciesStickerUrl('robin', 48, { dpr: 2 });
    expect(renderSpeciesStickerUrl('robin', 96, { dpr: 1 })).toBe(a);
    const silhouette = renderSpeciesStickerUrl('robin', 48, { dpr: 2, variant: 'silhouette' });
    expect(asStub(renderSpeciesSticker('robin', 48, { dpr: 2, variant: 'silhouette' })).encodes).toBe(1);
    expect(silhouette.startsWith('data:image/png')).toBe(true);
  });

  it('fällt mit dem Bild aus dem LRU: danach neu gezeichnet und neu kodiert', () => {
    renderSpeciesStickerUrl('owl', 32);
    const first = asStub(renderSpeciesSticker('owl', 32));
    clearStickerCache();
    renderSpeciesStickerUrl('owl', 32);
    const second = asStub(renderSpeciesSticker('owl', 32));
    expect(second).not.toBe(first);
    expect(second.encodes).toBe(1);
  });
});
