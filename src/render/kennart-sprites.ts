/**
 * Zeichnungen der sechs Kennarten (DESIGN_V2.md 26.3, ROADMAP Phase 9, 2a): je Wald eine
 * seltene Art, die nur im alten Wald lebt.
 *
 *   Haselmaus (dormouse)            Krone · ockergelb, riesige schwarze Augen, buschiger
 *                                   Schwanz; Bild 0 wach mit Haselnuss, Bild 1 schlafend
 *                                   eingerollt (tagsüber und im Winterschlaf)
 *   Biber (beaver)                  Waldtümpel · sitzt am Ufer mit Kelle und Zweig,
 *                                   orange Nagezähne
 *   Moorfrosch (moorfrog)           Waldtümpel · spitzschnäuziger Braunfrosch mit hellem
 *                                   Rückenstreif; Bild 0 braun, Bild 1 himmelblau
 *                                   (Laichzeit im Frühling, wird überblendet)
 *   Ästiger Stachelbart (hericium)  Stamm & Rinde · weißer Korallenstock mit hängenden
 *                                   Stacheln, wächst wie eine Konsole von (0, 0) nach rechts
 *   Luchs (lynx)                    Waldrand · Pinselohren, Backenbart, Stummelschwanz
 *                                   mit schwarzer Spitze, getupftes Fell
 *   Ziegenmelker (nightjar)         Waldrand · rindenfarben gestreift, flach am Boden;
 *                                   Bild 0 wach (Kopf hoch, Augen offen), Bild 1 ruhend
 *                                   (flach gedrückt, Augen zu – „ein Stück Kiefernrinde“)
 *
 * Schlüssel sind die Art-IDs aus 26.3. Die Arten kommen erst mit Aufgabe 2b in
 * `src/content/species.ts`; `animals.ts` nimmt KENNART_INFO / KENNART_DEFS schon jetzt
 * auf – sobald es die IDs in den Daten gibt, haben sie Szene und Sticker ohne weitere
 * Änderung. Konvention wie species-sprites.ts: Blick nach rechts, Ursprung = Ankerpunkt
 * (Füße am Boden), 1 Einheit = Grundgröße × `size`, flacher Stil mit dunklem Umriss.
 */

import { ell, ellPath, eye, line, OUTLINE, outline, poly, polyPath, TAU, type Paint, type SpriteDef } from './sprite-kit';
import type { KindInfo } from './species-sprites';

/** Art-IDs der Kennarten (DESIGN_V2.md 26.3), Reihenfolge = Wälder wie in der Tabelle. */
export const KENNART_IDS = ['dormouse', 'beaver', 'moorfrog', 'hericium', 'lynx', 'nightjar'] as const;
export type KennartId = (typeof KENNART_IDS)[number];

/**
 * Nische, Gattung und Wald je Kennart (26.3) – für Demo und Tests; die Spieldaten selbst
 * kommen mit 2b in `content/species.ts`.
 */
export const KENNART_HOME: Readonly<Record<KennartId, { niche: string; family: 'mammals' | 'amphibians' | 'fungi' | 'birds'; site: string }>> = {
  dormouse: { niche: 'crown', family: 'mammals', site: 'home' },
  beaver: { niche: 'pond', family: 'mammals', site: 'floodplain' },
  moorfrog: { niche: 'pond', family: 'amphibians', site: 'carr' },
  hericium: { niche: 'bark', family: 'fungi', site: 'beechwood' },
  lynx: { niche: 'edge', family: 'mammals', site: 'mountain' },
  nightjar: { niche: 'edge', family: 'birds', site: 'heath' },
};

// ---------------------------------------------------------------------------
// Haselmaus
// ---------------------------------------------------------------------------

const DORMOUSE = { fur: '#d08c3c', dark: '#b06f2a', light: '#f4e4c2', ear: '#e9b48a', foot: '#e7c08f' };

/** Schwanz der wachen Haselmaus: Kreise [x, y, r] von der Wurzel zur Spitze. */
const DORMOUSE_TAIL: readonly (readonly [number, number, number])[] = [
  [-0.14, -0.07, 0.05],
  [-0.24, -0.07, 0.06],
  [-0.34, -0.1, 0.07],
  [-0.41, -0.18, 0.075],
  [-0.44, -0.28, 0.08],
  [-0.42, -0.38, 0.08],
  [-0.37, -0.46, 0.07],
];

