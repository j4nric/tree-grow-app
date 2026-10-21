/**
 * Durchreisende (DESIGN_V2.md 7.5): Gäste ohne festen Platz, die eine Weile bleiben.
 *
 *   cranes            Kraniche ziehen in V-Formation hinter dem Baum über den Himmel
 *   bramblings        ein Bergfinken-Schwarm kreist locker neben der Krone
 *   hummingbird-moth  ein Taubenschwänzchen schwirrt von Blüte zu Blüte am Waldsaum
 *   swallows          Schwalben jagen in flinken Bögen tief über der Wiese
 *   boars             eine Wildschwein-Rotte (Bache und Frischlinge) zieht am Waldsaum
 *                     entlang, bleibt stehen und wühlt
 *   peregrine         ein Wanderfalke kreist hoch oben und stößt ab und zu herab
 *   stag-flight       Hirschkäfer brummen schwerfällig um die Krone (Hochzeitsflug)
 *   waxwings          ein Trupp Seidenschwänze sitzt in der Krone (vorher: im Flug)
 *   (unbekannt)       ein kleiner Vogelschwarm in gedeckten Farben
 *
 * Gezeichnet werden nur gecachte Sprites (Sprite-Cache der Tiere) mit Verschieben,
 * Spiegeln und Drehen; alle Bahnen sind reine Funktionen von Zeit, Art und Platz.
 * Bei `reducedMotion` stehen die Gäste still an einer festen, gut sichtbaren Stelle.
 *
 * Plätze von Großtieren am Waldsaum (`blocked`) bleiben frei: Wildschweine laufen nur
 * in den Lücken dazwischen, das Taubenschwänzchen weicht aus, Schwalben fliegen über
 * den Köpfen der Großtiere.
 */

import { edgeFootprint, type AnchorResolver } from './anchors';
import { isLargeAnimal, SpriteCache, type SceneAnimal } from './animals';
import { clamp, hash2, smooth01 } from './util';

/** Ein Gast, wie ihn der Renderer bekommt (IDs aus scripts/v2/content.ts `VISITORS`). */
export interface SceneVisitor {
  id: string;
  /** Platz 0..n – verteilt mehrere Gäste (Höhe, Seite, Phase). */
  slot: number;
}

export type VisitorKind = 'cranes' | 'bramblings' | 'moth' | 'swallows' | 'boars' | 'peregrine' | 'stags' | 'waxwings' | 'flock';

const VISITOR_KIND: Record<string, VisitorKind> = {
  cranes: 'cranes',
  bramblings: 'bramblings',
  'hummingbird-moth': 'moth',
  swallows: 'swallows',
  boars: 'boars',
  peregrine: 'peregrine',
  'stag-flight': 'stags',
  waxwings: 'waxwings',
};

/** Alle Gast-IDs mit eigener Zeichnung (z. B. für die Demo). */
export const VISITOR_IDS: readonly string[] = Object.keys(VISITOR_KIND);

/** Welche Darstellung bekommt ein Gast? Unbekannte IDs werden zum kleinen Vogelschwarm. */
export function visitorKind(id: string): VisitorKind {
  return VISITOR_KIND[id] ?? 'flock';
}

/** Zeichenebene eines Gasts: fern am Himmel, auf der Wiese hinter dem Hauptbaum, davor. */
export type VisitorDepth = 'sky' | 'meadow' | 'front';

/** Ebene: Kraniche und Falke fern hinter dem Baum, Wildschweine hinter dem Stamm, alle anderen davor. */
export function visitorDepth(kind: VisitorKind): VisitorDepth {
  if (kind === 'cranes' || kind === 'peregrine') return 'sky';
  if (kind === 'boars') return 'meadow';
  return 'front';
}

export interface VisitorFrame {
  width: number;
  height: number;
  groundY: number;
  top: number;
  /** Tiergröße S (px). */
  size: number;
  dpr: number;
  sx: number;
  sy: number;
  time: number;
  reducedMotion: boolean;
  /** Scherfaktor des Hauptbaums (Wind) – Gäste in der Krone schwingen mit. */
  windSkew: number;
  /** Bereiche der Großtiere am Waldsaum als Paare [x0, x1, x0, x1, …] (CSS-Pixel). */
  blocked: readonly number[];
  /** Ankerpunkte (Äste der Krone als Sitzplätze) oder null. */
  anchors: AnchorResolver | null;
  /** Krone des Hauptbaums als Ellipse (erst ab Stufe „Junger Baum“), sonst crownRx = 0. */
  crownX: number;
  crownY: number;
  crownRx: number;
  crownRy: number;
}

