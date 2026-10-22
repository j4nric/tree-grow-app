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

import { POND_DEPTH, POND_LIP, POND_WATER_Y, type AnchorResolver, type NicheAnchor } from './anchors';
import { batFlight, batFlying, nightWake, nocturnalPace, owlPose, paintBatFly } from './nocturnal';
import { amphibianActivity, edgeBare, edgePetals, edgeSeedHeads, fireflySeason, insectActivity, pondIce } from './phenology';
import { ell, eye, line, OUTLINE, outline, paintBird, poly, TAU, type BirdColors, type SpriteDef } from './sprite-kit';
import { SPECIES_DEFS, SPECIES_INFO, type KindInfo } from './species-sprites';
import { clamp, clamp01, hash2, smooth01 } from './util';
import { VISITOR_DEFS } from './visitor-sprites';

export type AnimalFamily = 'birds' | 'insects' | 'mammals' | 'soil' | 'fungi' | 'amphibians' | 'reptiles';

/** Ein Tier, wie es der Renderer bekommt (unabhängig vom Spielkern). */
export interface SceneAnimal {
  /** Art-ID, z. B. 'robin'. Unbekannte Arten bekommen die Zeichnung ihrer Gattung. */
  id: string;
  family: AnimalFamily;
  /** Nische: 'roots' | 'litter' | 'edge' | 'crown' | 'bark' | 'hollows' | 'pond' (sonst nicht gezeichnet). */
  niche: string;
  /** Platz in der Nische, 0..n. */
  slot: number;
  /** Zufriedenheit 0–1. */
  happiness: number;
  /**
   * Seltenheit 0 gewöhnlich · 1 selten · 2 besonders · 3 legendär (optional).
   * Ohne Angabe gilt die Seltenheit der bekannten Art aus DESIGN_V2.md, sonst 0.
   * Besondere Arten schimmern dezent, legendäre zusätzlich mit kleinen Funken.
   */
  rarity?: number;
}

// ---------------------------------------------------------------------------
// Arten → Zeichnung und Verhalten
// ---------------------------------------------------------------------------

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
  // Gattungs-Ersatz für unbekannte Arten
  bird: { size: 1, motion: 'hop', frames: 1 },
  insect: { size: 0.9, motion: 'crawl', frames: 2 },
  mammal: { size: 1.1, motion: 'sniff', frames: 1 },
  snail: { size: 1, motion: 'crawl', frames: 1 },
  mushroom: { size: 1, motion: 'still', frames: 1, fungus: 'cap' },
  bracket: { size: 1, motion: 'still', frames: 1, fungus: 'bracket' },
  // Eigene Zeichnungen aller weiteren Arten (species-sprites.ts)
  ...SPECIES_INFO,
};

/** Art-ID (src/content/species.ts) → Zeichnung. */
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
  snail: 'snail',
  ...Object.fromEntries(Object.keys(SPECIES_INFO).map((k) => [k, k])),
};

const FAMILY_KIND: Record<AnimalFamily, string> = {
  birds: 'bird',
  insects: 'insect',
  mammals: 'mammal',
  soil: 'snail',
  fungi: 'mushroom',
  amphibians: 'toad',
  // Platzhalter bis zur eigenen Ersatzzeichnung (Eidechse, DESIGN_V2.md 23.7 Nr. 4).
  reptiles: 'toad',
};

/** Seltenheit der bekannten Arten (DESIGN_V2.md 5.3), falls `rarity` fehlt – nur ab „besonders“. */
const SPECIES_RARITY: Record<string, number> = {
  owl: 2,
  glowworm: 2,
  bat: 2,
  snail: 2,
  flyagaric: 2,
  blackwoodpecker: 3,
  stagbeetle: 3,
  wolf: 3,
  salamander: 3,
  honeyfungus: 3,
};

/** Alle Zeichnungen (Arten und Ersatz) – z. B. für eine Übersicht in der Demo. */
export function animalKinds(): string[] {
  return Object.keys(KINDS);
}

/** Welche Zeichnung bekommt ein Tier? (Art, sonst Gattung; Hutpilze an der Rinde als Konsolen.) */
export function animalKind(a: Pick<SceneAnimal, 'id' | 'family' | 'niche'>): string {
  const kind = SPECIES_KIND[a.id] ?? FAMILY_KIND[a.family] ?? 'insect';
  const fungus = KINDS[kind]?.fungus;
  const onWood = a.niche === 'bark' || a.niche === 'hollows';
  if (fungus === 'cap' && onWood) return 'bracket';
  if (fungus === 'bracket' && !onWood) return 'mushroom';
  return kind;
}

/** Ab dieser Zeichengröße (Vielfaches der Tiergröße) gilt ein Tier als Großtier (Reh, Fuchs, Wolf). */
const LARGE_ANIMAL_SIZE = 1.5;

/** Ist das Tier ein Großtier (z. B. Reh, Fuchs, Wolf)? Gäste weichen ihm am Waldsaum aus. */
export function isLargeAnimal(a: Pick<SceneAnimal, 'id' | 'family' | 'niche'>): boolean {
  return (KINDS[animalKind(a)]?.size ?? 1) >= LARGE_ANIMAL_SIZE;
}

/** Seltenheit für den Schimmer (0–3). */
export function animalRarity(a: Pick<SceneAnimal, 'id' | 'rarity'>): number {
  const r = a.rarity ?? SPECIES_RARITY[a.id] ?? 0;
  return Number.isFinite(r) ? Math.max(0, Math.min(3, Math.floor(r))) : 0;
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Versatz und Größe in CSS-Pixeln relativ zum Ankerpunkt. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** Generation des letzten Abrufs (SpriteCache). */
  used: number;
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

/** Blüten am Waldsaum: Lage (x, y), Blütenblatt, Mitte, Radius. */
const EDGE_FLOWERS: readonly (readonly [number, number, string, string, number])[] = [
  [-0.2, -0.46, '#f4f1ea', '#e8b93a', 0.11],
  [0.18, -0.62, '#d98fb4', '#f0d37a', 0.12],
  [0.04, -0.34, '#f2d65a', '#c98a2a', 0.09],
];

/** Blumen und Gras am Waldsaum (Sommer: Grün und Blüten), Fuß auf (0, 0). */
function paintFlowers(c: CanvasRenderingContext2D): void {
  paintEdgeGreen(c);
  paintEdgePetals(c);
}

/** Grüne Halme und Stängel der Waldsaum-Blumen (ohne Blüten). */
function paintEdgeGreen(c: CanvasRenderingContext2D): void {
  for (const [x, h, lean] of [
    [-0.3, 0.32, -0.12],
    [-0.12, 0.42, -0.05],
    [0.22, 0.38, 0.1],
    [0.36, 0.26, 0.14],
  ] as const) {
    poly(c, [x - 0.04, 0, x + lean, -h, x + 0.04, 0], '#5f9a40');
  }
  for (const [x, y] of EDGE_FLOWERS) line(c, [x * 0.6, 0, x, y], '#4f8a38', 0.04);
}

/** Nur die Blüten (Frühling und Sommer). */
function paintEdgePetals(c: CanvasRenderingContext2D): void {
  for (const [x, y, petal, center, r] of EDGE_FLOWERS) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - 0.3;
      ell(c, x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75, r * 0.55, r * 0.55, 0, petal);
    }
    ell(c, x, y, r * 0.45, r * 0.45, 0, center);
  }
}

/** Verblühte Samenstände (Herbst): kleine braune Köpfe, einer als Pusteblume. */
function paintEdgeSeeds(c: CanvasRenderingContext2D): void {
  const [fx, fy, , , fr] = EDGE_FLOWERS[0]!;
  // Pusteblume: helle Schirmchen um einen kleinen Kopf.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    line(c, [fx, fy, fx + Math.cos(a) * fr * 1.05, fy + Math.sin(a) * fr * 1.05], 'rgba(236, 230, 214, 0.85)', 0.012);
    ell(c, fx + Math.cos(a) * fr * 1.1, fy + Math.sin(a) * fr * 1.1, fr * 0.16, fr * 0.16, 0, 'rgba(244, 240, 228, 0.9)');
  }
  ell(c, fx, fy, fr * 0.3, fr * 0.3, 0, '#9a7a4c');
  for (const [x, y, , , r] of EDGE_FLOWERS.slice(1)) {
    // Vertrocknete Köpfe, leicht nickend.
    ell(c, x, y + r * 0.2, r * 0.5, r * 0.62, 0.2, '#7d5f3a');
    ell(c, x - r * 0.12, y + r * 0.05, r * 0.22, r * 0.26, 0.2, '#a8875a');
    line(c, [x - r * 0.5, y - r * 0.1, x - r * 0.8, y + r * 0.45], '#8a6a42', 0.02);
    line(c, [x + r * 0.5, y - r * 0.1, x + r * 0.8, y + r * 0.45], '#8a6a42', 0.02);
  }
}

