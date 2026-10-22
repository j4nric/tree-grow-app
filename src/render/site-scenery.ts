/**
 * Kulisse je Waldtyp (DESIGN_V2.md 24.11, Schritt 3): Horizont, Hintergrund-Bäume und
 * Bodenfarben des aktiven Standorts der Waldlandschaft.
 *
 *   home        Heimatwald – die bekannten sanften Hügel (unverändert)
 *   floodplain  Auwald am Fluss – Fluss mit Silberweiden am Ufer, dahinter Auwald
 *   carr        Erlenbruch – dunkle Wasserflächen zwischen Bulten, Schwarzerlen, Nebelbänder
 *   beechwood   Buchenhallen – graue Säulenstämme, lichtes Dach, kaum Unterwuchs, Laubstreu
 *   mountain    Bergmischwald – Bergketten mit Schnee (im Winter mehr), Tannen am Hang
 *   heath       Kiefernheide – Sand, lila Heidekraut, lichte Schirmkiefern
 *
 * Gezeichnet wird in die statische Kulisse (tree.ts, `paintStatic`) – also nur bei
 * Größenänderung, neuer Jahreszeit-Stufe, neuem Lebensraum oder Standortwechsel. Tag und
 * Nacht und das Wetter tönen die Kulisse wie bisher. Alles liegt hinter dem Mittelgrund
 * der Lebensräume (Wiese, Mauer) und berührt keine Ankerpunkte der Tiere. Seed-Zufall,
 * kein Math.random().
 *
 * Die IDs entsprechen `SiteId` in src/content/landscape.ts (der Renderer liest keine
 * Inhalte; ein Test hält beide Listen gleich).
 */

import type { Layout } from './layout';
import { paintHills, SKY } from './scenery';
import { curve, seasonColor, seasonHill, type SeasonLook } from './season';
import { clamp01, mix, mulberry32 } from './util';

export const SCENE_SITES = ['home', 'floodplain', 'carr', 'beechwood', 'mountain', 'heath'] as const;
export type SceneSiteId = (typeof SCENE_SITES)[number];

/** Bekannte Standort-ID oder null. */
export function normalizeSite(id: unknown): SceneSiteId | null {
  return typeof id === 'string' && (SCENE_SITES as readonly string[]).includes(id) ? (id as SceneSiteId) : null;
}

/** Standort für die Szene: unbekannt oder ohne Angabe → Heimatwald (Bild wie bisher). */
export function sceneSite(id: unknown): SceneSiteId {
  return normalizeSite(id) ?? 'home';
}

