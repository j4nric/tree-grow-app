/**
 * Übergang zum Neuen Zyklus (DESIGN_V2.md §10): „Aus einer Eichel der alten Eiche
 * wächst ein neuer Baum.“ Ruhig und ohne Feuer-Drama:
 *
 *   0,0–2,4 s  das alte Bild blendet aus, die alte Eiche (samt Pflanzen) bleibt als
 *              dunkle Silhouette stehen
 *   0,6–3,6 s  ein sanftes, langsam atmendes Leuchten in der Krone
 *   1,8–3,9 s  eine Eichel fällt, schaukelt leicht und versinkt im Boden
 *   3,3–5,5 s  der neue Samen in der Erde leuchtet kurz auf; die Silhouette ist fort
 *
 * Danach wird nichts mehr zusätzlich gezeichnet – das Bild ist dann pixelgleich zur
 * normalen Szene. Bei `reducedMotion` nur eine kurze Überblendung (0,8 s).
 *
 * Lichtempfindlichkeit: keine Blitze, keine schnellen Helligkeitswechsel. Alle
 * Änderungen laufen über mindestens eine Sekunde; das Leuchten „atmet“ mit 0,33 Hz
 * und ±15 %.
 *
 * Kosten: beim Start einmal das letzte Bild und eine Silhouette der Baum-Ebenen
 * kopieren; pro Frame nur `drawImage` gecachter Canvases mit wechselnder Deckkraft.
 * Nach dem Ende werden die Kopien freigegeben.
 */

import { clamp01, smooth01 } from './util';

/** Dauer der Sequenz in Sekunden (normal / weniger Bewegung). */
export const CYCLE_TRANSITION_SECONDS = 5.5;
export const CYCLE_TRANSITION_REDUCED_SECONDS = 0.8;

/** Deckkraft der einzelnen Teile zum Zeitpunkt `u` (Sekunden seit Start). */
export interface CyclePhase {
  /** Altes Bild (Farbe). */
  frame: number;
  /** Silhouette der alten Bäume und Pflanzen. */
  silhouette: number;
  /** Leuchten in der Krone. */
  glow: number;
  /** Fall der Eichel 0–1 (−1 = nicht sichtbar). */
  acorn: number;
  /** Deckkraft der Eichel (beim Versinken). */
  acornAlpha: number;
  /** Leuchten des neuen Samens in der Erde. */
  seedGlow: number;
  /** Ist die Sequenz vorbei? */
  done: boolean;
}

export function cyclePhase(u: number, reducedMotion: boolean): CyclePhase {
  if (!Number.isFinite(u) || u < 0) u = 0;
  if (reducedMotion) {
    return {
      frame: 1 - smooth01(u / CYCLE_TRANSITION_REDUCED_SECONDS),
      silhouette: 0,
      glow: 0,
      acorn: -1,
      acornAlpha: 0,
      seedGlow: 0,
      done: u >= CYCLE_TRANSITION_REDUCED_SECONDS,
    };
  }
  const fall = (u - 1.8) / 1.6;
  const sink = clamp01((u - 3.4) / 0.5);
  const breathe = 0.85 + 0.15 * Math.sin(u * 2.1);
  return {
    frame: 1 - smooth01((u - 0.4) / 2.0),
    silhouette: 0.62 * smooth01((u - 0.2) / 1.0) * (1 - smooth01((u - 2.8) / 1.8)),
    glow: 0.6 * smooth01((u - 0.6) / 1.0) * (1 - smooth01((u - 2.6) / 1.0)) * breathe,
    acorn: fall < 0 || sink >= 1 ? -1 : Math.min(1, fall),
    acornAlpha: smooth01(fall / 0.15) * (1 - sink),
    seedGlow: 0.55 * smooth01((u - 3.3) / 0.5) * (1 - smooth01((u - 4.3) / 1.2)),
    done: u >= CYCLE_TRANSITION_SECONDS,
  };
}

export interface CycleGeometry {
  width: number;
  height: number;
  groundY: number;
  /** Mitte (x) und Samen in der Erde (y) der neuen Eiche. */
  cx: number;
  seedY: number;
  /** Tiergröße S (px) – Maß für Eichel und Leuchten. */
  size: number;
  dpr: number;
}

interface Point {
  x: number;
  y: number;
}

