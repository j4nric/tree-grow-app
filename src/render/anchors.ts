/**
 * Ankerpunkte der Tiere je Nische – reine Geometrie ohne Canvas (testbar).
 *
 * Alle Punkte leiten sich aus derselben Baumgeometrie ab, die der Renderer zeichnet,
 * und wachsen daher stufenlos mit. Jeder Platz (`slot`) hat eine feste, per Seed
 * bestimmte Lage: In der Krone folgt jeder Platz einem eigenen Pfad durch die Äste,
 * am Stamm einer festen Höhe, am Boden einem festen Abstand zum Stamm.
 */

import { makeLayout, placeMainTree, placeRoots, sproutScale, trunkFootHalf, type Layout, type PlacedTree } from './layout';
import { normalizeSpecies, TREE_SPECIES, type Branch, type TreeSpecies } from './plant';
import { clamp, clamp01, hash2, lerp } from './util';

/** Nischen-IDs, die der Renderer kennt (wie in DESIGN_V2.md / src/content/niches.ts). */
export const SCENE_NICHES = ['roots', 'litter', 'edge', 'crown', 'bark', 'hollows', 'pond', 'meadow', 'deadwood', 'wall'] as const;
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
  /**
   * Größenfaktor der Tiere an diesem Platz (1 = normal). Am Waldsaum schmaler Bildschirme
   * stehen die Tiere etwas kleiner in einer hinteren Reihe.
   */
  scale: number;
  /** Reihe: 0 vorn auf der Bodenlinie, 1 dahinter auf der Wiese, 2 Mittelgrund (Waldwiese, Trockenmauer); hintere zuerst gezeichnet. */
  depth: number;
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
  /** Lage des Waldtümpels (gemerkt; hängt nur von der Canvas-Größe ab). */
  pond(): PondGeometry;
  /** Lage des Totholzhaufens (gemerkt; Spiegelbild des Tümpels am rechten Rand). */
  pile(): PondGeometry;
  /** Lage von Waldwiese bzw. Trockenmauer im Mittelgrund (gemerkt; nur von der Größe abhängig). */
  midground(niche: 'meadow' | 'wall'): MidgroundGeometry;
}

