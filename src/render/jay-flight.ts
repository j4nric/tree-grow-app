/**
 * Häherflug beim Gründen eines Waldes (DESIGN_V2.md 24.11, Schritt 3): Ein Eichelhäher
 * trägt eine Eichel quer durchs Bild – „Hähersaat“. Kurz (JAY_FLIGHT_SECONDS ≤ 3 s), in
 * der für Häher typischen Wellenlinie: einige Flügelschläge, kurzes Gleiten.
 *
 * Bei „Weniger Bewegung“ fliegt nichts: Der Häher erscheint ruhig am Himmel und blendet
 * wieder aus (Überblendung, JAY_FLIGHT_REDUCED_SECONDS).
 *
 * Das Bild hängt nur von der Eingabe ab (`SceneInput.jayFlight.startedAt` und `time`),
 * außerhalb des Zeitfensters wird nichts gezeichnet. Pro Frame nur ein drawImage eines
 * gecachten Sprites (drei Bilder: Flügel oben, unten, Gleiten), keine Allokation.
 */

import { ell, eye, line, outline, ellPath, poly, polyPath } from './sprite-kit';
import { clamp01, smooth01 } from './util';

/** Dauer des Flugs bzw. der Überblendung (s). */
export const JAY_FLIGHT_SECONDS = 2.8;
export const JAY_FLIGHT_REDUCED_SECONDS = 1.6;
/** So weit (s) darf der Start in der Zukunft liegen – er gilt dann als „jetzt“. */
export const JAY_FLIGHT_LEAD = 1;

/** Zeit im Flug (s) oder NaN außerhalb des Zeitfensters (zu früh, zu spät, ungültig). */
export function jayElapsed(time: number, startedAt: number, reducedMotion: boolean): number {
  if (!Number.isFinite(time) || !Number.isFinite(startedAt)) return Number.NaN;
  const d = time - startedAt;
  const length = reducedMotion ? JAY_FLIGHT_REDUCED_SECONDS : JAY_FLIGHT_SECONDS;
  if (d < -JAY_FLIGHT_LEAD || d >= length) return Number.NaN;
  return Math.max(0, d);
}

/** Lage des Hähers in einem Frame (CSS-Pixel der Szene). */
export interface JayPose {
  x: number;
  y: number;
  /** Bild 0 Flügel oben, 1 unten, 2 Gleiten. */
  frame: number;
  /** Neigung (rad) entlang der Flugbahn. */
  tilt: number;
  alpha: number;
}

/**
 * Lage zum Zeitpunkt `u` (s): von rechts oben über die Krone nach links, in sanften Wellen.
 * Schreibt in `out` (keine Allokation pro Frame).
 */
export function jayPose(u: number, reducedMotion: boolean, width: number, groundY: number, size: number, out: JayPose): JayPose {
  if (!Number.isFinite(u) || u < 0) u = 0;
  if (reducedMotion) {
    // Ruhig am Himmel links der Krone, ein- und ausblenden (je mindestens 0,5 s).
    const d = JAY_FLIGHT_REDUCED_SECONDS;
    out.x = width * 0.3;
    out.y = groundY * 0.2;
    out.frame = 2;
    out.tilt = 0;
    out.alpha = smooth01(u / 0.5) * (1 - smooth01((u - (d - 0.6)) / 0.6));
    return out;
  }
  const t = clamp01(u / JAY_FLIGHT_SECONDS);
  const margin = size * 1.5;
  // Leicht verzögerter Start, gleichmäßiger Flug, sanft hinaus
  const p = 0.85 * t + 0.15 * smooth01(t);
  out.x = width + margin - p * (width + 2 * margin);
  // Wellenflug: zwei Bögen, insgesamt leicht ansteigend
  const wave = Math.sin(t * Math.PI * 4) * size * 0.35;
  out.y = groundY * (0.3 - 0.1 * t) + wave;
  // Schläge (7 Hz) in den Aufwärtsbögen, Gleiten in den Abwärtsbögen
  const climbing = Math.cos(t * Math.PI * 4) > -0.2;
  out.frame = climbing ? (Math.floor(u * 7) % 2 === 0 ? 0 : 1) : 2;
  const dy = Math.cos(t * Math.PI * 4) * size * 0.35 * Math.PI * 4 - groundY * 0.1;
  const dx = -(width + 2 * margin);
  // Blickrichtung links: Neigung relativ zur Flugrichtung nach links
  out.tilt = Math.atan2(dy, -dx) * 0.6;
  out.alpha = smooth01(u / 0.25) * (1 - smooth01((u - (JAY_FLIGHT_SECONDS - 0.3)) / 0.3));
  return out;
}

// ---------------------------------------------------------------------------
// Zeichnung
// ---------------------------------------------------------------------------

const BODY = '#c7a08a';
const BACK = '#b38d78';
const DARK = '#2b2522';
const WHITE = '#f4efe8';
const BLUE = '#3f7fc4';
const BLUE_DARK = '#24508c';

/** Flügel mit blau-schwarz gebänderter Decke, weißem Spiegel und schwarzen Schwingen. */
function wing(c: CanvasRenderingContext2D, tipY: number, folded: boolean): void {
  const tipX = folded ? 0.34 : 0.22;
  const shape = () => {
    c.moveTo(-0.14, -0.05);
    c.quadraticCurveTo(-0.16, tipY * 0.6, tipX, tipY);
    c.quadraticCurveTo(0.14, tipY * 0.35, 0.16, -0.03);
    c.closePath();
  };
  c.fillStyle = DARK;
  c.beginPath();
  shape();
  c.fill();
  // Weißer Flügelspiegel
  ell(c, 0.04, tipY * 0.45, 0.07, Math.max(0.03, Math.abs(tipY) * 0.09), 0, WHITE);
  // Blau gebänderte Flügeldecke an der Schulter
  const by = tipY * 0.2;
  ell(c, -0.06, by, 0.08, Math.max(0.03, Math.abs(tipY) * 0.1), 0, BLUE);
  for (const x of [-0.12, -0.07, -0.02]) line(c, [x, by - 0.03, x + 0.01, by + 0.03], BLUE_DARK, 0.018);
}

