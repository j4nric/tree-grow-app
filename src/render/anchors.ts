/**
 * Ankerpunkte der Tiere je Nische – reine Geometrie ohne Canvas (testbar).
 *
 * Alle Punkte leiten sich aus derselben Baumgeometrie ab, die der Renderer zeichnet,
 * und wachsen daher stufenlos mit. Jeder Platz (`slot`) hat eine feste, per Seed
 * bestimmte Lage: In der Krone folgt jeder Platz einem eigenen Pfad durch die Äste,
 * am Stamm einer festen Höhe, am Boden einem festen Abstand zum Stamm.
 */

import { makeLayout, placeMainTree, placeRoots, sproutScale, type Layout, type PlacedTree } from './layout';
import { trunkWidthOf, type Branch } from './plant';
import { clamp, clamp01, hash2, lerp } from './util';

/** Nischen-IDs, die der Renderer kennt (wie in DESIGN_V2.md / scripts/v2/content.ts). */
export const SCENE_NICHES = ['roots', 'litter', 'edge', 'crown', 'bark', 'hollows'] as const;
export type SceneNiche = (typeof SCENE_NICHES)[number];

export function isSceneNiche(n: string): n is SceneNiche {
  return (SCENE_NICHES as readonly string[]).includes(n);
}

export interface NicheAnchor {
  niche: SceneNiche;
  slot: number;
  /** Ankerpunkt in CSS-Pixeln: Füße / Kontaktstelle am Baum / Höhlenboden / Mitte des Erdlochs. */
  x: number;
  y: number;
  /** Seite relativ zum Stamm: −1 links, 1 rechts. */
  side: -1 | 1;
  /** Sitzt am Baum und wiegt sich mit ihm im Wind (Krone, Stamm, Höhlen). */
  onTree: boolean;
  /** Nur Stamm/Höhlen: Stammmitte (x) und halbe Stammbreite an dieser Stelle (px). */
  trunkX: number;
  trunkHalf: number;
  /**
   * Nur Wurzelraum: x-Position an der Oberfläche für Pilz-Fruchtkörper (liegt zwischen
   * Laubstreu und Waldsaum, damit nichts überlappt). Sonst gleich `x`.
   */
  surfaceX: number;
}

/** Grundgröße eines Tiers in CSS-Pixeln (20–36 px je nach Canvas). */
export function animalSize(width: number, height: number): number {
  return Math.round(clamp(Math.min(width * 0.072, height * 0.052), 20, 36));
}

/** Liefert Ankerpunkte (gemerkt) für eine feste Szene: Größe + Wachstum. */
export interface AnchorResolver {
  readonly layout: Layout;
  readonly size: number;
  get(niche: string, slot: number): NicheAnchor | null;
}

export function createAnchorResolver(layout: Layout, g: number, main: PlacedTree | null): AnchorResolver {
  const size = animalSize(layout.width, layout.height);
  const memo = new Map<string, NicheAnchor>();
  let roots: { reach: number } | null = null;
  const rootReach = () => {
    if (!roots) roots = main ? placeRoots(layout, g, main) : { reach: layout.soilH * 0.38 };
    return roots.reach;
  };
  return {
    layout,
    size,
    get(niche, slot) {
      if (!isSceneNiche(niche) || !Number.isFinite(slot) || slot < 0) return null;
      const s = Math.floor(slot);
      const key = `${niche}/${s}`;
      let a = memo.get(key);
      if (!a) {
        a = computeAnchor(layout, g, main, niche, s, size, rootReach);
        memo.set(key, a);
      }
      return a;
    },
  };
}

/**
 * Ankerpunkte aller Nischen für die Plätze 0..slots−1 – z. B. für Linien oder
 * Beschriftungen in der UI. Gleiche Eingabe → gleiche Punkte.
 */
export function nicheAnchors(width: number, height: number, growth: number, slots = 4): Record<SceneNiche, NicheAnchor[]> {
  const layout = makeLayout(width, height);
  const g = Math.max(0, growth);
  const resolver = createAnchorResolver(layout, g, placeMainTree(layout, g));
  const result = {} as Record<SceneNiche, NicheAnchor[]>;
  for (const niche of SCENE_NICHES) {
    result[niche] = [];
    for (let i = 0; i < slots; i++) result[niche].push(resolver.get(niche, i)!);
  }
  return result;
}

