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

/** Ein Gast, wie ihn der Renderer bekommt (IDs aus src/content/visitors.ts). */
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
  /** Verschiebung in Canvas-Pixeln (Kamera); ohne Angabe 0. */
  tx?: number;
  ty?: number;
  /** Auflösung der Sprites (Pixel je CSS-Pixel); ohne Angabe `dpr`. */
  spriteDpr?: number;
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
  /** Belegte Kronen-Anker (Tiere in der Krone) als Paare [x, y, …]. */
  crownTaken: readonly number[];
}

type Sprite = ReturnType<SpriteCache['get']>;

/** Zufallswert 0–1 aus Hash und Kanal (ohne Closure – keine Allokation pro Frame). */
function rnd(h: number, k: number): number {
  return (hash2(h, k) & 0xffff) / 0x10000;
}

/** Strecke einer Wildschwein-Rotte: Start (x), Länge der Pendelstrecke und Anzahl Tiere. */
export interface BoarRoute {
  a: number;
  range: number;
  n: number;
}

/** Gemerkter Zustand eines Gasts (je Art und Platz): Wahl der Lücke/Strecke/Äste und Posen. */
interface GuestState {
  /** Eingaben, für die die gemerkte Wahl gilt. */
  blocked: readonly number[] | null;
  anchors: AnchorResolver | null;
  taken: readonly number[] | null;
  width: number;
  size: number;
  lane: number;
  lanes: number;
  /** Taubenschwänzchen: Lücke für die Blüten (null = über den Großtieren schweben). */
  gap: [number, number] | null;
  /** Rotte: aktuelle und vorige Strecke; Überblendung 0–1 (≥ 1 = fertig). */
  route: BoarRoute | null;
  oldRoute: BoarRoute | null;
  fade: number;
  lastTime: number;
  /** Seidenschwänze: Sitzplätze als Paare [x, y, …]. */
  perches: number[];
  /** Wiederverwendete Posen (keine Allokation pro Frame). */
  pose: GuestPose;
  poses: BoarPose[];
  flight: GuestPose[];
}

/** Dauer (s), in der die Rotte bei geänderter Belegung aus- und an neuer Stelle wieder einblendet. */
export const BOAR_FADE_SECONDS = 1.2;

/** Gäste einer Szene mit eigenem Sprite-Cache. */
export class VisitorLayer {
  readonly sprites = new SpriteCache();
  private spriteKey = -1;

  private blocked: number[] = [];
  private taken: number[] = [];
  private blockedAnchors: AnchorResolver | null = null;
  private blockedMask = -1;
  private takenMask = -1;
  private states = new Map<number, GuestState>();

  /** Belegte Kronen-Anker (Tiere in der Krone) als Paare [x, y, …] – Seidenschwänze halten Abstand. */
  get crownTaken(): readonly number[] {
    return this.taken;
  }

  /**
   * Bereiche der Großtiere am Waldsaum (Reh, Fuchs, Wolf …) samt Blumen. Kleine Tiere
   * (Biene, Falter) dürfen vor Gästen bleiben. Neu berechnet nur, wenn sich Plätze
   * oder Ankerpunkte ändern; bei gleichem Inhalt bleibt das Array dasselbe (die Wahl
   * der Lücken hängt an seiner Identität). Merkt nebenbei die belegten Kronen-Anker.
   */
  updateBlocked(animals: readonly Pick<SceneAnimal, 'id' | 'family' | 'niche' | 'slot'>[] | undefined, anchors: AnchorResolver | null): readonly number[] {
    let mask = 0;
    let crown = 0;
    if (animals && anchors) {
      for (const a of animals) {
        if (!Number.isFinite(a.slot) || a.slot < 0 || a.slot >= 30) continue;
        if (a.niche === 'edge' && isLargeAnimal(a)) mask |= 1 << Math.floor(a.slot);
        else if (a.niche === 'crown') crown |= 1 << Math.floor(a.slot);
      }
    }
    if (mask === this.blockedMask && crown === this.takenMask && anchors === this.blockedAnchors) return this.blocked;
    this.blockedMask = mask;
    this.takenMask = crown;
    this.blockedAnchors = anchors;
    const list: number[] = [];
    const taken: number[] = [];
    if (anchors) {
      for (let slot = 0; slot < 30; slot++) {
        if (mask & (1 << slot)) {
          const anchor = anchors.get('edge', slot);
          if (anchor) list.push(...edgeFootprint(anchor, anchors.size));
        }
        if (crown & (1 << slot)) {
          const anchor = anchors.get('crown', slot);
          if (anchor) taken.push(anchor.x, anchor.y);
        }
      }
    }
    if (!sameNumbers(list, this.blocked)) this.blocked = list;
    if (!sameNumbers(taken, this.taken)) this.taken = taken;
    return this.blocked;
  }

