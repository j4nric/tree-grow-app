/**
 * Eigene Zeichnungen für alle Arten aus DESIGN_V2.md 5.3 (IDs wie in scripts/v2/content.ts),
 * die nicht schon im Prototyp (animals.ts) gezeichnet wurden.
 *
 * Konvention: Blick nach rechts, Ursprung = Ankerpunkt (Füße am Boden bzw. Kontaktstelle),
 * 1 Einheit = Grundgröße × `size`. Flacher Stil mit dunklem Umriss, ruhige Farben.
 */

import { ell, ellPath, eye, line, OUTLINE, outline, paintBird, poly, polyPath, TAU, type BirdColors, type SpriteDef } from './sprite-kit';

export type Motion = 'hop' | 'peck' | 'hover' | 'crawl' | 'inch' | 'wiggle' | 'sniff' | 'still' | 'blink' | 'busy';

export interface KindInfo {
  /** Größe relativ zur Grundgröße. */
  size: number;
  motion: Motion;
  frames: number;
  /** Klammert sich seitlich an die Rinde (Specht) statt darauf zu krabbeln. */
  cling?: boolean;
  /** Pilz: Hutpilz am Boden oder Konsole am Holz. */
  fungus?: 'cap' | 'bracket';
}

// ---------------------------------------------------------------------------
// Vögel
// ---------------------------------------------------------------------------

const BIRD_JAY: BirdColors = {
  back: '#b8927c',
  wing: '#5e4e45',
  tail: '#2c2a2c',
  head: '#cdb29d',
  breast: '#cfa58c',
  belly: '#ecdccc',
  beak: '#3a3330',
  leg: '#9a8070',
};

/** Eichelhäher: rosabraun, schwarzer Bartstreif, blau gebänderter Flügelfleck. */
function paintJay(c: CanvasRenderingContext2D): void {
  paintBird(c, BIRD_JAY);
  // Blauer Flügelfleck mit schwarzen Bändern, weißer Spiegel
  ell(c, 0.02, -0.46, 0.1, 0.06, 0.28, '#4f86c6');
  for (const x of [-0.04, 0.02, 0.08]) line(c, [x, -0.51, x - 0.02, -0.41], '#1f2a3a', 0.022);
  ell(c, -0.14, -0.4, 0.07, 0.04, 0.28, '#f1ede6');
  // Gestrichelter Scheitel und Bartstreif
  for (const x of [0.12, 0.19, 0.26]) line(c, [x, -0.84, x + 0.02, -0.78], '#3a3330', 0.025);
  line(c, [0.36, -0.64, 0.26, -0.55], '#1f1d1e', 0.045);
}

/** Schwarzspecht an der Rinde: ganz schwarz, roter Scheitel, heller Schnabel; Kontaktstelle (0, 0). */
function paintBlackWoodpecker(c: CanvasRenderingContext2D): void {
  c.translate(0, 0.42);
  const black = '#1f1f24';
  const sheen = '#3a3a44';
  const red = '#c9302a';
  outline(c, 0.1, () => {
    polyPath(c, [-0.18, -0.18, -0.02, -0.14, 0.03, 0.32, -0.12, 0.34]);
    ellPath(c, -0.16, -0.46, 0.2, 0.4, -0.1);
    ellPath(c, -0.1, -0.92, 0.17, 0.17);
  });
  poly(c, [-0.18, -0.18, -0.02, -0.14, 0.03, 0.32, -0.12, 0.34], black);
  ell(c, -0.16, -0.46, 0.2, 0.4, -0.1, black);
  ell(c, -0.22, -0.58, 0.08, 0.2, -0.1, sheen);
  // Kopf mit rotem Scheitel bis in den Nacken
  ell(c, -0.1, -0.92, 0.17, 0.17, 0, black);
  c.fillStyle = red;
  c.beginPath();
  c.ellipse(-0.11, -0.97, 0.15, 0.12, -0.2, Math.PI * 1.05, Math.PI * 2.05);
  c.closePath();
  c.fill();
  ell(c, -0.24, -0.92, 0.05, 0.08, 0.3, red);
  poly(c, [0.04, -0.95, 0.32, -0.91, 0.04, -0.86], '#e3d9b8');
  line(c, [0.06, -0.905, 0.3, -0.905], 'rgba(70, 60, 40, 0.5)', 0.012);
  ell(c, -0.02, -0.92, 0.042, 0.042, 0, '#f2eee2');
  eye(c, -0.02, -0.92, 0.028);
  line(c, [0.0, -0.3, 0.07, -0.27], '#55504a', 0.04);
  line(c, [0.01, -0.18, 0.08, -0.16], '#55504a', 0.04);
}

/** Waldkauz in der Höhle, frontal; Boden der Höhle auf (0, 0). Frame 1 = blinzelt. */
function paintOwl(c: CanvasRenderingContext2D, frame: number): void {
  const body = '#8b6643';
  const dark = '#5e432b';
  const disc = '#c29a6c';
  outline(c, 0.09, () => {
    ellPath(c, 0, -0.33, 0.3, 0.34);
    ellPath(c, 0, -0.6, 0.27, 0.2);
  });
  ell(c, 0, -0.33, 0.3, 0.34, 0, body);
  // Flügel an den Seiten, gebänderte Brust
  ell(c, -0.22, -0.3, 0.1, 0.24, 0.15, dark);
  ell(c, 0.22, -0.3, 0.1, 0.24, -0.15, dark);
  ell(c, 0, -0.25, 0.17, 0.22, 0, '#bf9a72');
  for (const [x, y] of [
    [-0.08, -0.36],
    [0.07, -0.33],
    [-0.04, -0.22],
    [0.09, -0.18],
    [-0.1, -0.12],
  ] as const) {
    line(c, [x, y, x + 0.01, y + 0.07], '#6d4d32', 0.03);
  }
  // Kopf mit Gesichtsschleier
  ell(c, 0, -0.6, 0.27, 0.2, 0, body);
  ell(c, -0.09, -0.6, 0.12, 0.13, 0, disc);
  ell(c, 0.09, -0.6, 0.12, 0.13, 0, disc);
  line(c, [-0.02, -0.75, 0, -0.66, 0.02, -0.75], '#6d4d32', 0.03);
  if (frame === 1) {
    line(c, [-0.14, -0.6, -0.09, -0.57, -0.04, -0.6], '#2a1d14', 0.03);
    line(c, [0.04, -0.6, 0.09, -0.57, 0.14, -0.6], '#2a1d14', 0.03);
  } else {
    eye(c, -0.085, -0.61, 0.055);
    eye(c, 0.085, -0.61, 0.055);
  }
  poly(c, [-0.03, -0.55, 0.03, -0.55, 0, -0.48], '#e2c789');
  // Krallen am Höhlenrand
  line(c, [-0.08, -0.02, -0.08, 0.02], '#9d8a6a', 0.04);
  line(c, [0.08, -0.02, 0.08, 0.02], '#9d8a6a', 0.04);
}

