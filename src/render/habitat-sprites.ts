/**
 * Zeichnungen der Lebensräume (DESIGN_V2.md 23): die 14 Arten von Waldwiese,
 * Totholzhaufen und Trockenmauer, das Ersatzbild der Reptilien (Eidechse) und die
 * Dekos dieser Plätze (Totholzhaufen im Erdschnitt, Lücke im Reisig, Grasbüschel …).
 *
 * Konvention wie species-sprites.ts: Blick nach rechts, Ursprung = Ankerpunkt (Füße am
 * Boden; schwebende Tiere: Körpermitte), 1 Einheit = Grundgröße × `size`. Flacher Stil
 * mit dunklem Umriss, ruhige Farben. Reptilien haben zwei Bilder: 0 ruhend, 1 Kopf gehoben.
 */

import { POND_DEPTH, POND_LIP, PILE_STUMP_HALF, PILE_STUMP_IN } from './anchors';
import { ell, ellPath, eye, line, OUTLINE, outline, poly, polyPath, TAU, type SpriteDef } from './sprite-kit';
import type { KindInfo } from './species-sprites';
import { mulberry32 } from './util';

// ---------------------------------------------------------------------------
// Waldwiese
// ---------------------------------------------------------------------------

/** Feldgrille vor ihrer Erdröhre: schwarz glänzend, großer Kopf; Bild 1 = Flügel zum Zirpen gehoben. */
function paintCricket(c: CanvasRenderingContext2D, frame: number): void {
  const black = '#211d1b';
  const leg = '#2e2724';
  // Erdröhre hinter der Grille
  ell(c, -0.3, -0.03, 0.14, 0.045, 0, 'rgba(40, 28, 18, 0.55)');
  // Beine vorn und Mitte
  line(c, [0.2, -0.1, 0.27, -0.02, 0.31, 0], leg, 0.035);
  line(c, [0.04, -0.1, 0.06, -0.02, 0.1, 0], leg, 0.035);
  outline(c, 0.08, () => {
    ellPath(c, -0.02, -0.14, 0.27, 0.1, -0.04);
    ellPath(c, 0.27, -0.15, 0.12, 0.11);
    ellPath(c, -0.14, -0.11, 0.17, 0.06, 0.4);
  });
  ell(c, -0.02, -0.14, 0.27, 0.1, -0.04, black);
  // Flügel über dem Rücken – zum Zirpen leicht angehoben
  c.save();
  c.translate(0.1, -0.19);
  c.rotate(frame === 1 ? -0.22 : 0);
  ell(c, -0.17, 0, 0.21, 0.055, 0, '#40332a');
  line(c, [-0.34, 0, 0.0, -0.01], '#5c4a3c', 0.015);
  line(c, [-0.28, -0.03, -0.05, 0.02], '#5c4a3c', 0.012);
  c.restore();
  // Gelbe Flügelwurzel
  ell(c, 0.13, -0.2, 0.05, 0.028, 0, '#d4ad48');
  // Kräftiger Hinterschenkel und Schiene
  ell(c, -0.14, -0.11, 0.17, 0.06, 0.4, '#2c2522');
  line(c, [-0.28, -0.04, -0.3, 0, -0.22, 0], leg, 0.035);
  // Großer runder Kopf
  ell(c, 0.27, -0.15, 0.12, 0.11, 0, black);
  ell(c, 0.25, -0.2, 0.06, 0.028, 0, 'rgba(255, 255, 255, 0.22)');
  eye(c, 0.32, -0.18, 0.022);
  // Lange Fühler über den Rücken, Hinterleibsfäden
  line(c, [0.35, -0.21, 0.24, -0.34, 0.0, -0.4, -0.2, -0.38], black, 0.016);
  line(c, [-0.27, -0.15, -0.42, -0.19], black, 0.018);
}

/** Feldmaus sitzt und knabbert einen Grassamen; Füße auf (0, 0). */
function paintFieldmouse(c: CanvasRenderingContext2D): void {
  const fur = '#9a7f5e';
  const back = '#86694b';
  const belly = '#d2c3a6';
  // Grashalm mit Ähre
  line(c, [0.36, 0, 0.33, -0.28, 0.3, -0.42], '#8a9a52', 0.025);
  ell(c, 0.29, -0.47, 0.035, 0.07, 0.2, '#c9b27a');
  line(c, [-0.28, -0.08, -0.4, -0.06, -0.44, -0.1], '#a3876b', 0.035);
  outline(c, 0.1, () => {
    ellPath(c, -0.04, -0.22, 0.26, 0.21, -0.35);
    ellPath(c, 0.19, -0.37, 0.14, 0.12, 0.1);
  });
  ell(c, -0.04, -0.22, 0.26, 0.21, -0.35, fur);
  ell(c, -0.1, -0.3, 0.16, 0.1, -0.6, back);
  ell(c, 0.05, -0.16, 0.13, 0.12, -0.35, belly);
  ell(c, 0.19, -0.37, 0.14, 0.12, 0.1, fur);
  // Kleine, runde Ohren im Fell
  ell(c, 0.11, -0.47, 0.055, 0.05, 0, back);
  ell(c, 0.115, -0.465, 0.03, 0.028, 0, '#c99a8a');
  ell(c, 0.32, -0.36, 0.025, 0.022, 0, '#4a302a');
  eye(c, 0.24, -0.4, 0.03);
  // Pfötchen am Halm, Hinterfuß
  ell(c, 0.27, -0.27, 0.04, 0.03, 0, '#c9a890');
  ell(c, -0.02, -0.02, 0.09, 0.03, 0, '#7a5f45');
}

