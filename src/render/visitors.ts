/**
 * Durchreisende (DESIGN_V2.md 7.5): Gäste ohne festen Platz, die eine Weile bleiben.
 *
 *   cranes            Kraniche ziehen in V-Formation hinter dem Baum über den Himmel
 *   bramblings        ein Bergfinken-Schwarm kreist locker neben der Krone
 *   hummingbird-moth  ein Taubenschwänzchen schwirrt von Blüte zu Blüte am Waldsaum
 *   (unbekannt)       ein kleiner Vogelschwarm in gedeckten Farben
 *
 * Gezeichnet werden nur gecachte Sprites (Sprite-Cache der Tiere) mit Verschieben und
 * Spiegeln; alle Bahnen sind reine Funktionen der Zeit und des Platzes (`slot`).
 * Bei `reducedMotion` stehen die Gäste still an einer festen, gut sichtbaren Stelle.
 */

import { SpriteCache } from './animals';
import { clamp, hash2, smooth01 } from './util';

/** Ein Gast, wie ihn der Renderer bekommt (IDs aus scripts/v2/content.ts `VISITORS`). */
export interface SceneVisitor {
  id: string;
  /** Platz 0..n – verteilt mehrere Gäste (Höhe, Seite, Phase). */
  slot: number;
}

export type VisitorKind = 'cranes' | 'bramblings' | 'moth' | 'flock';

const VISITOR_KIND: Record<string, VisitorKind> = {
  cranes: 'cranes',
  bramblings: 'bramblings',
  'hummingbird-moth': 'moth',
};

/** Welche Darstellung bekommt ein Gast? Unbekannte IDs werden zum kleinen Vogelschwarm. */
export function visitorKind(id: string): VisitorKind {
  return VISITOR_KIND[id] ?? 'flock';
}

/** Ebene: Kraniche fliegen fern hinter dem Baum, alle anderen davor. */
export function visitorDepth(kind: VisitorKind): 'sky' | 'front' {
  return kind === 'cranes' ? 'sky' : 'front';
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
}

type Sprite = ReturnType<SpriteCache['get']>;

/** Gäste einer Szene mit eigenem Sprite-Cache. */
export class VisitorLayer {
  readonly sprites = new SpriteCache();
  private spriteKey = -1;

  draw(ctx: CanvasRenderingContext2D, visitors: readonly SceneVisitor[], depth: 'sky' | 'front', f: VisitorFrame): void {
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

  /** Schwirrt zwischen drei Blütenhöhen am Waldsaum hin und her und steht dazwischen still in der Luft. */
  private drawMoth(ctx: CanvasRenderingContext2D, slot: number, seed: number, f: VisitorFrame): void {
    const S = f.size;
    const ms = S * 0.78;
    const side = slot % 2 === 0 ? -1 : 1;
    const spots = [
      [0.3, 1.5],
      [0.37, 2.0],
      [0.24, 1.25],
    ] as const;
    const at = (k: number) => {
      // Auch für negative k (negative Zeit) ein gültiger Index.
      const [u, hgt] = spots[((k % spots.length) + spots.length) % spots.length]!;
      return { x: f.width * (0.5 + side * u), y: f.groundY - S * hgt };
    };
    const period = 3.2;
    // Versatz je Gast; ohne Bewegung bleibt er, nur die Zeit steht.
    const offset = ((seed & 1023) / 1024) * period * 3;
    const t = (f.reducedMotion ? 0 : f.time) + offset;
    const n = Math.floor(t / period);
    const local = t / period - n;
    const from = at(n + 2);
    const to = at(n + 3);
    // Ohne Bewegung schwebt er ruhig an einer Blüte (nie mitten im Flug).
    const m = f.reducedMotion ? 1 : smooth01(local / 0.22);
    let x = from.x + (to.x - from.x) * m;
    let y = from.y + (to.y - from.y) * m - Math.sin(m * Math.PI) * S * 0.5;
    if (!f.reducedMotion) {
      // Feines Zittern beim Schweben.
      x += Math.sin(t * 9.1) * S * 0.03;
      y += Math.sin(t * 13.7) * S * 0.04;
    }
    // Während des Flugs in Flugrichtung, beim Schweben zur Mitte (zu den Blüten hin) schauen.
    const moving = m > 0 && m < 1;
    const dir = moving ? (to.x > from.x ? -1 : 1) : side === -1 ? -1 : 1;
    const frame = f.reducedMotion ? 0 : Math.floor(t * 24) & 1;
    blit(ctx, this.sprites.get('visitor:moth', frame, false, ms, f.dpr), x, y, dir, 1, f);
  }
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

/** Sprite an (x, y) [CSS-px], gespiegelt mit `dir`. */
function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, dir: number, alpha: number, f: VisitorFrame): void {
  const k = f.dpr;
  ctx.globalAlpha = alpha;
  ctx.setTransform(f.sx * k * dir, 0, 0, f.sy * k, f.sx * k * x, f.sy * k * y);
  ctx.drawImage(s.canvas, -s.ox, -s.oy, s.w, s.h);
}
