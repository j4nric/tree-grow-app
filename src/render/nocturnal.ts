/**
 * Nachtaktive Arten in der Szene (DESIGN_V2.md 21.6, 21.8): Waldkauz, Braunes Langohr, Igel
 * und Glühwürmchen sind nachts sichtbar aktiver und tagsüber ruhiger – nur Bewegung, sie
 * verschwinden nie.
 *
 *   Waldkauz        tagsüber döst er in der Höhle (Augen zu, ab und zu ein Blinzeln);
 *                   nachts wach: Augen offen, blinzelt, dreht ab und zu den Kopf
 *   Braunes Langohr tagsüber hängt es in der Höhle; nachts fliegt es Schleifen um den
 *                   Stamm (eigenes Flug-Sprite mit Flügelschlag) – nicht im Winterschlaf
 *   Igel            tagsüber fast still; nachts wandert er weiter durchs Laub
 *   Glühwürmchen    tagsüber ruhig; nachts schwirrt es weiter umher (der Schein steht in
 *                   animals.ts)
 *   Haselmaus       Kennart (26.3): tagsüber schläft sie eingerollt in der Krone (Bild 1),
 *                   nachts sitzt sie wach mit Haselnuss; im Winterschlaf immer eingerollt
 *   Ziegenmelker    Kennart (26.3): tagsüber flach am Boden mit geschlossenen Augen
 *                   (Bild 1), nachts Kopf hoch; im Winter ruhend (er ist „in Afrika“,
 *                   verschwindet in der Szene aber nicht)
 *
 * Gilt nur, wenn die Szene eine Tageszeit hat (`AnimalFrame.nocturnal`); ohne Angabe bleibt
 * alles wie bisher. Bei „Weniger Bewegung“ ruhen die Tiere wie alle anderen (nur der Kauz
 * hat tagsüber die Augen zu). Rein bis auf die Sprite-Zeichnung – testbar.
 */

import { clamp01, hash2, lerp, smooth01 } from './util';

/** Arten mit Nachtverhalten (Art-IDs aus src/content/species.ts). */
export const NOCTURNAL_KINDS: ReadonlySet<string> = new Set(['owl', 'bat', 'hedgehog', 'glowworm', 'dormouse', 'nightjar']);

/** Nachtarten, die tagsüber und in ihrer Ruhezeit im Jahr ein Schlafbild (Bild 1) zeigen. */
export const SLEEPER_KINDS: ReadonlySet<string> = new Set(['dormouse', 'nightjar']);

/**
 * Schläft eine Art mit Schlafbild gerade? Tagsüber (Wachheit unter ½) oder in ihrer
 * Ruhezeit im Jahr (`awake` unter ½: Winterschlaf der Haselmaus, Zugzeit des
 * Ziegenmelkers). Ohne Tageszeit (null) nur nach der Jahreszeit.
 */
export function sleeping(kind: string, wake: number | null, awake = 1): boolean {
  if (!SLEEPER_KINDS.has(kind)) return false;
  const a = Number.isFinite(awake) ? awake : 1;
  return a < 0.5 || (wake !== null && wake < 0.5);
}

/** Wachheit der Nachtarten 0 (Tag) – 1 (Nacht) oder null (ohne Tageszeit: wie bisher). */
export function nightWake(nocturnal: number | null | undefined): number | null {
  if (nocturnal === undefined || nocturnal === null || !Number.isFinite(nocturnal)) return null;
  return clamp01(nocturnal);
}

/**
 * Faktor 0–1 für die Bewegung (Aktivität) einer Art: Igel und Glühwürmchen tagsüber
 * ruhiger, nachts voll unterwegs. Höchstens 1 – so bleiben Laufweg und Rand (keepInside)
 * wie geplant; ein schnelleres Tempo bräuchte eine aufsummierte Phase (Sprünge bei
 * zeitabhängigem Tempo) und ist darum bewusst nicht drin. `awake` 0–1: nicht im
 * Winterschlaf (Igel, Fledermaus). Ohne Tageszeit (null) und für andere Arten 1.
 */
export function nocturnalPace(kind: string, wake: number | null, awake = 1): number {
  if (wake === null) return 1;
  const a = clamp01(Number.isFinite(awake) ? awake : 1);
  switch (kind) {
    case 'hedgehog':
      return lerp(0.25, 1, wake * a);
    case 'glowworm':
      return lerp(0.35, 1, wake);
    case 'dormouse':
    case 'nightjar':
      // Schläfer: tagsüber und in der Ruhezeit ganz still, nachts munter.
      return wake * a;
    default:
      return 1;
  }
}

/** Döst der Kauz (Tag)? Ab halber Wachheit ist er wach. */
export function owlDozing(wake: number | null): boolean {
  return wake !== null && wake < 0.5;
}

