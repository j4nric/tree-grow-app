/**
 * Begleitpflanzen um den Hauptbaum – reine Geometrie ohne Canvas (testbar).
 *
 * Jede Pflanze hat über ihre Gruppe und den Rang ihres Platzes (`slot`) innerhalb der
 * Gruppe eine feste Lage (die Plätze im Pflanzring gelten für alle Gruppen gemeinsam):
 *   Bäume       weiter hinten und seitlich (blasser, je nach Reihe)
 *   Sträucher   am Rand der Szene
 *   Blumen      im Waldsaum zwischen Stamm und Rand
 *   Moose/Farne am Stammfuß und im Schatten unter der Krone
 * Danach wird jede Pflanze so weit verschoben, dass sie nie auf dem Stamm des
 * Hauptbaums steht und ihre Mitte nicht auf einem Tierplatz am Boden liegt. Tiere werden
 * ohnehin über den Pflanzen gezeichnet – so bleiben sie auch gut lesbar.
 *
 * Gleiche Eingabe → gleiche Lage. Alle Größen wachsen stetig mit dem Hauptbaum.
 */

import { createAnchorResolver, animalSize, type AnchorResolver } from './anchors';
import { placeMainTree, placeTree, trunkFootHalf, type Layout, type PlacedTree } from './layout';
import { normalizeSpecies, trunkWidthOf, type TreeSpecies } from './plant';
import { clamp, clamp01, hash2, smooth01 } from './util';

/** Gruppen-IDs wie in scripts/v2/content.ts (`PLANT_GROUPS`). */
export const SCENE_PLANT_GROUPS = ['trees', 'shrubs', 'flowers', 'mosses'] as const;
export type ScenePlantGroup = (typeof SCENE_PLANT_GROUPS)[number];

/** Eine Begleitpflanze, wie sie der Renderer bekommt (unabhängig vom Spielkern). */
export interface ScenePlant {
  /** Pflanzen-ID, z. B. 'birch'. Unbekannte IDs bekommen die Zeichnung ihrer Gruppe. */
  id: string;
  /** 'trees' | 'shrubs' | 'flowers' | 'mosses' (sonst nicht gezeichnet; 'herbs' gilt als 'flowers'). */
  group: ScenePlantGroup;
  /** Platz im Pflanzring, 0..n. Die Lage folgt dem Rang des Platzes innerhalb der Gruppe. */
  slot: number;
  /** Versorgung mit Licht und Wasser 0–1; niedrig → kleiner, blasser, weniger Blüten. */
  vigor: number;
}

/** Pflanzen-IDs (scripts/v2/content.ts) mit eigener Zeichnung → Gruppe. */
export const PLANT_SPECIES: Record<string, ScenePlantGroup> = {
  birch: 'trees',
  rowan: 'trees',
  beech: 'trees',
  pine: 'trees',
  hazel: 'shrubs',
  bramble: 'shrubs',
  elder: 'shrubs',
  anemone: 'flowers',
  nettle: 'flowers',
  strawberry: 'flowers',
  foxglove: 'flowers',
  moss: 'mosses',
  fern: 'mosses',
  hartstongue: 'mosses',
};

/** Ersatz-Zeichnung je Gruppe für unbekannte IDs. */
export const GROUP_FALLBACK: Record<ScenePlantGroup, string> = {
  trees: 'tree',
  shrubs: 'shrub',
  flowers: 'flower',
  mosses: 'moss',
};

export function normalizeGroup(group: string): ScenePlantGroup | null {
  if (group === 'herbs') return 'flowers';
  return (SCENE_PLANT_GROUPS as readonly string[]).includes(group) ? (group as ScenePlantGroup) : null;
}

/** Zeichnung einer Pflanze: eigene je ID, sonst Ersatz der Gruppe (null = nicht zeichnen). */
export function plantKind(p: Pick<ScenePlant, 'id' | 'group'>): string | null {
  const group = normalizeGroup(String(p.group));
  const own = PLANT_SPECIES[p.id];
  if (own && (group === null || group === own)) return p.id;
  return group ? GROUP_FALLBACK[group] : null;
}

