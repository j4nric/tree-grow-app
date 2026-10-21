/**
 * Übergang zum Neuen Zyklus (DESIGN_V2.md §10): „Aus einer Eichel der alten Eiche
 * wächst ein neuer Baum.“ Ruhig und ohne Feuer-Drama:
 *
 *   0,0–2,4 s  die alte Eiche (samt Nachbarbäumen und Pflanzen) verblasst zur Silhouette
 *   0,6–3,6 s  ein sanftes, langsam atmendes Leuchten in der Krone
 *   1,8–3,9 s  eine Eichel fällt, schaukelt leicht und versinkt im Boden
 *   3,3–5,5 s  der neue Samen in der Erde leuchtet kurz auf; die Silhouette ist fort
 *
 * Der alte Wald wird einmal aus `fromGrowth` (und den alten Pflanzen) gezeichnet –
 * unabhängig davon, was vorher auf dem Canvas stand. Das Bild hängt damit nur von der
 * Eingabe ab: Reihenfolge der Frames, Größenänderungen und Neuladen mitten in der
 * Sequenz ändern nichts. Danach (und außerhalb des Zeitfensters) wird nichts mehr
 * zusätzlich gezeichnet – pixelgleich zur Szene ohne das Feld.
 *
 * Lichtempfindlichkeit: keine Blitze, kein Flackern. Leuchten und Überblendungen
 * steigen und fallen in Rampen von mindestens 0,5 s (meist 1–2 s); das Leuchten
 * „atmet“ mit 0,33 Hz und ±15 %. Nur die kleine, dunkle Eichel blendet in 0,25 s ein.
 */

import type { TreeSpecies } from './plant';
import { paintFruit } from './species';
import { clamp01, smooth01 } from './util';

/** Dauer der Sequenz in Sekunden (normal / weniger Bewegung). */
export const CYCLE_TRANSITION_SECONDS = 5.5;
export const CYCLE_TRANSITION_REDUCED_SECONDS = 0.8;
/** So weit (s) darf der Start in der Zukunft liegen – er gilt dann als „jetzt“. Weiter: verworfen. */
export const CYCLE_TRANSITION_LEAD = 1;

/**
 * Zeitpunkt in der Sequenz (s) oder NaN, wenn außerhalb des Zeitfensters (zu früh, zu
 * spät, ungültig). Ein Start bis zu 1 s in der Zukunft gilt als „startet jetzt“.
 */
export function cycleElapsed(time: number, startedAt: number, reducedMotion: boolean): number {
  if (!Number.isFinite(time) || !Number.isFinite(startedAt)) return Number.NaN;
  const d = time - startedAt;
  const length = reducedMotion ? CYCLE_TRANSITION_REDUCED_SECONDS : CYCLE_TRANSITION_SECONDS;
  if (d < -CYCLE_TRANSITION_LEAD || d >= length) return Number.NaN;
  return Math.max(0, d);
}

/** Deckkraft der einzelnen Teile zum Zeitpunkt `u` (Sekunden seit Start). */
export interface CyclePhase {
  /** Alter Wald in Farbe. */
  frame: number;
  /** Silhouette des alten Walds. */
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

/** Der alte Wald, einmal gezeichnet: Canvas in Gerätepixeln für den Bereich `rect` (CSS-Pixel). */
export interface OldForest {
  canvas: HTMLCanvasElement;
  rect: { x: number; y: number; w: number; h: number };
  /** Umriss des alten Hauptbaums (CSS-Pixel) oder null (Keimling). */
  tree: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** Zustand der Sequenz je Canvas: die einmal gezeichneten Teile und wofür sie gelten. */
export class CycleTransition {
  /** Schlüssel der vorbereiteten Teile (Start, Wachstum, Pflanzen, Größe) oder ''. */
  key = '';
  private colour: HTMLCanvasElement | null = null;
  private silhouette: HTMLCanvasElement | null = null;
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private glow: HTMLCanvasElement | null = null;
  private acorn: HTMLCanvasElement | null = null;
  private crown = { x: 0, y: 0 };
  private drop = { x: 0, y: 0 };
  private glowR = 1;

