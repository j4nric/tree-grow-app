/**
 * Zeichnet die Szene (Himmel, Boden, Wurzeln, Baum/Wald, Tiere) auf ein Canvas.
 * Liest nur den Wachstumswert (und optional Tiere) – verändert nie den Spielstand.
 *
 * Aufbau in Ebenen, die in Offscreen-Canvases gecacht werden:
 *   0. Kulisse: Himmel, Hügel, Erde, Grasnarbe             (neu nur bei Größenänderung
 *      oder neuer Jahreszeit-Stufe; Schlüssel: `sizeKey`, `seasonStepKey` in resize.ts)
 *      Erinnerungsbaum: eigenes kleines Canvas            (neu bei Gedächtnis/Jahreszeit/Art)
 *   1. Hintergrund: Kulisse + Wurzeln, Samen               (neu bei growth, aus 0 kopiert)
 *   2. Wolken: kleine Sprites, pro Frame nur verschoben
 *   3. Nachbarbäume (Hain/Wald), blasser                   (neu bei growth)
 *      – mit Begleitpflanzen nur noch als ferne Kulisse
 *   4. Begleitpflanzen: Bäume, Sträucher, Blumen, Moose    (neu bei geänderter Liste
 *      oder Größe, beim Wachsen höchstens alle PLANT_REDRAW_STEP; eigener Cache, der
 *      beim Neuaufbau in Ebene 3 kopiert wird – pro Frame nur eine Kopie)
 *   5. Hauptbaum                                           (neu bei growth)
 *   6. Tiere: gecachte Sprites je Art, pro Frame nur drawImage
 *   7. Stimmung (optional, Harmoniestufe): Strahlen-Sprite, Partikel, Lichtfarbe
 *   Durchreisende (optional): Kraniche hinter dem Baum, Schwärme und Falter davor
 * Wind ist nur eine Scherung der gecachten Baum-Ebenen um die Bodenlinie – gezeichnet als
 * waagerecht verschobene Streifen statt schiefer Kopie (wind.ts); Tiere am Baum werden
 * um denselben Betrag verschoben. Tiere liegen immer über den Pflanzen.
 * Größenänderungen werden entprellt: Bis die neue Größe ~150 ms stabil ist, wird das
 * alte Bild skaliert gezeigt (`ResizeGate`). Der Game Loop entprellt schon den
 * Backing-Store des Canvas (`CanvasSizer`, ~100 ms) und setzt `sizeSettled` – dann wird
 * eine neue Größe sofort übernommen, ohne dass sich beide Wartezeiten addieren.
 * Pro Frame kostet die Kulisse damit eine Kopie (`background`, dazu der kleine Bereich des
 * Erinnerungsbaums – hineinbacken brachte messbar nichts); die Stimmungs-Ebene
 * liegt über bewegten Teilen (Wolken, Wind, Tiere) und lässt sich nicht hineinbacken.
 */

import { animalSize, createAnchorResolver, type AnchorResolver } from './anchors';
import { AnimalLayer, type AnimalFrame, type SceneAnimal } from './animals';
import { layoutFlora, type PlacedPlant, type ScenePlant } from './flora';
import { paintNeedleClumps, paintPlant } from './flora-paint';
import { makeLayout, placeMainTree, placeRoots, placeTree, sproutScale, type Layout, type PlacedTree } from './layout';
import { paintLeaves, paintWood, TREE_FORMS, type LeafPalette, type WoodColors } from './plant';
import { cycleElapsed, CycleTransition, type CycleGeometry, type OldForest } from './cycle';
import { MoodLayer, type MoodFrame } from './mood';
import {
  normalizeSpecies,
  paintCones,
  paintCotyledons as paintSpeciesCotyledons,
  paintPineBark,
  paintSeed,
  speciesLeafAmount,
  speciesLeaves,
  speciesWood,
  type TreeSpecies,
} from './species';
import { normalizeSeason, paintSnowCover, SeasonParticles, seasonLeaves, seasonLook, seasonWood, type SeasonFrame, type SeasonLook } from './season';
import { ResizeGate, seasonStepKey, sizeKey } from './resize';
import { bloomParticles, fireflySeason } from './phenology';
import { seedGlowAlpha, SeedGlow } from './seed-glow';
import { createClouds, drawClouds, paintGrass, paintHills, paintSky, paintSoil, SKY, type Cloud } from './scenery';
import { clamp01, mix, mulberry32, smooth01 } from './util';
import { VisitorLayer, type SceneVisitor, type VisitorFrame } from './visitors';
import { ShearBands, windQuantum, windSkew } from './wind';

export type { AnimalFamily, SceneAnimal } from './animals';
export { nicheAnchors, SCENE_NICHES, type NicheAnchor, type SceneNiche } from './anchors';
export { SCENE_PLANT_GROUPS, type ScenePlant, type ScenePlantGroup } from './flora';
export { MAX_HARMONY_TIER } from './mood';
export { CYCLE_TRANSITION_LEAD, CYCLE_TRANSITION_REDUCED_SECONDS, CYCLE_TRANSITION_SECONDS } from './cycle';
export type { SceneVisitor } from './visitors';
export type { TreeSpecies } from './plant';