/** Größe der niedrigen Pflanzen voll ausgewachsen, in Tiergrößen: Höhe, halbe Breite. */
export const LOW_SIZE: Record<string, [number, number]> = {
  hazel: [2.5, 1.35],
  bramble: [1.45, 1.45],
  elder: [2.8, 1.35],
  shrub: [2.1, 1.25],
  anemone: [0.5, 0.7],
  nettle: [1.5, 0.45],
  strawberry: [0.48, 0.58],
  foxglove: [2.0, 0.42],
  flower: [0.8, 0.55],
  moss: [0.32, 0.6],
  fern: [1.25, 0.85],
  hartstongue: [0.8, 0.6],
};

/** Bäume: Höchstwachstum (wie g des Hauptbaums), Höhen- und Breitenfaktor. */
const TREE_SHAPE: Record<string, { cap: number; height: number; width: number }> = {
  birch: { cap: 3.5, height: 1, width: 0.1 },
  rowan: { cap: 2.9, height: 0.82, width: 0.11 },
  beech: { cap: 3.9, height: 1, width: 0.14 },
  pine: { cap: 3.6, height: 1.05, width: 0.085 },
  tree: { cap: 3.5, height: 0.95, width: 0.13 },
};

/** Lage je Gruppe und Platz: Anteil der Breite ab Mitte (+ rechts), bei Bäumen dazu die Reihe (0 vorn, 1 hinten). */
const TREE_SLOTS: [number, number][] = [
  [-0.31, 0],
  [0.33, 0],
  [-0.44, 1],
  [0.45, 1],
  [-0.2, 1],
  [0.21, 1],
  [-0.5, 0],
  [0.52, 0],
  [-0.37, 1],
  [0.38, 1],
  [-0.1, 1],
  [0.12, 1],
];
const SHRUB_SLOTS = [0.47, -0.46, 0.39, -0.4, 0.53, -0.54, 0.3, -0.29, 0.43, -0.5, 0.35, -0.35];
const FLOWER_SLOTS = [-0.25, 0.27, -0.37, 0.36, -0.19, 0.2, -0.44, 0.45, -0.31, 0.31, -0.14, 0.15];
/** Moose: die ersten beiden am Stammfuß (Lage dort aus der Stammbreite), dann im Schatten unter der Krone. */
const MOSS_SLOTS = [0, 0, -0.13, 0.15, -0.21, 0.22, -0.09, 0.1, -0.17, 0.18, -0.25, 0.26];
const FOOT_SIDE = [-1, 1];
/** Größte halbe Breite (in Tiergrößen) der Moose am Stammfuß – passt vor den ersten Laubstreu-Platz. */
const FOOT_HALF_WIDTH = 0.36;

export interface PlacedPlant {
  /** Index in der übergebenen Pflanzenliste. */
  index: number;
  id: string;
  kind: string;
  group: ScenePlantGroup;
  slot: number;
  /** Fußpunkt (CSS-Pixel). */
  x: number;
  y: number;
  /** Halbe Breite und Höhe (CSS-Pixel). */
  hw: number;
  h: number;
  /** Tiefe: 0 vorn … 1 hinten (nur Bäume); Dunst entsprechend. */
  depth: number;
  haze: number;
  vigor: number;
  /** Wachstum der niedrigen Pflanzen 0–1. */
  grow: number;
  seed: number;
  /** Nur Bäume: Geometrie (x/y wie oben). */
  tree: PlacedTree | null;
}

export interface FloraOptions {
  /** Hauptbaum (sonst wird er aus `g` berechnet). */
  main?: PlacedTree | null;
  /** Tier-Ankerpunkte (sonst neu berechnet). */
  anchors?: AnchorResolver;
  /** Art des Hauptbaums (Standard: Eiche) – muss zu `main` passen. */
  species?: TreeSpecies;
}

/** Lücken zwischen Sperrbereichen, die schmaler sind (px), gelten als geschlossen. */
const MIN_GAP = 3;

/** Tierplätze am Boden, die frei bleiben sollen (Laubstreu, Waldsaum, Pilze an der Oberfläche). */
export const KEEP_CLEAR_SLOTS = 4;

