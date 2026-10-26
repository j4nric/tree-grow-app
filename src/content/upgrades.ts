import type { NicheId } from './types';

/**
 * Ausbau mit Samen (docs/DESIGN_V2.md 28.4): Nischen-Ausbau und Baum-Ausbau. Reine Daten – die
 * Logik (`upgradeNiche`, `upgradeTree`, `upgradeBlocker`, `upgradeCost`, Wirkung in `evaluate`)
 * steht in src/core (core/upgrades.ts, formulas.ts, tick.ts; seit Phase 11, 2a).
 *
 * Preis der Stufe L → L+1 (L ≥ 0, ohne Obergrenze außer MAX_UPGRADE_LEVEL):
 *   ⌈ b · UPGRADE_GROWTH^L ⌉ 🌰    b = Startpreis (NICHE_UPGRADE_BASE bzw. TREE_PART.base)
 * Beispiel Wurzelraum (b = 10): Stufe 1 kostet 10, Stufe 10 ⌈10 · 1,15^9⌉ = 36, Stufe 25 287 🌰.
 *
 * Wirkung Nische n auf Stufe L: jedes Tier dieser Nische +NICHE_UPGRADE_PCT · L % 🌿 und 🌰,
 * mal seine Zufriedenheit z (wie eine eigene Tierwirkung). Stufe 25, z = 0,8 → +2 %.
 * Nur 🌿 und 🌰 – nie Harmonie, Gedächtnis oder Hähersaat (28.1).
 *
 * Neuer Zyklus: alle Stufen beginnen bei 0; nur die höchste je erreichte Stufe bleibt
 * (`meta.upgrades.best`, Abzeichen).
 */

/** Jede Stufe kostet das 1,15-Fache der vorigen (Nischen und Baumteile). */
export const UPGRADE_GROWTH = 1.15;

/** Prozentpunkte 🌿 und 🌰 je Tier und Nischen-Stufe (× Zufriedenheit z). */
export const NICHE_UPGRADE_PCT = 0.1;

/** Obergrenze einer Ausbaustufe beim robusten Laden (28.8). */
export const MAX_UPGRADE_LEVEL = 1_000;

/**
 * Startpreis b_n je Nische in 🌰 – etwa 30 s Samen der Stufe, in der die Nische typisch öffnet
 * (28.4). Hängt an der Nische, nicht am Zeitpunkt: Wer den Tümpel früh erforscht, zahlt 250.
 */
export const NICHE_UPGRADE_BASE: Readonly<Record<NicheId, number>> = {
  roots: 10, // Keimling
  litter: 25, // Setzling
  edge: 25,
  crown: 60, // Junger Baum
  bark: 60,
  meadow: 60, // Forschung ab Jungem Baum
  hollows: 250, // Alter Baum (Stufe oder Forschung)
  deadwood: 250,
  pond: 250,
  wall: 600, // Forschung ab Hain
};

/** Die drei Teile des Hauptbaums (28.4, „Baum-Ausbau“). */
export type TreePartId = 'rings' | 'leaves' | 'mycorrhiza';
export const TREE_PART_IDS: readonly TreePartId[] = ['rings', 'leaves', 'mycorrhiza'];

/** Startpreis aller Baumteile in 🌰 (kein Sperrgrund ab Keimling). */
export const TREE_UPGRADE_BASE = 15;

/** Ab dieser Stufe (Index in STAGES, 1 = Keimling) lässt sich der Baum ausbauen; davor 'closed'. */
export const TREE_UPGRADE_MIN_STAGE = 1;

/**
 * Wirkung je Stufe eines Baumteils, in Prozent:
 * - `treeGrowth`: nur der Hauptbaum (`tree` in 2.1), nicht die Begleitpflanzen, 🌿
 * - `treeSeeds`: Samen des Hauptbaums (`treeSeeds`)
 * - `companions`: Begleitpflanzen 🌿 und 🌰 (vor der Versorgung V)
 */
export type TreeUpgradeEffect =
  | { kind: 'treeGrowth'; pct: number }
  | { kind: 'treeSeeds'; pct: number }
  | { kind: 'companions'; pct: number };

/**
 * Meilensteine (Ausbau-Stufe erreicht → Wirkung bis zum Neuen Zyklus, Abzeichen bleiben):
 * - `drawWeight`: Arten der Nische ziehen innerhalb ihrer Seltenheit mit Gewicht × factor
 *   (in `drawAnimals`, multipliziert mit Tagebuch und Waldtyp)
 * - `slot`: +amount Plätze in `niche` (ohne `niche`: die ausgebaute Nische selbst). Ausbau-Plätze
 *   öffnen keine Nische – sie zählen erst, wenn die übrigen Quellen ≥ 1 Platz geben.
 * - `rareWeight`: Arten ab Seltenheit minRarity (1 = selten) zusätzlich × factor
 * - `light` / `water`: +amount ☀️ / 💧 wie eine Forschungswirkung
 * - `badge`: Abzeichen am Etikett und im Tagebuch, ohne Wirkung; bleibt über den Zyklus
 */
