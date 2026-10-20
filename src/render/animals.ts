/**
 * Tier-Ebene: kleine, flache Zeichnungen der Tiere an ihren Ankerpunkten im Baum.
 *
 * Jede Art (und jede Deko wie Blumen, Laub, Höhle) wird einmal je Größe und
 * Pixeldichte in ein kleines Offscreen-Canvas gezeichnet. Pro Frame gibt es nur
 * `drawImage` mit günstigen Transformationen (Verschieben, Spiegeln, Drehen).
 *
 * Zufriedenheit: Zufriedene Tiere hüpfen, flattern, krabbeln; unzufriedene ruhen und
 * wirken etwas blasser (vorberechnete, entsättigte Sprite-Variante). Keine traurigen
 * Gesichter. Bei `reducedMotion` stehen alle Tiere still.
 */

import type { AnchorResolver, NicheAnchor } from './anchors';
import { clamp, clamp01, hash2, smooth01 } from './util';

export type AnimalFamily = 'birds' | 'insects' | 'mammals' | 'soil' | 'fungi';

/** Ein Tier, wie es der Renderer bekommt (unabhängig vom Spielkern). */
export interface SceneAnimal {
  /** Art-ID, z. B. 'robin'. Unbekannte Arten bekommen die Zeichnung ihrer Gattung. */
  id: string;
  family: AnimalFamily;
  /** Nische: 'roots' | 'litter' | 'edge' | 'crown' | 'bark' | 'hollows' (sonst nicht gezeichnet). */
  niche: string;
  /** Platz in der Nische, 0..n. */
  slot: number;
  /** Zufriedenheit 0–1. */
  happiness: number;
}

// ---------------------------------------------------------------------------
// Arten → Zeichnung und Verhalten
// ---------------------------------------------------------------------------

type Motion = 'hop' | 'peck' | 'hover' | 'crawl' | 'inch' | 'wiggle' | 'sniff' | 'still';

interface KindInfo {
  /** Größe relativ zur Grundgröße. */
  size: number;
  motion: Motion;
  frames: number;
  /** Klammert sich seitlich an die Rinde (Specht) statt darauf zu krabbeln. */
  cling?: boolean;
}

const KINDS: Record<string, KindInfo> = {
  robin: { size: 1, motion: 'hop', frames: 1 },
  bluetit: { size: 0.9, motion: 'hop', frames: 1 },
  woodpecker: { size: 1.15, motion: 'peck', frames: 1, cling: true },
  bee: { size: 1, motion: 'hover', frames: 2 },
  oakmoth: { size: 1, motion: 'inch', frames: 2 },
  barkbeetle: { size: 1, motion: 'crawl', frames: 2 },
  earthworm: { size: 1.05, motion: 'wiggle', frames: 2 },
  woodlouse: { size: 1.05, motion: 'crawl', frames: 2 },
  centipede: { size: 1.15, motion: 'crawl', frames: 2 },
  // Gattungs-Ersatz für alle weiteren Arten
  bird: { size: 1, motion: 'hop', frames: 1 },
  insect: { size: 0.9, motion: 'crawl', frames: 2 },
  mammal: { size: 1.1, motion: 'sniff', frames: 1 },
  snail: { size: 0.95, motion: 'crawl', frames: 1 },
  mushroom: { size: 1, motion: 'still', frames: 1 },
  bracket: { size: 1, motion: 'still', frames: 1 },
};

const SPECIES_KIND: Record<string, string> = {
  robin: 'robin',
  bluetit: 'bluetit',
  woodpecker: 'woodpecker',
  bee: 'bee',
  oakmoth: 'oakmoth',
  barkbeetle: 'barkbeetle',
  earthworm: 'earthworm',
  woodlouse: 'woodlouse',
  centipede: 'centipede',
};

const FAMILY_KIND: Record<AnimalFamily, string> = {
  birds: 'bird',
  insects: 'insect',
  mammals: 'mammal',
  soil: 'snail',
  fungi: 'mushroom',
};

/** Welche Zeichnung bekommt ein Tier? (Art, sonst Gattung; Pilze an der Rinde als Konsolen.) */
export function animalKind(a: Pick<SceneAnimal, 'id' | 'family' | 'niche'>): string {
  const kind = SPECIES_KIND[a.id] ?? FAMILY_KIND[a.family] ?? 'insect';
  if (kind === 'mushroom' && (a.niche === 'bark' || a.niche === 'hollows')) return 'bracket';
  return kind;
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

type Paint = (c: CanvasRenderingContext2D, frame: number) => void;

interface SpriteDef {
  /** Begrenzung in Zeicheneinheiten (1 = Grundgröße), Ursprung = Ankerpunkt. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  paint: Paint;
}

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Versatz und Größe in CSS-Pixeln relativ zum Ankerpunkt. */
  ox: number;
  oy: number;
  w: number;
  h: number;
}

const OUTLINE = 'rgba(46, 34, 24, 0.55)';
const TAU = Math.PI * 2;

function ell(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, TAU);
  c.fill();
}

function poly(c: CanvasRenderingContext2D, pts: number[], fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  c.closePath();
  c.fill();
}

