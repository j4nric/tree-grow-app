/**
 * Lichtschein am Samen zu Spielbeginn: Der Samen liegt klein in der Erde – ein warmer,
 * sanft pulsierender Schein zeigt, wo das Leben beginnt. Er verblasst, während der
 * Keimling bis zum ersten Wegpunkt (Wachstum 1, Stufe „Keimling“) aus der Erde wächst.
 * Bei reduzierter Bewegung steht der Schein still.
 *
 * Pro Frame höchstens ein drawImage eines gecachten Sprites – und nur in der Stufe
 * „Samen“ (Wachstum < 1); danach kostet er nichts.
 */

import { clamp01, smooth01 } from './util';

/** Stärke des Scheins 0–1 aus dem Wachstum: voll bis 0,55, weg ab 1 (erster Wegpunkt). */
export function seedGlowStrength(growth: number): number {
  if (!Number.isFinite(growth) || growth >= 1) return 0;
  return 1 - smooth01((Math.max(0, growth) - 0.55) / 0.45);
}

/** Puls 0–1 (ruhig, etwa alle 2,6 s); bei reduzierter Bewegung fest. */
export function seedGlowPulse(time: number, reducedMotion: boolean): number {
  if (reducedMotion || !Number.isFinite(time)) return 0.7;
  const s = Math.sin(time * 2.4);
  return 0.55 + 0.45 * s * s;
}

/** Deckkraft des Scheins in diesem Frame (0 = nicht zeichnen). */
export function seedGlowAlpha(growth: number, time: number, reducedMotion: boolean): number {
  const k = seedGlowStrength(growth);
  return k <= 0 ? 0 : clamp01(k * seedGlowPulse(time, reducedMotion));
}

/** Schein-Sprite, einmal je Größe (Gerätepixel) angelegt. */
export class SeedGlow {
  private sprite: HTMLCanvasElement | null = null;
  private key = -1;

  /**
   * Zeichnet den Schein um (x, y) [CSS-px] mit Radius `r`. `sx`, `sy`: zusätzliche
   * Skalierung (altes Bild während einer Größenänderung).
   */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, dpr: number, sx: number, sy: number): void {
    if (alpha <= 0.01 || r <= 0) return;
    const px = Math.max(8, Math.ceil(r * 2 * dpr));
    if (!this.sprite || this.key !== px) {
      this.sprite = paintGlow(this.sprite, px);
      this.key = px;
    }
    ctx.globalAlpha = alpha;
    ctx.setTransform(sx * dpr, 0, 0, sy * dpr, 0, 0);
    ctx.drawImage(this.sprite, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }
}

function paintGlow(old: HTMLCanvasElement | null, px: number): HTMLCanvasElement {
  const c = old ?? document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, px, px);
  const h = px / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  // Mitte nur leicht, damit der Samen darunter erkennbar bleibt.
  grad.addColorStop(0, 'rgba(255, 236, 175, 0.4)');
  grad.addColorStop(0.22, 'rgba(255, 226, 150, 0.5)');
  grad.addColorStop(0.5, 'rgba(250, 205, 120, 0.2)');
  grad.addColorStop(1, 'rgba(245, 190, 100, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, px, px);
  return c;
}