/** Wildkaninchen sitzt: lange Ohren, weiße Blume; Füße auf (0, 0). */
function paintRabbit(c: CanvasRenderingContext2D): void {
  const fur = '#8f7a62';
  const back = '#7a6550';
  const belly = '#ddd0b9';
  outline(c, 0.1, () => {
    ellPath(c, -0.06, -0.3, 0.3, 0.26);
    ellPath(c, 0.22, -0.52, 0.16, 0.14, 0.15);
    ellPath(c, 0.07, -0.79, 0.06, 0.21, -0.3);
    ellPath(c, 0.15, -0.8, 0.06, 0.2, -0.12);
  });
  // Hinteres Ohr, Körper, Keule
  ell(c, 0.07, -0.79, 0.06, 0.21, -0.3, back);
  ell(c, -0.06, -0.3, 0.3, 0.26, 0, fur);
  ell(c, -0.12, -0.42, 0.2, 0.12, -0.2, back);
  ell(c, -0.14, -0.16, 0.2, 0.15, 0, back);
  ell(c, 0.12, -0.2, 0.13, 0.16, 0.2, belly);
  // Weiße Blume (Schwanz)
  ell(c, -0.34, -0.24, 0.075, 0.07, 0, '#f4efe6');
  // Kopf mit vorderem Ohr
  ell(c, 0.22, -0.52, 0.16, 0.14, 0.15, fur);
  ell(c, 0.15, -0.8, 0.06, 0.2, -0.12, fur);
  ell(c, 0.155, -0.79, 0.03, 0.15, -0.12, '#cfa494');
  line(c, [0.12, -0.99, 0.15, -1.0], '#4a3a2c', 0.03);
  ell(c, 0.33, -0.5, 0.05, 0.04, 0, belly);
  ell(c, 0.37, -0.51, 0.02, 0.018, 0, '#5a3a32');
  eye(c, 0.26, -0.56, 0.036);
  // Vorderpfoten und Hinterfuß
  line(c, [0.2, -0.12, 0.22, 0], back, 0.06);
  ell(c, -0.06, -0.02, 0.15, 0.035, 0, '#6e5a46');
}

/** Waldeidechse: braun, dunkles Flankenband, langer Schwanz; Füße auf (0, 0). Bild 1 = Kopf gehoben. */
function paintLizard(c: CanvasRenderingContext2D, frame: number): void {
  paintLizardBody(c, frame, { body: '#8a6c46', flank: '#4f3c28', stripe: '#b89c6c', belly: '#c9a86a', head: '#7d6040' }, 1);
}

/**
 * Zauneidechse (Männchen im Frühling): kräftig, grüne Flanken, brauner Rückenstreif mit
 * hellen Augenflecken; Füße auf (0, 0). Bild 1 = Kopf gehoben.
 */
function paintSandlizard(c: CanvasRenderingContext2D, frame: number): void {
  paintLizardBody(c, frame, { body: '#6f9a3c', flank: '#4f7a2a', stripe: '#7a5a3a', belly: '#c5d27a', head: '#6a923a', ocelli: true }, 1.12);
}

/** Ersatzbild unbekannter Reptilien: schlichte, olivbraune Eidechse. */
function paintReptile(c: CanvasRenderingContext2D, frame: number): void {
  paintLizardBody(c, frame, { body: '#857a4e', flank: '#5e5636', stripe: '#a59a6c', belly: '#c4b88a', head: '#7a6f46' }, 1);
}

interface LizardColors {
  body: string;
  flank: string;
  stripe: string;
  belly: string;
  head: string;
  /** Helle Augenflecken auf dem Rückenstreif (Zauneidechse). */
  ocelli?: boolean;
}

/** Eidechse flach am Boden (Bild 1: Kopf gehoben); `k` macht Körper und Kopf kräftiger. */
function paintLizardBody(c: CanvasRenderingContext2D, frame: number, col: LizardColors, k: number): void {
  const ry = 0.065 * k;
  const lift = frame === 1 ? 1 : 0;
  // Beine: kurz, seitlich abgespreizt
  for (const [x, s] of [
    [-0.17, 1],
    [0.15, -1],
  ] as const) {
    line(c, [x, -0.06, x - 0.06 * s, -0.01, x - 0.03 * s + 0.05, 0], col.flank, 0.04);
    line(c, [x + 0.03, -0.07, x + 0.07 * s + 0.02, -0.02, x + 0.1 * s + 0.03, 0], col.flank, 0.035);
  }
  const tail = [-0.24, -0.11, -0.5, -0.08, -0.78, -0.02, -0.5, -0.03, -0.24, -0.04];
  const hx = 0.31;
  const hy = -0.08 - 0.06 * lift;
  const rot = -0.3 * lift;
  outline(c, 0.08, () => {
    polyPath(c, tail);
    ellPath(c, 0, -0.08, 0.27, ry);
    ellPath(c, hx, hy, 0.11 * k, 0.06 * k, rot);
  });
  poly(c, tail, col.body);
  ell(c, 0, -0.08, 0.27, ry, 0, col.body);
  // Hals zum gehobenen Kopf
  if (lift) poly(c, [0.16, -0.12, 0.26, -0.18, 0.3, -0.1, 0.18, -0.05], col.body);
  // Flankenband und Bauch
  ell(c, 0, -0.06, 0.25, 0.022 * k, 0, col.flank);
  line(c, [-0.24, -0.06, -0.5, -0.05, -0.68, -0.03], col.flank, 0.016);
  ell(c, 0.02, -0.025, 0.2, 0.015, 0, col.belly);
  // Rückenstreif (Zauneidechse: mit hellen Augenflecken)
  line(c, [-0.5, -0.075, -0.24, -0.1, 0.0, -0.13 * (0.9 + 0.1 * k), 0.2, -0.11], col.stripe, 0.03 * k);
  if (col.ocelli) {
    for (const x of [-0.16, -0.04, 0.08]) {
      ell(c, x, -0.115, 0.022, 0.016, 0, '#3e2c1c');
      ell(c, x, -0.115, 0.009, 0.007, 0, '#f0e6cc');
    }
  }
  // Kopf
  ell(c, hx, hy, 0.11 * k, 0.06 * k, rot, col.head);
  ell(c, hx - 0.02, hy - 0.025 * k, 0.06 * k, 0.018 * k, rot, 'rgba(255, 255, 255, 0.18)');
  eye(c, hx + 0.03, hy - 0.012, 0.018 * k);
  line(c, [hx + 0.06, hy + 0.02 * k, hx + 0.1 * k, hy + 0.012], 'rgba(40, 28, 18, 0.6)', 0.012);
}