/** Zustand einer laufenden (oder beendeten) Sequenz je Canvas. */
export class CycleTransition {
  startedAt = Number.NaN;
  /** Kopie des letzten Bilds vor dem Wechsel (oder null). */
  private frame: HTMLCanvasElement | null = null;
  /** Silhouette der alten Baum- und Pflanzen-Ebenen. */
  private silhouette: HTMLCanvasElement | null = null;
  /** Belegter Bereich der Silhouette (Gerätepixel) – nur er wird gezeichnet. */
  private silRect = { x: 0, y: 0, w: 0, h: 0 };
  private glow: HTMLCanvasElement | null = null;
  private acorn: HTMLCanvasElement | null = null;
  private crown: Point = { x: 0, y: 0 };
  private drop: Point = { x: 0, y: 0 };
  private glowR = 1;
  /** Wie oft eine Sequenz begonnen wurde (für Tests). */
  starts = 0;

  /** Läuft gerade eine Sequenz (bzw. liegen noch Kopien vor)? */
  get active(): boolean {
    return this.frame !== null || this.silhouette !== null || this.acorn !== null;
  }

  /**
   * Startet eine Sequenz. `previous`: das Canvas mit dem letzten Bild (oder null),
   * `layers`: die alten Baum-Ebenen mit belegtem Bereich (Gerätepixel), `treeBox`:
   * Umriss des alten Hauptbaums in CSS-Pixeln (oder null, z. B. im Keimling).
   */
  begin(
    startedAt: number,
    geo: CycleGeometry,
    previous: HTMLCanvasElement | null,
    layers: readonly { canvas: HTMLCanvasElement; rect: { x: number; y: number; w: number; h: number } | null }[],
    treeBox: { x0: number; y0: number; x1: number; y1: number } | null,
  ): void {
    this.release();
    this.startedAt = startedAt;
    this.starts++;
    const pw = Math.max(1, Math.round(geo.width * geo.dpr));
    const ph = Math.max(1, Math.round(geo.height * geo.dpr));
    if (previous && previous.width > 0 && previous.height > 0) {
      this.frame = canvasOf(previous.width, previous.height);
      this.frame.getContext('2d')!.drawImage(previous, 0, 0);
    }
    if (layers.some((l) => l.rect)) {
      const sil = canvasOf(pw, ph);
      const c = sil.getContext('2d')!;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const { canvas, rect } of layers) {
        if (!rect) continue;
        c.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
        x0 = Math.min(x0, rect.x);
        y0 = Math.min(y0, rect.y);
        x1 = Math.max(x1, rect.x + rect.w);
        y1 = Math.max(y1, rect.y + rect.h);
      }
      this.silRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      // Nur die Form behalten: dunkles, leicht grünliches Schiefergrau.
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = 'rgb(66, 80, 72)';
      c.fillRect(0, 0, pw, ph);
      c.globalCompositeOperation = 'source-over';
      this.silhouette = sil;
    }
    const S = geo.size;
    if (treeBox) {
      const h = treeBox.y1 - treeBox.y0;
      this.crown = { x: (treeBox.x0 + treeBox.x1) / 2, y: treeBox.y0 + h * 0.32 };
      this.drop = { x: this.crown.x + S * 0.6, y: treeBox.y0 + h * 0.5 };
      this.glowR = Math.max(S * 2, Math.min(treeBox.x1 - treeBox.x0, h) * 0.45);
    } else {
      this.crown = { x: geo.cx, y: geo.groundY - (geo.groundY * 0.3) };
      this.drop = { x: geo.cx + S * 0.4, y: this.crown.y + S };
      this.glowR = S * 2.5;
    }
    this.glow = makeGlow(geo.dpr);
    this.acorn = makeAcorn(S * 0.7, geo.dpr);
  }

  /** Beendet die Sequenz und gibt die Kopien frei. */
  release(): void {
    this.frame = null;
    this.silhouette = null;
    this.glow = null;
    this.acorn = null;
  }

  /** Vergisst die Sequenz ganz (Feld nicht mehr gesetzt). */
  reset(): void {
    this.release();
    this.startedAt = Number.NaN;
  }

  /**
   * Zeichnet den Übergang über die fertige Szene. `sx`/`sy`: zusätzliche Skalierung
   * (Größenänderung). Gibt false zurück, wenn nichts mehr zu zeichnen ist.
   */
  draw(ctx: CanvasRenderingContext2D, u: number, reducedMotion: boolean, geo: CycleGeometry, sx: number, sy: number): boolean {
    const ph = cyclePhase(u, reducedMotion);
    if (ph.done) {
      this.release();
      return false;
    }
    const pw = Math.round(geo.width * geo.dpr);
    const phh = Math.round(geo.height * geo.dpr);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    if (this.silhouette && ph.silhouette > 0.003) {
      ctx.globalAlpha = ph.silhouette;
      const r = this.silRect;
      if (this.silhouette.width === pw && this.silhouette.height === phh) {
        ctx.drawImage(this.silhouette, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      } else {
        ctx.drawImage(this.silhouette, 0, 0, pw, phh);
      }
    }
    if (this.frame && ph.frame > 0.003) {
      ctx.globalAlpha = ph.frame;
      ctx.drawImage(this.frame, 0, 0, pw, phh);
    }
    const k = geo.dpr;
    ctx.setTransform(sx * k, 0, 0, sy * k, 0, 0);
    if (this.glow && ph.glow > 0.003) {
      ctx.globalAlpha = ph.glow;
      const r = this.glowR;
      ctx.drawImage(this.glow, this.crown.x - r, this.crown.y - r, r * 2, r * 2);
    }
    if (this.acorn && ph.acorn >= 0 && ph.acornAlpha > 0.003) {
      const p = ph.acorn;
      // Sanft beschleunigt fallen, dabei leicht hin und her schaukeln.
      const e = p * p * (1.6 - 0.6 * p);
      const x = this.drop.x + (geo.cx - this.drop.x) * smooth01(p) + Math.sin(p * Math.PI * 2) * geo.size * 0.35 * (1 - p);
      const sinkDepth = u > 3.4 ? clamp01((u - 3.4) / 0.5) * geo.size * 0.25 : 0;
      const y = this.drop.y + (geo.groundY - this.drop.y) * e + sinkDepth;
      const rot = Math.sin(p * Math.PI * 3) * 0.35 * (1 - p);
      const s = geo.size * 0.7;
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      ctx.globalAlpha = ph.acornAlpha;
      ctx.setTransform(sx * k * c, sy * k * sn, -sx * k * sn, sy * k * c, sx * k * x, sy * k * y);
      ctx.drawImage(this.acorn, -s * 0.5, -s, s, s * 1.25);
      ctx.setTransform(sx * k, 0, 0, sy * k, 0, 0);
    }
    if (this.glow && ph.seedGlow > 0.003) {
      ctx.globalAlpha = ph.seedGlow;
      const r = geo.size * 1.4;
      ctx.drawImage(this.glow, geo.cx - r, geo.seedY - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    return true;
  }
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Warmes, weiches Leuchten (64 px Grundgröße, wird skaliert gezeichnet). */
function makeGlow(dpr: number): HTMLCanvasElement {
  const px = Math.max(16, Math.round(64 * Math.min(2, dpr)));
  const c = canvasOf(px, px);
  const g = c.getContext('2d')!;
  const r = px / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255, 246, 214, 0.9)');
  grad.addColorStop(0.35, 'rgba(255, 232, 170, 0.45)');
  grad.addColorStop(1, 'rgba(255, 226, 160, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, px, px);
  return c;
}

/** Eichel mit Hütchen, Spitze nach unten; Ursprung unten Mitte (beim Zeichnen versetzt). */
function makeAcorn(size: number, dpr: number): HTMLCanvasElement {
  const w = Math.max(4, Math.round(size * dpr));
  const h = Math.max(5, Math.round(size * 1.25 * dpr));
  const c = canvasOf(w, h);
  const g = c.getContext('2d')!;
  g.scale(w, h / 1.25);
  // Nuss
  g.fillStyle = '#9a6a35';
  g.beginPath();
  g.ellipse(0.5, 0.72, 0.3, 0.42, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c08a4c';
  g.beginPath();
  g.ellipse(0.42, 0.66, 0.1, 0.22, -0.2, 0, Math.PI * 2);
  g.fill();
  // Hütchen mit Schuppen und Stiel
  g.fillStyle = '#6e5232';
  g.beginPath();
  g.ellipse(0.5, 0.36, 0.36, 0.2, 0, Math.PI, 0);
  g.lineTo(0.86, 0.42);
  g.lineTo(0.14, 0.42);
  g.closePath();
  g.fill();
  g.fillStyle = '#856540';
  for (const x of [0.28, 0.44, 0.6, 0.74]) {
    g.beginPath();
    g.arc(x, 0.36, 0.05, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#5a4128';
  g.lineWidth = 0.07;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0.5, 0.18);
  g.lineTo(0.56, 0.04);
  g.stroke();
  return c;
}
