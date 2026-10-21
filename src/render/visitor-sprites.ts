/**
 * Zeichnungen der Durchreisenden (DESIGN_V2.md 7.5) im flachen Stil der Tiere.
 * Alle blicken nach links (Zugrichtung); Ursprung = Körpermitte. Je zwei Bilder
 * (Flügel oben/unten bzw. Flügelschlag), die die Sprite-Cache der Tiere zeichnet.
 */

import { ell, line, outline, ellPath, paintBird, poly, polyPath, eye, type BirdColors, type SpriteDef } from './sprite-kit';

/**
 * Geschwungener Flügel: von der Schulter (x0..x1 auf Höhe y) zur Spitze (tx, ty).
 * `bulge` wölbt die Vorderkante, `back` zieht die Hinterkante nach hinten.
 */
function wingPath(c: CanvasRenderingContext2D, x0: number, x1: number, y: number, tx: number, ty: number, bulge: number, back: number): void {
  c.moveTo(x0, y);
  c.quadraticCurveTo(x0 - bulge, (y + ty) * 0.5, tx, ty);
  c.quadraticCurveTo(x1 + back, y + (ty - y) * 0.35, x1, y);
  c.closePath();
}

function fillPath(c: CanvasRenderingContext2D, color: string, build: () => void): void {
  c.fillStyle = color;
  c.beginPath();
  build();
  c.fill();
}

/** Kranich im Flug: langer Hals nach vorn, Beine nach hinten, breite Schwingen mit dunklen Spitzen. */
function paintCrane(c: CanvasRenderingContext2D, frame: number): void {
  const up = frame === 0;
  const ty = up ? -0.74 : 0.6;
  const near = () => wingPath(c, -0.16, 0.16, -0.02, up ? -0.22 : -0.12, ty, 0.1, 0.22);
  const far = () => wingPath(c, -0.06, 0.2, -0.03, up ? 0.08 : 0.14, ty * 0.78, 0.06, 0.16);
  outline(c, 0.07, () => {
    far();
    near();
    ellPath(c, 0.02, 0, 0.34, 0.1, 0.02);
    c.moveTo(-0.3, -0.02);
    c.lineTo(-0.8, -0.1);
  });
  fillPath(c, '#6f757a', far);
  line(c, [0.3, 0.02, 0.92, 0.08], '#3a3632', 0.035);
  // Schwanz-„Busch“
  ell(c, 0.36, 0.02, 0.1, 0.06, 0.2, '#4b4a48');
  ell(c, 0.02, 0, 0.34, 0.1, 0.02, '#9aa0a4');
  line(c, [-0.28, -0.02, -0.56, -0.07], '#9aa0a4', 0.07);
  line(c, [-0.54, -0.07, -0.8, -0.1], '#2d2b2a', 0.07);
  // weißer Wangenstreif, roter Scheitel
  line(c, [-0.62, -0.06, -0.76, -0.08], '#f1efea', 0.025);
  ell(c, -0.82, -0.12, 0.03, 0.02, 0, '#c8483a');
  poly(c, [-0.84, -0.12, -1.0, -0.08, -0.84, -0.07], '#c9b48a');
  fillPath(c, '#a7adb1', near);
  // Dunkle Handschwingen an der Spitze („Finger“)
  c.save();
  c.beginPath();
  near();
  c.clip();
  const tx = up ? -0.22 : -0.12;
  for (let i = 0; i < 4; i++) {
    const k = i / 3;
    line(c, [tx, ty, tx + 0.06 + k * 0.22, ty * (0.55 - k * 0.05)], '#34373b', 0.07);
  }
  ell(c, tx + 0.06, ty * 0.92, 0.12, 0.08, 0, '#34373b');
  c.restore();
}

