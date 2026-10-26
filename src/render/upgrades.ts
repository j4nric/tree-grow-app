/**
 * Baum-Ausbau im Bild (DESIGN_V2.md 28.4 / 28.9): Jahresringe machen den Stamm dicker,
 * Blattwerk die Krone voller, Pilzgeflecht setzt Pilzhüte an den Stammfuß; Nischen ab
 * Ausbaustufe 25/50 bekommen ein kleines Detail (Wurzelraum: Wurmgänge, Krone: Nistkasten,
 * Waldsaum: Blütenpunkte).
 *
 * Eingabe sind **Schritte**, nicht Stufen (je 10 Stufen ein Schritt, Nischen 25/50) – sie
 * ändern sich selten, und nur ein Schrittwechsel zeichnet die gecachten Ebenen neu
 * (`upgradesKey`). Alles ist Seed-Zufall: gleiche Schritte → gleiches Bild. Ohne Angabe
 * (oder alles 0) bleibt das Bild exakt wie ohne Ausbau.
 */

import type { SceneNiche } from './anchors';
import type { Layout, PlacedTree } from './layout';
import type { PlantGeometry } from './plant';
import type { SeasonLook } from './season';
import { clamp, clamp01, hash2, mulberry32, smooth01 } from './util';

/** Ausbau in der Szene: Schritte der Baumteile und Detailstufen der Nischen. */
export interface SceneUpgrades {
  /** Jahresringe: Schritte (Stufe / 10, abgerundet), höchstens UPGRADE_MAX_STEPS. */
  rings?: number;
  /** Blattwerk: Schritte (Stufe / 10), höchstens UPGRADE_MAX_STEPS. */
  leaves?: number;
  /** Pilzgeflecht: Schritte (Stufe / 10) = Pilzhüte am Stammfuß, höchstens MAX_MUSHROOMS. */
  mycorrhiza?: number;
  /**
   * Nischen: 0 (unter 25), 1 (ab 25), 2 (ab 50). Gezeichnet werden Wurzelraum, Krone und
   * Waldsaum; andere Nischen sind erlaubt, bleiben aber (noch) ohne Bild.
   */
  niches?: Partial<Record<SceneNiche, number>>;
}

/** Stufen je sichtbarem Schritt der Baumteile. */
export const UPGRADE_STEP_LEVELS = 10;
/** Höchstens so viele Schritte zählen für Stamm und Krone (+30 % bzw. +40 %). */
export const UPGRADE_MAX_STEPS = 10;
/** Höchstens so viele Pilzhüte am Stammfuß. */
export const MAX_MUSHROOMS = 6;
/** Stammbreite je Schritt Jahresringe. */
export const TRUNK_PER_STEP = 0.03;
/** Kronenvolumen (Fläche) je Schritt Blattwerk. */
export const CROWN_PER_STEP = 0.04;
/** Ab diesen Nischen-Stufen erscheint ein Detail (Stufe 1 bzw. 2). */
export const NICHE_DETAIL_LEVELS = [25, 50] as const;
/** Baumteile (IDs wie in DESIGN_V2.md 28.4). */
export const TREE_UPGRADE_PARTS = ['rings', 'leaves', 'mycorrhiza'] as const;
export type TreeUpgradePart = (typeof TREE_UPGRADE_PARTS)[number];
/** Nischen mit Detail im Bild. */
export const DETAIL_NICHES = ['roots', 'crown', 'edge'] as const;
export type DetailNiche = (typeof DETAIL_NICHES)[number];

const NICHE_IDS: readonly string[] = ['roots', 'litter', 'edge', 'crown', 'bark', 'hollows', 'pond', 'meadow', 'deadwood', 'wall'];

/** Schritte eines Baumteils aus seiner Ausbaustufe (ungültig → 0). */
export function treeUpgradeSteps(level: number): number {
  return Number.isFinite(level) && level > 0 ? Math.floor(level / UPGRADE_STEP_LEVELS) : 0;
}

