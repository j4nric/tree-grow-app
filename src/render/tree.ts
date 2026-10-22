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
 *   Tag und Nacht (optional, daylight.ts): getönte Kopien von Kulisse (mit Nacht- bzw.
 *      Dämmerungshimmel), Baum-Ebenen und Erinnerungsbaum – neu nur bei neuer
 *      Tönungsstufe oder neu gezeichneten Ebenen; pro Frame nur Sterne und Mond dazu.
 *      Tiere, Gäste und Partikel liegen darüber und bleiben hell.
 *   Durchreisende (optional): Kraniche hinter dem Baum, Schwärme und Falter davor
 * Wind ist nur eine Scherung der gecachten Baum-Ebenen um die Bodenlinie – gezeichnet als
 * waagerecht verschobene Streifen statt schiefer Kopie (wind.ts); Tiere am Baum werden
 * um denselben Betrag verschoben. Tiere liegen immer über den Pflanzen.
 * Größenänderungen werden entprellt: Bis die neue Größe ~150 ms stabil ist, wird das
 * alte Bild skaliert gezeigt (`ResizeGate`). Der Game Loop entprellt schon den
 * Backing-Store des Canvas (`CanvasSizer`, ~100 ms) und setzt `sizeSettled` – dann wird
 * eine neue Größe sofort übernommen, ohne dass sich beide Wartezeiten addieren.
 * Kamera (`SceneInput.camera`, camera.ts): Alle Ebenen werden über eine Abbildung
 * (Skalierung + Verschiebung) auf das Canvas gebracht. Während sich die Kamera bewegt,
 * werden die vorhandenen Ebenen skaliert gezeigt (nur der sichtbare Teil kopiert); ruht
 * sie ~150 ms vergrößert, entsteht ein zweiter Ebenen-Satz („Detail“) nur für den
 * sichtbaren Ausschnitt – so groß wie das Canvas, Auflösung = Pixeldichte × Zoom – und
 * wird 1:1 kopiert. Bei 1× wird er freigegeben; ohne Kamera ist das Bild unverändert.
 * Pro Frame kostet die Kulisse damit eine Kopie (`background`, dazu der kleine Bereich des
 * Erinnerungsbaums – hineinbacken brachte messbar nichts); die Stimmungs-Ebene
 * liegt über bewegten Teilen (Wolken, Wind, Tiere) und lässt sich nicht hineinbacken.
 */

import { animalSize, createAnchorResolver, type AnchorResolver } from './anchors';
import { AnimalLayer, hitTestAnimals, type AnimalFrame, type AnimalHit, type SceneAnimal } from './animals';
import { layoutFlora, type PlacedPlant, type ScenePlant } from './flora';
import { paintNeedleClumps, paintPlant } from './flora-paint';
import { makeLayout, placeMainTree, placeRoots, placeTree, sproutScale, type Layout, type PlacedTree } from './layout';
import { paintLeaves, paintWood, TREE_FORMS, type LeafPalette, type WoodColors } from './plant';
import { cycleElapsed, CycleTransition, type CycleGeometry, type OldForest } from './cycle';
import { DayLayer, dayLevels, normalizeDayPhase, paintDaySky, tintCopy, tintInPlace, tintRgb, type DayFrame, type DayLevels } from './daylight';
import { MIDGROUND_MEADOW, MIDGROUND_WALL, midgroundPath, paintMidground } from './habitat-scenery';
import { warmCanvas, type IdleQueue } from './idle';
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
import { paintAlderBark, paintAlderCatkins, paintFirBark, paintFirCones, paintFirTiers, paintStiltRoots } from './species-fir-alder';
import { normalizeSeason, paintSnowCover, SeasonParticles, seasonLeaves, seasonLook, seasonWood, type SeasonFrame, type SeasonLook } from './season';
import { RESIZE_SETTLE_FRAMES, RESIZE_SETTLE_SECONDS, ResizeGate, seasonStepKey, settled, sizeKey } from './resize';
import { clampView, screenToScene, STRETCH_MAX_ZOOM, viewLeft, viewTop, type CameraView } from './camera';
import { bloomParticles, fireflySeason } from './phenology';
import { seedGlowAlpha, SeedGlow } from './seed-glow';
import { createClouds, drawClouds, paintGrass, paintSky, paintSoil, SKY, type Cloud } from './scenery';
import { paintSiteBackdrop, sceneSite, siteGround, type SceneSiteId } from './site-scenery';
import { jayElapsed, JayFlight } from './jay-flight';
import { clamp01, mix, mulberry32, smooth01 } from './util';
import { VisitorLayer, type SceneVisitor, type VisitorFrame } from './visitors';
import { ShearBands, windQuantum, windSkew } from './wind';
import {
  maxStormSkew,
  mixWeather,
  normalizeBlend,
  normalizeWeather,
  paintWeatherSky,
  releaseRimeScratch,
  rimeInPlace,
  stormSkew,
  WeatherLayer,
  type SceneWeatherId,
  type WeatherFrame,
  type WeatherLevels,
} from './weather';

export type { AnimalFamily, AnimalHit, SceneAnimal } from './animals';
export type { CameraView } from './camera';
export { nicheAnchors, SCENE_NICHES, type NicheAnchor, type SceneNiche } from './anchors';
export { SCENE_PLANT_GROUPS, type ScenePlant, type ScenePlantGroup } from './flora';
export { MAX_HARMONY_TIER } from './mood';
export { CYCLE_TRANSITION_LEAD, CYCLE_TRANSITION_REDUCED_SECONDS, CYCLE_TRANSITION_SECONDS } from './cycle';
export type { SceneVisitor } from './visitors';
export type { TreeSpecies } from './plant';
export { SCENE_WEATHERS, weatherParam, type SceneWeatherId } from './weather';
export { SCENE_SITES, siteParam, type SceneSiteId } from './site-scenery';
export { JAY_FLIGHT_REDUCED_SECONDS, JAY_FLIGHT_SECONDS } from './jay-flight';

export interface SceneInput {
  /** Kontinuierlicher Wachstumswert aus core/formulas.ts `growth()`. */
  growth: number;
  /** Laufzeit in Sekunden, für sanftes Wiegen im Wind und ziehende Wolken. */
  time: number;
  /** Tiere in den Nischen des Hauptbaums (Standard: keine). */
  animals?: readonly SceneAnimal[];
  /**
   * Waldtümpel (DESIGN_V2.md 5.5): Ist die Nische offen, liegt am linken Bildrand eine
   * kleine Senke mit Wasser im Erdschnitt (im Winter mit Eis). Ohne Angabe: kein Tümpel.
   */
  pond?: boolean;
  /**
   * Lebensräume (DESIGN_V2.md 23.8), jeweils sobald die Nische offen ist (Pflege oder
   * Ereignis); ohne Angabe: geschlossen. `meadow` (Waldwiese): helle Lichtung mit hohem
   * Gras und Blüten im Mittelgrund rechts hinter dem Baum; `wall` (Trockenmauer): niedrige
   * Lesesteinmauer im Mittelgrund links; beide in der gecachten Kulisse (neu nur beim
   * Öffnen). `deadwood` (Totholzhaufen): Reisighaufen mit morschem Stubben im Erdschnitt am
   * rechten Bildrand, Gegenstück zum Tümpel (im Winter mit Schnee). Die Bewohner (Nischen
   * 'meadow', 'wall', 'deadwood' in `animals`) stehen dort.
   */
  meadow?: boolean;
  deadwood?: boolean;
  wall?: boolean;
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
   * Anfänge“ … 4 = „Ursprüngliche Wildnis“). Gebrochene Werte sind erlaubt, ungültige gelten als „aus“.
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
   * Zapfen, immer grün), 'fir' (Weißtanne) oder 'alder' (Schwarzerle) – die beiden
   * letzten vorerst nur in der Demo, bis `MainTreeId` sie kennt (siehe `TREE_SPECIES` in
   * plant.ts). Gilt für alle Stufen vom Samen
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
  /**
   * Kamera (camera.ts): Zoom 1–4 und Mitte des Ausschnitts als Anteil der Szene. Wird
   * begrenzt, sodass nie Leerraum außerhalb der Szene sichtbar ist. Während sich die
   * Kamera bewegt, werden die Ebenen skaliert gezeigt; ruht sie ~150 ms vergrößert, wird
   * der Ausschnitt in voller Schärfe neu gezeichnet. Ohne Angabe oder bei 1×: ganze Szene
   * wie bisher.
   */
  camera?: Readonly<CameraView>;
  /**
   * Tageszeit als Tagesanteil 0–1 (DESIGN_V2.md 19): 0 Mitternacht, 0,25 Sonnenaufgang,
   * 0,5 Mittag, 0,75 Sonnenuntergang; Werte außerhalb modulo 1, ungültige wie ohne Angabe.
   * Am hellen Tag (etwa 0,27–0,73) und ohne Angabe sieht die Szene aus wie bisher. Dämmerung:
   * warmer Horizont und warmes Licht; Nacht: dunkelblauer Himmel mit Sternen und Mond,
   * gedämpfte Landschaft, Tiere bleiben hell, Glühwürmchen leuchten stärker. Sprünge (z. B.
   * Neuer Zyklus) gleiten in wenigen Sekunden über; bei `reducedMotion` ändert sich das
   * Bild nur in Stufen (DAY_BUCKETS je Tag) und ohne Funkeln.
   */
  dayPhase?: number;
  /**
   * Wetter des Tages (DESIGN_V2.md 21.8, IDs wie `WeatherId` in src/content/weather.ts):
   * 'mild' (wie ohne Angabe), 'rain', 'sun', 'fog', 'snow', 'drought', 'storm', 'frost'.
   * Unbekannte IDs gelten wie ohne Angabe. Das Wetter liegt über Jahreszeit und Nacht
   * (Regen nachts kaum sichtbar, Schnee hell); Bild siehe weather.ts.
   */
  weather?: SceneWeatherId;
  /** Wetter des Vortags, von dem aus übergeblendet wird (ohne Angabe: `weather`). */
  weatherPrevious?: SceneWeatherId;
  /**
   * Überblendung 0 (Vortag) … 1 (heute), z. B. `sceneWeather(cycle).blend` über
   * WEATHER_BLEND_SECONDS. Ohne Angabe 1; bei `reducedMotion` immer 1 (ohne Überblendung).
   */
  weatherBlend?: number;
  /**
   * Standort der Waldlandschaft (DESIGN_V2.md 24, IDs wie `SiteId` in
   * src/content/landscape.ts): 'home' (Heimatwald, wie ohne Angabe), 'floodplain' (Auwald am
   * Fluss), 'carr' (Erlenbruch), 'beechwood' (Buchenhallen), 'mountain' (Bergmischwald),
   * 'heath' (Kiefernheide). Bestimmt Horizont, Hintergrund-Bäume und Bodenfarben
   * (site-scenery.ts); gecacht in der Kulisse, neu nur beim Wechsel. Ein Wechsel blendet
   * die alte Kulisse sanft aus (SITE_FADE_SECONDS). Unbekannte IDs gelten wie ohne Angabe.
   */
  site?: string;
  /**
   * Häherflug beim Gründen eines Waldes (jay-flight.ts): ab `startedAt` (Sekunden, Takt wie
   * `time`) trägt ein Eichelhäher eine Eichel durchs Bild (JAY_FLIGHT_SECONDS); bei
   * `reducedMotion` erscheint er nur ruhig und blendet aus. Ein Start bis 1 s in der Zukunft
   * gilt als „jetzt“; danach und davor: nichts. Das Feld darf gesetzt bleiben.
   */
  jayFlight?: { startedAt: number };
  /**
   * Warteschlange für Arbeit in Leerlaufzeit (idle.ts). Mit Angabe entstehen nicht eilige
   * Neuaufbauten – neue Jahreszeit-Stufe, Tönung (Tag und Nacht, Wetter) und die scharfen
   * Detail-Ebenen beim Zoom – in Stücken zwischen den Frames; bis dahin bleibt der vorige,
   * vollständige Stand sichtbar. Der erste Aufbau und Größenänderungen bleiben synchron.
   * Ohne Angabe ist alles synchron wie bisher.
   */
  idle?: IdleQueue;
}