export interface SceneInput {
  /** Kontinuierlicher Wachstumswert aus core/formulas.ts `growth()`. */
  growth: number;
  /** Laufzeit in Sekunden, für sanftes Wiegen im Wind und ziehende Wolken. */
  time: number;
  /** Tiere in den Nischen des Hauptbaums (Standard: keine). */
  animals?: readonly SceneAnimal[];
  /**
   * Begleitpflanzen um den Hauptbaum (optional). Sobald die Liste übergeben wird (auch
   * leer), erscheinen die automatischen Nachbarbäume ab „Hain“ nur noch als ferne
   * Kulisse. Ohne Angabe sieht die Szene aus wie bisher.
   */
  plants?: readonly ScenePlant[];
  /** Bewegung reduzieren (prefers-reduced-motion): Tiere ruhen, kein Wind, Wolken stehen. */
  reducedMotion?: boolean;
  /**
   * Index der Harmoniestufe als Zahl 0–4 (nicht der Name; DESIGN_V2.md 9.1: 0 = „Zarte
   * Anfänge“ … 4 = „Urwald“). Gebrochene Werte sind erlaubt, ungültige gelten als „aus“.
   * Färbt die Szene:
   * 0–1 leicht grau verschleiert, 2 neutral, 3 warmes Licht mit Sonnenstrahlen, Pollen
   * und Blütenblättern, 4 zusätzlich Glühwürmchen. Wechsel werden sanft übergeblendet.
   * Ohne Angabe sieht die Szene aus wie bisher.
   */
  harmonyTier?: number;
  /**
   * Durchreisende Gäste (src/content/visitors.ts, z. B. 'cranes', 'bramblings',
   * 'hummingbird-moth'); `slot` verteilt mehrere Gäste. Unbekannte IDs erscheinen als
   * kleiner Vogelschwarm. Ohne Angabe: keine Gäste.
   */
  visitors?: readonly SceneVisitor[];
  /**
   * Übergang zum Neuen Zyklus (DESIGN_V2.md §10). `startedAt` im selben Takt wie `time`
   * (Sekunden); `fromGrowth` ist das Wachstum des alten Baums, `fromPlants` optional
   * seine Begleitpflanzen. `growth`, `animals` und `plants` beschreiben schon den neuen
   * Zyklus. Ab `startedAt` spielt eine ~5,5 s lange, ruhige Sequenz: Der alte Wald
   * (aus `fromGrowth` gezeichnet) verblasst zur Silhouette, ein sanftes Leuchten, eine
   * Eichel fällt, der neue Samen leuchtet auf. Bei `reducedMotion` nur eine
   * Überblendung von 0,8 s. Das Bild hängt nur von der Eingabe ab (nicht von früheren
   * Frames). Ein Start bis 1 s in der Zukunft gilt als „jetzt“, weiter in der Zukunft
   * oder nach dem Ende passiert nichts – pixelgleich zur Szene ohne das Feld. Das Feld
   * darf gesetzt bleiben.
   */
  cycleTransition?: { startedAt: number; fromGrowth: number; fromPlants?: readonly ScenePlant[]; fromTree?: TreeSpecies };
  /**
   * Waldgedächtnis (Punkte, `meta.forestMemory`). Ab 1 steht fern im Hintergrund ein
   * blasser Erinnerungsbaum, der mit dem Gedächtnis langsam (logarithmisch) wächst.
   * Ohne Angabe oder bei 0: kein Erinnerungsbaum.
   */
  forestMemory?: number;
  /**
   * Jahreszeit als stufenloser Wert 0–4: 0 Frühling · 1 Sommer · 2 Herbst · 3 Winter ·
   * 4 wieder Frühling (Zwischenwerte blenden über, z. B. 1,5 Spätsommer). Werte
   * außerhalb werden modulo 4 genommen, ungültige (NaN, ∞) wie ohne Angabe. Frühling:
   * frisches Hellgrün, Blüten an Begleitbäumen; Herbst: gelb-orange-rotes Laub,
   * fallende Blätter; Winter: kahle Laubbäume und Sträucher (nur Kiefern und Moose grün),
   * dünne Schneedecke, leichter Schneefall, kühleres Licht, Insekten ruhen, keine
   * Blütenblätter und Glühwürmchen (phenology.ts). Ohne Angabe und bei 1 (Sommer) wie bisher.
   * Neu gezeichnet wird erst ab einer Änderung von 0,05.
   */
  season?: number;
  /**
   * Art des Hauptbaums: 'oak' (Eiche, Standard), 'beech' (Buche: glatter grauer Stamm,
   * dichte ovale Krone, im Herbst kupferbraun, trockenes Laub bleibt teils hängen,
   * Bucheckern) oder 'pine' (Waldkiefer: schlanker, astfreier Schaft mit Plattenborke,
   * durchgehender Leittrieb, Nadelbüschel in Etagen – jung kegelig, alt schirmartig –,
   * Zapfen, immer grün). Gilt für alle Stufen vom Samen
   * an, für Jahreszeiten, Zyklus-Übergang (Frucht der Art; der alte Baum ist
   * `cycleTransition.fromTree`, fehlt sie oder ist unbekannt, diese Art) und Erinnerungsbaum. Ohne Angabe Eiche.
   */
  mainTree?: TreeSpecies;
  /**
   * Die übergebene Größe ist schon entprellt (z. B. per `CanvasSizer` im Game Loop): Eine
   * neue Größe wird sofort neu aufgebaut, ohne eigene Wartezeit. Ohne Angabe wartet der
   * Renderer selbst, bis die Größe ~150 ms stabil ist, und zeigt so lange das alte Bild
   * skaliert.
   */
  sizeSettled?: boolean;
}

/** Ab dieser Änderung des Wachstums werden die Ebenen neu gezeichnet. */
const REDRAW_STEP = 0.005;
/** Kleinere Änderungen werden spätestens nach dieser Zeit (s) nachgezogen. */
const REDRAW_SETTLE_SECONDS = 1;
/** Höchstens so oft (s) neu zeichnen – bei schnellem Wachstum bleibt die Bildrate stabil. */
const REDRAW_MIN_INTERVAL = 0.2;
/**
 * Ersatz für die Zeitregeln, falls die Zeit steht (Pause, feste Demo-Zeit): nach so vielen
 * Frames wird eine Wachstumsänderung trotzdem nachgezogen (klein / groß).
 */
const REDRAW_SETTLE_FRAMES = 60;
const REDRAW_MIN_FRAMES = 12;
/** Ab diesem Wachstumswert (Stufe „Hain“) erscheinen weitere Bäume. */
const GROVE_GROWTH = 5;
/** Pflanzen-Ebene beim Wachsen höchstens nach dieser Änderung neu zeichnen. */
const PLANT_REDRAW_STEP = 0.02;
/** Beim Nachziehen (Wachstum steht) Pflanzen nur ab dieser Änderung neu zeichnen. */
const PLANT_SETTLE_STEP = 0.002;

const WOOD: WoodColors = { base: '#6b4a30', shade: '#563a25', light: '#866244' };
/** Junger, noch grüner Trieb – verholzt in den ersten Stufen allmählich. */
const STEM: WoodColors = { base: '#7a9a45', shade: '#62803a', light: '#93b35a' };
const ROOT: WoodColors = { base: '#9b7651', shade: '#6f5236', light: '#b8936a' };

const PALETTES: LeafPalette[] = [
  { shadow: '#2c5230', tones: ['#3a6e39', '#4d8942', '#68a14e'], highlight: '#a7cf7c' },
  { shadow: '#30562b', tones: ['#4a7934', '#5e903e', '#7ea94f'], highlight: '#bcd886' },
  { shadow: '#284f40', tones: ['#356a4b', '#468059', '#5f9a69'], highlight: '#9fcb9b' },
];

/** Nachbarbäume: Position (Anteil der Breite ab Mitte) und Tiefe; Reihenfolge = Erscheinen. */
const NEIGHBORS: { x: number; far: boolean }[] = [
  { x: -0.25, far: false },
  { x: 0.28, far: false },
  { x: -0.41, far: true },
  { x: 0.43, far: true },
  { x: -0.13, far: true },
  { x: 0.15, far: true },
  { x: -0.39, far: false },
  { x: 0.4, far: false },
  { x: -0.5, far: true },
  { x: 0.34, far: true },
  { x: -0.31, far: true },
  { x: 0.52, far: false },
  { x: -0.53, far: false },
  { x: 0.05, far: true },
  { x: -0.04, far: true },
  { x: 0.23, far: true },
];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Alles, was zu einer Canvas-Größe gehört. */
interface SizeCache {
  key: string;
  /** Gerätepixel des Canvas. */
  pw: number;
  ph: number;
  dpr: number;
  layout: Layout;
  /** Statische Kulisse (Himmel, Hügel, Erde): hängt nur von der Größe ab. */
  scenery: HTMLCanvasElement;
  /** Grasnarbe als schmaler Streifen ab Gerätepixel-Zeile `grassTop` (liegt über den Wurzeln). */
  grass: HTMLCanvasElement;
  grassTop: number;
  background: HTMLCanvasElement;
  back: HTMLCanvasElement;
  front: HTMLCanvasElement;
  clouds: Cloud[];
  /** Belegte Bereiche der Baum-Ebenen (Gerätepixel) – nur diese werden kopiert. */
  backRect: Rect | null;
  frontRect: Rect | null;
  /** Begleitpflanzen (erst angelegt, wenn es welche gibt). */
  plants: HTMLCanvasElement | null;
  plantsRect: Rect | null;
  /** Wachstum, mit dem die Pflanzen gezeichnet wurden (NaN = nie). */
  plantsGrowth: number;
  /** Mit Pflanzenliste gezeichnet (Nachbarbäume nur als Kulisse)? */
  withPlants: boolean;
  /** Fußpunkte der Begleitbäume (für Pilzfäden unter der Erde). */
  companionXs: number[];
  growth: number;
  drawnAt: number;
  /** Frames seit dem letzten Neuzeichnen der Ebenen. */
  framesSinceDraw: number;
  anchors: AnchorResolver | null;
  /** Umriss des Hauptbaums in CSS-Pixeln (x0, y0, x1, y1) oder null. */
  mainBox: [number, number, number, number] | null;
  /** Erinnerungsbaum: eigenes Canvas (erst bei Bedarf), belegter Bereich und sein Wachstum (0 = keiner). */
  memoryCanvas: HTMLCanvasElement | null;
  memoryRect: Rect | null;
  memory: number;
  /** Jahreszeit (gerundet), mit der Kulisse und Ebenen gezeichnet sind (−1 = Sommer/ohne Angabe). */
  seasonKey: number;
  /** Art des Hauptbaums, mit der Ebenen und Erinnerungsbaum gezeichnet sind. */
  species: TreeSpecies;
  /** Radius des Samens (CSS-Pixel), beim Neuaufbau der Ebenen gemerkt (für den Schein). */
  seedR: number;
}