function line(c: CanvasRenderingContext2D, pts: number[], color: string, width: number): void {
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
function outline(c: CanvasRenderingContext2D, width: number, build: () => void): void {
  c.strokeStyle = OUTLINE;
  c.lineWidth = width;
  c.lineJoin = 'round';
  c.beginPath();
  build();
  c.stroke();
}

function eye(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ell(c, x, y, r, r, 0, '#1d1a17');
  ell(c, x + r * 0.35, y - r * 0.35, r * 0.38, r * 0.38, 0, 'rgba(255,255,255,0.9)');
}

interface BirdColors {
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
function paintBird(c: CanvasRenderingContext2D, col: BirdColors): void {
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

const BIRD_ROBIN: BirdColors = {
  back: '#8a7350',
  wing: '#77613f',
  tail: '#6f5a3b',
  head: '#8a7350',
  breast: '#e0743a',
  belly: '#efe6d6',
  face: '#e0743a',
  beak: '#3a2f25',
  leg: '#8a6a52',
};

const BIRD_BLUETIT: BirdColors = {
  back: '#9aae5c',
  wing: '#5b8cc3',
  wingBar: '#eef3f6',
  tail: '#4f7fb5',
  head: '#4a86c8',
  breast: '#efcd43',
  belly: '#f3dc6e',
  cheek: '#f8f6ee',
  stripe: '#26304a',
  beak: '#2f2f2f',
  leg: '#6c7a8c',
};

const BIRD_GENERIC: BirdColors = {
  back: '#8d7457',
  wing: '#6f5841',
  wingBar: '#e6dccb',
  tail: '#6a5540',
  head: '#8c8780',
  breast: '#cdbfa6',
  belly: '#e4dac7',
  cheek: '#ddd4c4',
  beak: '#4a3f33',
  leg: '#8a6a52',
};

/** Buntspecht an der Rinde: Rinde rechts, Kontaktstelle (Bauch) auf (0, 0). */
function paintWoodpecker(c: CanvasRenderingContext2D): void {
  c.translate(0, 0.42);
  const black = '#25252a';
  const white = '#f3f0e8';
  const red = '#c8352e';
  outline(c, 0.1, () => {
    c.moveTo(-0.17, -0.18);
    c.lineTo(-0.02, -0.14);
    c.lineTo(0.02, 0.28);
    c.lineTo(-0.1, 0.3);
    c.closePath();
    c.moveTo(0.03, -0.46);
    c.ellipse(-0.15, -0.46, 0.19, 0.36, -0.12, 0, TAU);
    c.moveTo(0.07, -0.88);
    c.arc(-0.1, -0.88, 0.17, 0, TAU);
  });
  // Stützschwanz
  poly(c, [-0.17, -0.18, -0.02, -0.14, 0.02, 0.28, -0.1, 0.3], black);
  ell(c, -0.15, -0.46, 0.19, 0.36, -0.12, black);
  ell(c, -0.04, -0.46, 0.09, 0.3, -0.12, '#ebe4d6');
  ell(c, -0.05, -0.17, 0.07, 0.08, 0, red);
  ell(c, -0.2, -0.56, 0.07, 0.14, -0.1, white);
  for (const [x, y] of [
    [-0.27, -0.34],
    [-0.24, -0.25],
    [-0.28, -0.16],
  ] as const) {
    ell(c, x, y, 0.028, 0.02, 0, white);
  }
  // Kopf
  ell(c, -0.1, -0.88, 0.17, 0.17, 0, black);
  ell(c, -0.06, -0.85, 0.13, 0.11, 0, white);
  line(c, [0.04, -0.82, -0.12, -0.78, -0.2, -0.86], black, 0.045);
  ell(c, -0.22, -0.92, 0.055, 0.055, 0, red);
  poly(c, [0.04, -0.93, 0.27, -0.9, 0.04, -0.85], '#3b3b3b');
  eye(c, -0.03, -0.9, 0.038);
  // Krallen an der Rinde
  line(c, [0.0, -0.3, 0.06, -0.27], '#55504a', 0.04);
  line(c, [0.01, -0.2, 0.07, -0.18], '#55504a', 0.04);
}

/** Wildbiene im Flug, Mitte auf (0, 0); Frame 0/1 = Flügel oben/unten. */
function paintBee(c: CanvasRenderingContext2D, frame: number): void {
  const wingRot = frame === 0 ? -0.75 : -0.15;
  const wingY = frame === 0 ? -0.2 : -0.13;
  ell(c, 0.02, wingY, 0.17, 0.08, wingRot - 0.25, 'rgba(225, 238, 245, 0.65)');
  outline(c, 0.08, () => {
    c.moveTo(0.29, 0);
    c.ellipse(0, 0, 0.29, 0.19, 0, 0, TAU);
    c.moveTo(0.4, -0.02);
    c.arc(0.28, -0.02, 0.12, 0, TAU);
  });
  ell(c, 0, 0, 0.29, 0.19, 0, '#e3a53b');
  c.save();
  c.beginPath();
  c.ellipse(0, 0, 0.29, 0.19, 0, 0, TAU);
  c.clip();
  c.fillStyle = '#3d2b1d';
  c.fillRect(-0.12, -0.25, 0.08, 0.5);
  c.fillRect(0.04, -0.25, 0.07, 0.5);
  c.fillRect(-0.32, -0.25, 0.1, 0.5);
  ell(c, 0.02, -0.08, 0.22, 0.07, 0, 'rgba(255, 236, 180, 0.4)');
  c.restore();
  ell(c, 0.28, -0.02, 0.12, 0.12, 0, '#3d2b1d');
  eye(c, 0.32, -0.04, 0.035);
  line(c, [0.33, -0.12, 0.42, -0.24], '#3d2b1d', 0.03);
  ell(c, 0.06, wingY - 0.02, 0.19, 0.09, wingRot, 'rgba(240, 248, 252, 0.85)');
  line(c, [-0.32, 0, -0.38, 0.01], '#3d2b1d', 0.035);
}

/** Eichenwickler-Raupe auf einem Eichenblatt; Blattmitte unten auf (0, 0). */
function paintOakmoth(c: CanvasRenderingContext2D, frame: number): void {
  // Eichenblatt mit Buchten
  const leaf = '#94c75e';
  outline(c, 0.08, () => {
    c.moveTo(0.42, -0.12);
    c.ellipse(0, -0.12, 0.42, 0.13, 0, 0, TAU);
  });
  ell(c, 0, -0.12, 0.42, 0.13, 0, leaf);
  for (const x of [-0.28, -0.1, 0.1, 0.27]) {
    ell(c, x, -0.21, 0.08, 0.06, 0, leaf);
    ell(c, x + 0.06, -0.03, 0.08, 0.06, 0, leaf);
  }
  line(c, [-0.5, -0.1, 0.38, -0.13], '#5f9440', 0.03);
  // Raupe: Segmente auf einem Bogen (Frame 1 = Spannerbuckel)
  const n = 7;
  const span = frame === 0 ? 0.56 : 0.42;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const x = -span / 2 + u * span;
    const arch = frame === 0 ? 0.02 * Math.sin(u * Math.PI * 2) : 0.17 * Math.sin(u * Math.PI);
    pts.push([x, -0.3 - arch]);
  }
  outline(c, 0.08, () => {
    for (const [x, y] of pts) {
      c.moveTo(x + 0.08, y);
      c.arc(x, y, 0.08, 0, TAU);
    }
  });
  for (const [x, y] of pts) ell(c, x, y + 0.02, 0.078, 0.07, 0, '#3f7a2c');
  for (const [x, y] of pts) ell(c, x, y - 0.005, 0.07, 0.062, 0, '#5f9e3a');
  for (const [x, y] of pts.slice(0, n - 1)) ell(c, x, y - 0.035, 0.022, 0.016, 0, '#cfe68a');
  const [hx, hy] = pts[n - 1]!;
  ell(c, hx + 0.05, hy, 0.07, 0.07, 0, '#2f2a22');
  ell(c, hx + 0.065, hy - 0.025, 0.02, 0.016, 0, 'rgba(255,255,255,0.55)');
}

/** Borkenkäfer mit Fraßbild, krabbelt nach rechts; Mitte auf (0, 0). */
function paintBarkbeetle(c: CanvasRenderingContext2D, frame: number): void {
  // Fraßbild: Muttergang mit Larvengängen
  c.globalAlpha = 0.75;
  line(c, [-0.75, 0, -0.18, 0], '#d9bb8e', 0.08);
  for (let i = 0; i < 5; i++) {
    const x = -0.68 + i * 0.12;
    const l = 0.12 + (i % 2) * 0.05 + i * 0.015;
    line(c, [x, -0.02, x - 0.04, -l], '#cfae80', 0.035);
    line(c, [x + 0.05, 0.02, x + 0.01, l], '#cfae80', 0.035);
  }
  c.globalAlpha = 1;
  // Beine
  const k = frame === 0 ? 0.04 : -0.04;
  for (const [x, s] of [
    [-0.1, 1],
    [0.04, -1],
    [0.16, 1],
  ] as const) {
    line(c, [x, 0, x + k * s - 0.04, 0.17], '#2a1a10', 0.035);
    line(c, [x, 0, x - k * s - 0.04, -0.17], '#2a1a10', 0.035);
  }
  outline(c, 0.08, () => {
    c.moveTo(0.3, 0);
    c.ellipse(0.04, 0, 0.27, 0.13, 0, 0, TAU);
  });
  ell(c, 0.04, 0, 0.27, 0.13, 0, '#6e4026');
  ell(c, 0.22, 0, 0.1, 0.11, 0, '#4a2a17');
  line(c, [-0.02, 0, -0.2, 0], '#3f2616', 0.025);
  ell(c, -0.02, -0.06, 0.16, 0.035, 0, 'rgba(255, 220, 180, 0.35)');
  line(c, [0.3, -0.04, 0.38, -0.1], '#2a1a10', 0.03);
  line(c, [0.3, 0.04, 0.38, 0.1], '#2a1a10', 0.03);
}

/** Regenwurm in seinem Gang; Mitte auf (0, 0). */
function paintEarthworm(c: CanvasRenderingContext2D, frame: number): void {
  const pts: number[] = [];
  const ph = frame === 0 ? 0 : Math.PI;
  for (let i = 0; i <= 16; i++) {
    const x = -0.5 + i / 16;
    pts.push(x, 0.07 * Math.sin(x * 8 + ph) * (0.4 + (x + 0.5) * 0.6));
  }
  line(c, pts, OUTLINE, 0.19);
  line(c, pts, '#c47f72', 0.12);
  line(
    c,
    pts.map((v, i) => (i % 2 === 1 ? v - 0.025 : v)),
    '#e2a99b',
    0.04,
  );
  // Gürtel (Clitellum)
  const band = pts.slice(22, 26);
  line(c, band, '#a95c52', 0.14);
}

/** Rollassel im Profil, Füße auf (0, 0). */
function paintWoodlouse(c: CanvasRenderingContext2D, frame: number): void {
  const k = frame === 0 ? 0.025 : -0.025;
  for (let i = 0; i < 7; i++) {
    const x = -0.26 + i * 0.085;
    line(c, [x, -0.06, x + (i % 2 ? k : -k), 0], '#3f4248', 0.03);
  }
  const rx = 0.34;
  const ry = 0.25;
  const cy = -0.05;
  const dome = () => {
    c.moveTo(rx, cy);
    c.ellipse(0, cy, rx, ry, 0, 0, Math.PI, true);
    c.closePath();
  };
  // Schwanzanhänge und Kopf mit Fühlern
  line(c, [-0.32, -0.07, -0.42, -0.03], '#4a4e55', 0.035);
  line(c, [0.32, -0.1, 0.44, -0.24, 0.54, -0.2], '#4a4e55', 0.03);
  outline(c, 0.09, dome);
  // Panzerplatten: abwechselnd hell und dunkel, dazwischen feine Fugen
  c.save();
  c.beginPath();
  dome();
  c.clip();
  const plates = 7;
  for (let i = 0; i < plates; i++) {
    const x0 = -rx + (i / plates) * rx * 2;
    c.fillStyle = i % 2 === 0 ? '#7a7f89' : '#8d929c';
    c.fillRect(x0, cy - ry - 0.01, (rx * 2) / plates + 0.005, ry + 0.02);
  }
  c.strokeStyle = '#4c5058';
  c.lineWidth = 0.022;
  c.beginPath();
  for (let i = 1; i < plates; i++) {
    const x = -rx + (i / plates) * rx * 2;
    c.moveTo(x, cy);
    c.lineTo(x - 0.015, cy - ry);
  }
  c.stroke();
  ell(c, -0.05, cy - ry * 0.72, rx * 0.65, 0.04, 0, 'rgba(255,255,255,0.28)');
  ell(c, 0, cy + 0.01, rx, 0.045, 0, 'rgba(40,42,48,0.35)');
  c.restore();
  ell(c, 0.31, -0.08, 0.065, 0.055, 0, '#5b5f67');
}

/** Steinläufer: lang, flach, viele Beine; Füße auf (0, 0). */
function paintCentipede(c: CanvasRenderingContext2D, frame: number): void {
  const n = 9;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(-0.48 + i * 0.105);
  for (let i = 0; i < n; i++) {
    const swing = ((i + frame) % 2 === 0 ? 1 : -1) * 0.035;
    line(c, [xs[i]!, -0.1, xs[i]! - 0.04 + swing, 0], '#7a3b1e', 0.025);
  }
  line(c, [-0.5, -0.1, -0.62, -0.03], '#7a3b1e', 0.025);
  outline(c, 0.07, () => {
    for (const x of xs) {
      c.moveTo(x + 0.075, -0.12);
      c.ellipse(x, -0.12, 0.075, 0.055, 0, 0, TAU);
    }
  });
  for (const x of xs) ell(c, x, -0.12, 0.072, 0.052, 0, '#a5552d');
  for (const x of xs) ell(c, x - 0.01, -0.145, 0.04, 0.018, 0, '#c97a4c');
  const hx = xs[n - 1]! + 0.07;
  ell(c, hx, -0.12, 0.06, 0.05, 0, '#7a3b1e');
  line(c, [hx + 0.03, -0.14, hx + 0.16, -0.24], '#7a3b1e', 0.022);
  line(c, [hx + 0.03, -0.12, hx + 0.17, -0.12], '#7a3b1e', 0.022);
}

/** Ersatz-Insekt: kleiner Käfer, Füße auf (0, 0). */
function paintInsect(c: CanvasRenderingContext2D, frame: number): void {
  const k = frame === 0 ? 0.03 : -0.03;
  for (const x of [-0.12, 0.02, 0.15]) line(c, [x, -0.1, x + k, 0], '#2a3329', 0.035);
  outline(c, 0.08, () => {
    c.moveTo(0.26, -0.14);
    c.ellipse(0, -0.14, 0.26, 0.16, 0, Math.PI, TAU);
    c.closePath();
    c.moveTo(0.38, -0.1);
    c.arc(0.3, -0.1, 0.08, 0, TAU);
  });
  c.fillStyle = '#3e6b4b';
  c.beginPath();
  c.ellipse(0, -0.08, 0.26, 0.2, 0, Math.PI, TAU);
  c.closePath();
  c.fill();
  ell(c, -0.06, -0.19, 0.12, 0.04, -0.15, '#86b07d');
  ell(c, 0.27, -0.1, 0.08, 0.07, 0, '#263528');
  line(c, [0.32, -0.15, 0.42, -0.25], '#263528', 0.025);
}

/** Ersatz-Säugetier: kleine Maus, Füße auf (0, 0). */
function paintMammal(c: CanvasRenderingContext2D): void {
  line(c, [-0.32, -0.12, -0.5, -0.06, -0.62, -0.16], '#9b7a63', 0.04);
  outline(c, 0.1, () => {
    c.moveTo(0.34, -0.22);
    c.ellipse(0, -0.22, 0.34, 0.22, 0, 0, TAU);
    c.moveTo(0.45, -0.3);
    c.arc(0.3, -0.3, 0.15, 0, TAU);
    c.moveTo(0.3, -0.45);
    c.arc(0.22, -0.45, 0.08, 0, TAU);
  });
  ell(c, 0, -0.22, 0.34, 0.22, 0, '#8a6b4e');
  ell(c, 0.08, -0.12, 0.22, 0.1, 0, '#c9ae8c');
  ell(c, 0.3, -0.3, 0.15, 0.14, 0, '#8a6b4e');
  ell(c, 0.42, -0.27, 0.07, 0.06, 0, '#9a7a5c');
  ell(c, 0.22, -0.45, 0.08, 0.08, 0, '#8a6b4e');
  ell(c, 0.225, -0.445, 0.045, 0.045, 0, '#d9a49a');
  ell(c, 0.48, -0.28, 0.025, 0.025, 0, '#4a2f2a');
  eye(c, 0.35, -0.34, 0.035);
  line(c, [-0.14, -0.02, -0.14, 0.0], '#6e523b', 0.06);
  line(c, [0.16, -0.02, 0.18, 0.0], '#6e523b', 0.06);
}

/** Ersatz-Bodenleben: Schnecke, Füße auf (0, 0). */
function paintSnail(c: CanvasRenderingContext2D): void {
  outline(c, 0.08, () => {
    c.moveTo(0.45, -0.06);
    c.ellipse(0.04, -0.06, 0.41, 0.07, 0, 0, TAU);
    c.moveTo(0.18, -0.32);
    c.arc(-0.06, -0.32, 0.24, 0, TAU);
  });
  ell(c, 0.04, -0.06, 0.41, 0.07, 0, '#c9b59a');
  line(c, [0.36, -0.08, 0.42, -0.26], '#b29e83', 0.035);
  line(c, [0.4, -0.08, 0.5, -0.22], '#b29e83', 0.035);
  ell(c, 0.42, -0.27, 0.025, 0.025, 0, '#4a3b2c');
  ell(c, 0.5, -0.23, 0.025, 0.025, 0, '#4a3b2c');
  ell(c, -0.06, -0.32, 0.24, 0.24, 0, '#b88a50');
  c.strokeStyle = '#7d5a32';
  c.lineWidth = 0.035;
  c.beginPath();
  for (let i = 0; i <= 30; i++) {
    const t = (i / 30) * TAU * 1.6;
    const r = 0.2 * (1 - i / 34);
    const x = -0.06 + Math.cos(t) * r;
    const y = -0.32 + Math.sin(t) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
  ell(c, -0.12, -0.44, 0.07, 0.035, -0.5, 'rgba(255, 240, 210, 0.45)');
}

/** Ersatz-Pilz: zwei Hutpilze, Fuß auf (0, 0). */
function paintMushroom(c: CanvasRenderingContext2D): void {
  const shroom = (x: number, s: number, cap: string) => {
    outline(c, 0.08, () => {
      c.rect(x - 0.07 * s, -0.36 * s, 0.14 * s, 0.36 * s);
      c.moveTo(x + 0.3 * s, -0.34 * s);
      c.ellipse(x, -0.34 * s, 0.3 * s, 0.22 * s, 0, Math.PI, TAU);
      c.closePath();
    });
    c.fillStyle = '#ece2cd';
    c.fillRect(x - 0.07 * s, -0.36 * s, 0.14 * s, 0.36 * s);
    c.fillStyle = cap;
    c.beginPath();
    c.ellipse(x, -0.34 * s, 0.3 * s, 0.22 * s, 0, Math.PI, TAU);
    c.closePath();
    c.fill();
    ell(c, x - 0.09 * s, -0.47 * s, 0.1 * s, 0.045 * s, -0.3, 'rgba(255, 235, 200, 0.45)');
    line(c, [x - 0.27 * s, -0.33 * s, x + 0.27 * s, -0.33 * s], '#d8c6a4', 0.03 * s);
  };
  shroom(-0.2, 0.7, '#b98a3e');
  shroom(0.08, 1, '#9c5b34');
}

/** Ersatz-Pilz an der Rinde: Baumschwamm-Konsolen, wachsen von (0, 0) nach rechts. */
function paintBracket(c: CanvasRenderingContext2D): void {
  c.translate(-0.16, 0);
  const shelf = (y: number, s: number) => {
    outline(c, 0.08, () => {
      c.moveTo(0, y);
      c.ellipse(0, y, 0.4 * s, 0.17 * s, 0, -Math.PI / 2, Math.PI / 2);
      c.closePath();
    });
    c.fillStyle = '#7d6448';
    c.beginPath();
    c.ellipse(0, y, 0.4 * s, 0.17 * s, 0, -Math.PI / 2, Math.PI / 2);
    c.closePath();
    c.fill();
    c.fillStyle = '#b39a74';
    c.beginPath();
    c.ellipse(0, y - 0.03 * s, 0.34 * s, 0.1 * s, 0, -Math.PI / 2, Math.PI / 2);
    c.closePath();
    c.fill();
    line(c, [0, y + 0.12 * s, 0.32 * s, y + 0.06 * s], '#e8dcc2', 0.03);
  };
  shelf(-0.12, 1);
  shelf(0.16, 0.75);
}

// --- Deko an den Plätzen -----------------------------------------------------

/** Blumen und Gras am Waldsaum, Fuß auf (0, 0). */
function paintFlowers(c: CanvasRenderingContext2D): void {
  for (const [x, h, lean] of [
    [-0.3, 0.32, -0.12],
    [-0.12, 0.42, -0.05],
    [0.22, 0.38, 0.1],
    [0.36, 0.26, 0.14],
  ] as const) {
    poly(c, [x - 0.04, 0, x + lean, -h, x + 0.04, 0], '#5f9a40');
  }
  const flower = (x: number, y: number, petal: string, center: string, r: number) => {
    line(c, [x * 0.6, 0, x, y], '#4f8a38', 0.04);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - 0.3;
      ell(c, x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75, r * 0.55, r * 0.55, 0, petal);
    }
    ell(c, x, y, r * 0.45, r * 0.45, 0, center);
  };
  flower(-0.2, -0.46, '#f4f1ea', '#e8b93a', 0.11);
  flower(0.18, -0.62, '#d98fb4', '#f0d37a', 0.12);
  flower(0.04, -0.34, '#f2d65a', '#c98a2a', 0.09);
}

/** Laubhäufchen, Mitte am Boden auf (0, 0). */
function paintLitter(c: CanvasRenderingContext2D): void {
  const leaves: [number, number, number, string][] = [
    [-0.42, 0.02, 0.4, '#a8763a'],
    [0.38, 0.02, -0.5, '#8e5d2e'],
    [-0.18, 0.04, -0.3, '#c08a3e'],
    [0.14, 0.05, 0.6, '#b0683a'],
    [0.0, 0.0, 0.1, '#9a6b34'],
    [-0.32, -0.02, -0.8, '#7e5a2e'],
    [0.3, -0.01, 0.9, '#c49a52'],
  ];
  for (const [x, y, rot, col] of leaves) {
    ell(c, x, y, 0.17, 0.065, rot * 0.4, col);
    line(c, [x - Math.cos(rot * 0.4) * 0.13, y - Math.sin(rot * 0.4) * 0.13, x + Math.cos(rot * 0.4) * 0.13, y + Math.sin(rot * 0.4) * 0.13], 'rgba(60,40,20,0.35)', 0.02);
  }
}

/** Erdhöhle im Wurzelraum, Mitte auf (0, 0). */
function paintBurrow(c: CanvasRenderingContext2D): void {
  ell(c, 0, 0.02, 0.62, 0.27, 0, 'rgba(36, 24, 15, 0.5)');
  ell(c, 0, 0.06, 0.55, 0.2, 0, 'rgba(28, 18, 11, 0.45)');
  ell(c, 0, 0.21, 0.42, 0.05, 0, 'rgba(165, 138, 108, 0.25)');
}

/** Baumhöhle (Rückseite), Boden der Öffnung auf (0, 0). */
function paintHollow(c: CanvasRenderingContext2D): void {
  ell(c, 0, -0.36, 0.36, 0.45, 0, '#4a321f');
  ell(c, 0, -0.35, 0.29, 0.38, 0, '#1f150d');
  ell(c, 0.05, -0.3, 0.2, 0.3, 0, '#2b1d12');
}

/** Unterer Rand der Baumhöhle – liegt vor dem Tier. */
function paintHollowLip(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#5e4129';
  c.beginPath();
  c.ellipse(0, -0.36, 0.36, 0.45, 0, 0.12 * Math.PI, 0.88 * Math.PI);
  c.ellipse(0, 0.0, 0.3, 0.1, 0, Math.PI * 0.95, Math.PI * 0.05, true);
  c.closePath();
  c.fill();
  line(c, [-0.24, -0.02, 0, 0.03, 0.24, -0.02], '#866244', 0.05);
}

/** Pilzgeflecht unter einem Pilz, von (0, 0) nach unten. */
function paintMycel(c: CanvasRenderingContext2D): void {
  c.globalAlpha = 0.6;
  for (const [x2, y2, bx] of [
    [-0.55, 0.7, -0.1],
    [-0.2, 0.95, 0.12],
    [0.15, 0.85, -0.12],
    [0.5, 0.65, 0.15],
    [0.75, 0.35, 0.3],
    [-0.75, 0.3, -0.3],
  ] as const) {
    c.strokeStyle = '#efe6cf';
    c.lineWidth = 0.025;
    c.beginPath();
    c.moveTo(0, 0.02);
    c.quadraticCurveTo(bx, y2 * 0.5, x2, y2);
    c.stroke();
  }
  c.globalAlpha = 1;
}

const DEFS: Record<string, SpriteDef> = {
  robin: { x0: -0.72, y0: -0.95, x1: 0.58, y1: 0.08, paint: (c) => paintBird(c, BIRD_ROBIN) },
  bluetit: { x0: -0.72, y0: -0.95, x1: 0.58, y1: 0.08, paint: (c) => paintBird(c, BIRD_BLUETIT) },
  bird: { x0: -0.72, y0: -0.95, x1: 0.58, y1: 0.08, paint: (c) => paintBird(c, BIRD_GENERIC) },
  woodpecker: { x0: -0.45, y0: -0.7, x1: 0.32, y1: 0.8, paint: (c) => paintWoodpecker(c) },
  bee: { x0: -0.45, y0: -0.42, x1: 0.48, y1: 0.28, paint: paintBee },
  oakmoth: { x0: -0.56, y0: -0.56, x1: 0.52, y1: 0.06, paint: paintOakmoth },
  barkbeetle: { x0: -0.8, y0: -0.26, x1: 0.44, y1: 0.26, paint: paintBarkbeetle },
  earthworm: { x0: -0.62, y0: -0.2, x1: 0.62, y1: 0.2, paint: paintEarthworm },
  woodlouse: { x0: -0.46, y0: -0.34, x1: 0.58, y1: 0.06, paint: paintWoodlouse },
  centipede: { x0: -0.68, y0: -0.3, x1: 0.62, y1: 0.06, paint: paintCentipede },
  insect: { x0: -0.32, y0: -0.34, x1: 0.48, y1: 0.06, paint: paintInsect },
  mammal: { x0: -0.68, y0: -0.6, x1: 0.56, y1: 0.06, paint: (c) => paintMammal(c) },
  snail: { x0: -0.36, y0: -0.62, x1: 0.56, y1: 0.06, paint: (c) => paintSnail(c) },
  mushroom: { x0: -0.48, y0: -0.62, x1: 0.44, y1: 0.06, paint: (c) => paintMushroom(c) },
  bracket: { x0: -0.22, y0: -0.36, x1: 0.3, y1: 0.36, paint: (c) => paintBracket(c) },
  // Deko
  flowers: { x0: -0.42, y0: -0.8, x1: 0.48, y1: 0.06, paint: (c) => paintFlowers(c) },
  litter: { x0: -0.64, y0: -0.12, x1: 0.6, y1: 0.14, paint: (c) => paintLitter(c) },
  burrow: { x0: -0.66, y0: -0.28, x1: 0.66, y1: 0.32, paint: (c) => paintBurrow(c) },
  hollow: { x0: -0.4, y0: -0.84, x1: 0.4, y1: 0.06, paint: (c) => paintHollow(c) },
  hollowLip: { x0: -0.4, y0: -0.84, x1: 0.4, y1: 0.12, paint: (c) => paintHollowLip(c) },
  mycel: { x0: -0.8, y0: -0.04, x1: 0.8, y1: 1.0, paint: (c) => paintMycel(c) },
};

/** Sprite-Cache je Art, Frame, Variante, Größe und Pixeldichte. */
export class SpriteCache {
  private sprites = new Map<string, Sprite>();

  get(kind: string, frame: number, muted: boolean, size: number, dpr: number): Sprite {
    const px = Math.max(4, Math.round(size));
    const key = `${kind}/${frame}/${muted ? 1 : 0}/${px}/${dpr}`;
    let s = this.sprites.get(key);
    if (!s) {
      // Sicherheitsnetz: nie unbegrenzt viele Sprites ansammeln.
      if (this.sprites.size > 400) this.sprites.clear();
      s = muted ? desaturate(this.get(kind, frame, false, size, dpr)) : renderSprite(DEFS[kind] ?? DEFS.insect!, frame, px, dpr);
      this.sprites.set(key, s);
    }
    return s;
  }

  /** Alte Größen verwerfen (z. B. nach einer Größenänderung). */
  clear(): void {
    this.sprites.clear();
  }

  get count(): number {
    return this.sprites.size;
  }
}

function renderSprite(def: SpriteDef, frame: number, size: number, dpr: number): Sprite {
  const pad = 1.5 / dpr;
  const w = (def.x1 - def.x0) * size + pad * 2;
  const h = (def.y1 - def.y0) * size + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * dpr));
  canvas.height = Math.max(1, Math.ceil(h * dpr));
  const c = canvas.getContext('2d')!;
  const ox = -def.x0 * size + pad;
  const oy = -def.y0 * size + pad;
  c.setTransform(size * dpr, 0, 0, size * dpr, ox * dpr, oy * dpr);
  def.paint(c, frame);
  return { canvas, ox, oy, w: canvas.width / dpr, h: canvas.height / dpr };
}

