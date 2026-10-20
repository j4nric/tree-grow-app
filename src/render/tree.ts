/**
 * Zeichnet die Szene (Himmel, Boden, Baum/Wald) auf ein Canvas.
 * Liest nur den Wachstumswert – verändert nie den Spielstand.
 */

export interface SceneInput {
  /** Kontinuierlicher Wachstumswert aus core/formulas.ts `growth()`. */
  growth: number;
  /** Laufzeit in Sekunden, für sanftes Wiegen im Wind. */
  time: number;
}

const COLORS = {
  skyTop: '#9fd3f0',
  skyBottom: '#e8f6ec',
  ground: '#6b4f2f',
  groundTop: '#5a8f3c',
  bark: '#5b3a1e',
  leaf: ['#3f8f3a', '#5aa84a', '#77c25a'],
  seed: '#8a5a2b',
};

/** Ab diesem Wachstumswert (Stufe „Hain“) erscheinen weitere Bäume. */
const GROVE_GROWTH = 5;

export function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, input: SceneInput): void {
  const groundY = height * 0.82;
  drawBackground(ctx, width, height, groundY);

  const g = input.growth;
  if (g < 1) {
    drawSeed(ctx, width / 2, groundY, g, input.time);
    return;
  }

  // Nachbarbäume ab dem Hain: kleiner, weiter hinten, gleichmäßig verteilt.
  if (g >= GROVE_GROWTH) {
    const extra = Math.min(Math.floor((g - GROVE_GROWTH + 1) * 4), 14);
    for (let i = 0; i < extra; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const slot = Math.floor(i / 2) + 1;
      const x = width / 2 + side * slot * width * 0.075;
      const scale = 0.45 + 0.25 * pseudo(i * 7.13);
      drawTree(ctx, x, groundY - 4, Math.min(g - 1.5, 5) * scale, input.time, 1000 + i, height);
    }
  }

  drawTree(ctx, width / 2, groundY, g, input.time, 42, height);
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, COLORS.skyTop);
  sky.addColorStop(1, COLORS.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, groundY);

  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.fillStyle = COLORS.groundTop;
  ctx.fillRect(0, groundY, width, 6);
}

/** Stufe „Samen“: Samen im Boden, bei wachsendem g schiebt sich ein Keim heraus. */
function drawSeed(ctx: CanvasRenderingContext2D, x: number, groundY: number, g: number, time: number): void {
  ctx.fillStyle = COLORS.seed;
  ctx.beginPath();
  ctx.ellipse(x, groundY + 16, 9, 6, -0.3, 0, Math.PI * 2);
  ctx.fill();

  const sproutHeight = g * 28;
  if (sproutHeight < 1) return;
  const sway = Math.sin(time * 1.5) * 2 * g;
  ctx.strokeStyle = COLORS.leaf[0]!;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, groundY + 10);
  ctx.quadraticCurveTo(x - 4, groundY - sproutHeight / 2, x + sway, groundY - sproutHeight);
  ctx.stroke();
}

/**
 * Rekursiver Baum. `g` (≥ 1) steuert Größe und Verzweigungstiefe; der Bruchteil
 * von g lässt die äußerste Astebene stufenlos herauswachsen.
 */
function drawTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  g: number,
  time: number,
  seed: number,
  height: number,
): void {
  g = Math.max(g, 1.2);
  const depth = Math.min(1 + (g - 1) * 1.4, 9);
  const trunkLength = Math.min(height * 0.06 + (g - 1) * height * 0.03, height * 0.16);
  const trunkWidth = 2 + (g - 1) * 2.4;
  const rand = mulberry32(seed);
  const sway = Math.sin(time * 0.8 + seed) * 0.03;

  ctx.lineCap = 'round';
  branch(ctx, rand, x, groundY, -Math.PI / 2, trunkLength, trunkWidth, 0, depth, sway);
}

function branch(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  level: number,
  depth: number,
  sway: number,
): void {
  // Die äußerste Ebene wächst anteilig mit dem Bruchteil der Tiefe.
  const grow = Math.min(1, depth - level);
  if (grow <= 0) return;
  const len = length * grow;
  const x2 = x + Math.cos(angle) * len;
  const y2 = y + Math.sin(angle) * len;

  ctx.strokeStyle = COLORS.bark;
  ctx.lineWidth = Math.max(width, 1);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Zufallswerte immer gleich oft ziehen, damit der Baum beim Wachsen stabil bleibt.
  const children = rand() > 0.65 ? 3 : 2;
  const spreads = Array.from({ length: children }, () => rand());
  const shrinks = Array.from({ length: children }, () => rand());

  const isTip = level + 1 >= depth;
  if (isTip || level >= 2) drawLeaves(ctx, x2, y2, 3 + width * 1.2 * grow, rand());
  if (isTip) return;

  for (let i = 0; i < children; i++) {
    const spread = (i / (children - 1) - 0.5) * 1.1 + (spreads[i]! - 0.5) * 0.5;
    branch(
      ctx,
      rand,
      x2,
      y2,
      angle + spread + sway * (level + 1),
      length * (0.68 + shrinks[i]! * 0.14),
      width * 0.68,
      level + 1,
      depth,
      sway,
    );
  }
}

function drawLeaves(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, r: number): void {
  ctx.fillStyle = COLORS.leaf[Math.floor(r * COLORS.leaf.length)]!;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Kleiner, deterministischer Zufallsgenerator (gleicher Seed → gleicher Baum). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pseudo(n: number): number {
  const s = Math.sin(n) * 10000;
  return s - Math.floor(s);
}