/** Überblendung der Kulisse bei einem Standortwechsel (s; bei weniger Bewegung kürzer). */
export const SITE_FADE_SECONDS = 1.6;
export const SITE_FADE_REDUCED_SECONDS = 0.8;

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
  /** Größe der Ebenen in Pixeln (Basis: Gerätepixel des Canvas). */
  pw: number;
  ph: number;
  /** Auflösung der Ebenen: Pixel je CSS-Pixel der Szene (Basis: Pixeldichte; Detail: × Zoom). */
  dpr: number;
  /**
   * Ursprung der Ebenen in der Szene: linke obere Ecke als Anteil der Szene (`oxN`, `oyN`)
   * und in CSS-Pixeln (`ox`, `oy`). Basis: 0 – die Ebenen zeigen die ganze Szene; die
   * Detail-Ebenen beim Zoom nur den sichtbaren Ausschnitt.
   */
  oxN: number;
  oyN: number;
  ox: number;
  oy: number;
  /** Breite und Höhe der ganzen Szene in Pixeln dieser Ebenen (Basis: `pw`, `ph`). */
  fullW: number;
  fullH: number;
  /** Zoom, für den die Ebenen gezeichnet sind (Basis 1). */
  zoom: number;
  /**
   * Ausschnitt, den die Ebenen garantiert abdecken (linke obere Ecke als Anteil der Szene,
   * Breite/Höhe 1/zoom). Detail-Ebenen sind waagerecht etwas breiter (Rand für den Wind).
   */
  covL: number;
  covT: number;
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
  /** Lebensräume im Mittelgrund, mit denen die Kulisse gezeichnet ist (Bits, habitat-scenery.ts). */
  habitats: number;
  /** Standort, mit dem die Kulisse gezeichnet ist (site-scenery.ts). */
  site: SceneSiteId;
  /** Art des Hauptbaums, mit der Ebenen und Erinnerungsbaum gezeichnet sind. */
  species: TreeSpecies;
  /** Radius des Samens (CSS-Pixel), beim Neuaufbau der Ebenen gemerkt (für den Schein). */
  seedR: number;
  /** Merkmale der zuletzt gezeichneten Pflanzenliste (je Ebenen-Satz). */
  plantSig: PlantSig[] | null;
  /** Pixeldichte der Basis (für Werte, die in Basis und Detail gleich sein müssen). */
  baseDpr: number;
  /** Schlüssel der Basis, zu der diese Ebenen gehören (Basis: der eigene). */
  baseKey: string;
  /** Krone des Hauptbaums für Gäste (CSS-Pixel: Mitte x, y, Radien) oder null. */
  crown: [number, number, number, number] | null;
  /**
   * Zählen das Neuzeichnen der Ebenen (Wachstum: Hintergrund mit Wurzeln, Baum-Ebenen), der
   * statischen Kulisse (Größe, Jahreszeit) und des Erinnerungsbaums – für die Tönung.
   */
  version: number;
  staticVersion: number;
  memoryVersion: number;
  /** Getönte Kopien für Tag und Nacht (null = keine). */
  tint: TintSet | null;
}

/**
 * Getönte Kopien der Ebenen eines Satzes (Tag und Nacht): Kulisse mit Himmel in voller
 * Größe, Baum-Ebenen und Erinnerungsbaum nur so groß wie ihr belegter Bereich.
 */
