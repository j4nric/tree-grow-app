/**
 * Zeichnet die Szene (Himmel, Boden, Wurzeln, Baum/Wald, Tiere) auf ein Canvas.
 * Liest nur den Wachstumswert (und optional Tiere) – verändert nie den Spielstand.
 *
 * Aufbau in Ebenen, die in Offscreen-Canvases gecacht werden:
 *   0. Kulisse: Himmel, Hügel, Erde, Grasnarbe             (neu nur bei Größenänderung)
 *   1. Hintergrund: Kulisse + Wurzeln, Samen               (neu bei growth, aus 0 kopiert)
 *   2. Wolken: kleine Sprites, pro Frame nur verschoben
 *   3. Nachbarbäume (Hain/Wald), blasser                   (neu bei growth)
 *      – mit Begleitpflanzen nur noch als ferne Kulisse
 *   4. Begleitpflanzen: Bäume, Sträucher, Blumen, Moose    (neu bei geänderter Liste
 *      oder Größe, beim Wachsen höchstens alle PLANT_REDRAW_STEP; eigener Cache, der
 *      beim Neuaufbau in Ebene 3 kopiert wird – pro Frame nur eine Kopie)
 *   5. Hauptbaum                                           (neu bei growth)
 *   6. Tiere: gecachte Sprites je Art, pro Frame nur drawImage
 * Wind ist nur eine Scherung der gecachten Baum-Ebenen um die Bodenlinie; Tiere am
 * Baum werden um denselben Betrag verschoben. Tiere liegen immer über den Pflanzen.
 * Größenänderungen werden entprellt: Bis die neue Größe ~150 ms stabil ist, wird das
 * alte Bild skaliert gezeigt.
 */

import { createAnchorResolver, type AnchorResolver } from './anchors';
import { AnimalLayer, type AnimalFrame, type SceneAnimal } from './animals';
import { layoutFlora, type PlacedPlant, type ScenePlant } from './flora';
import { paintPlant } from './flora-paint';
import { makeLayout, placeMainTree, placeRoots, placeTree, sproutScale, type Layout, type PlacedTree } from './layout';
import { paintLeaves, paintWood, type LeafPalette, type WoodColors } from './plant';
import { ResizeGate } from './resize';
import { createClouds, drawClouds, paintGrass, paintHills, paintSky, paintSoil, SKY, type Cloud } from './scenery';
import { clamp01, mix, mulberry32, smooth01 } from './util';

export type { AnimalFamily, SceneAnimal } from './animals';
export { nicheAnchors, SCENE_NICHES, type NicheAnchor, type SceneNiche } from './anchors';
export { SCENE_PLANT_GROUPS, type ScenePlant, type ScenePlantGroup } from './flora';

export interface SceneInput {
  /** Kontinuierlicher Wachstumswert aus core/formulas.ts `growth()`. */
  growth: number;
  /** Laufzeit in Sekunden, für sanftes Wiegen im Wind und ziehende Wolken. */
  time: number;
  /** Tiere in den Nischen des Hauptbaums (Standard: keine). */
  animals?: readonly SceneAnimal[];
  /**
   * Begleitpflanzen um den Hauptbaum (optional). Sobald die Liste übergeben wird (auch
   * leer), erscheinen die automatischen Nachbarbäume ab „Hain“ nur noch als ferne
   * Kulisse. Ohne Angabe sieht die Szene aus wie bisher.
   */
  plants?: readonly ScenePlant[];
  /** Bewegung reduzieren (prefers-reduced-motion): Tiere ruhen, kein Wind, Wolken stehen. */
  reducedMotion?: boolean;
}

/** Ab dieser Änderung des Wachstums werden die Ebenen neu gezeichnet. */
const REDRAW_STEP = 0.005;
/** Kleinere Änderungen werden spätestens nach dieser Zeit (s) nachgezogen. */
const REDRAW_SETTLE_SECONDS = 1;
/** Höchstens so oft (s) neu zeichnen – bei schnellem Wachstum bleibt die Bildrate stabil. */
const REDRAW_MIN_INTERVAL = 0.2;
/**
 * Ersatz für die Zeitregeln, falls die Zeit steht (Pause, feste Demo-Zeit): nach so vielen
 * Frames wird eine Wachstumsänderung trotzdem nachgezogen (klein / groß).
 */
