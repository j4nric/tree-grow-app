/**
 * Zeichnungen der Durchreisenden (DESIGN_V2.md 7.5) im flachen Stil der Tiere.
 * Alle blicken nach links (Zugrichtung); Ursprung = Körpermitte. Je zwei Bilder
 * (Flügel oben/unten bzw. Flügelschlag), die die Sprite-Cache der Tiere zeichnet.
 */

import { ell, line, outline, ellPath, poly, polyPath, eye, type SpriteDef } from './sprite-kit';

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

export const VISITOR_DEFS: Record<string, SpriteDef> = {
  'visitor:crane': { x0: -1.02, y0: -0.76, x1: 0.96, y1: 0.6, paint: paintCrane },
  'visitor:brambling': { x0: -0.42, y0: -0.46, x1: 0.46, y1: 0.4, paint: paintBrambling },
  'visitor:moth': { x0: -0.62, y0: -0.52, x1: 0.5, y1: 0.18, paint: paintHummingbirdMoth },
  'visitor:flyer': { x0: -0.42, y0: -0.46, x1: 0.46, y1: 0.4, paint: paintFlyer },
};
