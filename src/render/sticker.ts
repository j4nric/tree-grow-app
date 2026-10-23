/**
 * Album-Sticker: die Tierzeichnungen des Renderers als quadratische Einzelbilder für das
 * Sammelalbum (docs/ALBUM_UI.md D.4).
 *
 * - Jede Art (und jeder Gast) nutzt dieselbe `SpriteDef` wie in der Szene, Bild 0
 *   (Ausnahmen in STICKER_POSE).
 * - Die Zeichnung wird nach ihrem Rahmen eingepasst: 80 % der Kantenlänge (schlanke Tiere
 *   bis 90 %), mittig, nie beschnitten (`stickerFit`, `stickerFrame`).
 * - Varianten: `color` (normal), `muted` (entsättigt wie ruhende Tiere in der Szene) und
 *   `silhouette` (einfarbiger Schatten in --ink für unentdeckte Arten).
 * - Gecacht in einem eigenen LRU (höchstens 256 Bilder), getrennt vom SpriteCache der
 *   Szene. Zwei Aufrufe mit gleicher Art, Pixelgröße und Variante liefern dasselbe Canvas.
 * - Für das Album auch als Bild-URL (`renderSpeciesStickerUrl`): Ein `<img>` ist für den
 *   Browser ein gewöhnliches Bild, ein `<canvas>` dagegen eine eigene Compositing-Ebene
 *   (Chromium hebt jedes 2D-Canvas heraus, dazu jedes darüberliegende Element). Die URL
 *   wird einmal je Bild erzeugt und hängt am gecachten Canvas (fällt mit ihm aus dem LRU).
 *
 * Pflanzen bekommen bewusst keinen Renderer-Sticker (G-17): Das Album zeigt für sie das
 * Gruppen-Symbol.
 */

import { desaturateCanvas, speciesKindOf, spriteDefOf, type AnimalFamily } from './animals';
import type { SpriteDef } from './sprite-kit';

export type StickerVariant = 'color' | 'muted' | 'silhouette';

/** Anteil der Kantenlänge, den die Zeichnung (ihr Rahmen) höchstens einnimmt. */
export const STICKER_FILL = 0.8;

/** Höchstzahl gecachter Sticker-Bilder. */
export const STICKER_CACHE_MAX = 256;

/** Farbe der Silhouette: --ink (#3B3A36) bei 55 % Deckkraft. */
export const SILHOUETTE_FILL = 'rgba(59, 58, 54, 0.55)';

/** Gast-ID (src/content/visitors.ts) → Zeichnung (visitor-sprites.ts), je ein Einzeltier. */
const VISITOR_STICKER: Readonly<Record<string, string>> = {
  cranes: 'visitor:crane',
  bramblings: 'visitor:brambling',
  'hummingbird-moth': 'visitor:moth',
  swallows: 'visitor:swallow',
  boars: 'visitor:boar',
  peregrine: 'visitor:falcon',
  'stag-flight': 'visitor:stag',
  waxwings: 'visitor:waxwing',
};

/**
 * Engere Sticker-Rahmen für Zeichnungen, deren SpriteDef-Rahmen in der Szene Platz für
 * Bewegung oder Leuchten lässt (gemessen am tatsächlich gezeichneten Bild 0, plus 0,02
 * Rand). Ohne Eintrag gilt der Rahmen der SpriteDef. So sitzen z. B. das Glühwürmchen
 * (Rahmen mit Lichthof) und die Gäste im Flug mittig und groß genug im Sticker.
 */
const STICKER_FRAME: Readonly<Record<string, Pick<SpriteDef, 'x0' | 'y0' | 'x1' | 'y1'>>> = {
  glowworm: { x0: -0.28, y0: -0.24, x1: 0.37, y1: 0.16 },
  peacock: { x0: -0.38, y0: -0.5, x1: 0.54, y1: 0.36 },
  lizard: { x0: -0.84, y0: -0.2, x1: 0.48, y1: 0.05 },
  sandlizard: { x0: -0.84, y0: -0.22, x1: 0.49, y1: 0.05 },
  slowworm: { x0: -0.76, y0: -0.2, x1: 0.52, y1: 0.06 },
  grasssnake: { x0: -0.68, y0: -0.25, x1: 0.64, y1: 0.07 },
  smoothsnake: { x0: -0.68, y0: -0.25, x1: 0.64, y1: 0.09 },
  'visitor:crane': { x0: -1.02, y0: -0.16, x1: 0.96, y1: 0.66 },
  'visitor:brambling': { x0: -0.4, y0: -0.51, x1: 0.49, y1: 0.18 },
  'visitor:swallow': { x0: -0.36, y0: -0.45, x1: 0.67, y1: 0.13 },
  'visitor:falcon': { x0: -0.49, y0: -0.18, x1: 0.64, y1: 0.43 },
};