// ---------------------------------------------------------------------------
// Säugetiere
// ---------------------------------------------------------------------------

/** Wühlmaus: rund, kurzer Schwanz, kleine Ohren; Füße auf (0, 0). */
function paintVole(c: CanvasRenderingContext2D): void {
  const fur = '#7c654f';
  line(c, [-0.3, -0.12, -0.42, -0.1], '#8e7560', 0.045);
  outline(c, 0.1, () => {
    ellPath(c, 0, -0.2, 0.32, 0.2);
    ellPath(c, 0.27, -0.24, 0.15, 0.13);
  });
  ell(c, 0, -0.2, 0.32, 0.2, 0, fur);
  ell(c, -0.05, -0.29, 0.2, 0.08, 0, '#8f7760');
  ell(c, 0.06, -0.09, 0.22, 0.08, 0, '#b49e84');
  ell(c, 0.27, -0.24, 0.15, 0.13, 0, fur);
  ell(c, 0.19, -0.35, 0.05, 0.045, 0, '#a07f6a');
  ell(c, 0.41, -0.23, 0.025, 0.025, 0, '#3e2c26');
  eye(c, 0.32, -0.28, 0.03);
  line(c, [-0.14, -0.02, -0.14, 0.0], '#5c4734', 0.06);
  line(c, [0.15, -0.02, 0.17, 0.0], '#5c4734', 0.06);
}

/** Maulwurf: samtschwarz, rosa Schaufelhände und Rüssel; Füße auf (0, 0). */
function paintMole(c: CanvasRenderingContext2D): void {
  const fur = '#2f2c30';
  outline(c, 0.1, () => {
    ellPath(c, 0, -0.2, 0.36, 0.19);
    ellPath(c, 0.3, -0.2, 0.14, 0.11);
  });
  line(c, [-0.34, -0.2, -0.43, -0.22], '#d9a3a0', 0.04);
  ell(c, 0, -0.2, 0.36, 0.19, 0, fur);
  ell(c, -0.06, -0.29, 0.22, 0.06, 0, '#4a464c');
  ell(c, 0.3, -0.2, 0.14, 0.11, 0, fur);
  // Rüssel
  poly(c, [0.38, -0.25, 0.56, -0.2, 0.38, -0.15], '#d9a3a0');
  ell(c, 0.56, -0.2, 0.025, 0.025, 0, '#b77a78');
  ell(c, 0.32, -0.25, 0.015, 0.015, 0, '#111');
  // Große Grabhand vorn, Hinterfuß
  ell(c, 0.24, -0.04, 0.1, 0.06, -0.4, '#e3b0aa');
  for (const k of [-1, 0, 1]) line(c, [0.3, -0.06 + k * 0.025, 0.36, -0.08 + k * 0.035], '#c98f8a', 0.02);
  ell(c, -0.2, -0.02, 0.07, 0.035, 0, '#d9a3a0');
}

/** Eichhörnchen sitzend mit buschigem Schwanz und Nuss; Füße auf (0, 0). */
function paintSquirrel(c: CanvasRenderingContext2D): void {
  const fur = '#b2552c';
  const dark = '#8f4021';
  const belly = '#f0e2cc';
  outline(c, 0.1, () => {
    ellPath(c, -0.22, -0.46, 0.16, 0.34, -0.25);
    ellPath(c, -0.12, -0.83, 0.13, 0.1, -0.5);
    ellPath(c, 0.05, -0.27, 0.17, 0.24, 0.25);
    ellPath(c, 0.18, -0.58, 0.13, 0.12);
  });
  // Schwanz: S-Bogen hinter dem Rücken
  ell(c, -0.22, -0.46, 0.16, 0.34, -0.25, dark);
  ell(c, -0.2, -0.48, 0.1, 0.28, -0.25, fur);
  ell(c, -0.12, -0.83, 0.13, 0.1, -0.5, dark);
  ell(c, -0.11, -0.84, 0.08, 0.06, -0.5, fur);
  // Körper
  ell(c, 0.05, -0.27, 0.17, 0.24, 0.25, fur);
  ell(c, 0.12, -0.27, 0.09, 0.18, 0.25, belly);
  ell(c, -0.02, -0.06, 0.12, 0.06, 0, dark);
  // Kopf mit Pinselohren
  poly(c, [0.12, -0.66, 0.11, -0.8, 0.18, -0.68], dark);
  ell(c, 0.18, -0.58, 0.13, 0.12, 0, fur);
  ell(c, 0.24, -0.53, 0.07, 0.05, 0, belly);
  ell(c, 0.31, -0.57, 0.022, 0.022, 0, '#3a2219');
  eye(c, 0.22, -0.61, 0.032);
  // Pfoten mit Nuss
  ell(c, 0.27, -0.4, 0.06, 0.07, 0, '#9a6a3a');
  ell(c, 0.27, -0.45, 0.06, 0.025, 0, '#6b4524');
  line(c, [0.15, -0.38, 0.24, -0.38], fur, 0.05);
}