/** Umriss des Schwanzes: Mittellinie mit Halbbreite r, links hin und rechts zurück. */
const DORMOUSE_TAIL_SHAPE: number[] = (() => {
  const left: number[] = [];
  const right: number[] = [];
  DORMOUSE_TAIL.forEach(([x, y, r], i) => {
    const [ax, ay] = DORMOUSE_TAIL[Math.max(0, i - 1)]!;
    const [bx, by] = DORMOUSE_TAIL[Math.min(DORMOUSE_TAIL.length - 1, i + 1)]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    left.push(x + nx * r, y + ny * r);
    right.unshift(x - nx * r, y - ny * r);
  });
  // `unshift` mit zwei Werten hält das (x, y)-Paar zusammen: rechte Seite rückwärts.
  return [...left, ...right];
})();

/** Haselmaus: Bild 0 sitzt aufrecht mit Haselnuss, Bild 1 schläft eingerollt; Füße auf (0, 0). */
function paintDormouse(c: CanvasRenderingContext2D, frame: number): void {
  if (frame === 1) {
    paintDormouseAsleep(c);
    return;
  }
  const { fur, dark, light, ear, foot } = DORMOUSE;
  // Buschiger Schwanz: Bogen hinter dem Rücken, zur Spitze hin dicker
  const [tx, ty, tr] = DORMOUSE_TAIL[DORMOUSE_TAIL.length - 1]!;
  outline(c, 0.09, () => {
    polyPath(c, DORMOUSE_TAIL_SHAPE);
    ellPath(c, tx, ty, tr, tr);
  });
  poly(c, DORMOUSE_TAIL_SHAPE, dark);
  ell(c, tx, ty, tr, tr, 0, dark);
  // Heller Glanz längs des Schwanzes
  line(c, DORMOUSE_TAIL.slice(1).flatMap(([x, y, r]) => [x + r * 0.25, y - r * 0.1]), '#c98636', 0.045);
  outline(c, 0.09, () => {
    ellPath(c, 0, -0.22, 0.21, 0.2);
    ellPath(c, 0.16, -0.46, 0.155, 0.135);
    ellPath(c, 0.07, -0.59, 0.06, 0.065, -0.3);
  });
  // Körper mit heller Kehle
  ell(c, 0, -0.22, 0.21, 0.2, 0, fur);
  ell(c, -0.06, -0.3, 0.12, 0.08, -0.4, '#dc9c50');
  ell(c, 0.1, -0.22, 0.09, 0.14, 0.2, light);
  // Füße
  ell(c, 0.02, -0.025, 0.08, 0.03, 0, foot);
  ell(c, -0.12, -0.03, 0.06, 0.028, 0, dark);
  // Kopf: rundes Ohr, kurze Schnauze, rosa Nase, große Knopfaugen
  ell(c, 0.07, -0.59, 0.06, 0.065, -0.3, dark);
  ell(c, 0.075, -0.585, 0.035, 0.04, -0.3, ear);
  ell(c, 0.16, -0.46, 0.155, 0.135, 0, fur);
  ell(c, 0.25, -0.42, 0.07, 0.05, 0, light);
  ell(c, 0.31, -0.44, 0.025, 0.022, 0, '#c9706a');
  eye(c, 0.2, -0.5, 0.048);
  line(c, [0.27, -0.43, 0.37, -0.45], 'rgba(60, 40, 25, 0.45)', 0.008);
  line(c, [0.27, -0.42, 0.36, -0.4], 'rgba(60, 40, 25, 0.45)', 0.008);
  // Haselnuss in den Pfoten
  ell(c, 0.24, -0.28, 0.065, 0.07, 0, '#a5692f');
  ell(c, 0.22, -0.3, 0.025, 0.03, 0, '#c58a4c');
  poly(c, [0.18, -0.33, 0.24, -0.38, 0.3, -0.33, 0.24, -0.31], '#8fa046');
  ell(c, 0.17, -0.27, 0.04, 0.03, 0, foot);
  ell(c, 0.3, -0.25, 0.035, 0.03, 0, foot);
}

