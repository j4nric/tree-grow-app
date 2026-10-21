/**
 * Zeichnungen der Begleitpflanzen (eigene je Pflanzen-ID, Ersatz je Gruppe).
 * Wird nur beim Neuaufbau der Pflanzen-Ebene aufgerufen, nie pro Frame.
 *
 * Geringe Versorgung (`vigor`) macht Farben blasser und gelblicher und spart Blüten
 * und Früchte ein; hintere Bäume verschwimmen im Dunst.
 */

import type { PlacedPlant } from './flora';
import { paintBlossoms, seasonColor, seasonLeaves, seasonWood, type SeasonLook } from './season';
import { elderBerries, elderFlowers, hazelCatkinBloom, hazelNuts, isEvergreen, plantLeafAmount, rowanBerries } from './phenology';
import { leafKeep, leafShrink, paintLeaves, paintWood, type LeafCluster, type LeafPalette, type PlantGeometry, type WoodColors } from './plant';
import { SKY } from './scenery';
import { clamp01, hash2, mix, mulberry32 } from './util';

const TAU = Math.PI * 2;
/** Farbe welker, schlecht versorgter Pflanzen. */
const DRY = '#bdb27a';

/** Farbanpassung je Pflanze: Welke (vigor) und Dunst (Tiefe). */
type Tint = (hex: string) => string;

/**
 * Farbfilter einer Pflanze: Jahreszeit (optional), Welke, Dunst. Moose bleiben das
 * ganze Jahr grün; ohne Jahreszeit (oder im Sommer) wie bisher.
 */
function makeTint(p: PlacedPlant, look: SeasonLook | null = null): Tint {
  const wilt = (1 - p.vigor) * 0.5;
  const haze = p.haze;
  const season = p.group === 'mosses' ? null : look;
  const cache = new Map<string, string>();
  return (hex) => {
    let c = cache.get(hex);
    if (!c) {
      c = mix(mix(seasonColor(hex, season), DRY, wilt), SKY.haze, haze);
      cache.set(hex, c);
    }
    return c;
  };
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), rot, 0, TAU);
  ctx.fill();
}

function stroke(ctx: CanvasRenderingContext2D, pts: number[], color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.stroke();
}