/** Igel: Stachelkleid, spitze Schnauze; Füße auf (0, 0). */
function paintHedgehog(c: CanvasRenderingContext2D): void {
  const pts: number[] = [];
  const n = 15;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI * 0.92;
    const r = i % 2 === 0 ? 1.12 : 0.92;
    pts.push(-0.04 + Math.cos(a) * 0.33 * r, -0.08 + Math.sin(a) * 0.27 * r);
  }
  pts.push(0.28, -0.08, -0.37, -0.06);
  outline(c, 0.09, () => {
    polyPath(c, pts);
    ellPath(c, 0.3, -0.12, 0.13, 0.09, 0.2);
  });
  line(c, [-0.18, -0.06, -0.19, 0], '#4a3a2e', 0.05);
  line(c, [0.14, -0.06, 0.15, 0], '#4a3a2e', 0.05);
  poly(c, pts, '#6e5640');
  // Helle Stachelspitzen
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * 1.08 + (i / 8) * Math.PI * 0.74;
    const x = -0.04 + Math.cos(a) * 0.24;
    const y = -0.08 + Math.sin(a) * 0.19;
    line(c, [x, y, x + Math.cos(a) * 0.07, y + Math.sin(a) * 0.07], '#d8c6a6', 0.025);
  }
  // Gesicht
  ell(c, 0.3, -0.12, 0.13, 0.09, 0.2, '#c7a37a');
  poly(c, [0.36, -0.17, 0.5, -0.09, 0.36, -0.05], '#c7a37a');
  ell(c, 0.5, -0.09, 0.03, 0.025, 0, '#2a1e18');
  eye(c, 0.33, -0.15, 0.03);
  ell(c, 0.24, -0.19, 0.04, 0.03, 0, '#a8835c');
}

/** Rotfuchs: orange, weiße Brust und Schwanzspitze, schwarze Läufe; Füße auf (0, 0). */
function paintFox(c: CanvasRenderingContext2D): void {
  const fur = '#cf6f2e';
  const dark = '#b45a24';
  const white = '#f3ece0';
  const leg = '#3a2a22';
  // Hintere Läufe
  line(c, [-0.2, -0.28, -0.24, -0.12, -0.2, 0], leg, 0.055);
  line(c, [0.2, -0.26, 0.21, 0], leg, 0.05);
  outline(c, 0.09, () => {
    ellPath(c, -0.5, -0.27, 0.24, 0.085, 0.38);
    ellPath(c, 0, -0.34, 0.3, 0.12, -0.03);
    ellPath(c, 0.33, -0.48, 0.11, 0.095);
    polyPath(c, [0.38, -0.53, 0.56, -0.44, 0.38, -0.41]);
    polyPath(c, [0.25, -0.55, 0.28, -0.7, 0.35, -0.56]);
  });
  // Schwanz mit weißer Spitze
  ell(c, -0.5, -0.27, 0.24, 0.085, 0.38, dark);
  ell(c, -0.48, -0.29, 0.18, 0.05, 0.38, fur);
  ell(c, -0.7, -0.18, 0.06, 0.05, 0.38, white);
  // Vordere Läufe
  line(c, [-0.14, -0.28, -0.13, 0], leg, 0.05);
  line(c, [0.15, -0.28, 0.14, 0], leg, 0.05);
  // Körper
  ell(c, 0, -0.34, 0.3, 0.12, -0.03, fur);
  ell(c, -0.02, -0.41, 0.24, 0.05, -0.03, dark);
  ell(c, 0.22, -0.33, 0.08, 0.1, 0, white);
  // Kopf
  poly(c, [0.25, -0.55, 0.28, -0.7, 0.35, -0.56], fur);
  poly(c, [0.27, -0.62, 0.28, -0.7, 0.31, -0.63], '#3a2a22');
  ell(c, 0.33, -0.48, 0.11, 0.095, 0, fur);
  poly(c, [0.38, -0.53, 0.56, -0.44, 0.38, -0.41], fur);
  poly(c, [0.33, -0.44, 0.54, -0.43, 0.38, -0.39], white);
  ell(c, 0.555, -0.44, 0.025, 0.022, 0, '#2a1e18');
  eye(c, 0.39, -0.5, 0.028);
}

const WOLF_TAIL = [-0.28, -0.5, -0.4, -0.42, -0.47, -0.24, -0.44, -0.12, -0.38, -0.16, -0.36, -0.34, -0.26, -0.4];

/** Wolf: grau, hochbeinig, hängender Schwanz, helle Maske; Füße auf (0, 0). */
function paintWolf(c: CanvasRenderingContext2D): void {
  const fur = '#8c8a83';
  const saddle = '#5f5d59';
  const light = '#d8d2c4';
  const leg = '#77736b';
  line(c, [-0.24, -0.34, -0.29, -0.16, -0.24, 0], leg, 0.06);
  line(c, [0.2, -0.32, 0.21, 0], leg, 0.055);
  outline(c, 0.09, () => {
    polyPath(c, WOLF_TAIL);
    ellPath(c, -0.01, -0.42, 0.32, 0.13, -0.04);
    ellPath(c, 0.33, -0.57, 0.13, 0.11);
    polyPath(c, [0.38, -0.62, 0.6, -0.53, 0.58, -0.47, 0.38, -0.47]);
    polyPath(c, [0.24, -0.64, 0.27, -0.8, 0.34, -0.65]);
  });
  // Schwanz hängt
  poly(c, WOLF_TAIL, saddle);
  ell(c, -0.43, -0.17, 0.045, 0.06, 0.3, '#3e3c39');
  line(c, [-0.15, -0.34, -0.14, 0], leg, 0.055);
  line(c, [0.14, -0.34, 0.13, 0], leg, 0.055);
  ell(c, -0.01, -0.42, 0.32, 0.13, -0.04, fur);
  ell(c, -0.06, -0.5, 0.24, 0.06, -0.04, saddle);
  ell(c, 0.02, -0.33, 0.22, 0.04, 0, light);
  ell(c, 0.23, -0.43, 0.08, 0.1, 0, light);
  // Kopf
  poly(c, [0.24, -0.64, 0.27, -0.8, 0.34, -0.65], saddle);
  ell(c, 0.33, -0.57, 0.13, 0.11, 0, fur);
  poly(c, [0.38, -0.62, 0.6, -0.53, 0.58, -0.47, 0.38, -0.47], fur);
  poly(c, [0.34, -0.52, 0.58, -0.49, 0.4, -0.45], light);
  ell(c, 0.32, -0.53, 0.06, 0.05, 0, light);
  ell(c, 0.6, -0.52, 0.03, 0.026, 0, '#26221f');
  eye(c, 0.39, -0.6, 0.03);
}