/**
 * Turmfalke rüttelt: rotbraun mit dunklen Flecken, grauer Kopf und Schwanz mit dunkler
 * Endbinde, gefächert; Körpermitte auf (0, 0). Bild 0/1 = Flügel oben/unten.
 */
function paintKestrel(c: CanvasRenderingContext2D, frame: number): void {
  const rufous = '#b5673a';
  const dark = '#4a3022';
  const grey = '#8e959c';
  const cream = '#efe2c6';
  const up = frame === 0;
  // Ferner Flügel hinter dem Körper
  wing(c, 0.02, -0.06, up ? -0.26 : -0.12, up ? -0.5 : 0.36, 0.13, '#9a5832', '#3d281c');
  // Gefächerter Schwanz, schräg nach unten
  const tail = [-0.1, 0.06, -0.38, 0.32, -0.3, 0.42, -0.14, 0.44, -0.02, 0.12];
  outline(c, 0.08, () => {
    polyPath(c, tail);
    ellPath(c, 0.02, 0, 0.25, 0.13, -0.6);
    ellPath(c, 0.19, -0.2, 0.11, 0.1);
  });
  poly(c, tail, grey);
  line(c, [-0.35, 0.36, -0.15, 0.4], '#2e2a28', 0.04);
  line(c, [-0.33, 0.405, -0.16, 0.435], '#e6e0d6', 0.02);
  // Körper: Rücken rotbraun, Brust rahmfarben gefleckt
  ell(c, 0.02, 0, 0.25, 0.13, -0.6, rufous);
  ell(c, 0.07, 0.04, 0.15, 0.09, -0.6, cream);
  for (const [x, y] of [
    [0.06, 0.05],
    [0.12, -0.01],
    [0.01, 0.1],
  ] as const) {
    ell(c, x, y, 0.016, 0.012, 0, '#6a4a32');
  }
  // Kopf: grau, dunkler Bartstreif, gelber Hakenschnabel
  ell(c, 0.19, -0.2, 0.11, 0.1, 0, grey);
  ell(c, 0.22, -0.15, 0.06, 0.05, 0, cream);
  line(c, [0.2, -0.18, 0.19, -0.11], '#3a3634', 0.025);
  poly(c, [0.29, -0.22, 0.36, -0.19, 0.3, -0.16], '#e0b84a');
  line(c, [0.34, -0.2, 0.35, -0.17], '#3a3028', 0.012);
  eye(c, 0.23, -0.22, 0.026);
  // Naher Flügel davor: rotbraun mit dunklen Flecken und Handschwingen
  wing(c, 0.04, -0.05, up ? 0.06 : 0.3, up ? -0.56 : 0.32, 0.15, rufous, dark);
  for (const [x, y] of up
    ? ([
        [0.05, -0.18],
        [0.07, -0.28],
      ] as const)
    : ([
        [0.12, 0.04],
        [0.18, 0.12],
      ] as const)) {
    ell(c, x, y, 0.018, 0.013, 0, dark);
  }
}

/** Spitzer Falkenflügel von der Schulter (sx, sy) zur Spitze (tx, ty); dunkle Handschwingen. */
function wing(c: CanvasRenderingContext2D, sx: number, sy: number, tx: number, ty: number, w: number, base: string, tip: string): void {
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  // Normale zur Flügelachse (Hinterkante liegt auf der dem Schwanz zugewandten Seite)
  const nx = -dy / len;
  const ny = dx / len;
  const k = nx < 0 ? 1 : -1;
  const ax = sx + dx * 0.45 + nx * w * k;
  const ay = sy + dy * 0.45 + ny * w * k;
  const bx = sx - nx * 0.06 * k - dx * 0.05;
  const by = sy - ny * 0.06 * k - dy * 0.05;
  const pts = [sx + nx * 0.03 * k * -1, sy + ny * 0.03 * k * -1, tx, ty, ax, ay, bx, by];
  outline(c, 0.07, () => polyPath(c, pts));
  poly(c, pts, base);
  // Handschwingen: äußeres Drittel dunkel
  const px = sx + dx * 0.62;
  const py = sy + dy * 0.62;
  poly(c, [px - nx * 0.02 * k, py - ny * 0.02 * k, tx, ty, ax + (tx - ax) * 0.35, ay + (ty - ay) * 0.35], tip);
}

// ---------------------------------------------------------------------------
// Totholzhaufen
// ---------------------------------------------------------------------------