/** Zeichnet eine platzierte Pflanze. */
export function paintPlant(ctx: CanvasRenderingContext2D, p: PlacedPlant, look: SeasonLook | null = null): void {
  const rand = mulberry32(p.seed);
  if (p.tree) {
    // Bäume: Laub und Holz je Jahreszeit eigens, der Filter nur für Welke und Dunst.
    paintCompanionTree(ctx, p, makeTint(p), look);
    return;
  }
  const tint = makeTint(p, look);
  ctx.save();
  ctx.translate(p.x, p.y);
  switch (p.kind) {
    case 'hazel':
      paintBush(ctx, p, tint, rand, HAZEL, look);
      break;
    case 'bramble':
      paintBramble(ctx, p, tint, rand);
      break;
    case 'elder':
      paintBush(ctx, p, tint, rand, ELDER, look);
      break;
    case 'shrub':
      paintBush(ctx, p, tint, rand, SHRUB, look);
      break;
    case 'anemone':
      paintAnemone(ctx, p, tint, rand);
      break;
    case 'nettle':
      paintNettle(ctx, p, tint, rand);
      break;
    case 'strawberry':
      paintStrawberry(ctx, p, tint, rand);
      break;
    case 'foxglove':
      paintFoxglove(ctx, p, tint, rand);
      break;
    case 'fern':
      paintFern(ctx, p, tint, rand);
      break;
    case 'hartstongue':
      paintHartstongue(ctx, p, tint, rand);
      break;
    case 'moss':
      paintMoss(ctx, p, tint, rand);
      break;
    default:
      paintMeadow(ctx, p, tint, rand);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Bäume
// ---------------------------------------------------------------------------

interface TreeStyle {
  wood: WoodColors;
  leaves: LeafPalette;
  /** Breite der Äste relativ zum Hauptbaum. */
  widthScale: number;
  /** Blattbüschel: Größe und Abplattung. */
  leafScale: number;
  /** Abplattung der Büschel; < 1 = flache Büschel (Kiefer: Nadeln, Eberesche: Fiederblätter). */
  flatten: number;
}

const TREE_STYLES: Record<string, TreeStyle> = {
  beech: {
    wood: { base: '#8c8781', shade: '#706b66', light: '#aaa59e' },
    leaves: { shadow: '#2c4a24', tones: ['#3c6a2c', '#52843a', '#6a9a48'], highlight: '#a6c878' },
    widthScale: 1,
    leafScale: 1.05,
    flatten: 1,
  },
  birch: {
    wood: { base: '#e8e3d8', shade: '#c4bdae', light: '#faf7f0' },
    leaves: { shadow: '#4c7634', tones: ['#6b9944', '#84b154', '#a0c768'], highlight: '#d4e8a0' },
    widthScale: 0.75,
    leafScale: 0.78,
    flatten: 1,
  },
  rowan: {
    wood: { base: '#7a6b5c', shade: '#635546', light: '#968673' },
    leaves: { shadow: '#365a2c', tones: ['#4a7838', '#5f9045', '#78a656'], highlight: '#b2d08a' },
    widthScale: 0.85,
    leafScale: 0.9,
    flatten: 0.9,
  },
  pine: {
    wood: { base: '#86573a', shade: '#6a432c', light: '#c07a48' },
    leaves: { shadow: '#24463a', tones: ['#2f5b48', '#3e6e56', '#548064'], highlight: '#8db39a' },
    widthScale: 0.8,
    leafScale: 1.1,
    flatten: 0.5,
  },
  tree: {
    wood: { base: '#6e5038', shade: '#58402c', light: '#8a6a4c' },
    leaves: { shadow: '#2a5034', tones: ['#386a45', '#4a8254', '#62996a'], highlight: '#a0c99e' },
    widthScale: 1,
    leafScale: 1,
    flatten: 1,
  },
};

function tintWood(w: WoodColors, t: Tint): WoodColors {
  return { base: t(w.base), shade: t(w.shade), light: t(w.light) };
}

function tintLeaves(l: LeafPalette, t: Tint): LeafPalette {
  return { shadow: t(l.shadow), tones: [t(l.tones[0]), t(l.tones[1]), t(l.tones[2])], highlight: t(l.highlight) };
}

function paintCompanionTree(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, look: SeasonLook | null): void {
  const t = p.tree!;
  const style = TREE_STYLES[p.kind] ?? TREE_STYLES.tree!;
  paintWood(ctx, t.geo, t.x, t.y, t.scale, style.widthScale, tintWood(seasonWood(style.wood, look), tint));
  if (p.kind === 'birch') paintBirchMarks(ctx, t.geo, t.x, t.y, t.scale, style.widthScale, tint);
  const evergreen = isEvergreen(p.kind);
  const amount = plantLeafAmount(p.kind, look);
  if (style.flatten < 1) {
    // Flache Büschel. Nur Nadelbäume bleiben das ganze Jahr grün; die Eberesche färbt
    // sich im Herbst und ist im Winter kahl.
    const palette = tintLeaves(evergreen ? style.leaves : seasonLeaves(style.leaves, look), tint);
    paintNeedleClumps(ctx, t.geo, t.x, t.y, t.scale, style.leafScale, style.flatten, palette, amount);
    if (!evergreen && look && look.blossom > 0) paintBlossoms(ctx, t.geo, t.x, t.y, t.scale, look.blossom, amount);
  } else {
    const geo: PlantGeometry =
      style.leafScale === 1
        ? t.geo
        : { ...t.geo, leaves: t.geo.leaves.map((l: LeafCluster) => ({ ...l, r: l.r * style.leafScale, y: l.y + l.r * (1 - style.leafScale) * 0.6 })) };
    const palette = tintLeaves(seasonLeaves(style.leaves, look), tint);
    paintLeaves(ctx, geo, t.x, t.y, t.scale, palette, amount);
    if (look && look.blossom > 0) paintBlossoms(ctx, geo, t.x, t.y, t.scale, look.blossom, amount);
  }
  // Vogelbeeren nur im Spätsommer und Herbst (siehe phenology.ts).
  if (p.kind === 'rowan') {
    const berries = rowanBerries(look);
    if (berries > 0.02) paintRowanBerries(ctx, p, tint, berries);
  }
}

/** Schwarze Querstreifen auf der weißen Birkenrinde. */
function paintBirchMarks(ctx: CanvasRenderingContext2D, geo: PlantGeometry, ox: number, oy: number, scale: number, ws: number, tint: Tint): void {
  ctx.strokeStyle = tint('#3a3633');
  ctx.lineCap = 'round';
  let i = 0;
  for (const s of geo.segments) {
    const hw = (s.w1 * scale * ws) / 2;
    if (hw < 1.6) continue;
    const x1 = ox + s.x1 * scale;
    const y1 = oy + s.y1 * scale;
    const x2 = ox + s.x2 * scale;
    const y2 = oy + s.y2 * scale;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.floor(len / Math.max(5, hw * 2.2));
    const nx = -(y2 - y1) / (len || 1);
    const ny = (x2 - x1) / (len || 1);
    ctx.lineWidth = Math.max(0.8, hw * 0.28);
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5 + 0.3 * Math.sin(++i * 2.3)) / Math.max(n, 1);
      const cx = x1 + (x2 - x1) * u;
      const cy = y1 + (y2 - y1) * u;
      const side = (i % 2 === 0 ? 1 : -1) * hw * 0.35;
      const l = hw * (0.35 + 0.25 * ((i * 7) % 3) / 2);
      ctx.moveTo(cx + nx * (side - l), cy + ny * (side - l));
      ctx.lineTo(cx + nx * (side + l), cy + ny * (side + l));
    }
    ctx.stroke();
  }
}