/** Winter: dürre, geknickte Halme und eine flache grüne Blattrosette am Boden. */
function paintEdgeBare(c: CanvasRenderingContext2D): void {
  for (const [x, h, lean, col] of [
    [-0.32, 0.3, -0.16, '#a08656'],
    [-0.14, 0.42, -0.1, '#8c7247'],
    [0.08, 0.34, 0.04, '#a88f5e'],
    [0.22, 0.38, 0.14, '#94794b'],
    [0.38, 0.24, 0.2, '#a08656'],
  ] as const) {
    poly(c, [x - 0.03, 0, x + lean, -h, x + 0.03, 0], col);
  }
  // Abgeknickte Stängel der Blumen vom Sommer.
  for (const [x, y] of EDGE_FLOWERS) {
    const mx = x * 0.8;
    const my = y * 0.55;
    line(c, [x * 0.6, 0, mx, my, mx + 0.1 * Math.sign(x || 1), my + 0.08], '#7e6440', 0.035);
  }
  // Rosette: kleine, dunkelgrüne Blätter flach am Boden.
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 5) * Math.PI;
    ell(c, 0.02 + Math.cos(a) * 0.1, -0.02 + Math.sin(a) * 0.05, 0.1, 0.035, a, i & 1 ? '#3f6a34' : '#4c7b3c');
  }
  ell(c, 0.02, -0.03, 0.03, 0.025, 0, '#5d8c45');
}

/** Weicher Lichtschein des Glühwürmchens (eigenes Sprite, folgt der Jahreszeit). */
function paintGlowHalo(c: CanvasRenderingContext2D): void {
  const glow = c.createRadialGradient(0, 0, 0, 0, 0, 0.55);
  glow.addColorStop(0, 'rgba(236, 255, 150, 0.9)');
  glow.addColorStop(0.3, 'rgba(210, 245, 120, 0.4)');
  glow.addColorStop(1, 'rgba(200, 240, 110, 0)');
  c.fillStyle = glow;
  c.beginPath();
  c.arc(0, 0, 0.55, 0, TAU);
  c.fill();
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

/**
 * Mulde des Tümpels: steile Ränder, flacher Grund – so ist das Wasser fast auf der ganzen
 * Breite tief genug für Molche. `inset` rückt den Umriss nach innen (Schlammrand, Eis).
 */
function pondBowl(c: CanvasRenderingContext2D, rx: number, inset: number): void {
  const x = rx - inset;
  const d = POND_DEPTH - inset * 0.6;
  const run = Math.min(1.4, x * 0.6);
  c.beginPath();
  c.moveTo(-x, POND_LIP);
  c.bezierCurveTo(-x + 0.04, d - 0.08, -x + run * 0.6, d, -x + run, d);
  c.lineTo(x - run, d);
  c.bezierCurveTo(x - run * 0.6, d, x - 0.04, d - 0.08, x, POND_LIP);
  c.closePath();
}

/**
 * Waldtümpel im Erdschnitt, ganz unter der Grasnarbe (anchors.ts): Senke ab POND_LIP,
 * Wasser ab POND_WATER_Y, Seggen nur in der Senke. Mitte der Bodenlinie auf (0, 0),
 * halbe Breite `rx` (Tiergrößen, je Canvas-Größe: `PondGeometry.halfWidth`).
 */
function paintPond(c: CanvasRenderingContext2D, rx: number): void {
  const lip = POND_LIP;
  const water = POND_WATER_Y;
  // Schlammrand, darin die Mulde (über dem Wasser etwas heller: feuchte Erde im Schatten).
  c.fillStyle = '#3f3022';
  pondBowl(c, rx, 0);
  c.fill();
  c.save();
  pondBowl(c, rx, 0.1);
  c.clip();
  c.fillStyle = '#5a4733';
  c.fillRect(-rx, lip, rx * 2, water - lip);
  const g = c.createLinearGradient(0, water, 0, POND_DEPTH);
  g.addColorStop(0, '#6e9c94');
  g.addColorStop(1, '#2e4b4f');
  c.fillStyle = g;
  c.fillRect(-rx, water, rx * 2, POND_DEPTH - water);
  // Lichtreflexe und abgesunkenes Laub am Grund (verteilt über die Breite)
  ell(c, -0.26 * rx, water + 0.1, 0.24 * rx, 0.022, 0, 'rgba(225, 245, 240, 0.35)');
  ell(c, 0.32 * rx, water + 0.2, 0.16 * rx, 0.018, 0, 'rgba(225, 245, 240, 0.25)');
  ell(c, -0.13 * rx, POND_DEPTH - 0.1, 0.14, 0.04, 0.3, 'rgba(120, 84, 44, 0.6)');
  ell(c, 0.18 * rx, POND_DEPTH - 0.11, 0.12, 0.035, -0.4, 'rgba(140, 98, 50, 0.55)');
  if (rx > 2.5) ell(c, -0.55 * rx, POND_DEPTH - 0.12, 0.1, 0.03, 0.5, 'rgba(120, 84, 44, 0.5)');
  line(c, [-rx, water, rx, water], 'rgba(220, 240, 236, 0.75)', 0.03);
  // Seggen und ein Rohrkolben am Ufer – wachsen aus dem Wasser, enden unter der Narbe.
  for (const [dx, h, lean] of [
    [-0.35, 0.26, -0.06],
    [-0.45, 0.2, 0.05],
    [0.48, 0.22, -0.06],
    [0.38, 0.27, 0.05],
  ] as const) {
    const x = dx < 0 ? -rx - dx : rx - dx;
    poly(c, [x - 0.025, water + 0.02, x + lean, water - h, x + 0.025, water + 0.02], '#5f8a3e');
  }
  const cat = rx - 0.6;
  line(c, [cat, water + 0.02, cat - 0.01, lip + 0.05], '#6b8a42', 0.025);
  ell(c, cat - 0.01, lip + 0.1, 0.035, 0.07, 0, '#6b4a2b');
  c.restore();
}

/** Eisdecke des Tümpels (Winter), gleiche Maße wie `paintPond`. */
function paintPondIce(c: CanvasRenderingContext2D, rx: number): void {
  c.save();
  pondBowl(c, rx, 0.1);
  c.clip();
  c.fillStyle = 'rgba(222, 236, 244, 0.9)';
  c.fillRect(-rx, POND_WATER_Y - 0.03, rx * 2, 0.12);
  c.fillStyle = 'rgba(190, 214, 228, 0.35)';
  c.fillRect(-rx, POND_WATER_Y + 0.09, rx * 2, POND_DEPTH);
  c.restore();
  const k = rx / 1.9;
  line(c, [-1.1 * k, POND_WATER_Y + 0.02, -0.6 * k, POND_WATER_Y + 0.04], 'rgba(255, 255, 255, 0.8)', 0.02);
  line(c, [0.3 * k, POND_WATER_Y + 0.03, 0.8 * k, POND_WATER_Y + 0.02], 'rgba(255, 255, 255, 0.8)', 0.02);
}

/** Flaches Wasser vor Kröte und Frosch: Ihre Füße stehen im Tümpel. Wasserlinie auf (0, 0). */
function paintPondWade(c: CanvasRenderingContext2D): void {
  c.fillStyle = 'rgba(110, 156, 148, 0.6)';
  c.beginPath();
  c.ellipse(0, 0, 0.45, 0.15, 0, 0, Math.PI);
  c.closePath();
  c.fill();
  line(c, [-0.42, 0, 0.42, 0], 'rgba(220, 240, 236, 0.75)', 0.03);
}

/** Halbe Breite des Wassers vor Kröte und Frosch (Zeicheneinheiten, wie `pondWade`). */
const WADE_HALF = 0.48;

/**
 * Sprite-Name des Tümpels (bzw. seiner Eisdecke) für die halbe Breite `rx` – die Zeichnung
 * wird beim ersten Abruf angelegt. Je Canvas-Größe gibt es nur eine Breite.
 */
function pondSpriteName(ice: boolean, rx: number): string {
  const name = `${ice ? 'pondIce' : 'pond'}@${rx}`;
  if (!DEFS[name]) {
    DEFS[name] = ice
      ? { x0: -rx - 0.02, y0: 0.22, x1: rx + 0.02, y1: 1.04, paint: (c) => paintPondIce(c, rx) }
      : { x0: -rx - 0.02, y0: 0.22, x1: rx + 0.02, y1: 1.04, paint: (c) => paintPond(c, rx) };
  }
  return name;
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
  edgeGreen: { x0: -0.42, y0: -0.8, x1: 0.48, y1: 0.06, paint: (c) => paintEdgeGreen(c) },
  edgePetals: { x0: -0.42, y0: -0.8, x1: 0.48, y1: 0.06, paint: (c) => paintEdgePetals(c) },
  edgeSeeds: { x0: -0.42, y0: -0.8, x1: 0.48, y1: 0.06, paint: (c) => paintEdgeSeeds(c) },
  edgeBare: { x0: -0.42, y0: -0.8, x1: 0.48, y1: 0.06, paint: (c) => paintEdgeBare(c) },
  glowHalo: { x0: -0.56, y0: -0.56, x1: 0.56, y1: 0.56, paint: (c) => paintGlowHalo(c) },
  litter: { x0: -0.64, y0: -0.12, x1: 0.6, y1: 0.14, paint: (c) => paintLitter(c) },
  burrow: { x0: -0.66, y0: -0.28, x1: 0.66, y1: 0.32, paint: (c) => paintBurrow(c) },
  hollow: { x0: -0.4, y0: -0.84, x1: 0.4, y1: 0.06, paint: (c) => paintHollow(c) },
  hollowLip: { x0: -0.4, y0: -0.84, x1: 0.4, y1: 0.12, paint: (c) => paintHollowLip(c) },
  mycel: { x0: -0.8, y0: -0.04, x1: 0.8, y1: 1.0, paint: (c) => paintMycel(c) },
  pondWade: { x0: -WADE_HALF, y0: -0.04, x1: WADE_HALF, y1: 0.17, paint: (c) => paintPondWade(c) },
  shimmer: { x0: -1, y0: -1, x1: 1, y1: 1, paint: (c) => paintShimmer(c) },
  sparkle: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5, paint: (c) => paintSparkle(c) },
  // Braunes Langohr im Flug (nachts, nocturnal.ts)
  batFly: { x0: -0.72, y0: -0.4, x1: 0.72, y1: 0.3, paint: paintBatFly },
  ...SPECIES_DEFS,
  // Durchreisende (visitors.ts)
  ...VISITOR_DEFS,
};

