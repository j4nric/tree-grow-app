/**
 * Jahreszeiten-Zustand einzelner Pflanzen und Tiere (Phänologie) – reine Rechnungen
 * ohne Canvas, damit testbar.
 *
 * Zwei Arten von Werten:
 * - Für gecachte Zeichnungen (Sträucher): Eingabe ist das gerundete Aussehen
 *   `SeasonLook` (season.ts); ohne Angabe (null) und im Sommer gilt überall der Wert,
 *   der dem bisherigen Bild entspricht – der Sommer bleibt so pixelgleich.
 * - Für Werte, die jeden Frame gelesen werden (Insekten, Partikel, Blumen am Waldsaum):
 *   Eingabe ist die ungerundete Jahreszeit (`normalizeSeason`, null = ohne Angabe),
 *   damit nichts alle paar Sekunden um eine Rundungsstufe springt. Die Kurven haben
 *   im Hochsommer (1) ihren neutralen Wert – ein Sommer-Sonderfall ist nicht nötig.
 *
 * Grafik-Werte der Jahreszeit (siehe `sceneSeason` in core/season.ts):
 *   0 Mitte Frühling · 0,5 Frühling/Sommer · 1 Mitte Sommer · 1,5 Sommer/Herbst ·
 *   2 Mitte Herbst · 2,5 Herbst/Winter · 3 Mitte Winter · 3,5 Winter/Frühling
 */

import { curve, type SeasonLook } from './season';

type Points = readonly (readonly [number, number])[];

/** Wert einer Kurve für ein Aussehen; ohne Angabe oder im Sommer `neutral`. */
function at(points: Points, look: SeasonLook | null, neutral = 1): number {
  if (!look || look.summer) return neutral;
  return curve(points, look.s);
}

/** Wert einer Kurve für eine ungerundete Jahreszeit (0–4); ohne Angabe `neutral`. */
function atRaw(points: Points, season: number | null, neutral = 1): number {
  if (season === null) return neutral;
  return curve(points, season);
}

/** Begleitbäume mit eigener Zeichnung, die das ganze Jahr grün bleiben (Nadelbäume). */
export const EVERGREEN_TREES: ReadonlySet<string> = new Set(['pine']);

/** Bleibt ein Begleitbaum im Winter grün? (Nur Nadelbäume – nicht die Eberesche.) */
export function isEvergreen(kind: string): boolean {
  return EVERGREEN_TREES.has(kind);
}

/** Laubmenge eines Begleitbaums oder Strauchs 0–1 (Nadelbäume immer 1). */
export function plantLeafAmount(kind: string, look: SeasonLook | null): number {
  if (!look || isEvergreen(kind)) return 1;
  return look.leaves;
}

/** Vogelbeeren (Eberesche): reifen im Spätsommer, hängen im Herbst, bis zum Winter gefressen. */
const ROWAN_BERRIES: Points = [
  [0, 0],
  [0.75, 0],
  [1, 1],
  [2.35, 1],
  [2.6, 0],
  [4, 0],
];

/** Haselnüsse: grün ab Sommer, reif im Herbst, im Winter keine mehr. */
const HAZEL_NUTS: Points = [
  [0, 0],
  [0.7, 0],
  [1, 1],
  [2.25, 1],
  [2.5, 0],
  [4, 0],
];

/**
 * Hasel-Kätzchen blühen (lang, gelb) im Spätwinter und Vorfrühling; sonst hängen sie
 * nur klein und geschlossen (das bisherige Bild).
 */
const HAZEL_CATKIN_BLOOM: Points = [
  [0, 0.5],
  [0.35, 0],
  [2.85, 0],
  [3.2, 1],
  [3.7, 1],
  [4, 0.5],
];

/** Holunderblüten (cremeweiße Dolden): Spätfrühling bis Frühsommer. */
const ELDER_FLOWERS: Points = [
  [0, 0.25],
  [0.3, 1],
  [1.15, 1],
  [1.4, 0],
  [3.75, 0],
  [4, 0.25],
];

/** Holunderbeeren (dunkle Dolden): Spätsommer und Herbst. */
const ELDER_BERRIES: Points = [
  [0, 0],
  [0.75, 0],
  [1, 1],
  [2.3, 1],
  [2.55, 0],
  [4, 0],
];

/** Insekten fliegen und krabbeln vom Frühling bis Herbst; im Winter ruhen sie. */
const INSECT_ACTIVITY: Points = [
  [0, 1],
  [2.15, 1],
  [2.5, 0],
  [3.35, 0],
  [3.7, 1],
  [4, 1],
];