  /** Liegen vorbereitete Teile vor? */
  get prepared(): boolean {
    return this.glow !== null;
  }

  /** Bereitet die Sequenz vor: Farbe und Silhouette des alten Walds, Leuchten, Eichel. */
  /** `species`: Art des neuen Baums – ihre Frucht fällt (Eichel, Buchecker, Zapfen). */
  prepare(key: string, geo: CycleGeometry, forest: OldForest | null, species: TreeSpecies = 'oak'): void {
    this.release();
    this.key = key;
    const S = geo.size;
    if (forest) {
      this.colour = forest.canvas;
      this.rect = forest.rect;
      const sil = document.createElement('canvas');
      sil.width = forest.canvas.width;
      sil.height = forest.canvas.height;
      const c = sil.getContext('2d')!;
      c.drawImage(forest.canvas, 0, 0);
      // Nur die Form behalten: dunkles, leicht grünliches Schiefergrau.
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = 'rgb(66, 80, 72)';
      c.fillRect(0, 0, sil.width, sil.height);
      c.globalCompositeOperation = 'source-over';
      this.silhouette = sil;
    }
    const box = forest?.tree;
    if (box) {
      const h = box.y1 - box.y0;
      this.crown = { x: (box.x0 + box.x1) / 2, y: box.y0 + h * 0.32 };
      this.drop = { x: this.crown.x + S * 0.6, y: box.y0 + h * 0.5 };
      this.glowR = Math.max(S * 2, Math.min(box.x1 - box.x0, h) * 0.45);
    } else {
      this.crown = { x: geo.cx, y: geo.groundY * 0.7 };
      this.drop = { x: geo.cx + S * 0.4, y: this.crown.y + S };
      this.glowR = S * 2.5;
    }
    this.glow = makeGlow(geo.dpr);
    this.acorn = makeAcorn(S * 0.7, geo.dpr, species);
  }

  /** Gibt die Kopien frei (Safari: Größe vorher auf 0 setzen). */
  release(): void {
    for (const c of [this.colour, this.silhouette, this.glow, this.acorn]) {
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    }
    this.colour = null;
    this.silhouette = null;
    this.glow = null;
    this.acorn = null;
    this.key = '';
  }

  /** Zeichnet die Sequenz zum Zeitpunkt `u` über die fertige Szene. */
  draw(ctx: CanvasRenderingContext2D, u: number, reducedMotion: boolean, geo: CycleGeometry, sx: number, sy: number): void {
    const ph = cyclePhase(u, reducedMotion);
    if (ph.done) return;
    const k = geo.dpr;
    const r = this.rect;
    ctx.setTransform(sx * k, 0, 0, sy * k, 0, 0);
    if (this.silhouette && ph.silhouette > 0.003) {
      ctx.globalAlpha = ph.silhouette;
      ctx.drawImage(this.silhouette, r.x, r.y, r.w, r.h);
    }
    if (this.colour && ph.frame > 0.003) {
      ctx.globalAlpha = ph.frame;
      ctx.drawImage(this.colour, r.x, r.y, r.w, r.h);
    }
    if (this.glow && ph.glow > 0.003) {
      ctx.globalAlpha = ph.glow;
      const gr = this.glowR;
      ctx.drawImage(this.glow, this.crown.x - gr, this.crown.y - gr, gr * 2, gr * 2);
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
      const gr = geo.size * 1.4;
      ctx.drawImage(this.glow, geo.cx - gr, geo.seedY - gr, gr * 2, gr * 2);
    }
    ctx.globalAlpha = 1;
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

/** Eichel mit Hütchen; Ursprung unten Mitte (beim Zeichnen versetzt). */
function makeAcorn(size: number, dpr: number, species: TreeSpecies): HTMLCanvasElement {
  const w = Math.max(4, Math.round(size * dpr));
  const h = Math.max(5, Math.round(size * 1.25 * dpr));
  const c = canvasOf(w, h);
  const g = c.getContext('2d')!;
  g.scale(w, h / 1.25);
  paintFruit(g, species);
  return c;
}
