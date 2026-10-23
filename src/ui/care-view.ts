/**
 * Ansichtslogik der Pflege (docs/ALBUM_UI.md, A.8 und B.3) – rein, ohne DOM, mit Vitest
 * geprüft. Früher in care-panel.ts und bonus-panel.ts; die Album-Seiten R:Pflege und
 * U:Pflegemaßnahme (album/pages/care-page.ts, care-item-page.ts) bauen daraus ihr DOM.
 */
import { CARE_BY_ID } from '../content/care';
import { STAGES } from '../content/stages';
import { appearsContext, ecosystemOf, evaluate, speciesAppears, type Evaluation } from '../core/formulas';
import type { GameState } from '../core/state';
import { careRank } from '../core/tick';
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

/** Kennzahl im Seitenkopf, z. B. „2 kaufbar“ oder „alles ausgebaut“; sonst leer. */
export function careSummaryText(items: readonly CareView[]): string {
  const buyable = items.filter((i) => i.group === 'buyable').length;
  if (buyable > 0) return `${formatNumber(buyable)} kaufbar`;
  if (items.length > 0 && items.every((i) => i.group === 'maxed')) return 'alles ausgebaut';
  return '';
}

/** Punkt am Reiter „Pflege“ (G-13): Ist gerade etwas kaufbar? */
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

// --- U:Pflegemaßnahme ------------------------------------------------------------------

/** Ein Rang der Maßnahme: gekauft, als nächster dran oder später. */
export interface CareRankLine {
  /** 1-basiert. */
  rank: number;
  state: 'done' | 'next' | 'later';
  summary: string;
  /** z. B. „7.000 🌰“ */
  cost: string;
  /** z. B. „ab Hain“ */
  stage: string;
}

/** Eine Voraussetzung des nächsten Rangs mit Haken bzw. Kreuz. */
export interface CareRequirement {
  key: string;
  met: boolean;
  text: string;
}

export interface CareItemView {
  /** Dieselbe Zeile wie auf der Reiterseite (Rang, Kosten, Sperrgrund, Vorschau …). */
  item: CareView;
  /** Stimmungstext der Maßnahme (ein Satz). */
  text: string;
  /** Kurze Vorschau, z. B. „+3 ⚖️ / +2 % 🌿“; leer, wenn nichts. */
  preview: string;
  ranks: CareRankLine[];
  /** Voraussetzungen des nächsten Rangs; leer, wenn voll ausgebaut. */
  requirements: CareRequirement[];
}

/**
 * Alles für die Unterseite einer Pflegemaßnahme. null, wenn es sie nicht gibt oder sie
 * auf dieser Stufe noch nicht in der Liste steht.
 */
export function toCareItemView(state: GameState, id: string, now: Readonly<Evaluation> = evaluate(state)): CareItemView | null {
  const measure = CARE_BY_ID.get(id);
  if (!measure) return null;
  const item = toCareViews(state, now).find((v) => v.id === id);
  if (!item) return null;
  const bought = careRank(state, id);
  const stageName = (index: number) => STAGES[index]?.name ?? '';
  const ranks: CareRankLine[] = measure.ranks.map((r, i) => ({
    rank: i + 1,
    state: i < bought ? 'done' : i === bought ? 'next' : 'later',
    summary: r.summary,
    cost: `${formatNumber(r.cost)} 🌰`,
    stage: `ab ${stageName(r.minStage)}`,
  }));

  const requirements: CareRequirement[] = [];
  const next = measure.ranks[bought];
  if (next) {
    requirements.push({ key: 'stage', met: state.stage >= next.minStage, text: `Stufe „${stageName(next.minStage)}“` });
    for (const other of measure.excludes ?? []) {
      const name = CARE_BY_ID.get(other)?.name ?? other;
      requirements.push({ key: `excludes:${other}`, met: careRank(state, other) === 0, text: `nicht zusammen mit „${name}“` });
    }
    if (measure.requires && measure.requires.length > 0) {
      const ctx = appearsContext(ecosystemOf(state));
      measure.requires.forEach((condition, i) => {
        requirements.push({ key: `requires:${i}`, met: speciesAppears(ctx, { appears: [condition] }), text: `braucht ${conditionName(condition)}` });
      });
    }
    const missing = Math.ceil(next.cost - state.seeds);
    requirements.push({
      key: 'seeds',
      met: missing <= 0,
      text: missing > 0 ? `${formatNumber(next.cost)} 🌰 (noch ${formatNumber(missing)} 🌰)` : `${formatNumber(next.cost)} 🌰`,
    });
  }

  return { item, text: measure.text, preview: carePreviewText(item.preview), ranks, requirements };
}