/** Fliegt die Fledermaus (Nacht, nicht im Winterschlaf, nicht bei weniger Bewegung)? */
export function batFlying(wake: number | null, awake: number, reducedMotion: boolean): boolean {
  return !reducedMotion && wake !== null && wake * clamp01(awake) >= 0.5;
}

/** Wiederverwendeter Punkt für die Flugbahn (keine Allokation pro Frame). */
const flightOut = { x: 0, y: 0, dir: 1, frame: 0 };

/**
 * Flugbahn der Fledermaus um die Höhle (x, y): liegende Acht um den Stamm, Blick in
 * Flugrichtung, Flügelschlag. `S` = Tiergröße, `phase` je Tier.
 */
export function batFlight(x: number, y: number, S: number, t: number, phase: number): { x: number; y: number; dir: number; frame: number } {
  const p = t * 1.1 + phase;
  flightOut.x = x + S * 1.7 * Math.sin(p);
  flightOut.y = y - S * 1.3 + S * 0.55 * Math.sin(2 * p);
  flightOut.dir = Math.cos(p) >= 0 ? 1 : -1;
  flightOut.frame = Math.floor(t * 9 + phase) & 1;
  return flightOut;
}

/**
 * Wache Nacht des Kauzes: Augen offen (das Blinzeln kommt aus animals.ts), ab und zu
 * dreht er den Kopf (Spiegelung, per Seed). Tagsüber Augen zu, selten ein kurzer Blick.
 * Gibt Frame und Blickrichtung zurück.
 */
export function owlPose(frame: number, dir: number, wake: number, t: number, seed: number, phase: number, reducedMotion: boolean): { frame: number; dir: number } {
  owlOut.frame = frame;
  owlOut.dir = dir;
  if (owlDozing(wake)) {
    const peek = !reducedMotion && frac(t / 11 + phase) < 0.07;
    owlOut.frame = peek ? 0 : 1;
  } else if (!reducedMotion) {
    if ((hash2(seed, Math.floor(t / 4.5 + phase)) & 3) === 0) owlOut.dir = -dir;
  }
  return owlOut;
}
const owlOut = { frame: 0, dir: 1 };

function frac(v: number): number {
  return v - Math.floor(v);
}

/** Übergang Tag → Nacht für weiche Werte (z. B. Schein), 0–1. */
export function nightBlend(wake: number | null): number {
  return wake === null ? 0 : smooth01(wake);
}

/**
 * Braunes Langohr im Flug (Seitenansicht von vorn, Flügel gespannt); Mitte auf (0, 0).
 * Frame 0 = Flügel oben, 1 = Flügel unten.
 */
export function paintBatFly(c: CanvasRenderingContext2D, frame: number): void {
  const wing = '#4c3a2e';
  const bone = '#6a5242';
  const fur = '#8b6a4f';
  const ear = '#b98f74';
  const up = frame === 0;
  const tipY = up ? -0.34 : 0.2;
  const midY = up ? -0.16 : 0.14;
  c.lineJoin = 'round';
  c.lineWidth = 0.05;
  c.strokeStyle = 'rgba(30, 22, 18, 0.85)';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(s * 0.06, -0.08);
    c.quadraticCurveTo(s * 0.3, midY - 0.12, s * 0.66, tipY);
    // Gezackter Hinterrand der Flughaut.
    c.quadraticCurveTo(s * 0.56, tipY + 0.16, s * 0.46, midY + 0.1);
    c.quadraticCurveTo(s * 0.36, midY + 0.16, s * 0.28, midY + 0.08);
    c.quadraticCurveTo(s * 0.18, midY + 0.18, s * 0.06, 0.1);
    c.closePath();
    c.fillStyle = wing;
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.06, -0.06);
    c.lineTo(s * 0.46, midY + 0.06);
    c.moveTo(s * 0.3, midY - 0.04);
    c.lineTo(s * 0.62, tipY + 0.02);
    c.strokeStyle = bone;
    c.lineWidth = 0.022;
    c.stroke();
    c.lineWidth = 0.05;
    c.strokeStyle = 'rgba(30, 22, 18, 0.85)';
  }
  // Körper, große Ohren, Kopf
  c.fillStyle = fur;
  c.beginPath();
  c.ellipse(0, 0.02, 0.09, 0.15, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  for (const s of [-1, 1]) {
    c.fillStyle = ear;
    c.beginPath();
    c.ellipse(s * 0.06, -0.24, 0.04, 0.11, s * 0.35, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = fur;
  c.beginPath();
  c.ellipse(0, -0.12, 0.07, 0.065, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#1d1511';
  c.beginPath();
  c.arc(-0.025, -0.13, 0.014, 0, Math.PI * 2);
  c.arc(0.025, -0.13, 0.014, 0, Math.PI * 2);
  c.fill();
}