/** Kiefer: flache, dunkle Nadelbüschel statt runder Blattballen (auch für den Hauptbaum Kiefer). */
export function paintNeedleClumps(
  ctx: CanvasRenderingContext2D,
  geo: PlantGeometry,
  ox: number,
  oy: number,
  scale: number,
  leafScale: number,
  flatten: number,
  palette: LeafPalette,
  /** Laubmenge 0–1 (laubwerfende Arten mit flachen Büscheln): per Seed stabil wie `paintLeaves`. */
  amount = 1,
): void {
  if (amount <= 0) return;
  const leaves = geo.leaves.filter((l) => (l.level >= 1 || geo.maxLevel < 2) && (amount >= 1 || leafKeep(l) < amount));
  const shrink = leafShrink(amount);
  const pass = (color: string, dx: number, dy: number, k: number, filter: (l: LeafCluster) => boolean) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const l of leaves) {
      if (!filter(l)) continue;
      const R = l.r * scale * leafScale * k * shrink;
      if (R < 0.6) continue;
      const x = ox + l.x * scale + dx * R;
      const y = oy + l.y * scale + dy * R;
      ctx.moveTo(x + R * 1.25, y);
      ctx.ellipse(x, y, R * 1.25, R * flatten, (l.a - 0.5) * 0.3, 0, TAU);
    }
    ctx.fill();
  };
  pass(palette.shadow, 0.1, 0.25, 1, () => true);
  pass(palette.tones[0], 0, 0, 0.95, () => true);
  pass(palette.tones[1], -0.12, -0.12, 0.72, (l) => l.b > 0.3);
  pass(palette.tones[2], -0.25, -0.22, 0.45, (l) => l.b > 0.55);
  ctx.globalAlpha = 0.6;
  pass(palette.highlight, -0.4, -0.3, 0.22, (l) => l.b > 0.7);
  ctx.globalAlpha = 1;
}