/** Detailstufe einer Nische aus ihrer Ausbaustufe: 0, 1 (ab 25) oder 2 (ab 50). */
export function nicheDetailTier(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return level >= NICHE_DETAIL_LEVELS[1] ? 2 : level >= NICHE_DETAIL_LEVELS[0] ? 1 : 0;
}

/**
 * Szene-Ausbau aus Ausbaustufen (`rings`, `leaves`, `mycorrhiza` und Nischen-IDs);
 * unbekannte IDs und ungültige Werte werden übergangen. Für die Demo und später `main.ts`.
 */
export function sceneUpgradesFromLevels(levels: Readonly<Partial<Record<string, number>>>): SceneUpgrades {
  const out: SceneUpgrades = {};
  for (const part of TREE_UPGRADE_PARTS) {
    const v = levels[part];
    if (v !== undefined) out[part] = treeUpgradeSteps(v);
  }
  for (const id of NICHE_IDS) {
    const v = levels[id];
    if (v === undefined) continue;
    (out.niches ??= {})[id as SceneNiche] = nicheDetailTier(v);
  }
  return out;
}

/**
 * Liest den Demo-Parameter `?upgrades=rings:30,leaves:20,mycorrhiza:10,roots:25` (Stufen,
 * nicht Schritte). Leer, fehlend oder ohne gültigen Eintrag → undefined (wie ohne Ausbau).
 */
export function upgradesParam(raw: string | null | undefined): SceneUpgrades | undefined {
  if (!raw) return undefined;
  const levels: Record<string, number> = {};
  let any = false;
  for (const part of raw.split(',')) {
    const [id, value] = part.split(':').map((s) => s.trim());
    if (!id || value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) continue;
    if (!(TREE_UPGRADE_PARTS as readonly string[]).includes(id) && !NICHE_IDS.includes(id)) continue;
    levels[id] = n;
    any = true;
  }
  return any ? sceneUpgradesFromLevels(levels) : undefined;
}

function stepOf(v: number | undefined, max: number): number {
  return v !== undefined && Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0;
}

/** Ausbau normalisiert (ganzzahlig, begrenzt). */
export interface UpgradeLook {
  rings: number;
  leaves: number;
  mycorrhiza: number;
  roots: number;
  crown: number;
  edge: number;
}

/**
 * Zahl-Schlüssel des Ausbaus (0 = kein Ausbau, wie ohne Angabe). Ohne Allokation – darf
 * jeden Frame laufen; neu gezeichnet wird nur bei einem anderen Schlüssel.
 */
export function upgradesKey(u: SceneUpgrades | undefined): number {
  if (!u) return 0;
  const n = u.niches;
  const r = stepOf(u.rings, UPGRADE_MAX_STEPS);
  const l = stepOf(u.leaves, UPGRADE_MAX_STEPS);
  const m = stepOf(u.mycorrhiza, MAX_MUSHROOMS);
  const nr = n ? stepOf(n.roots, 2) : 0;
  const nc = n ? stepOf(n.crown, 2) : 0;
  const ne = n ? stepOf(n.edge, 2) : 0;
  return r + 11 * (l + 11 * (m + 7 * (nr + 3 * (nc + 3 * ne))));
}

/** Normalisierter Ausbau; null, wenn nichts davon sichtbar ist. */
export function upgradeLook(u: SceneUpgrades | undefined): UpgradeLook | null {
  if (upgradesKey(u) === 0) return null;
  const n = u!.niches;
  return {
    rings: stepOf(u!.rings, UPGRADE_MAX_STEPS),
    leaves: stepOf(u!.leaves, UPGRADE_MAX_STEPS),
    mycorrhiza: stepOf(u!.mycorrhiza, MAX_MUSHROOMS),
    roots: n ? stepOf(n.roots, 2) : 0,
    crown: n ? stepOf(n.crown, 2) : 0,
    edge: n ? stepOf(n.edge, 2) : 0,
  };
}

