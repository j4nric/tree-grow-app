/**
 * Zeichnet die Szene (Himmel, Boden, Wurzeln, Baum/Wald) auf ein Canvas.
 * Liest nur den Wachstumswert – verändert nie den Spielstand.
 *
 * Aufbau in Ebenen, die in Offscreen-Canvases gecacht werden:
 *   1. Hintergrund: Himmel, Hügel, Erde, Wurzeln, Samen   (neu bei Größe/growth)
 *   2. Wolken: kleine Sprites, pro Frame nur verschoben
 *   3. Nachbarbäume (Hain/Wald), blasser                   (neu bei Größe/growth)
 *   4. Hauptbaum                                           (neu bei Größe/growth)
 * Wind ist nur eine Scherung der gecachten Baum-Ebenen um die Bodenlinie.
 */

import {
  buildRoots,
  buildTree,
  paintLeaves,
  paintWood,
  trunkWidthOf,
  type LeafPalette,
  type PlantGeometry,
  type WoodColors,
} from './plant';
import { createClouds, drawClouds, paintGrass, paintHills, paintSky, paintSoil, SKY, type Cloud } from './scenery';
import { clamp01, hash2, mix, mulberry32, smooth01 } from './util';

export interface SceneInput {
  /** Kontinuierlicher Wachstumswert aus core/formulas.ts `growth()`. */
  growth: number;
  /** Laufzeit in Sekunden, für sanftes Wiegen im Wind und ziehende Wolken. */
  time: number;
}

/** Ab dieser Änderung des Wachstums werden die Ebenen neu gezeichnet. */
const REDRAW_STEP = 0.005;
/** Kleinere Änderungen werden spätestens nach dieser Zeit (s) nachgezogen. */
const REDRAW_SETTLE_SECONDS = 1;
/** Höchstens so oft (s) neu zeichnen – bei schnellem Wachstum bleibt die Bildrate stabil. */
const REDRAW_MIN_INTERVAL = 0.2;
/** Ab diesem Wachstumswert (Stufe „Hain“) erscheinen weitere Bäume. */
const GROVE_GROWTH = 5;
const MAIN_SEED = 7;

const WOOD: WoodColors = { base: '#6b4a30', shade: '#563a25', light: '#866244' };
/** Junger, noch grüner Trieb – verholzt in den ersten Stufen allmählich. */
const STEM: WoodColors = { base: '#7a9a45', shade: '#62803a', light: '#93b35a' };
const ROOT: WoodColors = { base: '#9b7651', shade: '#6f5236', light: '#b8936a' };
const SEED_COLOR = '#8a5a2b';

const PALETTES: LeafPalette[] = [
  { shadow: '#2c5230', tones: ['#3a6e39', '#4d8942', '#68a14e'], highlight: '#a7cf7c' },
  { shadow: '#30562b', tones: ['#4a7934', '#5e903e', '#7ea94f'], highlight: '#bcd886' },
  { shadow: '#284f40', tones: ['#356a4b', '#468059', '#5f9a69'], highlight: '#9fcb9b' },
];

/** Nachbarbäume: Position (Anteil der Breite ab Mitte) und Tiefe; Reihenfolge = Erscheinen. */
const NEIGHBORS: { x: number; far: boolean }[] = [
  { x: -0.25, far: false },
  { x: 0.28, far: false },
  { x: -0.41, far: true },
  { x: 0.43, far: true },
  { x: -0.13, far: true },
  { x: 0.15, far: true },
  { x: -0.39, far: false },
  { x: 0.4, far: false },
  { x: -0.5, far: true },
  { x: 0.34, far: true },
  { x: -0.31, far: true },
  { x: 0.52, far: false },
  { x: -0.53, far: false },
  { x: 0.05, far: true },
  { x: -0.04, far: true },
  { x: 0.23, far: true },
];

interface Layout {
  width: number;
  height: number;
  dpr: number;
  groundY: number;
  /** Höchster erlaubter Punkt der Bäume. */
  top: number;
  /** Verfügbare Höhe über dem Boden. */
  avail: number;
  soilH: number;
  cx: number;
}