/** Haselmaus im Schlaf: Kugel, Schwanz um den Körper gelegt, Augen zu. */
function paintDormouseAsleep(c: CanvasRenderingContext2D): void {
  const { fur, dark, light, ear } = DORMOUSE;
  outline(c, 0.09, () => {
    ellPath(c, -0.02, -0.19, 0.27, 0.19);
    ellPath(c, 0.16, -0.18, 0.13, 0.12);
  });
  ell(c, -0.02, -0.19, 0.27, 0.19, 0, fur);
  ell(c, -0.06, -0.27, 0.18, 0.07, 0, '#dc9c50');
  // Kopf vorn eingerollt
  ell(c, 0.07, -0.33, 0.05, 0.055, -0.5, dark);
  ell(c, 0.075, -0.33, 0.028, 0.032, -0.5, ear);
  ell(c, 0.16, -0.18, 0.13, 0.12, 0, fur);
  ell(c, 0.22, -0.12, 0.07, 0.05, 0, light);
  ell(c, 0.28, -0.13, 0.022, 0.02, 0, '#c9706a');
  // Geschlossenes Auge
  c.strokeStyle = '#3a2518';
  c.lineWidth = 0.018;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(0.18, -0.21, 0.035, 0.15 * Math.PI, 0.85 * Math.PI);
  c.stroke();
  // Schwanz um den Körper gelegt
  const tail = [-0.27, -0.12, -0.18, -0.02, 0.0, 0.0, 0.16, -0.04, 0.26, -0.1];
  line(c, tail, OUTLINE, 0.15);
  line(c, tail, dark, 0.1);
  line(c, [-0.24, -0.1, -0.16, -0.035, 0.0, -0.02, 0.14, -0.05], fur, 0.04);
}

// ---------------------------------------------------------------------------
// Biber
// ---------------------------------------------------------------------------

/** Biber am Ufer: sitzt auf den Hinterbeinen, Kelle hinten flach, Zweig in den Pfoten; Füße auf (0, 0). */
function paintBeaver(c: CanvasRenderingContext2D): void {
  const fur = '#7a5232';
  const dark = '#5c3c22';
  const light = '#a07650';
  const tail = '#4b433d';
  outline(c, 0.09, () => {
    ellPath(c, -0.22, -0.075, 0.15, 0.055, 0.25);
    ellPath(c, -0.03, -0.26, 0.23, 0.26, 0.18);
    ellPath(c, 0.18, -0.54, 0.15, 0.125, 0.2);
    ellPath(c, 0.3, -0.49, 0.08, 0.065, 0.1);
  });
  // Kelle mit Schuppenmuster
  ell(c, -0.22, -0.075, 0.15, 0.055, 0.25, tail);
  c.save();
  c.beginPath();
  c.ellipse(-0.22, -0.075, 0.15, 0.055, 0.25, 0, TAU);
  c.clip();
  for (let x = -0.4; x <= -0.06; x += 0.05) line(c, [x, -0.17, x + 0.04, 0.02], '#3a332e', 0.01);
  for (let x = -0.4; x <= -0.06; x += 0.05) line(c, [x + 0.04, -0.17, x, 0.02], '#3a332e', 0.01);
  c.restore();
  // Körper
  ell(c, -0.03, -0.26, 0.23, 0.26, 0.18, fur);
  ell(c, -0.1, -0.34, 0.12, 0.15, 0.25, '#86603d');
  ell(c, 0.06, -0.22, 0.1, 0.17, 0.2, light);
  // Hinterfuß mit Schwimmhaut
  ell(c, 0.05, -0.025, 0.13, 0.035, 0, '#3e2c20');
  // Kopf: kleines Ohr, breite Schnauze, Nase, orange Nagezähne
  ell(c, 0.1, -0.65, 0.04, 0.035, 0, dark);
  ell(c, 0.18, -0.54, 0.15, 0.125, 0.2, fur);
  ell(c, 0.3, -0.49, 0.08, 0.065, 0.1, light);
  ell(c, 0.36, -0.52, 0.03, 0.024, 0, '#2a1e18');
  poly(c, [0.31, -0.45, 0.345, -0.45, 0.34, -0.395, 0.315, -0.395], '#e39a35');
  line(c, [0.3275, -0.45, 0.3275, -0.4], '#b8742a', 0.006);
  eye(c, 0.22, -0.58, 0.03);
  // Zweig mit zwei Blättern in den Vorderpfoten
  line(c, [0.06, -0.33, 0.44, -0.24], '#9c7448', 0.038);
  line(c, [0.36, -0.26, 0.42, -0.32], '#9c7448', 0.022);
  ell(c, 0.45, -0.34, 0.05, 0.025, -0.6, '#6f9a45');
  ell(c, 0.47, -0.23, 0.05, 0.024, 0.3, '#5d8a3a');
  ell(c, 0.2, -0.32, 0.045, 0.04, 0, dark);
  ell(c, 0.13, -0.3, 0.04, 0.035, 0, dark);
}

