import { NICHE_IDS, type NicheId } from '../content/types';
import {
  MAX_UPGRADE_LEVEL,
  NICHE_MILESTONES,
  NICHE_UPGRADE_BASE,
  NICHE_UPGRADE_PCT,
  TREE_PARTS,
  TREE_PARTS_BY_ID,
  TREE_PART_IDS,
  UPGRADE_GROWTH,
  type TreePartId,
  type TreeUpgradeEffect,
  type UpgradeMilestone,
} from '../content/upgrades';
import type { UpgradeLevels } from './state';

/*
 * Ausbau mit Samen (DESIGN_V2.md 28.4): reine Rechenregeln ohne Spielstand-Änderung – Preise,
 * Meilensteine, Plätze, Licht/Wasser und Kartengewichte aus den Ausbaustufen. Die Aktionen
 * (upgradeNiche, upgradeTree, upgradeBlocker, upgradeCost) stehen in tick.ts, die Wirkung auf
 * 🌿/🌰 in evaluateEcosystem (formulas.ts). Hängt nur an content/ – formulas.ts und tick.ts
 * importieren von hier, nie umgekehrt.
 */

/** Ziel eines Ausbaus: eine Nische oder ein Teil des Hauptbaums. */
export type UpgradeTarget = { kind: 'niche'; id: NicheId } | { kind: 'tree'; id: TreePartId };

/** Platz aus einem Ausbau-Meilenstein: zählt nur in einer schon offenen Nische (28.4). */
export interface UpgradeSlotBonus {
  niche: NicheId;
  amount: number;
  upgrade: true;
}

/**
 * Rundungsrauschen beim Aufrunden: Liegt der Gleitkomma-Preis nur um diesen Anteil (relativ,
 * mindestens PRICE_NOISE_ABS) über einer ganzen Zahl, gilt er als diese Zahl (600 · 1,15 = 690,
 * auch wenn das Produkt knapp darüber landet). Klein genug, dass echte Nachkommastellen großer
 * Preise (Wurzelraum Stufe 120: 192.194.450,019…) weiter aufrunden – exakt bis ~1e12 🌰 (getestet),
 * darüber begrenzt die Genauigkeit von Math.pow die Einerstelle.
 */
const PRICE_NOISE_REL = 3e-15;
const PRICE_NOISE_ABS = 1e-9;

/**
 * Eine Ausbaustufe robust: ganzzahlig in 0 … MAX_UPGRADE_LEVEL, sonst 0 (NaN, negativ, zu groß,
 * Bruch, Text – DESIGN_V2.md 28.8).
 */
export function normalizeUpgradeLevel(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_UPGRADE_LEVEL ? value : 0;
}

/** Ist das ein bekanntes Ausbau-Ziel? */
export function isUpgradeTarget(target: unknown): target is UpgradeTarget {
  if (typeof target !== 'object' || target === null) return false;
  const t = target as { kind?: unknown; id?: unknown };
  if (t.kind === 'niche') return NICHE_IDS.includes(t.id as NicheId);
  if (t.kind === 'tree') return TREE_PART_IDS.includes(t.id as TreePartId);
  return false;
}

/** Stufe eines Ziels (fehlt oder kaputt → 0). */
export function upgradeLevel(levels: UpgradeLevels | undefined, target: UpgradeTarget): number {
  if (!levels) return 0;
  const raw = target.kind === 'niche' ? levels.niches?.[target.id] : levels.tree?.[target.id];
  return normalizeUpgradeLevel(raw);
}

/** Startpreis b eines Ziels in 🌰 (unbekannt → undefined). */
export function upgradeBase(target: UpgradeTarget): number | undefined {
  if (!isUpgradeTarget(target)) return undefined;
  return target.kind === 'niche' ? NICHE_UPGRADE_BASE[target.id] : TREE_PARTS_BY_ID.get(target.id)!.base;
}

/** Meilensteine eines Ziels (Nischen alle gleich, Baumteile je eigene), nach Stufe sortiert. */
export function upgradeMilestones(target: UpgradeTarget): readonly UpgradeMilestone[] {
  if (target.kind === 'niche') return NICHE_MILESTONES;
  return TREE_PARTS_BY_ID.get(target.id)?.milestones ?? [];
}