/** Zaunkönig: winzig, rund, Schwanz steil gestellt, heller Überaugenstreif; Füße auf (0, 0). */
function paintWren(c: CanvasRenderingContext2D): void {
  const brown = '#8a5e3c';
  const dark = '#5e3d26';
  const light = '#c9a882';
  line(c, [-0.04, -0.14, -0.06, 0, -0.11, 0.01], '#a07a62', 0.04);
  line(c, [0.07, -0.14, 0.08, 0, 0.13, 0.01], '#a07a62', 0.04);
  const tail = [-0.16, -0.34, -0.34, -0.62, -0.27, -0.67, -0.1, -0.4];
  outline(c, 0.1, () => {
    polyPath(c, tail);
    ellPath(c, 0.01, -0.3, 0.24, 0.19);
    ellPath(c, 0.19, -0.42, 0.13, 0.12);
  });
  poly(c, tail, dark);
  for (const t of [0.3, 0.5, 0.7]) {
    const x = -0.16 + (-0.3 + 0.16) * t;
    const y = -0.34 + (-0.64 + 0.34) * t;
    line(c, [x - 0.03, y + 0.02, x + 0.05, y - 0.01], '#3d281a', 0.018);
  }
  ell(c, 0.01, -0.3, 0.24, 0.19, 0, brown);
  ell(c, 0.07, -0.23, 0.15, 0.1, 0, light);
  // Gebänderter Flügel
  ell(c, -0.06, -0.33, 0.14, 0.09, 0.25, dark);
  for (const x of [-0.14, -0.08, -0.02, 0.04]) line(c, [x, -0.39, x - 0.02, -0.27], '#c9a882', 0.014);
  ell(c, 0.19, -0.42, 0.13, 0.12, 0, brown);
  line(c, [0.12, -0.47, 0.31, -0.46], '#e3d2b4', 0.025);
  poly(c, [0.3, -0.44, 0.44, -0.415, 0.3, -0.395], '#3a2c22');
  eye(c, 0.25, -0.43, 0.03);
}

/** Rosenkäfer: metallisch grüngolden mit weißen Tupfen; Füße auf (0, 0). Bild = Beinstellung. */
function paintRosechafer(c: CanvasRenderingContext2D, frame: number): void {
  const k = frame === 0 ? 0.03 : -0.03;
  for (const x of [-0.12, 0.02, 0.16]) line(c, [x, -0.08, x + k - 0.03, 0], '#2b3a26', 0.035);
  outline(c, 0.08, () => {
    c.moveTo(0.26, -0.1);
    c.ellipse(-0.02, -0.1, 0.28, 0.19, 0, Math.PI, TAU);
    c.closePath();
    ellPath(c, 0.3, -0.1, 0.08, 0.07);
  });
  c.fillStyle = '#3f8a46';
  c.beginPath();
  c.ellipse(-0.02, -0.08, 0.28, 0.2, 0, Math.PI, TAU);
  c.closePath();
  c.fill();
  // Metallischer Glanz: goldgrüne Lichter
  ell(c, -0.06, -0.2, 0.15, 0.05, -0.1, '#a8c24e');
  ell(c, -0.1, -0.22, 0.06, 0.02, -0.1, 'rgba(255, 250, 210, 0.7)');
  line(c, [0.08, -0.27, 0.06, -0.09], '#2f6a36', 0.018);
  for (const [x, y] of [
    [-0.18, -0.13],
    [-0.08, -0.11],
    [0.0, -0.15],
    [-0.2, -0.2],
  ] as const) {
    ell(c, x, y, 0.016, 0.01, 0, '#eef0e0');
  }
  ell(c, 0.3, -0.1, 0.08, 0.07, 0, '#2f6a36');
  line(c, [0.36, -0.13, 0.44, -0.2], '#2b3a26', 0.022);
}

/**
 * Schmetterlingstramete: dünne, gezonte Fächer (braun, blaugrau, ocker) mit hellem Rand;
 * wachsen von (0, 0) nach rechts aus dem Holz.
 */
function paintTurkeytail(c: CanvasRenderingContext2D): void {
  const fan = (y: number, s: number, rot: number) => {
    const zones = ['#5e4a3e', '#8b6e56', '#56626e', '#a88d6c', '#6f6a72', '#c3ab88'];
    outline(c, 0.06, () => {
      c.moveTo(0, y);
      c.ellipse(0, y, 0.42 * s, 0.2 * s, rot, -Math.PI / 2, Math.PI / 2);
      c.closePath();
    });
    for (let i = 0; i < zones.length; i++) {
      const f = 1 - i * 0.14;
      c.fillStyle = zones[i]!;
      c.beginPath();
      c.moveTo(0, y);
      c.ellipse(0, y, 0.42 * s * f, 0.2 * s * f, rot, -Math.PI / 2, Math.PI / 2);
      c.closePath();
      c.fill();
    }
    // Heller, welliger Rand
    c.strokeStyle = '#efe4cc';
    c.lineWidth = 0.03 * s;
    c.beginPath();
    c.ellipse(0, y, 0.41 * s, 0.19 * s, rot, -Math.PI * 0.42, Math.PI * 0.42);
    c.stroke();
  };
  fan(-0.2, 0.8, -0.15);
  fan(0.04, 1, 0.05);
  fan(0.22, 0.68, 0.2);
}