/** Reh (Bock mit kleinem Gehörn); Hufe auf (0, 0). */
function paintDeer(c: CanvasRenderingContext2D): void {
  const fur = '#a8703f';
  const dark = '#8a5a32';
  const light = '#d4ae82';
  const leg = '#7d522e';
  const hoof = '#2e2620';
  // Hintere Läufe (dunkler, weiter weg)
  line(c, [-0.24, -0.52, -0.29, -0.28, -0.24, 0], dark, 0.05);
  line(c, [0.2, -0.5, 0.22, 0], dark, 0.045);
  outline(c, 0.075, () => {
    ellPath(c, -0.02, -0.6, 0.36, 0.15, -0.04);
    polyPath(c, [0.18, -0.66, 0.29, -0.92, 0.4, -0.88, 0.34, -0.58]);
    ellPath(c, 0.4, -0.93, 0.1, 0.075, 0.35);
    polyPath(c, [0.44, -0.97, 0.56, -0.87, 0.5, -0.83, 0.4, -0.88]);
  });
  line(c, [-0.18, -0.52, -0.21, -0.3, -0.18, 0], leg, 0.05);
  line(c, [0.14, -0.5, 0.15, 0], leg, 0.045);
  for (const x of [-0.24, -0.18, 0.15, 0.22]) ell(c, x, -0.01, 0.025, 0.018, 0, hoof);
  // Körper mit hellem Spiegel
  ell(c, -0.02, -0.6, 0.36, 0.15, -0.04, fur);
  ell(c, 0.0, -0.5, 0.26, 0.05, 0, light);
  ell(c, -0.06, -0.69, 0.26, 0.05, -0.04, '#b47c49');
  ell(c, -0.36, -0.62, 0.06, 0.085, 0, '#f2e9da');
  // Hals und Kopf
  poly(c, [0.18, -0.66, 0.29, -0.92, 0.4, -0.88, 0.34, -0.58], fur);
  ell(c, 0.4, -0.93, 0.1, 0.075, 0.35, fur);
  poly(c, [0.44, -0.97, 0.56, -0.87, 0.5, -0.83, 0.4, -0.88], fur);
  ell(c, 0.54, -0.86, 0.03, 0.025, 0, '#2a201a');
  ell(c, 0.47, -0.84, 0.05, 0.02, 0.6, light);
  // Ohren und Gehörn
  ell(c, 0.31, -1.0, 0.035, 0.075, -0.55, dark);
  ell(c, 0.34, -1.01, 0.03, 0.07, -0.25, fur);
  line(c, [0.38, -0.99, 0.37, -1.14], '#6b5038', 0.03);
  line(c, [0.375, -1.08, 0.41, -1.12], '#6b5038', 0.025);
  line(c, [0.41, -0.98, 0.42, -1.12], '#7c5d42', 0.028);
  eye(c, 0.43, -0.95, 0.03);
}

/** Braunes Langohr aufrecht in der Höhle, in die Flügel gehüllt, riesige Ohren; Höhlenboden auf (0, 0). */
function paintBat(c: CanvasRenderingContext2D): void {
  const fur = '#8b6a4f';
  const wing = '#4c3a2e';
  const ear = '#b98f74';
  const inner = '#e2b8a0';
  outline(c, 0.09, () => {
    ellPath(c, 0, -0.26, 0.2, 0.27);
    ellPath(c, -0.11, -0.74, 0.075, 0.21, -0.3);
    ellPath(c, 0.11, -0.74, 0.075, 0.21, 0.3);
    ellPath(c, 0, -0.52, 0.11, 0.1);
  });
  // Flügel mit Daumenkrallen
  ell(c, 0, -0.26, 0.2, 0.27, 0, wing);
  ell(c, 0, -0.27, 0.1, 0.21, 0, fur);
  line(c, [-0.15, -0.44, -0.12, -0.08], '#6a5242', 0.022);
  line(c, [0.15, -0.44, 0.12, -0.08], '#6a5242', 0.022);
  ell(c, -0.16, -0.47, 0.025, 0.02, 0, '#2e221a');
  ell(c, 0.16, -0.47, 0.025, 0.02, 0, '#2e221a');
  // Große Ohren und Kopf
  ell(c, -0.11, -0.74, 0.075, 0.21, -0.3, ear);
  ell(c, 0.11, -0.74, 0.075, 0.21, 0.3, ear);
  ell(c, -0.105, -0.73, 0.038, 0.15, -0.3, inner);
  ell(c, 0.105, -0.73, 0.038, 0.15, 0.3, inner);
  ell(c, 0, -0.52, 0.11, 0.1, 0, fur);
  eye(c, -0.04, -0.54, 0.024);
  eye(c, 0.04, -0.54, 0.024);
  ell(c, 0, -0.48, 0.03, 0.02, 0, '#5a4234');
}

// ---------------------------------------------------------------------------
// Insekten
// ---------------------------------------------------------------------------

/** Augenfleck des Tagpfauenauges. */
function peacockEye(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ell(c, x, y, r, r * 0.85, 0, '#2a2526');
  ell(c, x, y, r * 0.74, r * 0.62, 0, '#5d8fc4');
  ell(c, x - r * 0.12, y - r * 0.14, r * 0.42, r * 0.34, 0, '#f2d67e');
  ell(c, x + r * 0.12, y + r * 0.1, r * 0.26, r * 0.2, 0, '#2a2526');
}

/**
 * Tagpfauenauge von oben (leicht gekippt), Mitte auf (0, 0).
 * Frame 0 = Flügel offen, 1 = beim Flügelschlag halb geschlossen.
 */
