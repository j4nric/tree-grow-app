/**
 * Ansichtslogik des Reiters „Pflege“ (docs/ALBUM_UI.md, A.8 und B.3) – rein, ohne DOM, mit
 * Vitest geprüft. Seit Spielstand v17 eine flache Notliste der Forschung (DESIGN_V2.md 27.7;
 * der Baum folgt in Phase 10, 4a); die Album-Seiten R:Pflege und U:Pflegemaßnahme
 * (album/pages/care-page.ts, care-item-page.ts) bauen daraus ihr DOM.
 */
import { RESEARCH_BY_ID } from '../content/research';
import { STAGES } from '../content/stages';
import { appearsContext, ecosystemOf, evaluate, harmonyIncome, speciesAppears, type Evaluation } from '../core/formulas';
import { effectiveForestMemory } from '../core/landscape';
import type { GameState } from '../core/state';
import { isResearched } from '../core/tick';
import { conditionName, sortCareViews, toCareViews } from './adapters';
import { formatNumber } from './format';
import { formatSigned, formatSignedPercent } from './view-format';
import type { CareView } from './view-model';

/**
 * Vorschau als kurze Zeile, Zahl vor dem Symbol: „+3 ⚖️ / +5 % 🌿“; leer, wenn sich
 * nichts ändert.
 */
export function carePreviewText(preview: CareView['preview']): string {
  if (!preview) return '';
  const parts: string[] = [];
  if (Math.abs(preview.harmonyDelta) >= 0.05) parts.push(`${formatSigned(preview.harmonyDelta)} ⚖️`);
  if (Math.abs(preview.growthDelta) >= 0.0005) parts.push(`${formatSignedPercent(preview.growthDelta)} 🌿`);
  if (Math.abs(preview.seedDelta) >= 0.0005) parts.push(`${formatSignedPercent(preview.seedDelta)} 🌰`);
  return parts.join(' / ');
}

/** Kennzahl im Seitenkopf, z. B. „2 erforschbar“ oder „alles erforscht“; sonst leer. */
export function careSummaryText(items: readonly CareView[]): string {
  const buyable = items.filter((i) => i.group === 'buyable').length;
  if (buyable > 0) return `${formatNumber(buyable)} erforschbar`;
  if (items.length > 0 && items.every((i) => i.group === 'maxed')) return 'alles erforscht';
  return '';
}

/**
 * Harmonie-Vorrat mit Zufluss für den Seitenkopf, z. B. „⚖️ 1.234 · +110/min“ (DESIGN_V2.md
 * 27.3/27.12; der Zufluss mit Gedächtnisfaktor, also ⚖️ je Minute in den Vorrat).
 */
export function harmonyWalletText(state: GameState, ev: Readonly<Pick<Evaluation, 'harmony'>> = evaluate(state)): string {
  const points = Number.isFinite(state.harmonyPoints) ? Math.max(0, state.harmonyPoints) : 0;
  const perMinute = harmonyIncome(ev.harmony, effectiveForestMemory(state)) * 60;
  return `⚖️ ${formatNumber(Math.floor(points))} · +${formatNumber(Math.floor(perMinute))}/min`;
}

/** Punkt am Reiter „Pflege“ (G-13): Ist gerade etwas erforschbar? */
export function careTabDot(items: readonly CareView[]): boolean {
  return items.some((i) => i.group === 'buyable');
}

/**
 * Reihenfolge der Zeilen: frisch sortiert – oder, solange die Liste „festgehalten“ ist,
 * die bisherige Reihenfolge (verschwundene Einträge raus, neue sortiert hinten an).
 */
export function careOrder(items: readonly CareView[], previous: readonly string[], frozen: boolean): string[] {
  const sorted = sortCareViews(items).map((i) => i.id);
  if (!frozen || previous.length === 0) return sorted;
  const present = new Set(sorted);
  const kept = previous.filter((id) => present.has(id));
  const known = new Set(kept);
  return [...kept, ...sorted.filter((id) => !known.has(id))];
}

/** So lange (ms) bleibt die Reihenfolge nach einem Kauf stehen – auch ohne Zeiger/Fokus. */
export const CARE_HOLD_MS = 1500;

