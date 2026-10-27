/**
 * Ansichtslogik rund um die Forschung (docs/ALBUM_UI.md, A.8 und B.3) – rein, ohne DOM, mit
 * Vitest geprüft: Vorrat im Seitenkopf, Vorschau-Zeile und U:Forschungsknoten
 * (album/pages/care-item-page.ts). Den Baum im Reiter „Forschung“ speist research-state.ts.
 */
import { RESEARCH_BY_ID } from '../content/research';
import { STAGES } from '../content/stages';
import { appearsContext, ecosystemOf, evaluate, harmonyIncome, harmonyIncomeFactor, speciesAppears, type Evaluation } from '../core/formulas';
import { effectiveForestMemory } from '../core/landscape';
import { MAX_HARMONY_POINTS, type GameState } from '../core/state';
import { researchComplete, researchCost } from '../core/tick';
import { conditionName, toCareView } from './adapters';
import { formatNumber } from './format';
import { formatMultiplier, formatSigned, formatSignedPercent } from './view-format';
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

/**
 * Harmonie-Vorrat mit Zufluss für den Seitenkopf, z. B. „⚖️ 1.234 · +110/min“ (DESIGN_V2.md
 * 27.3/27.12; der Zufluss mit Gedächtnisfaktor, also ⚖️ je Minute in den Vorrat).
 */
export function harmonyWalletText(state: GameState, ev: Readonly<Pick<Evaluation, 'harmony'>> = evaluate(state)): string {
  const points = Number.isFinite(state.harmonyPoints) ? Math.max(0, state.harmonyPoints) : 0;
  const perMinute = harmonyIncome(ev.harmony, effectiveForestMemory(state)) * 60;
  return `⚖️ ${formatNumber(Math.floor(points))} · +${formatNumber(Math.floor(perMinute))}/min`;
}

/** Drei Zeilen oben auf U:Harmonie (DESIGN_V2.md 27.12): Produktion, Vorrat, Bonus. */
export interface HarmonyOverview {
  production: string;
  supply: string;
  bonus: string;
}

/**
 * „110/min“ (Produktion = Harmonie, Summe der Bausteine), „⚖️ 1.234 · +217/min (Gedächtnis
 * ×1,97)“ (Vorrat mit Zufluss; Gedächtnis nur, wenn es den Zufluss hebt) und „Wachstum ×2,10 –
 * aus der Produktion, Ausgeben senkt ihn nicht“ (27.4).
 */
export function harmonyOverview(state: GameState, harmony: number, multiplier: number): HarmonyOverview {
  const production = Math.max(0, Number.isFinite(harmony) ? harmony : 0);
  const factor = harmonyIncomeFactor(effectiveForestMemory(state));
  const memory = factor > 1.005 ? ` (Gedächtnis ${formatMultiplier(factor)})` : '';
  return {
    production: `${formatNumber(Math.round(production))}/min`,
    supply: `${harmonyWalletText(state, { harmony: production })}${memory}`,
    bonus: `Wachstum ${formatMultiplier(multiplier)} – aus der Produktion, Ausgeben senkt ihn nicht`,
  };
}

/** Balkenbreite in Prozent mit einer Nachkommastelle (CSS-Variable). */
export function barWidth(progress: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return `${Math.round(clamped * 1000) / 10}%`;
}

// --- U:Forschungsknoten (früher U:Pflegemaßnahme) --------------------------------------

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
 * Alles für die Unterseite eines Forschungsknotens – auch für Knoten späterer Stufen (der Baum
 * zeigt alle). null, wenn es ihn nicht gibt.
 */
export function toCareItemView(state: GameState, id: string, now: Readonly<Evaluation> = evaluate(state)): CareItemView | null {
  const node = RESEARCH_BY_ID.get(id);
  if (!node) return null;
  const item = toCareView(state, node, now);
  const stageName = (index: number) => STAGES[index]?.name ?? '';
  const requirements: CareRequirement[] = [];
  if (!researchComplete(state, id)) {
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
    // Wiederholbare Knoten (28.6): Kosten des nächsten Rangs.
    const cost = researchCost(state, id) ?? node.cost;
    const missing = Math.ceil(cost - points);
    requirements.push({
      key: 'harmony',
      met: missing <= 0,
      text: !(cost <= MAX_HARMONY_POINTS)
        ? `${formatNumber(cost)} ⚖️ (unerreichbar – mehr, als der Vorrat je fassen kann)`
        : missing > 0
          ? `${formatNumber(cost)} ⚖️ (noch ${formatNumber(missing)} ⚖️)`
          : `${formatNumber(cost)} ⚖️`,
    });
  }
  return { item, text: node.text, preview: carePreviewText(item.preview), ranks: [], requirements };
}