/** Faktor auf die Stammbreite (1 … 1,3). */
export function trunkFactor(up: UpgradeLook | null): number {
  return 1 + TRUNK_PER_STEP * (up ? up.rings : 0);
}

/** Faktor auf das Kronenvolumen (Fläche, 1 … 1,4). */
export function crownFactor(up: UpgradeLook | null): number {
  return 1 + CROWN_PER_STEP * (up ? up.leaves : 0);
}

/** Grenzen für die vollere Krone in Baum-Einheiten (ab Stammfuß): nach oben und zur Seite. */
export interface CrownLimits {
  up: number;
  half: number;
}

/**
 * Hauptbaum mit Ausbau: Stamm und dicke Äste breiter (dünne Zweige kaum), Krone voller
 * (größere Blattbüschel, etwas nach außen und oben gerückt). Die Krone bleibt innerhalb
 * `limits` (Bildrand) – reicht der Platz nicht, wächst sie weniger. Ohne Ausbau dasselbe
 * Objekt; sonst eine Kopie (die gebaute Geometrie bleibt unverändert).
 */
export function upgradeMainTree(main: PlacedTree, up: UpgradeLook | null, limits: CrownLimits): PlacedTree {
  if (!up || (up.rings === 0 && up.leaves === 0)) return main;
  const src = main.geo;
  const kt = trunkFactor(up);
  let geo: PlantGeometry = src;
  if (kt !== 1 && src.segments.length > 0) {
    const foot = Math.max(src.segments[0]!.w1, 1e-6);
    // Gewicht: Stamm und Hauptäste voll, dünne Zweige fast nicht (sonst wirkt die Krone schwer).
    const wf = (w: number) => 1 + (kt - 1) * clamp01((w / foot) * 1.6);
    geo = {
      ...src,
      segments: src.segments.map((s) => ({ ...s, w1: s.w1 * wf(s.w1), w2: s.w2 * wf(s.w2) })),
      branches: src.branches.map((b) => ({ ...b, w1: b.w1 * wf(b.w1), w2: b.w2 * wf(b.w2) })),
    };
  }
  const kc = crownFactor(up);
  if (kc !== 1 && src.leaves.length > 0) geo = fullerCrown(geo, Math.sqrt(kc) - 1, limits);
  return { ...main, geo, trunkWidth: main.trunkWidth * kt };
}

/**
 * Krone um den linearen Zuwachs `extra` voller. Seitlich bleibt sie in `limits.half`
 * (Büschel rücken nach innen); passt sie oben nicht, schrumpft der Zuwachs.
 */
function fullerCrown(geo: PlantGeometry, extra: number, limits: CrownLimits): PlantGeometry {
  let cx = 0;
  let cy = 0;
  for (const l of geo.leaves) {
    cx += l.x;
    cy += l.y;
  }
  cx /= geo.leaves.length;
  cy /= geo.leaves.length;
  // Nie enger als die Krone ohne Ausbau (die liegt schon so im Bild).
  const up = Math.max(limits.up, -geo.minY);
  const half = Math.max(limits.half, -geo.minX, geo.maxX);
  const build = (e: number): PlantGeometry => {
    const push = 1 + e * 0.55;
    const grow = 1 + e * 1.15;
    const out: PlantGeometry = { ...geo, leaves: [], minX: geo.minX, maxX: geo.maxX, minY: geo.minY, maxY: geo.maxY };
    for (const l of geo.leaves) {
      const r = l.r * grow;
      // Seitlich am Bildrand: Büschel rücken nach innen statt hinauszuwachsen (schmale
      // Bildschirme) – die Krone wird dort dichter, nicht breiter.
      const reach = Math.max(half, Math.abs(l.x) + l.r) - r;
      const px = cx + (l.x - cx) * push;
      const x = Math.max(-reach, Math.min(reach, px));
      // Nur nach oben ausdehnen: Die untere Kronenkante bleibt (kein Laub am Boden).
      const y = l.y < cy ? cy + (l.y - cy) * push : l.y;
      out.leaves.push({ ...l, x, y, r });
      if (x - r < out.minX) out.minX = x - r;
      if (x + r > out.maxX) out.maxX = x + r;
      if (y - r < out.minY) out.minY = y - r;
    }
    return out;
  };
  const fits = (g: PlantGeometry) => -g.minY <= up + 1e-9;
  let best = build(extra);
  if (fits(best)) return best;
  // Halbieren: größter Zuwachs, der noch passt (wenige Durchgänge, nur beim Neuzeichnen).
  let lo = 0;
  let hi = extra;
  best = geo;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const g = build(mid);
    if (fits(g)) {
      lo = mid;
      best = g;
    } else hi = mid;
  }
  return best;
}