/** Kleine Überschrift über der ersten Zeile jeder Gruppe (Handschrift). */
export const CARE_GROUP_LABELS: Readonly<Record<CareView['group'], string>> = {
  buyable: 'jetzt möglich',
  saving: 'dafür sparen',
  locked: 'noch nicht möglich',
  maxed: 'erledigt',
};

/** Balkenbreite in Prozent mit einer Nachkommastelle (CSS-Variable). */
export function barWidth(progress: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return `${Math.round(clamped * 1000) / 10}%`;
}

// --- U:Pflegemaßnahme (seit v17: ein Forschungsknoten) -------------------------------

/** Ein Rang der Maßnahme: gekauft, als nächster dran oder später (seit v17 nicht mehr genutzt). */
export interface CareRankLine {
  /** 1-basiert. */
  rank: number;
  state: 'done' | 'next' | 'later';
  summary: string;
  /** z. B. „550 ⚖️“ */
  cost: string;
  /** z. B. „ab Hain“ */
  stage: string;
}

/** Eine Voraussetzung des Knotens mit Haken bzw. Kreuz. */
export interface CareRequirement {
  key: string;
  met: boolean;
  text: string;
}

export interface CareItemView {
  /** Dieselbe Zeile wie auf der Reiterseite (Ast, Kosten, Sperrgrund, Vorschau …). */
  item: CareView;
  /** Stimmungstext des Knotens (ein Satz). */
  text: string;
  /** Kurze Vorschau, z. B. „+3 ⚖️ / +2 % 🌿“; leer, wenn nichts. */
  preview: string;
  /** Leer: Knoten haben keine Ränge (bis v16 die Ränge der Pflegemaßnahme). */
  ranks: CareRankLine[];
  /** Voraussetzungen; leer, wenn schon erforscht. */
  requirements: CareRequirement[];
}

/**
 * Alles für die Unterseite eines Forschungsknotens. null, wenn es ihn nicht gibt oder er auf
 * dieser Stufe noch nicht in der Liste steht.
 */
export function toCareItemView(state: GameState, id: string, now: Readonly<Evaluation> = evaluate(state)): CareItemView | null {
  const node = RESEARCH_BY_ID.get(id);
  if (!node) return null;
  const item = toCareViews(state, now).find((v) => v.id === id);
  if (!item) return null;
  const stageName = (index: number) => STAGES[index]?.name ?? '';
  const requirements: CareRequirement[] = [];
  if (!isResearched(state, id)) {
    const owned = state.cycle.research;
    const name = (x: string) => RESEARCH_BY_ID.get(x)?.name ?? x;
    requirements.push({ key: 'stage', met: state.stage >= node.minStage, text: `Stufe „${stageName(node.minStage)}“` });
    for (const x of node.requires ?? []) requirements.push({ key: `requires:${x}`, met: owned.includes(x), text: `erforscht „${name(x)}“` });
    if (node.requiresAny && node.requiresAny.length > 0) {
      requirements.push({
        key: 'requires-any',
        met: node.requiresAny.some((x) => owned.includes(x)),
        text: `erforscht ${node.requiresAny.map((x) => `„${name(x)}“`).join(' oder ')}`,
      });
    }
    // Gabel: nur der erste Knoten des anderen Wegs (die Kronen schließen alle drei aus).
    const other = node.excludes?.[0];
    if (other) requirements.push({ key: `excludes:${other}`, met: !node.excludes!.some((x) => owned.includes(x)), text: `nicht zusammen mit „${name(other)}“` });
    if (node.condition && node.condition.length > 0) {
      const ctx = appearsContext(ecosystemOf(state));
      node.condition.forEach((condition, i) => {
        requirements.push({ key: `condition:${i}`, met: speciesAppears(ctx, { appears: [condition] }), text: `braucht ${conditionName(condition)}` });
      });
    }
    const points = Number.isFinite(state.harmonyPoints) ? state.harmonyPoints : 0;
    const missing = Math.ceil(node.cost - points);
    requirements.push({
      key: 'harmony',
      met: missing <= 0,
      text: missing > 0 ? `${formatNumber(node.cost)} ⚖️ (noch ${formatNumber(missing)} ⚖️)` : `${formatNumber(node.cost)} ⚖️`,
    });
  }
  return { item, text: node.text, preview: carePreviewText(item.preview), ranks: [], requirements };
}