export function createAnchorResolver(layout: Layout, g: number, main: PlacedTree | null): AnchorResolver {
  const size = animalSize(layout.width, layout.height);
  const memo = new Map<string, NicheAnchor>();
  let roots: { reach: number } | null = null;
  const rootReach = () => {
    if (!roots) roots = main ? placeRoots(layout, g, main) : { reach: layout.soilH * 0.38 };
    return roots.reach;
  };
  let pond: PondGeometry | null = null;
  let pile: PondGeometry | null = null;
  let meadow: MidgroundGeometry | null = null;
  let wall: MidgroundGeometry | null = null;
  return {
    layout,
    size,
    pond() {
      if (!pond) pond = pondGeometry(layout, size);
      return pond;
    },
    pile() {
      if (!pile) pile = pileGeometry(layout, size);
      return pile;
    },
    midground(niche) {
      if (niche === 'meadow') return (meadow ??= midgroundGeometry(layout, size, 1));
      return (wall ??= midgroundGeometry(layout, size, -1));
    },
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
 * Beschriftungen in der UI. Gleiche Eingabe → gleiche Punkte. `species`: Art des Hauptbaums (unbekannt → Eiche).
 */
export function nicheAnchors(width: number, height: number, growth: number, slots = 4, species: TreeSpecies = 'oak'): Record<SceneNiche, NicheAnchor[]> {
  const layout = makeLayout(width, height);
  const g = Math.max(0, growth);
  const resolver = createAnchorResolver(layout, g, placeMainTree(layout, g, normalizeSpecies(species)));
  const result = {} as Record<SceneNiche, NicheAnchor[]>;
  for (const niche of SCENE_NICHES) {
    result[niche] = [];
    for (let i = 0; i < slots; i++) result[niche].push(resolver.get(niche, i)!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Waldtümpel
// ---------------------------------------------------------------------------

/**
 * Waldtümpel in Tiergrößen S, gemessen ab der Bodenlinie `groundY` nach unten.
 *
 * Am Boden ist auf keiner Bildschirmbreite eine Strecke frei: Laubstreu, Waldsaum (samt
 * Sonderplätzen), Pilze und Begleitpflanzen teilen sich die ganze Breite. Der Tümpel
 * liegt darum **unter der Grasnarbe** im Erdschnitt am linken Bildrand – wie ein Blick
 * in die Senke von vorn: Die Senke beginnt POND_LIP unter der Bodenlinie (darüber bleiben
 * Gras, Laub und Blumen-Füße), alles Sichtbare des Tümpels samt Bewohnern liegt tiefer.
 * Die Tiere und Pflanzen an der Oberfläche reichen höchstens POND_SURFACE_CLEAR unter die
 * Bodenlinie, die Wurzelraum-Tiere liegen tiefer als POND_DEPTH (Tests in
 * tests/render-anchors.test.ts).
 *
 * Tiefer darf die Senke nicht werden (schmal liegt Wurzelraum-Platz 2 knapp darunter),
 * darum wächst sie in die Breite: so breit, dass fünf Bewohner nebeneinander Platz haben
 * (POND_HALF_WIDTH_MAX), höchstens bis kurz vor den Stamm, mindestens POND_HALF_WIDTH.
 */
export const POND_HALF_WIDTH = 1.9;
/** Halbe Breite, in der fünf Bewohner in voller Größe nebeneinander passen. */
export const POND_HALF_WIDTH_MAX = 3.4;
/** So viel Abstand (Tiergrößen) hält der rechte Rand der Senke von der Stammmitte. */
const POND_TRUNK_CLEAR = 1.2;
/** Oberkante der Senke (unter der Bodenlinie). */
export const POND_LIP = 0.25;
/** Wasseroberfläche. */
export const POND_WATER_Y = 0.55;
/** Tiefster Punkt der Senke. */
export const POND_DEPTH = 1.0;
/** So weit reicht das Tiefste an der Oberfläche (Laubhäufchen, Blumen) unter die Bodenlinie. */
export const POND_SURFACE_CLEAR = 0.2;

export interface PondGeometry {
  /** Mitte der Senke an der Bodenlinie (CSS-Pixel; `y` = groundY). */
  x: number;
  y: number;
  /** Oberkante der Senke (CSS-Pixel). */
  lipY: number;
  /** Tiergröße S, auf die sich alle Maße beziehen. */
  size: number;
  /** Wasseroberfläche (CSS-Pixel). */
  waterY: number;
  /** Halbe Breite der Senke in Tiergrößen (auf 0,05 gerundet – wenige Sprite-Varianten). */
  halfWidth: number;
  /**
   * Größte Zeichengröße der Amphibien relativ zu S: Auf kleinen Bildschirmen (S < 30 px)
   * etwas größer, damit sie lesbar bleiben; bei vielen Bewohnern rücken sie enger und
   * werden notfalls kleiner (animals.ts, `pondPlaces`).
   */
  maxScale: number;
}

/** Lage des Waldtümpels – hängt nur von der Canvas-Größe ab (nicht vom Wachstum). */
export function pondGeometry(layout: Layout, size: number): PondGeometry {
  const margin = size * 0.1;
  const room = (layout.cx - POND_TRUNK_CLEAR * size - margin) / (2 * size);
  const halfWidth = Math.floor(clamp(room, POND_HALF_WIDTH, POND_HALF_WIDTH_MAX) * 20) / 20;
  const x = Math.min(layout.cx - size, halfWidth * size + margin);
  const y = layout.groundY;
  const maxScale = Math.round(clamp(30 / size, 1, 1.2) * 20) / 20;
  return { x, y, size, lipY: y + POND_LIP * size, waterY: y + POND_WATER_Y * size, halfWidth, maxScale };
}

/**
 * Nominelle Plätze im Tümpel: waagerechter Versatz als Anteil der nutzbaren halben Breite.
 * Wo ein Tier tatsächlich sitzt, hängt von allen Bewohnern ab (animals.ts, `pondPlaces`):
 * Kröte und Frösche an den flachen Rändern, Molche nebeneinander in der Mitte.
 */
const POND_SLOTS = [-0.8, 0.75, -0.05, 1, -1];

// ---------------------------------------------------------------------------
// Totholzhaufen (DESIGN_V2.md 23.8)
// ---------------------------------------------------------------------------

/**
 * Totholzhaufen: Gegenstück zum Tümpel am **rechten** Bildrand im Erdschnitt – gleiche
 * Maße (POND_LIP … POND_DEPTH, gleiche halbe Breite), gespiegelt. So gelten dieselben
 * Regeln: nichts an der Oberfläche reicht hinein, der Wurzelraum liegt tiefer.
 */
export function pileGeometry(layout: Layout, size: number): PondGeometry {
  const p = pondGeometry(layout, size);
  return { ...p, x: layout.width - p.x };
}

/** Morscher Stubben am äußeren Ende des Haufens: Abstand seiner Mitte vom Rand und halbe Breite (Tiergrößen). */
export const PILE_STUMP_IN = 0.5;
export const PILE_STUMP_HALF = 0.24;

/** Nominelle Plätze im Haufen (Anteil der halben Breite); die echte Lage: animals.ts, `habitatPlaces`. */
const PILE_SLOTS = [-0.6, 0.2, -0.95, 0.6, -0.25];

// ---------------------------------------------------------------------------
// Waldwiese und Trockenmauer im Mittelgrund (DESIGN_V2.md 23.8)
// ---------------------------------------------------------------------------

/**
 * Die Bewohner stehen auf einer Linie so hoch über der Bodenlinie (Tiergrößen), dass sie
 * über den Köpfen der Großtiere am Waldsaum bleiben (Reh: 2,6) – sie liegen weiter hinten.
 */
export const HABITAT_LIFT = 2.7;
/** Größe der Bewohner im Mittelgrund (Perspektive). */
export const HABITAT_SCALE = 0.7;
/**
 * Abstand der Lebensräume von der Stammmitte (Tiergrößen): außerhalb von Stamm,
 * Rinden- und Höhlenbewohnern und der tiefsten Kronenplätze des Jungen Baums.
 */
const HABITAT_CLEAR = 3.2;
const HABITAT_HALF_MIN = 1.6;
const HABITAT_HALF_MAX = 3.6;
/** Der Turmfalke rüttelt so hoch über der Linie der Wiese (Mitte, Tiergrößen). */
export const SOAR_LIFT = 1.3;

export interface MidgroundGeometry {
  /** Mitte des Streifens und Linie, auf der die Bewohner stehen (CSS-Pixel). */
  x: number;
  y: number;
  /** Halbe Breite des Streifens in Tiergrößen (auf 0,05 gerundet). */
  halfWidth: number;
  /** Tiergröße S. */
  size: number;
  /** Seite relativ zum Stamm: 1 rechts (Wiese), −1 links (Mauer). */
  side: -1 | 1;
  /** Mitte der Flughöhe über dem Streifen (Turmfalke). */
  skyY: number;
}

/**
 * Lage eines Lebensraums im Mittelgrund – hängt nur von der Canvas-Größe ab: ein Streifen
 * zwischen dem Abstand zum Stamm (mindestens HABITAT_CLEAR bzw. breitester ausgewachsener
 * Stamm aller Arten mit Rand) und dem Bildrand.
 */
export function midgroundGeometry(layout: Layout, size: number, side: -1 | 1): MidgroundGeometry {
  const margin = size * 0.15;
  // Höchstens so viel Abstand, dass der Streifen noch HABITAT_HALF_MIN breit ins Bild passt.
  const most = layout.cx - margin - 2 * HABITAT_HALF_MIN * size;
  const want = Math.max(HABITAT_CLEAR * size, maxTrunkHalf(layout) + size * 0.8, foliageReach(layout, size, side));
  const clear = Math.max(HABITAT_CLEAR * size, Math.min(want, most));
  const room = (layout.cx - clear - margin) / (2 * size);
  const halfWidth = Math.floor(clamp(room, HABITAT_HALF_MIN, HABITAT_HALF_MAX) * 20) / 20;
  const x = layout.cx + side * (clear + halfWidth * size);
  const y = layout.groundY - HABITAT_LIFT * size;
  return { x, y, halfWidth, size, side, skyY: y - SOAR_LIFT * size };
}

const foliageMemo = new Map<string, number>();

/**
 * Wie weit (px von der Stammmitte) reicht das Laub des Hauptbaums auf Seite `side` in der
 * Höhe der Bewohner im Mittelgrund (vom Turmfalken bis zur Linie) – größter Wert über alle
 * Arten und Stufen ab Junger Baum. Die Bewohner stehen hinter dem Baum; so verdeckt ihn das
 * Laub nicht. Gemerkt je Größe (wird nur selten gebraucht).
 */
function foliageReach(layout: Layout, size: number, side: -1 | 1): number {
  const key = `${layout.width}x${layout.height}/${side}`;
  let reach = foliageMemo.get(key);
  if (reach !== undefined) return reach;
  reach = 0;
  const line = layout.groundY - HABITAT_LIFT * size;
  const top = line - (SOAR_LIFT + 0.6) * size;
  for (const species of TREE_SPECIES) {
    for (let g = 3; g <= 8; g += 0.5) {
      const t = placeMainTree(layout, g, species);
      if (!t) continue;
      for (const l of t.geo.leaves) {
        const r = l.r * t.scale;
        const x = t.x + l.x * t.scale;
        const y = t.y + l.y * t.scale;
        if (y + r < top || y - r > line + size * 0.1) continue;
        const d = (x - layout.cx) * side + r * 0.85;
        if (d > reach) reach = d;
      }
    }
  }
  reach += size * 0.15;
  if (foliageMemo.size > 32) foliageMemo.clear();
  foliageMemo.set(key, reach);
  return reach;
}

const trunkMemo = new Map<string, number>();

/** Breitester ausgewachsener Stamm aller Arten (halbe Breite am Fuß, px) – gemerkt je Größe. */
function maxTrunkHalf(layout: Layout): number {
  const key = `${layout.width}x${layout.height}`;
  let t = trunkMemo.get(key);
  if (t === undefined) {
    t = 0;
    for (const species of TREE_SPECIES) t = Math.max(t, trunkBaseHalf(8, placeMainTree(layout, 8, species), layout));
    if (trunkMemo.size > 16) trunkMemo.clear();
    trunkMemo.set(key, t);
  }
  return t;
}

/** Nominelle Plätze im Streifen (Anteil der halben Breite). */
const MIDGROUND_SLOTS = [-0.55, 0.45, -0.1, 0.85, -0.9];

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
  const base = { niche, slot, onTree: false, trunkX: cx, trunkHalf: 0, surfaceX: 0, scale: 1, depth: 0 };
  let a: NicheAnchor;
  switch (niche) {
    case 'roots': {
      const [u0, v0] = cycle(ROOT_SLOTS, slot, 0.13);
      const reach = rootReach();
      const halfX = Math.min(width * 0.42, Math.max(size * 2.2, reach * 1.7));
      const y = groundY + clamp(v0 * soilH, size * 0.7, soilH - size * 0.5);
      const side = u0 < 0 ? -1 : 1;
      // Pilze an der Oberfläche: in der Lücke zwischen Laubstreu und Waldsaum.
      const edge = edgeRow(layout, size);
      const k = Math.floor(slot / 2) % 3;
      let r: number;
      if (edge.back) {
        // Hintere Reihe: eigene Lücke zwischen den Waldsaum-Plätzen 0/1 und 2/3; weitere
        // Pilze stehen leicht versetzt daneben (Pilzgruppe).
        r = edge.mushroom + [0, -0.25, 0.25][k]! * size;
      } else {
        // Vordere Reihe (wie bisher): zwischen Laubstreu und Waldsaum-Platz 0/1.
        const inner = trunkBaseHalf(g, main, layout) + size * 3.0;
        const outer = Math.max(inner, edge.mushroom);
        r = inner + (outer - inner) * [0.5, 0.15, 0.85][k]!;
      }
      const surfaceX = cx + side * r;
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
      const row = edgeRow(layout, size);
      if (k < 2) {
        const back = row.back;
        const y = back ? groundY + 1 - EDGE_BACK_LIFT * size : groundY + 1;
        a = { ...base, x: cx + side * row.r[k]!, y, side, scale: row.scale, depth: back ? 1 : 0 };
      } else {
        // Weitere Plätze (nur mit Sonderplätzen): breit weiter außen; schmal vorn vor
        // Platz 2/3 (andere Reihe, so bleibt die Pilzlücke frei).
        const r = row.back ? row.r[1]! : row.r[0]! + row.pitch * k;
        a = { ...base, x: cx + side * r, y: groundY + 1, side, scale: row.scale };
      }
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
    case 'pond': {
      const pond = pondGeometry(layout, size);
      const off = POND_SLOTS[slot % POND_SLOTS.length]!;
      const u = (off - Math.sign(off) * 0.1 * Math.floor(slot / POND_SLOTS.length)) * (pond.halfWidth - 0.6);
      // Zum Stamm hin schauen: Plätze links der Mitte blicken nach rechts.
      a = { ...base, x: pond.x + u * size, y: pond.waterY, side: u < 0 ? -1 : 1 };
      break;
    }
    case 'deadwood': {
      const pile = pileGeometry(layout, size);
      const off = PILE_SLOTS[slot % PILE_SLOTS.length]!;
      const u = (off - Math.sign(off) * 0.1 * Math.floor(slot / PILE_SLOTS.length)) * (pile.halfWidth - 0.6);
      a = { ...base, x: pile.x + u * size, y: pile.y + (POND_DEPTH - 0.1) * size, side: u < 0 ? -1 : 1 };
      break;
    }
    case 'meadow':
    case 'wall': {
      const m = midgroundGeometry(layout, size, niche === 'meadow' ? 1 : -1);
      const off = MIDGROUND_SLOTS[slot % MIDGROUND_SLOTS.length]!;
      const u = (off - Math.sign(off) * 0.1 * Math.floor(slot / MIDGROUND_SLOTS.length)) * (m.halfWidth - 0.4);
      a = { ...base, x: m.x + u * size, y: m.y, side: m.side, scale: HABITAT_SCALE, depth: 2 };
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

/**
 * Waldsaum: Platzbedarf eines Großtiers (Reh, Fuchs, Wolf) samt Blumentupfen in
 * Tiergrößen – nach außen (das Tier steht außen neben den Blumen) und zum Stamm hin.
 * Gilt für den Platz des Ankerpunkts, skaliert mit `NicheAnchor.scale`.
 */
export const EDGE_REACH_OUT = 2.15;
export const EDGE_REACH_IN = 0.6;
/** Mindestlücke zwischen zwei Waldsaum-Plätzen (Tiergrößen). */
const EDGE_GAP = 0.15;
/** Hintere Reihe auf schmalen Bildschirmen: so viel höher (Tiergrößen) und höchstens so groß. */
export const EDGE_BACK_LIFT = 0.5;
const EDGE_BACK_SCALE = 0.75;
/** Breite der Lücke für eine Pilzgruppe zwischen den Plätzen der hinteren Reihe (Tiergrößen). */
const MUSHROOM_GAP = 1.6;

/** Bereich [x0, x1] (CSS-Pixel), den ein Großtier samt Blumen an einem Waldsaum-Platz belegt. */
export function edgeFootprint(a: NicheAnchor, size: number): [number, number] {
  const out = EDGE_REACH_OUT * size * a.scale;
  const inn = EDGE_REACH_IN * size * a.scale;
  return a.side === 1 ? [a.x - inn, a.x + out] : [a.x - out, a.x + inn];
}

interface EdgeRow {
  /** Hintere Reihe (schmaler Bildschirm)? */
  back: boolean;
  scale: number;
  /** Abstand der Plätze k = 0, 1 je Seite von der Mitte (px). */
  r: [number, number];
  pitch: number;
  /**
   * Pilze: vorn die äußere Grenze ihres Bereichs, hinten die Mitte der Pilzlücke
   * (Abstand von der Mitte, px).
   */
  mushroom: number;
}

const edgeMemo = new Map<string, EdgeRow>();

/**
 * Lage der ersten beiden Waldsaum-Plätze je Seite – hängt nur von der Canvas-Größe ab
 * (nicht vom Wachstum), damit die Tiere nie wandern.
 *
 * Breit: beide vorn auf der Bodenlinie, wie bisher bei 33 % und 7,5 % der Breite
 * Abstand – der Abstand wächst aber mindestens auf die Breite eines Großtiers, und
 * passt Platz 2/3 dann nicht mehr ins Bild, rücken beide nach innen. Erst wenn dabei
 * kein Raum für die Pilze bliebe, gilt „schmal“: beide in einer hinteren Reihe
 * zwischen Stamm (Stufe Urwald) und Bildrand, etwas kleiner, mit einer Lücke für die
 * Pilze dazwischen – so überlappen Großtiere weder einander noch die Pilze.
 */
function edgeRow(layout: Layout, size: number): EdgeRow {
  const key = `${layout.width}x${layout.height}`;
  let row = edgeMemo.get(key);
  if (row) return row;
  const { width } = layout;
  const half = width / 2;
  const m = size * 0.1;
  const foot = (EDGE_REACH_IN + EDGE_REACH_OUT) * size;
  const gap = EDGE_GAP * size;
  // Breitester ausgewachsener Stamm aller Arten: Die Reihe hängt nicht von der Art ab,
  // so springen die Tiere beim Artwechsel nicht und stehen nie auf dem Stamm.
  const trunk = maxTrunkHalf(layout);
  const pitch = Math.max(width * 0.075, foot + gap);
  const r0 = Math.min(width * 0.33, half - m - EDGE_REACH_OUT * size - pitch);
  // Pilzbereich vorn: alte Grenze (33 % − 0,8 S); rückt der Waldsaum nach innen, mit
  // ausreichend Abstand zu dessen Blumen.
  const mushroomOuter = r0 < width * 0.33 ? r0 - size * 1.1 : width * 0.33 - size * 0.8;
  if (mushroomOuter >= trunk + size * 3.3) {
    row = { back: false, scale: 1, r: [r0, r0 + pitch], pitch, mushroom: mushroomOuter };
  } else {
    // Hintere Reihe: vom Bildrand nach innen bis knapp vor den ausgewachsenen Stamm.
    const avail = half - m - (trunk + size * 0.25);
    const mush = MUSHROOM_GAP * size;
    const scale = clamp((avail - mush) / (2 * foot), 0.5, EDGE_BACK_SCALE);
    const a = half - m - EDGE_REACH_OUT * size * scale;
    const inner0 = a - EDGE_REACH_IN * size * scale;
    const p = foot * scale + mush;
    row = { back: true, scale, r: [a, a - p], pitch: p, mushroom: inner0 - mush / 2 };
  }
  if (edgeMemo.size > 16) edgeMemo.clear();
  edgeMemo.set(key, row);
  return row;
}

/** Wiederholt eine Platzliste zyklisch; weitere Runden werden leicht versetzt. */
function cycle<T extends [number, number]>(list: T[], slot: number, shift: number): T {
  const item = list[slot % list.length]!;
  const round = Math.floor(slot / list.length);
  return [item[0] + round * shift * (item[0] < 0.5 ? 1 : -1), item[1]] as T;
}

/** Halbe Stammbreite am Fuß in px (inkl. Verdickung). */
export function trunkBaseHalf(g: number, main: PlacedTree | null, layout: Layout): number {
  if (!main) return sproutScale(layout) * 0.04;
  return trunkFootHalf(g, main);
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