/** Blindschleiche: beinlos, glänzend bronzefarben; Bauch auf (0, 0). Bild 1 = Kopf gehoben. */
function paintSlowworm(c: CanvasRenderingContext2D, frame: number): void {
  const lift = frame === 1 ? 1 : 0;
  const pts: number[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = -0.66 + u * 1.04;
    let y = -0.07 - 0.025 * Math.sin(u * Math.PI * 2.2 + 0.4);
    if (u > 0.85) y -= lift * ((u - 0.85) / 0.15) * 0.08;
    pts.push(x, y);
  }
  line(c, pts, OUTLINE, 0.17);
  line(c, pts, '#9c6d40', 0.12);
  // Dunkler Seitenstreif, Glanzlinie oben
  line(
    c,
    pts.map((v, i) => (i % 2 === 1 ? v + 0.03 : v)),
    '#6e4a2c',
    0.025,
  );
  line(
    c,
    pts.slice(4).map((v, i) => (i % 2 === 1 ? v - 0.035 : v)),
    'rgba(240, 214, 160, 0.75)',
    0.018,
  );
  // Kopf: kaum vom Körper abgesetzt
  const hx = pts[pts.length - 2]!;
  const hy = pts[pts.length - 1]!;
  ell(c, hx + 0.04, hy, 0.08, 0.058, -0.15 * lift, '#a27446');
  eye(c, hx + 0.06, hy - 0.015, 0.018);
}

/** Mauswiesel: schlank, braun mit weißem Bauch, kurzer Schwanz; wachsam im Gang. Füße auf (0, 0). */
function paintWeasel(c: CanvasRenderingContext2D): void {
  const fur = '#9a6236';
  const white = '#f2e9d8';
  const leg = '#7d4e2b';
  line(c, [-0.3, -0.16, -0.46, -0.14, -0.56, -0.18], fur, 0.05);
  line(c, [-0.24, -0.12, -0.26, 0], leg, 0.05);
  line(c, [0.12, -0.14, 0.16, 0], leg, 0.045);
  outline(c, 0.09, () => {
    ellPath(c, -0.05, -0.17, 0.32, 0.1, -0.08);
    ellPath(c, 0.24, -0.26, 0.09, 0.08, -0.6);
    ellPath(c, 0.34, -0.31, 0.11, 0.08);
  });
  ell(c, -0.05, -0.17, 0.32, 0.1, -0.08, fur);
  ell(c, 0.24, -0.26, 0.09, 0.08, -0.6, fur);
  // Weiße Unterseite bis zur Kehle
  ell(c, 0.08, -0.12, 0.2, 0.04, -0.15, white);
  ell(c, 0.27, -0.22, 0.06, 0.05, -0.6, white);
  ell(c, 0.34, -0.31, 0.11, 0.08, 0, fur);
  ell(c, 0.38, -0.27, 0.06, 0.035, 0, white);
  ell(c, 0.3, -0.39, 0.04, 0.035, 0, fur);
  ell(c, 0.3, -0.385, 0.02, 0.018, 0, '#d9a490');
  ell(c, 0.45, -0.31, 0.022, 0.02, 0, '#2e1e16');
  eye(c, 0.38, -0.33, 0.027);
}

// ---------------------------------------------------------------------------
// Trockenmauer
// ---------------------------------------------------------------------------

/** Rote Mauerbiene im Flug: pelzig, fuchsroter Hinterleib, dunkler Kopf; Mitte auf (0, 0). */
function paintMasonbee(c: CanvasRenderingContext2D, frame: number): void {
  const wingRot = frame === 0 ? -0.75 : -0.15;
  const wingY = frame === 0 ? -0.2 : -0.13;
  ell(c, 0.02, wingY, 0.17, 0.08, wingRot - 0.25, 'rgba(225, 232, 238, 0.6)');
  outline(c, 0.08, () => {
    ellPath(c, -0.1, 0.01, 0.2, 0.16);
    ellPath(c, 0.12, -0.02, 0.12, 0.12);
    ellPath(c, 0.28, -0.03, 0.09, 0.09);
  });
  // Pelziger, fuchsroter Hinterleib
  ell(c, -0.1, 0.01, 0.2, 0.16, 0, '#c4623a');
  ell(c, -0.12, -0.05, 0.14, 0.06, 0, '#df8a56');
  for (const x of [-0.2, -0.1, 0.0]) line(c, [x, -0.13, x - 0.02, 0.15], 'rgba(120, 50, 28, 0.35)', 0.02);
  // Bruststück braun behaart, Kopf dunkel
  ell(c, 0.12, -0.02, 0.12, 0.12, 0, '#6a4a34');
  ell(c, 0.11, -0.08, 0.08, 0.04, 0, '#8c6a4c');
  ell(c, 0.28, -0.03, 0.09, 0.09, 0, '#2a2422');
  eye(c, 0.31, -0.05, 0.03);
  line(c, [0.32, -0.1, 0.4, -0.22], '#2a2422', 0.025);
  line(c, [0.12, 0.08, 0.1, 0.18], '#3a2a20', 0.025);
  line(c, [0.2, 0.08, 0.22, 0.17], '#3a2a20', 0.025);
  ell(c, 0.06, wingY - 0.02, 0.19, 0.09, wingRot, 'rgba(240, 246, 250, 0.82)');
}

interface SnakeColors {
  body: string;
  shade: string;
  light: string;
  head: string;
}

/** Punkte der S-Kurve einer liegenden Natter (Bild 1: Kopf leicht gehoben). */
function snakePath(lift: number, wave: number): number[] {
  const pts: number[] = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = -0.6 + u * 1.04;
    // S-Kurve flach auf dem Stein, zum Kopf hin auslaufend
    let y = -0.1 - wave * Math.sin(u * Math.PI * 2 + 0.3) * (0.35 + 0.65 * Math.sin(u * Math.PI));
    if (u > 0.82) y -= lift * ((u - 0.82) / 0.18) * 0.1;
    pts.push(x, y);
  }
  return pts;
}