/** Eberesche: rote Beerendolden unter einigen Blattbüscheln. */
function paintRowanBerries(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, season = 1): void {
  const t = p.tree!;
  const amount = (0.3 + 0.7 * p.vigor) * season;
  const grow = clamp01((p.grow - 0.15) / 0.4);
  if (grow <= 0) return;
  const rand = mulberry32(p.seed ^ 0x5bd1);
  ctx.fillStyle = tint('#c8402e');
  ctx.beginPath();
  for (const l of t.geo.leaves) {
    if (l.level < 1 || l.b < 1 - 0.55 * amount) continue;
    const R = l.r * t.scale;
    const cx = t.x + l.x * t.scale + (l.a - 0.5) * R * 0.6;
    const cy = t.y + l.y * t.scale + R * 0.45;
    const r = Math.max(0.9, Math.min(R * 0.09, 2.6)) * grow;
    for (let k = 0; k < 5; k++) {
      const bx = cx + (rand() - 0.5) * r * 4;
      const by = cy + (rand() - 0.2) * r * 2.5;
      ctx.moveTo(bx + r, by);
      ctx.arc(bx, by, r, 0, TAU);
    }
  }
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Sträucher
// ---------------------------------------------------------------------------

interface BushStyle {
  stem: string;
  tones: [string, string, string];
  shadow: string;
  highlight: string;
  /** Zusätzliche Details (Kätzchen, Dolden …). */
  extra: (ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, blobs: Blob[], rand: () => number, look: SeasonLook | null) => void;
  /** Form: Breite der Krone oben relativ zur Basis (Holunder ist oben breiter). */
  top: number;
}

type Blob = [number, number, number];

const HAZEL: BushStyle = {
  stem: '#7a6652',
  shadow: '#3e5f2a',
  tones: ['#58873a', '#6f9c48', '#88b45a'],
  highlight: '#bcd890',
  top: 0.9,
  extra: (ctx, p, tint, blobs, rand, look) => {
    // Haselnüsse in grüner Hülle (Sommer, Herbst) und Kätzchen (das ganze Jahr, im
    // Spätwinter lang und gelb blühend). Der Zufall wird immer gleich verbraucht.
    const n = Math.round(4 * (0.3 + 0.7 * p.vigor) * p.grow + 1);
    const nuts = Math.round(n * hazelNuts(look));
    const r = p.h * 0.035;
    for (let i = 0; i < n; i++) {
      const b = blobs[Math.floor(rand() * blobs.length)]!;
      const x = b[0] + (rand() - 0.5) * b[2];
      const y = b[1] + b[2] * 0.3;
      if (i >= nuts) continue;
      ellipse(ctx, x, y, r * 1.3, r * 0.9, 0, tint('#9cc06a'));
      ellipse(ctx, x - r * 0.5, y + r * 0.35, r * 0.75, r * 0.7, 0, tint('#9a6a3a'));
      ellipse(ctx, x + r * 0.5, y + r * 0.4, r * 0.7, r * 0.65, 0, tint('#8a5c30'));
    }
    const bloom = hazelCatkinBloom(look);
    const len = 3.2 * (1 + 0.9 * bloom);
    const color = bloom > 0 ? mix(tint('#cdb866'), '#e9d25e', bloom) : tint('#cdb866');
    for (let i = 0; i < 3 + Math.round(2 * bloom); i++) {
      const b = blobs[Math.floor(rand() * blobs.length)]!;
      const x = b[0] + (rand() - 0.5) * b[2] * 1.4;
      const y = b[1] + b[2] * 0.5;
      stroke(ctx, [x, y, x + r * 0.4, y + r * len], color, Math.max(1, r * (0.8 + 0.3 * bloom)));
    }
  },
};

const ELDER: BushStyle = {
  stem: '#857360',
  shadow: '#3a5a2c',
  tones: ['#4f7c3a', '#64924a', '#7da85c'],
  highlight: '#b6d290',
  top: 1.15,
  extra: (ctx, p, tint, blobs, rand, look) => {
    // Flache Blütendolden (cremeweiß, Frühsommer) und dunkle Beerendolden (Spätsommer, Herbst)
    const n = Math.round((3 + 3 * p.grow) * (0.35 + 0.65 * p.vigor));
    const r = p.h * 0.08;
    const dot = Math.max(0.7, r * 0.17);
    const flowers = elderFlowers(look);
    const fruit = elderBerries(look);
    for (let i = 0; i < n; i++) {
      const b = blobs[Math.floor(rand() * blobs.length)]!;
      const x = b[0] + (rand() - 0.5) * b[2];
      const y = b[1] - b[2] * (0.1 + rand() * 0.4);
      const berries = i % 3 === 2;
      // Je Dolde ein fester Schwellwert: weniger Dolden außerhalb ihrer Zeit.
      if (((hash2(p.seed, i + 7) & 1023) + 0.5) / 1024 > (berries ? fruit : flowers)) continue;
      // Dolde: viele kleine Punkte auf einer flachen Kuppel (Beeren hängen nach unten)
      const sag = berries ? 1 : -1;
      ctx.fillStyle = tint(berries ? '#3a2838' : '#e4dcbc');
      ctx.beginPath();
      for (let k = 0; k < 11; k++) {
        const u = (k / 10) * 2 - 1;
        const bx = x + u * r;
        const by = y + sag * (1 - u * u) * r * 0.35 + ((k * 5) % 3) * dot * 0.6;
        ctx.moveTo(bx + dot * 1.15, by + dot * 0.4);
        ctx.arc(bx, by + dot * 0.4, dot * 1.15, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = tint(berries ? '#5a3a58' : '#fbf7e6');
      ctx.beginPath();
      for (let k = 0; k < 11; k++) {
        const u = (k / 10) * 2 - 1;
        const bx = x + u * r * 0.95;
        const by = y + sag * (1 - u * u) * r * 0.35 + ((k * 5) % 3) * dot * 0.6;
        ctx.moveTo(bx + dot, by);
        ctx.arc(bx, by, dot, 0, TAU);
      }
      ctx.fill();
    }
  },
};

const SHRUB: BushStyle = {
  stem: '#76634f',
  shadow: '#355a33',
  tones: ['#4a7a44', '#5f9052', '#78a765'],
  highlight: '#afd09a',
  top: 1,
  extra: () => {},
};

/** Busch aus Blattballen auf einigen Stämmchen. */
function paintBush(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, rand: () => number, style: BushStyle, look: SeasonLook | null): void {
  const { h, hw } = p;
  const amount = plantLeafAmount(p.kind, look);
  // Stämmchen
  for (let i = 0; i < 5; i++) {
    const u = (i / 4 - 0.5) * 2;
    stroke(ctx, [u * hw * 0.12, 0, u * hw * 0.35, -h * 0.35, u * hw * 0.55 * style.top, -h * 0.62], tint(style.stem), Math.max(1, h * 0.03));
  }
  const blobs: Blob[] = [];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const v = rand();
    const spread = 1 - v * (1 - style.top) - (style.top < 1 ? 0 : 0);
    const x = u * hw * 0.72 * (0.75 + 0.25 * spread) * (style.top > 1 ? 0.7 + 0.3 * v : 1);
    const top = h * (0.52 + 0.4 * (1 - Math.abs(u) * 0.8));
    const y = -h * 0.22 - (top - h * 0.22) * v;
    const r = hw * (0.26 + 0.14 * rand());
    blobs.push([x, y, r]);
  }
  blobs.sort((a, b) => b[1] - a[1]);
  // Laubwerfend: Herbst und Winter lichten die Blattballen (per Seed stabil), darunter
  // werden feine Zweige sichtbar – im Winter ist der Strauch kahl.
  let shown = blobs;
  if (amount < 1) {
    paintBushTwigs(ctx, p, blobs, tint(style.stem));
    const shrink = leafShrink(amount);
    shown = blobs
      .filter((_, i) => ((hash2(p.seed, i + 101) & 1023) + 0.5) / 1024 < amount)
      .map(([x, y, r]): Blob => [x, y, r * shrink]);
  }
  if (shown.length > 0) {
    paintBlobs(ctx, shown, tint(style.shadow), [tint(style.tones[0]), tint(style.tones[1]), tint(style.tones[2])], tint(style.highlight), h);
  }
  style.extra(ctx, p, tint, blobs, rand, look);
}

/** Feine Zweige eines laubwerfenden Strauchs: von den Stämmchen zu jedem Blattballen. */
function paintBushTwigs(ctx: CanvasRenderingContext2D, p: PlacedPlant, blobs: Blob[], color: string): void {
  const { h, hw } = p;
  const w = Math.max(0.7, h * 0.014);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  blobs.forEach(([x, y, r], i) => {
    // Ausgang: das nächstgelegene der fünf Stämmchen auf etwa halber Höhe.
    const u = Math.max(-1, Math.min(1, Math.round((x / (hw * 0.45)) * 2) / 2));
    const sx = u * hw * 0.35;
    const sy = -h * 0.35;
    const mx = (sx + x) / 2 + (x - sx) * 0.1;
    const my = (sy + y) / 2 - r * 0.2;
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, x, y);
    // Kleine Gabel am Ende (Richtung per Seed).
    const side = (hash2(p.seed, i + 211) & 1) === 0 ? -1 : 1;
    ctx.moveTo(x - (x - sx) * 0.25, y - (y - sy) * 0.25);
    ctx.lineTo(x - (x - sx) * 0.25 + side * r * 0.5, y - (y - sy) * 0.25 - r * 0.45);
  });
  ctx.stroke();
}

/** Blattballen mit Schatten, drei Tönen (oben heller) und Glanzlicht. */
function paintBlobs(ctx: CanvasRenderingContext2D, blobs: Blob[], shadow: string, tones: string[], highlight: string, h: number): void {
  ctx.fillStyle = shadow;
  ctx.beginPath();
  for (const [x, y, r] of blobs) {
    ctx.moveTo(x + r * 1.1, y + r * 0.15);
    ctx.arc(x + r * 0.1, y + r * 0.15, r, 0, TAU);
  }
  ctx.fill();
  for (let t = 0; t < 3; t++) {
    ctx.fillStyle = tones[t]!;
    ctx.beginPath();
    for (const [x, y, r] of blobs) {
      const rel = clamp01(-y / h);
      const tone = Math.min(2, Math.floor(rel * 2.4 + ((x * 7.3 + y * 3.1) % 1 + 1) % 1 * 0.6));
      if (tone !== t) continue;
      ctx.moveTo(x + r * 0.92, y);
      ctx.arc(x, y, r * 0.92, 0, TAU);
    }
    ctx.fill();
  }
  ctx.fillStyle = highlight;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (const [x, y, r] of blobs) {
    if (-y < h * 0.45) continue;
    ctx.moveTo(x - r * 0.25 + r * 0.32, y - r * 0.3);
    ctx.arc(x - r * 0.25, y - r * 0.3, r * 0.32, 0, TAU);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Brombeere: niedriger, breiter Hügel mit überhängenden Ranken, Beeren und Blüten. */
function paintBramble(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, rand: () => number): void {
  const { h, hw } = p;
  const cane = tint('#7c4350');
  const blobs: Blob[] = [];
  for (let i = 0; i < 14; i++) {
    const u = rand() * 2 - 1;
    const x = u * hw * 0.78;
    const y = -h * (0.18 + 0.55 * (1 - u * u) * rand());
    blobs.push([x, y, hw * (0.2 + 0.1 * rand())]);
  }
  blobs.sort((a, b) => b[1] - a[1]);
  // Ranken hinter und vor dem Laub
  const canes = () => {
    for (let i = 0; i < 4; i++) {
      const s = i % 2 === 0 ? 1 : -1;
      const reach = hw * (0.75 + 0.3 * rand());
      ctx.strokeStyle = cane;
      ctx.lineWidth = Math.max(1, h * 0.035);
      ctx.beginPath();
      ctx.moveTo(s * hw * 0.2, -h * 0.2);
      ctx.quadraticCurveTo(s * reach * 0.6, -h * (0.9 + 0.2 * rand()), s * reach, -h * 0.12);
      ctx.stroke();
    }
  };
  canes();
  paintBlobs(ctx, blobs, tint('#2c4a2a'), [tint('#3b6234'), tint('#4c7640'), tint('#628a4e')], tint('#9fc08a'), h);
  // Beeren (schwarz und rot) und ein paar Blüten
  const n = Math.round((3 + 4 * p.grow) * (0.3 + 0.7 * p.vigor));
  const r = Math.max(1, h * 0.05);
  for (let i = 0; i < n; i++) {
    const b = blobs[Math.floor(rand() * blobs.length)]!;
    const x = b[0] + (rand() - 0.5) * b[2] * 1.2;
    const y = b[1] + (rand() - 0.3) * b[2];
    if (i % 4 === 3) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        ellipse(ctx, x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, r * 0.6, r * 0.6, 0, tint('#f3e2ea'));
      }
      ellipse(ctx, x, y, r * 0.45, r * 0.45, 0, tint('#e6c86a'));
      continue;
    }
    const col = i % 3 === 0 ? '#b8343a' : '#2e1f33';
    ctx.fillStyle = tint(col);
    ctx.beginPath();
    for (const [dx, dy] of [
      [0, 0],
      [r * 0.7, r * 0.3],
      [-r * 0.6, r * 0.35],
      [0.05 * r, r * 0.8],
    ]) {
      ctx.moveTo(x + dx! + r * 0.55, y + dy!);
      ctx.arc(x + dx!, y + dy!, r * 0.55, 0, TAU);
    }
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Blumen & Kräuter
// ---------------------------------------------------------------------------

function flowerHead(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, petals: number, petal: string, center: string, rot = 0): void {
  ctx.fillStyle = petal;
  ctx.beginPath();
  for (let i = 0; i < petals; i++) {
    const a = rot + (i / petals) * TAU;
    const px = x + Math.cos(a) * r * 0.7;
    const py = y + Math.sin(a) * r * 0.55;
    ctx.moveTo(px + r * 0.5, py);
    ctx.ellipse(px, py, r * 0.5, r * 0.36, a, 0, TAU);
  }
  ctx.fill();
  ellipse(ctx, x, y, r * 0.32, r * 0.28, 0, center);
}

/** Buschwindröschen: ein Teppich kleiner weißer Sternblüten über geschlitztem Laub. */
function paintAnemone(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, rand: () => number): void {
  const { h, hw } = p;
  const leaf = [tint('#4f8a3a'), tint('#66a04a')];
  for (let i = 0; i < 9; i++) {
    const x = (rand() * 2 - 1) * hw * 0.9;
    const y = -h * (0.25 + rand() * 0.3);
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k - 1) * 0.8;
      ellipse(ctx, x + Math.cos(a) * h * 0.14, y + Math.sin(a) * h * 0.1, h * 0.14, h * 0.06, a, leaf[(i + k) % 2]!);
    }
  }
  const n = Math.round((3 + 4 * p.grow) * (0.35 + 0.65 * p.vigor));
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n - 0.5) * hw * 1.7 + (rand() - 0.5) * hw * 0.15;
    const y = -h * (0.6 + rand() * 0.4);
    stroke(ctx, [x * 0.9, 0, x, y], tint('#5a8a3e'), Math.max(0.8, h * 0.05));
    flowerHead(ctx, x, y, h * 0.2, 6, tint('#f7f4ee'), tint('#e9c94a'), rand());
    ellipse(ctx, x - h * 0.05, y - h * 0.05, h * 0.06, h * 0.04, 0, tint('#f0d8e2'));
  }
}