/** Pollen und Blütenblätter in der Luft: Frühling und Sommer. */
const BLOOM_PARTICLES: Points = [
  [0, 1],
  [1.45, 1],
  [1.85, 0],
  [3.4, 0],
  [3.8, 1],
  [4, 1],
];

/** Glühwürmchen: Frühsommer bis Spätsommer. */
const FIREFLIES: Points = [
  [0, 0.35],
  [0.5, 1],
  [1.45, 1],
  [1.8, 0],
  [3.6, 0],
  [4, 0.35],
];

export function rowanBerries(look: SeasonLook | null): number {
  return at(ROWAN_BERRIES, look);
}

export function hazelNuts(look: SeasonLook | null): number {
  return at(HAZEL_NUTS, look);
}

/** Blüte der Hasel-Kätzchen: 0 klein und geschlossen (bisheriges Bild) … 1 lang und gelb. */
export function hazelCatkinBloom(look: SeasonLook | null): number {
  return at(HAZEL_CATKIN_BLOOM, look, 0);
}

export function elderFlowers(look: SeasonLook | null): number {
  return at(ELDER_FLOWERS, look);
}

export function elderBerries(look: SeasonLook | null): number {
  return at(ELDER_BERRIES, look);
}

/**
 * Blumen am Waldsaum: Blüten vom Frühling bis Spätsommer, danach Samenstände; im Winter
 * nur dürre Halme und Blattrosetten, erst mit dem Frühling wieder grün.
 */
const EDGE_PETALS: Points = [
  [0, 1],
  [1.5, 1],
  [1.85, 0],
  [3.55, 0],
  [3.9, 1],
  [4, 1],
];
const EDGE_SEEDS: Points = [
  [0, 0],
  [1.5, 0],
  [1.85, 1],
  [2.2, 1],
  [2.55, 0],
  [4, 0],
];
const EDGE_BARE: Points = [
  [0, 0],
  [2.2, 0],
  [2.55, 1],
  [3.4, 1],
  [3.75, 0],
  [4, 0],
];

/** Bewegung der Insekten 0 (Winterruhe) – 1 (wie bisher). Ungerundete Jahreszeit. */
export function insectActivity(season: number | null): number {
  return atRaw(INSECT_ACTIVITY, season);
}

/** Pollen und Blütenblätter der Stimmungs-Ebene 0–1. Ungerundete Jahreszeit. */
export function bloomParticles(season: number | null): number {
  return atRaw(BLOOM_PARTICLES, season);
}

/** Glühwürmchen (Stimmungs-Ebene und Leuchten des Tiers) 0–1. Ungerundete Jahreszeit. */
export function fireflySeason(season: number | null): number {
  return atRaw(FIREFLIES, season);
}

/** Blüten der Waldsaum-Blumen 0–1 (1 = bisheriges Bild). Ungerundete Jahreszeit. */
export function edgePetals(season: number | null): number {
  return atRaw(EDGE_PETALS, season);
}

/** Verblühte Samenstände der Waldsaum-Blumen 0–1 (Herbst). Ungerundete Jahreszeit. */
export function edgeSeedHeads(season: number | null): number {
  return atRaw(EDGE_SEEDS, season, 0);
}

/** Winterkleid des Waldsaums 0–1: dürre Halme statt grüner Stängel. Ungerundete Jahreszeit. */
export function edgeBare(season: number | null): number {
  return atRaw(EDGE_BARE, season, 0);
}

/**
 * Amphibien: Winterstarre von Spätherbst bis Vorfrühling (etwas länger als die Insekten),
 * dafür im Frühling sofort munter – die Krötenwanderung beginnt in den ersten milden Nächten.
 */
const AMPHIBIAN_ACTIVITY: Points = [
  [0, 1],
  [2.1, 1],
  [2.45, 0],
  [3.4, 0],
  [3.65, 1],
  [4, 1],
];

/** Eis auf dem Waldtümpel: nur im tiefen Winter. */
const POND_ICE: Points = [
  [0, 0],
  [2.6, 0],
  [2.95, 1],
  [3.3, 1],
  [3.55, 0],
  [4, 0],
];

/** Bewegung der Amphibien 0 (Winterstarre) – 1 (munter). Ungerundete Jahreszeit. */
export function amphibianActivity(season: number | null): number {
  return atRaw(AMPHIBIAN_ACTIVITY, season);
}

/** Eisdecke des Waldtümpels 0–1. Ungerundete Jahreszeit. */
export function pondIce(season: number | null): number {
  return atRaw(POND_ICE, season, 0);
}