/** Liegende Natter: Körper als S-Kurve, Kopf rechts; Bauch auf (0, 0). */
function paintSnakeBody(c: CanvasRenderingContext2D, frame: number, col: SnakeColors, wave: number, pattern: (pts: number[]) => void): { hx: number; hy: number } {
  const pts = snakePath(frame === 1 ? 1 : 0, wave);
  // Zum Schwanz hin dünner: drei Abschnitte mit abnehmender Breite
  const third = Math.floor(pts.length / 6) * 2;
  const tail = pts.slice(0, third + 2);
  const rest = pts.slice(third);
  line(c, rest, OUTLINE, 0.16);
  line(c, tail, OUTLINE, 0.11);
  line(c, tail, col.body, 0.065);
  line(c, rest, col.body, 0.115);
  line(
    c,
    rest.map((v, i) => (i % 2 === 1 ? v + 0.032 : v)),
    col.shade,
    0.03,
  );
  line(
    c,
    rest.map((v, i) => (i % 2 === 1 ? v - 0.03 : v)),
    col.light,
    0.016,
  );
  pattern(pts);
  const hx = pts[pts.length - 2]! + 0.05;
  const hy = pts[pts.length - 1]!;
  outline(c, 0.06, () => ellPath(c, hx, hy, 0.1, 0.065, -0.1 * frame));
  ell(c, hx, hy, 0.1, 0.065, -0.1 * frame, col.head);
  return { hx, hy };
}

/** Ringelnatter: olivgrau, gelbe Halbmonde hinter dem Kopf, runde Pupille. */
function paintGrasssnake(c: CanvasRenderingContext2D, frame: number): void {
  const col = { body: '#6f7560', shade: '#4e5444', light: '#a3a88c', head: '#626954' };
  const { hx, hy } = paintSnakeBody(c, frame, col, 0.075, (pts) => {
    // Dunkle Querflecken an der Flanke
    for (let i = 8; i < pts.length - 6; i += 6) ell(c, pts[i]!, pts[i + 1]! + 0.02, 0.018, 0.022, 0, '#2f3328');
  });
  // Gelbe Halbmonde mit schwarzem Saum
  ell(c, hx - 0.1, hy, 0.035, 0.052, 0, '#262622');
  ell(c, hx - 0.075, hy, 0.03, 0.05, 0, '#ecd04a');
  eye(c, hx + 0.03, hy - 0.015, 0.02);
}

/** Schlingnatter: graubraun mit paarigen dunklen Flecken, dunkler Augenstreif. */
function paintSmoothsnake(c: CanvasRenderingContext2D, frame: number): void {
  const col = { body: '#8a7562', shade: '#5e4c3e', light: '#c2ab92', head: '#7d6856' };
  const { hx, hy } = paintSnakeBody(c, frame, col, 0.095, (pts) => {
    for (let i = 4; i < pts.length - 6; i += 4) {
      ell(c, pts[i]!, pts[i + 1]! - 0.02, 0.016, 0.012, 0, '#4a3628');
      ell(c, pts[i]! + 0.02, pts[i + 1]! + 0.012, 0.014, 0.01, 0, '#4a3628');
    }
  });
  // Dunkler Fleck im Nacken, Streif durchs Auge
  ell(c, hx - 0.1, hy - 0.01, 0.045, 0.03, 0, '#4a3628');
  line(c, [hx - 0.05, hy - 0.005, hx + 0.08, hy - 0.02], '#3e2e22', 0.016);
  eye(c, hx + 0.03, hy - 0.018, 0.019);
}

// ---------------------------------------------------------------------------
// Dekos der Lebensräume
// ---------------------------------------------------------------------------

/**
 * Mulde des Totholzhaufens (wie die des Tümpels: steile Ränder, flacher Grund);
 * `inset` rückt den Umriss nach innen.
 */
function pileBowl(c: CanvasRenderingContext2D, rx: number, inset: number): void {
  const x = rx - inset;
  const d = POND_DEPTH - inset * 0.6;
  const run = Math.min(1.2, x * 0.5);
  c.beginPath();
  c.moveTo(-x, POND_LIP);
  c.bezierCurveTo(-x + 0.04, d - 0.08, -x + run * 0.6, d, -x + run, d);
  c.lineTo(x - run, d);
  c.bezierCurveTo(x - run * 0.6, d, x - 0.04, d - 0.08, x, POND_LIP);
  c.closePath();
}

/**
 * Totholzhaufen im Erdschnitt unter der Grasnarbe: dunkler Humus, kreuz und quer
 * liegende Äste, Laub am Grund und ein morscher Stubben am äußeren (rechten) Ende.
 * Mitte der Bodenlinie auf (0, 0), halbe Breite `rx` (Tiergrößen).
 */