/**
 * Platziert die Pflanzen. Gibt sie in Zeichenreihenfolge zurück (hinten → vorn):
 * hintere Bäume, vordere Bäume, Sträucher, Blumen, Moose.
 */
export function layoutFlora(layout: Layout, growth: number, plants: readonly ScenePlant[], opts: FloraOptions = {}): PlacedPlant[] {
  if (plants.length === 0) return [];
  const g = Math.max(0, Number.isFinite(growth) ? growth : 0);
  const species = normalizeSpecies(opts.species);
  const main = opts.main !== undefined ? opts.main : placeMainTree(layout, g, species);
  const anchors = opts.anchors ?? createAnchorResolver(layout, g, main);
  const S = animalSize(layout.width, layout.height);
  const { cx, width } = layout;
  const tb = trunkBaseHalf(g, main, layout);

  // Tierplätze am Boden: Mitte einer Pflanze nicht darauf. Gesperrt wird die ganze
  // Strecke, die ein Platz beim Wachsen des Stamms zurücklegt (Keimling bis Urwald) –
  // so bleibt die Lage der Pflanzen über das ganze Spiel ruhig und springt nicht.
  const groundSpans = groundSpansFor(layout, species).map(([a, b]): [number, number] => [a, b]);
  groundSpots(anchors).forEach((x, i) => {
    const span = groundSpans[i]!;
    span[0] = Math.min(span[0], x);
    span[1] = Math.max(span[1], x);
  });
  // Weitester Abstand des ersten Laubstreu-Platzes (links, Index 0) vom Stamm.
  const footZone = Math.max(cx - groundSpans[0]![0], 0);

  const lowGrow = smooth01((g - 1.3) / 4.5);
  const placedLow: PlacedPlant[] = [];
  const lowSpan: number[] = [];
  const placedTrees: PlacedPlant[] = [];
  // Bäume, dann Sträucher, Blumen, Moose; innerhalb der Gruppe nach Platz.
  const order = plants
    .map((p, index) => ({ p, index, group: normalizeGroup(String(p.group)), kind: plantKind(p) }))
    .filter((e) => e.group !== null && e.kind !== null && Number.isFinite(e.p.slot) && e.p.slot >= 0)
    .sort((a, b) => SCENE_PLANT_GROUPS.indexOf(a.group!) - SCENE_PLANT_GROUPS.indexOf(b.group!) || a.p.slot - b.p.slot || a.index - b.index);

  const ranks: Partial<Record<ScenePlantGroup, number>> = {};
  for (const { p, index, group, kind } of order) {
    const slot = Math.floor(p.slot);
    const vigor = clamp01(Number.isFinite(p.vigor) ? p.vigor : 1);
    const seed = hash2(hashString(p.id), slot * 13 + SCENE_PLANT_GROUPS.indexOf(group!));
    // Lage nach Rang innerhalb der Gruppe (Plätze im Pflanzring sind gruppenübergreifend).
    const rank = (ranks[group!] = (ranks[group!] ?? -1) + 1);
    const round = Math.floor(rank / 12);
    const shift = round * 0.035 * (rank % 2 === 0 ? 1 : -1);
    const vigorScale = 0.82 + 0.18 * vigor;

    if (group === 'trees') {
      const shape = TREE_SHAPE[kind!] ?? TREE_SHAPE.tree!;
      const [fx, row] = TREE_SLOTS[rank % TREE_SLOTS.length]!;
      const depth = row;
      const gp = 1 + clamp((g - 1.8) * 0.85, 0, shape.cap) * vigorScale;
      const baseY = layout.groundY - layout.height * (depth ? 0.02 : 0.006);
      const maxH = (baseY - layout.top) * (depth ? 0.58 : 0.72) * shape.height;
      const tree = placeTree(gp, seed, 0, baseY, maxH, width * shape.width * (depth ? 0.85 : 1));
      const hw = Math.max(-tree.geo.minX, tree.geo.maxX) * tree.scale;
      const h = -tree.geo.minY * tree.scale;
      const trunkHalf = (trunkWidthOf(gp) * tree.trunkWidth * tree.scale) / 2;
      const forbid: [number, number][] = [[cx - tb - trunkHalf - S * 0.6, cx + tb + trunkHalf + S * 0.6]];
      for (const [a, b] of groundSpans) forbid.push([a - trunkHalf - S * 0.3, b + trunkHalf + S * 0.3]);
      for (const o of placedTrees) {
        if (o.depth === depth) forbid.push([o.x - (o.hw + hw) * 0.55, o.x + (o.hw + hw) * 0.55]);
      }
      const x = nudge(cx + (fx + shift) * width, forbid, Math.min(trunkHalf + 2, width / 2), width - Math.min(trunkHalf + 2, width / 2));
      tree.x = x;
      const pl: PlacedPlant = { index, id: p.id, kind: kind!, group: group!, slot, x, y: baseY, hw, h, depth, haze: depth ? 0.34 : 0.14, vigor, grow: clamp01((gp - 1) / 3), seed, tree };
      placedTrees.push(pl);
      continue;
    }

    const [hf, wf] = LOW_SIZE[kind!] ?? LOW_SIZE.flower!;
    // Am Stammfuß ist nur zwischen Stamm und erstem Laubstreu-Platz Raum: dort kleiner.
    const foot = group === 'mosses' && rank < 2;
    const fit = foot ? Math.min(1, FOOT_HALF_WIDTH / wf) : 1;
    const scale = S * (0.45 + 0.55 * lowGrow) * vigorScale * fit;
    const h = hf * scale;
    const hw = wf * scale;
    let x0: number;
    if (foot) {
      x0 = cx + FOOT_SIDE[rank]! * (tb + hw + S * 0.12);
    } else if (group === 'mosses') {
      x0 = cx + (MOSS_SLOTS[rank % MOSS_SLOTS.length]! + shift) * width;
    } else {
      const list = group === 'shrubs' ? SHRUB_SLOTS : FLOWER_SLOTS;
      x0 = cx + (list[rank % list.length]! + shift) * width;
    }
    const forbid: [number, number][] = [[cx - tb - hw - S * 0.1, cx + tb + hw + S * 0.1]];
    const r = S * 0.5;
    // Am Stammfuß wandern Moos und Laubstreu-Plätze gemeinsam mit dem Stamm nach außen:
    // dort zählen die heutigen Plätze, sonst die ganze Strecke über das Spiel.
    // Die hintere Waldsaum-Reihe (schmale Bildschirme) liegt hinter dem Stammfuß.
    if (foot) for (const x of groundSpots(anchors, false)) forbid.push([x - r, x + r]);
    else {
      for (const [a, b] of groundSpans) forbid.push([a - r, b + r]);
      // Der Raum zwischen Stamm und erstem Laubstreu-Platz gehört den Moosen am Stammfuß.
      forbid.push([cx - footZone, cx + footZone]);
    }
    const lo = hw * 0.2;
    const hi = width - hw * 0.2;
    // Erst mit Abstand zu den übrigen niedrigen Pflanzen, notfalls ohne.
    const spaced = forbid.slice();
    // Abstand nach voller Größe (nicht nach aktueller) – so springt beim Wachsen nichts.
    placedLow.forEach((o, i) => spaced.push([o.x - (lowSpan[i]! + wf * S) * 0.45, o.x + (lowSpan[i]! + wf * S) * 0.45]));
    // Am Stammfuß ist die Lücke bewusst schmal – dort keine Lücken schließen.
    const gap = foot ? 0 : MIN_GAP;
    let x = nudge(x0, spaced, lo, hi, true, gap);
    if (Number.isNaN(x)) x = nudge(x0, forbid, lo, hi, false, gap);
    lowSpan.push(wf * S);
    placedLow.push({ index, id: p.id, kind: kind!, group: group!, slot, x, y: layout.groundY + 2, hw, h, depth: 0, haze: 0, vigor, grow: lowGrow, seed, tree: null });
  }

  placedTrees.sort((a, b) => b.depth - a.depth || a.slot - b.slot);
  return [...placedTrees, ...placedLow];
}