/** Bergfink im Flug: schwarzer Kopf, orange Brust und Schulter, weißer Bürzel. */
function paintBrambling(c: CanvasRenderingContext2D, frame: number): void {
  const up = frame === 0;
  const wing = () => wingPath(c, -0.08, 0.1, -0.02, up ? -0.02 : 0.02, up ? -0.44 : 0.36, 0.05, 0.12);
  const tail = [0.18, -0.03, 0.42, -0.09, 0.4, 0.0, 0.42, 0.08, 0.18, 0.04];
  outline(c, 0.09, () => {
    polyPath(c, tail);
    ellPath(c, 0, 0, 0.22, 0.12);
    ellPath(c, -0.2, -0.05, 0.11, 0.1);
    wing();
  });
  poly(c, tail, '#2e2a27');
  ell(c, 0, 0, 0.22, 0.12, 0, '#f6efe4');
  ell(c, 0.15, -0.03, 0.06, 0.05, 0, '#ffffff');
  ell(c, -0.08, 0.02, 0.13, 0.09, 0, '#e48a3c');
  ell(c, -0.2, -0.05, 0.11, 0.1, 0, '#2f2b29');
  poly(c, [-0.3, -0.07, -0.38, -0.04, -0.3, -0.02], '#e2b45a');
  ell(c, -0.25, -0.08, 0.016, 0.016, 0, 'rgba(255,255,255,0.8)');
  fillPath(c, '#2f2b29', wing);
  // orange Schulter und weiße Flügelbinde
  ell(c, 0.0, up ? -0.06 : 0.04, 0.07, 0.04, 0, '#e48a3c');
  line(c, [-0.03, up ? -0.18 : 0.15, 0.08, up ? -0.16 : 0.13], '#f3eee6', 0.03);
}

/** Ersatz für unbekannte Gäste: kleiner Vogel im Flug in gedeckten Farben. */
function paintFlyer(c: CanvasRenderingContext2D, frame: number): void {
  const up = frame === 0;
  const wing = () => wingPath(c, -0.08, 0.1, -0.02, up ? -0.02 : 0.02, up ? -0.44 : 0.36, 0.05, 0.12);
  const tail = [0.18, -0.03, 0.42, -0.08, 0.42, 0.07, 0.18, 0.04];
  outline(c, 0.09, () => {
    polyPath(c, tail);
    ellPath(c, 0, 0, 0.22, 0.12);
    ellPath(c, -0.2, -0.05, 0.11, 0.1);
    wing();
  });
  poly(c, tail, '#5a4a3c');
  ell(c, 0, 0, 0.22, 0.12, 0, '#a08668');
  ell(c, -0.06, 0.03, 0.12, 0.08, 0, '#d8c6a8');
  ell(c, -0.2, -0.05, 0.11, 0.1, 0, '#8a7258');
  poly(c, [-0.3, -0.07, -0.38, -0.04, -0.3, -0.02], '#d2b06a');
  eye(c, -0.24, -0.07, 0.022);
  fillPath(c, '#6e5a46', wing);
}

/** Taubenschwänzchen: rundlicher grau-brauner Leib, orange Hinterflügel, Rüssel, Schwanzbürste. */
function paintHummingbirdMoth(c: CanvasRenderingContext2D, frame: number): void {
  const k = frame === 0 ? 1 : 0.55;
  // Flügel als halbtransparenter Schwirr-Schleier
  c.globalAlpha = 0.72;
  fillPath(c, '#e0893a', () => wingPath(c, 0.0, 0.14, -0.04, 0.12, -0.04 - 0.28 * k, 0.02, 0.12));
  fillPath(c, '#8a7e70', () => wingPath(c, -0.1, 0.08, -0.06, -0.06, -0.06 - 0.44 * k, 0.04, 0.2));
  c.globalAlpha = 1;
  outline(c, 0.07, () => {
    ellPath(c, 0.08, 0.02, 0.24, 0.11, 0.08);
    ellPath(c, -0.2, 0.0, 0.1, 0.09);
  });
  // Rüssel
  line(c, [-0.28, 0.02, -0.5, 0.08, -0.58, 0.12], '#3b3029', 0.025);
  ell(c, 0.08, 0.02, 0.24, 0.11, 0.08, '#7c7064');
  // schwarz-weiße Querbinden und Schwanzbürste
  line(c, [0.12, -0.08, 0.12, 0.12], '#efe8dc', 0.035);
  line(c, [0.18, -0.07, 0.18, 0.12], '#2f2925', 0.035);
  poly(c, [0.28, -0.02, 0.44, -0.1, 0.46, 0.02, 0.44, 0.13, 0.28, 0.07], '#3a322c');
  ell(c, -0.2, 0.0, 0.1, 0.09, 0, '#8b7f72');
  eye(c, -0.25, -0.02, 0.03);
}