/** Brennnessel: aufrechte Stängel mit gezähnten, gegenständigen Blättern und hängenden Blütenrispen. */
function paintNettle(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, rand: () => number): void {
  const { h, hw } = p;
  const stems = 3;
  for (let s = 0; s < stems; s++) {
    const x = (s / (stems - 1) - 0.5) * hw * 1.1 + (rand() - 0.5) * hw * 0.2;
    const top = h * (0.75 + 0.25 * rand()) * (s === 1 ? 1 : 0.85);
    const lean = (rand() - 0.5) * hw * 0.3;
    stroke(ctx, [x, 0, x + lean * 0.5, -top * 0.5, x + lean, -top], tint('#4a6a32'), Math.max(1, h * 0.025));
    const pairs = 4;
    for (let k = 0; k < pairs; k++) {
      const u = 0.25 + (k / pairs) * 0.7;
      const yy = -top * u;
      const xx = x + lean * u;
      const L = h * 0.13 * (1.15 - u * 0.6);
      for (const side of [-1, 1]) {
        const lx = xx + side * L * 0.7;
        const ly = yy + L * 0.15;
        ellipse(ctx, lx, ly, L, L * 0.42, side > 0 ? 0.35 : -0.35, tint(k % 2 === 0 ? '#3f6e30' : '#4e7e3a'));
        // Zähnchen als heller Rand oben
        ellipse(ctx, lx, ly - L * 0.08, L * 0.7, L * 0.16, side > 0 ? 0.35 : -0.35, tint('#62904a'));
        // Hängende Blütenrispen an den oberen Blattpaaren
        if (k >= 2 && p.grow > 0.3) stroke(ctx, [xx + side * L * 0.2, yy, xx + side * L * 0.55, yy + L * 1.1], tint('#9fb06e'), Math.max(0.8, h * 0.02));
      }
    }
    ellipse(ctx, x + lean, -top, h * 0.05, h * 0.08, 0, tint('#4e7e3a'));
  }
}

