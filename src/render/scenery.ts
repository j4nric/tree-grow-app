/**
 * Kulisse: Himmel, Hügel, Boden und ziehende Wolken.
 * Alles hier ist statisch (pro Canvas-Größe) – nur die Wolken bewegen sich, und zwar
 * als vorgerenderte Sprites, die pro Frame lediglich verschoben werden.
 */

import { seasonColor, seasonHill, seasonSky, type SeasonLook } from './season';
import type { GrassColors, SoilColors } from './site-scenery';
import { mulberry32 } from './util';

export const SKY = {
  top: '#8fc6e6',
  mid: '#c4e2ee',
  horizon: '#eaf3e4',
  haze: '#d3e6e3',
};

const LAND = {
  hillFar: '#b4d2bf',
  hillNear: '#97c08e',
  grass: '#5d9a3e',
  grassLight: '#78b153',
  soilTop: '#6b4b30',
  soilBottom: '#3f2b1c',
  stone: '#7f6853',
};

/** Himmel mit sanftem Verlauf und einem diffusen Sonnenschein. */
export function paintSky(ctx: CanvasRenderingContext2D, width: number, groundY: number, look: SeasonLook | null = null): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, seasonSky(SKY.top, look));
  sky.addColorStop(0.6, seasonSky(SKY.mid, look));
  sky.addColorStop(1, seasonSky(SKY.horizon, look));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, groundY + 1);

  const sunX = width * 0.84;
  const sunY = groundY * 0.16;
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(width, groundY) * 0.45);
  glow.addColorStop(0, 'rgba(255, 250, 225, 0.75)');
  glow.addColorStop(0.15, 'rgba(255, 248, 220, 0.35)');
  glow.addColorStop(1, 'rgba(255, 248, 220, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, groundY + 1);
}

/** Zwei sanfte Hügelketten am Horizont. */
export function paintHills(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number, look: SeasonLook | null = null): void {
  const ridge = (base: number, amp: number, f1: number, f2: number, p: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 1);
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const y = groundY - height * (base + amp * (0.6 * Math.sin(u * f1 + p) + 0.4 * Math.sin(u * f2 + p * 2.3)));
      ctx.lineTo(u * width, y);
    }
    ctx.lineTo(width, groundY + 1);
    ctx.closePath();
    ctx.fill();
  };
  ridge(0.12, 0.035, 5.2, 13.1, 0.7, seasonHill(LAND.hillFar, look));
  ridge(0.05, 0.018, 7.3, 17.9, 2.1, seasonHill(LAND.hillNear, look));
}