/** Kronengrenzen eines Hauptbaums im Bild (etwas Luft unter dem oberen Rand, nicht über die Seiten). */
export function crownLimits(layout: Layout, main: PlacedTree): CrownLimits {
  const s = Math.max(main.scale, 1e-6);
  return { up: (main.y - layout.top * 0.35) / s, half: (layout.width / 2 - 2) / s };
}

// --- Pilzhüte am Stammfuß ---

const CAP_COLORS: readonly [string, string][] = [
  ['#9a5a34', '#b97c4e'],
  ['#a8703f', '#c9935f'],
  ['#86502f', '#a46a43'],
];
const STEM_COLOR = '#e6dcc4';
const STEM_SHADE = '#c9b998';
const GILL_COLOR = '#d8c6a1';

/** Lage eines Pilzhuts (CSS-Pixel): Fuß x/y, Größe, Neigung, Farbe. */
export interface MushroomSpot {
  x: number;
  y: number;
  size: number;
  tilt: number;
  color: number;
}

/**
 * Pilzhüte am Stammfuß: abwechselnd rechts und links, nach außen versetzt (Seed-Zufall,
 * jeder Hut behält seinen Platz, wenn weitere dazukommen); `g` (Wachstum) skaliert sie stufenlos.
 */
export function mushroomSpots(count: number, x: number, groundY: number, footHalf: number, layout: Layout, g = 5): MushroomSpot[] {
  const n = Math.min(MAX_MUSHROOMS, Math.max(0, Math.floor(count)));
  // Am jungen Baum kleiner (sonst überragen die Pilze den Keimling).
  const base = clamp(layout.height * 0.024, 7, 15) * (0.45 + 0.55 * smooth01((g - 0.5) / 3.5));
  const out: MushroomSpot[] = [];
  for (let i = 0; i < n; i++) {
    const rand = mulberry32(hash2(4021, i));
    const side = i % 2 === 0 ? 1 : -1;
    const k = Math.floor(i / 2);
    const size = base * (0.7 + 0.5 * rand()) * (k === 0 ? 1.1 : 1);
    const dx = footHalf + base * (0.15 + 0.85 * k + 0.35 * rand());
    out.push({ x: x + side * dx, y: groundY + 1 + rand() * base * 0.25, size, tilt: side * (0.05 + 0.12 * rand()), color: Math.floor(rand() * CAP_COLORS.length) });
  }
  return out;
}

/** Umriss der Pilzhüte in CSS-Pixeln [x0, y0, x1, y1] oder null. */
export function mushroomBounds(spots: readonly MushroomSpot[]): [number, number, number, number] | null {
  if (spots.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of spots) {
    x0 = Math.min(x0, m.x - m.size);
    x1 = Math.max(x1, m.x + m.size);
    y0 = Math.min(y0, m.y - m.size * 1.2);
    y1 = Math.max(y1, m.y + 2);
  }
  return [x0, y0, x1, y1];
}