/** Weicher, warmer Lichthof hinter besonderen und legendären Arten. */
function paintShimmer(c: CanvasRenderingContext2D): void {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(255, 248, 214, 0.85)');
  g.addColorStop(0.45, 'rgba(255, 240, 190, 0.35)');
  g.addColorStop(1, 'rgba(255, 236, 180, 0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 1, 0, TAU);
  c.fill();
}

/** Kleiner, vierzackiger Funke. */
function paintSparkle(c: CanvasRenderingContext2D): void {
  ell(c, 0, 0, 0.22, 0.22, 0, 'rgba(255, 244, 200, 0.45)');
  c.fillStyle = '#fff8dc';
  c.beginPath();
  c.moveTo(0, -0.48);
  c.quadraticCurveTo(0.05, -0.05, 0.48, 0);
  c.quadraticCurveTo(0.05, 0.05, 0, 0.48);
  c.quadraticCurveTo(-0.05, 0.05, -0.48, 0);
  c.quadraticCurveTo(-0.05, -0.05, 0, -0.48);
  c.fill();
}

/**
 * Sprite-Cache je Art, Frame, Variante, Größe und Pixeldichte.
 * Schlüssel: Art (String, ohne Neuanlage) → numerischer Schlüssel – pro Frame entstehen
 * keine neuen Strings.
 */
export class SpriteCache {
  private byKind = new Map<string, Map<number, Sprite>>();
  private total = 0;
  /** Generation (ein Frame): unbenutzte Sprites werden bei Überlauf zuerst verworfen. */
  private gen = 0;

  /** Neuer Frame – Sprites, die ab jetzt nicht mehr abgerufen werden, gelten als unbenutzt. */
  tick(): void {
    this.gen++;
  }

  get(kind: string, frame: number, muted: boolean, size: number, dpr: number): Sprite {
    const px = Math.max(4, Math.min(4095, Math.round(size)));
    const key = ((Math.round(dpr * 64) * 4096 + px) * 4 + (frame & 3)) * 2 + (muted ? 1 : 0);
    let map = this.byKind.get(kind);
    if (!map) {
      map = new Map();
      this.byKind.set(kind, map);
    }
    let s = map.get(key);
    if (!s) {
      // Sicherheitsnetz: nie unbegrenzt viele Sprites ansammeln.
      if (this.total >= MAX_SPRITES) {
        this.evict();
        return this.get(kind, frame, muted, size, dpr);
      }
      s = muted ? desaturate(this.get(kind, frame, false, size, dpr)) : renderSprite(DEFS[kind] ?? DEFS.insect!, frame, px, dpr);
      map.set(key, s);
      this.total++;
    }
    s.used = this.gen;
    return s;
  }

  /** Verwirft alle Sprites, die in diesem Frame nicht gebraucht wurden; notfalls alle. */
  private evict(): void {
    let removed = 0;
    for (const map of this.byKind.values()) {
      for (const [key, s] of map) {
        if (s.used < this.gen) {
          map.delete(key);
          removed++;
        }
      }
    }
    this.total -= removed;
    if (removed === 0) this.clear();
  }

  /** Alte Größen verwerfen (z. B. nach einer Größenänderung). */
  clear(): void {
    this.byKind.clear();
    this.total = 0;
  }

  get count(): number {
    return this.total;
  }
}

/** Höchstzahl gecachter Sprites. */
const MAX_SPRITES = 400;

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
  return { canvas, ox, oy, w: canvas.width / dpr, h: canvas.height / dpr, used: 0 };
}

/** Entsättigte, leicht aufgehellte Variante – „ruht und wirkt matter“. */
function desaturate(src: Sprite): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = src.canvas.width;
  canvas.height = src.canvas.height;
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
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
  /**
   * Ungerundete Jahreszeit 0–4 (`normalizeSeason`), null/fehlend = ohne Angabe (Sommerbild).
   * Daraus pro Frame (phenology.ts): Bewegung der Insekten (Winterruhe), Blumen am
   * Waldsaum (Blüte, Samenstände, dürre Halme) und das Leuchten der Glühwürmchen.
   */
  season?: number | null;
  /**
   * Nacht 0–1 (daylight.ts): Das Glühwürmchen leuchtet stärker, mit größerem Schein.
   * Ohne Angabe Tag.
   */
  night?: number;
  /**
   * Wachheit der Nachtarten 0 (Tag) – 1 (Nacht) aus der Tageszeit (nocturnal.ts): Kauz,
   * Fledermaus, Igel und Glühwürmchen nachts aktiver, tagsüber ruhiger. Ohne Angabe (keine
   * Tageszeit) wie bisher.
   */
  nocturnal?: number;
  /** Regen 0–1 (Wetter): löscht den Schein der Glühwürmchen. Ohne Angabe 0. */
  rain?: number;
  dpr: number;
  /** Zusätzliche Skalierung (z. B. altes Bild während einer Größenänderung, Kamera-Zoom). */
  sx: number;
  sy: number;
  /** Zusätzliche Verschiebung in Canvas-Pixeln (Kamera); ohne Angabe 0. */
  tx?: number;
  ty?: number;
  /**
   * Auflösung der Sprites (Pixel je CSS-Pixel); ohne Angabe `dpr`. Beim Zoom eine von
   * wenigen Stufen, damit Sprites je Stufe gecacht bleiben.
   */
  spriteDpr?: number;
}

