/**
 * Tag und Nacht (DESIGN_V2.md 19): Tagesanteil 0–1 (`SceneInput.dayPhase`, 0 Mitternacht,
 * 0,25 Sonnenaufgang, 0,5 Mittag, 0,75 Sonnenuntergang).
 *
 *   Tag         Bild wie ohne Angabe (nichts wird zusätzlich gezeichnet)
 *   Dämmerung   warmer Horizont (morgens rosig-pfirsich links, abends orange rechts),
 *               warmes Licht über der Szene
 *   Nacht       dunkelblauer Himmel mit Sternen und Mond, die Landschaft gedämpft und
 *               bläulich; Tiere bleiben hell und gut erkennbar, Glühwürmchen leuchten stärker
 *
 * Pro Frame kostet das (fast) nichts: Nachthimmel, Dämmerungsschein und Lichtfarbe werden
 * in getönte Kopien der gecachten Ebenen gebacken (Kulisse, Nachbarbäume/Pflanzen,
 * Hauptbaum, Erinnerungsbaum – tree.ts). Neu getönt wird nur, wenn sich die Tönungsstufe
 * ändert (Nacht und Dämmerung je in TINT_STEPS Stufen, gut 50 Mal am Tag) oder die Ebenen
 * neu gezeichnet wurden; pro Frame werden statt der Ebenen ihre Kopien gezeigt. Dazu
 * kommen nur Sterne und Mond als kleine Sprites. Tiere, Gäste und Partikel liegen über
 * den getönten Ebenen und bleiben hell.
 * Bei `reducedMotion` gilt der Tagesanteil nur in Stufen (DAY_BUCKETS je Tag), Sterne
 * funkeln nicht, und Sprünge (z. B. Neuer Zyklus, Einstellung „Immer Tag“) werden nicht
 * übergeblendet.
 */

import { clamp01, hash2, smooth01 } from './util';

/** Stufen je Tag für weniger Bewegung (Tagesanteil und Mond nur in Schritten). */
export const DAY_BUCKETS = 48;
/** Stufen der Tönung je 0–1 Nacht bzw. Dämmerung – nur bei einer neuen Stufe wird neu getönt. */
export const TINT_STEPS = 12;
/** Größte Geschwindigkeit beim Überblenden nach einem Sprung (Tagesanteil pro Sekunde). */
export const DAY_FADE_RATE = 0.15;
/** Ab diesem Unterschied gilt eine neue Tageszeit als Sprung (sonst folgt die Szene direkt). */
const JUMP = 1 / DAY_BUCKETS;

/** Normalisiert einen Tagesanteil: undefiniert/ungültig → null (Bild wie bisher), sonst modulo 1. */
export function normalizeDayPhase(phase: number | undefined): number | null {
  if (phase === undefined || phase === null || !Number.isFinite(phase)) return null;
  const p = ((phase % 1) + 1) % 1;
  return p >= 1 ? 0 : p;
}

/** Stufe 0 … DAY_BUCKETS − 1 eines Tagesanteils (gerundet: Mitternacht 0, Mittag DAY_BUCKETS / 2). */
export function dayBucket(phase: number): number {
  const p = normalizeDayPhase(phase) ?? 0.5;
  return Math.round(p * DAY_BUCKETS) % DAY_BUCKETS;
}

/** Tagesanteil einer Stufe. */
export function bucketPhase(bucket: number): number {
  return (((Math.round(bucket) % DAY_BUCKETS) + DAY_BUCKETS) % DAY_BUCKETS) / DAY_BUCKETS;
}

/** Stärken eines Tagesanteils, je 0–1. */
export interface DayLevels {
  /** Nacht: dunkler Himmel, Sterne, gedämpfte Landschaft. */
  night: number;
  /** Dämmerung: warmer Horizont und warmes Licht. */
  twilight: number;
  /** Abend (true) oder Morgen (false) – Farbe und Seite des Dämmerungsscheins. */
  dusk: boolean;
  /** Sonnenlicht für Strahlen und warmes Licht der Stimmung (Mittag 1, Nacht 0). */
  sun: number;
}

/**
 * Stärken zum Tagesanteil `phase` (rein). Sonnenhöhe = −cos(2π · phase). Volle Nacht
 * etwa 0,83–0,17 (ein Drittel des Tages), heller Tag etwa 0,27–0,73 – dort ist alles 0
 * (Bild wie ohne Angabe), dazwischen die Dämmerung.
 */