function paintPeacock(c: CanvasRenderingContext2D, frame: number): void {
  c.save();
  c.rotate(0.35);
  const k = frame === 1 ? 0.5 : 1;
  const wings = (s: number) => {
    // Vorderflügel (groß, oben) und Hinterflügel (rund, unten)
    c.moveTo(0, -0.04);
    c.bezierCurveTo(s * 0.1 * k, -0.3, s * 0.36 * k, -0.4, s * 0.4 * k, -0.3);
    c.bezierCurveTo(s * 0.42 * k, -0.18, s * 0.3 * k, -0.06, 0, 0.0);
    c.closePath();
    c.moveTo(0, 0.0);
    c.bezierCurveTo(s * 0.3 * k, -0.02, s * 0.34 * k, 0.18, s * 0.22 * k, 0.24);
    c.bezierCurveTo(s * 0.12 * k, 0.28, s * 0.04 * k, 0.16, 0, 0.08);
    c.closePath();
  };
  outline(c, 0.08, () => {
    wings(1);
    wings(-1);
  });
  c.fillStyle = '#b3402c';
  c.beginPath();
  wings(1);
  wings(-1);
  c.fill();
  // Dunkler Flügelrand und Augenflecken
  for (const s of [-1, 1]) {
    ell(c, s * 0.2 * k, 0.17, 0.09 * k, 0.07, s * 0.4, '#4a2a26');
    peacockEye(c, s * 0.29 * k, -0.27, 0.075 * Math.max(k, 0.7));
    peacockEye(c, s * 0.19 * k, 0.15, 0.06 * Math.max(k, 0.7));
    ell(c, s * 0.15 * k, -0.25, 0.035 * k, 0.02, 0, '#2a2526');
  }
  // Körper und Fühler
  line(c, [0, -0.12, 0, 0.16], '#2a2224', 0.06);
  ell(c, 0, -0.14, 0.035, 0.035, 0, '#2a2224');
  line(c, [0, -0.15, -0.07, -0.3], '#2a2224', 0.018);
  line(c, [0, -0.15, 0.07, -0.3], '#2a2224', 0.018);
  c.restore();
}

/** Glühwürmchen im Flug mit leuchtendem Hinterleib; Mitte auf (0, 0). */
function paintGlowworm(c: CanvasRenderingContext2D): void {
  const glow = c.createRadialGradient(-0.12, 0.04, 0, -0.12, 0.04, 0.55);
  glow.addColorStop(0, 'rgba(236, 255, 150, 0.9)');
  glow.addColorStop(0.3, 'rgba(210, 245, 120, 0.4)');
  glow.addColorStop(1, 'rgba(200, 240, 110, 0)');
  c.fillStyle = glow;
  c.beginPath();
  c.arc(-0.12, 0.04, 0.55, 0, TAU);
  c.fill();
  ell(c, 0.02, -0.12, 0.16, 0.06, -0.5, 'rgba(235, 242, 245, 0.7)');
  outline(c, 0.07, () => {
    ellPath(c, 0, 0, 0.22, 0.1, 0.1);
  });
  ell(c, 0, 0, 0.22, 0.1, 0.1, '#5a4a36');
  ell(c, -0.14, 0.02, 0.1, 0.075, 0.1, '#f2f59a');
  ell(c, -0.14, 0.015, 0.06, 0.045, 0.1, '#ffffe0');
  ell(c, 0.2, -0.01, 0.07, 0.06, 0, '#d9a06a');
  line(c, [0.25, -0.04, 0.34, -0.12], '#3d3226', 0.02);
  ell(c, 0.05, -0.04, 0.12, 0.03, 0.1, 'rgba(255, 230, 190, 0.35)');
}

/** Rote Waldameise: Ameisenhaufen aus Nadeln mit Ameisen; Mitte am Boden auf (0, 0). */
function paintAnthill(c: CanvasRenderingContext2D, frame: number): void {
  const dome = () => {
    c.moveTo(0.62, 0.02);
    c.bezierCurveTo(0.5, -0.32, 0.22, -0.56, 0, -0.56);
    c.bezierCurveTo(-0.22, -0.56, -0.5, -0.32, -0.62, 0.02);
    c.closePath();
  };
  outline(c, 0.08, dome);
  c.fillStyle = '#8b6640';
  c.beginPath();
  dome();
  c.fill();
  // Nadelstruktur
  c.save();
  c.beginPath();
  dome();
  c.clip();
  ell(c, -0.12, -0.36, 0.26, 0.12, -0.2, '#a27a4c');
  const needles: [number, number, number][] = [];
  for (let i = 0; i < 26; i++) {
    const u = ((i * 37) % 26) / 26;
    const v = ((i * 11) % 13) / 13;
    needles.push([-0.5 + u * 1.0, -0.05 - v * 0.48, ((i * 7) % 5) * 0.6 - 1.2]);
  }
  for (const [x, y, a] of needles) {
    line(c, [x, y, x + Math.cos(a) * 0.09, y + Math.sin(a) * 0.09], i2c(x), 0.022);
  }
  c.restore();
  // Ameisen
  const ants: [number, number][] = frame === 0 ? [[-0.3, -0.24], [0.12, -0.44], [0.36, -0.14], [0.6, -0.01]] : [[-0.22, -0.32], [0.2, -0.38], [0.42, -0.08], [0.7, -0.01]];
  for (const [x, y] of ants) {
    ell(c, x - 0.045, y, 0.04, 0.028, 0, '#2a1b16');
    ell(c, x + 0.01, y, 0.025, 0.02, 0, '#9b3a22');
    ell(c, x + 0.05, y - 0.005, 0.025, 0.022, 0, '#2a1b16');
  }
}

function i2c(x: number): string {
  return x < -0.15 ? '#6e4e2e' : x < 0.2 ? '#c49a62' : '#5f4428';
}

/** Hirschkäfer im Profil mit großen Mandibeln; Füße auf (0, 0). */
function paintStagbeetle(c: CanvasRenderingContext2D, frame: number): void {
  const k = frame === 0 ? 0.03 : -0.03;
  for (const [x, s] of [
    [-0.18, 1],
    [-0.02, -1],
    [0.12, 1],
  ] as const) {
    line(c, [x, -0.12, x + k * s - 0.04, -0.04, x + k * s - 0.06, 0], '#24160f', 0.03);
  }
  outline(c, 0.08, () => {
    ellPath(c, -0.08, -0.18, 0.26, 0.12, -0.05);
    ellPath(c, 0.2, -0.2, 0.09, 0.08);
    ellPath(c, 0.31, -0.22, 0.07, 0.06);
  });
  ell(c, -0.08, -0.18, 0.26, 0.12, -0.05, '#4a2a1a');
  ell(c, -0.12, -0.24, 0.17, 0.04, -0.05, 'rgba(255, 220, 180, 0.3)');
  line(c, [-0.32, -0.17, 0.16, -0.2], '#2e1a10', 0.015);
  ell(c, 0.2, -0.2, 0.09, 0.08, 0, '#2e1c13');
  ell(c, 0.31, -0.22, 0.07, 0.06, 0, '#2e1c13');
  // Geweih-Mandibeln
  line(c, [0.34, -0.26, 0.46, -0.36, 0.6, -0.36, 0.66, -0.3], OUTLINE, 0.08);
  line(c, [0.34, -0.26, 0.46, -0.36, 0.6, -0.36, 0.66, -0.3], '#8a3f22', 0.045);
  line(c, [0.5, -0.36, 0.52, -0.43], '#8a3f22', 0.03);
  line(c, [0.36, -0.2, 0.5, -0.23, 0.6, -0.2], '#6e3019', 0.035);
  line(c, [0.3, -0.27, 0.36, -0.38], '#24160f', 0.018);
}

