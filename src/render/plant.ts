/**
 * Geometrie und Zeichnung eines Baums (Stamm, Äste, Blattbüschel) und seiner Wurzeln.
 *
 * Die Geometrie entsteht in normierten Einheiten (Stammlänge = 1, Stammfuß bei 0/0,
 * y nach unten) und wird erst beim Zeichnen skaliert. So lässt sich der Baum
 * passgenau in jede Canvas-Größe einpassen.
 *
 * Stufenloses Wachstum: Die Verzweigungstiefe `depth` ist eine Kommazahl. Die äußerste
 * Astebene wächst anteilig heraus, Blattbüschel blenden weich ein und an inneren Ästen
 * wieder aus. Jeder Ast hat einen eigenen Seed (Eltern-Seed + Index), daher bleiben alle
 * bestehenden Äste beim Wachsen exakt an ihrem Platz.
 */

import { clamp01, hash2, mulberry32, smooth01 } from './util';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Breite am Anfang / Ende. */
  w1: number;
  w2: number;
}

export interface LeafCluster {
  x: number;
  y: number;
  r: number;
  level: number;
  /** Zufallswerte für Form und Farbton (0..1). */
  a: number;
  b: number;
}

/**
 * Ein Ast als Ganzes (zwei Teilstücke) mit Verweisen auf seine Kinder – für Ankerpunkte
 * (Tiere in der Krone). Kinder: [0] = Leittrieb, danach Seitenäste.
 */
export interface Branch {
  level: number;
  x1: number;
  y1: number;
  mx: number;
  my: number;
  x2: number;
  y2: number;
  w1: number;
  w2: number;
  children: number[];
}