/** Jahreszeit-Werte dieses Frames (einmal je Frame gerechnet, keine Allokation). */
const seasonNow = { season: Number.NaN as number | null, insects: 1, amphibians: 1, ice: 0, petals: 1, seeds: 0, bare: 0, glow: 1 };

function updateSeason(season: number | null): void {
  if (seasonNow.season === season) return;
  seasonNow.season = season;
  seasonNow.insects = insectActivity(season);
  seasonNow.amphibians = amphibianActivity(season);
  seasonNow.ice = pondIce(season);
  seasonNow.petals = edgePetals(season);
  seasonNow.seeds = edgeSeedHeads(season);
  seasonNow.bare = edgeBare(season);
  seasonNow.glow = fireflySeason(season);
}

const NICHE_ORDER: Record<string, number> = { roots: 0, pond: 0.5, litter: 1, edge: 2, bark: 3, hollows: 4, crown: 5 };

interface Pose {
  x: number;
  y: number;
  /** Blickrichtung: 1 = rechts, −1 = links. */
  dir: number;
  /** Drehung (rad), z. B. −π/2 für Krabbeln den Stamm hinauf. */
  rot: number;
  frame: number;
  /** Anderes Sprite als die Art (z. B. 'batFly' für die fliegende Fledermaus), sonst null. */
  sprite: string | null;
}

interface Deco {
  name: string;
  x: number;
  y: number;
  size: number;
}

/** Alles, was sich für ein Tier nur ändert, wenn sich Tierliste oder Baum ändern. */
interface PlanEntry {
  /** Index in der aktuellen Tierliste (Zufriedenheit wird pro Frame frisch gelesen). */
  index: number;
  kind: string;
  info: KindInfo;
  /** Insekt (Gattung 'insects'): ruht im Winter. */
  insect: boolean;
  /** Amphibie (Gattung 'amphibians'): Winterstarre. */
  amphibian: boolean;
  seed: number;
  phase: number;
  niche: string;
  /** Reihe (1 = hintere Reihe am Waldsaum, wird vor allen anderen gezeichnet). */
  depth: number;
  /** Sprite-Größe in px. */
  size: number;
  /** Ruhelage ohne Wind. */
  x: number;
  y: number;
  dir: number;
  rot: number;
  travel: number;
  vertical: boolean;
  /** Wind: Verschiebung = windSkew · windArm (0 für Tiere am Boden). */
  windArm: number;
  /** Dekos vor bzw. nach dem Tier (Blumen, Laub, Erdloch, Höhle …). */
  before: Deco[];
  after: Deco[];
  /** Schimmer: 0 keiner, 2 Lichthof, 3 Lichthof + Funken. */
  shimmer: number;
  /** Mitte des Sprites relativ zum Ankerpunkt (Zeicheneinheiten, Blick nach rechts) und Radius. */
  midX: number;
  midY: number;
  midR: number;
  /**
   * Insekt auf der Blüte am Waldsaum: so weit (px) sinkt es im Winter (ohne Blüten) zur
   * Blattrosette am Boden; 0 = keins.
   */
  perchDrop: number;
  /** Wiederverwendetes Pose-Objekt (keine Allokation pro Frame). */
  pose: Pose;
  /**
   * Wendet um die eigene Körpermitte statt um den Ankerpunkt (Molche im Tümpel): So bleibt
   * der belegte Streifen beim Umdrehen gleich breit.
   */
  pivot: boolean;
}

/** Merkmale eines Tiers, von denen der Plan abhängt. */
interface Signature {
  id: string;
  family: string;
  niche: string;
  slot: number;
  /** Normalisiert (0–3), damit NaN nicht bei jedem Vergleich als „geändert“ gilt. */
  rarity: number;
}

/**
 * Tier-Ebene einer Szene: Sprite-Cache und ein vorberechneter Plan (Reihenfolge, Art,
 * Lage, Dekos). Der Plan wird nur neu gebaut, wenn sich Ankerpunkte (Baum/Größe) oder
 * Arten/Nischen/Plätze der Tiere ändern – auch wenn jedes Frame ein neues Array kommt.
 */
export class AnimalLayer {
  readonly sprites = new SpriteCache();
  private plan: PlanEntry[] = [];
  private signature: Signature[] = [];
  private anchors: AnchorResolver | null = null;
  /** Wie oft der Plan gebaut wurde (für Tests). */
  builds = 0;

  /**
   * `pond`: Waldtümpel (DESIGN_V2.md 5.5) – ein gecachtes Sprite im Erdschnitt unter der
   * Grasnarbe, im Winter mit Eisdecke (zweites Sprite, überblendet). Er liegt über den
   * Wurzelraum-Tieren und dem Pilzgeflecht (das hinter der Senke weiterläuft) und unter
   * allen übrigen Tieren; Pflanzen und Gäste reichen nicht bis in die Senke (anchors.ts).
   */
  draw(ctx: CanvasRenderingContext2D, animals: readonly SceneAnimal[], anchors: AnchorResolver, f: AnimalFrame, pond = false): void {
    if (animals.length === 0 && !pond) return;
    this.sprites.tick();
    updateSeason(f.season ?? null);
    if (anchors !== this.anchors || !this.matches(animals)) this.rebuild(animals, anchors);
    for (const e of this.plan) {
      if (e.niche === 'roots') drawEntry(ctx, e, animals[e.index]!.happiness, anchors.size, this.sprites, f);
    }
    if (pond) drawPond(ctx, anchors, this.sprites, f);
    for (const e of this.plan) {
      if (e.niche !== 'roots') drawEntry(ctx, e, animals[e.index]!.happiness, anchors.size, this.sprites, f);
    }
    ctx.globalAlpha = 1;
  }

  private matches(animals: readonly SceneAnimal[]): boolean {
    const sig = this.signature;
    if (sig.length !== animals.length) return false;
    for (let i = 0; i < sig.length; i++) {
      const a = animals[i]!;
      const s = sig[i]!;
      if (s.id !== a.id || s.family !== a.family || s.niche !== a.niche || s.slot !== normSlot(a.slot) || s.rarity !== animalRarity(a)) return false;
    }
    return true;
  }

  private rebuild(animals: readonly SceneAnimal[], anchors: AnchorResolver): void {
    this.builds++;
    this.anchors = anchors;
    this.signature = animals.map((a) => ({ id: a.id, family: a.family, niche: a.niche, slot: normSlot(a.slot), rarity: animalRarity(a) }));
    const plan: PlanEntry[] = [];
    const ponds = pondPlaces(animals, anchors);
    animals.forEach((animal, index) => {
      const anchor = anchors.get(animal.niche, animal.slot);
      if (anchor) plan.push(planEntry(animal, index, anchor, anchors, ponds[index]));
    });
    // Stabile Sortierung: hintere Reihe zuerst, dann Boden … Krone.
    plan.sort((a, b) => b.depth - a.depth || (NICHE_ORDER[a.niche] ?? 9) - (NICHE_ORDER[b.niche] ?? 9) || a.index - b.index);
    this.plan = plan;
  }
}

/**
 * Bereich, den ein Tier samt Dekos höchstens belegt (CSS-Pixel, ohne Wind, mit Laufweg
 * und Hüpfen) – für Tests, dass sich Nischen nicht überlappen. null ohne Ankerpunkt.
 */