// ---------------------------------------------------------------------------
// Bodenleben
// ---------------------------------------------------------------------------

/** Nacktschnecke (Rote Wegschnecke): orangebraun, Mantelschild, Fühler; Fuß auf (0, 0). */
function paintSlug(c: CanvasRenderingContext2D): void {
  const body = '#c0662f';
  const dark = '#9a4e22';
  const build = () => {
    c.moveTo(-0.5, -0.02);
    c.quadraticCurveTo(-0.3, -0.2, 0.05, -0.2);
    c.quadraticCurveTo(0.34, -0.22, 0.42, -0.1);
    c.lineTo(0.44, 0);
    c.lineTo(-0.5, 0);
    c.closePath();
  };
  outline(c, 0.08, build);
  c.fillStyle = body;
  c.beginPath();
  build();
  c.fill();
  // Rillen am Körper
  for (let i = 0; i < 5; i++) {
    const x = -0.4 + i * 0.09;
    line(c, [x, -0.04, x + 0.05, -0.13 + i * 0.005], dark, 0.018);
  }
  ell(c, 0.18, -0.15, 0.17, 0.07, 0, '#cf7a40');
  ell(c, 0.16, -0.17, 0.1, 0.025, 0, 'rgba(255, 230, 200, 0.4)');
  ell(c, 0.27, -0.14, 0.02, 0.02, 0, dark);
  ell(c, 0.02, -0.02, 0.4, 0.02, 0, '#e19a62');
  line(c, [0.38, -0.12, 0.46, -0.3], dark, 0.03);
  line(c, [0.4, -0.1, 0.54, -0.24], dark, 0.03);
  ell(c, 0.46, -0.31, 0.025, 0.025, 0, '#3a2014');
  ell(c, 0.54, -0.25, 0.025, 0.025, 0, '#3a2014');
}

/** Feuersalamander: schwarz mit gelben Flecken; Füße auf (0, 0). Frame = Beinstellung. */
function paintSalamander(c: CanvasRenderingContext2D, frame: number): void {
  const black = '#1f1d1f';
  const yellow = '#f0c02e';
  const k = frame === 0 ? 0.05 : -0.05;
  for (const [x, s] of [
    [-0.18, 1],
    [0.18, -1],
  ] as const) {
    line(c, [x, -0.08, x + k * s, 0, x + k * s + 0.04, 0], black, 0.05);
    line(c, [x + 0.04, -0.08, x - k * s + 0.04, -0.01], '#3b383b', 0.045);
  }
  const tail = [-0.26, -0.1, -0.5, -0.1, -0.72, -0.02, -0.5, -0.05, -0.26, -0.04];
  outline(c, 0.08, () => {
    polyPath(c, tail);
    ellPath(c, 0, -0.09, 0.3, 0.07);
    ellPath(c, 0.33, -0.1, 0.1, 0.07);
  });
  poly(c, tail, black);
  ell(c, 0, -0.09, 0.3, 0.07, 0, black);
  ell(c, 0.33, -0.1, 0.1, 0.07, 0, black);
  // Gelbe Flecken und Ohrdrüsen
  for (const [x, y, rx] of [
    [-0.18, -0.11, 0.06],
    [-0.02, -0.12, 0.05],
    [0.13, -0.11, 0.055],
    [-0.38, -0.08, 0.05],
    [-0.56, -0.06, 0.035],
    [0.08, -0.07, 0.03],
  ] as const) {
    ell(c, x, y, rx, rx * 0.55, 0, yellow);
  }
  ell(c, 0.3, -0.14, 0.05, 0.03, 0, yellow);
  ell(c, 0.1, -0.13, 0.22, 0.015, 0, 'rgba(255,255,255,0.18)');
  eye(c, 0.37, -0.13, 0.026);
}

// ---------------------------------------------------------------------------
// Pilze
// ---------------------------------------------------------------------------

/** Pfifferlinge: dottergelbe Trichter mit welligem Rand; Fuß auf (0, 0). */
function paintChanterelle(c: CanvasRenderingContext2D): void {
  const one = (x: number, s: number) => {
    const shape = () => {
      c.moveTo(x - 0.05 * s, 0);
      c.lineTo(x - 0.07 * s, -0.22 * s);
      c.quadraticCurveTo(x - 0.28 * s, -0.36 * s, x - 0.27 * s, -0.46 * s);
      c.quadraticCurveTo(x, -0.38 * s, x + 0.27 * s, -0.47 * s);
      c.quadraticCurveTo(x + 0.28 * s, -0.36 * s, x + 0.07 * s, -0.22 * s);
      c.lineTo(x + 0.05 * s, 0);
      c.closePath();
    };
    outline(c, 0.08, shape);
    c.fillStyle = '#e6a937';
    c.beginPath();
    shape();
    c.fill();
    ell(c, x, -0.44 * s, 0.25 * s, 0.05 * s, 0, '#f2c055');
    for (const dx of [-0.12, -0.04, 0.04, 0.12]) line(c, [x + dx * s * 0.4, -0.25 * s, x + dx * s, -0.4 * s], '#c98a28', 0.018);
  };
  one(-0.2, 0.75);
  one(0.12, 1);
}