interface TintSet {
  /** Tönungsstufe und Versionen (Ebenen, Kulisse, Erinnerungsbaum), mit denen getönt wurde. */
  key: number;
  version: number;
  staticVersion: number;
  memoryVersion: number;
  /** Standort und Lebensräume der getönten Kulisse (weichen sie ab, wird synchron getönt). */
  site: SceneSiteId;
  habitats: number;
  background: HTMLCanvasElement;
  back: HTMLCanvasElement | null;
  front: HTMLCanvasElement | null;
  memory: HTMLCanvasElement | null;
  /**
   * Bereiche (Gerätepixel), aus denen die Kopien stammen – beim Tönen in Leerlaufzeit hat
   * der Satz evtl. schon neuere Bereiche; gezeigt wird jede Kopie an ihrem eigenen Platz.
   */
  backRect: Rect | null;
  frontRect: Rect | null;
  memoryRect: Rect | null;
  /** Wolken-Sprites (gleiche Reihenfolge wie `SizeCache.clouds`). */
  clouds: HTMLCanvasElement[];
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
  /**
   * Detail-Ebenen beim Zoom: nur der sichtbare Ausschnitt in voller Schärfe (null = keine).
   * Gebaut erst, wenn die Kamera ~150 ms ruht; bis dahin wird die Basis skaliert gezeigt.
   */
  detail: SizeCache | null;
  /** Kamera des letzten Frames und seit wann sie ruht (für den Neuaufbau der Detail-Ebenen). */
  camZoom: number;
  camX: number;
  camY: number;
  camSince: number;
  camFrames: number;
  /** Fallende Blätter und Schneeflocken. */
  seasonParticles: SeasonParticles;
  /** Jahreszeit dieses Frames (null = ohne Angabe). */
  look: SeasonLook | null;
  /** Ungerundete Jahreszeit dieses Frames (0–4, null = ohne Angabe) für Werte pro Frame. */
  season: number | null;
  /** Lichtschein am Samen (nur in der Stufe „Samen“). */
  seedGlow: SeedGlow;
  /** Tag und Nacht (Überblendung, Tönungsstufe, Sterne, Mond). */
  day: DayLayer;
  /** Stärken der Tageszeit in diesem Frame (null = heller Tag oder ohne Angabe). */
  dayNow: DayLevels | null;
  /** Wie oft getönt wurde (für Tests). */
  tintBuilds: number;
  /** Wetter (Überblendung, Partikel-Pools, Nebelbänder). */
  weather: WeatherLayer;
  /** Stärken des Wetters in diesem Frame (null = ohne Angabe oder mild). */
  weatherNow: WeatherLevels | null;
  /**
   * Gemeinsame Tönung aus Tageszeit und Wetter: Schlüssel (−1 = keine – Ebenen wie
   * gezeichnet), Lichtfarbe der Landschaft und der Wolken, Raureif an den Baum-Ebenen.
   * Neu berechnet nur bei neuem Schlüssel.
   */
  tintKey: number;
  tintFill: string;
  cloudFill: string;
  /** Lichtfarbe ist weiß (nur gebackener Himmel, z. B. Sonnenschein): Baum-Ebenen ohne Kopie. */
  tintWhite: boolean;
  rimeColor: string;
  rimeAlpha: number;
  /** Versatz des Raureifs in CSS-Pixeln (Dicke des Saums). */
  rimeOffset: number;
  /** Häherflug (Sprites nur während des Flugs) und Zeitpunkt darin (NaN = keiner). */
  jay: JayFlight;
  jayU: number;
  /**
   * Überblendung beim Standortwechsel: Kopie der alten Kulisse (wie gezeigt, samt Tönung),
   * Beginn, Frames mit stehender Zeit, Zeit des letzten Frames und der Ebenen-Satz, zu dem
   * sie passt. null = keine.
   */
  siteFade: HTMLCanvasElement | null;
  siteFadeAt: number;
  siteFadeFrames: number;
  siteFadeLast: number;
  siteFadeSet: SizeCache | null;
  /** Deckkraft der alten Kulisse in diesem Frame (0 = keine Überblendung). */
  siteFadeAlpha: number;
  /** Zuletzt gezeigter Standort (null = noch keiner) – nur ein echter Wechsel blendet über. */
  shownSite: SceneSiteId | null;
  /** Wie oft die Kulisse gezeichnet wurde (für Tests: kein Neuzeichnen pro Frame). */
  staticBuilds: number;
  /** Tönen in Leerlaufzeit (null = kein Auftrag) und Neuanfänge wegen neuer Tönungsstufe. */
  tintJob: TintJob | null;
  tintRestarts: number;
  /** Detail-Ebenen, die in Leerlaufzeit entstehen (gezeigt erst, wenn sie fertig sind). */
  detailNext: SizeCache | null;
  /** Ausschnitt, für den sie entstehen (null = kein Auftrag). */
  detailJob: CameraView | null;
  /** Neue Jahreszeit-Stufe wartet auf Leerlaufzeit. */
  seasonPending: boolean;
  /** Eingabe, Wachstum und Zeit des letzten Frames (für die Arbeit in Leerlaufzeit). */
  lastInput: SceneInput | null;
  lastG: number;
  lastTime: number;
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

/** Leere Tierliste (keine Allokation pro Frame). */
const NO_ANIMALS: readonly SceneAnimal[] = [];

/** Wiederverwendete Frame-Daten für die Tier-Ebene (keine Allokation pro Frame). */
const animalFrame: AnimalFrame = { time: 0, windSkew: 0, reducedMotion: false, dpr: 1, sx: 1, sy: 1 };
const seasonFrame: SeasonFrame = { width: 1, groundY: 1, top: 0, dpr: 1, sx: 1, sy: 1, time: 0, reducedMotion: false };
const dayFrame: DayFrame = { width: 1, height: 1, groundY: 1, dpr: 1, sx: 1, sy: 1, tx: 0, ty: 0, baseDpr: 1, time: 0, reducedMotion: false };
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

/** CSS-Bereich → ganzzahliger Pixel-Bereich innerhalb der Ebenen (Ursprung `ox`, `oy` in CSS-Pixeln). */
function toDeviceRect(r: Rect | null, dpr: number, pw: number, ph: number, ox = 0, oy = 0): Rect | null {
  if (!r) return null;
  const pad = 4;
  const x0 = Math.max(0, Math.floor((r.x - ox - pad) * dpr));
  const y0 = Math.max(0, Math.floor((r.y - oy - pad) * dpr));
  const x1 = Math.min(pw, Math.ceil((r.x - ox + r.w + pad) * dpr));
  const y1 = Math.min(ph, Math.ceil((r.y - oy + r.h + pad) * dpr));
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
  tx: number,
  ty: number,
  /** Ursprung der Quelle in Pixeln der Ebenen (getönte Kopie nur des Bereichs; sonst 0). */
  srcX = 0,
  srcY = 0,
): void {
  ctx.setTransform(sx, 0, 0, sy, tx, ty);
  const b = shearBands;
  const v = visible;
  const n = b.update(r.y, r.h, groundPx, k, quantum);
  for (let i = 0; i < n; i++) {
    let y = b.y[i]!;
    let h = b.h[i]!;
    const dx = b.dx[i]!;
    // Nur den sichtbaren Teil kopieren (gezoomt: skaliertes Kopieren kostet je Quellpixel).
    let x = r.x;
    let w = r.w;
    if (v.clip) {
      const y0 = Math.max(y, v.y0);
      const y1 = Math.min(y + h, v.y1);
      const x0 = Math.max(x, Math.floor(v.x0 - dx));
      const x1 = Math.min(x + w, Math.ceil(v.x1 - dx));
      if (y1 <= y0 || x1 <= x0) continue;
      y = y0;
      h = y1 - y0;
      x = x0;
      w = x1 - x0;
    }
    ctx.drawImage(layer, x - srcX, y - srcY, w, h, x + dx, y, w, h);
  }
}

/** Was an den getönten Kopien eines Satzes veraltet ist (null = nichts). */
interface TintPlan {
  key: number;
  keyChanged: boolean;
  /** Kulisse ganz neu (sonst nur der Streifen ab der Grasnarbe). */
  full: boolean;
  layers: boolean;
  memory: boolean;
  version: number;
  staticVersion: number;
  memoryVersion: number;
  /** Standort und Lebensräume der Kulisse, die getönt wird. */
  site: SceneSiteId;
  habitats: number;
  /**
   * Baum-Ebenen und Erinnerungsbaum kopieren (sonst bleiben sie, wie sie sind: weiße
   * Lichtfarbe ohne Raureif) – einmal je Auftrag festgelegt, damit alle Stücke gleich tönen.
   */
  copy: boolean;
}

function tintPlan(sc: SizeCache, cache: Cache): TintPlan | null {
  const t = sc.tint;
  const keyChanged = !t || t.key !== cache.tintKey;
  const full = keyChanged || t.staticVersion !== sc.staticVersion;
  const layers = full || t.version !== sc.version;
  const memory = full || t.memoryVersion !== sc.memoryVersion;
  if (!layers && !memory) return null;
  return {
    key: cache.tintKey,
    keyChanged,
    full,
    layers,
    memory,
    version: sc.version,
    staticVersion: sc.staticVersion,
    memoryVersion: sc.memoryVersion,
    site: sc.site,
    habitats: sc.habitats,
    copy: !cache.tintWhite || cache.rimeAlpha > 0,
  };
}

/** Getönte Kopien, in die ein Auftrag zeichnet (der Satz selbst oder neue, noch nicht gezeigte). */
interface TintCopies {
  /** Kulisse (null: Auftrag ohne neue Kulisse). */
  background: HTMLCanvasElement | null;
  back: HTMLCanvasElement | null;
  front: HTMLCanvasElement | null;
  memory: HTMLCanvasElement | null;
  backRect: Rect | null;
  frontRect: Rect | null;
  memoryRect: Rect | null;
}

/** Stücke der Tönung (je eines pro Leerlauf-Rückruf): Kulisse, hintere, vordere Ebene, Rest. */
const TINT_STAGES = 4;

/**
 * Tönt die Ebenen eines Satzes für die aktuelle Tönungsstufe (Tag und Nacht): Kulisse mit
 * Nacht- bzw. Dämmerungshimmel und Lichtfarbe, Baum-Ebenen und Erinnerungsbaum nur in der
 * Lichtfarbe. Neu nur bei neuer Stufe oder wenn die Ebenen neu gezeichnet wurden.
 */
function updateTint(sc: SizeCache, cache: Cache): void {
  const plan = tintPlan(sc, cache);
  if (!plan) return;
  // Ein laufender Auftrag für diesen Satz ist damit überholt (samt Kopien freigeben).
  if (cache.tintJob?.sc === sc) dropTintJob(cache);
  const set = sc.tint ?? newTintSet();
  sc.tint = set;
  for (let s = 0; s < TINT_STAGES; s++) tintStage(sc, cache, plan, s, set, false);
  finishTint(sc, cache, plan, set);
}

/**
 * Ein Stück der Tönung nach `plan` in die Kopien `out`: 0 Kulisse, 1 hintere Ebene,
 * 2 vordere Ebene, 3 Erinnerungsbaum. `warm`: das Ergebnis gleich rastern (Leerlaufzeit),
 * nicht erst beim Zusammensetzen. Ohne Änderung bleiben die Kopien in `out` unberührt.
 */
function tintStage(sc: SizeCache, cache: Cache, plan: TintPlan, stage: number, out: TintCopies, warm: boolean): void {
  if (stage === 0 && plan.layers) {
    // Kulisse: Kopie, Himmel der Stufe darüber, dann die Lichtfarbe. Hat sich nur das
    // Wachstum geändert (Wurzeln, Grasnarbe), genügt der Streifen ab der Grasnarbe.
    const day = cache.day;
    const bg = out.background!;
    const resized = bg.width !== sc.pw || bg.height !== sc.ph;
    if (resized) {
      bg.width = sc.pw;
      bg.height = sc.ph;
    }
    const y0 = plan.full || resized ? 0 : sc.grassTop;
    const h = sc.ph - y0;
    const c = bg.getContext('2d')!;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.beginPath();
    c.rect(0, y0, sc.pw, h);
    c.clip();
    c.globalCompositeOperation = 'copy';
    c.drawImage(sc.background, 0, y0, sc.pw, h, 0, y0, sc.pw, h);
    c.globalCompositeOperation = 'source-over';
    sceneTransform(c, sc);
    if (cache.dayNow) paintDaySky(c, day.tint, sc.layout.width, sc.layout.groundY);
    // Wetter über dem Himmel der Tageszeit (gebacken: Wolkendecke, Dunst, Strahlen, Boden).
    if (cache.weatherNow) {
      const { width, height, groundY } = sc.layout;
      const baked = cache.weather.baked;
      paintWeatherSky(c, baked, width, height, groundY, cache.dayNow ? day.tint.night : 0);
      // Nebel: Die Kuppe von Waldwiese und Trockenmauer liegt vor dem Dunst (Kontur bleibt).
      if (baked.fog > 0.005 && sc.habitats) restoreMidground(c, sc, baked.fog);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = cache.tintFill;
    c.fillRect(0, y0, sc.pw, h);
    c.restore();
    if (warm) warmCanvas(bg);
  } else if (stage === 1 && plan.layers) {
    // Weiße Lichtfarbe ohne Raureif: die Baum-Ebenen bleiben, wie sie sind (keine Kopie).
    out.back = plan.copy && sc.backRect ? tintLayer(sc.back, sc.backRect, out.back, cache, sc.dpr) : freeCanvas(out.back);
    out.backRect = out.back && sc.backRect ? { ...sc.backRect } : null;
    if (warm) warmCanvas(out.back);
  } else if (stage === 2 && plan.layers) {
    out.front = plan.copy && sc.frontRect ? tintLayer(sc.front, sc.frontRect, out.front, cache, sc.dpr) : freeCanvas(out.front);
    out.frontRect = out.front && sc.frontRect ? { ...sc.frontRect } : null;
    if (warm) warmCanvas(out.front);
  } else if (stage === 3 && plan.memory) {
    const mr = sc.memoryRect;
    out.memory = plan.copy && sc.memoryCanvas && mr ? tintLayer(sc.memoryCanvas, { x: 0, y: 0, w: mr.w, h: mr.h }, out.memory, cache, sc.dpr) : freeCanvas(out.memory);
    out.memoryRect = out.memory && mr ? { ...mr } : null;
    if (warm) warmCanvas(out.memory);
  }
}

/** Abschluss: Wolken (neue Stufe), Versionen und Schlüssel – erst dann gilt der Satz als aktuell. */
function finishTint(sc: SizeCache, cache: Cache, plan: TintPlan, set: TintSet): void {
  if (plan.keyChanged) {
    // Wolken dunkler als die Landschaft (Lichtfarbe zweimal), damit sie nicht leuchten.
    if (cache.tintWhite) {
      for (const c of set.clouds) freeCanvas(c);
      set.clouds.length = 0;
    } else {
      sc.clouds.forEach((cl, i) => {
        const r = { x: 0, y: 0, w: cl.sprite.width, h: cl.sprite.height };
        set.clouds[i] = tintCopy(cl.sprite, r, set.clouds[i] ?? null, cache.cloudFill);
      });
    }
  }
  if (plan.layers) {
    set.version = plan.version;
    set.staticVersion = plan.staticVersion;
    set.site = plan.site;
    set.habitats = plan.habitats;
  }
  if (plan.memory) set.memoryVersion = plan.memoryVersion;
  // Hilfs-Canvas des Raureifs nur während des Tönens behalten.
  releaseRimeScratch();
  set.key = plan.key;
  cache.tintBuilds++;
}

function newTintSet(): TintSet {
  return {
    key: -1,
    version: -1,
    staticVersion: -1,
    memoryVersion: -1,
    site: 'home',
    habitats: 0,
    background: document.createElement('canvas'),
    back: null,
    front: null,
    memory: null,
    backRect: null,
    frontRect: null,
    memoryRect: null,
    clouds: [],
  };
}

/** Laufender Auftrag zum Tönen in Leerlaufzeit. */
interface TintJob {
  sc: SizeCache;
  plan: TintPlan;
  stage: number;
  /** Neue Kopien, getauscht erst im letzten Stück (bis dahin zeigt der Satz die alten). */
  next: TintCopies;
}

/** So oft darf ein Auftrag wegen einer neuen Tönungsstufe neu beginnen, dann synchron. */
const TINT_RESTARTS = 3;

/**
 * Tönung in Leerlaufzeit nachführen statt im Frame – nur, wenn der Satz schon eine
 * vollständige Tönung in seiner Größe, mit seinem Standort und seinen Lebensräumen hat:
 * Die zeigt er weiter, bis alle neuen Kopien fertig sind und gemeinsam getauscht werden
 * (ein paar Frames alt, aber in sich stimmig). false: Es muss jetzt synchron getönt werden
 * (erste Tönung, Größe, Standortwechsel, neu geöffneter Lebensraum).
 */
function deferTint(sc: SizeCache, cache: Cache, idle: IdleQueue): boolean {
  const t = sc.tint;
  const job = cache.tintJob?.sc === sc ? cache.tintJob : null;
  if (!t || t.key < 0 || t.background.width !== sc.pw || t.background.height !== sc.ph || t.site !== sc.site || t.habitats !== sc.habitats) {
    if (job) dropTintJob(cache);
    return false;
  }
  if (job) {
    // Neue Tönungsstufe während des Auftrags: neu beginnen (die Stücke sollen gleich tönen) –
    // nach einigen Neuanfängen (rasch wechselnde Stufen) lieber einmal synchron.
    if (job.plan.key === cache.tintKey) return true;
    dropTintJob(cache);
    if (++cache.tintRestarts > TINT_RESTARTS) return false;
  } else {
    cache.tintRestarts = 0;
  }
  const plan = tintPlan(sc, cache);
  if (!plan) return true;
  const next: TintCopies = {
    // Neue Kulisse nur, wenn sich Kulisse bzw. Ebenen geändert haben (sonst nur Erinnerungsbaum).
    background: plan.layers ? document.createElement('canvas') : null,
    back: null,
    front: null,
    memory: null,
    backRect: null,
    frontRect: null,
    memoryRect: null,
  };
  // Nur der Streifen ab der Grasnarbe ist neu: den Rest der Kulisse aus der alten Kopie.
  if (next.background && !plan.full) copyCanvas(t.background, next.background);
  const j: TintJob = { sc, plan, stage: 0, next };
  // Ein Auftrag je Canvas: einen laufenden (z. B. der Basis vor dem Detail) samt Kopien freigeben.
  dropTintJob(cache);
  cache.tintJob = j;
  const step = (): void => {
    if (cache.tintJob !== j) return;
    // Satz verworfen oder Tönung aus: abbrechen (der nächste Frame plant neu).
    if (!liveSet(cache, sc) || cache.tintKey < 0 || sc.tint !== t) {
      dropTintJob(cache);
      return;
    }
    // Neue Tönungsstufe: nichts mehr in alter Farbe tönen – verwerfen, der nächste Frame
    // plant neu (auch wenn die Stufe bis dahin zurückwechselt).
    if (cache.tintKey !== plan.key) {
      dropTintJob(cache);
      return;
    }
    tintStage(sc, cache, plan, j.stage, j.next, true);
    j.stage++;
    if (j.stage < TINT_STAGES) {
      idle.schedule('tint', step);
      return;
    }
    // Letztes Stück: alle neuen Kopien gemeinsam tauschen.
    swapTint(t, plan, j.next);
    finishTint(sc, cache, plan, t);
    cache.tintJob = null;
  };
  idle.schedule('tint', step);
  return true;
}

/** Kopiert ein Canvas in ein anderes (gleiche Größe). */
function copyCanvas(src: HTMLCanvasElement, dst: HTMLCanvasElement): void {
  dst.width = src.width;
  dst.height = src.height;
  const c = dst.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'copy';
  c.drawImage(src, 0, 0);
  c.globalCompositeOperation = 'source-over';
}

/** Tauscht alle neuen Kopien eines Auftrags auf einmal ein und gibt die alten frei. */
function swapTint(set: TintSet, plan: TintPlan, next: TintCopies): void {
  if (plan.layers) {
    freeCanvas(set.background);
    set.background = next.background!;
    if (set.back !== next.back) freeCanvas(set.back);
    if (set.front !== next.front) freeCanvas(set.front);
    set.back = next.back;
    set.front = next.front;
    set.backRect = next.backRect;
    set.frontRect = next.frontRect;
  } else {
    freeCanvas(next.background);
  }
  if (plan.memory) {
    if (set.memory !== next.memory) freeCanvas(set.memory);
    set.memory = next.memory;
    set.memoryRect = next.memoryRect;
  }
}

/** Verwirft einen laufenden Tönungs-Auftrag samt seiner halbfertigen Kopien. */
function dropTintJob(cache: Cache): void {
  const j = cache.tintJob;
  if (!j) return;
  freeCanvas(j.next.background);
  freeCanvas(j.next.back);
  freeCanvas(j.next.front);
  freeCanvas(j.next.memory);
  cache.tintJob = null;
}

/** Gehört der Satz noch zu diesem Canvas (Basis, Detail oder wartendes Detail)? */
function liveSet(cache: Cache, sc: SizeCache): boolean {
  return cache.size === sc || cache.detail === sc || cache.detailNext === sc;
}

/** Wie klar die Kuppe im Nebel bleibt (Anteil der ungetrübten Kulisse, bei vollem Nebel). */
const MIDGROUND_FOG_CLEAR = 0.7;

/**
 * Nebel (gebacken): Die Kuppe von Waldwiese und Trockenmauer liegt im Mittelgrund vor dem
 * Dunst des Horizonts – sie wird aus der Kulisse ohne Dunst zurückgeholt und bleibt nur
 * leicht verschleiert. So behält sie bei Nebel (auch nachts) Kontur, und ihre Bewohner
 * stehen sichtbar auf Boden statt in der Luft.
 */
function restoreMidground(c: CanvasRenderingContext2D, sc: SizeCache, fog: number): void {
  c.save();
  sceneTransform(c, sc);
  midgroundPath(c, sc.layout, sc.habitats);
  c.clip();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = MIDGROUND_FOG_CLEAR * clamp01(fog);
  c.drawImage(sc.background, 0, 0);
  c.restore();
}

/** Getönte Kopie einer Baum-Ebene, bei Frost und Neuschnee mit Raureif bzw. Schneehäubchen. */
function tintLayer(src: HTMLCanvasElement, r: Rect, dst: HTMLCanvasElement | null, cache: Cache, dpr: number): HTMLCanvasElement {
  const out = tintCopy(src, r, dst, cache.tintFill);
  if (cache.rimeAlpha > 0) rimeInPlace(out, cache.rimeColor, cache.rimeAlpha, cache.rimeOffset * dpr);
  return out;
}

/** Wiederverwendete Farben für die gemeinsame Tönung (keine Allokation pro Frame). */
const dayRgb = [255, 255, 255];

/**
 * Gemeinsame Tönungsstufe aus Tageszeit und Wetter. Schlüssel aus beiden Stufen; Farben
 * und Strings entstehen nur, wenn er sich ändert. Lichtfarbe = Tag/Nacht × Wetter
 * (beides multiply); der Raureif wird mit derselben Lichtfarbe gedämpft (nachts nicht grell).
 */
function updateTintSpec(cache: Cache): void {
  const dayKey = cache.dayNow ? cache.day.tintKey : -1;
  const weatherKey = cache.weatherNow ? cache.weather.toneKey : -1;
  const key = dayKey < 0 && weatherKey < 0 ? -1 : (weatherKey + 1) * 4096 + (dayKey + 1);
  if (key === cache.tintKey) return;
  cache.tintKey = key;
  if (key < 0) return;
  if (dayKey >= 0) tintRgb(cache.day.tint, dayRgb);
  else dayRgb[0] = dayRgb[1] = dayRgb[2] = 255;
  const w = cache.weather.toneRgb;
  const lv = cache.weather.baked;
  const wActive = weatherKey >= 0;
  const r = Math.round((dayRgb[0]! * (wActive ? w[0]! : 255)) / 255);
  const g = Math.round((dayRgb[1]! * (wActive ? w[1]! : 255)) / 255);
  const b = Math.round((dayRgb[2]! * (wActive ? w[2]! : 255)) / 255);
  cache.tintFill = `rgb(${r}, ${g}, ${b})`;
  cache.cloudFill = `rgb(${Math.round((r * r) / 255)}, ${Math.round((g * g) / 255)}, ${Math.round((b * b) / 255)})`;
  cache.tintWhite = r === 255 && g === 255 && b === 255;
  // Raureif (Frost) und Schneehäubchen (Neuschnee) als heller Saum oben an Ästen und Laub.
  const frost = wActive ? lv.frost : 0;
  const snow = wActive ? lv.snow : 0;
  cache.rimeAlpha = Math.max(frost * 0.95, snow * 0.9);
  cache.rimeOffset = snow > frost ? 2.4 : 1.8;
  const base = snow > frost ? [252, 253, 255] : [238, 245, 253];
  cache.rimeColor = `rgb(${Math.round((base[0]! * r) / 255)}, ${Math.round((base[1]! * g) / 255)}, ${Math.round((base[2]! * b) / 255)})`;
}

/** Gibt ein Canvas frei (Safari: Größe 0) und liefert null. */
function freeCanvas(c: HTMLCanvasElement | null): null {
  if (c) {
    c.width = 0;
    c.height = 0;
  }
  return null;
}

/** Gibt die getönten Kopien eines Satzes frei (heller Tag, neuer Satz). */
function releaseTint(sc: SizeCache): void {
  const t = sc.tint;
  if (!t) return;
  freeCanvas(t.background);
  freeCanvas(t.back);
  freeCanvas(t.front);
  freeCanvas(t.memory);
  for (const c of t.clouds) freeCanvas(c);
  sc.tint = null;
}

/**
 * Sichtbarer Bereich in Pixeln der Ebenen (ganzzahlig, mit einem Pixel Rand) – nur gesetzt
 * (`clip`), wenn die Ebenen skaliert oder verschoben gezeigt werden. Ohne Kamera bleibt
 * jede Kopie wie bisher.
 */
const visible = { clip: false, x0: 0, y0: 0, x1: 0, y1: 0 };

/** Ein Cache je Canvas – so können mehrere Szenen nebeneinander laufen (z. B. Demo). */
const caches = new WeakMap<HTMLCanvasElement, Cache>();

/** Wiederverwendete Kamera dieses Frames (keine Allokation pro Frame). */
const camView: CameraView = { zoom: 1, x: 0.5, y: 0.5 };

/**
 * Abbildung der Ebenen auf das Canvas in diesem Frame: `sx`, `sy` Skalierung (Pixel der
 * Ebenen → Canvas-Pixel), `cx`, `cy` Verschiebung für Bitmaps der Ebenen (mit deren
 * Ursprung), `tx`, `ty` Verschiebung für alles, was in CSS-Pixeln der Szene × `dpr`
 * gezeichnet wird (Tiere, Wolken, Partikel …). Ohne Kamera und Größenänderung: 1, 1, 0 …
 */
interface Mapping {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
}
const mapping: Mapping = { sx: 1, sy: 1, cx: 0, cy: 0, tx: 0, ty: 0 };

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
      detail: null,
      camZoom: 1,
      camX: 0.5,
      camY: 0.5,
      camSince: 0,
      camFrames: 0,
      seedGlow: new SeedGlow(),
      day: new DayLayer(),
      dayNow: null,
      tintBuilds: 0,
      weather: new WeatherLayer(),
      weatherNow: null,
      tintKey: -1,
      tintFill: '',
      cloudFill: '',
      tintWhite: true,
      rimeColor: '',
      rimeAlpha: 0,
      rimeOffset: 0,
      jay: new JayFlight(),
      jayU: Number.NaN,
      siteFade: null,
      siteFadeAt: 0,
      siteFadeFrames: 0,
      siteFadeLast: 0,
      siteFadeSet: null,
      siteFadeAlpha: 0,
      shownSite: null,
      staticBuilds: 0,
      tintJob: null,
      tintRestarts: 0,
      detailNext: null,
      detailJob: null,
      seasonPending: false,
      lastInput: null,
      lastG: 0,
      lastTime: 0,
    };
    caches.set(ctx.canvas, cache);
  }

  // Tageszeit dieses Frames (vor den Ebenen: der alte Wald des Zyklus-Übergangs wird getönt).
  cache.dayNow = cache.day.update(input.dayPhase, time, input.reducedMotion === true);
  // Wetter dieses Frames und die gemeinsame Tönungsstufe (Tag/Nacht × Wetter).
  cache.weatherNow = cache.weather.update(input.weather, input.weatherPrevious, input.weatherBlend, time, input.reducedMotion === true);
  updateTintSpec(cache);

  // Jahreszeit dieses Frames (gemerkt je Rundung – keine Allokation pro Frame).
  const look = seasonLook(input.season);
  cache.look = look;
  cache.season = normalizeSeason(input.season);

  // Größenänderung entprellen: altes Bild skaliert zeigen, bis die Größe stabil ist –
  // außer der Aufrufer hat schon entprellt (`sizeSettled`).
  let base = cache.size;
  const key =
    base && base.pw === pw && base.ph === ph && base.layout.width === width && base.layout.height === height ? base.key : sizeKey(pw, ph, width, height);
  const builtKey = base ? base.key : null;
  const habitats = midgroundMask(input);
  const site = sceneSite(input.site);
  if (input.sizeSettled ? key !== builtKey : cache.gate.shouldRebuild(key, builtKey, input.time)) {
    // Kulisse gleich in der richtigen Jahreszeit (nicht zweimal malen).
    base = buildSizeCache(base, key, width, height, pw, ph, dpr, look, habitats, site);
    cache.size = base;
    cache.staticBuilds++;
  }
  base = base!;
  const idle = input.idle ?? null;
  cache.lastInput = input;
  cache.lastG = g;
  cache.lastTime = time;

  // Kamera: Ausschnitt begrenzt (nie Leerraum). Ruht sie ~150 ms vergrößert, werden die
  // Detail-Ebenen für genau diesen Ausschnitt scharf gezeichnet; bis dahin (während
  // einer Geste) wird die Basis bzw. der vorige Ausschnitt skaliert gezeigt.
  const cam = input.camera ? clampView(input.camera, STRETCH_MAX_ZOOM, camView) : null;
  const zoom = cam ? cam.zoom : 1;
  const camStill = cameraSettled(cache, cam, input.time);
  if (cam && zoom > 1 + 1e-6) {
    if (camStill && base.key === key) {
      // Zahlen vergleichen (kein String pro Frame); der Schlüssel entsteht nur beim Bau.
      const d = cache.detail;
      const left = viewLeft(cam);
      const top = viewTop(cam);
      if (!d || d.baseKey !== key || d.zoom !== zoom || d.covL !== left || d.covT !== top) {
        if (idle) {
          scheduleDetail(cache, base, cam, idle);
        } else {
          cache.detail = buildDetailCache(d, `${key}@${zoom}:${left},${top}`, base, cam, look, habitats, site);
          cache.staticBuilds++;
        }
      }
    }
  } else if (camStill && (cache.detail || cache.detailNext)) {
    if (cache.detail) releaseSizeCache(cache.detail);
    cache.detail = null;
    dropDetailNext(cache);
  }
  // Detail-Ebenen nur, solange sie den Ausschnitt ganz abdecken (sonst bliebe ein Rand leer).
  const detail = cache.detail;
  const sc = cam && detail && detail.layout.width === width && detail.layout.height === height && covers(detail, cam) ? detail : base;

  updateLayers(sc, base, cache, input, g, time, look, idle);
  cache.shownSite = sc.site;
  cache.siteFadeAlpha = stepSiteFade(cache, sc, time, input.reducedMotion === true);
  // Häherflug: Zeitpunkt im Flug (NaN = keiner); Sprites nur während des Flugs behalten.
  const jf = input.jayFlight;
  cache.jayU = jf ? jayElapsed(input.time, jf.startedAt, input.reducedMotion === true) : Number.NaN;
  if (Number.isNaN(cache.jayU) && cache.jay.prepared) cache.jay.release();
  // Tag und Nacht, Wetter: getönte Kopien nur bei neuer Stufe oder neu gezeichneten Ebenen.
  // Mit Leerlauf-Warteschlange tönt eine schon getönte Ebene in Stücken nach (deferTint).
  if (cache.tintKey >= 0) {
    if (!idle || !deferTint(sc, cache, idle)) updateTint(sc, cache);
  } else if (sc.tint) releaseTint(sc);

  // Sprites einer alten Tiergröße verwerfen. Die Auflösung gehört nicht dazu: Sprites je
  // Auflösungsstufe (Kamera) bleiben erhalten – ihr Schlüssel im SpriteCache enthält sie.
  const spriteKey = sc.anchors?.size ?? 0;
  if (cache.spriteKey !== spriteKey) {
    cache.animals.sprites.clear();
    cache.spriteKey = spriteKey;
  }

  // Ebenen → Canvas: Szene (Anteile) → Ausschnitt → Canvas-Pixel.
  const left = cam ? viewLeft(cam) : 0;
  const top = cam ? viewTop(cam) : 0;
  const m = mapping;
  m.sx = (zoom * pw) / sc.fullW;
  m.sy = (zoom * ph) / sc.fullH;
  m.cx = (sc.oxN - left) * zoom * pw;
  m.cy = (sc.oyN - top) * zoom * ph;
  m.tx = -left * zoom * pw;
  m.ty = -top * zoom * ph;
  compose(ctx, sc, cache, input, time, m);
}