interface Cache {
  size: SizeCache | null;
  /** Entprellt Größenänderungen. */
  gate: ResizeGate;
  /** Tier-Ebene mit Sprite-Cache und vorberechnetem Plan. */
  animals: AnimalLayer;
  spriteKey: number;
  /** Stimmung je Harmoniestufe (Überblendung, Strahlen- und Partikel-Sprites). */
  mood: MoodLayer;
  /** Durchreisende mit eigenem Sprite-Cache. */
  visitors: VisitorLayer;
  /** Übergang zum Neuen Zyklus (Kopien des alten Bilds nur während der Sequenz). */
  cycle: CycleTransition;
  /** Pflanzen, mit denen der alte Wald gezeichnet wurde. */
  cyclePlants: PlantSig[] | null;
  /** Zeitpunkt in der Sequenz für diesen Frame (NaN = keine Sequenz). */
  cycleU: number;
  /** Merkmale der zuletzt gezeichneten Pflanzenliste. */
  plantSig: PlantSig[] | null;
  /** Fallende Blätter und Schneeflocken. */
  seasonParticles: SeasonParticles;
  /** Jahreszeit dieses Frames (null = ohne Angabe). */
  look: SeasonLook | null;
  /** Ungerundete Jahreszeit dieses Frames (0–4, null = ohne Angabe) für Werte pro Frame. */
  season: number | null;
  /** Lichtschein am Samen (nur in der Stufe „Samen“). */
  seedGlow: SeedGlow;
}

/**
 * Merkmale einer Pflanze, von denen die Pflanzen-Ebene abhängt – normalisiert, damit
 * ungültige Werte (NaN) nicht bei jedem Vergleich als „geändert“ gelten.
 */
interface PlantSig {
  id: string;
  group: string;
  slot: number;
  /** Versorgung, mit der zuletzt gezeichnet wurde. */
  vigor: number;
}

/** Erst ab dieser Änderung der Versorgung neu zeichnen (Hysterese: kein Flackern an Grenzen). */
const VIGOR_REDRAW_STEP = 0.05;

function normSlot(slot: number): number {
  return Number.isFinite(slot) ? Math.floor(slot) : -1;
}

function normVigor(v: number): number {
  return Number.isFinite(v) ? clamp01(v) : 1;
}

function plantSig(p: ScenePlant): PlantSig {
  return { id: String(p.id), group: String(p.group), slot: normSlot(p.slot), vigor: normVigor(p.vigor) };
}

function samePlants(sig: PlantSig[] | null, plants: readonly ScenePlant[] | undefined): boolean {
  if (!plants) return sig === null;
  if (!sig || sig.length !== plants.length) return false;
  for (let i = 0; i < sig.length; i++) {
    const p = plants[i]!;
    const s = sig[i]!;
    if (s.id !== String(p.id) || s.group !== String(p.group) || s.slot !== normSlot(p.slot)) return false;
    // Versorgung vergleicht mit dem zuletzt gezeichneten Wert, nicht mit festen Stufen.
    const v = normVigor(p.vigor);
    if (Math.abs(v - s.vigor) >= VIGOR_REDRAW_STEP || (v !== s.vigor && (v === 0 || v === 1))) return false;
  }
  return true;
}

/** Wiederverwendete Frame-Daten für die Tier-Ebene (keine Allokation pro Frame). */
const animalFrame: AnimalFrame = { time: 0, windSkew: 0, reducedMotion: false, dpr: 1, sx: 1, sy: 1 };
const seasonFrame: SeasonFrame = { width: 1, groundY: 1, top: 0, dpr: 1, sx: 1, sy: 1, time: 0, reducedMotion: false };
const moodFrame: MoodFrame = { width: 1, height: 1, groundY: 1, top: 0, dpr: 1, sx: 1, sy: 1, time: 0, reducedMotion: false };
const visitorFrame: VisitorFrame = {
  width: 1,
  height: 1,
  groundY: 1,
  top: 0,
  size: 20,
  dpr: 1,
  sx: 1,
  sy: 1,
  time: 0,
  reducedMotion: false,
  windSkew: 0,
  blocked: [],
  anchors: null,
  crownX: 0,
  crownY: 0,
  crownRx: 0,
  crownRy: 0,
  crownTaken: [],
};
/** Ab diesem Wachstum (Stufe „Junger Baum“) gibt es eine Krone für Gäste. */
const CROWN_GROWTH = 3;

/** Vereinigt einen Bereich (CSS-Pixel) mit `r` und gibt das Ergebnis zurück. */
function unionRect(r: Rect | null, x0: number, y0: number, x1: number, y1: number): Rect {
  if (!r) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const nx = Math.min(r.x, x0);
  const ny = Math.min(r.y, y0);
  return { x: nx, y: ny, w: Math.max(r.x + r.w, x1) - nx, h: Math.max(r.y + r.h, y1) - ny };
}