const REDRAW_SETTLE_FRAMES = 60;
const REDRAW_MIN_FRAMES = 12;
/** Ab diesem Wachstumswert (Stufe „Hain“) erscheinen weitere Bäume. */
const GROVE_GROWTH = 5;
/** Pflanzen-Ebene beim Wachsen höchstens nach dieser Änderung neu zeichnen. */
const PLANT_REDRAW_STEP = 0.02;
/** Beim Nachziehen (Wachstum steht) Pflanzen nur ab dieser Änderung neu zeichnen. */
const PLANT_SETTLE_STEP = 0.002;

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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Alles, was zu einer Canvas-Größe gehört. */
interface SizeCache {
  key: string;
  /** Gerätepixel des Canvas. */
  pw: number;
  ph: number;
  dpr: number;
  layout: Layout;
  /** Statische Kulisse (Himmel, Hügel, Erde): hängt nur von der Größe ab. */
  scenery: HTMLCanvasElement;
  /** Grasnarbe als schmaler Streifen ab Gerätepixel-Zeile `grassTop` (liegt über den Wurzeln). */
  grass: HTMLCanvasElement;
  grassTop: number;
  background: HTMLCanvasElement;
  back: HTMLCanvasElement;
  front: HTMLCanvasElement;
  clouds: Cloud[];
  /** Belegte Bereiche der Baum-Ebenen (Gerätepixel) – nur diese werden kopiert. */
  backRect: Rect | null;
  frontRect: Rect | null;
  /** Begleitpflanzen (erst angelegt, wenn es welche gibt). */
  plants: HTMLCanvasElement | null;
  plantsRect: Rect | null;
  /** Wachstum, mit dem die Pflanzen gezeichnet wurden (NaN = nie). */
  plantsGrowth: number;
  /** Mit Pflanzenliste gezeichnet (Nachbarbäume nur als Kulisse)? */
  withPlants: boolean;
  /** Fußpunkte der Begleitbäume (für Pilzfäden unter der Erde). */
  companionXs: number[];
  growth: number;
  drawnAt: number;
  /** Frames seit dem letzten Neuzeichnen der Ebenen. */
  framesSinceDraw: number;
  anchors: AnchorResolver | null;
}

interface Cache {
  size: SizeCache | null;
  /** Entprellt Größenänderungen. */
  gate: ResizeGate;
  /** Tier-Ebene mit Sprite-Cache und vorberechnetem Plan. */
  animals: AnimalLayer;
  spriteKey: number;
  /** Merkmale der zuletzt gezeichneten Pflanzenliste. */
  plantSig: PlantSig[] | null;
}

/**
 * Merkmale einer Pflanze, von denen die Pflanzen-Ebene abhängt – normalisiert, damit
 * ungültige Werte (NaN) nicht bei jedem Vergleich als „geändert“ gelten.
 */
interface PlantSig {
  id: string;
  group: string;
  slot: number;
  /** Versorgung, mit der zuletzt gezeichnet wurde. */
  vigor: number;
}

/** Erst ab dieser Änderung der Versorgung neu zeichnen (Hysterese: kein Flackern an Grenzen). */
const VIGOR_REDRAW_STEP = 0.05;

function normSlot(slot: number): number {
  return Number.isFinite(slot) ? Math.floor(slot) : -1;
}

function normVigor(v: number): number {
  return Number.isFinite(v) ? clamp01(v) : 1;
}

function plantSig(p: ScenePlant): PlantSig {
  return { id: String(p.id), group: String(p.group), slot: normSlot(p.slot), vigor: normVigor(p.vigor) };
}