function paintPile(c: CanvasRenderingContext2D, rx: number): void {
  c.fillStyle = '#35271b';
  pileBowl(c, rx, 0);
  c.fill();
  c.save();
  pileBowl(c, rx, 0.08);
  c.clip();
  const g = c.createLinearGradient(0, POND_LIP, 0, POND_DEPTH);
  g.addColorStop(0, '#4d3a28');
  g.addColorStop(1, '#2f2218');
  c.fillStyle = g;
  c.fillRect(-rx, POND_LIP, rx * 2, POND_DEPTH - POND_LIP);
  const rand = mulberry32(Math.round(rx * 100) + 11);
  // Laub am Grund
  for (let i = 0; i < Math.round(rx * 9); i++) {
    const x = -rx + rand() * rx * 2;
    const y = POND_DEPTH - 0.06 - rand() * 0.16;
    const col = ['#8a5a2e', '#a46c36', '#6e4a28', '#b5803e'][Math.floor(rand() * 4)]!;
    ell(c, x, y, 0.09, 0.03, (rand() - 0.5) * 1.2, col);
  }
  // Äste kreuz und quer, die oberen etwas heller (mehr Licht)
  const sticks = Math.round(rx * 3.2);
  for (let i = 0; i < sticks; i++) {
    const cx = -rx + 0.2 + rand() * (rx * 2 - 0.9);
    const cy = POND_LIP + 0.12 + rand() * (POND_DEPTH - POND_LIP - 0.22);
    const len = 0.45 + rand() * 0.6;
    const a = (rand() - 0.5) * 0.9;
    const dx = (Math.cos(a) * len) / 2;
    const dy = (Math.sin(a) * len) / 2;
    const w = 0.045 + rand() * 0.04;
    const light = cy < (POND_LIP + POND_DEPTH) / 2;
    line(c, [cx - dx, cy - dy, cx + dx, cy + dy], 'rgba(30, 20, 12, 0.6)', w + 0.03);
    line(c, [cx - dx, cy - dy, cx + dx, cy + dy], light ? '#8a6a48' : '#6e5236', w);
    line(c, [cx - dx * 0.8, cy - dy * 0.8 - w * 0.25, cx + dx * 0.6, cy + dy * 0.6 - w * 0.25], 'rgba(214, 190, 150, 0.35)', w * 0.3);
    // Schnittfläche am Ende
    ell(c, cx + dx, cy + dy, w * 0.5, w * 0.55, a, '#c9a874');
    if (rand() < 0.5) ell(c, cx - dx * 0.3, cy - dy * 0.3 - w * 0.4, 0.05, 0.02, 0, '#6f8a3e');
  }
  c.restore();
  // Morscher Stubben am äußeren Ende: vom Grund bis knapp unter die Narbe, Moos obenauf.
  const sx = rx - PILE_STUMP_IN;
  const hw = PILE_STUMP_HALF;
  const top = POND_LIP + 0.04;
  const bottom = POND_DEPTH - 0.04;
  outline(c, 0.06, () => polyPath(c, [sx - hw, bottom, sx - hw * 0.92, top + 0.06, sx - hw * 0.4, top + 0.02, sx, top + 0.07, sx + hw * 0.5, top, sx + hw * 0.95, top + 0.05, sx + hw, bottom]));
  poly(c, [sx - hw, bottom, sx - hw * 0.92, top + 0.06, sx - hw * 0.4, top + 0.02, sx, top + 0.07, sx + hw * 0.5, top, sx + hw * 0.95, top + 0.05, sx + hw, bottom], '#6b5038');
  for (const f of [-0.55, -0.1, 0.4]) line(c, [sx + hw * f, top + 0.12, sx + hw * (f + 0.05), bottom - 0.04], '#4f3a28', 0.025);
  ell(c, sx + hw * 0.2, (top + bottom) / 2 + 0.06, hw * 0.35, 0.09, 0, '#3a2a1c');
  ell(c, sx - hw * 0.15, top + 0.05, hw * 0.75, 0.04, 0, '#6f8f3e');
  ell(c, sx + hw * 0.4, top + 0.035, hw * 0.4, 0.03, 0, '#86a64a');
}

/** Raureif und Schnee auf den oberen Ästen und dem Stubben (Winter), Maße wie `paintPile`. */
function paintPileSnow(c: CanvasRenderingContext2D, rx: number): void {
  c.save();
  pileBowl(c, rx, 0.08);
  c.clip();
  const rand = mulberry32(Math.round(rx * 100) + 11);
  for (let i = 0; i < Math.round(rx * 9); i++) {
    rand();
    rand();
    rand();
    rand();
  }
  const sticks = Math.round(rx * 3.2);
  for (let i = 0; i < sticks; i++) {
    const cx = -rx + 0.2 + rand() * (rx * 2 - 0.9);
    const cy = POND_LIP + 0.12 + rand() * (POND_DEPTH - POND_LIP - 0.22);
    const len = 0.45 + rand() * 0.6;
    const a = (rand() - 0.5) * 0.9;
    const w = 0.045 + rand() * 0.04;
    rand();
    if (cy > (POND_LIP + POND_DEPTH) / 2) continue;
    const dx = (Math.cos(a) * len) / 2;
    const dy = (Math.sin(a) * len) / 2;
    line(c, [cx - dx * 0.85, cy - dy * 0.85 - w * 0.5, cx + dx * 0.85, cy + dy * 0.85 - w * 0.5], 'rgba(240, 246, 250, 0.9)', w * 0.55);
  }
  c.restore();
  const sx = rx - PILE_STUMP_IN;
  ell(c, sx, POND_LIP + 0.06, PILE_STUMP_HALF * 0.95, 0.035, 0, 'rgba(242, 246, 250, 0.95)');
}

/** Dunkle Lücke im Reisig hinter einem Bewohner; Mitte auf (0, 0). */
function paintPileGap(c: CanvasRenderingContext2D): void {
  ell(c, 0, 0, 0.5, 0.25, 0, 'rgba(22, 14, 8, 0.55)');
  ell(c, 0, 0.03, 0.4, 0.17, 0, 'rgba(16, 10, 6, 0.45)');
}

/** Ein Ast oben im Haufen, auf dem der Zaunkönig sitzt; Mitte oben auf (0, 0). */
function paintPerchTwig(c: CanvasRenderingContext2D): void {
  line(c, [-0.46, 0.06, 0.46, 0.02], 'rgba(30, 20, 12, 0.6)', 0.1);
  line(c, [-0.46, 0.06, 0.46, 0.02], '#8a6a48', 0.065);
  line(c, [-0.4, 0.035, 0.4, 0.0], 'rgba(214, 190, 150, 0.45)', 0.02);
  ell(c, 0.46, 0.02, 0.03, 0.035, 0, '#c9a874');
  line(c, [0.1, 0.03, 0.2, -0.08], '#7a5a3a', 0.03);
}