export function dayLevels(phase: number, out: DayLevels = { night: 0, twilight: 0, dusk: false, sun: 1 }): DayLevels {
  const p = normalizeDayPhase(phase) ?? 0.5;
  const elev = -Math.cos(p * Math.PI * 2);
  const night = 1 - smooth01((elev + 0.5) / 0.6);
  const d = (elev + 0.13) / 0.3;
  const twilight = smooth01(1 - d * d);
  out.night = night < 1e-4 ? 0 : night;
  out.twilight = twilight < 1e-4 ? 0 : twilight;
  out.dusk = p > 0.5;
  out.sun = clamp01(1 - out.night - 0.6 * out.twilight);
  return out;
}

/** Ist der Tagesanteil neutral (heller Tag – nichts zu zeichnen)? */
export function isBrightDay(levels: DayLevels): boolean {
  return levels.night <= 0 && levels.twilight <= 0;
}

/** Nachtlicht (multiply): gedämpft und bläulich. */
const NIGHT_LIGHT = [92, 108, 156] as const;
/** Warmes Dämmerungslicht (multiply): morgens rosig, abends orange. */
const DAWN_LIGHT = [255, 214, 196] as const;
const DUSK_LIGHT = [255, 196, 150] as const;
/** Stärke der Tönung bei voller Nacht bzw. Dämmerung. */
const NIGHT_STRENGTH = 0.8;
const WARM_STRENGTH = 0.55;

/**
 * Tönungsstufe zu den Stärken: Nacht und Dämmerung auf 1 / TINT_STEPS gerundet (in
 * `out`), dazu ein Schlüssel – gleiche Stufe, gleicher Schlüssel; −1 = keine Tönung.
 */
export function tintLevels(lv: DayLevels, out: DayLevels = { night: 0, twilight: 0, dusk: false, sun: 1 }): number {
  const n = Math.round(clamp01(lv.night) * TINT_STEPS);
  const t = Math.round(clamp01(lv.twilight) * TINT_STEPS);
  out.night = n / TINT_STEPS;
  out.twilight = t / TINT_STEPS;
  out.dusk = lv.dusk;
  out.sun = clamp01(1 - out.night - 0.6 * out.twilight);
  if (n === 0 && t === 0) return -1;
  return (n * (TINT_STEPS + 1) + t) * 2 + (lv.dusk ? 1 : 0);
}

/** Lichtfarbe (multiply) als [r, g, b] 0–255; [255, 255, 255] = keine Wirkung. */
export function tintRgb(levels: DayLevels, out: number[] = [255, 255, 255]): number[] {
  const warm = levels.dusk ? DUSK_LIGHT : DAWN_LIGHT;
  for (let i = 0; i < 3; i++) {
    const n = 1 - (1 - NIGHT_LIGHT[i]! / 255) * levels.night * NIGHT_STRENGTH;
    const w = 1 - (1 - warm[i]! / 255) * levels.twilight * WARM_STRENGTH;
    out[i] = Math.round(255 * n * w);
  }
  return out;
}

/**
 * Himmel der Tönungsstufe in eine Ebene (Kontext in CSS-Pixeln der Szene): Nacht tiefblau,
 * zum Horizont heller und durchscheinend (Hügel bleiben sichtbar); Dämmerung mit warmem
 * Horizont und einem Schein, wo die Sonne steht (morgens links, abends rechts).
 */