type Sprite = ReturnType<SpriteCache['get']>;

/** Gäste einer Szene mit eigenem Sprite-Cache. */
export class VisitorLayer {
  readonly sprites = new SpriteCache();
  private spriteKey = -1;

  private blocked: number[] = [];
  private blockedAnchors: AnchorResolver | null = null;
  private blockedMask = -1;

  /**
   * Bereiche der Großtiere am Waldsaum (Reh, Fuchs, Wolf …) samt Blumen. Kleine Tiere
   * (Biene, Falter) dürfen vor Gästen bleiben. Neu berechnet nur, wenn sich Plätze
   * oder Ankerpunkte ändern.
   */
  updateBlocked(animals: readonly Pick<SceneAnimal, 'id' | 'family' | 'niche' | 'slot'>[] | undefined, anchors: AnchorResolver | null): readonly number[] {
    let mask = 0;
    if (animals && anchors) {
      for (const a of animals) {
        if (a.niche !== 'edge' || !Number.isFinite(a.slot) || a.slot < 0 || a.slot >= 30) continue;
        if (isLargeAnimal(a)) mask |= 1 << Math.floor(a.slot);
      }
    }
    if (mask === this.blockedMask && anchors === this.blockedAnchors) return this.blocked;
    this.blockedMask = mask;
    this.blockedAnchors = anchors;
    const list: number[] = [];
    if (anchors) {
      for (let slot = 0; slot < 30; slot++) {
        if (!(mask & (1 << slot))) continue;
        const anchor = anchors.get('edge', slot);
        if (anchor) list.push(...edgeFootprint(anchor, anchors.size));
      }
    }
    this.blocked = list;
    return list;
  }