function samePlants(sig: PlantSig[] | null, plants: readonly ScenePlant[] | undefined): boolean {
  if (!plants) return sig === null;
  if (!sig || sig.length !== plants.length) return false;
  for (let i = 0; i < sig.length; i++) {
    const p = plants[i]!;
    const s = sig[i]!;
    if (s.id !== String(p.id) || s.group !== String(p.group) || s.slot !== normSlot(p.slot)) return false;
    // Versorgung vergleicht mit dem zuletzt gezeichneten Wert, nicht mit festen Stufen.
    const v = normVigor(p.vigor);
    if (Math.abs(v - s.vigor) >= VIGOR_REDRAW_STEP || (v !== s.vigor && (v === 0 || v === 1))) return false;
  }
  return true;
}

/** Wiederverwendete Frame-Daten für die Tier-Ebene (keine Allokation pro Frame). */
const animalFrame: AnimalFrame = { time: 0, windSkew: 0, reducedMotion: false, dpr: 1, sx: 1, sy: 1 };

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

/** Ein Cache je Canvas – so können mehrere Szenen nebeneinander laufen (z. B. Demo). */
const caches = new WeakMap<HTMLCanvasElement, Cache>();

export function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, input: SceneInput): void {
  if (width <= 0 || height <= 0) return;
  const pw = ctx.canvas.width;
  const ph = ctx.canvas.height;
  if (pw <= 0 || ph <= 0) return;
  const dpr = pw / width || 1;
  const g = Math.max(0, Number.isFinite(input.growth) ? input.growth : 0);
  // Ungültige Zeit (NaN/∞) wie 0 behandeln; die Frame-Zählung übernimmt dann.
  const time = Number.isFinite(input.time) ? input.time : 0;

  let cache = caches.get(ctx.canvas);
  if (!cache) {
    cache = { size: null, gate: new ResizeGate(), animals: new AnimalLayer(), spriteKey: -1, plantSig: null };
    caches.set(ctx.canvas, cache);
  }

  // Größenänderung entprellen: altes Bild skaliert zeigen, bis die Größe stabil ist.
  let sc = cache.size;
  const key = sc && sc.pw === pw && sc.ph === ph && sc.layout.width === width && sc.layout.height === height ? sc.key : sizeKey(pw, ph, width, height);
  if (cache.gate.shouldRebuild(key, sc ? sc.key : null, input.time)) {
    sc = buildSizeCache(sc, key, width, height, pw, ph, dpr);
    cache.size = sc;
  }
  sc = sc!;

  const delta = Math.abs(g - sc.growth);
  const since = time - sc.drawnAt;
  const frames = ++sc.framesSinceDraw;
  const clockReset = since < 0;
  const due =
    (delta >= REDRAW_STEP && (since >= REDRAW_MIN_INTERVAL || frames >= REDRAW_MIN_FRAMES)) ||
    (delta > 0 && (since > REDRAW_SETTLE_SECONDS || frames >= REDRAW_SETTLE_FRAMES));
  // Neue Pflanzenliste: alles neu (Nachbarbäume, Pilzfäden und Pflanzen hängen davon ab).
  const plantsChanged = !samePlants(cache.plantSig, input.plants);
  if (Number.isNaN(sc.growth) || clockReset || due || plantsChanged || sc.withPlants !== (input.plants !== undefined)) {
    // Pflanzen beim Wachsen höchstens alle PLANT_REDRAW_STEP; beim Nachziehen (kleine
    // Änderung) exakt – aber nur, wenn sich ihr Wachstum tatsächlich merklich geändert hat.
    const plantDelta = Math.abs(g - sc.plantsGrowth);
    const settle = delta < REDRAW_STEP;
    const redrawPlants =
      plantsChanged ||
      Number.isNaN(sc.plantsGrowth) ||
      plantDelta >= PLANT_REDRAW_STEP ||
      (settle && plantDelta >= PLANT_SETTLE_STEP);
    // Die Signatur hält fest, womit die Pflanzen zuletzt gezeichnet wurden.
    if (redrawPlants) cache.plantSig = input.plants ? input.plants.map(plantSig) : null;
    renderLayers(sc, g, input.plants, redrawPlants);
    sc.growth = g;
    sc.drawnAt = time;
    sc.framesSinceDraw = 0;
  }

  // Sprites einer alten Tiergröße/Pixeldichte verwerfen (numerischer Schlüssel, kein String pro Frame).
  const spriteKey = (sc.anchors?.size ?? 0) * 100_000 + Math.round(sc.dpr * 1000);
  if (cache.spriteKey !== spriteKey) {
    cache.animals.sprites.clear();
    cache.spriteKey = spriteKey;
  }

  compose(ctx, sc, cache.animals, input, time, pw / sc.pw, ph / sc.ph);
}