/** Hohe Halme vor den Füßen der Wiesenbewohner (stehen „im Gras“); Fuß auf (0, 0). */
function paintMeadowTuft(c: CanvasRenderingContext2D): void {
  for (const [x, h, lean, col] of [
    [-0.36, 0.2, -0.06, '#7fa452'],
    [-0.22, 0.28, 0.04, '#6b9446'],
    [-0.06, 0.18, -0.05, '#8ab35a'],
    [0.12, 0.24, 0.06, '#6b9446'],
    [0.3, 0.2, 0.08, '#7fa452'],
  ] as const) {
    poly(c, [x - 0.025, 0.02, x + lean, -h, x + 0.025, 0.02], col);
  }
}

// ---------------------------------------------------------------------------

/** Verhalten und Größe je Art (Schlüssel = Art-ID aus src/content/habitats.ts) und Ersatz. */
export const HABITAT_INFO: Record<string, KindInfo> = {
  // Waldwiese
  cricket: { size: 0.85, motion: 'busy', frames: 2 },
  fieldmouse: { size: 0.95, motion: 'sniff', frames: 1 },
  rabbit: { size: 1.15, motion: 'hop', frames: 1 },
  lizard: { size: 1.1, motion: 'bask', frames: 2 },
  kestrel: { size: 1.2, motion: 'rattle', frames: 2, soar: true },
  // Totholzhaufen
  wren: { size: 0.85, motion: 'sniff', frames: 1 },
  rosechafer: { size: 0.9, motion: 'crawl', frames: 2 },
  turkeytail: { size: 1, motion: 'still', frames: 1, fungus: 'bracket' },
  slowworm: { size: 1.1, motion: 'bask', frames: 2 },
  weasel: { size: 1.1, motion: 'sniff', frames: 1 },
  // Trockenmauer
  sandlizard: { size: 1.1, motion: 'bask', frames: 2 },
  masonbee: { size: 0.9, motion: 'hover', frames: 2 },
  grasssnake: { size: 1.2, motion: 'bask', frames: 2 },
  smoothsnake: { size: 1.15, motion: 'bask', frames: 2 },
};

/** Ersatz für unbekannte Reptilien (Gattung 'reptiles'). */
export const REPTILE_INFO: KindInfo = { size: 1.05, motion: 'bask', frames: 2 };

/** Zeichnungen je Art und Dekos; Begrenzung in Zeicheneinheiten. */
export const HABITAT_DEFS: Record<string, SpriteDef> = {
  cricket: { x0: -0.46, y0: -0.44, x1: 0.42, y1: 0.06, paint: paintCricket },
  fieldmouse: { x0: -0.48, y0: -0.58, x1: 0.42, y1: 0.06, paint: (c) => paintFieldmouse(c) },
  rabbit: { x0: -0.44, y0: -1.04, x1: 0.42, y1: 0.06, paint: (c) => paintRabbit(c) },
  lizard: { x0: -0.82, y0: -0.24, x1: 0.46, y1: 0.06, paint: paintLizard },
  kestrel: { x0: -0.44, y0: -0.64, x1: 0.44, y1: 0.5, paint: paintKestrel },
  wren: { x0: -0.4, y0: -0.72, x1: 0.47, y1: 0.06, paint: (c) => paintWren(c) },
  rosechafer: { x0: -0.36, y0: -0.34, x1: 0.47, y1: 0.06, paint: paintRosechafer },
  turkeytail: { x0: -0.06, y0: -0.42, x1: 0.44, y1: 0.4, paint: (c) => paintTurkeytail(c) },
  slowworm: { x0: -0.76, y0: -0.24, x1: 0.56, y1: 0.06, paint: paintSlowworm },
  weasel: { x0: -0.62, y0: -0.46, x1: 0.5, y1: 0.06, paint: (c) => paintWeasel(c) },
  sandlizard: { x0: -0.84, y0: -0.28, x1: 0.5, y1: 0.06, paint: paintSandlizard },
  masonbee: { x0: -0.4, y0: -0.42, x1: 0.46, y1: 0.24, paint: paintMasonbee },
  grasssnake: { x0: -0.68, y0: -0.32, x1: 0.6, y1: 0.06, paint: paintGrasssnake },
  smoothsnake: { x0: -0.68, y0: -0.36, x1: 0.6, y1: 0.06, paint: paintSmoothsnake },
  reptile: { x0: -0.82, y0: -0.24, x1: 0.46, y1: 0.06, paint: paintReptile },
  // Dekos
  pileGap: { x0: -0.52, y0: -0.27, x1: 0.52, y1: 0.27, paint: (c) => paintPileGap(c) },
  perchTwig: { x0: -0.5, y0: -0.1, x1: 0.5, y1: 0.12, paint: (c) => paintPerchTwig(c) },
  meadowTuft: { x0: -0.42, y0: -0.3, x1: 0.42, y1: 0.04, paint: (c) => paintMeadowTuft(c) },
};

/**
 * Sprite-Name des Totholzhaufens (bzw. seines Schnees) für die halbe Breite `rx`; die
 * Zeichnung wird beim ersten Abruf in `defs` angelegt. Je Canvas-Größe nur eine Breite.
 */
export function pileSpriteName(defs: Record<string, SpriteDef>, snow: boolean, rx: number): string {
  const name = `${snow ? 'pileSnow' : 'pile'}@${rx}`;
  if (!defs[name]) {
    defs[name] = {
      x0: -rx - 0.02,
      y0: POND_LIP - 0.04,
      x1: rx + 0.02,
      y1: POND_DEPTH + 0.04,
      paint: snow ? (c) => paintPileSnow(c, rx) : (c) => paintPile(c, rx),
    };
  }
  return name;
}