/** Entsättigte, leicht aufgehellte Variante – „ruht und wirkt matter“. */
function desaturate(src: Sprite): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = src.canvas.width;
  canvas.height = src.canvas.height;
  const c = canvas.getContext('2d')!;
  c.drawImage(src.canvas, 0, 0);
  try {
    const img = c.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.3 * d[i]! + 0.59 * d[i + 1]! + 0.11 * d[i + 2]!;
      d[i] = l + (d[i]! - l) * 0.5 + 12;
      d[i + 1] = l + (d[i + 1]! - l) * 0.5 + 12;
      d[i + 2] = l + (d[i + 2]! - l) * 0.5 + 10;
    }
    c.putImageData(img, 0, 0);
  } catch {
    // Ohne Pixelzugriff bleibt die Variante unverändert.
  }
  return { ...src, canvas };
}

// ---------------------------------------------------------------------------
// Zeichnen pro Frame
// ---------------------------------------------------------------------------

export interface AnimalFrame {
  time: number;
  /** Scherfaktor des Hauptbaums (Wind); Tiere am Baum werden mitverschoben. */
  windSkew: number;
  reducedMotion: boolean;
  dpr: number;
  /** Zusätzliche Skalierung (z. B. altes Bild während einer Größenänderung). */
  sx: number;
  sy: number;
}