/** Rauchschwalbe im Flug: schlank, sichelförmige Flügel, lange Schwanzspieße. */
function paintSwallow(c: CanvasRenderingContext2D, frame: number): void {
  const up = frame === 0;
  const wing = () => {
    c.moveTo(-0.08, -0.03);
    c.quadraticCurveTo(-0.02, up ? -0.3 : 0.22, up ? 0.3 : 0.32, up ? -0.4 : 0.34);
    c.quadraticCurveTo(0.08, up ? -0.16 : 0.1, 0.1, -0.01);
    c.closePath();
  };
  const tail = [0.16, -0.03, 0.6, -0.12, 0.34, -0.01, 0.62, 0.06, 0.16, 0.03];
  outline(c, 0.07, () => {
    polyPath(c, tail);
    ellPath(c, 0, 0, 0.22, 0.08);
    ellPath(c, -0.21, -0.02, 0.08, 0.075);
    wing();
  });
  poly(c, tail, '#1d2a46');
  ell(c, 0, 0, 0.22, 0.08, 0, '#22325a');
  ell(c, 0.0, 0.03, 0.16, 0.05, 0, '#f1ebe0');
  ell(c, -0.21, -0.02, 0.08, 0.075, 0, '#22325a');
  ell(c, -0.24, 0.02, 0.05, 0.04, 0, '#b4452f');
  poly(c, [-0.28, -0.03, -0.34, -0.01, -0.28, 0.0], '#2a2a2a');
  fillPath(c, '#1b2643', wing);
}

/** Wildschwein (Bache): Blick nach links, Füße auf y = 0. Bild 0/1 laufen, 2/3 wühlen. */
function paintBoar(c: CanvasRenderingContext2D, frame: number, piglet: boolean): void {
  const root = frame >= 2;
  const step = frame & 1;
  const body = piglet ? '#9a6f4a' : '#4f4036';
  const dark = piglet ? '#7a5638' : '#3a2f28';
  const snoutY = root ? (frame === 3 ? -0.04 : -0.08) : -0.3;
  const head = [-0.3, -0.52, -0.62, snoutY - 0.08, -0.66, snoutY + 0.05, -0.28, -0.2];
  // Beine (hinten zuerst, abwechselnd beim Laufen)
  const legs = step === 0 ? [-0.28, -0.18, 0.2, 0.32] : [-0.2, -0.26, 0.28, 0.24];
  for (let i = 0; i < 4; i++) {
    const x = legs[i]!;
    line(c, [x, -0.25, x + (i % 2 === 0 ? -0.03 : 0.03), -0.01], i < 2 ? dark : body, 0.075);
  }
  outline(c, 0.08, () => {
    ellPath(c, 0.04, -0.4, 0.48, 0.26);
    polyPath(c, head);
  });
  ell(c, 0.04, -0.4, 0.48, 0.26, 0, body);
  poly(c, head, body);
  // Borstenkamm auf dem Rücken
  if (!piglet) line(c, [-0.32, -0.6, 0.0, -0.67, 0.32, -0.6], dark, 0.08);
  // Frischlinge: helle Längsstreifen
  if (piglet) {
    for (const dy of [-0.5, -0.4, -0.3]) line(c, [-0.3, dy, 0.38, dy + 0.02], '#d9bf95', 0.035);
  }
  // Rüsselscheibe, Ohr, Auge, Hauer
  ell(c, -0.64, snoutY, 0.04, 0.06, 0, '#2a211c');
  poly(c, [-0.28, -0.52, -0.2, -0.68, -0.14, -0.5], dark);
  eye(c, -0.42, root ? -0.32 : -0.42, 0.028);
  if (!piglet) line(c, [-0.56, snoutY + 0.02, -0.6, snoutY - 0.06], '#efe6d2', 0.025);
  line(c, [0.5, -0.46, 0.58, -0.38], dark, 0.035);
  if (root) {
    // Ein paar aufgeworfene Erdkrümel
    ell(c, -0.74, -0.02, 0.03, 0.02, 0, '#6b4b30');
    ell(c, -0.68, -0.07 - (frame === 3 ? 0.03 : 0), 0.02, 0.016, 0, '#7a5a3a');
  }
}