/** Steinpilz: dicker, heller Stiel, brauner Hut; Fuß auf (0, 0). */
function paintPorcini(c: CanvasRenderingContext2D): void {
  const one = (x: number, s: number) => {
    const stem = () => {
      c.moveTo(x - 0.1 * s, -0.3 * s);
      c.quadraticCurveTo(x - 0.2 * s, -0.08 * s, x - 0.12 * s, 0);
      c.lineTo(x + 0.12 * s, 0);
      c.quadraticCurveTo(x + 0.2 * s, -0.08 * s, x + 0.1 * s, -0.3 * s);
      c.closePath();
    };
    outline(c, 0.08, () => {
      stem();
      c.moveTo(x + 0.3 * s, -0.32 * s);
      c.ellipse(x, -0.32 * s, 0.3 * s, 0.2 * s, 0, 0, Math.PI, true);
      c.closePath();
    });
    c.fillStyle = '#e8dcc0';
    c.beginPath();
    stem();
    c.fill();
    // Netzzeichnung am Stiel
    for (const dy of [0.08, 0.15, 0.22]) line(c, [x - 0.08 * s, -dy * s, x + 0.08 * s, -dy * s - 0.02 * s], 'rgba(170, 150, 110, 0.5)', 0.012);
    c.fillStyle = '#7b4a26';
    c.beginPath();
    c.ellipse(x, -0.32 * s, 0.3 * s, 0.2 * s, 0, 0, Math.PI, true);
    c.closePath();
    c.fill();
    ell(c, x, -0.315 * s, 0.28 * s, 0.03 * s, 0, '#d9c58e');
    ell(c, x - 0.1 * s, -0.43 * s, 0.1 * s, 0.04 * s, -0.3, 'rgba(255, 225, 180, 0.4)');
  };
  one(-0.2, 0.7);
  one(0.1, 1);
}

/** Fliegenpilz: roter Hut mit weißen Flocken, Stiel mit Ring; Fuß auf (0, 0). */
function paintFlyagaric(c: CanvasRenderingContext2D): void {
  const one = (x: number, s: number, open: boolean) => {
    const capRy = open ? 0.18 : 0.24;
    outline(c, 0.08, () => {
      c.rect(x - 0.06 * s, -0.4 * s, 0.12 * s, 0.4 * s);
      c.moveTo(x + 0.3 * s, -0.4 * s);
      c.ellipse(x, -0.4 * s, 0.3 * s, capRy * s, 0, 0, Math.PI, true);
      c.closePath();
    });
    c.fillStyle = '#f2ece0';
    c.fillRect(x - 0.06 * s, -0.4 * s, 0.12 * s, 0.4 * s);
    ell(c, x, 0, 0.09 * s, 0.04 * s, 0, '#f2ece0');
    ell(c, x, -0.27 * s, 0.1 * s, 0.03 * s, 0, '#e2d8c4');
    c.fillStyle = '#c8322a';
    c.beginPath();
    c.ellipse(x, -0.4 * s, 0.3 * s, capRy * s, 0, 0, Math.PI, true);
    c.closePath();
    c.fill();
    ell(c, x - 0.1 * s, -(0.4 + capRy * 0.7) * s, 0.09 * s, 0.03 * s, -0.3, 'rgba(255, 200, 180, 0.4)');
    for (const [dx, dy, r] of [
      [-0.17, 0.06, 0.035],
      [-0.05, 0.13, 0.04],
      [0.09, 0.1, 0.035],
      [0.2, 0.04, 0.03],
      [0.0, 0.03, 0.03],
      [-0.22, 0.015, 0.025],
    ] as const) {
      ell(c, x + dx * s, -(0.4 + dy * (capRy / 0.18)) * s, r * s, r * 0.8 * s, 0, '#f6f2ea');
    }
  };
  one(-0.24, 0.62, false);
  one(0.1, 1, true);
}

/** Hallimasch: Büschel honiggelber Hüte auf schlanken Stielen; Fuß auf (0, 0). */
function paintHoneyfungus(c: CanvasRenderingContext2D): void {
  const caps: [number, number, number, number][] = [
    [-0.32, -0.28, 0.13, -0.35],
    [-0.14, -0.46, 0.15, -0.12],
    [0.06, -0.52, 0.17, 0.05],
    [0.25, -0.38, 0.14, 0.3],
    [0.38, -0.22, 0.11, 0.45],
    [-0.04, -0.3, 0.12, 0],
  ];
  // Stiele aus einem gemeinsamen Fuß
  for (const [x, y] of caps) line(c, [x * 0.25, 0, x * 0.7, y * 0.5, x, y], OUTLINE, 0.085);
  for (const [x, y] of caps) line(c, [x * 0.25, 0, x * 0.7, y * 0.5, x, y], '#e8d9b4', 0.05);
  ell(c, 0, -0.02, 0.16, 0.05, 0, '#b89a6a');
  for (const [x, y, r, rot] of caps) {
    outline(c, 0.07, () => {
      c.moveTo(x + r, y);
      c.ellipse(x, y, r, r * 0.6, rot, Math.PI, TAU);
      c.closePath();
    });
  }
  for (const [x, y, r, rot] of caps) {
    c.fillStyle = '#c9933e';
    c.beginPath();
    c.ellipse(x, y, r, r * 0.6, rot, Math.PI, TAU);
    c.closePath();
    c.fill();
    ell(c, x + Math.sin(rot) * r * 0.25, y - r * 0.32, r * 0.35, r * 0.18, rot, '#8a5a2a');
    // feine dunkle Schüppchen
    ell(c, x - r * 0.4, y - r * 0.15, r * 0.06, r * 0.05, 0, '#7a4f26');
    ell(c, x + r * 0.35, y - r * 0.2, r * 0.06, r * 0.05, 0, '#7a4f26');
  }
}