const NICHE_ORDER: Record<string, number> = { roots: 0, litter: 1, edge: 2, bark: 3, hollows: 4, crown: 5 };

/** Zeichnet alle Tiere. Der Kontext wird in Gerätepixeln angesprochen (eigene Transformationen). */
export function drawAnimals(
  ctx: CanvasRenderingContext2D,
  animals: readonly SceneAnimal[],
  anchors: AnchorResolver,
  sprites: SpriteCache,
  f: AnimalFrame,
): void {
  if (animals.length === 0) return;
  const list = animals.length > 1 ? [...animals].sort((a, b) => (NICHE_ORDER[a.niche] ?? 9) - (NICHE_ORDER[b.niche] ?? 9)) : animals;
  for (const animal of list) {
    const anchor = anchors.get(animal.niche, animal.slot);
    if (anchor) drawAnimal(ctx, animal, anchor, anchors, sprites, f);
  }
  ctx.globalAlpha = 1;
}

interface Pose {
  x: number;
  y: number;
  /** Blickrichtung: 1 = rechts, −1 = links. */
  dir: number;
  /** Drehung (rad), z. B. −π/2 für Krabbeln den Stamm hinauf. */
  rot: number;
  scale: number;
  frame: number;
}

function drawAnimal(
  ctx: CanvasRenderingContext2D,
  animal: SceneAnimal,
  anchor: NicheAnchor,
  anchors: AnchorResolver,
  sprites: SpriteCache,
  f: AnimalFrame,
): void {
  const kind = animalKind(animal);
  const info = KINDS[kind] ?? KINDS.insect!;
  const S = anchors.size;
  const groundY = anchors.layout.groundY;
  const happy = clamp01(Number.isFinite(animal.happiness) ? animal.happiness : 0.5);
  const act = f.reducedMotion ? 0 : smooth01((happy - 0.2) / 0.6);
  const muted = 1 - smooth01((happy - 0.15) / 0.3);
  const seed = hash2(hashString(animal.id), anchor.slot * 31 + (NICHE_ORDER[anchor.niche] ?? 0));
  const phase = (seed & 1023) / 97;
  const t = f.time;
  const size = S * info.size;

  // Mit dem Baum im Wind schwingen (gleiche Scherung wie die Baumebene).
  const wx = anchor.onTree ? f.windSkew * (anchor.y - groundY) : 0;
  const ax = anchor.x + wx;
  const ay = anchor.y;

  const pose: Pose = { x: ax, y: ay, dir: anchor.side === 1 ? -1 : 1, rot: 0, scale: 1, frame: 0 };
  const decoBefore: [string, number, number, number][] = [];
  const decoAfter: [string, number, number, number][] = [];
  const niche = anchor.niche;
  const isFungus = kind === 'mushroom' || kind === 'bracket';
  let travel = 0; // Bewegungsspielraum (px) beim Krabbeln
  let vertical = false;

  if (isFungus) {
    if (kind === 'bracket') {
      pose.x = anchor.x + wx;
      pose.dir = anchor.side;
    } else if (niche === 'roots') {
      // Fruchtkörper an der Oberfläche, Geflecht reicht hinab zu den Wurzeln.
      pose.x = anchor.surfaceX;
      pose.y = groundY + 1;
      decoBefore.push(['mycel', anchor.surfaceX, groundY + 1, size * 1.1]);
      pose.dir = anchor.side;
    } else {
      pose.dir = anchor.side;
    }
  } else {
    switch (niche) {
      case 'roots':
        decoBefore.push(['burrow', ax, ay, S]);
        pose.y = ay + S * 0.12;
        travel = S * 0.18;
        if (kind === 'earthworm') pose.y = ay + S * 0.06;
        else if (kind === 'woodpecker') pose.rot = 0;
        break;
      case 'litter':
        decoBefore.push(['litter', ax, ay, S]);
        travel = S * 0.4;
        if (kind === 'earthworm') pose.y = ay - S * 0.04;
        break;
      case 'edge':
        decoBefore.push(['flowers', ax, ay, S * 1.15]);
        if (info.motion === 'hover') {
          pose.y = ay - S * 1.15;
        } else if (kind === 'insect' || kind === 'oakmoth' || kind === 'barkbeetle') {
          pose.y = ay - S * 0.72;
          pose.x = ax + S * 0.21;
        } else {
          pose.x = ax + anchor.side * S * 0.55;
          travel = S * 0.3;
        }
        break;
      case 'crown':
        travel = S * 0.12;
        if (info.motion === 'hover') pose.y = ay - S * 0.3;
        break;
      case 'bark':
        if (info.cling) {
          pose.dir = -anchor.side;
        } else if (info.motion === 'hop' || info.motion === 'sniff') {
          pose.dir = anchor.side;
        } else {
          // Krabbler laufen auf der Rinde den Stamm hinauf.
          vertical = true;
          pose.x = anchor.trunkX + wx + anchor.side * anchor.trunkHalf * 0.35;
          pose.rot = -Math.PI / 2;
          travel = Math.min(S * 0.35, anchor.trunkHalf * 3);
        }
        break;
      case 'hollows': {
        // Die Höhle passt sich dem (anfangs schmalen) Stamm an; in Zehntelschritten,
        // damit nur wenige Sprite-Größen entstehen.
        const fit = Math.round(clamp((anchor.trunkHalf * 2.5) / (0.72 * S), 0.6, 1) * 10) / 10;
        decoBefore.push(['hollow', ax, ay, S * fit]);
        decoAfter.push(['hollowLip', ax, ay, S * fit]);
        pose.y = ay - S * 0.06 * fit;
        pose.scale = 0.78 * fit;
        pose.dir = anchor.side;
        break;
      }
    }
  }

  animate(info, pose, act, t, phase, seed, travel, vertical, S, niche, f.reducedMotion);
  if (pose.frame >= info.frames) pose.frame = 0;

  for (const [name, x, y, s] of decoBefore) blit(ctx, sprites.get(name, 0, false, s, f.dpr), x, y, 1, 0, 1, f);
  const spriteSize = size * pose.scale;
  if (muted < 0.99) {
    blit(ctx, sprites.get(kind, pose.frame, false, spriteSize, f.dpr), pose.x, pose.y, pose.dir, pose.rot, 1, f);
  }
  if (muted > 0.01) {
    blit(ctx, sprites.get(kind, pose.frame, true, spriteSize, f.dpr), pose.x, pose.y, pose.dir, pose.rot, muted < 0.99 ? muted : 1, f);
  }
  for (const [name, x, y, s] of decoAfter) blit(ctx, sprites.get(name, 0, false, s, f.dpr), x, y, 1, 0, 1, f);
}