function sizeKey(pw: number, ph: number, width: number, height: number): string {
  return `${pw}x${ph}/${width}x${height}`;
}

/** Setzt die gecachten Ebenen zusammen – nur drawImage und günstige Transformationen. */
function compose(
  ctx: CanvasRenderingContext2D,
  sc: SizeCache,
  layer: AnimalLayer,
  input: SceneInput,
  time: number,
  sx: number,
  sy: number,
): void {
  const { dpr, layout } = sc;
  const reduced = input.reducedMotion === true;
  ctx.save();
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.drawImage(sc.background, 0, 0);
  drawClouds(ctx, sc.clouds, layout.width, reduced ? 0 : time, dpr);
  const groundPx = layout.groundY * dpr;
  if (sc.backRect) {
    const kb = reduced ? 0 : windSkew(time, 1.9) * 0.7;
    ctx.setTransform(sx, 0, sx * kb, sy, -sx * kb * groundPx, 0);
    drawRect(ctx, sc.back, sc.backRect);
  }
  const k = reduced ? 0 : windSkew(time, 0);
  if (sc.frontRect) {
    ctx.setTransform(sx, 0, sx * k, sy, -sx * k * groundPx, 0);
    drawRect(ctx, sc.front, sc.frontRect);
  }
  const animals = input.animals;
  if (animals && animals.length > 0 && sc.anchors) {
    const f = animalFrame;
    f.time = time;
    f.windSkew = k;
    f.reducedMotion = reduced;
    f.dpr = dpr;
    f.sx = sx;
    f.sy = sy;
    layer.draw(ctx, animals, sc.anchors, f);
  }
  ctx.restore();
}

/** Legt die Ebenen für eine Canvas-Größe an und zeichnet die statische Kulisse. */
function buildSizeCache(
  old: SizeCache | null,
  key: string,
  width: number,
  height: number,
  pw: number,
  ph: number,
  dpr: number,
): SizeCache {
  const layout = makeLayout(width, height);
  const sized = (c: HTMLCanvasElement | undefined) => {
    const canvas = c ?? document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    return canvas;
  };
  const sc: SizeCache = {
    key,
    pw,
    ph,
    dpr,
    layout,
    scenery: sized(old?.scenery),
    grass: old?.grass ?? document.createElement('canvas'),
    grassTop: 0,
    background: sized(old?.background),
    back: sized(old?.back),
    front: sized(old?.front),
    clouds: createClouds(width, layout.groundY, dpr),
    backRect: null,
    frontRect: null,
    plants: old?.plants ? sized(old.plants) : null,
    plantsRect: null,
    plantsGrowth: NaN,
    withPlants: false,
    companionXs: [],
    growth: NaN,
    drawnAt: 0,
    framesSinceDraw: 0,
    anchors: null,
  };

  const sky = layerContext(sc.scenery, dpr);
  paintSky(sky, width, layout.groundY);
  paintHills(sky, width, height, layout.groundY);
  paintSoil(sky, width, height, layout.groundY);

  // Grasnarbe nur als Streifen um die Bodenlinie (Halme reichen bis 1,2 × bladeH hinauf).
  const above = Math.max(4, height * 0.016) * 1.2 + 2;
  const below = Math.max(4, height * 0.014) + 2;
  sc.grassTop = Math.max(0, Math.floor((layout.groundY - above) * dpr));
  sc.grass.width = pw;
  sc.grass.height = Math.max(1, Math.min(ph, Math.ceil((layout.groundY + below) * dpr)) - sc.grassTop);
  const gc = sc.grass.getContext('2d')!;
  gc.setTransform(1, 0, 0, 1, 0, 0);
  gc.clearRect(0, 0, sc.grass.width, sc.grass.height);
  gc.setTransform(dpr, 0, 0, dpr, 0, -sc.grassTop);
  paintGrass(gc, width, height, layout.groundY);
  return sc;
}