/**
 * Zähler des Caches eines Canvas (für Tests: Kulisse nur bei Änderung neu, keine Arbeit pro
 * Frame) – null, wenn auf diesem Canvas noch nichts gezeichnet wurde.
 */
export function sceneCacheStats(
  canvas: HTMLCanvasElement,
): { staticBuilds: number; tintBuilds: number; siteFade: boolean; jaySpriteBuilds: number; jayPrepared: boolean } | null {
  const c = caches.get(canvas);
  return c
    ? { staticBuilds: c.staticBuilds, tintBuilds: c.tintBuilds, siteFade: c.siteFade !== null, jaySpriteBuilds: c.jay.builds, jayPrepared: c.jay.prepared }
    : null;
}

/** Ruht die Kamera (gleicher Ausschnitt seit ~150 ms bzw. einigen Frames bei stehender Zeit)? */
function cameraSettled(cache: Cache, cam: CameraView | null, rawTime: number): boolean {
  const z = cam ? cam.zoom : 1;
  const x = cam ? cam.x : 0.5;
  const y = cam ? cam.y : 0.5;
  const time = Number.isFinite(rawTime) ? rawTime : Number.NaN;
  if (z !== cache.camZoom || x !== cache.camX || y !== cache.camY) {
    cache.camZoom = z;
    cache.camX = x;
    cache.camY = y;
    cache.camSince = time;
    cache.camFrames = 0;
  }
  if (Number.isNaN(time) || Number.isNaN(cache.camSince)) {
    cache.camSince = time;
    return ++cache.camFrames > RESIZE_SETTLE_FRAMES;
  }
  return settled(time - cache.camSince, RESIZE_SETTLE_SECONDS, ++cache.camFrames, RESIZE_SETTLE_FRAMES);
}