/**
 * Schiebt x an die nächste Stelle außerhalb aller Sperrbereiche (innerhalb [lo, hi]).
 * Bei Gleichstand nach außen (weg von der Bildmitte). Ohne freie Stelle: NaN bei
 * `strict`, sonst die Stelle mit dem größten Abstand zu den Sperrbereichen.
 */
export function nudge(x: number, blocked: readonly [number, number][], lo: number, hi: number, strict = false, minGap = MIN_GAP): number {
  const mid = (lo + hi) / 2;
  // Fast berührende Sperrbereiche zusammenfassen: Winzige Lücken gehen beim Wachsen auf
  // und zu und ließen die Pflanze hin- und herspringen.
  const forbid: [number, number][] = [];
  for (const [a, b] of [...blocked].sort((p, q) => p[0] - q[0])) {
    const last = forbid[forbid.length - 1];
    if (last && a <= last[1] + minGap) last[1] = Math.max(last[1], b);
    else forbid.push([a, b]);
  }
  const free = (v: number) => v >= lo && v <= hi && forbid.every(([a, b]) => v <= a || v >= b);
  if (free(x)) return x;
  let best = NaN;
  let bestD = Infinity;
  // Bevorzugt nach außen: Sperrbereiche (Stamm, Laubstreu) wachsen nach außen – so
  // wandert die Pflanze beim Wachsen stetig mit, statt auf die andere Seite zu springen.
  const outward = x >= mid ? 1 : -1;
  const consider = (v: number) => {
    if (!free(v)) return;
    const d = Math.abs(v - x) + (Math.sign(v - x) === outward ? 0 : 1e6);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  };
  for (const [a, b] of forbid) {
    consider(a - 0.01);
    consider(b + 0.01);
  }
  consider(lo);
  consider(hi);
  if (!Number.isNaN(best) || strict) return best;
  // Kein freier Platz: größter Abstand zum nächsten Sperrbereich.
  let fallback = clamp(x, lo, hi);
  let worst = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const v = lo + ((hi - lo) * i) / 40;
    let d = Infinity;
    for (const [a, b] of forbid) d = Math.min(d, v <= a ? a - v : v >= b ? v - b : -Math.min(v - a, b - v));
    if (d > worst) {
      worst = d;
      fallback = v;
    }
  }
  return fallback;
}

