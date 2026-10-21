/**
 * Lichtschein am Samen zu Spielbeginn: Der Samen liegt klein in der Erde – ein warmer,
 * sanft pulsierender Schein zeigt, wo das Leben beginnt. Er verblasst, während der
 * Keimling bis zum ersten Wegpunkt (Wachstum 1, Stufe „Keimling“) aus der Erde wächst.
 * Bei reduzierter Bewegung steht der Schein still.
 *
 * Während des Übergangs zum Neuen Zyklus übernimmt zuerst das Aufleuchten aus cycle.ts;
 * der Schein bleibt bis dahin aus und blendet danach weich ein (`seedGlowCycleFade`).
 *
 * Pro Frame höchstens ein drawImage eines gecachten Sprites – und nur in der Stufe
 * „Samen“ (Wachstum < 1); danach kostet er nichts.
 */

import { CYCLE_TRANSITION_REDUCED_SECONDS } from './cycle';
import { clamp01, smooth01 } from './util';

/** Stärke des Scheins 0–1 aus dem Wachstum: voll bis 0,55, weg ab 1 (erster Wegpunkt). */
export function seedGlowStrength(growth: number): number {
  if (!Number.isFinite(growth) || growth >= 1) return 0;
  return 1 - smooth01((Math.max(0, growth) - 0.55) / 0.45);
}

/** Puls 0,7–1: ein ruhiges Atmen, etwa alle 5,2 s; bei reduzierter Bewegung fest. */
export function seedGlowPulse(time: number, reducedMotion: boolean): number {
  if (reducedMotion || !Number.isFinite(time)) return 0.85;
  return 0.85 + 0.15 * Math.sin(time * 1.2);
}

/**
 * Anteil des Scheins während des Zyklus-Übergangs (`cycleU` = Sekunden seit Start, NaN =
 * kein Übergang → 1). Bis die Eichel gelandet ist und das Aufleuchten aus cycle.ts
 * (ab 3,3 s) steht, bleibt der Schein aus; dann blendet er bis 5,1 s ein – vor dem Ende
 * der Sequenz (5,5 s), daher ohne Sprung. Bei reduzierter Bewegung mit dem Überblenden.
 */
export function seedGlowCycleFade(cycleU: number, reducedMotion: boolean): number {
  if (Number.isNaN(cycleU)) return 1;
  if (reducedMotion) return smooth01(cycleU / CYCLE_TRANSITION_REDUCED_SECONDS);
  return smooth01((cycleU - 3.6) / 1.5);
}

/** Deckkraft des Scheins in diesem Frame (0 = nicht zeichnen). */
export function seedGlowAlpha(growth: number, time: number, reducedMotion: boolean, cycleU = Number.NaN): number {
  const k = seedGlowStrength(growth) * seedGlowCycleFade(cycleU, reducedMotion);
  return k <= 0 ? 0 : clamp01(k * seedGlowPulse(time, reducedMotion));
}

/**
 * Schein-Sprites je Größe (Pixel), einmal angelegt. Mehrere Größen bleiben erhalten (z. B.
 * je Kamera-Zoomstufe), höchstens `MAX_GLOW_SPRITES`.
 */
export class SeedGlow {
  private sprites = new Map<number, HTMLCanvasElement>();

  /**
   * Zeichnet den Schein um (x, y) [CSS-px] mit Radius `r`. `dpr`: CSS-Pixel → Pixel der
   * Ebenen; `sx`, `sy`: zusätzliche Skalierung (altes Bild während einer Größenänderung,
   * Kamera), `tx`, `ty`: Verschiebung in Canvas-Pixeln (Kamera); `spriteDpr`: Auflösung
   * des Sprites (Standard `dpr`).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    alpha: number,
    dpr: number,
    sx: number,
    sy: number,
    tx = 0,
    ty = 0,
    spriteDpr = dpr,
  ): void {
    if (alpha <= 0.01 || r <= 0) return;
    const px = Math.max(8, Math.ceil(r * 2 * spriteDpr));
    let sprite = this.sprites.get(px);
    if (!sprite) {
      if (this.sprites.size >= MAX_GLOW_SPRITES) this.sprites.clear();
      sprite = paintGlow(null, px);
      this.sprites.set(px, sprite);
    }
    ctx.globalAlpha = alpha;
    ctx.setTransform(sx * dpr, 0, 0, sy * dpr, tx, ty);
    ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }
}

const MAX_GLOW_SPRITES = 4;

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