/**
 * Preis der Stufe `level` → `level + 1`: ⌈ b · UPGRADE_GROWTH^level ⌉ 🌰 (28.4). Ab
 * MAX_UPGRADE_LEVEL (und bei kaputtem b) Infinity – nie bezahlbar, aber kein NaN.
 */
export function upgradePrice(base: number, level: number): number {
  if (!(base > 0) || !Number.isFinite(base)) return Infinity;
  const l = Math.floor(Number.isFinite(level) ? Math.max(0, level) : MAX_UPGRADE_LEVEL);
  if (l >= MAX_UPGRADE_LEVEL) return Infinity;
  const raw = base * Math.pow(UPGRADE_GROWTH, l);
  if (!Number.isFinite(raw)) return Infinity;
  const whole = Math.floor(raw);
  return raw - whole <= Math.max(PRICE_NOISE_ABS, raw * PRICE_NOISE_REL) ? whole : Math.ceil(raw);
}

/**
 * Kaufmenge robust: ganze Zahl ≥ 1, höchstens MAX_UPGRADE_LEVEL; +Infinity = so viele wie möglich
 * (MAX_UPGRADE_LEVEL); NaN, keine Zahl und Werte < 1 → 1.
 */
export function normalizeUpgradeCount(count: unknown): number {
  if (typeof count !== 'number' || Number.isNaN(count) || count < 1) return 1;
  return Math.min(MAX_UPGRADE_LEVEL, Math.floor(count));
}

/** Summe der Preise der nächsten `count` Stufen ab `level` (count wie normalizeUpgradeCount). */
export function upgradeCostFrom(base: number, level: number, count = 1): number {
  const n = normalizeUpgradeCount(count);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += upgradePrice(base, level + i);
    if (!Number.isFinite(sum)) return Infinity;
  }
  return sum;
}

/**
 * Wie viele der nächsten (höchstens `max`) Stufen ab `level` reichen die Samen `seeds`, und was
 * kosten sie zusammen? Kauft in Reihenfolge – keine Stufe wird übersprungen.
 */
export function affordableUpgrades(base: number, level: number, seeds: number, max = 1): { count: number; cost: number } {
  const n = normalizeUpgradeCount(max);
  const budget = Number.isNaN(seeds) ? 0 : seeds;
  let count = 0;
  let cost = 0;
  while (count < n) {
    const price = upgradePrice(base, level + count);
    if (!(cost + price <= budget)) break;
    cost += price;
    count++;
  }
  return { count, cost };
}

/** Meilensteine, die mit dem Schritt von Stufe `from` auf `to` erreicht werden (from < m ≤ to). */
export function milestonesBetween(target: UpgradeTarget, from: number, to: number): UpgradeMilestone[] {
  return upgradeMilestones(target).filter((m) => m.level > from && m.level <= to);
}

/** Nächster Meilenstein über `level` (für Balken und Zielzeile), sonst null. */
export function nextMilestone(target: UpgradeTarget, level: number): UpgradeMilestone | null {
  return upgradeMilestones(target).find((m) => m.level > level) ?? null;
}

/** Alle erreichten Meilensteine aller Ziele, je mit der Nische, an der sie hängen (Baumteile: keine). */
function reached(levels: UpgradeLevels | undefined): { milestone: UpgradeMilestone; niche: NicheId | null }[] {
  const out: { milestone: UpgradeMilestone; niche: NicheId | null }[] = [];
  if (!levels) return out;
  for (const id of NICHE_IDS) {
    const level = upgradeLevel(levels, { kind: 'niche', id });
    if (level <= 0) continue;
    for (const m of NICHE_MILESTONES) if (m.level <= level) out.push({ milestone: m, niche: id });
  }
  for (const part of TREE_PARTS) {
    const level = upgradeLevel(levels, { kind: 'tree', id: part.id });
    if (level <= 0) continue;
    for (const m of part.milestones) if (m.level <= level) out.push({ milestone: m, niche: null });
  }
  return out;
}

/**
 * Plätze aus den Meilensteinen (`slot`): je Nische bzw. Baumteil ab der Stufe. Ohne `niche` am
 * Meilenstein gilt die ausgebaute Nische selbst. Markiert mit `upgrade: true` – nicheSlots
 * zählt sie nur in Nischen, die ohne sie schon einen Platz haben (sie öffnen keine, 28.4).
 */