/** Wanderfalke: Bild 0/1 Segeln (Flügel leicht V / waagerecht), 2 Sturzflug (angelegt). */
function paintFalcon(c: CanvasRenderingContext2D, frame: number): void {
  const back = '#5d6875';
  const under = '#e8e2d4';
  if (frame === 2) {
    // Tropfenform mit angelegten Flügeln
    const shape = [-0.42, -0.02, -0.1, -0.16, 0.5, -0.06, 0.62, 0.0, 0.5, 0.06, -0.1, 0.14];
    outline(c, 0.07, () => polyPath(c, shape));
    poly(c, shape, back);
    ell(c, -0.06, 0.06, 0.26, 0.06, 0, under);
    ell(c, -0.34, -0.02, 0.1, 0.09, 0, '#2f3640');
    poly(c, [-0.44, -0.02, -0.52, 0.02, -0.43, 0.04], '#e2b94a');
    eye(c, -0.37, -0.04, 0.025);
    return;
  }
  // Lange, spitze Schwingen, nach hinten gezogen: Bild 0 hoch (V), Bild 1 tief.
  const up = frame === 0;
  const tipX = 0.36;
  const tipY = up ? -0.56 : 0.38;
  const wing = () => {
    c.moveTo(-0.2, -0.04);
    c.quadraticCurveTo(-0.12, tipY * 0.55, tipX, tipY);
    c.quadraticCurveTo(0.1, tipY * 0.3, 0.18, -0.01);
    c.closePath();
  };
  const tail = [0.24, -0.04, 0.58, -0.07, 0.58, 0.05, 0.24, 0.04];
  outline(c, 0.07, () => {
    polyPath(c, tail);
    ellPath(c, 0, 0, 0.3, 0.1);
    ellPath(c, -0.3, -0.03, 0.1, 0.09);
    wing();
  });
  poly(c, tail, back);
  ell(c, 0, 0, 0.3, 0.1, 0, back);
  ell(c, -0.04, 0.04, 0.22, 0.06, 0, under);
  for (const x of [-0.14, -0.04, 0.06, 0.16]) line(c, [x, 0.03, x + 0.03, 0.07], '#8b8a86', 0.02);
  ell(c, -0.3, -0.03, 0.1, 0.09, 0, '#2f3640');
  ell(c, -0.31, 0.02, 0.05, 0.04, 0, under);
  poly(c, [-0.39, -0.04, -0.47, 0.0, -0.38, 0.01], '#e2b94a');
  eye(c, -0.33, -0.05, 0.025);
  fillPath(c, back, wing);
  // Dunklere Handschwingen an der Spitze
  line(c, [tipX - 0.14, tipY * 0.78, tipX, tipY], '#3b434d', 0.05);
}

/** Hirschkäfer im Flug: fast aufrecht, Deckflügel hoch, Hautflügel schwirren. */
function paintStagFlight(c: CanvasRenderingContext2D, frame: number): void {
  const spread = frame === 0 ? 1 : 0.6;
  c.save();
  c.rotate(-0.55);
  // Hautflügel (durchscheinend)
  c.globalAlpha = 0.45;
  ell(c, 0.18, -0.2 * spread, 0.34, 0.12 * spread + 0.04, -0.6, '#d8cbb0');
  ell(c, 0.2, 0.14 * spread, 0.32, 0.1 * spread + 0.04, 0.5, '#d8cbb0');
  c.globalAlpha = 1;
  // Beine baumeln
  for (const y of [-0.06, 0.04, 0.12]) line(c, [0.0, y, -0.06, y + 0.14, -0.02, y + 0.2], '#2b1d14', 0.025);
  outline(c, 0.07, () => {
    ellPath(c, 0.1, 0, 0.26, 0.12);
    ellPath(c, -0.2, 0, 0.09, 0.09);
  });
  ell(c, 0.1, 0, 0.26, 0.12, 0, '#3b2618');
  // Deckflügel angehoben
  ell(c, 0.04, -0.13, 0.2, 0.06, -0.5, '#5a3622');
  ell(c, -0.2, 0, 0.09, 0.09, 0, '#2b1d14');
  // Geweih (Oberkiefer)
  for (const s of [-1, 1]) {
    line(c, [-0.27, s * 0.03, -0.46, s * 0.12, -0.6, s * 0.06], '#7a3b22', 0.045);
    line(c, [-0.46, s * 0.12, -0.5, s * 0.2], '#7a3b22', 0.03);
  }
  c.restore();
}

