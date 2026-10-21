/**
 * Jahreszeiten (Grafik-Vorarbeit, ROADMAP Phase 3): ein stufenloser Wert 0–4
 *   0 Frühling · 1 Sommer · 2 Herbst · 3 Winter · 4 wieder Frühling
 *
 *   Frühling  frisches Hellgrün, lichteres Laub, Blüten an Begleitbäumen
 *   Sommer    sattes Grün – genau das heutige Bild (alle Funktionen sind dann neutral)
 *   Herbst    Laub in Gelb, Orange und Rot, fallende Blätter, goldenes Gras
 *   Winter    kahle Laubbäume (Kiefern und Moose bleiben grün), dünne Schneedecke,
 *             verschneite Hügel, kühleres Licht, leichter Schneefall
 *
 * Der Wert wird auf 0,05 gerundet; nur bei einer Änderung dieser Rundung werden Kulisse
 * und Baum-Ebenen neu gezeichnet. Die Partikel (Blätter, Flocken) sind wenige gecachte
 * Sprites, pro Frame nur verschoben; bei `reducedMotion` stehen sie still.
 */

import { leafKeep, type LeafCluster, type LeafPalette, type PlantGeometry, type WoodColors } from './plant';
import { clamp01, hash2, mix, smooth01 } from './util';

/** Rundung des Jahreszeit-Werts – darunter wird nichts neu gezeichnet. */
export const SEASON_STEP = 0.05;

/** Aussehen einer (gerundeten) Jahreszeit. Bei `summer` ist alles neutral. */
export interface SeasonLook {
  /** Gerundeter Wert 0 ≤ s < 4. */
  s: number;
  /** Sommer (s = 1): alles wie ohne Angabe. */
  summer: boolean;
  /** Laubmenge der Laubbäume 0–1 (Winter 0 = kahl). */
  leaves: number;
  /** Mischgewichte der Laubfarben: Frühling (hell) und Herbst (gelb/orange/rot). */
  spring: number;
  autumn: number;
  /** Blüten an Begleitbäumen (Frühling). */
  blossom: number;
  /** Schnee auf Boden und Hügeln, kühleres Licht (Winter). */
  snow: number;
  /** Fallende Blätter (Herbst). */
  fall: number;
}

/**
 * Normalisiert einen Jahreszeit-Wert: undefiniert oder ungültig (NaN, ∞) → null (wie
 * ohne Angabe), sonst modulo 4 (negativ und > 4 erlaubt).
 */
export function normalizeSeason(season: number | undefined): number | null {
  if (season === undefined || season === null || !Number.isFinite(season)) return null;
  return ((season % 4) + 4) % 4;
}

/** Lineare Stützstellen [s, Wert] – Wert für s (0–4). */
function curve(points: readonly (readonly [number, number])[], s: number): number {
  if (s <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [s1, v1] = points[i]!;
    const [s0, v0] = points[i - 1]!;
    if (s <= s1) return v0 + (v1 - v0) * smooth01((s - s0) / (s1 - s0));
  }
  return points[points.length - 1]![1];
}

const LEAVES: readonly (readonly [number, number])[] = [
  [0, 0.8],
  [1, 1],
  [2, 0.95],
  [2.55, 0.45],
  [2.9, 0],
  [3.3, 0],
  [4, 0.8],
];
const SPRING: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [3.15, 0],
  [3.3, 1],
  [4, 1],
];
const AUTUMN: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.3, 0],
  [2.15, 1],
  [3.1, 1],
  [3.3, 0],
  [4, 0],
];
const BLOSSOM: readonly (readonly [number, number])[] = [
  [0, 0.9],
  [0.35, 1],
  [0.9, 0],
  [3.5, 0],
  [4, 0.9],
];
const SNOW: readonly (readonly [number, number])[] = [
  [0, 0],
  [2.7, 0],
  [3.0, 1],
  [3.25, 1],
  [3.6, 0],
  [4, 0],
];
const FALL: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.6, 0],
  [2.2, 1],
  [2.75, 1],
  [3.0, 0],
  [4, 0],
];