/** CSS-Bereich → ganzzahliger Gerätepixel-Bereich innerhalb des Canvas. */
function toDeviceRect(r: Rect | null, dpr: number, pw: number, ph: number): Rect | null {
  if (!r) return null;
  const pad = 4;
  const x0 = Math.max(0, Math.floor((r.x - pad) * dpr));
  const y0 = Math.max(0, Math.floor((r.y - pad) * dpr));
  const x1 = Math.min(pw, Math.ceil((r.x + r.w + pad) * dpr));
  const y1 = Math.min(ph, Math.ceil((r.y + r.h + pad) * dpr));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function drawRect(ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, r: Rect): void {
  ctx.drawImage(layer, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
}

/** Wiederverwendete Streifen für den Wind (keine Allokation pro Frame). */
const shearBands = new ShearBands();

/**
 * Kopiert den Bereich `r` einer Baum-Ebene im Wind: Scherung `k` um die Bodenlinie,
 * angenähert durch waagerecht verschobene Streifen (siehe wind.ts). Bei k = 0 genau
 * eine unverschobene Kopie.
 */
function drawSheared(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  r: Rect,
  k: number,
  groundPx: number,
  quantum: number,
  sx: number,
  sy: number,
): void {
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  const b = shearBands;
  const n = b.update(r.y, r.h, groundPx, k, quantum);
  for (let i = 0; i < n; i++) {
    const y = b.y[i]!;
    const h = b.h[i]!;
    ctx.drawImage(layer, r.x, y, r.w, h, r.x + b.dx[i]!, y, r.w, h);
  }
}

/** Ein Cache je Canvas – so können mehrere Szenen nebeneinander laufen (z. B. Demo). */
const caches = new WeakMap<HTMLCanvasElement, Cache>();

export function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, input: SceneInput): void {
  if (width <= 0 || height <= 0) return;
  const pw = ctx.canvas.width;
  const ph = ctx.canvas.height;
  if (pw <= 0 || ph <= 0) return;
  const dpr = pw / width || 1;
  const g = Math.max(0, Number.isFinite(input.growth) ? input.growth : 0);
  // Ungültige Zeit (NaN/∞) wie 0 behandeln; die Frame-Zählung übernimmt dann.
  const time = Number.isFinite(input.time) ? input.time : 0;

  let cache = caches.get(ctx.canvas);
  if (!cache) {
    cache = {
      size: null,
      gate: new ResizeGate(),
      animals: new AnimalLayer(),
      spriteKey: -1,
      mood: new MoodLayer(),
      visitors: new VisitorLayer(),
      cycle: new CycleTransition(),
      cyclePlants: null,
      cycleU: Number.NaN,
      seasonParticles: new SeasonParticles(),
      look: null,
      season: null,
      plantSig: null,
      seedGlow: new SeedGlow(),
    };
    caches.set(ctx.canvas, cache);
  }

  // Jahreszeit dieses Frames (gemerkt je Rundung – keine Allokation pro Frame).
  const look = seasonLook(input.season);
  cache.look = look;
  cache.season = normalizeSeason(input.season);

  // Größenänderung entprellen: altes Bild skaliert zeigen, bis die Größe stabil ist –
  // außer der Aufrufer hat schon entprellt (`sizeSettled`).
  let sc = cache.size;
  const key = sc && sc.pw === pw && sc.ph === ph && sc.layout.width === width && sc.layout.height === height ? sc.key : sizeKey(pw, ph, width, height);
  const builtKey = sc ? sc.key : null;
  if (input.sizeSettled ? key !== builtKey : cache.gate.shouldRebuild(key, builtKey, input.time)) {
    // Kulisse gleich in der richtigen Jahreszeit (nicht zweimal malen).
    sc = buildSizeCache(sc, key, width, height, pw, ph, dpr, look);
    cache.size = sc;
  }
  sc = sc!;

  // Jahreszeit (auf 0,05 gerundet): Kulisse und Grasnarbe neu, wenn sich die Rundung
  // ändert; Baum-Ebenen, Pflanzen und Erinnerungsbaum folgen unten.
  const seasonKey = seasonStepKey(look);
  const seasonChanged = seasonKey !== sc.seasonKey;
  if (seasonChanged) {
    paintStatic(sc, look);
    sc.seasonKey = seasonKey;
  }

  // Art des Hauptbaums: bei einem Wechsel alle Baum-Ebenen und den Erinnerungsbaum neu.
  const species = normalizeSpecies(input.mainTree);
  const speciesChanged = species !== sc.species;
  sc.species = species;

  // Neuer Zyklus: Zeitpunkt in der Sequenz (NaN = außerhalb). Der alte Wald wird beim
  // Start (und nach Größenänderungen) einmal aus `fromGrowth` gezeichnet.
  const reduced = input.reducedMotion === true;
  const ct = input.cycleTransition;
  const cycleU = ct ? cycleElapsed(input.time, ct.startedAt, reduced) : Number.NaN;
  cache.cycleU = cycleU;
  if (Number.isNaN(cycleU) || !ct) {
    if (cache.cycle.prepared) cache.cycle.release();
  } else {
    const fromGrowth = Number.isFinite(ct.fromGrowth) ? Math.max(0, ct.fromGrowth) : 0;
    // Die Jahreszeit gehört bewusst nicht zum Schlüssel: Der alte Wald wird beim Start in
    // der dann gültigen Jahreszeit gezeichnet und bleibt für den Übergang so eingefroren.
    // Unbekannte oder fehlende Art des alten Baums → aktuelle Art.
    const fromTree = normalizeSpecies(ct.fromTree, species);
    const cycleKey = `${ct.startedAt}|${fromGrowth}|${sc.key}|${fromTree}|${species}`;
    if (!cache.cycle.prepared || cache.cycle.key !== cycleKey || !samePlants(cache.cyclePlants, ct.fromPlants)) {
      cache.cyclePlants = ct.fromPlants ? ct.fromPlants.map(plantSig) : null;
      cache.cycle.prepare(cycleKey, cycleGeometry(sc), paintOldForest(sc, fromGrowth, ct.fromPlants, look, fromTree), species);
    }
  }

  // Erinnerungsbaum: eigenes Canvas, neu nur bei Größenänderung oder neuem Wachstum.
  const memory = memoryGrowth(input.forestMemory);
  if (memory !== sc.memory || seasonChanged || speciesChanged) renderMemory(sc, memory, look, species);

  const delta = Math.abs(g - sc.growth);
  const since = time - sc.drawnAt;
  const frames = ++sc.framesSinceDraw;
  const clockReset = since < 0;
  const due =
    (delta >= REDRAW_STEP && (since >= REDRAW_MIN_INTERVAL || frames >= REDRAW_MIN_FRAMES)) ||
    (delta > 0 && (since > REDRAW_SETTLE_SECONDS || frames >= REDRAW_SETTLE_FRAMES));
  // Neue Pflanzenliste: alles neu (Nachbarbäume, Pilzfäden und Pflanzen hängen davon ab).
  const plantsChanged = !samePlants(cache.plantSig, input.plants);
  if (
    Number.isNaN(sc.growth) ||
    clockReset ||
    due ||
    plantsChanged ||
    seasonChanged ||
    speciesChanged ||
    sc.withPlants !== (input.plants !== undefined)
  ) {
    // Pflanzen beim Wachsen höchstens alle PLANT_REDRAW_STEP; beim Nachziehen (kleine
    // Änderung) exakt – aber nur, wenn sich ihr Wachstum tatsächlich merklich geändert hat.
    const plantDelta = Math.abs(g - sc.plantsGrowth);
    const settle = delta < REDRAW_STEP;
    const redrawPlants =
      plantsChanged ||
      seasonChanged ||
      speciesChanged ||
      Number.isNaN(sc.plantsGrowth) ||
      plantDelta >= PLANT_REDRAW_STEP ||
      (settle && plantDelta >= PLANT_SETTLE_STEP);
    // Die Signatur hält fest, womit die Pflanzen zuletzt gezeichnet wurden.
    if (redrawPlants) cache.plantSig = input.plants ? input.plants.map(plantSig) : null;
    renderLayers(sc, g, input.plants, redrawPlants, look, species);
    sc.growth = g;
    sc.drawnAt = time;
    sc.framesSinceDraw = 0;
  }

  // Sprites einer alten Tiergröße/Pixeldichte verwerfen (numerischer Schlüssel, kein String pro Frame).
  const spriteKey = (sc.anchors?.size ?? 0) * 100_000 + Math.round(sc.dpr * 1000);
  if (cache.spriteKey !== spriteKey) {
    cache.animals.sprites.clear();
    cache.spriteKey = spriteKey;
  }

  compose(ctx, sc, cache, input, time, pw / sc.pw, ph / sc.ph);
}

/** Setzt die gecachten Ebenen zusammen – nur drawImage und günstige Transformationen. */
function compose(
  ctx: CanvasRenderingContext2D,
  sc: SizeCache,
  cache: Cache,
  input: SceneInput,
  time: number,
  sx: number,
  sy: number,
): void {
  const { dpr, layout } = sc;
  const reduced = input.reducedMotion === true;
  const layer = cache.animals;
  ctx.save();
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.drawImage(sc.background, 0, 0);
  // Spielbeginn: warmer, sanft pulsierender Schein am Samen (bis zum Keimling).
  // Beim Neuen Zyklus erst nach dem Aufleuchten aus cycle.ts (siehe seedGlowCycleFade).
  const glow = seedGlowAlpha(sc.growth, time, reduced, cache.cycleU);
  if (glow > 0) {
    // Lage wie in `paintUnderground` (keine Allokation pro Frame).
    cache.seedGlow.draw(ctx, layout.cx, layout.groundY + layout.soilH * 0.14, sc.seedR * 5, glow, dpr, sx, sy);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }
  if (sc.memoryCanvas && sc.memoryRect) {
    const r = sc.memoryRect;
    ctx.drawImage(sc.memoryCanvas, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
  }
  drawClouds(ctx, sc.clouds, layout.width, reduced ? 0 : time, dpr);

  // Stimmung und Gäste nur, wenn angegeben – sonst bleibt das Bild exakt wie bisher.
  const level = cache.mood.update(input.harmonyTier, time, reduced);
  const mf = moodFrame;
  if (level !== null) {
    mf.width = layout.width;
    mf.height = layout.height;
    mf.groundY = layout.groundY;
    mf.top = layout.top;
    mf.dpr = dpr;
    mf.sx = sx;
    mf.sy = sy;
    mf.time = time;
    mf.reducedMotion = reduced;
    // Ungerundete Jahreszeit: stufenlos, ohne Sprünge bei jeder Rundungsstufe.
    mf.bloom = bloomParticles(cache.season);
    mf.fireflies = fireflySeason(cache.season);
  }
  const visitors = input.visitors && input.visitors.length > 0 ? input.visitors : null;
  const vf = visitorFrame;
  if (visitors) {
    vf.width = layout.width;
    vf.height = layout.height;
    vf.groundY = layout.groundY;
    vf.top = layout.top;
    vf.size = sc.anchors?.size ?? 24;
    vf.dpr = dpr;
    vf.sx = sx;
    vf.sy = sy;
    vf.time = time;
    vf.reducedMotion = reduced;
    vf.windSkew = 0;
    // Belegte Waldsaum-Plätze (gemerkt, nur bei geänderten Plätzen neu) und die Krone.
    vf.blocked = cache.visitors.updateBlocked(input.animals, sc.anchors);
    vf.crownTaken = cache.visitors.crownTaken;
    vf.anchors = sc.anchors;
    const fr = sc.frontRect;
    if (fr && sc.growth >= CROWN_GROWTH) {
      const w = fr.w / dpr;
      const h = fr.h / dpr;
      vf.crownX = fr.x / dpr + w / 2;
      vf.crownY = fr.y / dpr + h * 0.35;
      vf.crownRx = w * 0.42;
      vf.crownRy = h * 0.22;
    } else {
      vf.crownRx = 0;
    }
    // Einmal pro Frame: Sprite-Cache weiterzählen (sky, meadow, front folgen).
    cache.visitors.beginFrame(vf.size, dpr);
    cache.visitors.draw(ctx, visitors, 'sky', vf);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }

  const groundPx = layout.groundY * dpr;
  const quantum = windQuantum(dpr);
  if (sc.backRect) {
    const kb = reduced ? 0 : windSkew(time, 1.9) * 0.7;
    drawSheared(ctx, sc.back, sc.backRect, kb, groundPx, quantum, sx, sy);
  }
  // Wildschweine auf der Wiese: vor den Begleitpflanzen, hinter dem Hauptbaum.
  if (visitors) cache.visitors.draw(ctx, visitors, 'meadow', vf);
  const k = reduced ? 0 : windSkew(time, 0);
  if (sc.frontRect) {
    drawSheared(ctx, sc.front, sc.frontRect, k, groundPx, quantum, sx, sy);
  }
  if (visitors) {
    vf.windSkew = k;
    cache.visitors.draw(ctx, visitors, 'front', vf);
  }
  const animals = input.animals;
  if (animals && animals.length > 0 && sc.anchors) {
    const f = animalFrame;
    f.time = time;
    f.windSkew = k;
    f.reducedMotion = reduced;
    f.season = cache.season;
    f.dpr = dpr;
    f.sx = sx;
    f.sy = sy;
    layer.draw(ctx, animals, sc.anchors, f);
  }
  // Fallende Blätter und Schnee (nur außerhalb des Sommers).
  if (cache.look && !cache.look.summer) {
    const sf = seasonFrame;
    sf.width = layout.width;
    sf.groundY = layout.groundY;
    sf.top = layout.top;
    sf.dpr = dpr;
    sf.sx = sx;
    sf.sy = sy;
    sf.time = time;
    sf.reducedMotion = reduced;
    cache.seasonParticles.draw(ctx, cache.look, sf);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }
  if (level !== null) {
    cache.mood.drawLight(ctx, level, mf);
    cache.mood.drawParticles(ctx, level, mf);
  }
  // Übergang zum Neuen Zyklus ganz oben (außerhalb des Zeitfensters: nichts).
  if (!Number.isNaN(cache.cycleU) && cache.cycle.prepared) {
    cache.cycle.draw(ctx, cache.cycleU, reduced, cycleGeometry(sc), sx, sy);
  }
  ctx.restore();
}

/** Maße für den Zyklus-Übergang (Samen wie in `paintUnderground`). */
function cycleGeometry(sc: SizeCache): CycleGeometry {
  const { layout } = sc;
  return {
    width: layout.width,
    height: layout.height,
    groundY: layout.groundY,
    cx: layout.cx,
    seedY: layout.groundY + layout.soilH * 0.14,
    size: sc.anchors?.size ?? animalSize(layout.width, layout.height),
    dpr: sc.dpr,
  };
}

/** Seed des Erinnerungsbaums. */
const MEMORY_SEED = 4242;

/**
 * Wachstum des Erinnerungsbaums aus dem Waldgedächtnis (0 = keiner): ab 1 Punkt ein
 * junger Baum (3), bei 1000 Punkten ein alter (6,5). Auf 0,05 gerundet – so wird er
 * nur selten neu gezeichnet.
 */
export function memoryGrowth(forestMemory: number | undefined): number {
  if (forestMemory === undefined || !Number.isFinite(forestMemory) || forestMemory < 1) return 0;
  const t = smooth01(Math.log10(1 + Math.min(forestMemory, 1000)) / 3);
  return Math.round((3 + 3.5 * t) * 20) / 20;
}

/** Erinnerungsbaum: fern und blass auf dem Hügel links – in ein eigenes Canvas (nur sein Bereich). */
function renderMemory(sc: SizeCache, memory: number, look: SeasonLook | null, species: TreeSpecies): void {
  sc.memory = memory;
  sc.memoryRect = null;
  if (memory <= 0) {
    if (sc.memoryCanvas) {
      sc.memoryCanvas.width = 0;
      sc.memoryCanvas.height = 0;
    }
    return;
  }
  const { layout, dpr } = sc;
  // Auf dem fernen Hügelkamm und etwas höher als die Kulisse – so bleibt die Krone
  // auch hinter einem dichten Wald erkennbar.
  const baseY = layout.groundY - layout.height * 0.08;
  const tree = placeTree(memory, MEMORY_SEED, layout.cx - layout.width * 0.36, baseY, (baseY - layout.top) * 0.6, layout.width * 0.13, species === 'oak' ? undefined : TREE_FORMS[species]);
  const r = toDeviceRect(unionRect(null, ...treeBounds(tree)), dpr, sc.pw, sc.ph);
  if (!r) return;
  const canvas = sc.memoryCanvas ?? document.createElement('canvas');
  canvas.width = r.w;
  canvas.height = r.h;
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, -r.x, -r.y);
  if (species === 'oak') {
    paintTree(c, tree, hazeWood(seasonWood(WOOD, look), 0.7), hazePalette(seasonLeaves(PALETTES[2]!, look), 0.7), look ? look.leaves : 1);
  } else {
    paintSpeciesTree(c, tree, species, hazeWood(seasonWood(speciesWood(species, WOOD, WOOD, 1), look), 0.7), hazePalette(speciesLeaves(species, PALETTES[2]!, look), 0.7), speciesLeafAmount(species, look), 0);
  }
  sc.memoryCanvas = canvas;
  sc.memoryRect = r;
}

/**
 * Der alte Wald für den Zyklus-Übergang: Nachbarbäume, Begleitpflanzen und Hauptbaum
 * aus `g` – wie in den Baum-Ebenen, aber ohne Wind, in ein Canvas nur so groß wie nötig.
 */
function paintOldForest(sc: SizeCache, g: number, plants: readonly ScenePlant[] | undefined, look: SeasonLook | null, species: TreeSpecies): OldForest | null {
  const { layout, dpr } = sc;
  const withPlants = plants !== undefined;
  const main = placeMainTree(layout, g, species);
  const trees = placeNeighbors(neighborTrees(g, layout, withPlants), layout, withPlants);
  const flora = plants && plants.length > 0 ? layoutFlora(layout, g, plants, { main, species }) : [];
  let rect: Rect | null = null;
  for (const n of trees) rect = unionRect(rect, ...treeBounds(n.tree));
  for (const p of flora) rect = unionRect(rect, ...plantBounds(p));
  const box = main ? treeBounds(main) : null;
  if (box) rect = unionRect(rect, ...box);
  const r = toDeviceRect(rect, dpr, sc.pw, sc.ph);
  if (!r) return null;
  const canvas = document.createElement('canvas');
  canvas.width = r.w;
  canvas.height = r.h;
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, -r.x, -r.y);
  const leaves = look ? look.leaves : 1;
  for (const n of trees) paintTree(c, n.tree, hazeWood(seasonWood(WOOD, look), n.haze), hazePalette(seasonLeaves(n.palette, look), n.haze), leaves);
  for (const p of flora) paintPlant(c, p, look);
  if (main) paintMainTree(c, main, g, species, look);
  return {
    canvas,
    rect: { x: r.x / dpr, y: r.y / dpr, w: r.w / dpr, h: r.h / dpr },
    tree: box ? { x0: box[0], y0: box[1], x1: box[2], y1: box[3] } : null,
  };
}