/** Farben der Seidenschwänze (sitzend und im Flug). */
const WAXWING: BirdColors = {
  back: '#a98872',
  wing: '#605458',
  wingBar: '#f2e6c8',
  tail: '#6c6466',
  head: '#b3917a',
  breast: '#c8a38b',
  belly: '#dcc6ad',
  stripe: '#1f1a18',
  beak: '#2a2524',
  leg: '#3a302c',
};

/** Seidenschwanz, sitzend: Haube, schwarze Maske, gelbe Schwanzspitze, rote „Wachströpfchen“. */
function paintWaxwing(c: CanvasRenderingContext2D): void {
  paintBird(c, WAXWING);
  poly(c, [0.06, -0.78, -0.08, -0.98, 0.2, -0.86, 0.3, -0.8], WAXWING.head);
  line(c, [-0.64, -0.62, -0.6, -0.5], '#e9c33a', 0.06);
  // Rote „Wachströpfchen“ an den Armschwingen (hinten am Flügel)
  ell(c, -0.3, -0.47, 0.03, 0.02, 0.3, '#c8312a');
  ell(c, -0.25, -0.43, 0.026, 0.018, 0.3, '#c8312a');
}

/** Kleiner Vogel im Flug in frei wählbaren Farben (Ersatz-Gast, Seidenschwanz im Flug). */
function paintSmallFlyer(c: CanvasRenderingContext2D, frame: number, back: string, belly: string, head: string, wingColor: string, tailTip?: string): void {
  const up = frame === 0;
  const wing = () => wingPath(c, -0.08, 0.1, -0.02, up ? -0.02 : 0.02, up ? -0.44 : 0.36, 0.05, 0.12);
  const tail = [0.18, -0.03, 0.42, -0.08, 0.42, 0.07, 0.18, 0.04];
  outline(c, 0.09, () => {
    polyPath(c, tail);
    ellPath(c, 0, 0, 0.22, 0.12);
    ellPath(c, -0.2, -0.05, 0.11, 0.1);
    wing();
  });
  poly(c, tail, wingColor);
  if (tailTip) line(c, [0.41, -0.07, 0.41, 0.06], tailTip, 0.05);
  ell(c, 0, 0, 0.22, 0.12, 0, back);
  ell(c, -0.06, 0.03, 0.12, 0.08, 0, belly);
  ell(c, -0.2, -0.05, 0.11, 0.1, 0, head);
  poly(c, [-0.3, -0.07, -0.38, -0.04, -0.3, -0.02], '#3a3330');
  eye(c, -0.24, -0.07, 0.022);
  fillPath(c, wingColor, wing);
}


export const VISITOR_DEFS: Record<string, SpriteDef> = {
  'visitor:crane': { x0: -1.02, y0: -0.76, x1: 0.96, y1: 0.6, paint: paintCrane },
  'visitor:brambling': { x0: -0.42, y0: -0.46, x1: 0.46, y1: 0.4, paint: paintBrambling },
  'visitor:moth': { x0: -0.62, y0: -0.52, x1: 0.5, y1: 0.18, paint: paintHummingbirdMoth },
  'visitor:flyer': { x0: -0.42, y0: -0.46, x1: 0.46, y1: 0.4, paint: paintFlyer },
  'visitor:swallow': { x0: -0.4, y0: -0.46, x1: 0.66, y1: 0.4, paint: paintSwallow },
  'visitor:boar': { x0: -0.8, y0: -0.74, x1: 0.62, y1: 0.05, paint: (c, f) => paintBoar(c, f, false) },
  'visitor:piglet': { x0: -0.8, y0: -0.74, x1: 0.62, y1: 0.05, paint: (c, f) => paintBoar(c, f, true) },
  'visitor:falcon': { x0: -0.6, y0: -0.64, x1: 0.68, y1: 0.46, paint: paintFalcon },
  'visitor:stag': { x0: -0.62, y0: -0.62, x1: 0.62, y1: 0.62, paint: paintStagFlight },
  'visitor:waxwing': { x0: -0.72, y0: -1.0, x1: 0.58, y1: 0.08, paint: (c) => paintWaxwing(c) },
  'visitor:waxwing-fly': {
    x0: -0.42,
    y0: -0.46,
    x1: 0.46,
    y1: 0.4,
    paint: (c, f) => paintSmallFlyer(c, f, '#b3917a', '#dcc6ad', '#a98872', '#605458', '#e9c33a'),
  },
};