/** Decken die Detail-Ebenen den Ausschnitt `cam` ganz ab? */
function covers(d: SizeCache, cam: CameraView): boolean {
  const eps = 1e-9;
  const l = viewLeft(cam);
  const t = viewTop(cam);
  const w = 1 / cam.zoom;
  const dw = 1 / d.zoom;
  return l >= d.covL - eps && t >= d.covT - eps && l + w <= d.covL + dw + eps && t + w <= d.covT + dw + eps;
}

/**
 * Detail-Ebenen für den Ausschnitt `cam`: so groß wie das Canvas, Auflösung = Pixeldichte
 * × Zoom – gezeichnet wird nur, was im Ausschnitt liegt. Gleiche Szene wie die Basis.
 */
function buildDetailCache(old: SizeCache | null, key: string, base: SizeCache, cam: CameraView, look: SeasonLook | null, habitats: number, site: SceneSiteId): SizeCache {
  const { width, height, groundY } = base.layout;
  const fullW = cam.zoom * base.pw;
  const fullH = cam.zoom * base.ph;
  const res = fullW / width;
  // Wind verschiebt die Baum-Ebenen waagerecht um bis zu |windSkew| (< 0,0145; bei Sturm
  // bis maxStormSkew) × Höhe über dem Boden: so breit ist der Rand links und rechts.
  const margin = Math.ceil(maxStormSkew(WIND_MAX_SKEW) * groundY * res) + 2;
  return buildSizeCache(old, key, width, height, base.pw + margin * 2, base.ph, res, look, habitats, site, {
    oxN: viewLeft(cam) - margin / fullW,
    oyN: viewTop(cam),
    fullW,
    fullH,
    zoom: cam.zoom,
    baseDpr: base.dpr,
    baseKey: base.key,
    covL: viewLeft(cam),
    covT: viewTop(cam),
  });
}

/** Größter Betrag von `windSkew` (Summe der Amplituden in wind.ts). */
const WIND_MAX_SKEW = 0.0145;

/** Gibt den Speicher eines Ebenen-Satzes frei (Safari: Größe auf 0 setzen). */
function releaseSizeCache(sc: SizeCache): void {
  releaseTint(sc);
  for (const c of [sc.scenery, sc.grass, sc.background, sc.back, sc.front, sc.plants, sc.memoryCanvas]) {
    if (c) {
      c.width = 0;
      c.height = 0;
    }
  }
  for (const cl of sc.clouds) freeCanvas(cl.sprite);
}

/**
 * Neue Jahreszeit-Stufe in Leerlaufzeit: Kulisse und Ebenen neu (wie sonst im Frame) und
 * gleich gerastert; die Tönung folgt danach in eigenen Stücken (deferTint).
 */
function scheduleSeason(sc: SizeCache, cache: Cache, idle: IdleQueue): void {
  if (cache.seasonPending) return;
  cache.seasonPending = true;
  idle.schedule('season', () => {
    cache.seasonPending = false;
    const input = cache.lastInput;
    const base = cache.size;
    if (!input || !base || !liveSet(cache, sc)) return;
    updateLayers(sc, base, cache, input, cache.lastG, cache.lastTime, seasonLook(input.season), null, false);
    if (cache.tintKey < 0) warmLayers(sc);
  });
}

/** Rastert die ungetönten Ebenen eines Satzes vorab (Leerlaufzeit). */
function warmLayers(sc: SizeCache): void {
  warmCanvas(sc.background);
  warmCanvas(sc.back);
  warmCanvas(sc.front);
  warmCanvas(sc.memoryCanvas);
}

/**
 * Detail-Ebenen für den ruhenden Ausschnitt `cam` in Leerlaufzeit: 1. Satz anlegen und
 * zeichnen, 2.–5. tönen (nur nachts bzw. bei Wetter; die Kopien werden je Stück gerastert),
 * zuletzt die ungetönten Ebenen rastern und den Satz gegen den gezeigten tauschen. Bis dahin bleibt die Basis
 * bzw. der vorige Ausschnitt skaliert sichtbar. Bewegt sich die Kamera oder ändert sich
 * die Größe, wird abgebrochen (der nächste ruhende Frame plant neu).
 */
function scheduleDetail(cache: Cache, base: SizeCache, cam: CameraView, idle: IdleQueue): void {
  const zoom = cam.zoom;
  const left = viewLeft(cam);
  const top = viewTop(cam);
  const n = cache.detailNext;
  if (n && n.baseKey === base.key && n.zoom === zoom && n.covL === left && n.covT === top) return;
  if (idle.has('detail') && cache.detailJob && sameView(cache.detailJob, cam)) return;
  dropDetailNext(cache);
  const job: CameraView = { zoom: cam.zoom, x: cam.x, y: cam.y };
  cache.detailJob = job;
  let stage = 0;
  let plan: TintPlan | null = null;
  const step = (): void => {
    if (cache.detailJob !== job) return;
    const input = cache.lastInput;
    const still = cache.camZoom === job.zoom && cache.camX === job.x && cache.camY === job.y;
    if (!input || cache.size !== base || !still) {
      cache.detailJob = null;
      dropDetailNext(cache);
      return;
    }
    if (stage === 0) {
      const look = seasonLook(input.season);
      // Den gezeigten Detail-Satz nicht überschreiben; einen verdeckten wiederverwenden.
      const old = cache.detail && !covers(cache.detail, job) ? cache.detail : null;
      if (old) cache.detail = null;
      const next = buildDetailCache(old, `${base.key}@${zoom}:${left},${top}`, base, job, look, midgroundMask(input), sceneSite(input.site));
      cache.staticBuilds++;
      cache.detailNext = next;
      updateLayers(next, base, cache, input, cache.lastG, cache.lastTime, look, null, false);
      if (cache.tintKey >= 0) plan = tintPlan(next, cache);
      stage = 1;
    } else if (stage <= TINT_STAGES && plan) {
      // Der neue Satz wird noch nicht gezeigt: Stück für Stück direkt in seine Tönung. Wechselt
      // die Tönungsstufe unterdessen, tönt der Frame nach dem Tausch nach (deferTint).
      const next = cache.detailNext!;
      const set = next.tint ?? newTintSet();
      next.tint = set;
      tintStage(next, cache, plan, stage - 1, set, true);
      if (stage === TINT_STAGES) finishTint(next, cache, plan, set);
      stage++;
    } else {
      const next = cache.detailNext!;
      if (cache.tintKey < 0) warmLayers(next);
      if (cache.detail && cache.detail !== next) releaseSizeCache(cache.detail);
      cache.detail = next;
      cache.detailNext = null;
      cache.detailJob = null;
      return;
    }
    if (stage > TINT_STAGES || !plan) stage = TINT_STAGES + 1;
    idle.schedule('detail', step);
  };
  idle.schedule('detail', step);
}

function sameView(a: CameraView, b: CameraView): boolean {
  return a.zoom === b.zoom && a.x === b.x && a.y === b.y;
}

/** Verwirft wartende Detail-Ebenen (Speicher sofort frei). */
function dropDetailNext(cache: Cache): void {
  if (cache.detailNext && cache.detailNext !== cache.detail) releaseSizeCache(cache.detailNext);
  cache.detailNext = null;
  cache.detailJob = null;
}

/**
 * Hält einen Ebenen-Satz aktuell: Jahreszeit, Art, Zyklus-Übergang, Erinnerungsbaum und
 * Wachstum. Nur der in diesem Frame gezeigte Satz wird nachgeführt; ein ruhender holt
 * beim nächsten Einsatz nach (sein Wachstum gilt dann sofort als fällig).
 */