/** Wald-Erdbeere: niedrige, dreiteilige Blätter, rote Früchte und weiße Blüten. */
function paintStrawberry(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, rand: () => number): void {
  const { h, hw } = p;
  for (let i = 0; i < 6; i++) {
    const x = (i / 5 - 0.5) * hw * 1.5 + (rand() - 0.5) * hw * 0.2;
    const y = -h * (0.5 + 0.4 * rand());
    stroke(ctx, [x * 0.5, 0, x, y], tint('#5e8a40'), Math.max(0.8, h * 0.05));
    const r = h * 0.2;
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k - 1) * 1.0;
      const lx = x + Math.cos(a) * r * 0.85;
      const ly = y + Math.sin(a) * r * 0.75;
      ellipse(ctx, lx, ly, r * 0.62, r * 0.42, a + Math.PI / 2, tint(k === 1 ? '#4f8a3a' : '#437a32'));
      stroke(ctx, [x, y, lx + Math.cos(a) * r * 0.4, ly + Math.sin(a) * r * 0.3], tint('#6a9c50'), Math.max(0.5, h * 0.015));
    }
  }
  const n = Math.round((2 + 3 * p.grow) * (0.3 + 0.7 * p.vigor));
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n - 0.5) * hw * 1.6;
    const y = -h * (0.18 + 0.2 * rand());
    if (i % 3 === 1) {
      flowerHead(ctx, x, y - h * 0.15, h * 0.17, 5, tint('#f6f3ec'), tint('#e8c64a'));
      continue;
    }
    const r = h * 0.12;
    ctx.fillStyle = tint('#d33b33');
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.quadraticCurveTo(x - r * 0.9, y + r * 1.4, x, y + r * 1.7);
    ctx.quadraticCurveTo(x + r * 0.9, y + r * 1.4, x + r, y);
    ctx.closePath();
    ctx.fill();
    ellipse(ctx, x, y, r * 0.9, r * 0.3, 0, tint('#4f8a3a'));
    ellipse(ctx, x - r * 0.3, y + r * 0.6, r * 0.18, r * 0.25, 0, tint('#f08a74'));
  }
}