// ---------------------------------------------------------------------------
// Moorfrosch
// ---------------------------------------------------------------------------

interface FrogColors {
  body: string;
  dark: string;
  leg: string;
  stripe: string;
  belly: string;
  mask: string;
}

const MOORFROG_BROWN: FrogColors = {
  body: '#94704a',
  dark: '#5f4630',
  leg: '#7f603f',
  stripe: '#cdb48c',
  belly: '#ece0c6',
  mask: '#4c3624',
};

/** Laichzeit: die Männchen sind ein paar Tage himmelblau. */
const MOORFROG_BLUE: FrogColors = {
  body: '#78a3d8',
  dark: '#40669a',
  leg: '#5f88bf',
  stripe: '#bcd5f0',
  belly: '#e8f0f8',
  mask: '#33507a',
};

/** Moorfrosch: spitze Schnauze, heller Rückenstreif; Bild 0 braun, Bild 1 blau. Füße auf (0, 0). */
function paintMoorfrog(c: CanvasRenderingContext2D, frame: number): void {
  const col = frame === 1 ? MOORFROG_BLUE : MOORFROG_BROWN;
  const head = [0.12, -0.38, 0.26, -0.39, 0.42, -0.3, 0.3, -0.24, 0.12, -0.22];
  outline(c, 0.08, () => {
    ellPath(c, -0.06, -0.2, 0.27, 0.14, -0.3);
    polyPath(c, head);
    ellPath(c, 0.2, -0.31, 0.11, 0.08, -0.2);
    ellPath(c, -0.21, -0.09, 0.2, 0.07, 0.25);
  });
  // Gefaltetes Hinterbein mit langem Fuß
  ell(c, -0.21, -0.09, 0.2, 0.07, 0.25, col.leg);
  line(c, [-0.05, -0.03, 0.08, 0, 0.2, 0], col.dark, 0.04);
  ell(c, -0.06, -0.2, 0.27, 0.14, -0.3, col.body);
  ell(c, 0.2, -0.31, 0.11, 0.08, -0.2, col.body);
  poly(c, head, col.body);
  ell(c, 0.02, -0.12, 0.19, 0.05, -0.3, col.belly);
  // Heller Rückenstreif
  line(c, [-0.27, -0.17, -0.12, -0.28, 0.06, -0.34, 0.2, -0.375], col.stripe, 0.03);
  // Wenige dunkle Flecken, Schläfenmaske
  ell(c, -0.16, -0.2, 0.03, 0.022, 0, col.dark);
  ell(c, -0.02, -0.22, 0.025, 0.02, 0, col.dark);
  ell(c, 0.19, -0.3, 0.075, 0.035, -0.25, col.mask);
  line(c, [0.12, -0.12, 0.17, -0.02, 0.22, 0], col.dark, 0.04);
  // Kehle beim blauen Männchen hell
  if (frame === 1) ell(c, 0.3, -0.25, 0.06, 0.025, -0.3, col.belly);
  ell(c, 0.235, -0.36, 0.045, 0.04, 0, '#d8a640');
  eye(c, 0.24, -0.36, 0.025);
}

// ---------------------------------------------------------------------------
// Ästiger Stachelbart
// ---------------------------------------------------------------------------

/** Äste des Korallenstocks: [Ansatz x, y, Ende x, y, Wölbung]. */
const HERICIUM_ARMS: readonly (readonly [number, number, number, number, number])[] = [
  [0.04, -0.24, 0.34, -0.22, -0.06],
  [0.04, -0.04, 0.44, -0.02, -0.06],
  [0.04, 0.15, 0.36, 0.16, -0.05],
];