export interface PlantGeometry {
  segments: Segment[];
  /** Nur beim Baum gefüllt (bei Wurzeln leer). Index 0 = Stamm. */
  branches: Branch[];
  leaves: LeafCluster[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxLevel: number;
  /** Spitze des ersten Stammstücks (für Keimblätter). */
  tipX: number;
  tipY: number;
}

export interface WoodColors {
  base: string;
  shade: string;
  light: string;
}

export interface LeafPalette {
  shadow: string;
  tones: [string, string, string];
  highlight: string;
}

function emptyGeometry(): PlantGeometry {
  return { segments: [], branches: [], leaves: [], minX: 0, maxX: 0, minY: 0, maxY: 0, maxLevel: 0, tipX: 0, tipY: 0 };
}

function extend(geo: PlantGeometry, x: number, y: number, r = 0): void {
  if (x - r < geo.minX) geo.minX = x - r;
  if (x + r > geo.maxX) geo.maxX = x + r;
  if (y - r < geo.minY) geo.minY = y - r;
  if (y + r > geo.maxY) geo.maxY = y + r;
}

/** Verzweigungstiefe eines Baums mit Wachstum g (≥ 1). */
export function treeDepth(g: number): number {
  return Math.max(1, g);
}

/** Normierte Stammbreite (relativ zur Stammlänge 1) – der Stamm wird mit dem Alter dicker. */
export function trunkWidthOf(g: number): number {
  return 0.05 + 0.055 * (treeDepth(g) - 1);
}

/**
 * Baut die Baumgeometrie. `g` ≥ 1: 1 = Keimling-Stängel, 8 = uralter Baum.
 */
export function buildTree(g: number, seed: number): PlantGeometry {
  const depth = treeDepth(g);
  const geo = emptyGeometry();
  const trunkWidth = trunkWidthOf(g);
  // Stammfuß: kurze, breite Verdickung, damit der Stamm organisch im Boden steht.
  const flare = clamp01((depth - 2) / 3);
  if (flare > 0) {
    geo.segments.push({ x1: 0, y1: 0, x2: 0, y2: -0.16, w1: trunkWidth * (1 + 0.55 * flare), w2: trunkWidth * 0.97 });
  }
  growBranch(geo, depth, seed, 0, 0, 0, -Math.PI / 2, 1, trunkWidth);
  return geo;
}

function growBranch(
  geo: PlantGeometry,
  depth: number,
  seed: number,
  level: number,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
): number {
  const grow = clamp01(depth - level);
  if (grow <= 0) return -1;
  const rand = mulberry32(seed);
  // Immer gleich viele Zufallswerte ziehen.
  const rv: number[] = [];
  for (let i = 0; i < 10; i++) rv.push(rand());

  // Ast in zwei leicht geknickten Teilstücken – wirkt weniger „gezeichnet“.
  const len = length * grow;
  const bend = (rv[0]! - 0.5) * (level === 0 ? 0.12 : 0.4);
  const a1 = angle + bend * 0.5;
  // Zum Licht streben: äußere Äste biegen sich leicht nach oben.
  const lift = level === 0 ? 0 : 0.14;
  const a2 = a1 - bend + (-Math.PI / 2 - a1) * lift;
  const mx = x + Math.cos(a1) * len * 0.5;
  const my = y + Math.sin(a1) * len * 0.5;
  const ex = mx + Math.cos(a2) * len * 0.5;
  const ey = my + Math.sin(a2) * len * 0.5;
  const wMid = width * 0.86;
  const wEnd = width * 0.72;
  geo.segments.push({ x1: x, y1: y, x2: mx, y2: my, w1: width, w2: wMid });
  geo.segments.push({ x1: mx, y1: my, x2: ex, y2: ey, w1: wMid, w2: wEnd });
  const index = geo.branches.length;
  const branch: Branch = { level, x1: x, y1: y, mx, my, x2: ex, y2: ey, w1: width, w2: wEnd, children: [] };
  geo.branches.push(branch);
  // Astbreite mit einrechnen (am Fuß inkl. Verdickung).
  extend(geo, x, y, width * 0.8);
  extend(geo, ex, ey, wEnd * 0.5);
  extend(geo, mx, my, wMid * 0.5);
  if (level > geo.maxLevel) geo.maxLevel = level;
  if (level === 0) {
    geo.tipX = ex;
    geo.tipY = ey;
  }

  // Blattbüschel: blenden beim Herauswachsen ein und an inneren Ästen wieder aus.
  const leafIn = level === 0 ? clamp01(depth - 1) : clamp01((depth - level - 0.1) / 0.9);
  const leafOut = clamp01((level === 0 ? 3 : level + 5.2) - depth);
  const f = smooth01(leafIn) * leafOut;
  if (f > 0.01) {
    const r = (length * (level === 0 ? 0.3 : 0.46) + 0.08) * f;
    addLeaf(geo, ex, ey, r, level, rv[7]!, rv[8]!);
    if (level >= 2 && length > 0.12) {
      addLeaf(geo, (mx + ex) / 2, (my + ey) / 2 + r * 0.15, r * 0.8, level, rv[8]!, rv[9]!);
    }
  }

  if (depth - (level + 1) <= 0) return index;

  const childSeed = (i: number) => hash2(seed, i + 1);
  // Leittrieb setzt den Ast fort …
  const leader = growBranch(
    geo,
    depth,
    childSeed(0),
    level + 1,
    ex,
    ey,
    a2 + (rv[1]! - 0.5) * 0.35,
    length * (level === 0 ? 0.62 : 0.72 + rv[2]! * 0.12),
    wEnd * 0.8,
  );
  if (leader >= 0) branch.children.push(leader);
  // … Seitenäste zweigen ab (1–2, am Stamm immer 2).
  const sides = level === 0 || rv[3]! < 0.5 ? 2 : 1;
  const firstSide = rv[4]! < 0.5 ? 1 : -1;
  const spread = level <= 1 ? 0.75 : 0.6;
  for (let i = 0; i < sides; i++) {
    const s = i === 0 ? firstSide : -firstSide;
    const r1 = i === 0 ? rv[5]! : rv[6]!;
    const side = growBranch(
      geo,
      depth,
      childSeed(i + 1),
      level + 1,
      ex,
      ey,
      a2 + s * (spread + r1 * 0.4),
      length * (level === 0 ? 0.62 : 0.6 + r1 * 0.16),
      wEnd * 0.62,
    );
    if (side >= 0) branch.children.push(side);
  }
  return index;
}

function addLeaf(geo: PlantGeometry, x: number, y: number, r: number, level: number, a: number, b: number): void {
  geo.leaves.push({ x, y, r, level, a, b });
  extend(geo, x, y, r * 1.1);
}

/**
 * Wurzelgeometrie (nach unten, y positiv). `depth` ≥ 1 wächst wie beim Baum stufenlos.
 */
export function buildRoots(depth: number, seed: number): PlantGeometry {
  const geo = emptyGeometry();
  // Pfahlwurzel und zwei flache Seitenwurzeln, die später hinzukommen.
  growRoot(geo, depth, hash2(seed, 1), 0, 0, 0, Math.PI / 2, 1, 1);
  growRoot(geo, depth - 0.6, hash2(seed, 2), 0, -0.05, 0, Math.PI / 2 - 1.05, 0.9, 0.8);
  growRoot(geo, depth - 0.9, hash2(seed, 3), 0, 0.05, 0, Math.PI / 2 + 1.1, 0.85, 0.8);
  return geo;
}

function growRoot(
  geo: PlantGeometry,
  depth: number,
  seed: number,
  level: number,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
): void {
  const grow = clamp01(depth - level);
  if (grow <= 0) return;
  const rand = mulberry32(seed);
  const rv: number[] = [];
  for (let i = 0; i < 6; i++) rv.push(rand());
  const len = length * grow;
  const a1 = angle + (rv[0]! - 0.5) * 0.5;
  // Wurzeln folgen leicht der Schwerkraft.
  const a2 = a1 + (rv[1]! - 0.5) * 0.6 + (Math.PI / 2 - a1) * 0.12;
  const mx = x + Math.cos(a1) * len * 0.5;
  const my = y + Math.sin(a1) * len * 0.5;
  const ex = mx + Math.cos(a2) * len * 0.5;
  const ey = my + Math.sin(a2) * len * 0.5;
  const wEnd = width * 0.74 * (0.5 + 0.5 * grow);
  geo.segments.push({ x1: x, y1: y, x2: mx, y2: my, w1: width, w2: (width + wEnd) / 2 });
  geo.segments.push({ x1: mx, y1: my, x2: ex, y2: ey, w1: (width + wEnd) / 2, w2: wEnd });
  extend(geo, ex, ey);
  extend(geo, mx, my);
  if (depth - (level + 1) <= 0 || level >= 6) return;
  growRoot(geo, depth, hash2(seed, 1), level + 1, ex, ey, a2 + (rv[2]! - 0.5) * 0.4, length * 0.72, wEnd * 0.9);
  const s = rv[3]! < 0.5 ? 1 : -1;
  growRoot(geo, depth, hash2(seed, 2), level + 1, ex, ey, a2 + s * (0.6 + rv[4]! * 0.5), length * 0.6, wEnd * 0.7);
}

// ---------------------------------------------------------------------------
// Zeichnen
// ---------------------------------------------------------------------------

/**
 * Fügt ein Viereck mit einheitlichem Umlaufsinn hinzu. Alle Formen eines Pfads drehen
 * gleich herum (wie `arc()` im Uhrzeigersinn), sonst entstünden bei der Füllregel
 * „nonzero“ Löcher, wo sich Formen überlappen.
 */
function quad(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): void {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) + ((cx - ax) * (dy - ay) - (cy - ay) * (dx - ax));
  ctx.moveTo(ax, ay);
  if (area >= 0) {
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.lineTo(dx, dy);
  } else {
    ctx.lineTo(dx, dy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(bx, by);
  }
  ctx.closePath();
}

/** Unterhalb dieser halben Breite (px) werden Äste als einfache Linien gezeichnet. */
const THIN_HALF_WIDTH = 1.6;
/**
 * Formen pro Füllaufruf. Sehr große Pfade mit vielen überlappenden Teilformen sind beim
 * Rastern teuer; in kleinen Portionen geht es um ein Vielfaches schneller.
 */
const BATCH = 48;

/** Zeichnet Stamm/Äste bzw. Wurzeln als sich verjüngende Formen mit Licht und Schatten. */
export function paintWood(
  ctx: CanvasRenderingContext2D,
  geo: PlantGeometry,
  ox: number,
  oy: number,
  scale: number,
  widthScale: number,
  colors: WoodColors,
): void {
  const ws = scale * widthScale;
  // Dünne Zweige als Linien, nach Breite gruppiert – deutlich schneller als Flächen.
  const thin = new Map<number, number[]>();
  // Grundform
  ctx.fillStyle = colors.base;
  ctx.beginPath();
  let batch = 0;
  for (const s of geo.segments) {
    const x1 = ox + s.x1 * scale;
    const y1 = oy + s.y1 * scale;
    const x2 = ox + s.x2 * scale;
    const y2 = oy + s.y2 * scale;
    const h1 = Math.max((s.w1 * ws) / 2, 0.4);
    const h2 = Math.max((s.w2 * ws) / 2, 0.35);
    if (h1 < THIN_HALF_WIDTH) {
      const bucket = Math.max(3, Math.round((h1 + h2) * 4)) / 4;
      let list = thin.get(bucket);
      if (!list) thin.set(bucket, (list = []));
      list.push(x1, y1, x2, y2);
      continue;
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    quad(ctx, x1 + nx * h1, y1 + ny * h1, x2 + nx * h2, y2 + ny * h2, x2 - nx * h2, y2 - ny * h2, x1 - nx * h1, y1 - ny * h1);
    ctx.moveTo(x2 + h2, y2);
    ctx.arc(x2, y2, h2, 0, Math.PI * 2);
    // Am Fuß (0/0) keine Rundung – der Stamm steht gerade auf dem Boden.
    if (s.x1 !== 0 || s.y1 !== 0) {
      ctx.moveTo(x1 + h1, y1);
      ctx.arc(x1, y1, h1, 0, Math.PI * 2);
    }
    if (++batch >= BATCH) {
      ctx.fill();
      ctx.beginPath();
      batch = 0;
    }
  }
  ctx.fill();
  ctx.strokeStyle = colors.base;
  ctx.lineCap = 'round';
  for (const [width, list] of thin) {
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 4) {
      ctx.moveTo(list[i]!, list[i + 1]!);
      ctx.lineTo(list[i + 2]!, list[i + 3]!);
    }
    ctx.stroke();
  }

  // Schattenseite (Licht kommt von links oben) und Glanzkante – nur bei dicken Ästen.
  ctx.fillStyle = colors.shade;
  ctx.beginPath();
  for (const s of geo.segments) {
    const h1 = (s.w1 * ws) / 2;
    const h2 = (s.w2 * ws) / 2;
    if (h1 < 1.2) continue;
    addSideStripe(ctx, s, ox, oy, scale, h1, h2, 1, 0.3, 1);
  }
  ctx.fill();
  ctx.fillStyle = colors.light;
  ctx.beginPath();
  for (const s of geo.segments) {
    const h1 = (s.w1 * ws) / 2;
    const h2 = (s.w2 * ws) / 2;
    if (h1 < 2.2) continue;
    addSideStripe(ctx, s, ox, oy, scale, h1, h2, -1, 0.35, 0.7);
  }
  ctx.fill();
}

/** Streifen entlang einer Astseite: `side` 1 = abgewandt vom Licht, -1 = zum Licht. */
function addSideStripe(
  ctx: CanvasRenderingContext2D,
  s: Segment,
  ox: number,
  oy: number,
  scale: number,
  h1: number,
  h2: number,
  side: number,
  from: number,
  to: number,
): void {
  const x1 = ox + s.x1 * scale;
  const y1 = oy + s.y1 * scale;
  const x2 = ox + s.x2 * scale;
  const y2 = oy + s.y2 * scale;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  let nx = -dy / l;
  let ny = dx / l;
  // Normale zur Schattenseite (nach rechts unten) ausrichten.
  if (nx * 0.8 + ny * 0.6 < 0) {
    nx = -nx;
    ny = -ny;
  }
  nx *= side;
  ny *= side;
  quad(
    ctx,
    x1 + nx * h1 * from,
    y1 + ny * h1 * from,
    x2 + nx * h2 * from,
    y2 + ny * h2 * from,
    x2 + nx * h2 * to,
    y2 + ny * h2 * to,
    x1 + nx * h1 * to,
    y1 + ny * h1 * to,
  );
}

/**
 * Kreise im aktuellen Pfad seit dem letzten `beginPath` – wird mit jedem neuen Pfad
 * auf 0 gesetzt, damit die Portionen (und damit das Bild bei halbtransparenten Lichtern)
 * nicht davon abhängen, was vorher gezeichnet wurde.
 */
let circleCount = 0;

/** Kreis zum aktuellen Pfad hinzufügen; füllt portionsweise (siehe BATCH). */
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (++circleCount >= BATCH * 2) {
    ctx.fill();
    ctx.beginPath();
    circleCount = 0;
  }
}