/** Aussehen für einen Jahreszeit-Wert (gerundet auf `SEASON_STEP`), oder null ohne Angabe. */
export function seasonLook(season: number | undefined): SeasonLook | null {
  const n = normalizeSeason(season);
  if (n === null) return null;
  const s = (Math.round(n / SEASON_STEP) * SEASON_STEP) % 4;
  const q = Math.round(s * 1000) / 1000;
  if (q === 1) return SUMMER;
  let look = LOOKS.get(q);
  if (look) return look;
  look = {
    s: q,
    summer: false,
    leaves: curve(LEAVES, q),
    spring: curve(SPRING, q),
    autumn: curve(AUTUMN, q),
    blossom: curve(BLOSSOM, q),
    snow: curve(SNOW, q),
    fall: curve(FALL, q),
  };
  // Praktisch Sommer (etwa 0,97–1,15): wie Sommer behandeln – kein Neuzeichnen dazwischen.
  const w = SUMMER_EPSILON;
  if (look.spring < w && look.autumn < w && look.blossom < w && look.snow < w && look.fall < w && look.leaves > 1 - w) look = SUMMER;
  LOOKS.set(q, look);
  return look;
}

/** Unterhalb dieser Gewichte (und Laub über 1 − ε) gilt eine Jahreszeit als Sommer. */
export const SUMMER_EPSILON = 0.005;

/** Gemerkte Aussehen je Rundung (höchstens 80) – pro Frame entsteht kein neues Objekt. */
const LOOKS = new Map<number, SeasonLook>();

const SUMMER: SeasonLook = { s: 1, summer: true, leaves: 1, spring: 0, autumn: 0, blossom: 0, snow: 0, fall: 0 };

// ---------------------------------------------------------------------------
// Farben
// ---------------------------------------------------------------------------

/** Herbstlaub: dunkel → Rot, Orange, Gelb; Lichter hellgelb. */
const AUTUMN_LEAVES: LeafPalette = { shadow: '#6e3a1f', tones: ['#b5432a', '#d9802c', '#e8b53c'], highlight: '#f6dc8e' };
/** Frühling: frisch und hell. */
const SPRING_TINT = '#b9e07a';
/** Kühles Winterlicht für Holz und Kulisse. */
const COOL = '#8e9aa6';
const SNOW_WHITE = '#eef2f4';

/** Laubfarben eines Laubbaums in der Jahreszeit (Sommer: unverändert). */
export function seasonLeaves(p: LeafPalette, look: SeasonLook | null, autumnPalette: LeafPalette = AUTUMN_LEAVES): LeafPalette {
  if (!look || look.summer) return p;
  const sp = look.spring * 0.38;
  const au = look.autumn;
  const A = autumnPalette;
  const f = (c: string, autumn: string) => mix(mix(c, SPRING_TINT, sp), autumn, au);
  return {
    shadow: f(p.shadow, A.shadow),
    tones: [f(p.tones[0], A.tones[0]), f(p.tones[1], A.tones[1]), f(p.tones[2], A.tones[2])],
    highlight: f(p.highlight, A.highlight),
  };
}

/** Holzfarben im Winterlicht etwas kühler (Sommer: unverändert). */
export function seasonWood(w: WoodColors, look: SeasonLook | null): WoodColors {
  if (!look || look.summer || look.snow <= 0) return w;
  const k = look.snow * 0.18;
  return { base: mix(w.base, COOL, k), shade: mix(w.shade, COOL, k), light: mix(w.light, COOL, k) };
}

/**
 * Farbe niedriger Pflanzen und der Kulisse: Grüntöne werden im Frühling heller, im
 * Herbst goldener, im Winter blass und trocken; andere Farben (Blüten, Beeren) werden
 * im Winter nur gedämpft. Sommer: unverändert.
 */
export function seasonColor(hex: string, look: SeasonLook | null): string {
  if (!look || look.summer) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const green = g > r && g >= b;
  let c = hex;
  if (green) {
    if (look.spring > 0) c = mix(c, SPRING_TINT, look.spring * 0.22);
    if (look.autumn > 0) c = mix(c, '#b49a4c', look.autumn * 0.35);
  }
  if (look.snow > 0) c = mix(c, green ? '#9c9a84' : '#b5ab98', look.snow * (green ? 0.45 : 0.3));
  return c;
}

/** Kulisse: Hügel (verschneit, herbstlich) und Himmel (kühler im Winter). */
export function seasonHill(hex: string, look: SeasonLook | null): string {
  if (!look || look.summer) return hex;
  let c = seasonColor(hex, look);
  if (look.snow > 0) c = mix(c, SNOW_WHITE, look.snow * 0.55);
  return c;
}

export function seasonSky(hex: string, look: SeasonLook | null): string {
  if (!look || look.summer || look.snow <= 0) return hex;
  return mix(hex, '#c9d6de', look.snow * 0.35);
}

