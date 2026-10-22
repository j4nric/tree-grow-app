/**
 * Kulisse der Lebensräume im Mittelgrund (DESIGN_V2.md 23.8): rechts hinter dem Hauptbaum
 * eine helle Lichtung mit hohem Gras und Blüten (Waldwiese), links eine niedrige
 * Lesesteinmauer (Trockenmauer). Beide stehen auf einer flachen Kuppe, deren Kamm auf der
 * Linie der Bewohner liegt (anchors.ts, `midgroundGeometry`).
 *
 * Gezeichnet wird in die statische Kulisse (tree.ts, `paintStatic`) – also nur bei
 * Größenänderung, neuer Jahreszeit-Stufe oder wenn ein Lebensraum öffnet; Tag und Nacht
 * und das Wetter tönen sie mit der übrigen Kulisse. Seed-Zufall, kein Math.random().
 */

import { animalSize, midgroundGeometry, type MidgroundGeometry } from './anchors';
import type { Layout } from './layout';
import { seasonColor, seasonHill, type SeasonLook } from './season';
import { clamp01, mix, mulberry32 } from './util';

/** Bits der Lebensräume im Mittelgrund (Schlüssel der Kulisse). */
export const MIDGROUND_MEADOW = 1;
export const MIDGROUND_WALL = 2;

/** Höhe der Mauer (Tiergrößen); die Bewohner liegen oben auf den Steinen. */
const WALL_HEIGHT = 0.42;

/** Zeichnet die offenen Lebensräume (`mask`) des Mittelgrunds in die Kulisse. */
export function paintMidground(ctx: CanvasRenderingContext2D, layout: Layout, mask: number, look: SeasonLook | null): void {
  if (!mask) return;
  const S = animalSize(layout.width, layout.height);
  if (mask & MIDGROUND_WALL) paintWallHabitat(ctx, layout, midgroundGeometry(layout, S, -1), look);
  if (mask & MIDGROUND_MEADOW) paintMeadowHabitat(ctx, layout, midgroundGeometry(layout, S, 1), look);
}

/** Flache Kuppe vom Boden bis zum Kamm `crest` zwischen x0 und x1 (sanfte Flanken). */
function knoll(ctx: CanvasRenderingContext2D, x0: number, x1: number, crest: number, groundY: number, S: number): void {
  const flank = Math.min(2.2 * S, (x1 - x0) / 3);
  const dome = S * 0.12;
  ctx.beginPath();
  ctx.moveTo(x0 - flank * 0.6, groundY + 2);
  ctx.bezierCurveTo(x0, groundY - 0.1 * S, x0 + flank * 0.2, crest, x0 + flank, crest);
  ctx.quadraticCurveTo((x0 + x1) / 2, crest - dome, x1 - flank, crest);
  ctx.bezierCurveTo(x1 - flank * 0.2, crest, x1, groundY - 0.1 * S, x1 + flank * 0.6, groundY + 2);
  ctx.closePath();
}

/** Kuppe mit Verlauf (oben sonnig, unten in die Farbe der nahen Hügel). */
function fillKnoll(ctx: CanvasRenderingContext2D, crest: number, groundY: number, top: string, bottom: string, look: SeasonLook | null): void {
  const g = ctx.createLinearGradient(0, crest, 0, groundY);
  g.addColorStop(0, seasonHill(top, look));
  g.addColorStop(1, seasonHill(bottom, look));
  ctx.fillStyle = g;
  ctx.fill();
}