export type UpgradeMilestoneEffect =
  | { kind: 'drawWeight'; factor: number }
  | { kind: 'slot'; amount: number; niche?: NicheId }
  | { kind: 'rareWeight'; factor: number; minRarity: number }
  | { kind: 'light'; amount: number }
  | { kind: 'water'; amount: number }
  | { kind: 'badge'; badge: UpgradeBadge };

export type UpgradeBadge = 'bronze' | 'silver' | 'gold';

export type UpgradeMilestone = UpgradeMilestoneEffect & {
  /** Erreicht mit dieser Ausbaustufe. */
  level: number;
  /** Kurzform für Balken und Zielzeile, z. B. „+1 Platz“. */
  summary: string;
};

/** Name und Stempeltext je Meilenstein-Stufe (gleich für alle Nischen). */
export const MILESTONE_NAMES: Readonly<Record<number, string>> = {
  10: 'Eingelebt',
  25: 'Gut bewohnt',
  50: 'Prachtnische',
};

export const BADGE_NAMES: Readonly<Record<UpgradeBadge, string>> = {
  bronze: 'Bronze',
  silver: 'Silber',
  gold: 'Gold',
};

const BRONZE: UpgradeMilestone = { level: 25, kind: 'badge', badge: 'bronze', summary: 'Abzeichen Bronze' };
const SILVER: UpgradeMilestone = { level: 50, kind: 'badge', badge: 'silver', summary: 'Abzeichen Silber' };
const GOLD: UpgradeMilestone = { level: 75, kind: 'badge', badge: 'gold', summary: 'Abzeichen Gold' };
const BADGES: readonly UpgradeMilestone[] = [BRONZE, SILVER, GOLD];

/** Meilensteine jeder Nische (28.4, Tabelle „Meilensteine je Nische“), nach Stufe sortiert. */
export const NICHE_MILESTONES: readonly UpgradeMilestone[] = [
  { level: 10, kind: 'drawWeight', factor: 1.5, summary: 'öfter in den Karten' },
  { level: 25, kind: 'slot', amount: 1, summary: '+1 Platz' },
  BRONZE,
  { level: 50, kind: 'rareWeight', factor: 2, minRarity: 1, summary: 'Seltene öfter' },
  SILVER,
  GOLD,
];

export interface TreePart {
  id: TreePartId;
  name: string;
  icon: string;
  /** Startpreis in 🌰. */
  base: number;
  /** Wirkung je Stufe (linear: Stufe L → L · pct). */
  effect: TreeUpgradeEffect;
  /** Wirkung in Kurzform je Stufe, z. B. „Baum +0,4 % 🌿“. */
  summary: string;
  /** Stimmungstext (ein Satz, ≤ 120 Zeichen). */
  text: string;
  milestones: readonly UpgradeMilestone[];
}

/** Baum-Ausbau (28.4): drei Teile des Hauptbaums, je Startpreis 15 🌰, Faktor 1,15. */
export const TREE_PARTS: readonly TreePart[] = [
  {
    id: 'rings', name: 'Jahresringe', icon: '🪵', base: TREE_UPGRADE_BASE,
    effect: { kind: 'treeGrowth', pct: 0.4 }, summary: 'Baum +0,4 % 🌿',
    text: 'Jedes Jahr ein Ring mehr – alte Stämme bekommen Höhlen.',
    milestones: [{ level: 25, kind: 'slot', amount: 1, niche: 'hollows', summary: '+1 Platz Höhlen' }, ...BADGES],
  },
  {
    id: 'leaves', name: 'Blattwerk', icon: '🍃', base: TREE_UPGRADE_BASE,
    effect: { kind: 'treeSeeds', pct: 1 }, summary: 'Baum +1 % 🌰',
    text: 'Mehr Blätter, mehr Zucker – und im Herbst mehr Eicheln.',
    milestones: [{ level: 25, kind: 'slot', amount: 1, niche: 'crown', summary: '+1 Platz Krone' }, ...BADGES],
  },
  {
    id: 'mycorrhiza', name: 'Pilzgeflecht', icon: '🍄', base: TREE_UPGRADE_BASE,
    effect: { kind: 'companions', pct: 0.5 }, summary: 'Pflanzen +0,5 % 🌿 und 🌰',
    text: 'Feine Pilzfäden verbinden die Wurzeln – der Baum teilt mit seinen Nachbarn.',
    milestones: [{ level: 25, kind: 'water', amount: 1, summary: '+1 💧' }, ...BADGES],
  },
];

export const TREE_PARTS_BY_ID: ReadonlyMap<TreePartId, TreePart> = new Map(TREE_PARTS.map((p) => [p.id, p]));