/**
 * Bild für den Sticker, falls nicht Bild 0: Kranich und Falke sind mit gesenkten Flügeln
 * (Bild 1) deutlich besser zu erkennen als im Flügelschlag nach oben.
 */
const STICKER_POSE: Readonly<Record<string, number>> = {
  'visitor:crane': 1,
  'visitor:falcon': 1,
};

/** Welches Bild der Zeichnung der Sticker zeigt (meist 0). */
export function stickerPose(kind: string): number {
  return Object.hasOwn(STICKER_POSE, kind) ? STICKER_POSE[kind]! : 0;
}

/** Rahmen, nach dem eine Zeichnung im Sticker eingepasst wird (Sticker-Rahmen, sonst SpriteDef). */
export function stickerFrame(kind: string): Pick<SpriteDef, 'x0' | 'y0' | 'x1' | 'y1'> | undefined {
  const def = spriteDefOf(kind);
  if (!def) return undefined;
  return (Object.hasOwn(STICKER_FRAME, kind) ? STICKER_FRAME[kind] : undefined) ?? def;
}

/** Zeichnung für eine Art-ID oder Gast-ID (Fallback: Gattung). null, wenn gar nichts passt. */
export function stickerKind(id: string, family?: AnimalFamily): string | null {
  const visitor = Object.hasOwn(VISITOR_STICKER, id) ? VISITOR_STICKER[id] : undefined;
  if (visitor) return visitor;
  const kind = speciesKindOf(id, family);
  return kind && spriteDefOf(kind) ? kind : null;
}

/** Längste Seite schlanker Zeichnungen (Seitenverhältnis ab 3 : 1); dazwischen gleitend. */
export const STICKER_FILL_SLENDER = 0.9;

/**
 * Reine Rechnung: Maßstab und Versatz, um einen SpriteDef-Rahmen in ein Quadrat der
 * Kantenlänge `size` einzupassen. Das Seitenverhältnis bleibt erhalten; die längere Seite
 * füllt STICKER_FILL (80 %), die Mitte des Rahmens liegt in der Mitte des Quadrats.
 * Schlanke Tiere (Wurm, Eidechse, Schlange) dürfen bis STICKER_FILL_SLENDER lang werden,
 * sonst blieben sie im runden Sticker ein dünner Strich; ihr Rahmen passt dabei weiterhin
 * in den Kreis (Diagonale < Kantenlänge).
 * Zeichnen: `setTransform(scale, 0, 0, scale, ox, oy)`, dann `paint`.
 */
export function stickerFit(def: Pick<SpriteDef, 'x0' | 'y0' | 'x1' | 'y1'>, size: number): { scale: number; ox: number; oy: number } {
  const w = Math.max(1e-6, def.x1 - def.x0);
  const h = Math.max(1e-6, def.y1 - def.y0);
  const long = Math.max(w, h);
  const aspect = long / Math.min(w, h);
  const slender = Math.min(1, Math.max(0, (aspect - 1.5) / 1.5));
  const scale = (size * (STICKER_FILL + (STICKER_FILL_SLENDER - STICKER_FILL) * slender)) / long;
  return {
    scale,
    ox: size / 2 - ((def.x0 + def.x1) / 2) * scale,
    oy: size / 2 - ((def.y0 + def.y1) / 2) * scale,
  };
}

// ---------------------------------------------------------------------------
// LRU-Cache
// ---------------------------------------------------------------------------

/** Map hält die Einfügereihenfolge: vorne das am längsten unbenutzte Bild. */
const cache = new Map<string, HTMLCanvasElement>();

