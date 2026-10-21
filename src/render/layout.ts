/**
 * Reine Geometrie der Szene (ohne Canvas): Aufteilung der Fläche und Platzierung des
 * Hauptbaums und seiner Wurzeln. Wird vom Renderer und von den Tier-Ankerpunkten
 * gemeinsam benutzt – so sitzen die Tiere genau dort, wo der Baum gezeichnet wird.
 */

import { buildRoots, buildTree, TREE_FORMS, trunkWidthOf, type PlantGeometry, type TreeForm, type TreeSpecies } from './plant';
import { clamp01, hash2, smooth01 } from './util';

export const MAIN_SEED = 7;
/** Seed der Wurzeln des Hauptbaums. */
export const ROOT_SEED = hash2(MAIN_SEED, 77);

export interface Layout {
  width: number;
  height: number;
  groundY: number;
  /** Höchster erlaubter Punkt der Bäume. */
  top: number;
  /** Verfügbare Höhe über dem Boden. */
  avail: number;
  soilH: number;
  cx: number;
}

export function makeLayout(width: number, height: number): Layout {
  const groundY = Math.round(height * 0.8);
  const top = Math.max(8, height * 0.045);
  return { width, height, groundY, top, avail: groundY - top, soilH: height - groundY, cx: width / 2 };
}

/** Zielhöhe eines Baums als Anteil der verfügbaren Höhe – wächst stetig mit g. */
export function heightFraction(g: number): number {
  return 0.13 + 0.82 * Math.pow(clamp01((g - 1) / 7), 0.9);
}

export interface PlacedTree {
  geo: PlantGeometry;
  scale: number;
  x: number;
  y: number;
  /** Faktor der Art auf die Stammbreite (`TreeForm.trunkWidth`, Eiche 1). */
  trunkWidth: number;
}

/** Halbe Stammbreite am Fuß in px (inkl. Verdickung) – genau wie in `buildTree` gezeichnet. */
export function trunkFootHalf(g: number, tree: PlacedTree): number {
  const flare = clamp01((g - 2) / 3);
  return (trunkWidthOf(g) * tree.trunkWidth * (1 + 0.55 * flare) * tree.scale) / 2;
}

/**
 * Baut einen Baum und skaliert ihn so, dass er die Zielhöhe erreicht, aber nie über
 * `maxHeight` (inkl. Blätter) hinaus- oder breiter als `maxHalfWidth` je Seite wird.
 */
export function placeTree(g: number, seed: number, x: number, y: number, maxHeight: number, maxHalfWidth: number, form?: TreeForm): PlacedTree {
  const geo = buildTree(g, seed, form);
  let segTop = 0;
  for (const s of geo.segments) segTop = Math.min(segTop, s.y1, s.y2);
  const target = maxHeight * heightFraction(g);
  const half = Math.max(-geo.minX, geo.maxX, 1e-6);
  const scale = Math.min(target / Math.max(-segTop, 1e-6), maxHeight / Math.max(-geo.minY, 1e-6), maxHalfWidth / half);
  return { geo, scale, x, y, trunkWidth: (form ?? TREE_FORMS.oak).trunkWidth };
}

/** Maßstab des Keimlings (g = 1) – Bezugsgröße für Samen, Trieb und Keimblätter. */
export function sproutScale(layout: Layout): number {
  return placeTree(1, MAIN_SEED, 0, 0, layout.avail, layout.width * 0.5).scale;
}

/** Hauptbaum (ab g ≥ 1) der Art `species` (Standard: Eiche), sonst null. */
export function placeMainTree(layout: Layout, g: number, species: TreeSpecies = 'oak'): PlacedTree | null {
  if (g < 1) return null;
  return placeTree(g, MAIN_SEED, layout.cx, layout.groundY, layout.avail, layout.width * 0.5, species === 'oak' ? undefined : TREE_FORMS[species]);
}

export interface PlacedRoots {
  geo: PlantGeometry;
  scale: number;
  /** Breitenfaktor der Wurzeln (an die Stammdicke angepasst). */
  widthScale: number;
  /** Tiefe des Wurzelwerks in CSS-Pixeln. */
  reach: number;
}

/** Wurzelwerk des Hauptbaums; wächst mit dem Baum in die Tiefe und Breite. */
export function placeRoots(layout: Layout, g: number, main: PlacedTree): PlacedRoots {
  const depth = 1 + (g - 1) * 0.75;
  const geo = buildRoots(depth, ROOT_SEED);
  const reach = layout.soilH * (0.38 + 0.5 * smooth01((g - 1) / 5));
  const half = Math.max(-geo.minX, geo.maxX, 1e-6);
  const scale = Math.min(reach / Math.max(geo.maxY, 1e-6), (layout.width * 0.46) / half);
  const trunkPx = trunkWidthOf(g) * main.trunkWidth * main.scale;
  return { geo, scale, widthScale: (trunkPx * 0.8) / scale, reach };
}