/** Knubbel [x, y, r] entlang der Äste und Stacheln [x, y, Länge] darunter (einmal berechnet). */
const HERICIUM = (() => {
  const lumps: [number, number, number][] = [];
  const spines: [number, number, number][] = [];
  HERICIUM_ARMS.forEach(([x0, y0, x1, y1, bow], a) => {
    const n = Math.round((x1 - x0) / 0.06);
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = x0 + (x1 - x0) * u;
      const y = y0 + (y1 - y0) * u + bow * 4 * u * (1 - u);
      const r = 0.055 - 0.015 * u;
      lumps.push([x, y, r]);
      // Zwei bis drei Stacheln je Knubbel, außen kürzer, die mittlere Etage am längsten
      const len = (0.17 - 0.07 * u) * (a === 1 ? 1 : 0.85);
      for (const [dx, k] of [
        [-0.022, 0.8],
        [0, 1],
        [0.022, 0.7],
      ] as const) {
        if (i === 0 && dx < 0) continue;
        spines.push([x + dx, y + r * 0.4, len * k]);
      }
    }
  });
  return { lumps, spines };
})();

/** Ästiger Stachelbart: weißer Korallenstock mit hängenden Stacheln; wächst von (0, 0) nach rechts. */
function paintHericium(c: CanvasRenderingContext2D): void {
  const white = '#f7f4ec';
  const cream = '#e6dcc6';
  const { lumps, spines } = HERICIUM;
  const spinePath = () => {
    for (const [x, y, len] of spines) {
      c.moveTo(x, y);
      c.lineTo(x + 0.004, y + len);
    }
  };
  // Umriss: Stacheln, Knubbel und Fuß
  c.lineCap = 'round';
  c.strokeStyle = OUTLINE;
  c.lineWidth = 0.05;
  c.beginPath();
  spinePath();
  c.stroke();
  outline(c, 0.06, () => {
    ellPath(c, 0.06, -0.04, 0.07, 0.26);
    for (const [x, y, r] of lumps) ellPath(c, x, y, r, r * 0.85);
  });
  // Fuß an der Rinde
  ell(c, 0.06, -0.04, 0.07, 0.26, 0, cream);
  // Stacheln: weiß, zart cremefarbener Schatten
  c.strokeStyle = cream;
  c.lineWidth = 0.026;
  c.beginPath();
  spinePath();
  c.stroke();
  c.strokeStyle = white;
  c.lineWidth = 0.014;
  c.beginPath();
  for (const [x, y, len] of spines) {
    c.moveTo(x - 0.003, y);
    c.lineTo(x - 0.002, y + len * 0.85);
  }
  c.stroke();
  // Knubbel der Äste mit Licht von oben
  for (const [x, y, r] of lumps) ell(c, x, y, r, r * 0.85, 0, cream);
  for (const [x, y, r] of lumps) ell(c, x - r * 0.1, y - r * 0.2, r * 0.8, r * 0.6, 0, white);
}

// ---------------------------------------------------------------------------
// Luchs
// ---------------------------------------------------------------------------