/**
 * x-Positionen der Tierplätze am Boden: Laubstreu, Waldsaum, Pilze an der Oberfläche.
 * Ohne `withBackRow` fehlen Waldsaum-Plätze der hinteren Reihe.
 */
function groundSpots(anchors: AnchorResolver, withBackRow = true): number[] {
  const xs: number[] = [];
  for (let s = 0; s < KEEP_CLEAR_SLOTS; s++) {
    const edge = anchors.get('edge', s)!;
    xs.push(anchors.get('litter', s)!.x, anchors.get('roots', s)!.surfaceX);
    if (withBackRow || edge.depth === 0) xs.push(edge.x);
  }
  return xs;
}

/** Wachstumswerte, über die die Strecke der Tierplätze bestimmt wird (Keimling … Urwald). */
const SPAN_GROWTHS = [1, 3, 5, 8];
const spanMemo = new Map<string, [number, number][]>();

/** Strecke [min, max] jedes Tierplatzes am Boden über das ganze Spiel (gemerkt je Größe und Art). */
function groundSpansFor(layout: Layout, species: TreeSpecies): [number, number][] {
  const key = `${layout.width}x${layout.height}|${species}`;
  let spans = spanMemo.get(key);
  if (!spans) {
    spans = [];
    for (const g of SPAN_GROWTHS) {
      groundSpots(createAnchorResolver(layout, g, placeMainTree(layout, g, species))).forEach((x, i) => {
        const s = spans![i];
        if (s) {
          s[0] = Math.min(s[0], x);
          s[1] = Math.max(s[1], x);
        } else spans!.push([x, x]);
      });
    }
    if (spanMemo.size > 16) spanMemo.clear();
    spanMemo.set(key, spans);
  }
  return spans;
}

/** Halbe Stammbreite des Hauptbaums am Fuß in px (inkl. Verdickung). */
export function trunkBaseHalf(g: number, main: PlacedTree | null, layout: Layout): number {
  if (!main) return Math.max(2, layout.height * 0.004);
  return trunkFootHalf(g, main);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