/** Legt die Ebenen für eine Canvas-Größe an und zeichnet die statische Kulisse. */
function buildSizeCache(
  old: SizeCache | null,
  key: string,
  width: number,
  height: number,
  pw: number,
  ph: number,
  dpr: number,
  look: SeasonLook | null,
): SizeCache {
  const layout = makeLayout(width, height);
  const sized = (c: HTMLCanvasElement | undefined) => {
    const canvas = c ?? document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    return canvas;
  };
  const sc: SizeCache = {
    key,
    pw,
    ph,
    dpr,
    layout,
    scenery: sized(old?.scenery),
    grass: old?.grass ?? document.createElement('canvas'),
    grassTop: 0,
    background: sized(old?.background),
    back: sized(old?.back),
    front: sized(old?.front),
    clouds: createClouds(width, layout.groundY, dpr),
    backRect: null,
    frontRect: null,
    plants: old?.plants ? sized(old.plants) : null,
    plantsRect: null,
    plantsGrowth: NaN,
    withPlants: false,
    companionXs: [],
    growth: NaN,
    drawnAt: 0,
    framesSinceDraw: 0,
    anchors: null,
    mainBox: null,
    memoryCanvas: old?.memoryCanvas ?? null,
    memoryRect: null,
    memory: Number.NaN,
    seasonKey: -1,
    species: 'oak',
    seedR: 4,
  };

  paintStatic(sc, look);
  sc.seasonKey = seasonStepKey(look);
  return sc;
}