/** Luchs: hochbeinig, Pinselohren, Backenbart, Stummelschwanz; Füße auf (0, 0). */
function paintLynx(c: CanvasRenderingContext2D): void {
  const fur = '#bf9563';
  const dark = '#9c7247';
  const light = '#efe2c8';
  const spot = '#6f4f32';
  const black = '#2a221c';
  // Hintere Läufe (weiter weg, dunkler)
  line(c, [-0.22, -0.4, -0.25, -0.2, -0.24, 0], dark, 0.075);
  line(c, [0.2, -0.34, 0.22, 0], dark, 0.07);
  outline(c, 0.09, () => {
    ellPath(c, -0.33, -0.5, 0.085, 0.05, -0.6);
    ellPath(c, -0.01, -0.42, 0.31, 0.14, -0.05);
    ellPath(c, 0.32, -0.6, 0.14, 0.125);
    polyPath(c, [0.2, -0.53, 0.24, -0.47, 0.32, -0.44, 0.38, -0.47, 0.42, -0.53]);
    polyPath(c, [0.22, -0.68, 0.22, -0.84, 0.31, -0.71]);
    polyPath(c, [0.32, -0.71, 0.4, -0.85, 0.42, -0.68]);
  });
  // Stummelschwanz mit schwarzer Spitze
  ell(c, -0.33, -0.5, 0.085, 0.05, -0.6, fur);
  ell(c, -0.39, -0.55, 0.035, 0.03, -0.6, black);
  // Vordere Läufe mit großen Pfoten
  line(c, [-0.17, -0.38, -0.17, 0], fur, 0.075);
  line(c, [0.15, -0.38, 0.14, 0], fur, 0.075);
  for (const x of [-0.24, -0.16, 0.15, 0.23]) ell(c, x, -0.02, 0.05, 0.028, 0, x === -0.16 || x === 0.15 ? light : dark);
  // Körper mit Tupfen
  ell(c, -0.01, -0.42, 0.31, 0.14, -0.05, fur);
  ell(c, -0.04, -0.5, 0.24, 0.055, -0.05, '#c99f6c');
  ell(c, 0.02, -0.31, 0.22, 0.04, 0, light);
  for (const [x, y] of [
    [-0.22, -0.45],
    [-0.13, -0.5],
    [-0.05, -0.42],
    [0.05, -0.49],
    [-0.18, -0.36],
    [0.12, -0.4],
    [0.0, -0.35],
    [-0.27, -0.4],
  ] as const) {
    ell(c, x, y, 0.022, 0.017, 0, spot);
  }
  // Ohren mit schwarzen Pinseln
  poly(c, [0.22, -0.68, 0.22, -0.84, 0.31, -0.71], dark);
  poly(c, [0.32, -0.71, 0.4, -0.85, 0.42, -0.68], fur);
  poly(c, [0.345, -0.71, 0.395, -0.8, 0.405, -0.7], '#e3cfae');
  line(c, [0.22, -0.84, 0.215, -0.92], black, 0.022);
  line(c, [0.4, -0.85, 0.41, -0.93], black, 0.022);
  // Kopf mit Backenbart
  ell(c, 0.32, -0.6, 0.14, 0.125, 0, fur);
  poly(c, [0.2, -0.53, 0.24, -0.47, 0.32, -0.44, 0.38, -0.47, 0.42, -0.53, 0.3, -0.56], light);
  line(c, [0.22, -0.54, 0.25, -0.5], black, 0.016);
  line(c, [0.4, -0.54, 0.37, -0.5], black, 0.016);
  ell(c, 0.4, -0.57, 0.06, 0.045, 0, light);
  poly(c, [0.42, -0.6, 0.46, -0.6, 0.44, -0.575], '#9c5a50');
  line(c, [0.44, -0.575, 0.44, -0.55], '#5a3a2c', 0.01);
  eye(c, 0.37, -0.64, 0.03);
  ell(c, 0.37, -0.64, 0.03, 0.03, 0, 'rgba(201, 160, 60, 0.35)');
  eye(c, 0.37, -0.64, 0.022);
}

// ---------------------------------------------------------------------------
// Ziegenmelker
// ---------------------------------------------------------------------------