/** Demo- und Testparameter `?site=<id>` aus einem Query-String: bekannte ID oder null. */
export function siteParam(search: string): SceneSiteId | null {
  try {
    return normalizeSite(new URLSearchParams(search).get('site'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bodenfarben
// ---------------------------------------------------------------------------

/** Farben des Erdschnitts (Verlauf, Steine, Krümel) und wie viele Steine. */
export interface SoilColors {
  top: string;
  bottom: string;
  stone: string;
  crumb: string;
  /** Faktor auf die Zahl der Steine (1 = wie im Heimatwald). */
  stones: number;
}

/** Farben der Grasnarbe: Band (oben hell, unten dunkler) und Halme; `density` 1 = wie bisher. */
export interface GrassColors {
  band: string;
  bandLight: string;
  blade: string;
  bladeLight: string;
  density: number;
}

export interface SiteGround {
  soil: SoilColors;
  grass: GrassColors;
}

/** Heimatwald: genau die bisherigen Farben (scenery.ts). */
export const HOME_GROUND: SiteGround = {
  soil: { top: '#6b4b30', bottom: '#3f2b1c', stone: '#7f6853', crumb: '#a58a6c', stones: 1 },
  grass: { band: '#5d9a3e', bandLight: '#78b153', blade: '#5d9a3e', bladeLight: '#78b153', density: 1 },
};

const GROUNDS: Record<SceneSiteId, SiteGround> = {
  home: HOME_GROUND,
  // Auenlehm: graubraun und fett, sattes Gras.
  floodplain: {
    soil: { top: '#5f4a37', bottom: '#382b20', stone: '#7a6a5a', crumb: '#9a8a76', stones: 0.5 },
    grass: { band: '#4f9a3f', bandLight: '#6fb552', blade: '#4a9440', bladeLight: '#74b856', density: 1.15 },
  },
  // Torf: fast schwarz, Moospolster statt Rasen.
  carr: {
    soil: { top: '#46372a', bottom: '#211912', stone: '#5c5044', crumb: '#7a6a54', stones: 0.25 },
    grass: { band: '#4d8146', bandLight: '#6f9c55', blade: '#567f3e', bladeLight: '#86a65a', density: 0.8 },
  },
  // Lehm unter einer Decke aus Buchenlaub; nur wenige Halme.
  beechwood: {
    soil: { top: '#6a4a30', bottom: '#3c2a1b', stone: '#80705e', crumb: '#a88c68', stones: 0.8 },
    grass: { band: '#8a6640', bandLight: '#a98352', blade: '#6c9644', bladeLight: '#b08a55', density: 0.35 },
  },
  // Steiniger Hangboden.
  mountain: {
    soil: { top: '#5f5143', bottom: '#342b23', stone: '#8d8478', crumb: '#a99f90', stones: 2.2 },
    grass: { band: '#55903f', bandLight: '#74a957', blade: '#4f8a3d', bladeLight: '#80b060', density: 0.9 },
  },
  // Sand: hell und gelblich, trockene Grasnarbe.
  heath: {
    soil: { top: '#b99a64', bottom: '#80603a', stone: '#d2bf95', crumb: '#e6d6ad', stones: 0.6 },
    grass: { band: '#8a9a4c', bandLight: '#a9b466', blade: '#7e8c44', bladeLight: '#b5b56c', density: 0.7 },
  },
};

export function siteGround(site: SceneSiteId): SiteGround {
  return GROUNDS[site] ?? HOME_GROUND;
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

/** Laub der Hintergrund-Bäume: Jahreszeit (seasonHill), im Winter kahl-graubraun. */
function canopy(hex: string, look: SeasonLook | null): string {
  if (!look || look.summer) return hex;
  let c = hex;
  if (look.leaves < 1) c = mix(c, '#9a8f84', (1 - look.leaves) * 0.7);
  return seasonHill(c, look);
}

/** Dunst der Ferne (Luftperspektive). */
function haze(hex: string, t: number): string {
  return mix(hex, SKY.haze, t);
}

/** Hügelkette wie in scenery.ts (zwei Sinus), von x = 0 bis `width`, gefüllt bis zum Boden. */
function ridge(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number, base: number, amp: number, f1: number, f2: number, p: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, groundY + 1);
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    ctx.lineTo(u * width, groundY - height * (base + amp * (0.6 * Math.sin(u * f1 + p) + 0.4 * Math.sin(u * f2 + p * 2.3))));
  }
  ctx.lineTo(width, groundY + 1);
  ctx.closePath();
  ctx.fill();
}

/** Höhe einer Hügelkette an der Stelle x (gleiche Formel wie `ridge`). */
function ridgeY(x: number, width: number, height: number, groundY: number, base: number, amp: number, f1: number, f2: number, p: number): number {
  const u = x / width;
  return groundY - height * (base + amp * (0.6 * Math.sin(u * f1 + p) + 0.4 * Math.sin(u * f2 + p * 2.3)));
}

/** Waldsaum als Band runder Kronen (ferner Laubwald) auf Höhe `y` (Kronen-Unterkante). */
function crownBelt(ctx: CanvasRenderingContext2D, width: number, y: number, r: number, colors: readonly string[], seed: number): void {
  const rand = mulberry32(seed);
  for (let pass = 0; pass < colors.length; pass++) {
    ctx.fillStyle = colors[pass]!;
    ctx.beginPath();
    let x = -r;
    while (x < width + r) {
      const rr = r * (0.7 + rand() * 0.6);
      const cy = y - rr * (0.6 + rand() * 0.6) - pass * r * 0.15;
      ctx.moveTo(x + rr, cy);
      ctx.arc(x, cy, rr, 0, Math.PI * 2);
      x += rr * (1.1 + rand() * 0.5);
    }
    // Unterkante schließen
    ctx.rect(0, y - r * 0.6, width, r * 0.6 + 1);
    ctx.fill();
  }
}

/** Weiche Nebelbänder (waagerecht, mit ausfransenden Enden). */
function fogBand(ctx: CanvasRenderingContext2D, width: number, y: number, h: number, alpha: number, seed: number): void {
  const rand = mulberry32(seed);
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const cx = width * (rand() * 1.1 - 0.05);
    const rx = width * (0.22 + rand() * 0.3);
    const ry = h * (0.5 + rand() * 0.5);
    const cy = y + (rand() - 0.5) * h * 0.6;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, `rgba(240, 244, 242, ${alpha})`);
    g.addColorStop(0.6, `rgba(240, 244, 242, ${alpha * 0.55})`);
    g.addColorStop(1, 'rgba(240, 244, 242, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    // Ellipse als gestauchter Kreis: Verlauf in der Breite, Höhe nur über ry.
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Kulisse je Standort
// ---------------------------------------------------------------------------

/**
 * Zeichnet Horizont und Hintergrund des Standorts (nach dem Himmel, vor den Lebensräumen
 * im Mittelgrund und dem Erdschnitt). Heimatwald: die bisherigen Hügel.
 */
export function paintSiteBackdrop(ctx: CanvasRenderingContext2D, layout: Layout, site: SceneSiteId, look: SeasonLook | null): void {
  const { width, height, groundY } = layout;
  switch (site) {
    case 'floodplain':
      paintFloodplain(ctx, width, height, groundY, look);
      return;
    case 'carr':
      paintCarr(ctx, width, height, groundY, look);
      return;
    case 'beechwood':
      paintBeechwood(ctx, width, height, groundY, look);
      return;
    case 'mountain':
      paintMountain(ctx, width, height, groundY, look);
      return;
    case 'heath':
      paintHeath(ctx, width, height, groundY, look);
      return;
    default:
      paintHills(ctx, width, height, groundY, look);
  }
}

// --- Auwald am Fluss --------------------------------------------------------

/** Silberweide: kurzer, schiefer Stamm, hängende silbergrüne Krone (im Winter gelbe Ruten). */
function willow(ctx: CanvasRenderingContext2D, x: number, base: number, h: number, look: SeasonLook | null, hz: number, rand: () => number): void {
  const leaves = look ? look.leaves : 1;
  const lean = (rand() - 0.5) * h * 0.18;
  const tw = h * 0.085;
  const top = base - h * 0.42;
  ctx.fillStyle = haze('#6f6559', hz);
  ctx.beginPath();
  ctx.moveTo(x - tw * 0.7, base + 1);
  ctx.lineTo(x - tw * 0.45 + lean, top);
  ctx.lineTo(x + tw * 0.45 + lean, top);
  ctx.lineTo(x + tw * 0.7, base + 1);
  ctx.closePath();
  ctx.fill();
  const cx = x + lean;
  const cy = base - h * 0.66;
  const rx = h * 0.42;
  const ry = h * 0.36;
  // Ruten: im Winter gelb-orange und sichtbar, sonst unter dem Laub
  ctx.strokeStyle = haze('#c8a24e', hz + 0.1);
  ctx.lineWidth = Math.max(0.6, h * 0.012);
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI * (0.1 + 0.8 * (i / 15));
    const sx = cx + Math.cos(a) * rx * 0.35;
    const sy = top + Math.sin(a) * ry * 0.25;
    const ex = cx + Math.cos(a) * rx * (0.9 + rand() * 0.2);
    const ey = cy + Math.sin(a) * ry * 0.4 - ry * 0.1;
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo((sx + ex) / 2, ey - ry * 0.5, ex, ey + ry * (0.6 + rand() * 0.3));
  }
  ctx.stroke();
  if (leaves <= 0.02) return;
  ctx.globalAlpha = Math.min(1, leaves * 1.15);
  const tones = ['#7d9c80', '#93b294', '#b2c8ad'].map((c) => haze(canopy(c, look), hz));
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = tones[k]!;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const u = (i + 0.5) / 6 - 0.5;
      const px = cx + u * rx * 1.7 + (rand() - 0.5) * rx * 0.2;
      const py = cy + Math.abs(u) * ry * 0.5 - k * ry * 0.18 + (rand() - 0.5) * ry * 0.2;
      const r = rx * (0.32 + rand() * 0.12) * (1 - k * 0.22);
      // Hängende Form: unten länger als oben
      ctx.moveTo(px + r, py);
      ctx.ellipse(px, py + r * 0.2, r, r * 1.25, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintFloodplain(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number, look: SeasonLook | null): void {
  // Ferne, flache Hügel und dahinter der Auwald
  ridge(ctx, width, height, groundY, 0.1, 0.022, 4.1, 11.3, 1.3, seasonHill('#b4d2bf', look));
  crownBelt(
    ctx,
    width,
    groundY - height * 0.066,
    height * 0.032,
    ['#9fc39c', '#b3d1ac'].map((c) => haze(canopy(c, look), 0.45)),
    101,
  );
  // Hochwasser im Frühling: der Fluss ist breiter.
  const spring = look ? look.spring : 0;
  const top = groundY - height * (0.066 + 0.006 * spring);
  const bottom = groundY - height * 0.03;
  // Ferne Uferwiese
  ctx.fillStyle = seasonHill('#a6cb98', look);
  ctx.fillRect(0, groundY - height * 0.07, width, height * 0.07 + 1);
  // Fluss: Band mit leicht geschwungenen Ufern, spiegelt den Himmel
  const water = ctx.createLinearGradient(0, top, 0, bottom);
  const snow = look ? look.snow : 0;
  water.addColorStop(0, mix('#bcdbe8', '#e3ecf0', snow * 0.7));
  water.addColorStop(1, mix('#86b6cf', '#c9d8e2', snow * 0.7));
  ctx.fillStyle = water;
  ctx.beginPath();
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width;
    const y = top + Math.sin(i * 0.7 + 0.4) * height * 0.003;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const x = (i / steps) * width;
    ctx.lineTo(x, bottom + Math.sin(i * 0.9 + 1.7) * height * 0.004);
  }
  ctx.closePath();
  ctx.fill();
  // Lichtreflexe auf dem Wasser (im Winter Eisschollen-Glanz)
  const rand = mulberry32(211);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = Math.max(0.8, height * 0.0018);
  ctx.beginPath();
  for (let i = 0; i < Math.round(width / 40); i++) {
    const x = rand() * width;
    const y = top + (bottom - top) * (0.25 + rand() * 0.6);
    const l = width * (0.015 + rand() * 0.03);
    ctx.moveTo(x, y);
    ctx.lineTo(x + l, y);
  }
  ctx.stroke();
  // Silberweiden am fernen Ufer (klein) und am nahen Ufer (größer, mehr Farbe)
  const wr = mulberry32(307);
  for (let i = 0; i < 7; i++) {
    const x = width * ((i + 0.2 + wr() * 0.6) / 7);
    willow(ctx, x, top + height * 0.004, height * (0.06 + wr() * 0.025), look, 0.42, wr);
  }
  // Nahes Ufer: Wiese vom Fluss bis zur Bodenlinie
  const near = ctx.createLinearGradient(0, bottom, 0, groundY);
  near.addColorStop(0, seasonHill('#8fbf84', look));
  near.addColorStop(1, seasonHill('#86b97c', look));
  ctx.fillStyle = near;
  ctx.beginPath();
  ctx.moveTo(0, groundY + 1);
  for (let i = 0; i <= steps; i++) ctx.lineTo((i / steps) * width, bottom + Math.sin(i * 0.9 + 1.7) * height * 0.004);
  ctx.lineTo(width, groundY + 1);
  ctx.closePath();
  ctx.fill();
  // Schilf am nahen Ufer
  ctx.strokeStyle = seasonColor('#7c9a52', look);
  ctx.lineWidth = Math.max(0.7, height * 0.0016);
  ctx.beginPath();
  const rr = mulberry32(419);
  for (let i = 0; i < Math.round(width / 9); i++) {
    const x = rr() * width;
    const y = bottom + rr() * height * 0.006;
    const h = height * (0.008 + rr() * 0.012);
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rr() - 0.5) * h * 0.4, y - h);
  }
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const x = width * ((i + 0.15 + wr() * 0.7) / 4);
    willow(ctx, x, bottom + height * 0.008, height * (0.1 + wr() * 0.035), look, 0.18, wr);
  }
}

// --- Erlenbruch ---------------------------------------------------------------

/** Schwarzerle: dunkler, oft mehrstämmiger Wuchs, eiförmige dunkelgrüne Krone, auf einem Bult. */
function alder(ctx: CanvasRenderingContext2D, x: number, base: number, h: number, look: SeasonLook | null, hz: number, rand: () => number): void {
  const leaves = look ? look.leaves : 1;
  const trunk = haze('#3f3934', hz);
  // Bult (Wurzelteller) im Wasser
  ctx.fillStyle = haze(seasonColor('#5f7a46', look), hz);
  ctx.beginPath();
  ctx.ellipse(x, base, h * 0.12, h * 0.035, 0, Math.PI, 0);
  ctx.fill();
  const stems = 1 + Math.floor(rand() * 3);
  ctx.fillStyle = trunk;
  for (let s = 0; s < stems; s++) {
    const dx = (s - (stems - 1) / 2) * h * 0.05;
    const tw = h * 0.032;
    ctx.beginPath();
    ctx.moveTo(x + dx - tw, base);
    ctx.lineTo(x + dx * 1.8 - tw * 0.4, base - h * 0.8);
    ctx.lineTo(x + dx * 1.8 + tw * 0.4, base - h * 0.8);
    ctx.lineTo(x + dx + tw, base);
    ctx.closePath();
    ctx.fill();
  }
  if (leaves <= 0.02) {
    // Im Winter: dunkle Zweige mit Zäpfchen
    ctx.strokeStyle = trunk;
    ctx.lineWidth = Math.max(0.6, h * 0.008);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const y = base - h * (0.35 + rand() * 0.5);
      const side = i % 2 === 0 ? -1 : 1;
      ctx.moveTo(x, y);
      ctx.lineTo(x + side * h * (0.12 + rand() * 0.14), y - h * 0.1);
    }
    ctx.stroke();
    return;
  }
  ctx.globalAlpha = Math.min(1, leaves * 1.2);
  const tones = ['#3e5f45', '#4c6e4f', '#5f805b'].map((c) => haze(canopy(c, look), hz));
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = tones[k]!;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const cy = base - h * (0.55 + (i / 4) * 0.33) - k * h * 0.02;
      const w = h * 0.2 * (1 - Math.abs(i - 1.5) * 0.18) * (1 - k * 0.2);
      const cx = x + (rand() - 0.5) * h * 0.06;
      ctx.moveTo(cx + w, cy);
      ctx.ellipse(cx, cy, w, h * 0.13 * (1 - k * 0.15), 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintCarr(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number, look: SeasonLook | null): void {
  // Sehr flache, dunstige Ferne
  ridge(ctx, width, height, groundY, 0.075, 0.015, 3.3, 9.7, 2.4, haze(seasonHill('#a9c4b4', look), 0.25));
  crownBelt(ctx, width, groundY - height * 0.058, height * 0.026, ['#7f9e86', '#93ae95'].map((c) => haze(canopy(c, look), 0.5)), 503);
  // Hintere Nebelbank
  fogBand(ctx, width, groundY - height * 0.075, height * 0.03, 0.55, 601);
  // Nasser Grund: dunkles, stehendes Wasser
  const wTop = groundY - height * 0.06;
  const snow = look ? look.snow : 0;
  const wet = ctx.createLinearGradient(0, wTop, 0, groundY);
  wet.addColorStop(0, mix('#8a9c95', '#d8e0e2', snow * 0.75));
  wet.addColorStop(1, mix('#4e5b50', '#b9c4c6', snow * 0.75));
  ctx.fillStyle = wet;
  ctx.fillRect(0, wTop, width, groundY - wTop + 1);
  // Spiegelungen
  const rand = mulberry32(613);
  ctx.strokeStyle = 'rgba(225, 235, 232, 0.45)';
  ctx.lineWidth = Math.max(0.7, height * 0.0015);
  ctx.beginPath();
  for (let i = 0; i < Math.round(width / 45); i++) {
    const x = rand() * width;
    const y = wTop + (groundY - wTop) * (0.15 + rand() * 0.7);
    ctx.moveTo(x, y);
    ctx.lineTo(x + width * (0.01 + rand() * 0.025), y);
  }
  ctx.stroke();
  // Erlen auf Bulten: hinten blass, vorn dunkler und größer
  const ar = mulberry32(709);
  for (let i = 0; i < 8; i++) {
    const x = width * ((i + 0.1 + ar() * 0.8) / 8);
    alder(ctx, x, wTop + height * 0.012, height * (0.11 + ar() * 0.04), look, 0.45, ar);
  }
  for (let i = 0; i < 5; i++) {
    const x = width * ((i + 0.1 + ar() * 0.8) / 5);
    alder(ctx, x, wTop + height * 0.034, height * (0.16 + ar() * 0.05), look, 0.22, ar);
  }
  // Bulten mit Seggen und Torfmoos im Vordergrund des Wassers
  const br = mulberry32(811);
  const moss = seasonHill('#7d9a55', look);
  const mossLight = seasonHill('#9db567', look);
  const sedge = seasonColor('#7c8f4c', look);
  for (let i = 0; i < Math.round(width / 38); i++) {
    const x = br() * width;
    const y = groundY - height * (0.004 + br() * 0.03);
    const rx = height * (0.02 + br() * 0.02);
    const ry = rx * 0.4;
    ctx.fillStyle = moss;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = mossLight;
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.2, y - ry * 0.35, rx * 0.6, ry * 0.45, 0, Math.PI, 0);
    ctx.fill();
    // Seggen-Büschel
    ctx.strokeStyle = sedge;
    ctx.lineWidth = Math.max(0.6, height * 0.0013);
    ctx.beginPath();
    for (let k = 0; k < 7; k++) {
      const bx = x + (k - 3) * rx * 0.18;
      ctx.moveTo(bx, y - ry * 0.6);
      ctx.lineTo(bx + (k - 3) * rx * 0.12, y - ry * 0.6 - rx * (0.6 + br() * 0.5));
    }
    ctx.stroke();
  }
  // Sumpfdotterblumen im Frühling
  const spring = look ? look.spring : 0;
  if (spring > 0.05) {
    ctx.globalAlpha = clamp01(spring * 1.3);
    ctx.fillStyle = '#f2c935';
    ctx.beginPath();
    const fr = mulberry32(907);
    for (let i = 0; i < Math.round(width / 22); i++) {
      const x = fr() * width;
      const y = groundY - height * (0.006 + fr() * 0.035);
      const r = Math.max(1.2, height * 0.0035);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Vordere Nebelbank über dem Wasser
  fogBand(ctx, width, groundY - height * 0.03, height * 0.022, 0.4, 619);
}

// --- Buchenhallen ---------------------------------------------------------------

function paintBeechwood(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number, look: SeasonLook | null): void {
  ridge(ctx, width, height, groundY, 0.06, 0.012, 3.1, 8.3, 0.4, haze(seasonHill('#b0c9b0', look), 0.2));
  const leaves = look ? look.leaves : 1;
  const autumn = look ? look.autumn : 0;
  // Laubdach: grün, im Frühling hell, im Herbst kupfern, im Winter fort (nur Zweige)
  const roof = (hex: string, hz: number) => haze(mix(canopy(hex, look), '#b9773a', autumn * 0.55), hz);
  const rand = mulberry32(1201);
  // Drei Tiefen: hinten dünn und blass, vorn dicker und kräftiger
  const layers = [
    { n: 11, w: 0.012, hz: 0.55, base: 0.06, top: 0.08 },
    { n: 7, w: 0.02, hz: 0.36, base: 0.035, top: 0.03 },
    { n: 4, w: 0.032, hz: 0.18, base: 0.012, top: -0.02 },
  ];
  // Hallen-Boden in der Ferne: Laubstreu
  const floor = ctx.createLinearGradient(0, groundY - height * 0.07, 0, groundY);
  floor.addColorStop(0, haze(seasonColor('#b39a72', look), 0.4));
  floor.addColorStop(1, seasonColor('#a07f54', look));
  ctx.fillStyle = floor;
  ctx.fillRect(0, groundY - height * 0.065, width, height * 0.065 + 1);
  // Frühjahrsblüher (Buschwindröschen) vor dem Laubaustrieb
  const spring = look ? look.spring : 0;
  if (spring > 0.05) {
    ctx.globalAlpha = clamp01(spring * 1.4);
    ctx.fillStyle = '#f4f2ea';
    ctx.beginPath();
    const fr = mulberry32(1229);
    for (let i = 0; i < Math.round(width / 6); i++) {
      const x = fr() * width;
      const y = groundY - height * (0.004 + fr() * 0.055);
      const r = Math.max(0.9, height * 0.0022 * (1 - (groundY - y) / (height * 0.08)));
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (const L of layers) {
    const bark = haze('#8e908a', L.hz);
    const light = haze('#b8b9b0', L.hz);
    const shade = haze('#676b62', L.hz);
    const tw = Math.max(1.5, height * L.w);
    const baseY = groundY - height * L.base;
    const topY = groundY * L.top;
    for (let i = 0; i < L.n; i++) {
      const x = width * ((i + 0.15 + rand() * 0.7) / L.n);
      const w = tw * (0.8 + rand() * 0.45);
      // Säule mit leichtem Stammfuß; die glatte Rinde hat eine helle Lichtseite
      ctx.fillStyle = bark;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.9, baseY + 1);
      ctx.quadraticCurveTo(x - w * 0.5, baseY - w * 1.2, x - w * 0.42, baseY - w * 3);
      ctx.lineTo(x - w * 0.36, topY);
      ctx.lineTo(x + w * 0.36, topY);
      ctx.lineTo(x + w * 0.42, baseY - w * 3);
      ctx.quadraticCurveTo(x + w * 0.5, baseY - w * 1.2, x + w * 0.9, baseY + 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = light;
      ctx.fillRect(x - w * 0.3, topY, w * 0.18, baseY - topY - w * 1.5);
      ctx.fillStyle = shade;
      ctx.fillRect(x + w * 0.16, topY, w * 0.18, baseY - topY - w * 1.5);
      // Ein paar Äste ganz oben, die ins Dach führen
      ctx.strokeStyle = bark;
      ctx.lineWidth = Math.max(0.6, w * 0.22);
      ctx.beginPath();
      const ay = topY + (baseY - topY) * 0.08;
      ctx.moveTo(x, ay + w * 3);
      ctx.lineTo(x - w * (3 + rand() * 3), ay - w * 2);
      ctx.moveTo(x, ay + w * 5);
      ctx.lineTo(x + w * (3 + rand() * 3), ay);
      ctx.stroke();
    }
  }
  // Geschlossenes Dach am oberen Rand (Lücken lassen Himmel durch)
  const r = Math.max(width, height) * 0.05;
  const dr = mulberry32(1303);
  const tones = ['#6f9a5c', '#86ad69', '#a2c47e'];
  const amount = clamp01(leaves);
  if (amount > 0.02) {
    ctx.globalAlpha = 0.85 * amount;
    for (let k = 0; k < tones.length; k++) {
      ctx.fillStyle = roof(tones[k]!, 0.38 - k * 0.06);
      ctx.beginPath();
      let x = -r * 0.5;
      while (x < width + r) {
        const rr = r * (0.6 + dr() * 0.6) * (1 - k * 0.2);
        const y = groundY * (0.02 + dr() * 0.09) + k * r * 0.15;
        ctx.moveTo(x + rr, y);
        ctx.ellipse(x, y, rr * 1.3, rr * 0.8, 0, 0, Math.PI * 2);
        x += rr * (1.3 + dr() * 0.9);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// --- Bergmischwald --------------------------------------------------------------

/** Schneegrenze als Anteil der Gipfelhöhe von oben (Sommer: nur die Spitzen; Winter: weit hinab). */
export function mountainSnowLine(look: SeasonLook | null): number {
  if (!look || look.summer) return 0.14;
  return clamp01(0.14 + 0.16 * look.spring + 0.06 * look.autumn + 0.5 * look.snow);
}

/** Bergkette: gezackter Umriss aus Gipfeln (Seed), darauf Schnee bis zur Schneegrenze. */
function range(
  ctx: CanvasRenderingContext2D,
  width: number,
  groundY: number,
  peaks: number,
  lo: number,
  hi: number,
  color: string,
  shade: string,
  snowLine: number,
  snowAlpha: number,
  seed: number,
): void {
  const rand = mulberry32(seed);
  const pts: number[] = [];
  const step = width / peaks;
  let x = -step * 0.5;
  pts.push(x, groundY - lo * 0.5);
  while (x < width + step) {
    const px = x + step * (0.35 + rand() * 0.3);
    const py = groundY - (lo + rand() * (hi - lo));
    pts.push(px, py);
    x += step;
    // Sattel zwischen den Gipfeln
    pts.push(x, groundY - lo * (0.55 + rand() * 0.3));
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0]!, groundY + 1);
  for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.lineTo(pts[pts.length - 2]!, groundY + 1);
  ctx.closePath();
  ctx.fill();
  // Schattenflanken rechts der Gipfel (Licht von links)
  ctx.fillStyle = shade;
  ctx.beginPath();
  for (let i = 2; i + 3 < pts.length; i += 4) {
    const px = pts[i]!;
    const py = pts[i + 1]!;
    const sx = pts[i + 2]!;
    const sy = pts[i + 3]!;
    ctx.moveTo(px, py);
    ctx.lineTo(sx, sy);
    ctx.lineTo(px + (sx - px) * 0.25, groundY + 1);
    ctx.closePath();
  }
  ctx.fill();
  if (snowAlpha <= 0.01 || snowLine <= 0) return;
  // Schneekappen: Dreieck unter jedem Gipfel bis zur Schneegrenze, mit gezackter Unterkante
  ctx.fillStyle = '#f3f6f9';
  ctx.globalAlpha = snowAlpha;
  ctx.beginPath();
  for (let i = 2; i < pts.length; i += 4) {
    const px = pts[i]!;
    const py = pts[i + 1]!;
    const lx = pts[i - 2]!;
    const ly = pts[i - 1]!;
    const rx = pts[i + 2] ?? px + step * 0.5;
    const ry = pts[i + 3] ?? ly;
    const depth = (groundY - py) * snowLine;
    const y = py + depth;
    // Schnittpunkte der Flanken mit der Schneegrenze
    const tl = Math.min(1, depth / Math.max(1e-6, ly - py));
    const tr = Math.min(1, depth / Math.max(1e-6, ry - py));
    const x0 = px + (lx - px) * tl;
    const x1 = px + (rx - px) * tr;
    ctx.moveTo(px, py);
    ctx.lineTo(x0, py + (ly - py) * tl);
    const n = 4;
    for (let k = 1; k < n; k++) {
      const u = k / n;
      ctx.lineTo(x0 + (x1 - x0) * u, y - depth * (k % 2 === 0 ? 0.08 : 0.22));
    }
    ctx.lineTo(x1, py + (ry - py) * tr);
    ctx.closePath();
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Tanne/Fichte als schmale, gestufte Spitze (im Winter mit Schnee auf den Etagen). */
function fir(ctx: CanvasRenderingContext2D, x: number, base: number, h: number, color: string, snow: number): void {
  const w = h * 0.24;
  ctx.fillStyle = color;
  ctx.beginPath();
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const y0 = base - h * (0.12 + (t / tiers) * 0.88);
    const y1 = base - h * (0.12 + ((t + 1) / tiers) * 0.88) - h * 0.08;
    const ww = w * (1 - t / (tiers + 0.6));
    ctx.moveTo(x - ww, y0);
    ctx.lineTo(x, y1);
    ctx.lineTo(x + ww, y0);
    ctx.closePath();
  }
  ctx.rect(x - h * 0.02, base - h * 0.14, h * 0.04, h * 0.14);
  ctx.fill();
  if (snow <= 0.02) return;
  ctx.globalAlpha = clamp01(snow);
  ctx.fillStyle = '#eef3f6';
  ctx.beginPath();
  for (let t = 0; t < tiers; t++) {
    const y0 = base - h * (0.12 + (t / tiers) * 0.88);
    const y1 = base - h * (0.12 + ((t + 1) / tiers) * 0.88) - h * 0.08;
    const ww = w * (1 - t / (tiers + 0.6));
    ctx.moveTo(x - ww * 0.55, y0 - (y0 - y1) * 0.45);
    ctx.lineTo(x, y1);
    ctx.lineTo(x + ww * 0.55, y0 - (y0 - y1) * 0.45);
    ctx.closePath();
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

function paintMountain(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number, look: SeasonLook | null): void {
  const snowLine = mountainSnowLine(look);
  const snow = look ? look.snow : 0;
  // Ferne Hochgebirgskette (bläulich, viel Dunst), davor eine nähere, dunklere
  range(ctx, width, groundY, Math.max(3, Math.round(width / 260)), height * 0.2, height * 0.34, haze('#93a7ba', 0.35), haze('#7f93a8', 0.35), snowLine, 0.95, 1401);
  range(
    ctx,
    width,
    groundY,
    Math.max(3, Math.round(width / 200)),
    height * 0.12,
    height * 0.2,
    haze(seasonHill('#7d9098', look), 0.2),
    haze(seasonHill('#6a7d86', look), 0.2),
    snowLine * 0.75,
    clamp01(0.35 + snow * 0.65),
    1409,
  );
  // Bewaldeter Hang: Mischwald aus Buchen (Laub, Jahreszeit) und Tannen
  const hill = { base: 0.085, amp: 0.025, f1: 4.6, f2: 12.7, p: 0.9 };
  ridge(ctx, width, height, groundY, hill.base, hill.amp, hill.f1, hill.f2, hill.p, haze(seasonHill('#6f9268', look), 0.15));
  const rand = mulberry32(1427);
  const firColor = haze('#2f5240', 0.25);
  const beech = ['#7aa268', '#8db478'].map((c) => haze(canopy(c, look), 0.22));
  const count = Math.round(width / 11);
  for (let i = 0; i < count; i++) {
    const x = (i + rand()) * (width / count);
    const y = ridgeY(x, width, height, groundY, hill.base, hill.amp, hill.f1, hill.f2, hill.p) + height * (0.004 + rand() * 0.01);
    if (rand() < 0.62) fir(ctx, x, y, height * (0.035 + rand() * 0.025), firColor, snow);
    else {
      ctx.fillStyle = beech[Math.floor(rand() * 2)]!;
      ctx.beginPath();
      const r = height * (0.012 + rand() * 0.008);
      ctx.ellipse(x, y - r * 0.8, r, r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Näherer Hang mit größeren Tannen
  const near = { base: 0.04, amp: 0.016, f1: 6.8, f2: 15.3, p: 2.7 };
  ridge(ctx, width, height, groundY, near.base, near.amp, near.f1, near.f2, near.p, seasonHill('#8db582', look));
  const nr = mulberry32(1433);
  const nearFir = haze('#2c4d3a', 0.1);
  for (let i = 0; i < Math.round(width / 42); i++) {
    const x = nr() * width;
    const y = ridgeY(x, width, height, groundY, near.base, near.amp, near.f1, near.f2, near.p) + height * (0.006 + nr() * 0.01);
    fir(ctx, x, y, height * (0.06 + nr() * 0.04), nearFir, snow);
  }
  // Felsbrocken auf der nahen Wiese
  ctx.fillStyle = seasonHill('#9a958a', look);
  ctx.beginPath();
  for (let i = 0; i < Math.round(width / 120); i++) {
    const x = nr() * width;
    const y = groundY - height * (0.004 + nr() * 0.012);
    const r = height * (0.006 + nr() * 0.008);
    ctx.moveTo(x + r * 1.4, y);
    ctx.ellipse(x, y, r * 1.4, r, 0, Math.PI, 0);
  }
  ctx.fill();
}

// --- Kiefernheide ---------------------------------------------------------------

/** Blüte des Heidekrauts (0–1): August/September (Spätsommer), ohne Angabe wie im Sommer. */
export function heatherBloom(look: SeasonLook | null): number {
  const s = look ? look.s : 1;
  return curve(
    [
      [0, 0.12],
      [1, 0.6],
      [1.6, 1],
      [2.1, 0.85],
      [2.6, 0.3],
      [3.2, 0.1],
      [4, 0.12],
    ],
    s,
  );
}

/** Waldkiefer der Ferne: schlanker, oben rötlicher Stamm, flache Schirmkrone aus Nadelpolstern. */
function pine(ctx: CanvasRenderingContext2D, x: number, base: number, h: number, hz: number, snow: number, rand: () => number): void {
  const tw = Math.max(1, h * 0.035);
  const lean = (rand() - 0.5) * h * 0.1;
  // Krone im oberen Drittel: unregelmäßig gerundet aus Nadelpolstern in mehreren Etagen
  const crownLow = base - h * (0.58 + rand() * 0.08);
  const crownTop = base - h;
  const cx = x + lean;
  // Stamm: unten graubraun, oben die typische fuchsrote Spiegelrinde
  const trunk = ctx.createLinearGradient(0, base, 0, crownLow);
  trunk.addColorStop(0, haze('#6e5644', hz));
  trunk.addColorStop(0.45, haze('#9a6440', hz));
  trunk.addColorStop(1, haze('#c07a46', hz));
  ctx.strokeStyle = trunk;
  ctx.lineWidth = tw;
  ctx.beginPath();
  ctx.moveTo(x, base + 1);
  ctx.quadraticCurveTo(x + lean * 0.2, base - h * 0.4, cx, crownTop + h * 0.12);
  ctx.stroke();
  ctx.strokeStyle = haze('#a86a3e', hz);
  ctx.lineWidth = Math.max(0.6, tw * 0.45);
  ctx.beginPath();
  const pads: [number, number, number][] = [];
  const n = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const v = i / (n - 1);
    const py = crownLow - (crownLow - crownTop - h * 0.06) * v;
    // Breiteste Stelle etwa in der Mitte der Krone, oben schmal
    const spread = h * 0.17 * (1 - Math.abs(v - 0.4) * 0.9);
    const side = i % 2 === 0 ? -1 : 1;
    const px = cx + side * spread * (0.35 + rand() * 0.65);
    pads.push([px, py, h * (0.055 + rand() * 0.035)]);
    ctx.moveTo(cx, py + h * 0.05);
    ctx.lineTo(px, py + h * 0.01);
  }
  ctx.stroke();
  const tones = ['#3c5d4b', '#4f7258', '#69886a'].map((c) => haze(c, hz));
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = tones[k]!;
    ctx.beginPath();
    for (const [px, py, r] of pads) {
      const rr = r * (1 - k * 0.25);
      ctx.moveTo(px + rr * 1.2, py - k * r * 0.15);
      ctx.ellipse(px, py - k * r * 0.15, rr * 1.2, rr * 0.62, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  if (snow > 0.02) {
    ctx.globalAlpha = clamp01(snow * 0.9);
    ctx.fillStyle = '#eef3f6';
    ctx.beginPath();
    for (const [px, py, r] of pads) {
      ctx.moveTo(px + r * 0.8, py - r * 0.18);
      ctx.ellipse(px, py - r * 0.22, r * 0.8, r * 0.2, 0, Math.PI, 0);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function paintHeath(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number, look: SeasonLook | null): void {
  const snow = look ? look.snow : 0;
  // Ferne, flache Sandrücken
  ridge(ctx, width, height, groundY, 0.075, 0.02, 3.6, 10.1, 1.9, haze(seasonHill('#c7cda2', look), 0.25));
  // Ferne Kiefernreihe
  const rand = mulberry32(1601);
  for (let i = 0; i < Math.round(width / 70); i++) {
    const x = rand() * width;
    pine(ctx, x, groundY - height * (0.055 + rand() * 0.01), height * (0.07 + rand() * 0.03), 0.5, snow, rand);
  }
  // Heidefläche bis zur Bodenlinie: Sand mit Heidekraut
  const flat = ctx.createLinearGradient(0, groundY - height * 0.06, 0, groundY);
  flat.addColorStop(0, seasonHill('#c9c091', look));
  flat.addColorStop(1, seasonHill('#b9ad7c', look));
  ctx.fillStyle = flat;
  ctx.beginPath();
  ctx.moveTo(0, groundY + 1);
  const steps = 24;
  for (let i = 0; i <= steps; i++) ctx.lineTo((i / steps) * width, groundY - height * (0.058 + 0.006 * Math.sin(i * 0.8 + 0.3)));
  ctx.lineTo(width, groundY + 1);
  ctx.closePath();
  ctx.fill();
  // Offene Sandstellen
  ctx.fillStyle = mix('#e6d3a0', '#eef2f4', snow * 0.7);
  ctx.beginPath();
  const sr = mulberry32(1607);
  for (let i = 0; i < Math.round(width / 90); i++) {
    const x = sr() * width;
    const y = groundY - height * (0.012 + sr() * 0.035);
    const rx = height * (0.03 + sr() * 0.05);
    ctx.moveTo(x + rx, y);
    ctx.ellipse(x, y, rx, rx * 0.16, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  // Nähere Kiefern und Wacholder
  for (let i = 0; i < Math.max(3, Math.round(width / 170)); i++) {
    const x = width * ((i + 0.15 + rand() * 0.7) / Math.max(3, Math.round(width / 170)));
    pine(ctx, x, groundY - height * (0.03 + rand() * 0.012), height * (0.15 + rand() * 0.07), 0.2, snow, rand);
  }
  ctx.fillStyle = haze('#3e5a45', 0.15);
  ctx.beginPath();
  for (let i = 0; i < Math.round(width / 160); i++) {
    const x = rand() * width;
    const y = groundY - height * (0.02 + rand() * 0.02);
    const h = height * (0.03 + rand() * 0.025);
    ctx.moveTo(x, y - h);
    ctx.quadraticCurveTo(x + h * 0.3, y - h * 0.5, x + h * 0.16, y);
    ctx.lineTo(x - h * 0.16, y);
    ctx.quadraticCurveTo(x - h * 0.3, y - h * 0.5, x, y - h);
  }
  ctx.fill();
  // Heidekraut: kleine Polster, im Spätsommer lila
  const bloom = heatherBloom(look);
  const green = seasonColor('#6f6f50', look);
  const tones = [mix(green, '#9a5d93', bloom), mix(seasonColor('#7d7558', look), '#b67cae', bloom), mix(seasonColor('#8a7c5e', look), '#c99bc3', bloom * 0.9)].map((c) =>
    mix(c, '#e9eef0', snow * 0.55),
  );
  const hr = mulberry32(1613);
  for (let k = 0; k < tones.length; k++) {
    ctx.fillStyle = tones[k]!;
    ctx.beginPath();
    const count = Math.round(width / (5 + k * 3));
    for (let i = 0; i < count; i++) {
      const x = hr() * width;
      const d = hr();
      const y = groundY - height * 0.052 * (1 - d) - k * 0.6;
      const r = Math.max(1, height * (0.004 + 0.008 * d) * (1 - k * 0.25));
      ctx.moveTo(x + r * 1.5, y);
      ctx.ellipse(x, y, r * 1.5, r, 0, Math.PI, 0);
    }
    ctx.fill();
  }
}