  draw(ctx: CanvasRenderingContext2D, visitors: readonly SceneVisitor[], depth: VisitorDepth, f: VisitorFrame): void {
    if (visitors.length === 0) return;
    const key = f.size * 100_000 + Math.round(f.dpr * 1000);
    if (key !== this.spriteKey) {
      this.sprites.clear();
      this.spriteKey = key;
    }
    this.sprites.tick();
    for (let i = 0; i < visitors.length; i++) {
      const v = visitors[i];
      if (!v || typeof v.id !== 'string') continue;
      const kind = visitorKind(v.id);
      if (visitorDepth(kind) !== depth) continue;
      const slot = normSlot(v.slot);
      // Doppelte Paare aus id und Platz nur einmal zeichnen (die Liste ist klein).
      let dup = false;
      for (let j = 0; j < i && !dup; j++) {
        const o = visitors[j];
        dup = !!o && o.id === v.id && normSlot(o.slot) === slot;
      }
      if (dup) continue;
      // Seed aus Art und Platz: verschiedene Gäste auf gleichem Platz bewegen sich verschieden.
      const seed = hash2(hashString(v.id), slot);
      switch (kind) {
        case 'cranes':
          this.drawCranes(ctx, slot, seed, f);
          break;
        case 'bramblings':
          this.drawFlock(ctx, slot, seed, f, 'visitor:brambling', 9);
          break;
        case 'flock':
          this.drawFlock(ctx, slot, seed, f, 'visitor:flyer', 6);
          break;
        case 'moth':
          this.drawMoth(ctx, slot, seed, f);
          break;
        case 'swallows':
          this.drawSwallows(ctx, seed, f);
          break;
        case 'boars':
          this.drawBoars(ctx, slot, seed, f);
          break;
        case 'peregrine':
          this.drawFalcon(ctx, slot, seed, f);
          break;
        case 'stags':
          this.drawStags(ctx, seed, f);
          break;
        case 'waxwings':
          this.drawWaxwings(ctx, slot, seed, f);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /** V-Formation, die langsam nach links (Süden) zieht; ruhiger Flügelschlag. */
  private drawCranes(ctx: CanvasRenderingContext2D, slot: number, seed: number, f: VisitorFrame): void {
    const n = f.width < 600 ? 5 : 7;
    const cs = f.size * (f.width < 600 ? 0.75 : 0.9);
    const span = f.groundY - f.top;
    const y0 = f.top + span * (0.1 + 0.09 * (slot % 3)) + cs;
    const formation = Math.ceil((n - 1) / 2) * 1.15 * cs + cs;
    const path = f.width + formation * 1.3;
    const speed = Math.max(18, f.width / 40);
    const u = (hash2(seed, 5) & 1023) / 1024;
    const phase = u * path;
    // Ohne Bewegung: fest im sichtbaren Himmel, je Gast versetzt.
    const pos = f.reducedMotion ? f.width * (0.35 + 0.4 * u) + formation * 0.5 : (((f.time * speed + phase) % path) + path) % path;
    const lead = f.width + cs - pos;
    for (let i = 0; i < n; i++) {
      const k = Math.ceil(i / 2);
      const arm = i % 2 === 0 ? 1 : -1;
      const x = lead + k * 1.15 * cs;
      if (x < -cs * 1.2 || x > f.width + cs * 1.2) continue;
      const bob = f.reducedMotion ? 0 : Math.sin(f.time * 0.7 + i * 0.9) * cs * 0.05;
      const y = y0 + arm * k * 0.42 * cs + bob;
      const frame = f.reducedMotion ? 0 : Math.floor(f.time * 1.3 + i * 0.37) & 1;
      blit(ctx, this.sprites.get('visitor:crane', frame, false, cs, f.dpr), x, y, 1, 0.92, f);
    }
  }

  /** Lockerer Schwarm, der neben der Krone kreist; jeder Vogel auf eigener Bahn. */
  private drawFlock(ctx: CanvasRenderingContext2D, slot: number, seed: number, f: VisitorFrame, sprite: string, count: number): void {
    const n = f.width < 600 ? Math.ceil(count * 0.67) : count;
    const bs = f.size * 0.62;
    const side = slot % 2 === 0 ? -1 : 1;
    const span = f.groundY - f.top;
    // Ohne Bewegung steht die Zeit – der Versatz je Gast (Seed) bleibt.
    const t = f.reducedMotion ? 0 : f.time;
    const ph0 = ((seed & 1023) / 1024) * 6.283;
    const cx = f.width * (0.5 + side * 0.3) + f.width * 0.04 * Math.sin(t * 0.09 + ph0);
    const cy = f.top + span * (0.32 + 0.06 * Math.sin(t * 0.13 + ph0 * 2));
    const R = clamp(f.width * 0.12, f.size * 2, f.size * 5);
    for (let i = 0; i < n; i++) {
      const h = hash2(seed, i);
      const r = (k: number) => (hash2(h, k) & 0xffff) / 0x10000;
      const sp = 0.35 + r(1) * 0.25;
      const ph = r(2) * 6.283;
      const rr = R * (0.45 + r(3) * 0.55);
      const a = t * sp + ph;
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * 0.45 * Math.sin(a * 1.3 + r(4));
      // Blick in Flugrichtung (Sprite schaut nach links).
      const vx = -Math.sin(a);
      const dir = f.reducedMotion ? (i % 2 === 0 ? 1 : -1) : vx > 0 ? -1 : 1;
      const flap = f.reducedMotion ? 0 : Math.floor(t * 9 + r(5) * 4) & 1;
      blit(ctx, this.sprites.get(sprite, flap, false, bs, f.dpr), x, y, dir, 1, f);
    }
  }

  /** Schwirrt zwischen drei Blüten am Waldsaum hin und her und steht dazwischen still in der Luft. */
  private drawMoth(ctx: CanvasRenderingContext2D, slot: number, seed: number, f: VisitorFrame): void {
    const p = mothPose(f, slot, seed);
    blit(ctx, this.sprites.get('visitor:moth', p.frame, false, f.size * MOTH_SCALE, f.dpr), p.x, p.y, p.dir, 1, f);
  }

  /** Schwalben: weite, flinke Bögen über der Wiese – stets über den Köpfen der Großtiere. */
  private drawSwallows(ctx: CanvasRenderingContext2D, seed: number, f: VisitorFrame): void {
    const size = f.size * 0.62;
    for (const p of swallowPoses(f, seed)) blit(ctx, this.sprites.get('visitor:swallow', p.frame, false, size, f.dpr), p.x, p.y, p.dir, 1, f, p.rot);
  }

  /** Wildschwein-Rotte am Waldsaum (hinter dem Stamm, vor den Begleitpflanzen). */
  private drawBoars(ctx: CanvasRenderingContext2D, slot: number, seed: number, f: VisitorFrame): void {
    for (const p of boarPoses(f, slot, seed)) {
      blit(ctx, this.sprites.get(p.piglet ? 'visitor:piglet' : 'visitor:boar', p.frame, false, p.size, f.dpr), p.x, p.y, p.dir, 1, f);
    }
  }

  /** Wanderfalke: kreist hoch oben, stößt alle ~15 s in weitem Bogen herab. */
  private drawFalcon(ctx: CanvasRenderingContext2D, slot: number, seed: number, f: VisitorFrame): void {
    const p = falconPose(f, slot, seed);
    blit(ctx, this.sprites.get('visitor:falcon', p.frame, false, f.size * 0.85, f.dpr), p.x, p.y, p.dir, 1, f, p.rot);
  }

  /** Hirschkäfer: schwerfällige, brummende Schleifen um die Krone. */
  private drawStags(ctx: CanvasRenderingContext2D, seed: number, f: VisitorFrame): void {
    const n = f.width < 600 ? 2 : 3;
    const t = f.reducedMotion ? 0 : f.time;
    const S = f.size;
    const has = f.crownRx > 0;
    const cx = has ? f.crownX : f.width / 2;
    const cy = has ? f.crownY : f.groundY - S * 3.2;
    const rx = has ? f.crownRx : S * 2;
    const ry = has ? f.crownRy : S * 0.8;
    for (let i = 0; i < n; i++) {
      const h = hash2(seed, i);
      const r = (k: number) => (hash2(h, k) & 0xffff) / 0x10000;
      const a = t * (0.22 + r(1) * 0.12) + r(2) * 6.283;
      const x = cx + rx * (0.75 + 0.3 * r(3)) * Math.cos(a) + f.windSkew * (cy - f.groundY);
      const y = cy + ry * 0.8 * Math.sin(a * 1.6 + r(4) * 3) + (f.reducedMotion ? 0 : Math.sin(t * 2.2 + i) * S * 0.15);
      const dir = Math.sin(a) > 0 ? -1 : 1;
      const frame = f.reducedMotion ? 0 : Math.floor(t * 16 + i) & 1;
      blit(ctx, this.sprites.get('visitor:stag', frame, false, S * 0.72, f.dpr), x, y, dir, 1, f);
    }
  }

  /** Seidenschwänze sitzen auf Ästen der Krone und hüpfen ab und zu; ohne Krone fliegen sie. */
  private drawWaxwings(ctx: CanvasRenderingContext2D, slot: number, seed: number, f: VisitorFrame): void {
    if (f.crownRx <= 0 || !f.anchors) {
      this.drawFlock(ctx, slot, seed, f, 'visitor:waxwing-fly', 6);
      return;
    }
    const n = f.width < 600 ? 4 : 6;
    const S = f.size;
    const t = f.reducedMotion ? 0 : f.time;
    for (let i = 0; i < n; i++) {
      // Sitzplätze jenseits der Tier-Plätze der Krone, je Gast versetzt.
      const perch = f.anchors.get('crown', 12 + ((seed >>> 3) % 7) + i * 3);
      if (!perch) continue;
      const h = hash2(seed, i + 40);
      const period = 5 + (h & 7) * 0.6;
      const u = t / period + (h & 1023) / 1024;
      const local = (u - Math.floor(u)) * period;
      const hop = !f.reducedMotion && local < 0.3 ? Math.sin((local / 0.3) * Math.PI) * S * 0.12 : 0;
      const dir = (hash2(h, Math.floor(u)) & 1) === 0 ? 1 : -1;
      const x = perch.x + f.windSkew * (perch.y - f.groundY);
      blit(ctx, this.sprites.get('visitor:waxwing', 0, false, S * 0.62, f.dpr), x, perch.y - hop, dir, 1, f);
    }
  }
}

export interface GuestPose {
  x: number;
  y: number;
  dir: number;
  frame: number;
  rot: number;
}

export interface BoarPose extends GuestPose {
  size: number;
  piglet: boolean;
}

/** Größe des Taubenschwänzchens (Tiergrößen). */
const MOTH_SCALE = 0.78;
/** Höhe (Tiergrößen), über der Gäste jedes Großtier am Waldsaum überragen. */
export const ABOVE_BIG_ANIMALS = 2.9;

/**
 * Taubenschwänzchen (deterministisch). Seine drei Blüten liegen in einer freien Lücke
 * am Waldsaum auf seiner Seite (bevorzugt), so kreuzt auch der Flug dazwischen kein
 * Großtier. Gibt es keine Lücke, schwebt es über den Köpfen der Großtiere.
 */
export function mothPose(f: Pick<VisitorFrame, 'width' | 'groundY' | 'size' | 'time' | 'reducedMotion' | 'blocked'>, slot: number, seed: number): GuestPose {
  const S = f.size;
  const half = S * MOTH_SCALE * 0.62;
  const side = slot % 2 === 0 ? -1 : 1;
  // Gültige Mittelpunkte (Abstand `half` zu belegten Bereichen) je Bildhälfte.
  const pick = (sd: number): [number, number] | null => {
    const lo = sd < 0 ? half : f.width / 2 + S;
    const hi = sd < 0 ? f.width / 2 - S : f.width - half;
    const free = freeIntervals(f.blocked, lo, hi, half);
    let best: [number, number] | null = null;
    for (let i = 0; i < free.length; i += 2) {
      if (!best || free[i + 1]! - free[i]! > best[1] - best[0]) best = [free[i]!, free[i + 1]!];
    }
    return best && best[1] - best[0] >= 0 ? best : null;
  };
  const gapRange = pick(side) ?? pick(-side);
  const spots = [
    [0.45, 1.5],
    [0.9, 2.0],
    [0.15, 1.25],
  ] as const;
  const at = (k: number) => {
    // Auch für negative k (negative Zeit) ein gültiger Index.
    const [u, hgt] = spots[((k % spots.length) + spots.length) % spots.length]!;
    if (!gapRange) {
      // Keine Lücke: hoch über dem Waldsaum schweben.
      return { x: f.width * (0.5 + side * (0.2 + 0.1 * u)), y: f.groundY - S * (ABOVE_BIG_ANIMALS + 0.5 + 0.3 * u) };
    }
    // Innerhalb der Lücke: zur Mitte hin (Stamm) die ersten Blüten.
    const v = side < 0 ? 1 - u : u;
    return { x: gapRange[0] + (gapRange[1] - gapRange[0]) * v, y: f.groundY - S * hgt };
  };
  const period = 3.2;
  // Versatz je Gast; ohne Bewegung bleibt er, nur die Zeit steht.
  const offset = ((seed & 1023) / 1024) * period * 3;
  const t = (f.reducedMotion ? 0 : f.time) + offset;
  const n = Math.floor(t / period);
  const local = t / period - n;
  const from = at(n + 2);
  const to = at(n + 3);
  // Ohne Bewegung schwebt es ruhig an einer Blüte (nie mitten im Flug).
  const m = f.reducedMotion ? 1 : smooth01(local / 0.22);
  let x = from.x + (to.x - from.x) * m;
  let y = from.y + (to.y - from.y) * m - Math.sin(m * Math.PI) * S * 0.5;
  if (!f.reducedMotion) {
    // Feines Zittern beim Schweben (bleibt in der Lücke: höchstens 0,03 S).
    x += Math.sin(t * 9.1) * S * 0.03 * (gapRange ? Math.min(1, (gapRange[1] - gapRange[0]) / (S * 0.1)) : 1);
    y += Math.sin(t * 13.7) * S * 0.04;
  }
  if (gapRange) x = clamp(x, gapRange[0], gapRange[1]);
  const moving = m > 0 && m < 1;
  // Im Flug in Flugrichtung, beim Schweben zur Mitte (zu den Blüten hin) schauen.
  const dir = moving ? (to.x > from.x ? -1 : 1) : side === -1 ? -1 : 1;
  const frame = f.reducedMotion ? 0 : Math.floor(t * 24) & 1;
  return { x, y, dir, frame, rot: 0 };
}

/** Mindesthöhe der Schwalben über dem Boden (Tiergrößen) – über jedem Großtier am Waldsaum. */
export const SWALLOW_MIN_HEIGHT = 3.1;

/** Schwalben (deterministisch): Lagen, Blickrichtung und Schräglage zum Zeitpunkt `f.time`. */
export function swallowPoses(f: Pick<VisitorFrame, 'width' | 'groundY' | 'size' | 'time' | 'reducedMotion'>, seed: number): GuestPose[] {
  const n = f.width < 600 ? 4 : 6;
  const S = f.size;
  const t = f.reducedMotion ? 0 : f.time;
  const out: GuestPose[] = [];
  for (let i = 0; i < n; i++) {
    const h = hash2(seed, i);
    const r = (k: number) => (hash2(h, k) & 0xffff) / 0x10000;
    const a = t * (0.45 + r(1) * 0.35) + r(2) * 6.283;
    const b = a * 2.3 + r(3) * 6;
    const x = f.width * (0.5 + 0.46 * Math.sin(a));
    const y = f.groundY - S * (SWALLOW_MIN_HEIGHT + 1.5 * (0.5 + 0.5 * Math.sin(b)));
    const vx = f.width * 0.46 * Math.cos(a);
    const vy = -S * 1.5 * 0.5 * 2.3 * Math.cos(b);
    const dir = vx > 0 ? -1 : 1;
    // Leichte Schräglage in Flugrichtung (Sprite schaut nach links).
    const rot = f.reducedMotion ? 0 : clamp(Math.atan2(vy, Math.abs(vx) + S) * -dir, -0.5, 0.5);
    const frame = f.reducedMotion ? 0 : Math.floor(t * 7 + r(4) * 4) & 1;
    out.push({ x, y, dir, frame, rot });
  }
  return out;
}

/** Halbe Breite einer Bache (Tiergrößen) – Maß für die Lücke, in der die Rotte läuft. */
const BOAR_SCALE = 1.05;

/**
 * Wildschwein-Rotte (deterministisch): Bache vorn, Frischlinge folgen auf derselben
 * Strecke. Sie liegt in der größten Lücke zwischen belegten Waldsaum-Plätzen (bei
 * Gleichstand auf der Seite des Platzes); passt keine Rotte hinein, laufen weniger
 * Tiere oder gar keine. Etappen: ~4,5 s laufen, ~3 s stehen und wühlen. Füße auf der
 * Bodenlinie.
 */
export function boarPoses(
  f: Pick<VisitorFrame, 'width' | 'groundY' | 'size' | 'time' | 'reducedMotion' | 'blocked'>,
  slot: number,
  seed: number,
): BoarPose[] {
  const S = f.size;
  const bs = S * BOAR_SCALE;
  const ps = bs * 0.62;
  // Sprite reicht −0,8 … 0,62 Einheiten; gespiegelt also bis 0,8 je Seite.
  const half = bs * 0.82;
  const gap = bs * 1.0;
  const free = freeIntervals(f.blocked, 0, f.width, S * 0.15);
  const side = slot % 2 === 0 ? -1 : 1;
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < free.length; i += 2) {
    const len = free[i + 1]! - free[i]!;
    const mid = (free[i]! + free[i + 1]!) / 2;
    const score = len + side * (mid - f.width / 2) * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return [];
  const a = free[best]! + half;
  const range = free[best + 1]! - half - a;
  if (range < 0) return [];
  const want = f.width < 600 ? 3 : 4;
  const n = Math.max(1, Math.min(want, 1 + Math.floor(range / gap)));
  const leg = 7.5;
  const walk = 4.5;
  const dist = Math.min(S * 2.4, Math.max(range, S * 0.5));
  const phase = ((seed & 1023) / 1024) * 2 * Math.max(range, 1);
  const t = f.reducedMotion ? 0 : Math.max(0, f.time);
  const k = Math.floor(t / leg);
  const local = t - k * leg;
  const moving = !f.reducedMotion && local < walk;
  const D = phase + k * dist + dist * smooth01(Math.min(1, local / walk));
  const out: BoarPose[] = [];
  for (let i = 0; i < n; i++) {
    const v = D - i * gap;
    const p = pingPong(v, range);
    const period = 2 * Math.max(range, 1e-6);
    const forward = ((v % period) + period) % period < range;
    const piglet = i > 0;
    const frame = moving ? Math.floor(t * 3 + i * 0.5) & 1 : 2 + (Math.floor(t * 0.8 + i * 0.7) & 1);
    out.push({
      x: a + p,
      // Leicht gestaffelt, damit sich Bache und Frischlinge beim Wenden nicht decken.
      y: f.groundY + 1 - S * (0.1 + (i % 2) * 0.08),
      // Sprite schaut nach links: vorwärts (nach rechts) gespiegelt.
      dir: forward ? -1 : 1,
      frame,
      rot: 0,
      size: piglet ? ps : bs,
      piglet,
    });
  }
  // Hintere (höher stehende) zuerst zeichnen.
  out.sort((p, q) => p.y - q.y);
  return out;
}

/** Wanderfalke (deterministisch): Kreisen, alle ~15 s ein Stoß in weitem Bogen. */
export function falconPose(f: Pick<VisitorFrame, 'width' | 'groundY' | 'top' | 'size' | 'time' | 'reducedMotion'>, slot: number, seed: number): GuestPose {
  const S = f.size;
  const span = f.groundY - f.top;
  const t = f.reducedMotion ? 0 : f.time;
  const ph = ((seed & 1023) / 1024) * 6.283;
  const cx = f.width * (slot % 2 === 0 ? 0.3 : 0.7);
  const cy = f.top + span * 0.14 + S;
  const R = clamp(f.width * 0.09, S * 1.8, S * 4);
  const a = t * 0.4 + ph;
  let x = cx + R * Math.cos(a);
  let y = cy + R * 0.35 * Math.sin(a);
  const dir = -Math.sin(a) > 0 ? -1 : 1;
  // Meist segeln, alle 4 s kurz ein paar Flügelschläge.
  const flap = (((t + ph) % 4) + 4) % 4;
  let frame = !f.reducedMotion && flap < 0.8 ? Math.floor(t * 5) & 1 : 0;
  let rot = 0;
  if (!f.reducedMotion) {
    const P = 15;
    const local = (((t + ph * 2) % P) + P) % P;
    if (local < 2.6) {
      // Stoß: schnell hinab, im Bogen wieder hinauf.
      const s = local / 2.6;
      const down = s < 0.4 ? smooth01(s / 0.4) : 1 - smooth01((s - 0.4) / 0.6);
      y += span * 0.3 * down;
      x += -dir * R * 0.9 * s;
      if (s < 0.4) {
        frame = 2;
        rot = -0.9 * dir * Math.sin((s / 0.4) * Math.PI * 0.5);
      }
    }
  }
  return { x, y, dir, frame, rot };
}

/** Pendelt v zwischen 0 und range hin und her. */
function pingPong(v: number, range: number): number {
  if (!(range > 0)) return 0;
  const m = ((v % (2 * range)) + 2 * range) % (2 * range);
  return m <= range ? m : 2 * range - m;
}

/**
 * Freie Bereiche zwischen `lo` und `hi` außerhalb der Paare in `blocked` (jeweils um
 * `pad` erweitert), als Paare [a, b, a, b, …].
 */
export function freeIntervals(blocked: readonly number[], lo: number, hi: number, pad: number): number[] {
  const iv: [number, number][] = [];
  for (let i = 0; i + 1 < blocked.length; i += 2) iv.push([blocked[i]! - pad, blocked[i + 1]! + pad]);
  iv.sort((p, q) => p[0] - q[0]);
  const out: number[] = [];
  let x = lo;
  for (const [a, b] of iv) {
    if (b <= x) continue;
    if (a > x) out.push(x, Math.min(a, hi));
    x = Math.max(x, b);
    if (x >= hi) break;
  }
  if (x < hi) out.push(x, hi);
  return out;
}

/** Platz: ungültig (NaN, ∞) → 0, sonst ganzzahlig und nicht negativ. */
function normSlot(slot: number): number {
  return Number.isFinite(slot) ? Math.max(0, Math.floor(slot)) : 0;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Sprite an (x, y) [CSS-px], gespiegelt mit `dir` und gedreht um `rot` (rad). */
function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, dir: number, alpha: number, f: VisitorFrame, rot = 0): void {
  const k = f.dpr;
  const c = rot === 0 ? 1 : Math.cos(rot);
  const sn = rot === 0 ? 0 : Math.sin(rot);
  ctx.globalAlpha = alpha;
  ctx.setTransform(f.sx * k * c * dir, f.sy * k * sn * dir, -f.sx * k * sn, f.sy * k * c, f.sx * k * x, f.sy * k * y);
  ctx.drawImage(s.canvas, -s.ox, -s.oy, s.w, s.h);
}