export function animalBounds(
  animal: SceneAnimal,
  anchors: AnchorResolver,
  /** Dekos, die nicht zählen (z. B. 'mycel': läuft hinter dem Tümpel weiter). */
  ignore: readonly string[] = [],
  /**
   * Alle Tiere der Szene (muss `animal` enthalten): Im Tümpel hängt die Lage eines
   * Bewohners von den übrigen ab. Ohne Angabe lebt das Tier allein im Tümpel.
   */
  scene?: readonly SceneAnimal[],
): { x0: number; x1: number; y0: number; y1: number } | null {
  const anchor = anchors.get(animal.niche, animal.slot);
  if (!anchor) return null;
  const all = scene ?? [animal];
  const place = animal.niche === 'pond' ? pondPlaces(all, anchors)[Math.max(0, all.indexOf(animal))] : null;
  const e = planEntry(animal, 0, anchor, anchors, place);
  const def = DEFS[e.kind] ?? DEFS.insect!;
  // Wendet das Tier um die Körpermitte, belegt es nur seine eigene Breite um diese Mitte.
  const half = (e.pivot ? ((def.x1 - def.x0) / 2) * e.size : Math.max(-def.x0, def.x1) * e.size) + e.travel;
  const cx = e.pivot ? e.x + e.midX * e.size * e.dir : e.x;
  const lift = e.info.motion === 'hop' ? 0.17 * anchors.size : e.info.motion === 'sniff' ? 0.05 * anchors.size : 0;
  const box = { x0: cx - half, x1: cx + half, y0: e.y + def.y0 * e.size - lift, y1: e.y + def.y1 * e.size };
  for (const d of [...e.before, ...e.after]) {
    const dd = DEFS[d.name];
    if (!dd || ignore.includes(d.name)) continue;
    box.x0 = Math.min(box.x0, d.x + dd.x0 * d.size);
    box.x1 = Math.max(box.x1, d.x + dd.x1 * d.size);
    box.y0 = Math.min(box.y0, d.y + dd.y0 * d.size);
    box.y1 = Math.max(box.y1, d.y + dd.y1 * d.size);
  }
  return box;
}

// ---------------------------------------------------------------------------
// Waldtümpel: Lage der Bewohner
// ---------------------------------------------------------------------------

/** Lage eines Tümpelbewohners, berechnet aus allen Bewohnern (`pondPlaces`). */
export interface PondPlace {
  /** Watende: Fußpunkt; Schwimmer: Körpermitte (CSS-Pixel). */
  x: number;
  /** Blickrichtung: 1 nach rechts, −1 nach links. */
  dir: 1 | -1;
  /** Größe relativ zur Tiergröße S. */
  scale: number;
  /** Nummer unter den Schwimmern (Höhenversatz), sonst 0. */
  row: number;
}

/** Schwimmweg der Molche je Seite und Lücke zwischen zwei Bewohnern (Tiergrößen). */
const SWIM_TRAVEL = 0.1;
const POND_GAP = 0.08;
/** Molche höchstens so groß (relativ zu S) – sonst ragte der Kamm weit aus dem Wasser. */
const SWIM_SCALE_MAX = 1.05;
/** Abstand der äußeren Bewohner zum Rand der Senke (Tiergrößen). */
const POND_RIM = 0.1;

/**
 * Plätze aller Tümpelbewohner in `animals` (gleiche Reihenfolge; null für alle anderen).
 *
 * Die Senke kann nicht tiefer werden (anchors.ts), also stehen die Bewohner nebeneinander
 * und überlappen sich nie: Kröte und Frösche (nach Platz) abwechselnd am linken und
 * rechten flachen Rand, von außen nach innen; die Molche in der tiefen Mitte, gleichmäßig
 * verteilt, jeder in seinem eigenen Streifen. Passen nicht alle in voller Größe hinein,
 * werden sie gemeinsam kleiner (in Schritten von 0,025 – wenige Sprite-Größen). Wird nur
 * beim Neuaufbau des Plans bzw. beim Tippen berechnet, nie pro Frame.
 */
export function pondPlaces(animals: readonly SceneAnimal[], anchors: AnchorResolver): (PondPlace | null)[] {
  const out: (PondPlace | null)[] = animals.map(() => null);
  const idx: number[] = [];
  animals.forEach((a, i) => {
    if (a.niche === 'pond' && anchors.get('pond', a.slot)) idx.push(i);
  });
  if (idx.length === 0) return out;
  idx.sort((i, j) => normSlot(animals[i]!.slot) - normSlot(animals[j]!.slot) || i - j);
  const p = anchors.pond();
  const S = p.size;
  const items = idx.map((i) => {
    const kind = animalKind(animals[i]!);
    const info = KINDS[kind] ?? KINDS.insect!;
    const def = DEFS[kind] ?? DEFS.insect!;
    const swim = info.swim === true;
    // Breite in Tiergrößen (bei Maßstab 1): Schwimmer samt Weg, Watende samt Wasser davor.
    const w = swim ? (def.x1 - def.x0) * info.size + 2 * SWIM_TRAVEL : 2 * Math.max(Math.max(-def.x0, def.x1) * info.size, WADE_HALF);
    return { i, swim, w };
  });
  const inner = 2 * (p.halfWidth - POND_RIM);
  // Lücken: zwischen Nachbarn und zur Mitte hin (höchstens eine je Bewohner).
  let need = POND_GAP * items.length;
  for (const it of items) need += it.w;
  const k = Math.max(0.5, Math.floor(Math.min(p.maxScale, inner / need) * 40) / 40);
  const gap = POND_GAP * k;
  const waders = items.filter((it) => !it.swim);
  const swimmers = items.filter((it) => it.swim);
  // Watende: links von außen nach innen bzw. rechts von außen nach innen.
  let left = -inner / 2;
  let right = inner / 2;
  waders.forEach((it, n) => {
    const w = it.w * k;
    if (n % 2 === 0) {
      out[it.i] = { x: p.x + (left + w / 2) * S, dir: 1, scale: k, row: 0 };
      left += w + gap;
    } else {
      out[it.i] = { x: p.x + (right - w / 2) * S, dir: -1, scale: k, row: 0 };
      right -= w + gap;
    }
  });
  // Schwimmer: gleichmäßig in der Mitte verteilt, zur Mitte bzw. abwechselnd blickend.
  let used = 0;
  for (const it of swimmers) used += it.w * k;
  const space = Math.max(0, (right - left - used) / (swimmers.length + 1));
  let at = left + space;
  swimmers.forEach((it, n) => {
    const w = it.w * k;
    const c = at + w / 2;
    out[it.i] = { x: p.x + c * S, dir: c < -0.05 ? 1 : c > 0.05 ? -1 : n % 2 === 0 ? 1 : -1, scale: k, row: n };
    at += w + space;
  });
  return out;
}

/** Kleine Krabbler, die am Waldsaum auf der Blüte sitzen. */
const ON_BLOSSOM = new Set(['insect', 'oakmoth', 'barkbeetle', 'woodlouse', 'stagbeetle']);