/** Schneehaube auf dem Kamm (Winter). */
function snowCap(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, S: number, snow: number, seed: number): void {
  if (snow <= 0.01) return;
  const rand = mulberry32(seed);
  ctx.save();
  ctx.globalAlpha = clamp01(snow * 1.1);
  ctx.fillStyle = '#eef2f4';
  ctx.beginPath();
  const steps = Math.max(6, Math.round((x1 - x0) / (S * 0.3)));
  ctx.moveTo(x0, y + 0.06 * S);
  for (let i = 0; i <= steps; i++) ctx.lineTo(x0 + ((x1 - x0) * i) / steps, y - (0.03 + 0.05 * rand()) * S);
  ctx.lineTo(x1, y + 0.08 * S);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Waldwiese
// ---------------------------------------------------------------------------

/** Wie stark die Wiese blüht (Frühling und Sommer) bzw. Samenstände trägt (Herbst). */
function meadowBloom(look: SeasonLook | null): { flowers: number; seeds: number } {
  if (!look || look.summer) return { flowers: 1, seeds: 0 };
  return { flowers: clamp01(1 - look.autumn * 1.3 - look.snow * 2), seeds: clamp01(look.autumn * 1.2 - look.snow) };
}

function paintMeadowHabitat(ctx: CanvasRenderingContext2D, layout: Layout, m: MidgroundGeometry, look: SeasonLook | null): void {
  const S = m.size;
  const crest = m.y + 0.06 * S;
  const x0 = m.x - (m.halfWidth + 0.9) * S;
  const x1 = m.x + (m.halfWidth + 1.3) * S;
  ctx.save();
  knoll(ctx, x0, x1, crest, layout.groundY, S);
  fillKnoll(ctx, crest, layout.groundY, '#aecb86', '#97c08e', look);
  // Sonniger Schimmer der Lichtung
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = seasonColor('#d7e8a0', look);
  ctx.beginPath();
  ctx.ellipse(m.x, crest + 0.25 * S, (m.halfWidth + 0.6) * S, 0.3 * S, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const rand = mulberry32(4711);
  // Hohes Gras: Halme in drei Tönen über die ganze Lichtung
  const n = Math.round((x1 - x0) / (S * 0.07));
  const greens = ['#6f9a48', '#86b05a', '#9cc068'].map((c) => seasonColor(c, look));
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = greens[pass]!;
    ctx.beginPath();
    for (let i = 0; i < n / 3; i++) {
      const x = x0 + S * 0.6 + rand() * (x1 - x0 - S * 1.2);
      const base = crest + (0.02 + rand() * 0.18) * S;
      const h = (0.22 + rand() * 0.34) * S * (1 - Math.abs(x - m.x) / (x1 - x0));
      const lean = (rand() - 0.5) * 0.12 * S;
      ctx.moveTo(x - 0.018 * S, base);
      ctx.lineTo(x + lean, base - h);
      ctx.lineTo(x + 0.018 * S, base);
      ctx.closePath();
    }
    ctx.fill();
  }
  // Blüten (Frühling, Sommer) bzw. Samenstände (Herbst)
  const { flowers, seeds } = meadowBloom(look);
  const colors = ['#f6f2e8', '#ecc94a', '#c98fc4', '#8fa6d8', '#f6f2e8'];
  const count = Math.round((m.halfWidth * 2 + 1) * 9);
  for (let i = 0; i < count; i++) {
    const x = m.x + (rand() - 0.5) * (m.halfWidth * 2 + 1.4) * S;
    const y = crest - (0.05 + rand() * 0.3) * S;
    const r = (0.035 + rand() * 0.025) * S;
    const col = colors[Math.floor(rand() * colors.length)]!;
    if (flowers > 0.05) {
      ctx.globalAlpha = flowers;
      ctx.strokeStyle = seasonColor('#5f8a3e', look);
      ctx.lineWidth = Math.max(0.6, 0.015 * S);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 0.01 * S, y + 0.2 * S);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e0a83a';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    if (seeds > 0.05) {
      ctx.globalAlpha = seeds;
      ctx.fillStyle = i % 3 === 0 ? '#e9e2cf' : '#8a6a42';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  snowCap(ctx, x0 + S * 0.4, x1 - S * 0.4, crest, S, look ? look.snow : 0, 31);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Trockenmauer
// ---------------------------------------------------------------------------

/** Stein als abgerundetes Viereck (ohne `roundRect`, läuft überall). */
function stone(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k);
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k);
  ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}

function paintWallHabitat(ctx: CanvasRenderingContext2D, layout: Layout, m: MidgroundGeometry, look: SeasonLook | null): void {
  const S = m.size;
  const top = m.y;
  const bottom = m.y + WALL_HEIGHT * S;
  const x0 = m.x - (m.halfWidth + 1.3) * S;
  const x1 = m.x + (m.halfWidth + 0.9) * S;
  ctx.save();
  // Kuppe, auf der die Mauer steht (etwas trockener als die Wiese)
  knoll(ctx, x0, x1, bottom - 0.04 * S, layout.groundY, S);
  fillKnoll(ctx, bottom, layout.groundY, '#b0c68e', '#97c08e', look);
  const wx0 = m.x - (m.halfWidth + 0.25) * S;
  const wx1 = m.x + (m.halfWidth + 0.25) * S;
  // Schatten am Fuß
  ctx.fillStyle = 'rgba(60, 70, 40, 0.25)';
  ctx.beginPath();
  ctx.ellipse((wx0 + wx1) / 2, bottom + 0.02 * S, (wx1 - wx0) / 2 + 0.1 * S, 0.06 * S, 0, 0, Math.PI * 2);
  ctx.fill();
  // Fugen als dunkler Grund, darauf die Lesesteine in drei Lagen
  ctx.fillStyle = '#5e564c';
  ctx.beginPath();
  stone(ctx, wx0, top + 0.02 * S, wx1 - wx0, bottom - top - 0.02 * S, 0.06 * S);
  ctx.fill();
  const rand = mulberry32(2024);
  const tones = ['#a49a8a', '#b8ae9c', '#958b7c', '#c2b9a6', '#aaa192'].map((c) => seasonColor(c, look));
  const rows = 3;
  const rh = (bottom - top) / rows;
  for (let r = 0; r < rows; r++) {
    const y = top + r * rh;
    let x = wx0 + (r % 2 === 1 ? -0.12 * S : 0);
    while (x < wx1) {
      const w = (0.24 + rand() * 0.22) * S * (r === 0 ? 1.15 : 1);
      const sx = Math.max(wx0, x + 0.012 * S);
      const ex = Math.min(wx1, x + w - 0.012 * S);
      if (ex - sx > 0.05 * S) {
        const hh = rh - 0.024 * S - (r === 0 ? rand() * 0.03 * S : 0);
        ctx.fillStyle = tones[Math.floor(rand() * tones.length)]!;
        ctx.beginPath();
        stone(ctx, sx, y + 0.012 * S + (rh - 0.024 * S - hh), ex - sx, hh, 0.05 * S);
        ctx.fill();
        // Licht von oben, Schatten unten
        ctx.fillStyle = 'rgba(255, 252, 240, 0.22)';
        ctx.fillRect(sx + 0.03 * S, y + 0.02 * S + (rh - 0.024 * S - hh), ex - sx - 0.06 * S, 0.025 * S);
        // Flechten und Moos
        if (rand() < 0.3) {
          ctx.fillStyle = rand() < 0.5 ? seasonColor('#7a9a4a', look) : mix('#d9c46a', '#b5ab98', look ? look.snow * 0.5 : 0);
          ctx.beginPath();
          ctx.ellipse(sx + (ex - sx) * rand(), y + rh * (0.3 + 0.4 * rand()), 0.05 * S, 0.025 * S, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      x += w;
    }
  }
  // Mauerpfeffer und Gräser in den Ritzen (nicht im Winter)
  const green = look ? clamp01(1 - look.snow * 1.5) : 1;
  if (green > 0.05) {
    ctx.globalAlpha = green;
    for (let i = 0; i < Math.round(m.halfWidth * 3); i++) {
      const x = wx0 + rand() * (wx1 - wx0);
      const y = top + rand() * (bottom - top) * 0.8;
      ctx.fillStyle = seasonColor('#6f9a48', look);
      ctx.beginPath();
      ctx.ellipse(x, y, 0.06 * S, 0.025 * S, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!look || look.autumn < 0.5) {
        ctx.fillStyle = '#e8c94a';
        ctx.beginPath();
        ctx.arc(x + 0.02 * S, y - 0.02 * S, 0.018 * S, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  snowCap(ctx, wx0, wx1, top + 0.02 * S, S, look ? look.snow : 0, 47);
  ctx.restore();
}