/** Bewegung als günstige Verschiebung/Spiegelung; Stärke folgt der Zufriedenheit. */
function animate(
  info: KindInfo,
  pose: Pose,
  act: number,
  t: number,
  phase: number,
  seed: number,
  travel: number,
  vertical: boolean,
  S: number,
  niche: string,
  reduced: boolean,
): void {
  if (reduced || act <= 0.01) {
    if (info.motion === 'hover' && niche === 'edge') pose.y += S * 0.43; // ruht auf der Blüte
    return;
  }
  switch (info.motion) {
    case 'hop':
    case 'sniff': {
      const period = 7 - 4.2 * act;
      const u = t / period + phase;
      const n = Math.floor(u);
      const local = (u - n) * period;
      const dur = info.motion === 'hop' ? 0.34 : 0.5;
      if (local < dur) {
        const amp = info.motion === 'hop' ? 0.17 : 0.05;
        pose.y -= Math.sin((local / dur) * Math.PI) * S * amp * act;
      }
      // Ab und zu umdrehen (beim Hüpfen).
      if (niche !== 'hollows' && (hash2(seed, n) & 3) === 0) pose.dir = -pose.dir;
      break;
    }
    case 'peck': {
      const period = 4.5 - 2 * act;
      const local = ((t / period + phase) % 1) * period;
      if (local < 0.8) pose.x += pose.dir * S * 0.07 * Math.max(0, Math.sin(local * TAU * 5));
      break;
    }
    case 'hover': {
      const w = 1.3;
      const p = t * w + phase;
      pose.x += S * 0.32 * act * Math.sin(p);
      pose.y += S * 0.14 * act * Math.sin(p * 2);
      pose.dir = Math.cos(p) >= 0 ? 1 : -1;
      pose.frame = Math.floor(t * 14) % 2;
      break;
    }
    case 'crawl':
    case 'inch':
    case 'wiggle': {
      const slow = info.motion === 'crawl' ? 0.55 : 0.3;
      const p = t * slow + phase;
      const off = travel * act * Math.sin(p);
      const vel = Math.cos(p);
      if (vertical) pose.y -= off;
      else pose.x += off;
      if (travel > 0 && Math.abs(vel) > 0.15) {
        if (vertical) pose.dir = vel >= 0 ? 1 : -1;
        else pose.dir = vel >= 0 ? 1 : -1;
        const rate = info.motion === 'crawl' ? 8 : info.motion === 'inch' ? 1.6 : 2.4;
        pose.frame = Math.floor(t * rate) % 2;
      } else if (info.motion === 'wiggle') {
        pose.frame = Math.floor(t * 2) % 2;
      }
      break;
    }
    case 'still':
      break;
  }
}

/** Ein Sprite an (x, y) [CSS-px] zeichnen – gespiegelt (dir) und gedreht (rot). */
function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, dir: number, rot: number, alpha: number, f: AnimalFrame): void {
  const k = f.dpr;
  const cos = rot === 0 ? 1 : Math.cos(rot);
  const sin = rot === 0 ? 0 : Math.sin(rot);
  // Gerät = Skalierung(sx, sy) · dpr · Verschiebung(x, y) · Drehung · Spiegelung(dir)
  const a = f.sx * k * cos * dir;
  const b = f.sy * k * sin * dir;
  const c = -f.sx * k * sin;
  const d = f.sy * k * cos;
  let e = f.sx * k * x;
  let fy = f.sy * k * y;
  if (rot === 0 && dir === 1 && f.sx === 1 && f.sy === 1) {
    // Auf Gerätepixel runden – schärfer bei ruhenden Tieren.
    e = Math.round(e - s.ox * k) + s.ox * k;
    fy = Math.round(fy - s.oy * k) + s.oy * k;
  }
  ctx.globalAlpha = alpha;
  ctx.setTransform(a, b, c, d, e, fy);
  ctx.drawImage(s.canvas, -s.ox, -s.oy, s.w, s.h);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