/** Ziegenmelker am Boden: Bild 0 wach, Bild 1 ruhend flach gedrückt. Bauch auf (0, 0). */
function paintNightjar(c: CanvasRenderingContext2D, frame: number): void {
  const awake = frame !== 1;
  const base = '#8b7b68';
  const dark = '#5c4f42';
  const light = '#bcab90';
  const streak = '#3d332a';
  const white = '#f1ebdd';
  // Ruhend: Kopf eingezogen, ganzer Vogel flacher
  const hx = awake ? 0.26 : 0.22;
  const hy = awake ? -0.27 : -0.17;
  const by = awake ? -0.15 : -0.11;
  const bry = awake ? 0.13 : 0.1;
  const tail = [-0.26, by - 0.06, -0.66, by + 0.0, -0.64, by + 0.07, -0.26, by + 0.07];
  outline(c, 0.09, () => {
    polyPath(c, tail);
    ellPath(c, -0.04, by, 0.32, bry, -0.04);
    ellPath(c, hx, hy, 0.13, 0.105);
  });
  poly(c, tail, dark);
  line(c, [-0.36, by + 0.0, -0.6, by + 0.03], streak, 0.014);
  ell(c, -0.58, by + 0.045, 0.04, 0.02, 0, white);
  ell(c, -0.04, by, 0.32, bry, -0.04, base);
  ell(c, 0.06, by + bry * 0.45, 0.24, bry * 0.4, 0, light);
  // Flügel: lang, rindenartig gestreift, weißer Fleck an der Spitze
  ell(c, -0.14, by - 0.02, 0.3, 0.075, 0.06, dark);
  for (const [x, w] of [
    [-0.32, 0.08],
    [-0.2, 0.1],
    [-0.06, 0.08],
    [0.06, 0.06],
  ] as const) {
    line(c, [x, by - 0.04, x + w, by - 0.02], streak, 0.016);
  }
  line(c, [-0.3, by + 0.02, -0.04, by + 0.04], light, 0.012);
  ell(c, -0.38, by - 0.0, 0.035, 0.018, 0.06, white);
  // Kopf: groß und flach, winziger Schnabel, heller Bartstreif
  ell(c, hx, hy, 0.13, 0.105, 0, base);
  ell(c, hx - 0.02, hy - 0.05, 0.08, 0.035, 0, dark);
  line(c, [hx - 0.06, hy - 0.06, hx + 0.02, hy - 0.08], streak, 0.014);
  line(c, [hx + 0.02, hy + 0.06, hx + 0.12, hy + 0.03], white, 0.022);
  poly(c, [hx + 0.12, hy - 0.01, hx + 0.18, hy + 0.01, hx + 0.12, hy + 0.03], '#3a3029');
  if (awake) {
    eye(c, hx + 0.04, hy - 0.015, 0.04);
  } else {
    c.strokeStyle = '#2a221c';
    c.lineWidth = 0.016;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(hx + 0.0, hy - 0.01);
    c.quadraticCurveTo(hx + 0.04, hy + 0.01, hx + 0.08, hy - 0.01);
    c.stroke();
  }
}

// ---------------------------------------------------------------------------

/** Verhalten und Größe je Kennart. */
export const KENNART_INFO: Readonly<Record<KennartId, KindInfo>> = {
  dormouse: { size: 0.85, motion: 'sniff', frames: 2 },
  // Sitzt wie die Frösche im flachen Wasser am Tümpelrand: Kopf unter der Narbe, Füße über dem Grund.
  beaver: { size: 0.9, motion: 'sniff', frames: 1 },
  moorfrog: { size: 0.95, motion: 'sniff', frames: 2 },
  hericium: { size: 1.1, motion: 'still', frames: 1, fungus: 'bracket' },
  lynx: { size: 1.85, motion: 'sniff', frames: 1 },
  nightjar: { size: 1.05, motion: 'sniff', frames: 2 },
};

/** Zeichenfunktion je Kennart (Bild 0 / 1 wie oben). */
export const KENNART_PAINT: Readonly<Record<KennartId, Paint>> = {
  dormouse: paintDormouse,
  beaver: (c) => paintBeaver(c),
  moorfrog: paintMoorfrog,
  hericium: (c) => paintHericium(c),
  lynx: (c) => paintLynx(c),
  nightjar: paintNightjar,
};

/** Zeichnungen je Kennart; Begrenzung in Zeicheneinheiten (enthält alle Bilder samt Umriss). */
export const KENNART_DEFS: Readonly<Record<KennartId, SpriteDef>> = {
  dormouse: { x0: -0.57, y0: -0.7, x1: 0.4, y1: 0.08, paint: KENNART_PAINT.dormouse, frames: 2 },
  beaver: { x0: -0.42, y0: -0.73, x1: 0.53, y1: 0.06, paint: KENNART_PAINT.beaver, frames: 1 },
  moorfrog: { x0: -0.46, y0: -0.46, x1: 0.47, y1: 0.06, paint: KENNART_PAINT.moorfrog, frames: 2 },
  hericium: { x0: -0.05, y0: -0.37, x1: 0.52, y1: 0.36, paint: KENNART_PAINT.hericium, frames: 1 },
  lynx: { x0: -0.46, y0: -0.95, x1: 0.52, y1: 0.06, paint: KENNART_PAINT.lynx, frames: 1 },
  nightjar: { x0: -0.72, y0: -0.43, x1: 0.45, y1: 0.06, paint: KENNART_PAINT.nightjar, frames: 2 },
};

/** Ist `id` eine Kennart (26.3)? */
export function isKennart(id: string): id is KennartId {
  return Object.hasOwn(KENNART_DEFS, id);
}