function updateLayers(
  sc: SizeCache,
  base: SizeCache,
  cache: Cache,
  input: SceneInput,
  g: number,
  time: number,
  look: SeasonLook | null,
  idle: IdleQueue | null = null,
  /** false: Aufruf aus Leerlaufzeit – zählt nicht als Frame (Nachziehen nach Frames). */
  countFrame = true,
): void {
  // Jahreszeit (auf 0,05 gerundet): Kulisse und Grasnarbe neu, wenn sich die Rundung
  // ändert; Baum-Ebenen, Pflanzen und Erinnerungsbaum folgen unten.
  const seasonKey = seasonStepKey(look);
  let seasonChanged = seasonKey !== sc.seasonKey;
  // Ein Lebensraum im Mittelgrund öffnet (oder schließt, Neuer Zyklus): Kulisse neu.
  const habitats = midgroundMask(input);
  const habitatsChanged = habitats !== sc.habitats;
  // Standortwechsel (Waldlandschaft): Kulisse neu, die alte blendet sanft aus.
  const site = sceneSite(input.site);
  const siteChanged = site !== sc.site;
  // Nur eine neue Jahreszeit-Stufe (eine fertige Szene steht schon): in Leerlaufzeit.
  if (seasonChanged && idle && !habitatsChanged && !siteChanged && !Number.isNaN(sc.growth)) {
    scheduleSeason(sc, cache, idle);
    seasonChanged = false;
  }
  if (siteChanged && cache.shownSite !== null && cache.shownSite !== site) startSiteFade(sc, cache, time);
  if (seasonChanged || habitatsChanged || siteChanged) {
    paintStatic(sc, look, habitats, site);
    sc.seasonKey = seasonKey;
    sc.staticVersion++;
    cache.staticBuilds++;
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
    // Immer aus der Basis (ganze Szene): Ein Zoom während der Sequenz zeichnet den alten
    // Wald nicht neu; gezeichnet wird er in CSS-Pixeln und passt so zu jeder Ebene.
    // Der Schlüssel entsteht nur, solange die Sequenz läuft (~5,5 s).
    const cycleKey = `${ct.startedAt}|${fromGrowth}|${base.key}|${fromTree}|${species}`;
    if (!cache.cycle.prepared || cache.cycle.key !== cycleKey || !samePlants(cache.cyclePlants, ct.fromPlants)) {
      cache.cyclePlants = ct.fromPlants ? ct.fromPlants.map(plantSig) : null;
      const old = paintOldForest(base, fromGrowth, ct.fromPlants, look, fromTree);
      // Nachts der alte Wald in der Lichtfarbe beim Start (bleibt für den Übergang so).
      if (old && cache.tintKey >= 0 && !cache.tintWhite) tintInPlace(old.canvas, cache.tintFill);
      cache.cycle.prepare(cycleKey, cycleGeometry(base), old, species);
    }
  }

  // Erinnerungsbaum: eigenes Canvas, neu nur bei Größenänderung oder neuem Wachstum.
  const memory = memoryGrowth(input.forestMemory);
  if (memory !== sc.memory || seasonChanged || speciesChanged) renderMemory(sc, memory, look, species);

  const delta = Math.abs(g - sc.growth);
  const since = time - sc.drawnAt;
  const frames = countFrame ? ++sc.framesSinceDraw : sc.framesSinceDraw;
  const clockReset = since < 0;
  const due =
    (delta >= REDRAW_STEP && (since >= REDRAW_MIN_INTERVAL || frames >= REDRAW_MIN_FRAMES)) ||
    (delta > 0 && (since > REDRAW_SETTLE_SECONDS || frames >= REDRAW_SETTLE_FRAMES));
  // Neue Pflanzenliste: alles neu (Nachbarbäume, Pilzfäden und Pflanzen hängen davon ab).
  const plantsChanged = !samePlants(sc.plantSig, input.plants);
  if (
    Number.isNaN(sc.growth) ||
    clockReset ||
    due ||
    plantsChanged ||
    seasonChanged ||
    // Neue Kulisse: der Hintergrund (Kopie der Kulisse samt Wurzeln) muss nachziehen.
    habitatsChanged ||
    siteChanged ||
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
    if (redrawPlants) sc.plantSig = input.plants ? input.plants.map(plantSig) : null;
    renderLayers(sc, g, input.plants, redrawPlants, look, species);
    sc.growth = g;
    sc.drawnAt = time;
    sc.framesSinceDraw = 0;
  }
}