/** Roter Fingerhut: hohe Ähren mit hängenden, purpurnen Glocken über einer Blattrosette. */
function paintFoxglove(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, rand: () => number): void {
  const { h, hw } = p;
  // Blattrosette
  for (let i = 0; i < 6; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    const L = h * (0.16 + 0.05 * rand());
    ellipse(ctx, s * L * 0.8, -h * 0.05 - i * h * 0.012, L, L * 0.32, s * 0.4, tint(i % 3 === 0 ? '#4c7a3e' : '#5d8c4a'));
  }
  const spikes = p.grow > 0.55 ? 2 : 1;
  for (let sp = 0; sp < spikes; sp++) {
    const x = sp === 0 ? hw * 0.1 : -hw * 0.6;
    const top = h * (sp === 0 ? 1 : 0.72);
    stroke(ctx, [x, -h * 0.05, x + hw * 0.08, -top * 0.6, x + hw * 0.04, -top], tint('#5a7a40'), Math.max(1, h * 0.02));
    const bells = Math.round(7 * (0.4 + 0.6 * p.vigor));
    for (let k = 0; k < bells; k++) {
      const u = 0.4 + (k / bells) * 0.55;
      const by = -top * u;
      const bx = x + hw * 0.08 * Math.sin(u * 3) + hw * 0.18;
      const r = h * 0.055 * (1.2 - u * 0.6);
      const col = k % 2 === 0 ? '#c3589b' : '#b04a8c';
      ctx.fillStyle = tint(col);
      ctx.beginPath();
      ctx.moveTo(bx - r * 0.6, by - r * 0.9);
      ctx.quadraticCurveTo(bx + r * 1.6, by - r, bx + r * 1.2, by + r * 1.3);
      ctx.lineTo(bx - r * 0.2, by + r * 1.1);
      ctx.closePath();
      ctx.fill();
      ellipse(ctx, bx + r * 0.5, by + r * 1.2, r * 0.7, r * 0.3, -0.3, tint('#e9b8d4'));
    }
    // Knospen an der Spitze
    for (let k = 0; k < 3; k++) ellipse(ctx, x + hw * 0.04 + (k % 2 ? 1 : -1) * h * 0.02, -top + k * h * 0.04, h * 0.018, h * 0.028, 0, tint('#7a9a50'));
  }
}

/** Ersatz: gemischte Wiesenblumen. */
function paintMeadow(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, rand: () => number): void {
  const { h, hw } = p;
  for (let i = 0; i < 6; i++) {
    const x = (rand() * 2 - 1) * hw;
    const hh = h * (0.4 + 0.4 * rand());
    ctx.fillStyle = tint(i % 2 ? '#5f9a40' : '#4f8a38');
    ctx.beginPath();
    ctx.moveTo(x - h * 0.04, 0);
    ctx.lineTo(x + (rand() - 0.5) * h * 0.3, -hh);
    ctx.lineTo(x + h * 0.04, 0);
    ctx.fill();
  }
  const cols: [string, string][] = [
    ['#f4f1ea', '#e8b93a'],
    ['#d98fb4', '#f0d37a'],
    ['#f2d65a', '#c98a2a'],
    ['#9aa8e0', '#f2e6a0'],
  ];
  const n = Math.round(3 + 2 * p.vigor);
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n - 0.5) * hw * 1.6;
    const y = -h * (0.55 + 0.45 * rand());
    stroke(ctx, [x * 0.7, 0, x, y], tint('#4f8a38'), Math.max(0.8, h * 0.04));
    const [pc, cc] = cols[i % cols.length]!;
    flowerHead(ctx, x, y, h * 0.16, 5, tint(pc), tint(cc), rand());
  }
}

// ---------------------------------------------------------------------------
// Moose & Farne
// ---------------------------------------------------------------------------