/**
 * Fester Zufallswert eines Blattbüschels (0–1) – entscheidet, wann es im Herbst fällt:
 * Bei einer Laubmenge `amount` < 1 wird es nur gezeichnet, wenn `leafKeep < amount`.
 */
export function leafKeep(l: LeafCluster): number {
  const v = l.a * 7.31 + l.b * 3.17;
  return v - Math.floor(v);
}

/**
 * Zeichnet die Blattbüschel: je Büschel ein dunkler Schatten, drei Blattballen in einem
 * von drei Grüntönen (oben heller, innen dunkler) und ein Glanzlicht. Innere Ebenen
 * zuerst, damit äußere Büschel Schatten auf die inneren werfen.
 */

export function paintLeaves(
  ctx: CanvasRenderingContext2D,
  geo: PlantGeometry,
  ox: number,
  oy: number,
  scale: number,
  palette: LeafPalette,
  /** Laubmenge 0–1 (Jahreszeiten): weniger Büschel, per Seed stabil; 1 = alle. */
  amount = 1,
): void {
  if (geo.leaves.length === 0 || amount <= 0) return;
  let top = Infinity;
  let bottom = -Infinity;
  for (const leaf of geo.leaves) {
    if (leaf.y < top) top = leaf.y;
    if (leaf.y > bottom) bottom = leaf.y;
  }
  const span = Math.max(bottom - top, 1e-6);
  const maxLevel = geo.maxLevel;

  for (let level = 0; level <= maxLevel; level++) {
    const group = geo.leaves.filter((l) => l.level === level && l.r * scale >= 0.5 && (amount >= 1 || leafKeep(l) < amount));
    if (group.length === 0) continue;

    ctx.fillStyle = palette.shadow;
    ctx.beginPath();
    circleCount = 0;
    for (const l of group) {
      const R = l.r * scale;
      const cx = ox + l.x * scale + R * 0.12;
      const cy = oy + l.y * scale + R * 0.18;
      circle(ctx, cx, cy, R);
    }
    ctx.fill();

    const byTone: LeafCluster[][] = [[], [], []];
    for (const l of group) {
      const rel = (l.y - top) / span; // 0 = oben, 1 = unten
      const tone = 0.5 * (1 - rel) + 0.38 * l.b + 0.1 * (maxLevel > 0 ? level / maxLevel : 1) - 0.04;
      byTone[Math.max(0, Math.min(2, Math.floor(tone * 3)))]!.push(l);
    }
    for (let t = 0; t < 3; t++) {
      const list = byTone[t]!;
      if (list.length === 0) continue;
      ctx.fillStyle = palette.tones[t]!;
      ctx.beginPath();
      circleCount = 0;
      for (const l of list) {
        const R = l.r * scale;
        const cx = ox + l.x * scale;
        const cy = oy + l.y * scale;
        const a = l.a * Math.PI * 2;
        for (let k = 0; k < 3; k++) {
          const ang = a + k * 2.2;
          const bx = cx + Math.cos(ang) * R * 0.38;
          const by = cy + Math.sin(ang) * R * 0.3 - R * 0.05;
          const br = R * (0.7 - k * 0.05);
          circle(ctx, bx, by, br);
        }
      }
      ctx.fill();
    }

    ctx.fillStyle = palette.highlight;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    circleCount = 0;
    for (const l of group) {
      if (l.b < 0.35) continue;
      const R = l.r * scale;
      const cx = ox + l.x * scale - R * 0.25;
      const cy = oy + l.y * scale - R * 0.32;
      const hr = R * 0.38;
      circle(ctx, cx, cy, hr);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