/** Eichelhäher im Flug, blickt nach links, eine Eichel im Schnabel. */
export function paintFlyingJay(c: CanvasRenderingContext2D, frame: number): void {
  const tipY = frame === 0 ? -0.5 : frame === 1 ? 0.42 : -0.08;
  const tail = [0.24, -0.05, 0.62, -0.08, 0.64, 0.05, 0.24, 0.05];
  outline(c, 0.07, () => {
    polyPath(c, tail);
    ellPath(c, 0, 0, 0.3, 0.12);
    ellPath(c, -0.3, -0.04, 0.12, 0.1);
  });
  // Weißer Bürzel vor dem schwarzen Schwanz
  poly(c, tail, DARK);
  ell(c, 0.22, -0.01, 0.07, 0.06, 0, WHITE);
  ell(c, 0, 0, 0.3, 0.12, 0, BODY);
  ell(c, 0.02, -0.04, 0.24, 0.06, 0, BACK);
  // Kopf mit gestreifter Haube und schwarzem Bartstreif
  ell(c, -0.3, -0.04, 0.12, 0.1, 0, BODY);
  ell(c, -0.3, -0.11, 0.08, 0.04, 0, '#ddd2c6');
  for (const x of [-0.34, -0.3, -0.26]) line(c, [x, -0.13, x + 0.01, -0.09], DARK, 0.012);
  line(c, [-0.36, 0.0, -0.3, 0.04], DARK, 0.025);
  poly(c, [-0.41, -0.05, -0.5, -0.02, -0.41, 0.0], '#3a3330');
  eye(c, -0.35, -0.06, 0.022);
  // Eichel im Schnabel
  ell(c, -0.53, -0.01, 0.045, 0.032, 0.3, '#a8752f');
  ell(c, -0.5, -0.025, 0.035, 0.022, 0.3, '#6b4a26');
  if (frame === 2) {
    // Gleiten: Flügel ausgebreitet, leicht nach hinten gezogen
    wing(c, tipY, true);
  } else {
    wing(c, tipY, false);
  }
}

/** Begrenzung des Sprites in Zeicheneinheiten (alle Bilder). */
const BOUNDS = { x0: -0.62, y0: -0.6, x1: 0.72, y1: 0.5 };

/** Zustand je Canvas: gecachte Sprites (je Größe und Auflösung). */
export class JayFlight {
  private sprites: (HTMLCanvasElement | null)[] = [null, null, null];
  private readonly pose: JayPose = { x: 0, y: 0, frame: 0, tilt: 0, alpha: 0 };
  /** Wie oft Sprites gezeichnet wurden (für Tests). */
  builds = 0;

  /** Sprites freigeben (nach dem Flug). */
  release(): void {
    for (const s of this.sprites) {
      if (s) {
        s.width = 0;
        s.height = 0;
      }
    }
    this.sprites[0] = this.sprites[1] = this.sprites[2] = null;
  }

  get prepared(): boolean {
    return this.sprites[0] !== null;
  }

  private sprite(frame: number, unit: number, res: number): HTMLCanvasElement {
    // Schlüssel nur bei neuer Größe/Auflösung (kein String pro Frame: Zahlen vergleichen).
    if (this.unit !== unit || this.res !== res) {
      this.release();
      this.unit = unit;
      this.res = res;
    }
    let s = this.sprites[frame];
    if (!s) {
      s = document.createElement('canvas');
      const px = unit * res;
      s.width = Math.max(1, Math.ceil((BOUNDS.x1 - BOUNDS.x0) * px));
      s.height = Math.max(1, Math.ceil((BOUNDS.y1 - BOUNDS.y0) * px));
      const c = s.getContext('2d')!;
      c.setTransform(px, 0, 0, px, -BOUNDS.x0 * px, -BOUNDS.y0 * px);
      paintFlyingJay(c, frame);
      this.sprites[frame] = s;
      this.builds++;
    }
    return s;
  }

  private unit = 0;
  private res = 0;

  /**
   * Zeichnet den Häher zum Zeitpunkt `u` (s). `unit`: Spannweite des Sprites in CSS-Pixeln
   * (≈ 2 Tiergrößen); `sx`, `sy`, `tx`, `ty` wie bei den Tieren (Szene × dpr → Canvas).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    u: number,
    reducedMotion: boolean,
    width: number,
    groundY: number,
    unit: number,
    dpr: number,
    spriteDpr: number,
    sx: number,
    sy: number,
    tx: number,
    ty: number,
  ): void {
    const p = jayPose(u, reducedMotion, width, groundY, unit, this.pose);
    if (p.alpha <= 0.01) return;
    const s = this.sprite(p.frame, unit, spriteDpr);
    const k = dpr / spriteDpr;
    const cos = Math.cos(p.tilt);
    const sin = Math.sin(p.tilt);
    ctx.globalAlpha = p.alpha;
    // Szene (CSS) × dpr → Canvas, dann drehen um die Körpermitte und das Sprite (spriteDpr) einpassen.
    ctx.setTransform(sx * cos * k, sy * sin * k, -sx * sin * k, sy * cos * k, tx + sx * p.x * dpr, ty + sy * p.y * dpr);
    ctx.drawImage(s, BOUNDS.x0 * unit * spriteDpr, BOUNDS.y0 * unit * spriteDpr);
    ctx.globalAlpha = 1;
  }
}