// ---------------------------------------------------------------------------

/** Stammhöhen (Anteil) und Seiten der Plätze an der Rinde bzw. der Höhlen. */
const BARK_SLOTS: [number, -1 | 1][] = [
  [0.28, 1],
  [0.72, -1],
  [0.96, -1],
  [0.5, 1],
  [0.42, -1],
];
/**
 * Höhlen liegen höhenversetzt zwischen den Rindenplätzen. Die Reihenfolge folgt dem
 * Öffnen der Plätze (Rinde 0, Rinde 1 + Höhle 0, Höhle 1, Rinde 2, Höhle 2), damit
 * gleichzeitig belegte Plätze möglichst weit auseinanderliegen: Rindenkrabbler laufen
 * links (−1), die ersten Höhlen liegen rechts (1) über dem Specht.
 */
const HOLLOW_SLOTS: [number, -1 | 1][] = [
  [0.84, 1],
  [0.56, 1],
  [0.3, -1],
  [0.12, -1],
  [0.9, -1],
];
/** Wurzelraum: Lage relativ zur Wurzelbreite (u) und Erdtiefe (v). */
const ROOT_SLOTS: [number, number][] = [
  [-0.45, 0.55],
  [0.5, 0.68],
  [-0.85, 0.36],
  [0.85, 0.46],
  [-0.15, 0.82],
  [0.22, 0.32],
];

function computeAnchor(
  layout: Layout,
  g: number,
  main: PlacedTree | null,
  niche: SceneNiche,
  slot: number,
  size: number,
  rootReach: () => number,
): NicheAnchor {
  const { cx, groundY, width, height, soilH } = layout;
  const base = { niche, slot, onTree: false, trunkX: cx, trunkHalf: 0, surfaceX: 0 };
  let a: NicheAnchor;
  switch (niche) {
    case 'roots': {
      const [u0, v0] = cycle(ROOT_SLOTS, slot, 0.13);
      const reach = rootReach();
      const halfX = Math.min(width * 0.42, Math.max(size * 2.2, reach * 1.7));
      const y = groundY + clamp(v0 * soilH, size * 0.7, soilH - size * 0.5);
      const side = u0 < 0 ? -1 : 1;
      // Pilze an der Oberfläche: in der Lücke zwischen Laubstreu und Waldsaum.
      const inner = trunkBaseHalf(g, main, layout) + size * 3.0;
      const outer = Math.max(inner, width * 0.33 - size * 0.8);
      const frac = [0.5, 0.15, 0.85][Math.floor(slot / 2) % 3]!;
      const surfaceX = cx + side * (inner + (outer - inner) * frac);
      a = { ...base, x: cx + u0 * halfX, y, side, surfaceX };
      break;
    }
    case 'litter': {
      const side = slot % 2 === 0 ? -1 : 1;
      const k = Math.floor(slot / 2);
      const x = cx + side * (trunkBaseHalf(g, main, layout) + size * (1.0 + 1.4 * k));
      a = { ...base, x, y: groundY + 2, side };
      break;
    }
    case 'edge': {
      const side = slot % 2 === 0 ? 1 : -1;
      const k = Math.floor(slot / 2);
      const x = cx + side * width * (0.33 + 0.075 * k);
      a = { ...base, x, y: groundY + 1, side };
      break;
    }
    case 'bark':
    case 'hollows': {
      const [t, side] = niche === 'bark' ? cycle(BARK_SLOTS, slot, 0.05) : cycle(HOLLOW_SLOTS, slot, 0.04);
      const p = trunkPoint(layout, main, t);
      const x = niche === 'bark' ? p.x + side * p.half : p.x + side * p.half * 0.35;
      // Rindenbewohner (z. B. der Specht mit Stützschwanz) brauchen Abstand zum Boden.
      const y = niche === 'bark' ? Math.min(p.y, layout.groundY - size) : p.y;
      a = { ...base, x, y, side, onTree: true, trunkX: p.x, trunkHalf: p.half };
      break;
    }
    case 'crown': {
      const p = crownPoint(layout, g, main, slot);
      a = { ...base, x: p.x, y: p.y, side: p.x < cx ? -1 : 1, onTree: true };
      break;
    }
  }
  // Nie aus dem Bild ragen.
  const m = size * 0.6;
  a.x = clamp(a.x, m, width - m);
  a.y = clamp(a.y, size, height - size * 0.4);
  a.surfaceX = niche === 'roots' ? clamp(a.surfaceX, m, width - m) : a.x;
  return a;
}