  /** Einmal pro Frame vor dem ersten `draw`: Sprite-Größe prüfen und den Cache weiterzählen. */
  beginFrame(size: number, dpr: number): void {
    this.checkSpriteKey(size, dpr);
    this.sprites.tick();
  }

  /**
   * Alte Tiergrößen verwerfen. Die Auflösung gehört nicht dazu: Sprites je Auflösung
   * (Kamera-Zoom) bleiben im Cache (ihr Schlüssel enthält sie); bei Überlauf fallen die
   * unbenutzten zuerst.
   */
  private checkSpriteKey(size: number, dpr: number): void {
    void dpr;
    const key = size;
    if (key !== this.spriteKey) {
      this.sprites.clear();
      this.spriteKey = key;
    }
  }

  draw(ctx: CanvasRenderingContext2D, visitors: readonly SceneVisitor[], depth: VisitorDepth, f: VisitorFrame): void {
    if (visitors.length === 0) return;
    this.checkSpriteKey(f.size, f.dpr);
    for (let i = 0; i < visitors.length; i++) {
      const v = visitors[i];
      if (!v || typeof v.id !== 'string') continue;
      const kind = visitorKind(v.id);
      if (visitorDepth(kind) !== depth) continue;
      const slot = normSlot(v.slot);
      if (isDuplicate(visitors, i)) continue;
      // Seed aus Art und Platz: verschiedene Gäste auf gleichem Platz bewegen sich verschieden.
      const seed = hash2(hashString(v.id), slot);
      // Bahn unter den Gästen derselben Art (nach Platz) – so überlagern sie sich nicht.
      let lane = 0;
      let lanes = 0;
      for (let j = 0; j < visitors.length; j++) {
        const o = visitors[j];
        if (!o || typeof o.id !== 'string' || visitorKind(o.id) !== kind || isDuplicate(visitors, j)) continue;
        lanes++;
        const os = normSlot(o.slot);
        if (os < slot || (os === slot && j < i)) lane++;
      }
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
          this.drawMoth(ctx, slot, seed, lane, lanes, f);
          break;
        case 'swallows':
          this.drawSwallows(ctx, seed, f);
          break;
        case 'boars':
          this.drawBoars(ctx, slot, seed, lane, lanes, f);
          break;
        case 'peregrine':
          this.drawFalcon(ctx, slot, seed, f);
          break;
        case 'stags':
          this.drawStags(ctx, seed, f);
          break;
        case 'waxwings':
          this.drawWaxwings(ctx, slot, seed, lane, lanes, f);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Zustand je Gast (einmal angelegt). */
  private state(seed: number): GuestState {
    let st = this.states.get(seed);
    if (!st) {
      if (this.states.size > 32) this.states.clear();
      st = {
        blocked: null,
        anchors: null,
        taken: null,
        width: -1,
        size: -1,
        lane: -1,
        lanes: -1,
        gap: null,
        route: null,
        oldRoute: null,
        fade: 1,
        lastTime: Number.NaN,
        perches: [],
        pose: { x: 0, y: 0, dir: 1, frame: 0, rot: 0 },
        poses: [],
        flight: [],
      };
      this.states.set(seed, st);
    }
    return st;
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
      blit(ctx, this.sprites.get('visitor:crane', frame, false, cs, f.spriteDpr ?? f.dpr), x, y, 1, 0.92, f);
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
      const sp = 0.35 + rnd(h, 1) * 0.25;
      const rr = R * (0.45 + rnd(h, 3) * 0.55);
      const a = t * sp + rnd(h, 2) * 6.283;
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * 0.45 * Math.sin(a * 1.3 + rnd(h, 4));
      // Blick in Flugrichtung (Sprite schaut nach links).
      const vx = -Math.sin(a);
      const dir = f.reducedMotion ? (i % 2 === 0 ? 1 : -1) : vx > 0 ? -1 : 1;
      const flap = f.reducedMotion ? 0 : Math.floor(t * 9 + rnd(h, 5) * 4) & 1;
      blit(ctx, this.sprites.get(sprite, flap, false, bs, f.spriteDpr ?? f.dpr), x, y, dir, 1, f);
    }
  }

  /** Schwirrt zwischen drei Blüten am Waldsaum hin und her und steht dazwischen still in der Luft. */
  private drawMoth(ctx: CanvasRenderingContext2D, slot: number, seed: number, lane: number, lanes: number, f: VisitorFrame): void {
    const st = this.state(seed);
    if (st.blocked !== f.blocked || st.width !== f.width || st.size !== f.size || st.lane !== lane || st.lanes !== lanes) {
      st.gap = mothGap(f, slot, lane, lanes);
      st.blocked = f.blocked;
      st.width = f.width;
      st.size = f.size;
      st.lane = lane;
      st.lanes = lanes;
    }
    const p = mothPose(f, slot, seed, st.gap, st.pose, lane);
    blit(ctx, this.sprites.get('visitor:moth', p.frame, false, f.size * MOTH_SCALE, f.spriteDpr ?? f.dpr), p.x, p.y, p.dir, 1, f);
  }

  /** Schwalben: weite, flinke Bögen über der Wiese – stets über den Köpfen der Großtiere. */
  private drawSwallows(ctx: CanvasRenderingContext2D, seed: number, f: VisitorFrame): void {
    const size = f.size * 0.62;
    const poses = swallowPoses(f, seed, this.state(seed).flight);
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i]!;
      blit(ctx, this.sprites.get('visitor:swallow', p.frame, false, size, f.spriteDpr ?? f.dpr), p.x, p.y, p.dir, 1, f, p.rot);
    }
  }

  /**
   * Wildschwein-Rotte am Waldsaum (hinter dem Stamm, vor den Begleitpflanzen). Ändert
   * sich die Belegung, blendet sie aus und an der neuen Stelle wieder ein – kein Sprung.
   */
  private drawBoars(ctx: CanvasRenderingContext2D, slot: number, seed: number, lane: number, lanes: number, f: VisitorFrame): void {
    const st = this.state(seed);
    if (st.blocked !== f.blocked || st.width !== f.width || st.size !== f.size || st.lane !== lane || st.lanes !== lanes) {
      const first = st.blocked === null;
      // Neue Größe: sofort umstellen (das Bild wird ohnehin neu aufgebaut).
      const resized = st.width !== f.width || st.size !== f.size;
      const route = boarRoute(f, slot, lane, lanes);
      if (first || resized || f.reducedMotion) {
        st.oldRoute = null;
        st.fade = 1;
      } else if (!sameRoute(route, st.route)) {
        st.oldRoute = st.route;
        st.fade = 0;
      }
      st.route = route;
      st.blocked = f.blocked;
      st.width = f.width;
      st.size = f.size;
      st.lane = lane;
      st.lanes = lanes;
    }
    if (st.fade < 1) {
      const dt = f.time - st.lastTime;
      // Steht die Zeit (Pause, feste Demo-Zeit) oder springt sie, je Frame ein kleiner Schritt.
      const step = Number.isFinite(dt) && dt > 0 && dt < 0.5 ? dt : 1 / 60;
      st.fade = f.reducedMotion ? 1 : Math.min(1, st.fade + step / BOAR_FADE_SECONDS);
    }
    st.lastTime = f.time;
    // Erste Hälfte: alte Strecke ausblenden, zweite Hälfte: neue einblenden.
    const showOld = st.fade < 0.5;
    const route = showOld ? st.oldRoute : st.route;
    if (!route) return;
    const alpha = st.fade >= 1 ? 1 : showOld ? 1 - st.fade * 2 : (st.fade - 0.5) * 2;
    if (alpha <= 0.01) return;
    const poses = boarPoses(f, slot, seed, route, st.poses);
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i]!;
      blit(ctx, this.sprites.get(p.piglet ? 'visitor:piglet' : 'visitor:boar', p.frame, false, p.size, f.spriteDpr ?? f.dpr), p.x, p.y, p.dir, alpha, f);
    }
  }

  /** Wanderfalke: kreist hoch oben, stößt alle ~15 s in weitem Bogen herab. */
  private drawFalcon(ctx: CanvasRenderingContext2D, slot: number, seed: number, f: VisitorFrame): void {
    const p = falconPose(f, slot, seed, this.state(seed).pose);
    blit(ctx, this.sprites.get('visitor:falcon', p.frame, false, f.size * 0.85, f.spriteDpr ?? f.dpr), p.x, p.y, p.dir, 1, f, p.rot);
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
      const a = t * (0.22 + rnd(h, 1) * 0.12) + rnd(h, 2) * 6.283;
      const x = cx + rx * (0.75 + 0.3 * rnd(h, 3)) * Math.cos(a) + f.windSkew * (cy - f.groundY);
      const y = cy + ry * 0.8 * Math.sin(a * 1.6 + rnd(h, 4) * 3) + (f.reducedMotion ? 0 : Math.sin(t * 2.2 + i) * S * 0.15);
      const dir = Math.sin(a) > 0 ? -1 : 1;
      const frame = f.reducedMotion ? 0 : Math.floor(t * 16 + i) & 1;
      blit(ctx, this.sprites.get('visitor:stag', frame, false, S * 0.72, f.spriteDpr ?? f.dpr), x, y, dir, 1, f);
    }
  }

  /** Seidenschwänze sitzen auf Ästen der Krone und hüpfen ab und zu; ohne Krone fliegen sie. */
  private drawWaxwings(ctx: CanvasRenderingContext2D, slot: number, seed: number, lane: number, lanes: number, f: VisitorFrame): void {
    const anchors = f.anchors;
    if (f.crownRx <= 0 || !anchors) {
      this.drawFlock(ctx, slot, seed, f, 'visitor:waxwing-fly', 6);
      return;
    }
    const n = f.width < 600 ? 4 : 6;
    const S = f.size;
    const st = this.state(seed);
    if (st.anchors !== anchors || st.taken !== f.crownTaken || st.lane !== lane || st.lanes !== lanes || st.width !== f.width) {
      st.perches = waxwingPerches(anchors, f.crownTaken, n, lane, lanes);
      st.anchors = anchors;
      st.taken = f.crownTaken;
      st.lane = lane;
      st.lanes = lanes;
      st.width = f.width;
    }
    const t = f.reducedMotion ? 0 : f.time;
    const perches = st.perches;
    for (let i = 0; i + 1 < perches.length; i += 2) {
      const px = perches[i]!;
      const py = perches[i + 1]!;
      const h = hash2(seed, i + 40);
      const period = 5 + (h & 7) * 0.6;
      const u = t / period + (h & 1023) / 1024;
      const local = (u - Math.floor(u)) * period;
      const hop = !f.reducedMotion && local < 0.3 ? Math.sin((local / 0.3) * Math.PI) * S * 0.12 : 0;
      const dir = (hash2(h, Math.floor(u)) & 1) === 0 ? 1 : -1;
      const x = px + f.windSkew * (py - f.groundY);
      blit(ctx, this.sprites.get('visitor:waxwing', 0, false, S * 0.62, f.spriteDpr ?? f.dpr), x, py - hop, dir, 1, f);
    }
  }
}