/** Erdreich mit Steinchen (ohne Wurzeln); `colors` je Standort (ohne Angabe: Heimatwald). */
export function paintSoil(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number, colors: SoilColors | null = null): void {
  const soil = ctx.createLinearGradient(0, groundY, 0, height);
  soil.addColorStop(0, colors ? colors.top : LAND.soilTop);
  soil.addColorStop(1, colors ? colors.bottom : LAND.soilBottom);
  ctx.fillStyle = soil;
  ctx.fillRect(0, groundY, width, height - groundY);

  const rand = mulberry32(7);
  const soilH = height - groundY;
  const count = Math.round((width / 30) * (colors ? colors.stones : 1));
  ctx.fillStyle = colors ? colors.stone : LAND.stone;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const x = rand() * width;
    const y = groundY + soilH * (0.2 + rand() * 0.75);
    const r = 1.5 + rand() * Math.min(6, soilH * 0.06);
    ctx.moveTo(x + r * 1.4, y);
    ctx.ellipse(x, y, r * 1.4, r, rand() * 0.5, 0, Math.PI * 2);
  }
  ctx.fill();
  // feine helle Krümel
  ctx.fillStyle = colors ? colors.crumb : '#a58a6c';
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  for (let i = 0; i < count * 3; i++) {
    const x = rand() * width;
    const y = groundY + soilH * (0.1 + rand() * 0.9);
    ctx.rect(x, y, 1.2, 1.2);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Grasnarbe mit kleinen Halmen an der Bodenkante; `colors` je Standort (ohne Angabe: Heimatwald). */
export function paintGrass(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  groundY: number,
  look: SeasonLook | null = null,
  colors: GrassColors | null = null,
): void {
  const grass = seasonColor(colors ? colors.blade : LAND.grass, look);
  const grassLight = seasonColor(colors ? colors.bladeLight : LAND.grassLight, look);
  const band = Math.max(4, height * 0.014);
  const grad = ctx.createLinearGradient(0, groundY - 1, 0, groundY + band);
  grad.addColorStop(0, colors ? seasonColor(colors.bandLight, look) : grassLight);
  grad.addColorStop(1, colors ? seasonColor(colors.band, look) : grass);
  ctx.fillStyle = grad;
  ctx.fillRect(0, groundY - 1, width, band + 1);

  const rand = mulberry32(3);
  const bladeH = Math.max(4, height * 0.016);
  for (const [color, n] of [
    [grass, 1],
    [grassLight, 0.6],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const count = Math.round((width / 5) * n * (colors ? colors.density : 1));
    for (let i = 0; i < count; i++) {
      const x = rand() * width;
      const h = bladeH * (0.4 + rand() * 0.8);
      const lean = (rand() - 0.5) * h * 0.8;
      ctx.moveTo(x - 1.4, groundY + 1);
      ctx.lineTo(x + lean, groundY - h);
      ctx.lineTo(x + 1.4, groundY + 1);
      ctx.closePath();
    }
    ctx.fill();
  }
}

export interface Cloud {
  sprite: HTMLCanvasElement;
  /** Größe in CSS-Pixeln. */
  w: number;
  h: number;
  y: number;
  x0: number;
  speed: number;
}

/** Erzeugt einige Wolken-Sprites für die aktuelle Szenengröße. */
export function createClouds(width: number, groundY: number, dpr: number): Cloud[] {
  const rand = mulberry32(99);
  const clouds: Cloud[] = [];
  const count = width < 500 ? 3 : 5;
  for (let i = 0; i < count; i++) {
    const w = Math.min(Math.max(width * (0.14 + rand() * 0.1), 70), 260);
    const h = w * 0.45;
    const sprite = document.createElement('canvas');
    sprite.width = Math.ceil(w * dpr);
    sprite.height = Math.ceil(h * dpr);
    const c = sprite.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintCloud(c, w, h, rand);
    clouds.push({
      sprite,
      w,
      h,
      y: groundY * (0.04 + (i / count) * 0.36) + rand() * groundY * 0.04,
      x0: rand() * (width + w),
      speed: (3 + rand() * 5) * (w / 160),
    });
  }
  return clouds;
}

function paintCloud(c: CanvasRenderingContext2D, w: number, h: number, rand: () => number): void {
  const puffs: [number, number, number][] = [];
  const n = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const r = h * (0.22 + 0.2 * Math.sin(u * Math.PI)) * (0.85 + rand() * 0.3);
    puffs.push([w * (0.12 + u * 0.76), h * 0.72 - r * 0.55, r]);
  }
  const draw = (color: string, dy: number, scale: number) => {
    c.fillStyle = color;
    c.beginPath();
    for (const [x, y, r] of puffs) {
      c.moveTo(x + r * scale, y + dy);
      c.arc(x, y + dy, r * scale, 0, Math.PI * 2);
    }
    c.rect(w * 0.14, h * 0.55 + dy, w * 0.72, h * 0.2 * scale);
    c.fill();
  };
  draw('#dbe9f1', h * 0.04, 1);
  draw('#ffffff', -h * 0.03, 0.93);
}

/**
 * Zeichnet die Wolken (Koordinaten in Gerätepixeln). Tag und Nacht: `sprites` sind getönte
 * Kopien (gleiche Reihenfolge), `alpha` ist nachts kleiner.
 */
export function drawClouds(
  ctx: CanvasRenderingContext2D,
  clouds: Cloud[],
  width: number,
  time: number,
  dpr: number,
  alpha = 0.9,
  sprites: readonly HTMLCanvasElement[] | null = null,
): void {
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < clouds.length; i++) {
    const cl = clouds[i]!;
    const span = width + cl.w;
    const x = ((((cl.x0 + time * cl.speed) % span) + span) % span) - cl.w;
    ctx.drawImage(sprites?.[i] ?? cl.sprite, Math.round(x * dpr), Math.round(cl.y * dpr));
  }
  ctx.globalAlpha = 1;
}