export function paintDaySky(c: CanvasRenderingContext2D, lv: DayLevels, w: number, h: number): void {
  if (lv.night > 0) {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(24, 38, 74, 1)');
    g.addColorStop(0.5, 'rgba(38, 56, 100, 1)');
    g.addColorStop(0.78, 'rgba(66, 84, 126, 0.86)');
    g.addColorStop(1, 'rgba(92, 106, 140, 0.62)');
    c.globalAlpha = lv.night;
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  if (lv.twilight > 0) {
    const warm = lv.dusk ? '245, 150, 84' : '247, 182, 150';
    const rose = lv.dusk ? '214, 118, 138' : '226, 160, 184';
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(${rose}, 0)`);
    g.addColorStop(0.35, `rgba(${rose}, 0.12)`);
    g.addColorStop(0.65, `rgba(${rose}, 0.42)`);
    g.addColorStop(0.88, `rgba(${warm}, 0.82)`);
    g.addColorStop(1, `rgba(${warm}, 0.9)`);
    c.globalAlpha = lv.twilight;
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    const sx = lv.dusk ? w * 0.86 : w * 0.14;
    const sy = h * 0.9;
    const r = Math.max(w, h) * 0.6;
    const sun = c.createRadialGradient(sx, sy, 0, sx, sy, r);
    sun.addColorStop(0, 'rgba(255, 226, 168, 0.95)');
    sun.addColorStop(0.3, 'rgba(255, 210, 156, 0.4)');
    sun.addColorStop(1, 'rgba(255, 206, 150, 0)');
    c.fillStyle = sun;
    c.fillRect(0, 0, w, h);
  }
  c.globalAlpha = 1;
}

/**
 * Getönte Kopie des Bereichs `r` (Pixel) von `src` in `dst` (so groß wie `r`, wird angelegt
 * bzw. angepasst): Kopie, Lichtfarbe „multiply“, dann wieder auf die Form der Vorlage
 * zugeschnitten (durchsichtige Stellen bleiben durchsichtig).
 */
export function tintCopy(src: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }, dst: HTMLCanvasElement | null, fill: string): HTMLCanvasElement {
  const canvas = dst ?? document.createElement('canvas');
  if (canvas.width !== r.w || canvas.height !== r.h) {
    canvas.width = r.w;
    canvas.height = r.h;
  }
  const c = canvas.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'copy';
  c.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = fill;
  c.fillRect(0, 0, r.w, r.h);
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  c.globalCompositeOperation = 'source-over';
  return canvas;
}

/** Tönt ein Canvas an Ort und Stelle (z. B. den alten Wald beim Zyklus-Übergang). */
export function tintInPlace(canvas: HTMLCanvasElement, fill: string): void {
  if (canvas.width <= 0 || canvas.height <= 0) return;
  const copy = tintCopy(canvas, { x: 0, y: 0, w: canvas.width, h: canvas.height }, null, fill);
  const c = canvas.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'copy';
  c.drawImage(copy, 0, 0);
  c.globalCompositeOperation = 'source-over';
  copy.width = 0;
  copy.height = 0;
}

/** Maße und Abbildung eines Frames (wie MoodFrame) für Sterne und Mond. */
export interface DayFrame {
  width: number;
  height: number;
  groundY: number;
  /** Pixel je CSS-Pixel der Ebenen und Abbildung auf das Canvas (Kamera). */
  dpr: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  /** Pixeldichte des Canvas ohne Zoom (Sterne bleiben beim Zoomen fast gleich groß). */
  baseDpr: number;
  time: number;
  reducedMotion: boolean;
}

interface Star {
  /** Lage als Anteil (x der Breite, y der Himmelshöhe bis zur Bodenlinie). */
  u: number;
  v: number;
  /** Größe in CSS-Pixeln, Helligkeit 0–1, Funkeln (Phase, Tempo). */
  size: number;
  bright: number;
  phase: number;
  speed: number;
}

/** Sterne per Seed: oben dichter, kleine und wenige große; nicht hinter dem Mond. */
function makeStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; stars.length < count && i < count * 3; i++) {
    const h = hash2(4049, i);
    const r = (k: number) => (hash2(h, k) & 0xffff) / 0x10000;
    const u = r(1);
    const v = 0.02 + 0.62 * r(2) ** 1.4;
    // Platz um den Mond freihalten (Mond bei etwa 0,12–0,42 × Breite, 0,1–0,2 × Höhe).
    if (u > 0.08 && u < 0.46 && v > 0.04 && v < 0.27) continue;
    const big = r(3) > 0.88;
    stars.push({ u, v, size: big ? 1.8 + r(4) * 0.8 : 0.8 + r(4) * 0.8, bright: 0.45 + r(5) * 0.55, phase: r(6) * 100, speed: 0.4 + r(7) * 0.9 });
  }
  return stars;
}

/** Tag-und-Nacht-Zustand einer Szene: Überblendung, Tönungsstufe, Sterne und Mond. */
export class DayLayer {
  /** Gezeigter Tagesanteil (NaN = keine Angabe). */
  phase = Number.NaN;
  private lastTime = Number.NaN;
  /** Gleitet gerade nach einem Sprung? */
  private fading = false;
  /** Stärken dieses Frames (gültig, wenn `update` nicht null liefert). */
  readonly levels: DayLevels = { night: 0, twilight: 0, dusk: false, sun: 1 };
  /** Tönungsstufe dieses Frames (gerundete Stärken) und ihr Schlüssel (−1 = keine). */
  readonly tint: DayLevels = { night: 0, twilight: 0, dusk: false, sun: 1 };
  tintKey = -1;
  /** Lichtfarbe der Tönungsstufe (CSS-Farbe), neu nur bei neuer Stufe. */
  tintFill = '';
  /** Lichtfarbe der Wolken: doppelt so stark (sie sollen nachts nicht leuchten). */
  cloudFill = '';
  private fillKey = -2;
  /** Stufe des Tagesanteils dieses Frames (für weniger Bewegung). */
  bucket = -1;
  private stars: Star[] = [];
  private starKey = '';
  private dots = new Map<number, HTMLCanvasElement>();
  private moon: HTMLCanvasElement | null = null;
  private moonPx = 0;
  private stepLevels: DayLevels = { night: 0, twilight: 0, dusk: false, sun: 1 };

  /**
   * Führt die Tageszeit zum Ziel; gibt die Stärken dieses Frames zurück oder null, wenn
   * nichts zu zeichnen ist (ohne Angabe oder heller Tag). Setzt `tint`, `tintKey`, `tintFill`.
   */
  update(target: number | undefined, time: number, reducedMotion: boolean): DayLevels | null {
    const goal = normalizeDayPhase(target);
    if (goal === null) {
      this.phase = Number.NaN;
      this.lastTime = Number.NaN;
      this.fading = false;
      this.tintKey = -1;
      return null;
    }
    if (Number.isNaN(this.phase) || reducedMotion) {
      this.phase = goal;
      this.fading = false;
    } else {
      // Kürzester Weg auf dem Kreis; normales Fortschreiten folgt direkt, Sprünge gleiten.
      let d = goal - this.phase;
      if (d > 0.5) d -= 1;
      else if (d < -0.5) d += 1;
      const dt = time - this.lastTime;
      const step = Number.isFinite(dt) && dt > 0 && dt < 0.5 ? dt * DAY_FADE_RATE : DAY_FADE_RATE / 60;
      // Kleine Schritte (normaler Lauf der Zeit) folgen direkt – außer mitten im Gleiten.
      if (Math.abs(d) > JUMP) this.fading = true;
      if (Math.abs(d) <= step || (!this.fading && Math.abs(d) <= JUMP)) {
        this.phase = goal;
        this.fading = false;
      } else {
        this.phase = normalizeDayPhase(this.phase + Math.sign(d) * step) ?? goal;
      }
    }
    this.lastTime = time;
    const bucket = dayBucket(this.phase);
    this.bucket = bucket;
    // Weniger Bewegung: nur die Stufe (Wechsel in kleinen Schritten); sonst stufenlos.
    const lv = dayLevels(reducedMotion ? bucketPhase(bucket) : this.phase, this.levels);
    this.tintKey = tintLevels(lv, this.tint);
    if (this.tintKey !== this.fillKey) {
      const rgb = tintRgb(this.tint);
      this.tintFill = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      const sq = rgb.map((v) => Math.round((v * v) / 255));
      this.cloudFill = `rgb(${sq[0]}, ${sq[1]}, ${sq[2]})`;
      this.fillKey = this.tintKey;
    }
    return isBrightDay(lv) ? null : lv;
  }

  /** Stärken der Stufe `bucket` (für Tests). */
  bucketLevels(bucket: number): DayLevels {
    return dayLevels(bucketPhase(bucket), this.stepLevels);
  }

  /**
   * Sterne und Mond – direkt nach der Kulisse (hinter Wolken und Bäumen). `clear` 0–1:
   * klarer Himmel (1) bis ganz bedeckt (0, Wetter: Wolkendecke, Nebel, Schneefall).
   */
  drawLights(ctx: CanvasRenderingContext2D, lv: DayLevels, f: DayFrame, clear = 1): void {
    const sky = Number.isFinite(clear) ? clamp01(clear) : 1;
    const starAlpha = lv.night * lv.night * sky;
    if (starAlpha > 0.01) this.drawStars(ctx, starAlpha, f);
    if (lv.night * sky > 0.01) this.drawMoon(ctx, lv.night * sky, f);
    ctx.globalAlpha = 1;
  }

  /** Sterne als kleine Sprites (scharf auch beim Zoom); leises Funkeln, bei weniger Bewegung ruhig. */
  private drawStars(ctx: CanvasRenderingContext2D, alpha: number, f: DayFrame): void {
    const key = `${Math.round(f.width)}x${Math.round(f.groundY)}`;
    if (this.starKey !== key) {
      // Anzahl nach Himmelsfläche: schmal ~30, breit bis 90.
      this.stars = makeStars(Math.round(Math.max(28, Math.min(90, (f.width * f.groundY) / 6000))));
      this.starKey = key;
    }
    const k = f.sx * f.dpr;
    const ky = f.sy * f.dpr;
    // Sterne wachsen beim Zoomen nur wenig mit (wie ferne Lichter).
    const zoom = Math.max(1, k / f.baseDpr);
    const grow = f.baseDpr * (1 + 0.3 * (zoom - 1));
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const t = f.reducedMotion ? 0 : f.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const s of this.stars) {
      const x = k * s.u * f.width + f.tx;
      const y = ky * s.v * f.groundY + f.ty;
      const px = Math.max(2, Math.round(s.size * 3 * grow));
      if (x < -px || y < -px || x > cw + px || y > ch + px) continue;
      const twinkle = f.reducedMotion ? 0.85 : 0.7 + 0.3 * Math.sin(t * s.speed + s.phase);
      ctx.globalAlpha = alpha * s.bright * twinkle;
      ctx.drawImage(this.dot(px), x - px / 2, y - px / 2);
    }
  }

  /** Stern-Sprite: heller Kern mit weichem Schein (je Pixelgröße gecacht). */
  private dot(px: number): HTMLCanvasElement {
    let s = this.dots.get(px);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = px;
    s.height = px;
    const c = s.getContext('2d')!;
    const r = px / 2;
    const g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(255, 252, 236, 1)');
    g.addColorStop(0.28, 'rgba(244, 240, 220, 0.85)');
    g.addColorStop(0.5, 'rgba(220, 226, 250, 0.22)');
    g.addColorStop(1, 'rgba(220, 226, 250, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, px, px);
    if (this.dots.size > 32) this.dots.clear();
    this.dots.set(px, s);
    return s;
  }

  /**
   * Mond oben links mit hellem Hof; wandert in der Nacht langsam ein Stück nach rechts
   * (bei weniger Bewegung in Stufen). Größe wie die Szene (zoomt mit).
   */
  private drawMoon(ctx: CanvasRenderingContext2D, alpha: number, f: DayFrame): void {
    const r = Math.max(7, Math.min(22, Math.min(f.width, f.groundY) * 0.035));
    // Fortschritt der Nacht: 0 am Abend (0,75), 1 am Morgen (0,25).
    const p = Number.isNaN(this.phase) ? 0 : (f.reducedMotion ? bucketPhase(this.bucket) : this.phase);
    const u = clamp01((((p + 0.25) % 1) + 1) % 1 / 0.5);
    const x = f.width * (0.16 + 0.18 * u);
    const y = f.groundY * (0.17 - 0.05 * Math.sin(u * Math.PI));
    const scale = f.sx * f.dpr;
    const px = Math.max(8, Math.round(r * 6 * scale));
    if (!this.moon || this.moonPx !== px) this.moon = this.paintMoon(this.moon, px);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.moon, Math.round(scale * x + f.tx - px / 2), Math.round(f.sy * f.dpr * y + f.ty - px / 2));
  }

  /** Mond-Sprite: Hof, blasse Scheibe mit zwei Flecken (Radius = px / 6). */
  private paintMoon(old: HTMLCanvasElement | null, px: number): HTMLCanvasElement {
    const s = old ?? document.createElement('canvas');
    s.width = px;
    s.height = px;
    this.moonPx = px;
    const c = s.getContext('2d')!;
    const m = px / 2;
    const r = px / 6;
    const halo = c.createRadialGradient(m, m, r * 0.8, m, m, m);
    halo.addColorStop(0, 'rgba(236, 238, 220, 0.4)');
    halo.addColorStop(0.4, 'rgba(210, 220, 240, 0.12)');
    halo.addColorStop(1, 'rgba(210, 220, 240, 0)');
    c.fillStyle = halo;
    c.fillRect(0, 0, px, px);
    c.fillStyle = '#f4f0dc';
    c.beginPath();
    c.arc(m, m, r, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(196, 192, 170, 0.55)';
    c.beginPath();
    c.arc(m - r * 0.3, m - r * 0.2, r * 0.26, 0, Math.PI * 2);
    c.arc(m + r * 0.32, m + r * 0.28, r * 0.18, 0, Math.PI * 2);
    c.fill();
    return s;
  }
}