/** Kommt das Paar aus id und Platz schon früher in der Liste vor? */
function isDuplicate(visitors: readonly SceneVisitor[], i: number): boolean {
  const v = visitors[i]!;
  const slot = normSlot(v.slot);
  for (let j = 0; j < i; j++) {
    const o = visitors[j];
    if (o && o.id === v.id && normSlot(o.slot) === slot) return true;
  }
  return false;
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameRoute(a: BoarRoute | null, b: BoarRoute | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.a - b.a) < 0.5 && Math.abs(a.range - b.range) < 0.5 && a.n === b.n;
}

/** Mindestabstand der Seidenschwänze zu Tieren in der Krone und untereinander (Tiergrößen). */
export const WAXWING_CLEARANCE = 0.9;
const WAXWING_SPACING = 0.6;

/**
 * Sitzplätze der Seidenschwänze (Paare [x, y, …]): Äste der Krone jenseits der
 * Tier-Plätze, mit Abstand zu belegten Kronen-Ankern und zueinander. Mehrere Trupps
 * (Bahnen) teilen sich die Äste reihum – alle Bahnen wählen gemeinsam, so überlagern
 * sie sich nicht.
 */
export function waxwingPerches(anchors: AnchorResolver, taken: readonly number[], perLane: number, lane = 0, lanes = 1): number[] {
  const S = anchors.size;
  const L = Math.max(1, lanes);
  const chosen: number[] = [];
  const mine: number[] = [];
  const counts = new Array<number>(L).fill(0);
  const minTaken = (S * WAXWING_CLEARANCE) ** 2;
  const minSelf = (S * WAXWING_SPACING) ** 2;
  for (let j = 0, k = 0; j < 80 && counts.some((c) => c < perLane); j++) {
    const p = anchors.get('crown', 12 + j);
    if (!p) continue;
    let ok = true;
    for (let i = 0; ok && i + 1 < taken.length; i += 2) ok = (p.x - taken[i]!) ** 2 + (p.y - taken[i + 1]!) ** 2 >= minTaken;
    for (let i = 0; ok && i + 1 < chosen.length; i += 2) ok = (p.x - chosen[i]!) ** 2 + (p.y - chosen[i + 1]!) ** 2 >= minSelf;
    if (!ok) continue;
    // Reihum auf die Bahnen verteilen (nur Bahnen, die noch Plätze brauchen).
    while (counts[k % L]! >= perLane) k++;
    const owner = k % L;
    k++;
    counts[owner]!++;
    chosen.push(p.x, p.y);
    if (owner === Math.min(lane, L - 1)) mine.push(p.x, p.y);
  }
  return mine;
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
/** Blüten des Taubenschwänzchens: Lage in der Lücke (0–1) und Höhe (Tiergrößen). */
const MOTH_SPOTS: readonly (readonly [number, number])[] = [
  [0.45, 1.5],
  [0.9, 2.0],
  [0.15, 1.25],
];

/**
 * Lücke für die Blüten des Taubenschwänzchens: größte freie Lücke auf seiner Seite
 * (sonst der anderen), bei mehreren Faltern (`lanes`) in Bahnen geteilt. null: keine
 * Lücke – dann schwebt es über den Köpfen der Großtiere.
 */
export function mothGap(f: Pick<VisitorFrame, 'width' | 'size' | 'blocked'>, slot: number, lane = 0, lanes = 1): [number, number] | null {
  const S = f.size;
  const half = S * MOTH_SCALE * 0.62;
  const side = slot % 2 === 0 ? -1 : 1;
  const pick = (sd: number): [number, number] | null => {
    const lo = sd < 0 ? half : f.width / 2 + S;
    const hi = sd < 0 ? f.width / 2 - S : f.width - half;
    const free = freeIntervals(f.blocked, lo, hi, half);
    let best: [number, number] | null = null;
    for (let i = 0; i < free.length; i += 2) {
      if (!best || free[i + 1]! - free[i]! > best[1] - best[0]) best = [free[i]!, free[i + 1]!];
    }
    return best;
  };
  const best = pick(side) ?? pick(-side);
  if (!best || lanes <= 1) return best;
  // Mehrere Falter: Lücke in Bahnen teilen, dazwischen je eine Falterbreite Abstand.
  const step = (best[1] - best[0]) / lanes;
  let a = best[0] + step * lane;
  let b = a + step;
  if (lane > 0) a += half;
  if (lane < lanes - 1) b -= half;
  return b >= a ? [a, b] : null;
}

/**
 * Taubenschwänzchen (deterministisch). Seine drei Blüten liegen in einer freien Lücke
 * am Waldsaum (`gap`, siehe `mothGap`), so kreuzt auch der Flug dazwischen kein
 * Großtier. Ohne Lücke schwebt es über den Köpfen der Großtiere (je Bahn versetzt).
 */
export function mothPose(
  f: Pick<VisitorFrame, 'width' | 'groundY' | 'size' | 'time' | 'reducedMotion' | 'blocked'>,
  slot: number,
  seed: number,
  gap?: readonly [number, number] | null,
  out?: GuestPose,
  lane = 0,
): GuestPose {
  const S = f.size;
  const side = slot % 2 === 0 ? -1 : 1;
  const g = gap === undefined ? mothGap(f, slot) : gap;
  const period = 3.2;
  // Versatz je Gast; ohne Bewegung bleibt er, nur die Zeit steht.
  const offset = ((seed & 1023) / 1024) * period * 3;
  const t = (f.reducedMotion ? 0 : f.time) + offset;
  const n = Math.floor(t / period);
  const local = t / period - n;
  // Blüten (Index auch für negative Zeit gültig); weitere Bahnen etwas höher.
  const lift = (lane % 2) * 0.25;
  const fromK = (((n + 2) % 3) + 3) % 3;
  const toK = (((n + 3) % 3) + 3) % 3;
  const [fu, fh] = MOTH_SPOTS[fromK]!;
  const [tu, th] = MOTH_SPOTS[toK]!;
  let fx: number;
  let tx: number;
  let fy: number;
  let ty: number;
  if (g) {
    // Innerhalb der Lücke: zur Mitte hin (Stamm) die ersten Blüten.
    const fv = side < 0 ? 1 - fu : fu;
    const tv = side < 0 ? 1 - tu : tu;
    fx = g[0] + (g[1] - g[0]) * fv;
    tx = g[0] + (g[1] - g[0]) * tv;
    fy = f.groundY - S * (fh + lift);
    ty = f.groundY - S * (th + lift);
  } else {
    // Keine Lücke: hoch über dem Waldsaum schweben; jede Bahn um mehr als ihre
    // Spannweite plus eine Falterbreite versetzt – so überlagern sich zwei Falter nie.
    const laneShift = side * lane * (f.width * 0.1 + S * MOTH_SCALE * 1.3);
    fx = f.width * (0.5 + side * (0.2 + 0.1 * fu)) + laneShift;
    tx = f.width * (0.5 + side * (0.2 + 0.1 * tu)) + laneShift;
    fy = f.groundY - S * (ABOVE_BIG_ANIMALS + 0.5 + 0.3 * fu + lift);
    ty = f.groundY - S * (ABOVE_BIG_ANIMALS + 0.5 + 0.3 * tu + lift);
  }
  // Ohne Bewegung schwebt es ruhig an einer Blüte (nie mitten im Flug).
  const m = f.reducedMotion ? 1 : smooth01(local / 0.22);
  let x = fx + (tx - fx) * m;
  let y = fy + (ty - fy) * m - Math.sin(m * Math.PI) * S * 0.5;
  if (!f.reducedMotion) {
    // Feines Zittern beim Schweben (bleibt in der Lücke: höchstens 0,03 S).
    x += Math.sin(t * 9.1) * S * 0.03 * (g ? Math.min(1, (g[1] - g[0]) / (S * 0.1)) : 1);
    y += Math.sin(t * 13.7) * S * 0.04;
  }
  if (g) x = clamp(x, g[0], g[1]);
  else x = clamp(x, S * MOTH_SCALE * 0.62, f.width - S * MOTH_SCALE * 0.62);
  const moving = m > 0 && m < 1;
  const p = out ?? { x: 0, y: 0, dir: 1, frame: 0, rot: 0 };
  p.x = x;
  p.y = y;
  // Im Flug in Flugrichtung, beim Schweben zur Mitte (zu den Blüten hin) schauen.
  p.dir = moving ? (tx > fx ? -1 : 1) : side === -1 ? -1 : 1;
  p.frame = f.reducedMotion ? 0 : Math.floor(t * 24) & 1;
  p.rot = 0;
  return p;
}

/** Mindesthöhe der Schwalben über dem Boden (Tiergrößen) – über jedem Großtier am Waldsaum. */
export const SWALLOW_MIN_HEIGHT = 3.1;

/** Schwalben (deterministisch): Lagen, Blickrichtung und Schräglage; `out` wird wiederverwendet. */
export function swallowPoses(f: Pick<VisitorFrame, 'width' | 'groundY' | 'size' | 'time' | 'reducedMotion'>, seed: number, out: GuestPose[] = []): GuestPose[] {
  const n = f.width < 600 ? 4 : 6;
  const S = f.size;
  const t = f.reducedMotion ? 0 : f.time;
  while (out.length < n) out.push({ x: 0, y: 0, dir: 1, frame: 0, rot: 0 });
  out.length = n;
  for (let i = 0; i < n; i++) {
    const h = hash2(seed, i);
    const a = t * (0.45 + rnd(h, 1) * 0.35) + rnd(h, 2) * 6.283;
    const b = a * 2.3 + rnd(h, 3) * 6;
    const vx = f.width * 0.46 * Math.cos(a);
    const vy = -S * 1.5 * 0.5 * 2.3 * Math.cos(b);
    const p = out[i]!;
    p.x = f.width * (0.5 + 0.46 * Math.sin(a));
    p.y = f.groundY - S * (SWALLOW_MIN_HEIGHT + 1.5 * (0.5 + 0.5 * Math.sin(b)));
    p.dir = vx > 0 ? -1 : 1;
    // Leichte Schräglage in Flugrichtung (Sprite schaut nach links).
    p.rot = f.reducedMotion ? 0 : clamp(Math.atan2(vy, Math.abs(vx) + S) * -p.dir, -0.5, 0.5);
    p.frame = f.reducedMotion ? 0 : Math.floor(t * 7 + rnd(h, 4) * 4) & 1;
  }
  return out;
}

/** Halbe Breite einer Bache (Tiergrößen) – Maß für die Lücke, in der die Rotte läuft. */
const BOAR_SCALE = 1.05;

/**
 * Strecke der Rotte: freie Lücken zwischen Großtieren am Waldsaum, nach Länge (bei
 * Gleichstand auf der Seite des Platzes) geordnet. Mehrere Rotten (`lanes`) nehmen
 * reihum je eine eigene Lücke; gibt es zu wenige, teilen sie die größte in Bahnen.
 * Passt keine Rotte hinein: weniger Tiere oder null.
 */
export function boarRoute(f: Pick<VisitorFrame, 'width' | 'size' | 'blocked'>, slot: number, lane = 0, lanes = 1): BoarRoute | null {
  const S = f.size;
  const bs = S * BOAR_SCALE;
  // Sprite reicht −0,8 … 0,62 Einheiten; gespiegelt also bis 0,8 je Seite.
  const half = bs * 0.82;
  const free = freeIntervals(f.blocked, 0, f.width, S * 0.15);
  const side = slot % 2 === 0 ? -1 : 1;
  const cands: [number, number, number][] = [];
  for (let i = 0; i < free.length; i += 2) {
    const len = free[i + 1]! - free[i]!;
    if (len < half * 2) continue;
    const mid = (free[i]! + free[i + 1]!) / 2;
    cands.push([len + side * (mid - f.width / 2) * 0.05, free[i]!, free[i + 1]!]);
  }
  if (cands.length === 0) return null;
  cands.sort((p, q) => q[0] - p[0]);
  const L = Math.max(1, lanes);
  let a: number;
  let b: number;
  if (L <= cands.length) {
    a = cands[lane % cands.length]![1];
    b = cands[lane % cands.length]![2];
  } else {
    // Zu wenige Lücken: die größte in Bahnen teilen.
    const step = (cands[0]![2] - cands[0]![1]) / L;
    a = cands[0]![1] + step * lane;
    b = a + step;
  }
  const start = a + half;
  const range = b - half - start;
  if (range < 0) return null;
  const want = f.width < 600 ? 3 : 4;
  return { a: start, range, n: Math.max(1, Math.min(want, 1 + Math.floor(range / bs))) };
}

/**
 * Wildschwein-Rotte (deterministisch): Bache vorn, Frischlinge folgen auf derselben
 * Strecke (`route`, siehe `boarRoute`). Etappen: ~4,5 s laufen, ~3 s stehen und
 * wühlen. Füße auf der Bodenlinie. `out` wird wiederverwendet.
 */
export function boarPoses(
  f: Pick<VisitorFrame, 'width' | 'groundY' | 'size' | 'time' | 'reducedMotion' | 'blocked'>,
  slot: number,
  seed: number,
  route?: BoarRoute | null,
  out: BoarPose[] = [],
): BoarPose[] {
  const r = route === undefined ? boarRoute(f, slot) : route;
  if (!r) {
    out.length = 0;
    return out;
  }
  const S = f.size;
  const bs = S * BOAR_SCALE;
  const ps = bs * 0.62;
  const gap = bs * 1.0;
  const { a, range, n } = r;
  const leg = 7.5;
  const walk = 4.5;
  const dist = Math.min(S * 2.4, Math.max(range, S * 0.5));
  const phase = ((seed & 1023) / 1024) * 2 * Math.max(range, 1);
  const t = f.reducedMotion ? 0 : Math.max(0, f.time);
  const k = Math.floor(t / leg);
  const local = t - k * leg;
  const moving = !f.reducedMotion && local < walk;
  const D = phase + k * dist + dist * smooth01(Math.min(1, local / walk));
  while (out.length < n) out.push({ x: 0, y: 0, dir: 1, frame: 0, rot: 0, size: 0, piglet: false });
  out.length = n;
  const period = 2 * Math.max(range, 1e-6);
  for (let i = 0; i < n; i++) {
    const v = D - i * gap;
    const p = out[i]!;
    p.x = a + pingPong(v, range);
    // Leicht gestaffelt, damit sich Bache und Frischlinge beim Wenden nicht decken.
    p.y = f.groundY + 1 - S * (0.1 + (i % 2) * 0.08);
    // Sprite schaut nach links: vorwärts (nach rechts) gespiegelt.
    p.dir = ((v % period) + period) % period < range ? -1 : 1;
    p.frame = moving ? Math.floor(t * 3 + i * 0.5) & 1 : 2 + (Math.floor(t * 0.8 + i * 0.7) & 1);
    p.rot = 0;
    p.piglet = i > 0;
    p.size = p.piglet ? ps : bs;
  }
  // Hintere (höher stehende) zuerst zeichnen – Einfügesortierung ohne Allokation.
  for (let i = 1; i < n; i++) {
    const p = out[i]!;
    let j = i - 1;
    while (j >= 0 && out[j]!.y > p.y) {
      out[j + 1] = out[j]!;
      j--;
    }
    out[j + 1] = p;
  }
  return out;
}

/** Wanderfalke (deterministisch): Kreisen, alle ~15 s ein Stoß in weitem Bogen; `out` wird wiederverwendet. */
export function falconPose(
  f: Pick<VisitorFrame, 'width' | 'groundY' | 'top' | 'size' | 'time' | 'reducedMotion'>,
  slot: number,
  seed: number,
  out?: GuestPose,
): GuestPose {
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
  const p = out ?? { x: 0, y: 0, dir: 1, frame: 0, rot: 0 };
  p.x = x;
  p.y = y;
  p.dir = dir;
  p.frame = frame;
  p.rot = rot;
  return p;
}

/** Pendelt v zwischen 0 und range hin und her. */
function pingPong(v: number, range: number): number {
  if (!(range > 0)) return 0;
  const m = ((v % (2 * range)) + 2 * range) % (2 * range);
  return m <= range ? m : 2 * range - m;
}

/**
 * Freie Bereiche zwischen `lo` und `hi` außerhalb der Paare in `blocked` (jeweils um
 * `pad` erweitert), als Paare [a, b, a, b, …]. Leer, wenn `hi` nicht größer als `lo` ist.
 */
export function freeIntervals(blocked: readonly number[], lo: number, hi: number, pad: number): number[] {
  if (!(hi > lo)) return [];
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
  ctx.setTransform(f.sx * k * c * dir, f.sy * k * sn * dir, -f.sx * k * sn, f.sy * k * c, f.sx * k * x + (f.tx ?? 0), f.sy * k * y + (f.ty ?? 0));
  ctx.drawImage(s.canvas, -s.ox, -s.oy, s.w, s.h);
}