/** Sanftes, unregelmäßiges Wiegen als Scherfaktor (oben verschoben, Fuß fest). */
function windSkew(time: number, phase: number): number {
  return (
    0.009 * Math.sin(time * 0.55 + phase) +
    0.004 * Math.sin(time * 1.37 + phase * 1.7) +
    0.0015 * Math.sin(time * 3.1 + phase * 0.6)
  );
}

function layerContext(canvas: HTMLCanvasElement, dpr: number): CanvasRenderingContext2D {
  const c = canvas.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
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

/**
 * Sichtbare Nachbarbäume: erscheinen nacheinander als kleine Setzlinge und wachsen stetig.
 * Mit Begleitpflanzen (`backdrop`) nur die hintere Reihe – als ferne Kulisse.
 */
function neighborTrees(g: number, layout: Layout, backdrop = false): NeighborTree[] {
  if (g < GROVE_GROWTH) return [];
  const result: NeighborTree[] = [];
  NEIGHBORS.forEach((n, i) => {
    const appear = GROVE_GROWTH + i * 0.16;
    if (g <= appear || (backdrop && !n.far)) return;
    const cap = n.far ? 3.6 : 4.2;
    result.push({ x: layout.cx + n.x * layout.width, g: 1 + Math.min(cap, (g - appear) * 2.2), far: n.far, seed: 1000 + i });
  });
  return result;
}

function renderLayers(sc: SizeCache, g: number, plants: readonly ScenePlant[] | undefined, redrawPlants: boolean): void {
  const { dpr, layout } = sc;
  const withPlants = plants !== undefined;
  const neighbors = neighborTrees(g, layout, withPlants);

  // Hauptbaum zuerst berechnen – Wurzeln und Tier-Ankerpunkte richten sich nach ihm.
  const scale1 = sproutScale(layout);
  const main = placeMainTree(layout, g);
  sc.anchors = createAnchorResolver(layout, g, main);

  // --- Begleitpflanzen (eigene Ebene) ---
  if (redrawPlants || sc.withPlants !== withPlants) {
    const flora = plants && plants.length > 0 ? layoutFlora(layout, g, plants, { main, anchors: sc.anchors }) : [];
    sc.companionXs = flora.filter((p) => p.tree).map((p) => p.x);
    sc.plantsRect = renderPlants(sc, flora);
    sc.plantsGrowth = g;
    sc.withPlants = withPlants;
  }

  // --- Hintergrund: statische Kulisse kopieren, Wurzeln, Grasnarbe darüber ---
  const bg = layerContext(sc.background, dpr);
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.drawImage(sc.scenery, 0, 0);
  bg.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintUnderground(bg, layout, g, scale1, main, withPlants ? sc.companionXs : neighbors.map((n) => n.x));
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.drawImage(sc.grass, 0, sc.grassTop);

  // --- Nachbarbäume: hintere Reihe blasser als die vordere ---
  const back = layerContext(sc.back, dpr);
  let backRect: Rect | null = null;
  for (const far of [true, false]) {
    // Als Kulisse hinter Begleitpflanzen: blasser und etwas kleiner.
    const haze = withPlants ? 0.62 : far ? 0.5 : 0.25;
    const baseY = layout.groundY - layout.height * (far ? 0.035 : 0.012);
    for (const n of neighbors) {
      if (n.far !== far) continue;
      const maxH = (baseY - layout.top) * (withPlants ? 0.42 : far ? 0.5 : 0.66);
      const tree = placeTree(n.g, n.seed, n.x, baseY, maxH, layout.width * 0.14);
      backRect = unionRect(backRect, ...treeBounds(tree));
      const palette = PALETTES[n.seed % PALETTES.length]!;
      paintTree(back, tree, hazeWood(WOOD, haze), hazePalette(palette, haze));
    }
  }

  // --- Hauptbaum bzw. Keimling ---
  const front = layerContext(sc.front, dpr);
  const { pw, ph } = sc;
  sc.backRect = toDeviceRect(backRect, dpr, pw, ph);
  // Begleitpflanzen aus ihrem Cache vor die Kulisse kopieren: pro Frame bleibt es bei
  // einer einzigen Kopie für die ganze hintere Ebene (wiegt sich gemeinsam im Wind).
  const pr = sc.plantsRect;
  if (sc.plants && pr) {
    back.setTransform(1, 0, 0, 1, 0, 0);
    drawRect(back, sc.plants, pr);
    sc.backRect = unionRect(sc.backRect, pr.x, pr.y, pr.x + pr.w, pr.y + pr.h);
  }
  if (main) {
    sc.frontRect = toDeviceRect(unionRect(null, ...treeBounds(main)), dpr, pw, ph);
    const lignin = smooth01((g - 1) / 2);
    paintTree(front, main, mixWood(STEM, WOOD, lignin), PALETTES[0]!);
    // Keimblätter verblassen, während die ersten Blattbüschel wachsen.
    const coty = 1 - clamp01((g - 1) / 0.8);
    if (coty > 0) {
      paintCotyledons(front, main.x + main.geo.tipX * main.scale, main.y + main.geo.tipY * main.scale, scale1 * 0.36 * coty);
    }
  } else {
    paintSprout(front, layout, g, scale1);
    sc.frontRect = toDeviceRect(
      unionRect(null, layout.cx - scale1, layout.groundY - scale1 * 1.4, layout.cx + scale1, layout.groundY + 4),
      dpr,
      pw,
      ph,
    );
  }
}

/** Zeichnet die Begleitpflanzen in ihre Ebene; gibt den belegten Bereich (Gerätepixel) zurück. */
function renderPlants(sc: SizeCache, flora: PlacedPlant[]): Rect | null {
  if (flora.length === 0) {
    if (sc.plants) layerContext(sc.plants, sc.dpr);
    return null;
  }
  if (!sc.plants) {
    sc.plants = document.createElement('canvas');
    sc.plants.width = sc.pw;
    sc.plants.height = sc.ph;
  }
  const ctx = layerContext(sc.plants, sc.dpr);
  let rect: Rect | null = null;
  for (const p of flora) {
    paintPlant(ctx, p);
    const top = p.tree ? p.y + p.tree.geo.minY * p.tree.scale : p.y - p.h * 1.6;
    rect = unionRect(rect, p.x - p.hw * 1.15, top - 4, p.x + p.hw * 1.15, p.y + 6);
  }
  return toDeviceRect(rect, sc.dpr, sc.pw, sc.ph);
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
  /** Fußpunkte der Bäume ringsum, die das Pilzgeflecht verbindet. */
  treeXs: number[],
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
    const roots = placeRoots(layout, g, main);
    paintWood(ctx, roots.geo, cx, groundY, roots.scale, roots.widthScale, ROOT);

    // Pilzfäden verbinden im Wald die Wurzeln der Bäume.
    const fungus = 0.4 * smooth01(g - 6);
    if (fungus > 0) {
      const rand = mulberry32(5);
      ctx.strokeStyle = '#efe6cf';
      ctx.globalAlpha = fungus;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (const nx of treeXs) {
        const y1 = groundY + soilH * (0.3 + rand() * 0.4);
        const y2 = groundY + soilH * (0.15 + rand() * 0.3);
        const x1 = cx + (nx - cx) * 0.25;
        const mx = (x1 + nx) / 2;
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(mx, y1 + soilH * (rand() - 0.3) * 0.4, mx, y2 - soilH * rand() * 0.2, nx, y2);
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