export function upgradeSlotBonuses(levels: UpgradeLevels | undefined): UpgradeSlotBonus[] {
  const out: UpgradeSlotBonus[] = [];
  for (const { milestone: m, niche } of reached(levels)) {
    if (m.kind !== 'slot') continue;
    const target = m.niche ?? niche;
    if (target !== null && Number.isFinite(m.amount)) out.push({ niche: target, amount: m.amount, upgrade: true });
  }
  return out;
}

/** ☀️ und 💧 aus den Meilensteinen (`light` / `water`, z. B. Pilzgeflecht 25: +1 💧). */
export function upgradeEnvironment(levels: UpgradeLevels | undefined): { light: number; water: number } {
  let light = 0;
  let water = 0;
  for (const { milestone: m } of reached(levels)) {
    if (m.kind === 'light' && Number.isFinite(m.amount)) light += m.amount;
    else if (m.kind === 'water' && Number.isFinite(m.amount)) water += m.amount;
  }
  return { light, water };
}

/**
 * Prozent je Tier einer Nische aus ihrem Ausbau: NICHE_UPGRADE_PCT · L (× Zufriedenheit z in
 * evaluate). Stufe 25 → 2,5.
 */
export function nicheUpgradePct(levels: UpgradeLevels | undefined, niche: NicheId): number {
  return NICHE_UPGRADE_PCT * upgradeLevel(levels, { kind: 'niche', id: niche });
}

/** Prozent aus dem Baum-Ausbau für eine Wirkungsart (`treeGrowth`, `treeSeeds`, `companions`): Σ pct · L. */
export function treeUpgradePct(levels: UpgradeLevels | undefined, kind: TreeUpgradeEffect['kind']): number {
  let sum = 0;
  for (const part of TREE_PARTS) {
    if (part.effect.kind !== kind) continue;
    sum += part.effect.pct * upgradeLevel(levels, { kind: 'tree', id: part.id });
  }
  return sum;
}

/**
 * Faktor auf das Kartengewicht einer Art innerhalb ihrer Seltenheit (drawAnimals, 28.4):
 * `drawWeight` ab Stufe 10 (×1,5), `rareWeight` ab Stufe 50 für Arten ab `minRarity` (×2) –
 * die Seltenheitsgewichte selbst bleiben. 1 ohne Ausbau.
 */
export function upgradeDrawWeight(levels: UpgradeLevels | undefined, niche: NicheId, rarity: number): number {
  const level = upgradeLevel(levels, { kind: 'niche', id: niche });
  let factor = 1;
  if (level <= 0) return factor;
  for (const m of NICHE_MILESTONES) {
    if (m.level > level) continue;
    if (m.kind === 'drawWeight' && m.factor > 0 && Number.isFinite(m.factor)) factor *= m.factor;
    else if (m.kind === 'rareWeight' && rarity >= m.minRarity && m.factor > 0 && Number.isFinite(m.factor)) factor *= m.factor;
  }
  return factor;
}

/** Erste Nischen-Stufe, ab der ein Meilenstein aufs Kartenziehen wirkt (10). */
const FIRST_DRAW_MILESTONE = Math.min(
  ...NICHE_MILESTONES.filter((m) => m.kind === 'drawWeight' || m.kind === 'rareWeight').map((m) => m.level),
);

/** Wirkt irgendein Ausbau aufs Kartenziehen (eine Nische ab ihrem ersten Gewichts-Meilenstein)? */
export function hasDrawUpgrades(levels: UpgradeLevels | undefined): boolean {
  return NICHE_IDS.some((id) => upgradeLevel(levels, { kind: 'niche', id }) >= FIRST_DRAW_MILESTONE);
}

/**
 * Schlüssel der Stufen für die Caches von evaluate (nur Stufen > 0, in fester Reihenfolge);
 * '' ohne Ausbau – so bleiben Schlüssel und Werte ohne Ausbau wie vor v18.
 */
export function upgradeLevelsKey(levels: UpgradeLevels | undefined): string {
  if (!levels) return '';
  const parts: string[] = [];
  for (const id of NICHE_IDS) {
    const level = upgradeLevel(levels, { kind: 'niche', id });
    if (level > 0) parts.push(`${id}:${level}`);
  }
  for (const id of TREE_PART_IDS) {
    const level = upgradeLevel(levels, { kind: 'tree', id });
    if (level > 0) parts.push(`${id}:${level}`);
  }
  return parts.join(',');
}