/** Setzt die gecachten Ebenen zusammen – nur drawImage und günstige Transformationen. */
function compose(ctx: CanvasRenderingContext2D, sc: SizeCache, cache: Cache, input: SceneInput, time: number, m: Mapping): void {
  const { dpr, layout } = sc;
  const { sx, sy } = m;
  const reduced = input.reducedMotion === true;
  const layer = cache.animals;
  // Auflösung der Sprites: Basis × 1, 2 oder 4 (je Stufe gecacht, nicht je Zoomwert).
  const spriteDpr = sc.zoom <= 1 ? dpr : sc.baseDpr * (sc.zoom <= 2 ? 2 : 4);
  // Tag und Nacht: getönte Kopien der Ebenen (gleiche Lage, Baum-Ebenen nur ihr Bereich).
  const day = cache.dayNow;
  const wx = cache.weatherNow;
  const tint = cache.tintKey >= 0 ? sc.tint : null;
  const bg = tint ? tint.background : sc.background;
  ctx.save();
  ctx.setTransform(sx, 0, 0, sy, m.cx, m.cy);
  const v = visible;
  v.clip = m.sx > 1 || m.sy > 1;
  if (v.clip) {
    v.x0 = Math.max(0, Math.floor(-m.cx / sx) - 1);
    v.y0 = Math.max(0, Math.floor(-m.cy / sy) - 1);
    v.x1 = Math.min(sc.pw, Math.ceil((ctx.canvas.width - m.cx) / sx) + 1);
    v.y1 = Math.min(sc.ph, Math.ceil((ctx.canvas.height - m.cy) / sy) + 1);
    if (v.x1 > v.x0 && v.y1 > v.y0) ctx.drawImage(bg, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
  } else {
    ctx.drawImage(bg, 0, 0);
    // Dürre: leises Hitzeflimmern am Horizont – vier Streifen der Kulisse, minimal verschoben.
    if (wx && wx.drought > 0.05 && !reduced) heatShimmer(ctx, bg, sc, wx.drought, time);
  }
  // Standortwechsel: die alte Kulisse blendet über der neuen aus.
  const fadeBg = cache.siteFade;
  if (fadeBg && cache.siteFadeAlpha > 0) {
    ctx.globalAlpha = cache.siteFadeAlpha;
    if (v.clip) {
      if (v.x1 > v.x0 && v.y1 > v.y0) ctx.drawImage(fadeBg, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    } else {
      ctx.drawImage(fadeBg, 0, 0);
    }
    ctx.globalAlpha = 1;
  }
  // Tag und Nacht: Sterne und Mond direkt über der (getönten) Kulisse.
  if (day) {
    const df = dayFrame;
    df.width = layout.width;
    df.height = layout.height;
    df.groundY = layout.groundY;
    df.dpr = dpr;
    df.sx = sx;
    df.sy = sy;
    df.tx = m.tx;
    df.ty = m.ty;
    df.baseDpr = sc.baseDpr;
    df.time = time;
    df.reducedMotion = reduced;
    // Wolkendecke, Nebel und Schneefall verdecken Sterne und Mond.
    cache.day.drawLights(ctx, day, df, wx ? clamp01(1 - wx.overcast - 0.8 * wx.fog - 0.5 * wx.snow) : 1);
    ctx.setTransform(sx, 0, 0, sy, m.cx, m.cy);
  }
  // Spielbeginn: warmer, sanft pulsierender Schein am Samen (bis zum Keimling).
  // Beim Neuen Zyklus erst nach dem Aufleuchten aus cycle.ts (siehe seedGlowCycleFade).
  const glow = seedGlowAlpha(sc.growth, time, reduced, cache.cycleU);
  if (glow > 0) {
    // Lage wie in `paintUnderground` (keine Allokation pro Frame).
    cache.seedGlow.draw(ctx, layout.cx, layout.groundY + layout.soilH * 0.14, sc.seedR * 5, glow, dpr, sx, sy, m.tx, m.ty, spriteDpr);
    ctx.setTransform(sx, 0, 0, sy, m.cx, m.cy);
  }
  if (sc.memoryCanvas && sc.memoryRect) {
    // Getönte Kopie an ihrem eigenen Platz (beim Tönen in Leerlaufzeit evtl. ein Stand älter).
    const tm = tint?.memory && tint.memoryRect ? tint.memory : null;
    const r = tm ? tint!.memoryRect! : sc.memoryRect;
    ctx.drawImage(tm ?? sc.memoryCanvas, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
  }
  // Wolken liegen in Szenen-Pixeln × dpr (ohne Ursprung der Ebenen).
  ctx.setTransform(sx, 0, 0, sy, m.tx, m.ty);
  // Nachts treten die Wolken zurück (sie würden sonst über dem dunklen Himmel leuchten).
  const cloudAlpha = day ? 0.9 * (1 - 0.35 * day.night) : 0.9;
  const cloudSprites = tint && tint.clouds.length > 0 ? tint.clouds : null;
  if (wx) {
    // Sonne: kaum Wolken; Wolkendecke: zweite, versetzte Lage dichter Wolken; Sturm: schneller.
    const ct = reduced ? 0 : cache.weather.cloudTime(time);
    drawClouds(ctx, sc.clouds, layout.width, ct, dpr, cloudAlpha * (1 - 0.8 * wx.sun) * (1 + 0.1 * wx.overcast), cloudSprites);
    if (wx.overcast > 0.05) drawClouds(ctx, sc.clouds, layout.width, ct * 1.3 + 917, dpr, cloudAlpha * 0.85 * wx.overcast, cloudSprites);
  } else {
    // Auch ohne Wetter mit dem Vorsprung aus einem Sturm (sonst sprängen die Wolken zurück).
    drawClouds(ctx, sc.clouds, layout.width, reduced ? 0 : cache.weather.cloudTime(time), dpr, cloudAlpha, cloudSprites);
  }

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
    mf.tx = m.tx;
    mf.ty = m.ty;
    mf.spriteDpr = spriteDpr;
    mf.time = time;
    mf.reducedMotion = reduced;
    // Ungerundete Jahreszeit: stufenlos, ohne Sprünge bei jeder Rundungsstufe.
    mf.bloom = bloomParticles(cache.season);
    // Regen löscht den Schein der Glühwürmchen; Schnee, Nebel und Wolken dämpfen die Sonne.
    mf.fireflies = fireflySeason(cache.season) * (wx ? 1 - clamp01(wx.rain + wx.snow) : 1);
    mf.sun = wx ? (day ? day.sun : 1) * clamp01(1 - 0.7 * wx.overcast - 0.5 * wx.fog) : day ? day.sun : undefined;
    mf.night = day ? day.night : undefined;
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
    vf.tx = m.tx;
    vf.ty = m.ty;
    vf.spriteDpr = spriteDpr;
    vf.time = time;
    vf.reducedMotion = reduced;
    vf.windSkew = 0;
    // Belegte Waldsaum-Plätze (gemerkt, nur bei geänderten Plätzen neu) und die Krone.
    vf.blocked = cache.visitors.updateBlocked(input.animals, sc.anchors);
    vf.crownTaken = cache.visitors.crownTaken;
    vf.anchors = sc.anchors;
    const cr = sc.crown;
    if (cr && sc.growth >= CROWN_GROWTH) {
      vf.crownX = cr[0];
      vf.crownY = cr[1];
      vf.crownRx = cr[2];
      vf.crownRy = cr[3];
    } else {
      vf.crownRx = 0;
    }
    // Einmal pro Frame: Sprite-Cache weiterzählen (sky, meadow, front folgen).
    cache.visitors.beginFrame(vf.size, dpr);
    cache.visitors.draw(ctx, visitors, 'sky', vf);
  }

  const groundPx = (layout.groundY - sc.oy) * dpr;
  const quantum = windQuantum(dpr);
  const k = reduced ? 0 : stormSkew(windSkew(time, 0), time, wx ? wx.storm : 0);
  const animals = input.animals ?? NO_ANIMALS;
  const pond = input.pond === true;
  const pile = input.deadwood === true;
  const withAnimals = (animals.length > 0 || pond || pile) && sc.anchors !== null;
  const f = animalFrame;
  if (withAnimals) {
    f.time = time;
    f.windSkew = k;
    f.reducedMotion = reduced;
    f.season = cache.season;
    f.night = day ? day.night : 0;
    // Nachtarten (nocturnal.ts): nur mit Tageszeit-Angabe – sonst Verhalten wie bisher.
    f.nocturnal = Number.isNaN(cache.day.phase) ? undefined : day ? clamp01(day.night + 0.5 * day.twilight) : 0;
    f.rain = wx ? wx.rain : 0;
    f.dpr = dpr;
    f.sx = sx;
    f.sy = sy;
    f.tx = m.tx;
    f.ty = m.ty;
    f.spriteDpr = spriteDpr;
  }
  // Bewohner von Waldwiese und Trockenmauer: im Mittelgrund wie ihre Kuppe – hinter
  // Nachbarbäumen, Begleitpflanzen, Wildschweinen und dem Hauptbaum.
  if (withAnimals) layer.drawMidground(ctx, animals, sc.anchors!, f);
  if (sc.backRect) {
    const kb = reduced ? 0 : stormSkew(windSkew(time, 1.9) * 0.7, time + 0.4, wx ? wx.storm : 0);
    const tr = tint?.back ? tint.backRect : null;
    if (tr) drawSheared(ctx, tint!.back!, tr, kb, groundPx, quantum, sx, sy, m.cx, m.cy, tr.x, tr.y);
    else drawSheared(ctx, sc.back, sc.backRect, kb, groundPx, quantum, sx, sy, m.cx, m.cy);
  }
  // Wildschweine auf der Wiese: vor den Begleitpflanzen, hinter dem Hauptbaum.
  if (visitors) cache.visitors.draw(ctx, visitors, 'meadow', vf);
  if (sc.frontRect) {
    const tr = tint?.front ? tint.frontRect : null;
    if (tr) drawSheared(ctx, tint!.front!, tr, k, groundPx, quantum, sx, sy, m.cx, m.cy, tr.x, tr.y);
    else drawSheared(ctx, sc.front, sc.frontRect, k, groundPx, quantum, sx, sy, m.cx, m.cy);
  }
  if (visitors) {
    vf.windSkew = k;
    cache.visitors.draw(ctx, visitors, 'front', vf);
  }
  // Wetter: Nebelbänder über den Bäumen, hinter den Tieren.
  const wf = weatherFrame;
  if (wx) {
    wf.width = layout.width;
    wf.height = layout.height;
    wf.groundY = layout.groundY;
    wf.top = layout.top;
    wf.dpr = dpr;
    wf.sx = sx;
    wf.sy = sy;
    wf.tx = m.tx;
    wf.ty = m.ty;
    wf.time = time;
    wf.reducedMotion = reduced;
    wf.night = day ? day.night : 0;
    wf.crown = sc.crown && sc.growth >= CROWN_GROWTH ? sc.crown : null;
    cache.weather.drawGround(ctx, wx, wf);
  }
  if (withAnimals) layer.draw(ctx, animals, sc.anchors!, f, pond, pile);
  // Fallende Blätter und Schnee (nur außerhalb des Sommers).
  if (cache.look && !cache.look.summer) {
    const sf = seasonFrame;
    sf.width = layout.width;
    sf.groundY = layout.groundY;
    sf.top = layout.top;
    sf.dpr = dpr;
    sf.sx = sx;
    sf.sy = sy;
    sf.tx = m.tx;
    sf.ty = m.ty;
    sf.time = time;
    sf.reducedMotion = reduced;
    cache.seasonParticles.draw(ctx, cache.look, sf);
  }
  // Wetter: Raureif-Glitzern, Sturmblätter, Schnee und Regen – über allem außer
  // Stimmungslicht und Zyklus-Übergang.
  if (wx) cache.weather.draw(ctx, wx, wf);
  if (level !== null) {
    cache.mood.drawLight(ctx, level, mf);
    cache.mood.drawParticles(ctx, level, mf);
  }
  // Übergang zum Neuen Zyklus ganz oben (außerhalb des Zeitfensters: nichts).
  if (!Number.isNaN(cache.cycleU) && cache.cycle.prepared) {
    cache.cycle.draw(ctx, cache.cycleU, reduced, cycleGeometry(sc), sx, sy, m.tx, m.ty);
  }
  // Häherflug beim Gründen eines Waldes ganz oben (über dem verblassenden alten Wald).
  if (!Number.isNaN(cache.jayU)) {
    const unit = (sc.anchors?.size ?? animalSize(layout.width, layout.height)) * 2.4;
    cache.jay.draw(ctx, cache.jayU, reduced, layout.width, layout.groundY, unit, dpr, spriteDpr, sx, sy, m.tx, m.ty);
  }
  ctx.restore();
}

/**
 * Deckkraft der alten Kulisse beim Standortwechsel nach `elapsed` Sekunden bzw. `frames`
 * Frames mit stehender Zeit (Pause, feste Demo-Zeit – nur diese werden gezählt, sonst
 * ist die Überblendung rein zeitbasiert, unabhängig von der Bildrate): sanft von 1 auf 0 –
 * bei weniger Bewegung schneller.
 */
export function siteFadeAlpha(elapsed: number, frames: number, reducedMotion: boolean): number {
  const d = reducedMotion ? SITE_FADE_REDUCED_SECONDS : SITE_FADE_SECONDS;
  const byTime = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed / d : 0;
  const u = Math.max(byTime, frames / (d * 60));
  return u >= 1 ? 0 : 1 - smooth01(u);
}

/** Merkt die gezeigte Kulisse (samt Tönung) für die Überblendung beim Standortwechsel. */
function startSiteFade(sc: SizeCache, cache: Cache, time: number): void {
  // Ohne gezeichneten Hintergrund (frischer Satz) gibt es nichts zu überblenden.
  if (Number.isNaN(sc.growth)) return;
  const src = cache.tintKey >= 0 && sc.tint ? sc.tint.background : sc.background;
  const c = cache.siteFade ?? document.createElement('canvas');
  if (c.width !== sc.pw || c.height !== sc.ph) {
    c.width = sc.pw;
    c.height = sc.ph;
  }
  const x = c.getContext('2d')!;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'copy';
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-over';
  cache.siteFade = c;
  cache.siteFadeAt = time;
  cache.siteFadeFrames = 0;
  cache.siteFadeLast = time;
  cache.siteFadeSet = sc;
}

/**
 * Schritt der Überblendung: Deckkraft dieses Frames; danach freigeben. Frames zählen nur,
 * solange die Zeit steht (oder zurückspringt) – bei laufender Zeit gilt allein die Zeit.
 * Wechselt der gezeigte Ebenen-Satz während der Überblendung (Zoom: Basis ↔ Detail), endet
 * sie sofort: Die Kopie passt nur zu Größe und Ausschnitt ihres Satzes, und ein Zoom in
 * den ~1,6 s nach einem Neuen Zyklus ist selten – eine Kopie je Satz lohnt den Speicher nicht.
 */
function stepSiteFade(cache: Cache, sc: SizeCache, time: number, reduced: boolean): number {
  if (!cache.siteFade) return 0;
  if (!(time > cache.siteFadeLast)) cache.siteFadeFrames++;
  cache.siteFadeLast = time;
  const a = cache.siteFadeSet === sc ? siteFadeAlpha(time - cache.siteFadeAt, cache.siteFadeFrames, reduced) : 0;
  if (a <= 0) {
    cache.siteFade = freeCanvas(cache.siteFade);
    cache.siteFadeSet = null;
  }
  return a;
}

/** Wiederverwendete Frame-Daten für das Wetter (keine Allokation pro Frame). */
const weatherFrame: WeatherFrame = { width: 1, height: 1, groundY: 1, top: 0, dpr: 1, sx: 1, sy: 1, tx: 0, ty: 0, time: 0, reducedMotion: false, night: 0, crown: null };

/**
 * Hitzeflimmern (Dürre): vier schmale Streifen der Kulisse über dem Horizont, jeweils um
 * Bruchteile eines Pixels verschoben – nur drawImage, ohne Kamera-Zoom.
 */
function heatShimmer(ctx: CanvasRenderingContext2D, bg: HTMLCanvasElement, sc: SizeCache, drought: number, time: number): void {
  const { layout, dpr } = sc;
  const strip = Math.max(2, Math.round(layout.height * 0.022 * dpr));
  const bottom = Math.round((layout.groundY - sc.oy) * dpr) - Math.round(layout.height * 0.02 * dpr);
  ctx.globalAlpha = 0.7 * clamp01(drought);
  for (let i = 0; i < 4; i++) {
    const y = bottom - (i + 1) * strip;
    if (y < 0) break;
    const dx = Math.sin(time * 2.3 + i * 1.9) * 0.7 * dpr;
    ctx.drawImage(bg, 0, y, sc.pw, strip, dx, y, sc.pw, strip);
  }
  ctx.globalAlpha = 1;
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
  sc.memoryVersion++;
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
  const r = toDeviceRect(unionRect(null, ...treeBounds(tree)), dpr, sc.pw, sc.ph, sc.ox, sc.oy);
  if (!r) return;
  const canvas = sc.memoryCanvas ?? document.createElement('canvas');
  canvas.width = r.w;
  canvas.height = r.h;
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, -r.x - sc.ox * dpr, -r.y - sc.oy * dpr);
  if (species === 'oak') {
    paintTree(c, tree, hazeWood(seasonWood(WOOD, look), 0.7), hazePalette(seasonLeaves(PALETTES[2]!, look), 0.7), look ? look.leaves : 1);
  } else {
    paintSpeciesTree(c, tree, species, hazeWood(seasonWood(speciesWood(species, WOOD, WOOD, 1), look), 0.7), hazePalette(speciesLeaves(species, PALETTES[2]!, look), 0.7), speciesLeafAmount(species, look), 0, look);
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
  const r = toDeviceRect(rect, dpr, sc.pw, sc.ph, sc.ox, sc.oy);
  if (!r) return null;
  const canvas = document.createElement('canvas');
  canvas.width = r.w;
  canvas.height = r.h;
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, -r.x - sc.ox * dpr, -r.y - sc.oy * dpr);
  const leaves = look ? look.leaves : 1;
  for (const n of trees) paintTree(c, n.tree, hazeWood(seasonWood(WOOD, look), n.haze), hazePalette(seasonLeaves(n.palette, look), n.haze), leaves);
  for (const p of flora) paintPlant(c, p, look);
  if (main) paintMainTree(c, main, g, species, look);
  return {
    canvas,
    rect: { x: r.x / dpr + sc.ox, y: r.y / dpr + sc.oy, w: r.w / dpr, h: r.h / dpr },
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
  /** Lebensräume im Mittelgrund (Bits, `midgroundMask`). */
  habitats: number,
  /** Standort der Waldlandschaft (Kulisse). */
  site: SceneSiteId,
  /** Detail-Ebenen: Ausschnitt (Anteile), Größe der ganzen Szene in Pixeln, Zoom. */
  view?: { oxN: number; oyN: number; fullW: number; fullH: number; zoom: number; baseDpr: number; baseKey: string; covL: number; covT: number },
): SizeCache {
  // Getönte Kopien des alten Satzes passen nicht mehr (neue Größe bzw. neuer Ausschnitt).
  if (old) {
    releaseTint(old);
    // Die Wolken entstehen neu (Größe der Szene): die alten Sprites freigeben.
    for (const cl of old.clouds) freeCanvas(cl.sprite);
  }
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
    oxN: view?.oxN ?? 0,
    oyN: view?.oyN ?? 0,
    ox: (view?.oxN ?? 0) * width,
    oy: (view?.oyN ?? 0) * height,
    fullW: view?.fullW ?? pw,
    fullH: view?.fullH ?? ph,
    zoom: view?.zoom ?? 1,
    covL: view?.covL ?? 0,
    covT: view?.covT ?? 0,
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
    habitats,
    site,
    species: 'oak',
    seedR: 4,
    plantSig: null,
    baseDpr: view?.baseDpr ?? dpr,
    baseKey: view?.baseKey ?? key,
    crown: null,
    version: 0,
    staticVersion: 0,
    memoryVersion: 0,
    tint: null,
  };

  paintStatic(sc, look, habitats, site);
  sc.seasonKey = seasonStepKey(look);
  return sc;
}

/** Bits der offenen Lebensräume im Mittelgrund (Waldwiese, Trockenmauer). */
function midgroundMask(input: SceneInput): number {
  return (input.meadow === true ? MIDGROUND_MEADOW : 0) | (input.wall === true ? MIDGROUND_WALL : 0);
}

/**
 * Statische Kulisse (Himmel, Horizont des Standorts, Lebensräume im Mittelgrund, Erde) und
 * Grasnarbe – je Größe, Jahreszeit, offenen Lebensräumen und Standort.
 */
function paintStatic(sc: SizeCache, look: SeasonLook | null, habitats: number, site: SceneSiteId): void {
  const { layout, dpr, pw, ph } = sc;
  const { width, height } = layout;
  // Heimatwald: Farben wie bisher (null), sonst die des Standorts.
  const ground = site === 'home' ? null : siteGround(site);
  const sky = layerContext(sc.scenery, sc);
  paintSky(sky, width, layout.groundY, look);
  paintSiteBackdrop(sky, layout, site, look);
  paintMidground(sky, layout, habitats, look);
  sc.habitats = habitats;
  sc.site = site;
  paintSoil(sky, width, height, layout.groundY, ground ? ground.soil : null);

  // Grasnarbe nur als Streifen um die Bodenlinie (Halme reichen bis 1,2 × bladeH hinauf).
  const above = Math.max(4, height * 0.016) * 1.2 + 2;
  const below = Math.max(4, height * 0.014) + 2;
  sc.grassTop = Math.min(ph, Math.max(0, Math.floor((layout.groundY - above - sc.oy) * dpr)));
  sc.grass.width = pw;
  sc.grass.height = Math.max(1, Math.min(ph, Math.ceil((layout.groundY + below - sc.oy) * dpr)) - sc.grassTop);
  const gc = sc.grass.getContext('2d')!;
  gc.setTransform(1, 0, 0, 1, 0, 0);
  gc.clearRect(0, 0, sc.grass.width, sc.grass.height);
  gc.setTransform(dpr, 0, 0, dpr, -sc.ox * dpr, -sc.oy * dpr - sc.grassTop);
  paintGrass(gc, width, height, layout.groundY, look, ground ? ground.grass : null);
}

/** Leert eine Ebene und setzt die Transformation CSS-Pixel der Szene → Pixel der Ebene. */
function layerContext(canvas: HTMLCanvasElement, sc: SizeCache): CanvasRenderingContext2D {
  const c = canvas.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  sceneTransform(c, sc);
  return c;
}

/** Transformation CSS-Pixel der Szene → Pixel der Ebenen (mit deren Ursprung). */
function sceneTransform(c: CanvasRenderingContext2D, sc: SizeCache): void {
  c.setTransform(sc.dpr, 0, 0, sc.dpr, -sc.ox * sc.dpr, -sc.oy * sc.dpr);
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
  paintSpeciesTree(ctx, main, species, seasonWood(speciesWood(species, STEM, WOOD, lignin), look), speciesLeaves(species, PALETTES[0]!, look), speciesLeafAmount(species, look), g, look);
}

/**
 * Buche (runde Blattballen, glatte Rinde), Kiefer (Schuppenborke, Nadelbüschel, Zapfen),
 * Weißtanne (silbergraue Rinde, Nadeletagen mit Schnee, aufrechte Zapfen) oder
 * Schwarzerle (Stelzwurzeln, rissige Borke, Kätzchen und Zäpfchen im Winter). `g`: Alter
 * für Borke und Zapfen – 0 lässt diese Einzelheiten weg (ferner, dunstiger
 * Erinnerungsbaum). `look`: Jahreszeit für Schnee, Zapfen und Kätzchen.
 */
function paintSpeciesTree(
  ctx: CanvasRenderingContext2D,
  t: PlacedTree,
  species: TreeSpecies,
  wood: WoodColors,
  palette: LeafPalette,
  leaves: number,
  g: number,
  look: SeasonLook | null = null,
): void {
  if (species === 'alder' && g > 0) paintStiltRoots(ctx, t.geo, t.x, t.y, t.scale, g, wood);
  paintWood(ctx, t.geo, t.x, t.y, t.scale, 1, wood);
  if (species === 'fir') {
    if (g > 0) paintFirBark(ctx, t.geo, t.x, t.y, t.scale, g);
    paintFirTiers(ctx, t.geo, t.x, t.y, t.scale, palette, look ? look.snow : 0);
    if (g > 0) paintFirCones(ctx, t.geo, t.x, t.y, t.scale, g, look);
    return;
  }
  if (species === 'alder') {
    if (g > 0) paintAlderBark(ctx, t.geo, t.x, t.y, t.scale, g);
    paintLeaves(ctx, t.geo, t.x, t.y, t.scale, palette, leaves);
    if (g > 0) paintAlderCatkins(ctx, t.geo, t.x, t.y, t.scale, g, look);
    return;
  }
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
  sc.version++;
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
  const bg = layerContext(sc.background, sc);
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.drawImage(sc.scenery, 0, 0);
  sceneTransform(bg, sc);
  paintUnderground(bg, layout, g, scale1, main, withPlants ? sc.companionXs : neighbors.map((n) => n.x), species);
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.drawImage(sc.grass, 0, sc.grassTop);
  // Winter: dünne Schneedecke auf der Grasnarbe.
  if (look && look.snow > 0) {
    sceneTransform(bg, sc);
    paintSnowCover(bg, layout.width, layout.height, layout.groundY, look.snow);
  }

  // --- Nachbarbäume: hintere Reihe blasser als die vordere ---
  const back = layerContext(sc.back, sc);
  let backRect: Rect | null = null;
  for (const n of placeNeighbors(neighbors, layout, withPlants)) {
    backRect = unionRect(backRect, ...treeBounds(n.tree));
    paintTree(back, n.tree, hazeWood(seasonWood(WOOD, look), n.haze), hazePalette(seasonLeaves(n.palette, look), n.haze), leaves);
  }

  // --- Hauptbaum bzw. Keimling ---
  const front = layerContext(sc.front, sc);
  const { pw, ph, ox, oy } = sc;
  sc.backRect = toDeviceRect(backRect, dpr, pw, ph, ox, oy);
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
    sc.frontRect = toDeviceRect(unionRect(null, ...sc.mainBox), dpr, pw, ph, ox, oy);
    sc.crown = crownOf(sc.mainBox, sc);
    paintMainTree(front, main, g, species, look);
    // Keimblätter verblassen, während die ersten Blattbüschel wachsen.
    const coty = 1 - clamp01((g - 1) / 0.8);
    if (coty > 0) {
      paintCotyledons(front, main.x + main.geo.tipX * main.scale, main.y + main.geo.tipY * main.scale, scale1 * 0.36 * coty, species);
    }
  } else {
    sc.mainBox = null;
    sc.crown = null;
    paintSprout(front, layout, g, scale1, species);
    sc.frontRect = toDeviceRect(
      unionRect(null, layout.cx - scale1, layout.groundY - scale1 * 1.4, layout.cx + scale1, layout.groundY + 4),
      dpr,
      pw,
      ph,
      ox,
      oy,
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
    if (sc.plants) layerContext(sc.plants, sc);
    return null;
  }
  if (!sc.plants) {
    sc.plants = document.createElement('canvas');
    sc.plants.width = sc.pw;
    sc.plants.height = sc.ph;
  }
  const ctx = layerContext(sc.plants, sc);
  let rect: Rect | null = null;
  for (const p of flora) {
    paintPlant(ctx, p, look);
    rect = unionRect(rect, ...plantBounds(p));
  }
  return toDeviceRect(rect, sc.dpr, sc.pw, sc.ph, sc.ox, sc.oy);
}

/**
 * Krone des Hauptbaums für die Gäste (CSS-Pixel): aus dem Umriss, gerundet wie die Ebene
 * der Basis – so sitzen Gäste in Basis und Detail-Ebenen an derselben Stelle.
 */
function crownOf(box: [number, number, number, number], sc: SizeCache): [number, number, number, number] | null {
  const d = sc.baseDpr;
  const fr = toDeviceRect(unionRect(null, ...box), d, Math.round(sc.fullW / sc.zoom), Math.round(sc.fullH / sc.zoom));
  if (!fr) return null;
  const w = fr.w / d;
  const h = fr.h / d;
  return [fr.x / d + w / 2, fr.y / d + h * 0.35, w * 0.42, h * 0.22];
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

// --- Treffer-Test --------------------------------------------------------------------

/** Szene für den Treffer-Test: Größe des Canvas (CSS-Pixel) und die Felder aus `SceneInput`. */
export interface HitScene
  extends Pick<SceneInput, 'growth' | 'time' | 'animals' | 'reducedMotion' | 'mainTree' | 'season' | 'dayPhase' | 'weather' | 'weatherPrevious' | 'weatherBlend'> {
  width: number;
  height: number;
}

/** Tippziel: mindestens so groß (Radius in Bildschirm-Pixeln, ~44 px Durchmesser). */
export const HIT_MIN_RADIUS = 22;

/** Gemerkte Ankerpunkte für den Treffer-Test (Größe, Art und Wachstum auf REDRAW_STEP genau). */
let hitAnchors: { key: string; g: number; anchors: AnchorResolver } | null = null;

/** Wiederverwendete Stärken für den Treffer-Test (keine Allokation je Aufruf). */
const hitWeather: WeatherLevels = { overcast: 0, rain: 0, snow: 0, fog: 0, drought: 0, storm: 0, frost: 0, sun: 0 };
const hitDay: DayLevels = { night: 0, twilight: 0, dusk: false, sun: 1 };

/**
 * Welches Tier liegt unter dem Bildschirmpunkt (`x`, `y`, CSS-Pixel im Canvas)? Rechnet
 * über die Kamera in die Szene zurück und nutzt dieselben Ankerpunkte, Sprite-Größen,
 * Bewegungen und denselben Wind wie `drawScene`. Das Tippziel ist auf dem Bildschirm
 * mindestens ~44 px groß. Rein (ohne Canvas); `camera` null = ganze Szene.
 */
export function hitTestAnimal(scene: HitScene, camera: Readonly<CameraView> | null, x: number, y: number): AnimalHit | null {
  const animals = scene.animals;
  const { width, height } = scene;
  if (!animals || animals.length === 0 || !(width > 0) || !(height > 0)) return null;
  const view = clampView(camera ?? { zoom: 1, x: 0.5, y: 0.5 }, STRETCH_MAX_ZOOM);
  const p = screenToScene(view, width, height, x, y);
  const g = Math.max(0, Number.isFinite(scene.growth) ? scene.growth : 0);
  const species = normalizeSpecies(scene.mainTree);
  const key = `${width}x${height}/${species}`;
  if (!hitAnchors || hitAnchors.key !== key || Math.abs(hitAnchors.g - g) >= REDRAW_STEP) {
    const layout = makeLayout(width, height);
    hitAnchors = { key, g, anchors: createAnchorResolver(layout, g, placeMainTree(layout, g, species)) };
  }
  const time = Number.isFinite(scene.time) ? scene.time : 0;
  const reduced = scene.reducedMotion === true;
  // Wie in der Zeichnung: Sturm verstärkt den Wind, Nachtarten folgen der Tageszeit.
  const current = normalizeWeather(scene.weather);
  const storm = current ? mixWeather(normalizeWeather(scene.weatherPrevious) ?? current, current, normalizeBlend(scene.weatherBlend, reduced), hitWeather).storm : 0;
  const phase = normalizeDayPhase(scene.dayPhase);
  const lv = phase === null ? null : dayLevels(phase, hitDay);
  return hitTestAnimals(
    animals,
    hitAnchors.anchors,
    {
      time,
      windSkew: reduced ? 0 : stormSkew(windSkew(time, 0), time, storm),
      reducedMotion: reduced,
      season: normalizeSeason(scene.season),
      nocturnal: lv ? clamp01(lv.night + 0.5 * lv.twilight) : undefined,
    },
    p.x,
    p.y,
    HIT_MIN_RADIUS / view.zoom,
  );
}