function planEntry(animal: SceneAnimal, index: number, anchor: NicheAnchor, anchors: AnchorResolver, pondPlace?: PondPlace | null): PlanEntry {
  const kind = animalKind(animal);
  const info = KINDS[kind] ?? KINDS.insect!;
  const def = DEFS[kind] ?? DEFS.insect!;
  const S = anchors.size;
  const groundY = anchors.layout.groundY;
  const seed = hash2(hashString(String(animal.id ?? '')), anchor.slot * 31 + (NICHE_ORDER[anchor.niche] ?? 0));
  const niche = anchor.niche;
  const ax = anchor.x;
  const ay = anchor.y;
  const e: PlanEntry = {
    index,
    kind,
    info,
    insect: animal.family === 'insects',
    amphibian: animal.family === 'amphibians',
    seed,
    phase: (seed & 1023) / 97,
    niche,
    depth: 0,
    size: S * info.size,
    x: ax,
    y: ay,
    dir: anchor.side === 1 ? -1 : 1,
    rot: 0,
    travel: 0,
    vertical: false,
    windArm: anchor.onTree ? anchor.y - groundY : 0,
    before: [],
    after: [],
    shimmer: animalRarity(animal) >= 2 ? animalRarity(animal) : 0,
    midX: (def.x0 + def.x1) / 2,
    midY: (def.y0 + def.y1) / 2,
    midR: Math.max(def.x1 - def.x0, def.y1 - def.y0) * 0.62,
    perchDrop: 0,
    pose: { x: 0, y: 0, dir: 1, rot: 0, frame: 0, sprite: null },
    pivot: false,
  };

  if (info.fungus) {
    e.dir = anchor.side;
    if (info.fungus === 'cap' && niche === 'roots') {
      // Fruchtkörper an der Oberfläche, Geflecht reicht hinab zu den Wurzeln.
      e.x = anchor.surfaceX;
      e.y = groundY + 1;
      e.before.push({ name: 'mycel', x: anchor.surfaceX, y: groundY + 1, size: S * 1.1 });
    }
    if (niche !== 'bark' && niche !== 'hollows') keepInside(e, def, anchors.layout.width);
    return e;
  }

  switch (niche) {
    case 'roots':
      e.before.push({ name: 'burrow', x: ax, y: ay, size: S });
      e.y = ay + S * (kind === 'earthworm' ? 0.06 : 0.12);
      e.travel = S * 0.18;
      break;
    case 'litter':
      e.before.push({ name: 'litter', x: ax, y: ay, size: S });
      e.travel = info.motion === 'busy' ? 0 : S * 0.4;
      if (kind === 'earthworm') e.y = ay - S * 0.04;
      break;
    case 'edge': {
      // Hintere Reihe (schmale Bildschirme): alles etwas kleiner, gerundet auf 0,05 –
      // so entstehen nur wenige Sprite-Größen.
      const k = Math.round(clamp(anchor.scale, 0.5, 1) * 20) / 20;
      const Se = S * k;
      e.size = Se * info.size;
      e.depth = anchor.depth;
      e.before.push({ name: 'flowers', x: ax, y: ay, size: Se * 1.15 });
      // Ruhende Insekten sitzen auf der Blüte (Höhe ay − 0,72·Se); im Winter ohne Blüten
      // stattdessen tief an den dürren Halmen über der Rosette (ay − 0,22·Se).
      if (info.motion === 'hover') {
        e.y = ay - Se * 1.15;
        if (e.insect) e.perchDrop = Se * 0.5;
      } else if (ON_BLOSSOM.has(kind)) {
        // Kleine Krabbler sitzen auf der Blüte.
        e.y = ay - Se * 0.72;
        e.x = ax + Se * 0.21;
        e.perchDrop = Se * 0.5;
      } else {
        // Größere Tiere stehen neben den Blumen, große etwas weiter weg.
        e.x = ax + anchor.side * Se * (0.3 + 0.25 * info.size);
        e.travel = Se * 0.3;
      }
      break;
    }
    case 'crown':
      e.travel = S * 0.12;
      if (info.motion === 'hover') e.y = ay - S * 0.3;
      break;
    case 'bark':
      if (info.cling) {
        e.dir = -anchor.side;
      } else if (info.motion === 'hop' || info.motion === 'sniff') {
        e.dir = anchor.side;
      } else {
        // Krabbler laufen auf der Rinde den Stamm hinauf.
        e.vertical = true;
        e.x = anchor.trunkX + anchor.side * anchor.trunkHalf * 0.35;
        e.rot = -Math.PI / 2;
        e.travel = Math.min(S * 0.35, anchor.trunkHalf * 3);
      }
      break;
    case 'pond': {
      // Alles bleibt in der Senke unter der Grasnarbe (anchors.ts, POND_LIP). Wo das Tier
      // sitzt und wie groß es ist, hängt von allen Bewohnern ab (`pondPlaces`).
      const pond = anchors.pond();
      const place = pondPlace ?? pondPlaces([animal], anchors)[0]!;
      e.dir = place.dir;
      if (info.swim) {
        // Schwimmt unter der Wasseroberfläche in seinem Streifen hin und her und wendet um
        // die Körpermitte; zwei Molche schwimmen leicht höhenversetzt.
        e.size = S * info.size * Math.min(place.scale, SWIM_SCALE_MAX);
        e.pivot = true;
        e.travel = SWIM_TRAVEL * S * place.scale;
        e.x = place.x - e.midX * e.size * e.dir;
        const top = pond.waterY - 0.06 * S;
        const bottom = pond.y + (POND_DEPTH - 0.05) * S;
        const want = pond.waterY + S * (place.row % 2 === 0 ? 0.2 : 0.27);
        e.y = clamp(want, top - def.y0 * e.size, bottom - def.y1 * e.size);
      } else {
        // Sitzt im flachen Wasser am Rand: Kopf genau unter der Narbe, Füße im Wasser.
        // Leichtes Wippen (`sniff`, 0,05 S) eingerechnet.
        e.size = S * info.size * place.scale;
        e.x = place.x;
        e.y = pond.lipY + S * 0.07 - def.y0 * e.size;
        e.after.push({ name: 'pondWade', x: place.x, y: pond.waterY, size: S * place.scale });
      }
      break;
    }
    case 'hollows': {
      // Die Höhle passt sich dem (anfangs schmalen) Stamm an; in Zehntelschritten,
      // damit nur wenige Sprite-Größen entstehen.
      const fit = Math.round(clamp((anchor.trunkHalf * 2.5) / (0.72 * S), 0.6, 1) * 10) / 10;
      e.before.push({ name: 'hollow', x: ax, y: ay, size: S * fit });
      e.after.push({ name: 'hollowLip', x: ax, y: ay, size: S * fit });
      e.y = ay - S * 0.06 * fit;
      e.size = S * Math.min(info.size, 1.2) * 0.78 * fit;
      e.dir = anchor.side;
      e.travel = 0;
      break;
    }
  }
  if (niche === 'litter' || niche === 'edge' || niche === 'roots') keepInside(e, def, anchors.layout.width);
  return e;
}

/** Große Tiere am Boden nie über den Bildrand hinaus (auch gespiegelt und beim Laufen). */
function keepInside(e: PlanEntry, def: SpriteDef, width: number): void {
  const half = Math.max(-def.x0, def.x1) * e.size + e.travel;
  if (width > half * 2) e.x = clamp(e.x, half, width - half);
}