/** Statische Kulisse (Himmel, Hügel, Erde) und Grasnarbe – je Größe und Jahreszeit. */
function paintStatic(sc: SizeCache, look: SeasonLook | null): void {
  const { layout, dpr, pw, ph } = sc;
  const { width, height } = layout;
  const sky = layerContext(sc.scenery, dpr);
  paintSky(sky, width, layout.groundY, look);
  paintHills(sky, width, height, layout.groundY, look);
  paintSoil(sky, width, height, layout.groundY);

  // Grasnarbe nur als Streifen um die Bodenlinie (Halme reichen bis 1,2 × bladeH hinauf).
  const above = Math.max(4, height * 0.016) * 1.2 + 2;
  const below = Math.max(4, height * 0.014) + 2;
  sc.grassTop = Math.max(0, Math.floor((layout.groundY - above) * dpr));
  sc.grass.width = pw;
  sc.grass.height = Math.max(1, Math.min(ph, Math.ceil((layout.groundY + below) * dpr)) - sc.grassTop);
  const gc = sc.grass.getContext('2d')!;
  gc.setTransform(1, 0, 0, 1, 0, 0);
  gc.clearRect(0, 0, sc.grass.width, sc.grass.height);
  gc.setTransform(dpr, 0, 0, dpr, 0, -sc.grassTop);
  paintGrass(gc, width, height, layout.groundY, look);
}