/** Zunderschwamm: hufförmige Konsole mit grauen Zuwachsringen; wächst von (0, 0) nach rechts. */
function paintTinder(c: CanvasRenderingContext2D): void {
  c.translate(-0.06, 0);
  const shape = (s: number, y: number) => {
    c.moveTo(0, y - 0.24 * s);
    c.bezierCurveTo(0.24 * s, y - 0.26 * s, 0.42 * s, y - 0.12 * s, 0.44 * s, y + 0.06 * s);
    c.lineTo(0.36 * s, y + 0.1 * s);
    c.quadraticCurveTo(0.16 * s, y + 0.06 * s, 0, y + 0.12 * s);
    c.closePath();
  };
  const hoof = (s: number, y: number) => {
    outline(c, 0.08, () => shape(s, y));
    c.fillStyle = '#8f8a82';
    c.beginPath();
    shape(s, y);
    c.fill();
    // Zuwachsringe
    c.save();
    c.beginPath();
    shape(s, y);
    c.clip();
    for (const [k, col] of [
      [0.75, '#a6a097'],
      [0.5, '#7b766f'],
      [0.28, '#b9b3a9'],
    ] as const) {
      line(c, [0, y - 0.24 * s * k - 0.02, 0.3 * s * (0.4 + k * 0.6), y - 0.13 * s * k, 0.44 * s * (0.5 + k * 0.5), y + 0.04 * s], col, 0.04 * s);
    }
    c.restore();
    line(c, [0.02, y + 0.1 * s, 0.38 * s, y + 0.08 * s], '#a07a52', 0.035 * s);
  };
  hoof(1, -0.06);
  hoof(0.62, 0.24);
}

// ---------------------------------------------------------------------------

/** Verhalten und Größe je Art (Schlüssel = Art-ID aus scripts/v2/content.ts). */
export const SPECIES_INFO: Record<string, KindInfo> = {
  // Vögel
  jay: { size: 1.15, motion: 'hop', frames: 1 },
  owl: { size: 1.2, motion: 'blink', frames: 2 },
  blackwoodpecker: { size: 1.25, motion: 'peck', frames: 1, cling: true },
  // Säugetiere
  vole: { size: 1, motion: 'sniff', frames: 1 },
  mole: { size: 1.1, motion: 'sniff', frames: 1 },
  squirrel: { size: 1.1, motion: 'hop', frames: 1 },
  hedgehog: { size: 1.1, motion: 'crawl', frames: 1 },
  fox: { size: 1.7, motion: 'sniff', frames: 1 },
  wolf: { size: 2.05, motion: 'sniff', frames: 1 },
  deer: { size: 2.15, motion: 'sniff', frames: 1 },
  bat: { size: 1, motion: 'still', frames: 1 },
  // Insekten
  peacock: { size: 1.05, motion: 'hover', frames: 2 },
  glowworm: { size: 0.9, motion: 'hover', frames: 1 },
  woodant: { size: 1.25, motion: 'busy', frames: 2 },
  stagbeetle: { size: 1.2, motion: 'busy', frames: 2 },
  // Bodenleben
  slug: { size: 1, motion: 'crawl', frames: 1 },
  salamander: { size: 1.25, motion: 'crawl', frames: 2 },
  // Pilze
  chanterelle: { size: 0.95, motion: 'still', frames: 1, fungus: 'cap' },
  porcini: { size: 1.1, motion: 'still', frames: 1, fungus: 'cap' },
  flyagaric: { size: 1.15, motion: 'still', frames: 1, fungus: 'cap' },
  honeyfungus: { size: 1.2, motion: 'still', frames: 1, fungus: 'cap' },
  tinder: { size: 1.1, motion: 'still', frames: 1, fungus: 'bracket' },
};

/** Zeichnungen je Art; Begrenzung in Zeicheneinheiten. */
export const SPECIES_DEFS: Record<string, SpriteDef> = {
  jay: { x0: -0.72, y0: -0.95, x1: 0.58, y1: 0.08, paint: (c) => paintJay(c) },
  owl: { x0: -0.38, y0: -0.86, x1: 0.38, y1: 0.08, paint: paintOwl },
  blackwoodpecker: { x0: -0.45, y0: -0.75, x1: 0.38, y1: 0.84, paint: (c) => paintBlackWoodpecker(c) },
  vole: { x0: -0.48, y0: -0.46, x1: 0.48, y1: 0.06, paint: (c) => paintVole(c) },
  mole: { x0: -0.48, y0: -0.46, x1: 0.62, y1: 0.06, paint: (c) => paintMole(c) },
  squirrel: { x0: -0.44, y0: -0.98, x1: 0.38, y1: 0.06, paint: (c) => paintSquirrel(c) },
  hedgehog: { x0: -0.46, y0: -0.46, x1: 0.56, y1: 0.06, paint: (c) => paintHedgehog(c) },
  fox: { x0: -0.8, y0: -0.76, x1: 0.62, y1: 0.06, paint: (c) => paintFox(c) },
  wolf: { x0: -0.58, y0: -0.86, x1: 0.66, y1: 0.06, paint: (c) => paintWolf(c) },
  deer: { x0: -0.46, y0: -1.18, x1: 0.62, y1: 0.06, paint: (c) => paintDeer(c) },
  bat: { x0: -0.26, y0: -1.0, x1: 0.26, y1: 0.06, paint: (c) => paintBat(c) },
  peacock: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.46, paint: paintPeacock },
  glowworm: { x0: -0.68, y0: -0.52, x1: 0.44, y1: 0.6, paint: (c) => paintGlowworm(c) },
  woodant: { x0: -0.68, y0: -0.62, x1: 0.78, y1: 0.08, paint: paintAnthill },
  stagbeetle: { x0: -0.4, y0: -0.48, x1: 0.72, y1: 0.06, paint: paintStagbeetle },
  slug: { x0: -0.56, y0: -0.36, x1: 0.6, y1: 0.06, paint: (c) => paintSlug(c) },
  salamander: { x0: -0.78, y0: -0.22, x1: 0.48, y1: 0.06, paint: paintSalamander },
  chanterelle: { x0: -0.46, y0: -0.54, x1: 0.44, y1: 0.06, paint: (c) => paintChanterelle(c) },
  porcini: { x0: -0.46, y0: -0.58, x1: 0.44, y1: 0.06, paint: (c) => paintPorcini(c) },
  flyagaric: { x0: -0.48, y0: -0.7, x1: 0.44, y1: 0.08, paint: (c) => paintFlyagaric(c) },
  honeyfungus: { x0: -0.5, y0: -0.66, x1: 0.56, y1: 0.06, paint: (c) => paintHoneyfungus(c) },
  tinder: { x0: -0.12, y0: -0.38, x1: 0.44, y1: 0.42, paint: (c) => paintTinder(c) },
};