/** Zeichnet die Pilzhüte (Stiel, Lamellen, Hut mit Glanz). */
export function paintMushrooms(ctx: CanvasRenderingContext2D, spots: readonly MushroomSpot[], look: SeasonLook | null): void {
  // Im tiefen Winter ruhen die Fruchtkörper (unter dem Schnee) – das Geflecht bleibt.
  if (look && look.snow > 0.5) return;
  for (const m of spots) {
    const s = m.size;
    const h = s * 0.75;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.tilt);
    // Stiel
    ctx.fillStyle = STEM_COLOR;
    ctx.beginPath();
    ctx.moveTo(-s * 0.17, 0);
    ctx.quadraticCurveTo(-s * 0.2, -h * 0.5, -s * 0.13, -h);
    ctx.lineTo(s * 0.13, -h);
    ctx.quadraticCurveTo(s * 0.22, -h * 0.5, s * 0.17, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = STEM_SHADE;
    ctx.fillRect(s * 0.04, -h * 0.9, s * 0.1, h * 0.85);
    // Lamellen (Unterseite des Huts)
    ctx.fillStyle = GILL_COLOR;
    ctx.beginPath();
    ctx.ellipse(0, -h, s * 0.5, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hut
    const [cap, light] = CAP_COLORS[m.color]!;
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -h);
    ctx.bezierCurveTo(-s * 0.55, -h - s * 0.55, s * 0.55, -h - s * 0.55, s * 0.55, -h);
    ctx.quadraticCurveTo(0, -h + s * 0.08, -s * 0.55, -h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(-s * 0.18, -h - s * 0.27, s * 0.17, s * 0.08, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// --- Nischen-Details ---

/** Wurmgänge im Erdschnitt (Wurzelraum ab 25: 4, ab 50: 8). Im Hintergrund, unter den Wurzeln. */
export function paintWormBurrows(ctx: CanvasRenderingContext2D, layout: Layout, tier: number): void {
  if (tier <= 0) return;
  const { width, groundY, soilH } = layout;
  const n = tier >= 2 ? 8 : 4;
  const lw = clamp(soilH * 0.014, 1.4, 3.2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, groundY, width, soilH);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [color, w, alpha] of [
    ['#3f2c1d', lw * 1.9, 0.38],
    ['#8c6a4a', lw * 0.7, 0.55],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const rand = mulberry32(hash2(5113, i));
      // Abwechselnd links und rechts, nicht direkt unter dem Stamm.
      const side = i % 2 === 0 ? -1 : 1;
      let x = width / 2 + side * width * (0.12 + 0.33 * rand());
      let y = groundY + soilH * (0.3 + 0.55 * rand());
      const len = soilH * (0.16 + 0.14 * rand());
      let ang = (rand() - 0.5) * 1.6 + (rand() < 0.5 ? 0 : Math.PI);
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        ang += (rand() - 0.5) * 1.3;
        const nx = x + Math.cos(ang) * len * 0.25;
        const ny = y + Math.sin(ang) * len * 0.25;
        ctx.quadraticCurveTo(x + Math.cos(ang + 0.6) * len * 0.12, y + Math.sin(ang + 0.6) * len * 0.12, nx, ny);
        x = nx;
        y = ny;
      }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Nistkästen am Stamm (Krone ab 25: einer, ab 50: ein zweiter höher an der anderen Seite). */
export function paintNestBoxes(ctx: CanvasRenderingContext2D, main: PlacedTree, tier: number, layout: Layout): [number, number, number, number] | null {
  const trunk = main.geo.branches[0];
  if (tier <= 0 || !trunk) return null;
  let box: [number, number, number, number] | null = null;
  // Der zweite Kasten hängt am dicksten Hauptast (sonst höher am Stamm).
  let limb = trunk;
  let limbT = 0.82;
  for (const i of trunk.children) {
    const c = main.geo.branches[i];
    if (c && i !== trunk.children[0] && (limb === trunk || c.w1 > limb.w1)) {
      limb = c;
      limbT = 0.35;
    }
  }
  const spots: [PlantGeometry['branches'][number], number, number][] = [[trunk, 0.5, 0.18]];
  if (tier >= 2) spots.push([limb, limbT, 0]);
  for (const [branch, t, off] of spots) {
    const p = trunkAt(branch, t);
    const half = (p.w * main.scale) / 2;
    const w = clamp(half * 0.95, 0, layout.height * 0.03);
    // Zu dünner Stamm (junger Baum): kein Kasten – er sähe größer aus als der Stamm.
    if (w < 4 || half < 4) continue;
    const x = main.x + p.x * main.scale + off * half;
    const y = main.y + p.y * main.scale;
    const h = w * 1.3;
    // Brett
    ctx.fillStyle = '#7d6044';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = '#69503a';
    ctx.fillRect(x + w * 0.2, y - h / 2, w * 0.3, h);
    // Dach
    ctx.fillStyle = '#4f3d2c';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.68, y - h / 2 + w * 0.08);
    ctx.lineTo(x, y - h / 2 - w * 0.36);
    ctx.lineTo(x + w * 0.68, y - h / 2 + w * 0.08);
    ctx.closePath();
    ctx.fill();
    // Flugloch und Sitzstange
    ctx.fillStyle = '#24190f';
    ctx.beginPath();
    ctx.arc(x, y - h * 0.08, w * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4f3d2c';
    ctx.lineWidth = Math.max(1, w * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.18);
    ctx.lineTo(x, y + h * 0.3);
    ctx.stroke();
    const b: [number, number, number, number] = [x - w * 0.7, y - h / 2 - w * 0.4, x + w * 0.7, y + h / 2];
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
  }
  return box;
}

function trunkAt(b: PlantGeometry['branches'][number], f: number): { x: number; y: number; w: number } {
  const w = b.w1 + (b.w2 - b.w1) * f;
  if (f < 0.5) {
    const u = f * 2;
    return { x: b.x1 + (b.mx - b.x1) * u, y: b.y1 + (b.my - b.y1) * u, w };
  }
  const u = (f - 0.5) * 2;
  return { x: b.mx + (b.x2 - b.mx) * u, y: b.my + (b.y2 - b.my) * u, w };
}

const FLOWER_COLORS = ['#f3efe2', '#f0d35e', '#b9a3d6', '#e5a3b3'] as const;

/**
 * Blütenpunkte am Waldsaum (ab 25: wenige, ab 50: doppelt so viele), beidseits im äußeren
 * Drittel auf der Grasnarbe. Im Herbst weniger, im Winter keine.
 */
export function paintEdgeFlowers(ctx: CanvasRenderingContext2D, layout: Layout, tier: number, look: SeasonLook | null): void {
  if (tier <= 0) return;
  const season = look ? clamp01(1 - look.snow * 1.5) * (1 - 0.6 * look.autumn) : 1;
  const perSide = Math.round((tier >= 2 ? 16 : 8) * season);
  if (perSide <= 0) return;
  const { width, height, groundY } = layout;
  const r = clamp(height * 0.005, 1.5, 3);
  const stem = r * 2.6;
  for (let i = 0; i < perSide * 2; i++) {
    const rand = mulberry32(hash2(6007, i));
    const side = i % 2 === 0 ? 1 : -1;
    const x = width / 2 + side * width * (0.29 + 0.19 * rand());
    const y = groundY + 1 + rand() * r * 1.5;
    const h = stem * (0.7 + 0.6 * rand());
    const tx = x + (rand() - 0.5) * r;
    ctx.strokeStyle = '#5d8a3c';
    ctx.lineWidth = Math.max(0.8, r * 0.45);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, y - h);
    ctx.stroke();
    ctx.fillStyle = FLOWER_COLORS[Math.floor(rand() * FLOWER_COLORS.length)]!;
    ctx.beginPath();
    ctx.arc(tx, y - h, r * (0.8 + 0.4 * rand()), 0, Math.PI * 2);
    ctx.fill();
  }
}