function drawEntry(
  ctx: CanvasRenderingContext2D,
  e: PlanEntry,
  happiness: number,
  S: number,
  sprites: SpriteCache,
  f: AnimalFrame,
): void {
  const happy = clamp01(Number.isFinite(happiness) ? happiness : 0.5);
  const muted = 1 - smooth01((happy - 0.15) / 0.3);
  // Mit dem Baum im Wind schwingen (gleiche Scherung wie die Baumebene).
  const wx = f.windSkew * e.windArm;
  const pose = placePose(e, happy, S, f);

  for (const d of e.before) {
    if (d.name === 'flowers') drawEdgeFlowers(ctx, d, wx, sprites, f);
    else blit(ctx, sprites.get(d.name, 0, false, d.size, f.spriteDpr ?? f.dpr), d.x + wx, d.y, 1, 0, 1, f);
  }
  if (e.shimmer > 0) drawShimmer(ctx, e, pose, muted, sprites, f);
  // Regen löscht den Schein (das Tier bleibt sichtbar).
  const rainGlow = 1 - clamp01(f.rain ?? 0);
  if (e.kind === 'glowworm' && seasonNow.glow * rainGlow > 0.01) {
    // Leuchten nur in der Glühwürmchen-Zeit; im Winter sitzt es dunkel am Boden.
    const hx = pose.x - 0.12 * e.size * pose.dir;
    const hy = pose.y + 0.04 * e.size;
    const glow = seasonNow.glow * rainGlow * (1 - 0.5 * muted);
    blit(ctx, sprites.get('glowHalo', 0, false, e.size, f.spriteDpr ?? f.dpr), hx, hy, 1, 0, glow, f);
    const night = f.night ?? 0;
    if (night > 0.01) {
      // Nachts: zusätzlicher, größerer Schein, der additiv leuchtet.
      ctx.globalCompositeOperation = 'lighter';
      blit(ctx, sprites.get('glowHalo', 0, false, e.size * 2.4, f.spriteDpr ?? f.dpr), hx, hy, 1, 0, glow * night * 0.8, f);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  const name = pose.sprite ?? e.kind;
  if (muted < 0.99) {
    blit(ctx, sprites.get(name, pose.frame, false, e.size, f.spriteDpr ?? f.dpr), pose.x, pose.y, pose.dir, pose.rot, 1, f);
  }
  if (muted > 0.01) {
    blit(ctx, sprites.get(name, pose.frame, true, e.size, f.spriteDpr ?? f.dpr), pose.x, pose.y, pose.dir, pose.rot, muted < 0.99 ? muted : 1, f);
  }
  for (const d of e.after) blit(ctx, sprites.get(d.name, 0, false, d.size, f.spriteDpr ?? f.dpr), d.x + wx, d.y, 1, 0, 1, f);
  if (e.shimmer === 3) drawSparkles(ctx, e, pose, muted, sprites, f);
}

/**
 * Lage des Tiers in diesem Frame (nach `e.pose`): Ruhelage, Wind, Bewegung und
 * Winterruhe. `happy` ist die schon begrenzte Zufriedenheit; `seasonNow` muss aktuell sein.
 */
function placePose(e: PlanEntry, happy: number, S: number, f: Pick<AnimalFrame, 'time' | 'windSkew' | 'reducedMotion' | 'nocturnal'>): Pose {
  const rest = e.insect ? clamp01(seasonNow.insects) : e.amphibian ? clamp01(seasonNow.amphibians) : 1;
  // Nachtarten: tagsüber ruhiger, nachts aktiver (nur mit Tageszeit; Igel und Fledermaus
  // halten Winterschlaf – wie die Amphibien von Spätherbst bis Vorfrühling).
  const wake = nightWake(f.nocturnal);
  const awake = clamp01(seasonNow.amphibians);
  const act = f.reducedMotion ? 0 : smooth01((happy - 0.2) / 0.6) * rest * nocturnalPace(e.kind, wake, awake);
  const pose = e.pose;
  pose.x = e.x + f.windSkew * e.windArm;
  pose.y = e.y;
  pose.dir = e.dir;
  pose.rot = e.rot;
  pose.frame = 0;
  pose.sprite = null;
  animate(e, pose, act, f.time, S, f.reducedMotion);
  if (wake !== null) {
    if (e.kind === 'owl') {
      const o = owlPose(pose.frame, pose.dir, wake, f.time, e.seed, e.phase, f.reducedMotion);
      pose.frame = o.frame;
      pose.dir = o.dir;
    } else if (e.kind === 'bat' && happy > 0.15 && batFlying(wake, awake, f.reducedMotion)) {
      // Nachts fliegt das Langohr Schleifen um den Stamm (die Höhle bleibt leer).
      const fl = batFlight(pose.x, e.y - e.size * 0.5, S, f.time, e.phase);
      pose.x = fl.x;
      pose.y = fl.y;
      pose.dir = fl.dir;
      pose.frame = fl.frame;
      pose.sprite = 'batFly';
    }
  }
  // Um die Körpermitte wenden (Molche): Beim Spiegeln bleibt die Mitte stehen.
  if (e.pivot && pose.dir !== e.dir) pose.x += (e.dir - pose.dir) * e.midX * e.size;
  // Eigenes Sprite (Flug) hat zwei Frames, sonst gilt die Zahl der Art.
  if (!(pose.frame >= 0 && pose.frame < (pose.sprite ? 2 : e.info.frames))) pose.frame = 0;
  // Winter: ohne Blüten ruht das Insekt an der Rosette am Boden (Schwirrer nur, wenn sie ruhen).
  if (e.perchDrop > 0 && seasonNow.bare > 0) {
    pose.y += e.perchDrop * seasonNow.bare * (e.info.motion === 'hover' ? 1 - Math.min(1, act) : 1);
  }
  return pose;
}

// ---------------------------------------------------------------------------
// Treffer-Test (Klick/Tippen auf ein Tier)
// ---------------------------------------------------------------------------

/**
 * Getroffenes Tier: Nische, Platz in der Nische (`index`, wie `SceneAnimal.slot` bzw. die
 * Position in `state.niches[nicheId]`), Art und Position in der übergebenen Tierliste.
 */
export interface AnimalHit {
  nicheId: string;
  /** Platz in der Nische (ganzzahlig, ≥ 0). */
  index: number;
  speciesId: string;
  /** Position in der übergebenen Tierliste (`SceneInput.animals`). */
  listIndex: number;
}

/**
 * Welches Tier liegt am Szenenpunkt (`x`, `y`, CSS-Pixel der ungezoomten Szene)? Rechnet
 * mit denselben Ankerpunkten, Sprite-Größen und Bewegungen wie die Zeichnung (inkl.
 * Wind-Versatz). Jedes Tier ist ein Kreis um die Sprite-Mitte, mindestens `minRadius`
 * groß (Tippziel); bei Überschneidung gewinnt das nächstgelegene. Rein – keine Zeichnung.
 */
export function hitTestAnimals(
  animals: readonly SceneAnimal[],
  anchors: AnchorResolver,
  f: Pick<AnimalFrame, 'time' | 'windSkew' | 'reducedMotion' | 'season' | 'nocturnal'>,
  x: number,
  y: number,
  minRadius = 0,
): AnimalHit | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  updateSeason(f.season ?? null);
  let best: AnimalHit | null = null;
  let bestD = Infinity;
  const ponds = pondPlaces(animals, anchors);
  animals.forEach((animal, index) => {
    const anchor = anchors.get(animal.niche, animal.slot);
    if (!anchor) return;
    const e = planEntry(animal, index, anchor, anchors, ponds[index]);
    const happy = clamp01(Number.isFinite(animal.happiness) ? animal.happiness : 0.5);
    const pose = placePose(e, happy, anchors.size, f);
    const m = spriteMid(e, pose, hitMid);
    const r = Math.max(e.size * midRadius(e, pose) * 0.85, minRadius);
    const d = Math.hypot(x - m.x, y - m.y);
    if (d <= r && d < bestD) {
      bestD = d;
      best = { nicheId: anchor.niche, index: anchor.slot, speciesId: String(animal.id), listIndex: index };
    }
  });
  return best;
}

const hitMid = { x: 0, y: 0 };

/**
 * Blumen am Waldsaum in der Jahreszeit: im Sommer das bisherige Sprite (ein drawImage),
 * sonst grüne bzw. dürre Halme mit Blüten oder Samenständen, weich überblendet.
 */
function drawEdgeFlowers(ctx: CanvasRenderingContext2D, d: Deco, wx: number, sprites: SpriteCache, f: AnimalFrame): void {
  const { petals, seeds, bare } = seasonNow;
  const x = d.x + wx;
  if (petals >= 0.995 && seeds <= 0.005 && bare <= 0.005) {
    blit(ctx, sprites.get('flowers', 0, false, d.size, f.spriteDpr ?? f.dpr), x, d.y, 1, 0, 1, f);
    return;
  }
  if (bare < 0.995) blit(ctx, sprites.get('edgeGreen', 0, false, d.size, f.spriteDpr ?? f.dpr), x, d.y, 1, 0, 1 - bare, f);
  if (bare > 0.005) blit(ctx, sprites.get('edgeBare', 0, false, d.size, f.spriteDpr ?? f.dpr), x, d.y, 1, 0, bare, f);
  if (seeds > 0.005) blit(ctx, sprites.get('edgeSeeds', 0, false, d.size, f.spriteDpr ?? f.dpr), x, d.y, 1, 0, seeds, f);
  if (petals > 0.005) blit(ctx, sprites.get('edgePetals', 0, false, d.size, f.spriteDpr ?? f.dpr), x, d.y, 1, 0, petals, f);
}

/** Lichthof hinter seltenen Arten: ein gecachtes Sprite, das sanft pulsiert. */
function drawShimmer(ctx: CanvasRenderingContext2D, e: PlanEntry, pose: Pose, muted: number, sprites: SpriteCache, f: AnimalFrame): void {
  const { x, y } = spriteMid(e, pose, mid);
  const pulse = f.reducedMotion ? 0.85 : 0.75 + 0.25 * Math.sin(f.time * 1.6 + e.phase);
  const base = e.shimmer === 3 ? 0.62 : 0.42;
  const alpha = base * pulse * (1 - 0.5 * muted);
  blit(ctx, sprites.get('shimmer', 0, false, e.size * midRadius(e, pose), f.spriteDpr ?? f.dpr), x, y, 1, 0, alpha, f);
}

/** Zwei kleine Funken, die abwechselnd an Rand des Tiers aufblitzen (nur legendäre Arten). */
function drawSparkles(ctx: CanvasRenderingContext2D, e: PlanEntry, pose: Pose, muted: number, sprites: SpriteCache, f: AnimalFrame): void {
  const { x, y } = spriteMid(e, pose, mid);
  const s = sprites.get('sparkle', 0, false, Math.max(8, e.size * 0.34), f.spriteDpr ?? f.dpr);
  const r = e.size * midRadius(e, pose) * 0.7;
  for (let k = 0; k < 2; k++) {
    const t = f.reducedMotion ? 0.3 + k * 0.4 : f.time * 0.9 + e.phase + k * 0.5;
    const n = Math.floor(t);
    const local = t - n;
    // Jede Runde an einer neuen, per Seed bestimmten Stelle.
    const ang = ((hash2(e.seed + k, n) & 1023) / 1024) * TAU;
    const tw = f.reducedMotion ? 0.8 : Math.sin(local * Math.PI) ** 2;
    if (tw < 0.03) continue;
    blit(ctx, s, x + Math.cos(ang) * r, y + Math.sin(ang) * r * 0.8, 1, 0, tw * (1 - 0.6 * muted), f);
  }
}

/** Waldtümpel an seiner festen Lage (gemerkt in `anchors.pond()`); im Winter mit Eis. */
function drawPond(ctx: CanvasRenderingContext2D, anchors: AnchorResolver, sprites: SpriteCache, f: AnimalFrame): void {
  const p = anchors.pond();
  const dpr = f.spriteDpr ?? f.dpr;
  blit(ctx, sprites.get(pondSpriteName(false, p.halfWidth), 0, false, p.size, dpr), p.x, p.y, 1, 0, 1, f);
  if (seasonNow.ice > 0.01) blit(ctx, sprites.get(pondSpriteName(true, p.halfWidth), 0, false, p.size, dpr), p.x, p.y, 1, 0, seasonNow.ice, f);
}

/** Radius um die Sprite-Mitte (Anteil der Größe) – bei eigenem Sprite aus dessen Begrenzung. */
function midRadius(e: PlanEntry, pose: Pose): number {
  const d = pose.sprite ? DEFS[pose.sprite] : undefined;
  return d ? Math.max(d.x1 - d.x0, d.y1 - d.y0) * 0.62 : e.midR;
}

/** Wiederverwendeter Punkt für die Sprite-Mitte (keine Allokation pro Frame). */
const mid = { x: 0, y: 0 };

/** Mitte des Sprites in CSS-Pixeln (mit Spiegelung und Drehung), geschrieben nach `out`. */
function spriteMid(e: PlanEntry, pose: Pose, out: { x: number; y: number }): { x: number; y: number } {
  // Eigenes Sprite (z. B. fliegende Fledermaus): Mitte aus dessen Begrenzung.
  const d = pose.sprite ? DEFS[pose.sprite] : undefined;
  const mx = (d ? (d.x0 + d.x1) / 2 : e.midX) * e.size * pose.dir;
  const my = (d ? (d.y0 + d.y1) / 2 : e.midY) * e.size;
  if (pose.rot === 0) {
    out.x = pose.x + mx;
    out.y = pose.y + my;
    return out;
  }
  const c = Math.cos(pose.rot);
  const s = Math.sin(pose.rot);
  out.x = pose.x + mx * c - my * s;
  out.y = pose.y + mx * s + my * c;
  return out;
}

/** Nachkommaanteil 0 ≤ v < 1, auch für negative Werte (z. B. negative Zeit). */
function frac(v: number): number {
  return v - Math.floor(v);
}

/** Platz für Signaturen: ungültige Werte einheitlich als −1. */
function normSlot(slot: number): number {
  return Number.isFinite(slot) ? Math.floor(slot) : -1;
}

/** Bewegung als günstige Verschiebung/Spiegelung; Stärke folgt der Zufriedenheit. */
function animate(e: PlanEntry, pose: Pose, act: number, t: number, S: number, reduced: boolean): void {
  const info = e.info;
  if (reduced || act <= 0.01) {
    if (info.motion === 'hover' && e.niche === 'edge') pose.y += (e.size / info.size) * 0.43; // ruht auf der Blüte
    return;
  }
  switch (info.motion) {
    case 'hop':
    case 'sniff': {
      const period = 7 - 4.2 * act;
      const u = t / period + e.phase;
      const n = Math.floor(u);
      const local = (u - n) * period;
      const dur = info.motion === 'hop' ? 0.34 : 0.5;
      if (local < dur) {
        const amp = info.motion === 'hop' ? 0.17 : 0.05;
        pose.y -= Math.sin((local / dur) * Math.PI) * S * amp * act;
      }
      // Ab und zu umdrehen (beim Hüpfen).
      if (e.niche !== 'hollows' && (hash2(e.seed, n) & 3) === 0) pose.dir = -pose.dir;
      break;
    }
    case 'peck': {
      const period = 4.5 - 2 * act;
      const local = frac(t / period + e.phase) * period;
      if (local < 0.8) pose.x += pose.dir * S * 0.07 * Math.max(0, Math.sin(local * TAU * 5));
      break;
    }
    case 'hover': {
      const slow = e.kind === 'glowworm' ? 0.7 : 1.3;
      const p = t * slow + e.phase;
      pose.x += S * 0.32 * act * Math.sin(p);
      pose.y += S * 0.14 * act * Math.sin(p * 2);
      pose.dir = Math.cos(p) >= 0 ? 1 : -1;
      // Flügelschlag nur bei merklicher Aktivität: darunter in Schüben, die mit der
      // Aktivität kürzer werden (feste Taktrate – kein Phasensprung bei sich ändernder
      // Aktivität); kurz vor der Ruhe (act ≤ 0,2) Flügel still.
      if (act > 0.2 && frac(t * 0.35 + e.phase) < smooth01((act - 0.2) / 0.6)) {
        pose.frame = Math.floor(t * (e.kind === 'peacock' ? 5 : 14)) & 1;
      }
      // Mit nachlassender Aktivität (Winterruhe, Unzufriedenheit) stufenlos auf die Blüte sinken.
      if (e.niche === 'edge') pose.y += (1 - Math.min(1, act)) * (e.size / info.size) * 0.43;
      break;
    }
    case 'crawl':
    case 'inch':
    case 'wiggle': {
      const slow = info.motion === 'crawl' ? 0.55 : 0.3;
      const p = t * slow + e.phase;
      const off = e.travel * act * Math.sin(p);
      const vel = Math.cos(p);
      if (e.vertical) pose.y -= off;
      else pose.x += off;
      if (e.travel > 0 && Math.abs(vel) > 0.15) {
        // In Laufrichtung schauen (auf der Rinde: hinauf bzw. hinab).
        pose.dir = vel >= 0 ? 1 : -1;
        const rate = info.motion === 'crawl' ? 8 : info.motion === 'inch' ? 1.6 : 2.4;
        pose.frame = Math.floor(t * rate) & 1;
      } else if (info.motion === 'wiggle') {
        pose.frame = Math.floor(t * 2) & 1;
      }
      break;
    }
    case 'blink': {
      // Kurzes Blinzeln alle paar Sekunden (Kauz).
      const period = 6 - 2.5 * act;
      const local = frac(t / period + e.phase) * period;
      pose.frame = local < 0.18 ? 1 : 0;
      break;
    }
    case 'busy':
      // Geschäftiges Gewusel an Ort und Stelle (Ameisen, Käferbeine).
      pose.frame = Math.floor(t * (1.5 + 2.5 * act) + e.phase) & 1;
      break;
    case 'still':
      break;
  }
}

/** Ein Sprite an (x, y) [CSS-px] zeichnen – gespiegelt (dir) und gedreht (rot). */
function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, dir: number, rot: number, alpha: number, f: AnimalFrame): void {
  const k = f.dpr;
  const cos = rot === 0 ? 1 : Math.cos(rot);
  const sin = rot === 0 ? 0 : Math.sin(rot);
  // Gerät = Verschiebung(tx, ty) · Skalierung(sx, sy) · dpr · Verschiebung(x, y) · Drehung · Spiegelung(dir)
  const a = f.sx * k * cos * dir;
  const b = f.sy * k * sin * dir;
  const c = -f.sx * k * sin;
  const d = f.sy * k * cos;
  let e = f.sx * k * x + (f.tx ?? 0);
  let fy = f.sy * k * y + (f.ty ?? 0);
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