function layerContext(canvas: HTMLCanvasElement, dpr: number): CanvasRenderingContext2D {
  const c = canvas.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

/** Umriss eines platzierten Baums in CSS-Pixeln: [x0, y0, x1, y1]. */
function treeBounds(t: PlacedTree): [number, number, number, number] {
  return [t.x + t.geo.minX * t.scale, t.y + t.geo.minY * t.scale, t.x + t.geo.maxX * t.scale, t.y + 4];
}

/** Größe der Nadelbüschel der Kiefer (relativ zu den Blattbüscheln der Geometrie). */
const PINE_CLUMP_SCALE = 0.72;

/** Hauptbaum der Art (Holz verholzt mit dem Alter, Laub je Jahreszeit). */
function paintMainTree(ctx: CanvasRenderingContext2D, main: PlacedTree, g: number, species: TreeSpecies, look: SeasonLook | null): void {
  const lignin = smooth01((g - 1) / 2);
  if (species === 'oak') {
    paintTree(ctx, main, seasonWood(mixWood(STEM, WOOD, lignin), look), seasonLeaves(PALETTES[0]!, look), look ? look.leaves : 1);
    return;
  }
  paintSpeciesTree(ctx, main, species, seasonWood(speciesWood(species, STEM, WOOD, lignin), look), speciesLeaves(species, PALETTES[0]!, look), speciesLeafAmount(species, look), g);
}

/**
 * Buche (runde Blattballen, glatte Rinde) oder Kiefer (Schuppenborke, Nadelbüschel,
 * Zapfen). `g`: Alter für Borke und Zapfen – 0 lässt diese Einzelheiten weg (ferner,
 * dunstiger Erinnerungsbaum).
 */
function paintSpeciesTree(ctx: CanvasRenderingContext2D, t: PlacedTree, species: TreeSpecies, wood: WoodColors, palette: LeafPalette, leaves: number, g: number): void {
  paintWood(ctx, t.geo, t.x, t.y, t.scale, 1, wood);
  if (species === 'pine') {
    paintPineBark(ctx, t.geo, t.x, t.y, t.scale, g);
    // Kleine, getrennte Nadelbüschel: Zwischen den Etagen bleibt Himmel sichtbar.
    paintNeedleClumps(ctx, t.geo, t.x, t.y, t.scale, PINE_CLUMP_SCALE, 0.5, palette);
    paintCones(ctx, t.geo, t.x, t.y, t.scale, g);
    return;
  }
  paintLeaves(ctx, t.geo, t.x, t.y, t.scale, palette, leaves);
}

function paintTree(ctx: CanvasRenderingContext2D, t: PlacedTree, wood: WoodColors, palette: LeafPalette, leaves = 1): void {
  paintWood(ctx, t.geo, t.x, t.y, t.scale, 1, wood);
  paintLeaves(ctx, t.geo, t.x, t.y, t.scale, palette, leaves);
}

function hazePalette(p: LeafPalette, haze: number): LeafPalette {
  return {
    shadow: mix(p.shadow, SKY.haze, haze),
    tones: [mix(p.tones[0], SKY.haze, haze), mix(p.tones[1], SKY.haze, haze), mix(p.tones[2], SKY.haze, haze)],
    highlight: mix(p.highlight, SKY.haze, haze),
  };
}

function mixWood(a: WoodColors, b: WoodColors, t: number): WoodColors {
  return { base: mix(a.base, b.base, t), shade: mix(a.shade, b.shade, t), light: mix(a.light, b.light, t) };
}

function hazeWood(w: WoodColors, haze: number): WoodColors {
  const h = { base: SKY.haze, shade: SKY.haze, light: SKY.haze };
  return mixWood(w, h, haze);
}

interface NeighborTree {
  x: number;
  g: number;
  far: boolean;
  seed: number;
}

/**
 * Sichtbare Nachbarbäume: erscheinen nacheinander als kleine Setzlinge und wachsen stetig.
 * Mit Begleitpflanzen (`backdrop`) nur die hintere Reihe – als ferne Kulisse.
 */
function neighborTrees(g: number, layout: Layout, backdrop = false): NeighborTree[] {
  if (g < GROVE_GROWTH) return [];
  const result: NeighborTree[] = [];
  NEIGHBORS.forEach((n, i) => {
    const appear = GROVE_GROWTH + i * 0.16;
    if (g <= appear || (backdrop && !n.far)) return;
    const cap = n.far ? 3.6 : 4.2;
    result.push({ x: layout.cx + n.x * layout.width, g: 1 + Math.min(cap, (g - appear) * 2.2), far: n.far, seed: 1000 + i });
  });
  return result;
}

function renderLayers(
  sc: SizeCache,
  g: number,
  plants: readonly ScenePlant[] | undefined,
  redrawPlants: boolean,
  look: SeasonLook | null,
  species: TreeSpecies,
): void {
  const leaves = look ? look.leaves : 1;
  const { dpr, layout } = sc;
  const withPlants = plants !== undefined;
  const neighbors = neighborTrees(g, layout, withPlants);

  // Hauptbaum zuerst berechnen – Wurzeln und Tier-Ankerpunkte richten sich nach ihm.
  const scale1 = sproutScale(layout);
  sc.seedR = seedRadius(layout, scale1);
  const main = placeMainTree(layout, g, species);
  sc.anchors = createAnchorResolver(layout, g, main);

  // --- Begleitpflanzen (eigene Ebene) ---
  if (redrawPlants || sc.withPlants !== withPlants) {
    const flora = plants && plants.length > 0 ? layoutFlora(layout, g, plants, { main, anchors: sc.anchors, species }) : [];
    sc.companionXs = flora.filter((p) => p.tree).map((p) => p.x);
    sc.plantsRect = renderPlants(sc, flora, look);
    sc.plantsGrowth = g;
    sc.withPlants = withPlants;
  }

  // --- Hintergrund: statische Kulisse kopieren, Wurzeln, Grasnarbe darüber ---
  const bg = layerContext(sc.background, dpr);
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.drawImage(sc.scenery, 0, 0);
  bg.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintUnderground(bg, layout, g, scale1, main, withPlants ? sc.companionXs : neighbors.map((n) => n.x), species);
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.drawImage(sc.grass, 0, sc.grassTop);
  // Winter: dünne Schneedecke auf der Grasnarbe.
  if (look && look.snow > 0) {
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintSnowCover(bg, layout.width, layout.height, layout.groundY, look.snow);
  }

  // --- Nachbarbäume: hintere Reihe blasser als die vordere ---
  const back = layerContext(sc.back, dpr);
  let backRect: Rect | null = null;
  for (const n of placeNeighbors(neighbors, layout, withPlants)) {
    backRect = unionRect(backRect, ...treeBounds(n.tree));
    paintTree(back, n.tree, hazeWood(seasonWood(WOOD, look), n.haze), hazePalette(seasonLeaves(n.palette, look), n.haze), leaves);
  }

  // --- Hauptbaum bzw. Keimling ---
  const front = layerContext(sc.front, dpr);
  const { pw, ph } = sc;
  sc.backRect = toDeviceRect(backRect, dpr, pw, ph);
  // Begleitpflanzen aus ihrem Cache vor die Kulisse kopieren: pro Frame bleibt es bei
  // einer einzigen Kopie für die ganze hintere Ebene (wiegt sich gemeinsam im Wind).
  const pr = sc.plantsRect;
  if (sc.plants && pr) {
    back.setTransform(1, 0, 0, 1, 0, 0);
    drawRect(back, sc.plants, pr);
    sc.backRect = unionRect(sc.backRect, pr.x, pr.y, pr.x + pr.w, pr.y + pr.h);
  }
  if (main) {
    sc.mainBox = treeBounds(main);
    sc.frontRect = toDeviceRect(unionRect(null, ...sc.mainBox), dpr, pw, ph);
    paintMainTree(front, main, g, species, look);
    // Keimblätter verblassen, während die ersten Blattbüschel wachsen.
    const coty = 1 - clamp01((g - 1) / 0.8);
    if (coty > 0) {
      paintCotyledons(front, main.x + main.geo.tipX * main.scale, main.y + main.geo.tipY * main.scale, scale1 * 0.36 * coty, species);
    }
  } else {
    sc.mainBox = null;
    paintSprout(front, layout, g, scale1, species);
    sc.frontRect = toDeviceRect(
      unionRect(null, layout.cx - scale1, layout.groundY - scale1 * 1.4, layout.cx + scale1, layout.groundY + 4),
      dpr,
      pw,
      ph,
    );
  }
}

/** Nachbarbäume platziert, in Zeichenreihenfolge: hintere Reihe (blasser) zuerst. */
function placeNeighbors(neighbors: NeighborTree[], layout: Layout, withPlants: boolean): { tree: PlacedTree; haze: number; palette: LeafPalette }[] {
  const out: { tree: PlacedTree; haze: number; palette: LeafPalette }[] = [];
  for (const far of [true, false]) {
    // Als Kulisse hinter Begleitpflanzen: blasser und etwas kleiner.
    const haze = withPlants ? 0.62 : far ? 0.5 : 0.25;
    const baseY = layout.groundY - layout.height * (far ? 0.035 : 0.012);
    for (const n of neighbors) {
      if (n.far !== far) continue;
      const maxH = (baseY - layout.top) * (withPlants ? 0.42 : far ? 0.5 : 0.66);
      out.push({ tree: placeTree(n.g, n.seed, n.x, baseY, maxH, layout.width * 0.14), haze, palette: PALETTES[n.seed % PALETTES.length]! });
    }
  }
  return out;
}

/** Umriss einer Begleitpflanze in CSS-Pixeln: [x0, y0, x1, y1]. */
function plantBounds(p: PlacedPlant): [number, number, number, number] {
  const top = p.tree ? p.y + p.tree.geo.minY * p.tree.scale : p.y - p.h * 1.6;
  return [p.x - p.hw * 1.15, top - 4, p.x + p.hw * 1.15, p.y + 6];
}

/** Zeichnet die Begleitpflanzen in ihre Ebene; gibt den belegten Bereich (Gerätepixel) zurück. */
function renderPlants(sc: SizeCache, flora: PlacedPlant[], look: SeasonLook | null): Rect | null {
  if (flora.length === 0) {
    if (sc.plants) layerContext(sc.plants, sc.dpr);
    return null;
  }
  if (!sc.plants) {
    sc.plants = document.createElement('canvas');
    sc.plants.width = sc.pw;
    sc.plants.height = sc.ph;
  }
  const ctx = layerContext(sc.plants, sc.dpr);
  let rect: Rect | null = null;
  for (const p of flora) {
    paintPlant(ctx, p, look);
    rect = unionRect(rect, ...plantBounds(p));
  }
  return toDeviceRect(rect, sc.dpr, sc.pw, sc.ph);
}

/** Keimling oberhalb der Erde (g < 1). */
function paintSprout(ctx: CanvasRenderingContext2D, layout: Layout, g: number, scale1: number, species: TreeSpecies): void {
  const h = scale1 * clamp01((g - 0.35) / 0.65);
  if (h <= 0.5) return;
  const x = layout.cx;
  const y = layout.groundY;
  ctx.strokeStyle = STEM.base;
  ctx.lineWidth = Math.max(1.5, scale1 * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  // Der junge Trieb ist anfangs gebogen und richtet sich dann auf.
  const hook = (1 - clamp01((g - 0.35) / 0.4)) * h * 0.5;
  ctx.quadraticCurveTo(x - h * 0.08, y - h * 0.6, x + hook, y - h);
  ctx.stroke();
  const leaf = smooth01((g - 0.55) / 0.45);
  if (leaf > 0) paintCotyledons(ctx, x + hook, y - h, scale1 * 0.36 * leaf, species);
}

/** Keimblätter an der Triebspitze (Eiche: zwei schmale; andere Arten siehe species.ts). */
function paintCotyledons(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, species: TreeSpecies = 'oak'): void {
  if (species !== 'oak') {
    paintSpeciesCotyledons(ctx, species, x, y, size, PALETTES[0]!);
    return;
  }
  if (size < 0.5) return;
  const palette = PALETTES[0]!;
  for (const side of [-1, 1]) {
    const angle = side * 0.45 - (side < 0 ? Math.PI : 0);
    const cx = x + Math.cos(angle) * size * 0.5;
    const cy = y + Math.sin(angle) * size * 0.5 - size * 0.08;
    ctx.fillStyle = palette.tones[1];
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.55, size * 0.26, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.tones[2];
    ctx.beginPath();
    ctx.ellipse(cx - size * 0.05, cy - size * 0.06, size * 0.35, size * 0.12, angle, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Radius des Samens unter der Erde (CSS-Pixel). */
function seedRadius(layout: Layout, scale1: number): number {
  return Math.max(4, Math.min(scale1 * 0.1, layout.soilH * 0.08));
}

/** Samen, Keimwurzel, Wurzelwerk und (im Wald) Pilzfäden unter der Erde. */
function paintUnderground(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  g: number,
  scale1: number,
  main: PlacedTree | null,
  /** Fußpunkte der Bäume ringsum, die das Pilzgeflecht verbindet. */
  treeXs: number[],
  species: TreeSpecies = 'oak',
): void {
  const { cx, groundY, soilH } = layout;
  const seedY = groundY + soilH * 0.14;
  const seedR = seedRadius(layout, scale1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, groundY, layout.width, soilH);
  ctx.clip();
  ctx.lineCap = 'round';

  if (g < 1) {
    // Keimwurzel nach unten, Trieb nach oben bis zur Oberfläche.
    const root = soilH * 0.27 * smooth01(g / 0.8);
    if (root > 0.5) {
      ctx.strokeStyle = ROOT.light;
      ctx.lineWidth = Math.max(1.2, seedR * 0.35);
      ctx.beginPath();
      ctx.moveTo(cx, seedY);
      ctx.quadraticCurveTo(cx + seedR * 0.8, seedY + root * 0.5, cx - seedR * 0.2, seedY + root);
      ctx.stroke();
    }
    const shoot = clamp01(g / 0.35);
    if (shoot > 0) {
      ctx.strokeStyle = '#b5c27f';
      ctx.lineWidth = Math.max(1.5, scale1 * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx, seedY);
      ctx.lineTo(cx, seedY - (seedY - groundY + 2) * shoot);
      ctx.stroke();
    }
  }

  if (main) {
    // Wurzeln wachsen mit dem Baum in die Tiefe und Breite.
    const roots = placeRoots(layout, g, main);
    paintWood(ctx, roots.geo, cx, groundY, roots.scale, roots.widthScale, ROOT);

    // Pilzfäden verbinden im Wald die Wurzeln der Bäume.
    const fungus = 0.4 * smooth01(g - 6);
    if (fungus > 0) {
      const rand = mulberry32(5);
      ctx.strokeStyle = '#efe6cf';
      ctx.globalAlpha = fungus;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (const nx of treeXs) {
        const y1 = groundY + soilH * (0.3 + rand() * 0.4);
        const y2 = groundY + soilH * (0.15 + rand() * 0.3);
        const x1 = cx + (nx - cx) * 0.25;
        const mx = (x1 + nx) / 2;
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(mx, y1 + soilH * (rand() - 0.3) * 0.4, mx, y2 - soilH * rand() * 0.2, nx, y2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Die Samenschale bleibt noch kurz sichtbar und verblasst dann.
  const seedAlpha = 1 - clamp01((g - 1) / 0.5);
  if (seedAlpha > 0) {
    ctx.globalAlpha = seedAlpha;
    // Eichel, Buchecker oder geflügelter Kiefernsamen.
    paintSeed(ctx, species, cx, seedY, seedR);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
