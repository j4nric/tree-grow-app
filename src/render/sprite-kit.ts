/**
 * Gemeinsame Zeichenhelfer für Tier-Sprites (flacher Stil, dunkler Umriss).
 * Koordinaten in Zeicheneinheiten: 1 = Grundgröße des Sprites, Ursprung = Ankerpunkt.
 */

export type Paint = (c: CanvasRenderingContext2D, frame: number) => void;

export interface SpriteDef {
  /** Begrenzung in Zeicheneinheiten (1 = Grundgröße), Ursprung = Ankerpunkt. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  paint: Paint;
}

export const OUTLINE = 'rgba(46, 34, 24, 0.55)';
export const TAU = Math.PI * 2;

export function ell(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, TAU);
  c.fill();
}

export function poly(c: CanvasRenderingContext2D, pts: number[], fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  c.closePath();
  c.fill();
}

export function line(c: CanvasRenderingContext2D, pts: number[], color: string, width: number): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  c.stroke();
}

/** Umriss: zeichnet die Silhouette dicker in Dunkel, damit kleine Tiere sich abheben. */
export function outline(c: CanvasRenderingContext2D, width: number, build: () => void): void {
  c.strokeStyle = OUTLINE;
  c.lineWidth = width;
  c.lineJoin = 'round';
  c.beginPath();
  build();
  c.stroke();
}

export function eye(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ell(c, x, y, r, r, 0, '#1d1a17');
  ell(c, x + r * 0.35, y - r * 0.35, r * 0.38, r * 0.38, 0, 'rgba(255,255,255,0.9)');
}

/** Pfad einer Ellipse (für `outline`). */
export function ellPath(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  c.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  c.ellipse(x, y, rx, ry, rot, 0, TAU);
}

/** Pfad eines Vielecks (für `outline`). */
export function polyPath(c: CanvasRenderingContext2D, pts: number[]): void {
  c.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  c.closePath();
}

export interface BirdColors {
  back: string;
  wing: string;
  wingBar?: string;
  tail: string;
  head: string;
  breast: string;
  belly: string;
  face?: string;
  cheek?: string;
  stripe?: string;
  beak: string;
  leg: string;
}

/** Kleiner Singvogel im Profil, Blick nach rechts, Füße auf (0, 0). */
export function paintBird(c: CanvasRenderingContext2D, col: BirdColors): void {
  line(c, [-0.06, -0.18, -0.08, 0, -0.14, 0.01], col.leg, 0.05);
  line(c, [0.06, -0.18, 0.07, 0, 0.13, 0.01], col.leg, 0.05);
  const tail = [-0.24, -0.44, -0.66, -0.62, -0.62, -0.5, -0.22, -0.3];
  outline(c, 0.11, () => {
    c.moveTo(tail[0]!, tail[1]!);
    for (let i = 2; i < tail.length; i += 2) c.lineTo(tail[i]!, tail[i + 1]!);
    c.closePath();
    c.moveTo(0.34, -0.4);
    c.ellipse(0, -0.4, 0.35, 0.27, -0.12, 0, TAU);
    c.moveTo(0.41, -0.68);
    c.arc(0.21, -0.68, 0.2, 0, TAU);
  });
  poly(c, tail, col.tail);
  ell(c, 0, -0.4, 0.35, 0.27, -0.12, col.back);
  ell(c, 0.1, -0.36, 0.25, 0.22, 0, col.breast);
  ell(c, 0.02, -0.21, 0.21, 0.09, 0, col.belly);
  ell(c, -0.09, -0.43, 0.24, 0.14, 0.28, col.wing);
  if (col.wingBar) line(c, [-0.24, -0.46, -0.02, -0.4], col.wingBar, 0.04);
  ell(c, 0.21, -0.68, 0.2, 0.2, 0, col.head);
  if (col.face) ell(c, 0.27, -0.6, 0.15, 0.15, 0, col.face);
  if (col.cheek) ell(c, 0.25, -0.62, 0.12, 0.08, 0, col.cheek);
  if (col.stripe) line(c, [0.13, -0.69, 0.36, -0.7], col.stripe, 0.045);
  poly(c, [0.37, -0.72, 0.52, -0.67, 0.37, -0.63], col.beak);
  eye(c, 0.29, -0.71, 0.048);
}