/** Frauenhaarmoos: weiche Polster mit feinen Sporenkapseln. */
function paintMoss(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, rand: () => number): void {
  const { h, hw } = p;
  const mounds: Blob[] = [];
  for (let i = 0; i < 6; i++) {
    const u = (i / 5 - 0.5) * 2;
    mounds.push([u * hw * 0.7, 0, hw * (0.32 + 0.12 * rand()) * (1 - Math.abs(u) * 0.3)]);
  }
  const dome = (color: string, k: number, dy: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [x, , r] of mounds) {
      const ry = Math.min(r * 0.75, h) * k;
      ctx.moveTo(x + r * k, 1);
      ctx.ellipse(x, 1 + dy, r * k, ry, 0, Math.PI, TAU);
      ctx.closePath();
    }
    ctx.fill();
  };
  dome(tint('#3e6a2c'), 1, 0);
  dome(tint('#5a8c38'), 0.82, -h * 0.1);
  dome(tint('#78a848'), 0.5, -h * 0.35);
  // Sporenkapseln
  if (p.grow > 0.2) {
    const n = Math.round(5 * p.vigor * p.grow) + 1;
    for (let i = 0; i < n; i++) {
      const x = (rand() * 2 - 1) * hw * 0.7;
      const top = -h * (1.4 + rand() * 0.9);
      stroke(ctx, [x, -h * 0.5, x + h * 0.15, top], tint('#a87a4a'), Math.max(0.6, h * 0.06));
      ellipse(ctx, x + h * 0.17, top, h * 0.09, h * 0.16, 0.3, tint('#8a5a32'));
    }
  }
}

/** Wurmfarn: überhängende, gefiederte Wedel, in der Mitte ein eingerollter Bischofsstab. */
function paintFern(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, rand: () => number): void {
  const { h, hw } = p;
  const fronds = 7;
  const greens = [tint('#3f7a36'), tint('#4f8a40'), tint('#62994c')];
  for (let i = 0; i < fronds; i++) {
    const u = (i / (fronds - 1) - 0.5) * 2; // −1 … 1
    const len = h * (0.85 + 0.25 * (1 - Math.abs(u)) + 0.1 * rand());
    const tipX = u * hw * 1.05;
    const tipY = -len * (0.55 + 0.4 * (1 - Math.abs(u)));
    const cx = u * hw * 0.25;
    const cy = -len * 1.05;
    const col = greens[i % 3]!;
    // Spindel
    ctx.strokeStyle = tint('#5a7a3a');
    ctx.lineWidth = Math.max(0.8, h * 0.022);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(cx, cy, tipX, tipY);
    ctx.stroke();
    // Fiedern entlang der Kurve
    ctx.fillStyle = col;
    ctx.beginPath();
    const n = 9;
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      const x = 2 * (1 - t) * t * cx + t * t * tipX;
      const y = 2 * (1 - t) * t * cy + t * t * tipY;
      const dx = 2 * (1 - t) * cx + 2 * t * (tipX - cx);
      const dy = 2 * (1 - t) * cy + 2 * t * (tipY - cy);
      const a = Math.atan2(dy, dx);
      const L = h * 0.16 * Math.sin(Math.PI * (0.15 + t * 0.85));
      for (const s of [-1, 1]) {
        const pa = a + s * 1.15;
        const px = x + Math.cos(pa) * L * 0.5;
        const py = y + Math.sin(pa) * L * 0.5;
        ctx.moveTo(px + L * 0.5, py);
        ctx.ellipse(px, py, L * 0.5, L * 0.17, pa, 0, TAU);
      }
    }
    ctx.fill();
  }
  // Bischofsstab
  if (p.vigor > 0.3) {
    const r = h * 0.07;
    stroke(ctx, [0, 0, r * 0.4, -h * 0.45], tint('#6a9a4a'), Math.max(0.8, h * 0.03));
    ctx.strokeStyle = tint('#7aaa58');
    ctx.lineWidth = Math.max(0.8, h * 0.035);
    ctx.beginPath();
    ctx.arc(r * 0.4 + r, -h * 0.45, r, Math.PI, Math.PI * 2.6);
    ctx.stroke();
  }
}

/** Hirschzunge: ungeteilte, glänzende Riemenblätter, fächerförmig. */
function paintHartstongue(ctx: CanvasRenderingContext2D, p: PlacedPlant, tint: Tint, rand: () => number): void {
  const { h, hw } = p;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1) - 0.5) * 2;
    const a = -Math.PI / 2 + u * 0.95 + (rand() - 0.5) * 0.15;
    const L = h * (0.75 + 0.25 * (1 - Math.abs(u)));
    const w = Math.min(hw * 0.22, L * 0.2);
    const cx = Math.cos(a) * L * 0.5;
    const cy = Math.sin(a) * L * 0.5;
    ellipse(ctx, cx + w * 0.15, cy + w * 0.2, L * 0.52, w, a, tint('#2c5a2c'));
    ellipse(ctx, cx, cy, L * 0.5, w * 0.92, a, tint(i % 2 ? '#3f7c3a' : '#4a8a42'));
    // Mittelrippe und Glanz
    stroke(ctx, [Math.cos(a) * L * 0.08, Math.sin(a) * L * 0.08, Math.cos(a) * L * 0.9, Math.sin(a) * L * 0.9], tint('#78aa5c'), Math.max(0.5, w * 0.16));
    ctx.globalAlpha = 0.45;
    ellipse(ctx, cx - Math.sin(a) * w * 0.4, cy + Math.cos(a) * w * 0.4 * -1, L * 0.3, w * 0.25, a, tint('#c4e0a4'));
    ctx.globalAlpha = 1;
  }
}