function cacheGet(key: string): HTMLCanvasElement | undefined {
  const hit = cache.get(key);
  if (hit) {
    // Als zuletzt benutzt nach hinten stellen.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cachePut(key: string, canvas: HTMLCanvasElement): void {
  cache.set(key, canvas);
  while (cache.size > STICKER_CACHE_MAX) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
}

/** Anzahl der gecachten Sticker-Bilder (für Tests und Messungen). */
export function stickerCacheSize(): number {
  return cache.size;
}

/** Leert den Sticker-Cache (Tests; z. B. auch bei Speicherdruck). */
export function clearStickerCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Zeichnen
// ---------------------------------------------------------------------------

/**
 * Sticker-Bild einer Art: quadratisch, `size` CSS-Pixel, Pixeldichte `dpr`. Die Zeichnung
 * (Bild 0, siehe `stickerPose`) wird eingepasst (80 % der Fläche, zentriert nach ihrem Rahmen) und nicht
 * beschnitten. Gecacht nach (kind, size, dpr, variant) in eigenem LRU (max. 256), getrennt vom
 * SpriteCache der Szene. Das gelieferte Canvas ist schreibgeschützt (nie verändern).
 * Ohne passende Zeichnung (unbekannte ID ohne Gattung) gibt es ein leeres, durchsichtiges Bild.
 */
export function renderSpeciesSticker(
  id: string,
  size: number,
  opts: { dpr?: number; variant?: StickerVariant; family?: AnimalFamily } = {},
): HTMLCanvasElement {
  const dpr = Number.isFinite(opts.dpr) && opts.dpr! > 0 ? Math.min(4, opts.dpr!) : 1;
  const variant = opts.variant ?? 'color';
  // Gleiche Gerätepixel = gleiches Bild: der Schlüssel nutzt nur die Pixelgröße.
  const px = Math.max(1, Math.min(1024, Math.round((Number.isFinite(size) ? Math.max(0, size) : 0) * dpr)));
  const kind = stickerKind(id, opts.family) ?? '';
  return stickerFor(kind, px, variant);
}

/** Data-URL je gecachtem Bild (fällt mit dem Canvas aus dem LRU). */
const urls = new WeakMap<HTMLCanvasElement, string>();

/**
 * Wie `renderSpeciesSticker`, aber als Bild-URL (PNG, verlustfrei) für ein `<img>`. Eine
 * Data-URL statt einer Blob-URL: Chromium lädt sie synchron, das Bild steht also im selben
 * Frame wie bisher das Canvas (kein Aufblitzen), und es gibt nichts freizugeben. Gleiche
 * Eingaben liefern dieselbe Zeichenkette – das Bild wird dann nur einmal dekodiert.
 */
export function renderSpeciesStickerUrl(
  id: string,
  size: number,
  opts: { dpr?: number; variant?: StickerVariant; family?: AnimalFamily } = {},
): string {
  const canvas = renderSpeciesSticker(id, size, opts);
  let url = urls.get(canvas);
  if (url === undefined) {
    url = canvas.toDataURL('image/png');
    urls.set(canvas, url);
  }
  return url;
}

function stickerFor(kind: string, px: number, variant: StickerVariant): HTMLCanvasElement {
  const key = `${kind}|${px}|${variant}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  let canvas: HTMLCanvasElement;
  if (variant === 'muted') {
    canvas = desaturateCanvas(stickerFor(kind, px, 'color'));
  } else {
    canvas = paintSticker(kind, px);
    if (variant === 'silhouette') toSilhouette(canvas);
  }
  cachePut(key, canvas);
  return canvas;
}

function paintSticker(kind: string, px: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const def = kind ? spriteDefOf(kind) : undefined;
  if (!def) return canvas;
  const c = canvas.getContext('2d')!;
  const fit = stickerFit(stickerFrame(kind) ?? def, px);
  c.setTransform(fit.scale, 0, 0, fit.scale, fit.ox, fit.oy);
  def.paint(c, stickerPose(kind));
  c.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

/** Färbt alle gezeichneten Pixel einheitlich (Form bleibt über die Deckkraft erhalten). */
function toSilhouette(canvas: HTMLCanvasElement): void {
  const c = canvas.getContext('2d')!;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = SILHOUETTE_FILL;
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.restore();
}