interface Cache {
  key: string;
  layout: Layout | null;
  background: HTMLCanvasElement;
  back: HTMLCanvasElement;
  front: HTMLCanvasElement;
  clouds: Cloud[];
  /** Belegte Bereiche der Baum-Ebenen (Gerätepixel) – nur diese werden kopiert. */
  backRect: Rect | null;
  frontRect: Rect | null;
  growth: number;
  drawnAt: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Vereinigt einen Bereich (CSS-Pixel) mit `r` und gibt das Ergebnis zurück. */
function unionRect(r: Rect | null, x0: number, y0: number, x1: number, y1: number): Rect {
  if (!r) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const nx = Math.min(r.x, x0);
  const ny = Math.min(r.y, y0);
  return { x: nx, y: ny, w: Math.max(r.x + r.w, x1) - nx, h: Math.max(r.y + r.h, y1) - ny };
}

/** CSS-Bereich → ganzzahliger Gerätepixel-Bereich innerhalb des Canvas. */
function toDeviceRect(r: Rect | null, dpr: number, pw: number, ph: number): Rect | null {
  if (!r) return null;
  const pad = 4;
  const x0 = Math.max(0, Math.floor((r.x - pad) * dpr));
  const y0 = Math.max(0, Math.floor((r.y - pad) * dpr));
  const x1 = Math.min(pw, Math.ceil((r.x + r.w + pad) * dpr));
  const y1 = Math.min(ph, Math.ceil((r.y + r.h + pad) * dpr));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function drawRect(ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, r: Rect): void {
  ctx.drawImage(layer, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
}

let cache: Cache | null = null;

export function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, input: SceneInput): void {
  if (width <= 0 || height <= 0) return;
  const pw = ctx.canvas.width;
  const ph = ctx.canvas.height;
  const dpr = pw / width || 1;
  const g = Math.max(0, input.growth);

  if (!cache) {
    cache = {
      key: '',
      layout: null,
      background: document.createElement('canvas'),
      back: document.createElement('canvas'),
      front: document.createElement('canvas'),
      clouds: [],
      backRect: null,
      frontRect: null,
      growth: NaN,
      drawnAt: 0,
    };
  }
  const key = `${pw}x${ph}/${width}x${height}`;
  if (cache.key !== key) {
    cache.key = key;
    const layout = makeLayout(width, height, dpr);
    cache.layout = layout;
    for (const c of [cache.background, cache.back, cache.front]) {
      c.width = pw;
      c.height = ph;
    }
    cache.clouds = createClouds(width, layout.groundY, dpr);
    cache.growth = NaN;
  }
  const layout = cache.layout!;

  const delta = Math.abs(g - cache.growth);
  const since = input.time - cache.drawnAt;
  const clockReset = since < 0;
  const due = (delta >= REDRAW_STEP && since >= REDRAW_MIN_INTERVAL) || (delta > 0 && since > REDRAW_SETTLE_SECONDS);
  if (Number.isNaN(cache.growth) || clockReset || due) {
    renderLayers(cache, layout, g);
    cache.growth = g;
    cache.drawnAt = input.time;
  }

  // Zusammensetzen in Gerätepixeln – nur drawImage und günstige Transformationen.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(cache.background, 0, 0);
  drawClouds(ctx, cache.clouds, width, input.time, dpr);
  const groundPx = layout.groundY * dpr;
  if (cache.backRect) {
    const k = windSkew(input.time, 1.9) * 0.7;
    ctx.setTransform(1, 0, k, 1, -k * groundPx, 0);
    drawRect(ctx, cache.back, cache.backRect);
  }
  if (cache.frontRect) {
    const k = windSkew(input.time, 0);
    ctx.setTransform(1, 0, k, 1, -k * groundPx, 0);
    drawRect(ctx, cache.front, cache.frontRect);
  }
  ctx.restore();
}

/** Sanftes, unregelmäßiges Wiegen als Scherfaktor (oben verschoben, Fuß fest). */
function windSkew(time: number, phase: number): number {
  return (
    0.009 * Math.sin(time * 0.55 + phase) +
    0.004 * Math.sin(time * 1.37 + phase * 1.7) +
    0.0015 * Math.sin(time * 3.1 + phase * 0.6)
  );
}

function makeLayout(width: number, height: number, dpr: number): Layout {
  const groundY = Math.round(height * 0.8);
  const top = Math.max(8, height * 0.045);
  return {
    width,
    height,
    dpr,
    groundY,
    top,
    avail: groundY - top,
    soilH: height - groundY,
    cx: width / 2,
  };
}

function layerContext(canvas: HTMLCanvasElement, dpr: number): CanvasRenderingContext2D {
  const c = canvas.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

/** Zielhöhe eines Baums als Anteil der verfügbaren Höhe – wächst stetig mit g. */
function heightFraction(g: number): number {
  return 0.13 + 0.82 * Math.pow(clamp01((g - 1) / 7), 0.9);
}

interface PlacedTree {
  geo: PlantGeometry;
  scale: number;
  x: number;
  y: number;
}

/**
 * Baut einen Baum und skaliert ihn so, dass er die Zielhöhe erreicht, aber nie über
 * `maxHeight` (inkl. Blätter) hinaus- oder breiter als `maxHalfWidth` je Seite wird.
 */
function placeTree(g: number, seed: number, x: number, y: number, maxHeight: number, maxHalfWidth: number): PlacedTree {
  const geo = buildTree(g, seed);
  let segTop = 0;
  for (const s of geo.segments) segTop = Math.min(segTop, s.y1, s.y2);
  const target = maxHeight * heightFraction(g);
  const half = Math.max(-geo.minX, geo.maxX, 1e-6);
  const scale = Math.min(target / Math.max(-segTop, 1e-6), maxHeight / Math.max(-geo.minY, 1e-6), maxHalfWidth / half);
  return { geo, scale, x, y };
}

/** Umriss eines platzierten Baums in CSS-Pixeln: [x0, y0, x1, y1]. */
function treeBounds(t: PlacedTree): [number, number, number, number] {
  return [t.x + t.geo.minX * t.scale, t.y + t.geo.minY * t.scale, t.x + t.geo.maxX * t.scale, t.y + 4];
}

function paintTree(ctx: CanvasRenderingContext2D, t: PlacedTree, wood: WoodColors, palette: LeafPalette): void {
  paintWood(ctx, t.geo, t.x, t.y, t.scale, 1, wood);
  paintLeaves(ctx, t.geo, t.x, t.y, t.scale, palette);
}

function hazePalette(p: LeafPalette, haze: number): LeafPalette {
  return {
    shadow: mix(p.shadow, SKY.haze, haze),
    tones: [mix(p.tones[0], SKY.haze, haze), mix(p.tones[1], SKY.haze, haze), mix(p.tones[2], SKY.haze, haze)],
    highlight: mix(p.highlight, SKY.haze, haze),
  };
}

function mixWood(a: WoodColors, b: WoodColors, t: number): WoodColors {
  return { base: mix(a.base, b.base, t), shade: mix(a.shade, b.shade, t), light: mix(a.light, b.light, t) };
}

function hazeWood(w: WoodColors, haze: number): WoodColors {
  const h = { base: SKY.haze, shade: SKY.haze, light: SKY.haze };
  return mixWood(w, h, haze);
}

interface NeighborTree {
  x: number;
  g: number;
  far: boolean;
  seed: number;
}

/** Sichtbare Nachbarbäume: erscheinen nacheinander als kleine Setzlinge und wachsen stetig. */
function neighborTrees(g: number, layout: Layout): NeighborTree[] {
  if (g < GROVE_GROWTH) return [];
  const result: NeighborTree[] = [];
  NEIGHBORS.forEach((n, i) => {
    const appear = GROVE_GROWTH + i * 0.16;
    if (g <= appear) return;
    const cap = n.far ? 3.6 : 4.2;
    result.push({ x: layout.cx + n.x * layout.width, g: 1 + Math.min(cap, (g - appear) * 2.2), far: n.far, seed: 1000 + i });
  });
  return result;
}

function renderLayers(cache: Cache, layout: Layout, g: number): void {
  const { dpr } = layout;
  const neighbors = neighborTrees(g, layout);

  // Hauptbaum zuerst berechnen – Wurzeln richten sich nach seiner Stammdicke.
  const scale1 = placeTree(1, MAIN_SEED, 0, 0, layout.avail, layout.width * 0.5).scale;
  const main = g >= 1 ? placeTree(g, MAIN_SEED, layout.cx, layout.groundY, layout.avail, layout.width * 0.5) : null;

  // --- Hintergrund ---
  const bg = layerContext(cache.background, dpr);
  paintSky(bg, layout.width, layout.groundY);
  paintHills(bg, layout.width, layout.height, layout.groundY);
  paintSoil(bg, layout.width, layout.height, layout.groundY);
  paintUnderground(bg, layout, g, scale1, main, neighbors);
  paintGrass(bg, layout.width, layout.height, layout.groundY);

  // --- Nachbarbäume: hintere Reihe blasser als die vordere ---
  const back = layerContext(cache.back, dpr);
  let backRect: Rect | null = null;
  for (const far of [true, false]) {
    const haze = far ? 0.5 : 0.25;
    const baseY = layout.groundY - layout.height * (far ? 0.035 : 0.012);
    for (const n of neighbors) {
      if (n.far !== far) continue;
      const maxH = (baseY - layout.top) * (far ? 0.5 : 0.66);
      const tree = placeTree(n.g, n.seed, n.x, baseY, maxH, layout.width * 0.14);
      backRect = unionRect(backRect, ...treeBounds(tree));
      const palette = PALETTES[n.seed % PALETTES.length]!;
      paintTree(back, tree, hazeWood(WOOD, haze), hazePalette(palette, haze));
    }
  }

  // --- Hauptbaum bzw. Keimling ---
  const front = layerContext(cache.front, dpr);
  const pw = cache.front.width;
  const ph = cache.front.height;
  cache.backRect = toDeviceRect(backRect, dpr, pw, ph);
  if (main) {
    cache.frontRect = toDeviceRect(unionRect(null, ...treeBounds(main)), dpr, pw, ph);
    const lignin = smooth01((g - 1) / 2);
    paintTree(front, main, mixWood(STEM, WOOD, lignin), PALETTES[0]!);
    // Keimblätter verblassen, während die ersten Blattbüschel wachsen.
    const coty = 1 - clamp01((g - 1) / 0.8);
    if (coty > 0) {
      paintCotyledons(front, main.x + main.geo.tipX * main.scale, main.y + main.geo.tipY * main.scale, scale1 * 0.36 * coty);
    }
  } else {
    paintSprout(front, layout, g, scale1);
    cache.frontRect = toDeviceRect(
      unionRect(null, layout.cx - scale1, layout.groundY - scale1 * 1.4, layout.cx + scale1, layout.groundY + 4),
      dpr,
      pw,
      ph,
    );
  }
}

/** Keimling oberhalb der Erde (g < 1). */
function paintSprout(ctx: CanvasRenderingContext2D, layout: Layout, g: number, scale1: number): void {
  const h = scale1 * clamp01((g - 0.35) / 0.65);
  if (h <= 0.5) return;
  const x = layout.cx;
  const y = layout.groundY;
  ctx.strokeStyle = STEM.base;
  ctx.lineWidth = Math.max(1.5, scale1 * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  // Der junge Trieb ist anfangs gebogen und richtet sich dann auf.
  const hook = (1 - clamp01((g - 0.35) / 0.4)) * h * 0.5;
  ctx.quadraticCurveTo(x - h * 0.08, y - h * 0.6, x + hook, y - h);
  ctx.stroke();
  const leaf = smooth01((g - 0.55) / 0.45);
  if (leaf > 0) paintCotyledons(ctx, x + hook, y - h, scale1 * 0.36 * leaf);
}

/** Zwei Keimblätter an der Triebspitze. */
function paintCotyledons(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  if (size < 0.5) return;
  const palette = PALETTES[0]!;
  for (const side of [-1, 1]) {
    const angle = side * 0.45 - (side < 0 ? Math.PI : 0);
    const cx = x + Math.cos(angle) * size * 0.5;
    const cy = y + Math.sin(angle) * size * 0.5 - size * 0.08;
    ctx.fillStyle = palette.tones[1];
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.55, size * 0.26, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.tones[2];
    ctx.beginPath();
    ctx.ellipse(cx - size * 0.05, cy - size * 0.06, size * 0.35, size * 0.12, angle, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Samen, Keimwurzel, Wurzelwerk und (im Wald) Pilzfäden unter der Erde. */
function paintUnderground(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  g: number,
  scale1: number,
  main: PlacedTree | null,
  neighbors: NeighborTree[],
): void {
  const { cx, groundY, soilH } = layout;
  const seedY = groundY + soilH * 0.14;
  const seedR = Math.max(4, Math.min(scale1 * 0.1, soilH * 0.08));

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, groundY, layout.width, soilH);
  ctx.clip();
  ctx.lineCap = 'round';

  if (g < 1) {
    // Keimwurzel nach unten, Trieb nach oben bis zur Oberfläche.
    const root = soilH * 0.27 * smooth01(g / 0.8);
    if (root > 0.5) {
      ctx.strokeStyle = ROOT.light;
      ctx.lineWidth = Math.max(1.2, seedR * 0.35);
      ctx.beginPath();
      ctx.moveTo(cx, seedY);
      ctx.quadraticCurveTo(cx + seedR * 0.8, seedY + root * 0.5, cx - seedR * 0.2, seedY + root);
      ctx.stroke();
    }
    const shoot = clamp01(g / 0.35);
    if (shoot > 0) {
      ctx.strokeStyle = '#b5c27f';
      ctx.lineWidth = Math.max(1.5, scale1 * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx, seedY);
      ctx.lineTo(cx, seedY - (seedY - groundY + 2) * shoot);
      ctx.stroke();
    }
  }

  if (main) {
    // Wurzeln wachsen mit dem Baum in die Tiefe und Breite.
    const depth = 1 + (g - 1) * 0.75;
    const roots = buildRoots(depth, hash2(MAIN_SEED, 77));
    const reach = soilH * (0.38 + 0.5 * smooth01((g - 1) / 5));
    const half = Math.max(-roots.minX, roots.maxX, 1e-6);
    const scale = Math.min(reach / Math.max(roots.maxY, 1e-6), (layout.width * 0.46) / half);
    const trunkPx = trunkWidthOf(g) * main.scale;
    paintWood(ctx, roots, cx, groundY, scale, (trunkPx * 0.8) / scale, ROOT);

    // Pilzfäden verbinden im Wald die Wurzeln der Bäume.
    const fungus = 0.4 * smooth01(g - 6);
    if (fungus > 0) {
      const rand = mulberry32(5);
      ctx.strokeStyle = '#efe6cf';
      ctx.globalAlpha = fungus;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (const n of neighbors) {
        const y1 = groundY + soilH * (0.3 + rand() * 0.4);
        const y2 = groundY + soilH * (0.15 + rand() * 0.3);
        const x1 = cx + (n.x - cx) * 0.25;
        const mx = (x1 + n.x) / 2;
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(mx, y1 + soilH * (rand() - 0.3) * 0.4, mx, y2 - soilH * rand() * 0.2, n.x, y2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Die Samenschale bleibt noch kurz sichtbar und verblasst dann.
  const seedAlpha = 1 - clamp01((g - 1) / 0.5);
  if (seedAlpha > 0) {
    ctx.globalAlpha = seedAlpha;
    ctx.fillStyle = SEED_COLOR;
    ctx.beginPath();
    ctx.ellipse(cx, seedY, seedR * 1.4, seedR, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b07a44';
    ctx.beginPath();
    ctx.ellipse(cx - seedR * 0.4, seedY - seedR * 0.35, seedR * 0.55, seedR * 0.25, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