/** Wiederholt eine Platzliste zyklisch; weitere Runden werden leicht versetzt. */
function cycle<T extends [number, number]>(list: T[], slot: number, shift: number): T {
  const item = list[slot % list.length]!;
  const round = Math.floor(slot / list.length);
  return [item[0] + round * shift * (item[0] < 0.5 ? 1 : -1), item[1]] as T;
}

/** Halbe Stammbreite am Fuß in px (inkl. Verdickung). */
function trunkBaseHalf(g: number, main: PlacedTree | null, layout: Layout): number {
  if (!main) return sproutScale(layout) * 0.04;
  const flare = clamp01((g - 2) / 3);
  return (trunkWidthOf(g) * (1 + 0.55 * flare) * main.scale) / 2;
}

/** Punkt auf dem Stamm bei Höhenanteil t (0 = Fuß, 1 = erste Gabelung). */
function trunkPoint(layout: Layout, main: PlacedTree | null, t: number): { x: number; y: number; half: number } {
  const trunk = main?.geo.branches[0];
  if (!main || !trunk) {
    const h = sproutScale(layout) * 0.6;
    return { x: layout.cx, y: layout.groundY - h * t, half: 1 };
  }
  const p = alongBranch(trunk, t);
  return { x: main.x + p.x * main.scale, y: main.y + p.y * main.scale, half: (p.w * main.scale) / 2 };
}

function alongBranch(b: Branch, f: number): { x: number; y: number; w: number } {
  const w = lerp(b.w1, b.w2, f);
  if (f < 0.5) {
    const u = f * 2;
    return { x: lerp(b.x1, b.mx, u), y: lerp(b.y1, b.my, u), w };
  }
  const u = (f - 0.5) * 2;
  return { x: lerp(b.mx, b.x2, u), y: lerp(b.my, b.y2, u), w };
}

/**
 * Kronenplatz: Jeder Platz folgt einem eigenen Pfad durch die Äste (Seite am Stamm,
 * dann Leittrieb oder Seitenast) und sitzt etwa eine Astebene innerhalb der Spitzen.
 * Neue Äste wachsen aus dem Ende ihres Elternasts heraus – daher wandert der Punkt
 * beim Wachsen stetig nach außen, ohne zu springen.
 */
function crownPoint(layout: Layout, g: number, main: PlacedTree | null, slot: number): { x: number; y: number } {
  const branches = main?.geo.branches ?? [];
  if (!main || branches.length === 0) return trunkPoint(layout, main, 0.9);
  const depth = Math.max(1, g);
  const h = hash2(slot + 1, 911);
  const s = Math.max(0.6, depth - 1.05 - 0.45 * ((h & 255) / 255));
  const wantSide = slot % 2 === 0 ? -1 : 1;

  let idx = 0;
  let level = 0;
  while (level + 1 <= s) {
    const b = branches[idx]!;
    if (b.children.length === 0) break;
    let next = b.children[0]!;
    if (level === 0) {
      // Stamm: Seitenast auf der gewünschten Seite.
      for (const c of b.children.slice(1)) {
        const cb = branches[c]!;
        if (Math.sign(cb.x2 - cb.x1) === wantSide) next = c;
      }
    } else if (level === 1) {
      // Erste Astebene: Leittrieb oder nach außen strebender Seitenast.
      if ((slot >> 1) & 1) {
        for (const c of b.children.slice(1)) {
          const cb = branches[c]!;
          if (Math.sign(cb.x2 - cb.x1) === wantSide) next = c;
        }
      }
    } else {
      const bit = (h >>> (8 + level * 2)) & 3;
      if (bit === 3 && b.children.length > 1) next = b.children[1 + ((h >>> level) & 1) * (b.children.length - 2)]!;
    }
    idx = next;
    level++;
  }
  const b = branches[idx]!;
  const f = level + 1 <= s ? 1 : clamp01(s - level);
  const p = alongBranch(b, f);
  // Füße oben auf dem Ast.
  const x = main.x + p.x * main.scale;
  const y = main.y + p.y * main.scale - (p.w * main.scale) / 2;
  return { x, y: Math.max(y, layout.top + 4) };
}