/**
 * Trägt das Büschel Nr. `i` Blüten? −1 nein, sonst die Farbe (0 weiß, 1 rosa). Nur auf
 * Büscheln, die bei der Laubmenge `leaves` auch gezeichnet werden (keine Blüten an
 * kahlen Zweigen); mehr Blüten bei höherem `amount`.
 */
export function blossomOn(l: LeafCluster, i: number, amount: number, leaves: number): number {
  if (leaves < 1 && leafKeep(l) >= leaves) return -1;
  const h = hash2(i + 1, 31);
  if (((h >>> 1) & 1023) / 1024 > amount * 0.7) return -1;
  return h & 1;
}

/**
 * Blüten auf den Blattbüscheln eines Begleitbaums (Frühling): weiße und zartrosa
 * Tupfen, je Büschel per Seed – nur auf gezeichneten Büscheln (siehe `blossomOn`).
 */
export function paintBlossoms(ctx: CanvasRenderingContext2D, geo: PlantGeometry, ox: number, oy: number, scale: number, amount: number, leaves = 1): void {
  if (amount <= 0.01 || leaves <= 0 || geo.leaves.length === 0) return;
  for (const [color, pick] of [
    ['#fbf6f2', 0],
    ['#f4cddb', 1],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    let i = -1;
    for (const l of geo.leaves) {
      i++;
      if (blossomOn(l, i, amount, leaves) !== pick) continue;
      const h = hash2(i + 1, 31);
      const R = l.r * scale;
      if (R < 1.5) continue;
      for (let k = 0; k < 3; k++) {
        const a = l.a * 6.283 + k * 2.1 + (h & 7);
        const x = ox + l.x * scale + Math.cos(a) * R * 0.55;
        const y = oy + l.y * scale + Math.sin(a) * R * 0.45 - R * 0.1;
        const r = Math.max(0.7, R * 0.13);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Schnee am Boden
// ---------------------------------------------------------------------------

/** Dünne Schneedecke entlang der Bodenlinie (in die Hintergrund-Ebene gezeichnet). */
export function paintSnowCover(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number, snow: number): void {
  if (snow <= 0.01) return;
  const depth = Math.max(2.5, height * 0.008) * (0.4 + 0.6 * snow);
  ctx.save();
  ctx.globalAlpha = clamp01(snow * 1.2);
  ctx.fillStyle = SNOW_WHITE;
  ctx.beginPath();
  ctx.moveTo(0, groundY + depth * 0.6);
  const steps = Math.max(12, Math.round(width / 14));
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width;
    // Weiche, unregelmäßige Oberkante (Seed-Zufall, kein Math.random).
    const bump = ((hash2(i, 17) & 255) / 255) * 0.6 + 0.4;
    ctx.lineTo(x, groundY - depth * bump);
  }
  ctx.lineTo(width, groundY + depth * 0.6);
  ctx.closePath();
  ctx.fill();
  // Leichter blauer Schatten an der Unterkante.
  ctx.globalAlpha = clamp01(snow) * 0.35;
  ctx.fillStyle = '#c4d2dc';
  ctx.fillRect(0, groundY + depth * 0.15, width, depth * 0.45);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Partikel: fallende Blätter und Schneeflocken
// ---------------------------------------------------------------------------

export interface SeasonFrame {
  width: number;
  groundY: number;
  top: number;
  dpr: number;
  sx: number;
  sy: number;
  time: number;
  reducedMotion: boolean;
}

/** Höchstzahl der Partikel (Desktop; Mobil die Hälfte). */
export const MAX_LEAVES = 18;
export const MAX_FLAKES = 40;

interface Particle {
  u: number;
  v: number;
  speed: number;
  sway: number;
  phase: number;
  tone: number;
  size: number;
}

function particles(count: number, seed: number): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const h = hash2(seed, i);
    const r = (k: number) => (hash2(h, k) & 0xffff) / 0x10000;
    out.push({ u: r(1), v: r(2), speed: 0.6 + r(3) * 0.8, sway: 0.5 + r(4), phase: r(5) * 6.283, tone: Math.floor(r(6) * 3), size: 0.7 + r(7) * 0.6 });
  }
  return out;
}

/** Auflösung (Gerätepixel) der Partikel-Sprites – einmal je Art gezeichnet, beim Zeichnen skaliert. */
const LEAF_SPRITE_PX = 40;
const FLAKE_SPRITE_PX = 24;

/**
 * Fallende Blätter (Herbst) und Schneefall (Winter) einer Szene. Je Art ein Sprite in
 * fester Auflösung (drei Blatttöne, eine Flocke), einmal angelegt und nie verworfen;
 * pro Frame entstehen weder Objekte noch Strings.
 */
export class SeasonParticles {
  private leaves = particles(MAX_LEAVES, 101);
  private flakes = particles(MAX_FLAKES, 202);
  private leafSprites: HTMLCanvasElement[] | null = null;
  private flakeSprite: HTMLCanvasElement | null = null;

  draw(ctx: CanvasRenderingContext2D, look: SeasonLook | null, f: SeasonFrame): void {
    if (!look || look.summer) return;
    if (look.fall <= 0.01 && look.snow <= 0.01) return;
    const t = f.reducedMotion ? 0 : f.time;
    const small = f.width < 600;
    const span = f.groundY - f.top;
    const base = Math.max(3, Math.min(f.width, span) * 0.012);
    const k = f.dpr;
    if (look.fall > 0.01) {
      const n = Math.round((small ? MAX_LEAVES / 2 : MAX_LEAVES) * look.fall);
      for (let i = 0; i < n; i++) {
        const p = this.leaves[i]!;
        // Fallen langsam und schaukeln dabei; oben neu beginnen.
        const fallen = (((p.v + t * 0.045 * p.speed) % 1) + 1) % 1;
        const x = (p.u + 0.03 * Math.sin(t * 0.9 * p.sway + p.phase)) * f.width;
        const y = f.top + span * (0.15 + 0.85 * fallen);
        const rot = f.reducedMotion ? p.phase : t * 1.6 * p.sway + p.phase;
        const size = base * 1.4 * p.size;
        const sprite = this.leafSprite(p.tone);
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        // Am Boden ausblenden.
        ctx.globalAlpha = 0.9 * look.fall * clamp01((1 - fallen) * 8);
        ctx.setTransform(f.sx * k * c, f.sy * k * s, -f.sx * k * s, f.sy * k * c, f.sx * k * x, f.sy * k * y);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      }
    }
    if (look.snow > 0.01) {
      const n = Math.round((small ? MAX_FLAKES / 2 : MAX_FLAKES) * look.snow);
      for (let i = 0; i < n; i++) {
        const p = this.flakes[i]!;
        const fallen = (((p.v + t * 0.06 * p.speed) % 1) + 1) % 1;
        const x = (p.u + 0.015 * Math.sin(t * 0.7 * p.sway + p.phase)) * f.width;
        const y = f.top * 0.3 + (f.groundY - f.top * 0.3) * fallen;
        const size = base * 0.75 * p.size;
        const sprite = this.flake();
        ctx.globalAlpha = 0.85 * look.snow * clamp01((1 - fallen) * 10);
        ctx.setTransform(f.sx * k, 0, 0, f.sy * k, f.sx * k * x, f.sy * k * y);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Blatt-Sprite in einem der drei Herbsttöne (einmal angelegt). */
  private leafSprite(tone: number): HTMLCanvasElement {
    if (!this.leafSprites) this.leafSprites = [0, 1, 2].map((t) => paintLeafSprite(AUTUMN_LEAVES.tones[t as 0 | 1 | 2]));
    return this.leafSprites[tone % 3]!;
  }

  /** Flocken-Sprite (einmal angelegt). */
  private flake(): HTMLCanvasElement {
    if (!this.flakeSprite) this.flakeSprite = paintFlakeSprite();
    return this.flakeSprite;
  }
}

function paintLeafSprite(tone: string): HTMLCanvasElement {
  const px = LEAF_SPRITE_PX;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d')!;
  const r = px / 2;
  g.translate(r, r);
  g.fillStyle = tone;
  g.beginPath();
  g.ellipse(0, 0, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(90, 50, 25, 0.6)';
  g.lineWidth = px * 0.06;
  g.beginPath();
  g.moveTo(-r * 0.85, 0);
  g.lineTo(r * 0.85, 0);
  g.stroke();
  return c;
}

function paintFlakeSprite(): HTMLCanvasElement {
  const px = FLAKE_SPRITE_PX;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d')!;
  const r = px / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.5, 'rgba(250, 252, 255, 0.85)');
  grad.addColorStop(1, 'rgba(245, 250, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, px, px);
  return c;
}

