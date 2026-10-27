/**
 * Spielstand → Forschungsbaum (docs/DESIGN_V2.md 27.7, 27.8, 28.6, 28.9; ROADMAP Phase 11, 4a).
 *
 * Rein, ohne DOM (Vitest): baut aus dem Spielstand den Zustand, den `research-view.ts` auf
 * Texte und Klassen abbildet – Blocker aus `researchBlocker`, Kosten des nächsten Rangs, Rang,
 * Plan-Nummern des Forschungsplans –, dazu die Zeile unter dem Schalter „Plan des letzten
 * Zyklus folgen“ und den dezenten Hinweis nach Käufen des Plans.
 *
 * Teuer ist nur `researchBlocker` (Bedingungen werten das Ökosystem aus). Darum merkt sich
 * `createResearchStateSource` die Blocker, solange sich Stufe, Forschung und Auswertung nicht
 * ändern; ob ein Knoten erforschbar ist oder gespart wird, entscheidet danach nur der Vorrat.
 */
import { RESEARCH, RESEARCH_BY_ID } from '../content/research';
import { evaluate, harmonyIncome, type Evaluation } from '../core/formulas';
import { effectiveForestMemory } from '../core/landscape';
import type { GameState } from '../core/state';
import {
  nextPlannedResearch,
  researchBlocker,
  researchCost,
  researchRankOf,
  researchUnreachable,
  type ResearchBlocker,
} from '../core/tick';
import { formatNumber } from './format';
import {
  researchStatusFromBlocker,
  researchUnaffordable,
  waitText,
  type ResearchNodeState,
  type ResearchTreeState,
} from './research-view';

/** Vorrat ⚖️ als endliche Zahl ≥ 0. */
export function harmonyPointsOf(state: Pick<GameState, 'harmonyPoints'>): number {
  return Number.isFinite(state.harmonyPoints) && state.harmonyPoints > 0 ? state.harmonyPoints : 0;
}

/** Zufluss in den Vorrat in ⚖️ je Minute (mit Gedächtnisfaktor, 27.3). */
export function harmonyPerMinute(state: GameState, ev: Readonly<Pick<Evaluation, 'harmony'>> = evaluate(state)): number {
  return harmonyIncome(ev.harmony, effectiveForestMemory(state)) * 60;
}

/**
 * Offene Plan-Nummern je Knoten (ab 1): einmalige, solange nicht erforscht; wiederholbare je
 * Rang ein Eintrag, offen, solange der Rang kleiner ist als das k-te Vorkommen. Einträge, die
 * der Plan überspringen würde (andere Gabel, unbekannt), stehen nicht da.
 */
export function researchPlanNumbers(state: GameState): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const plan = state.meta.research?.plan;
  if (!Array.isArray(plan)) return out;
  const owned = state.cycle.research;
  const seen = new Map<string, number>();
  plan.forEach((id, index) => {
    const node = RESEARCH_BY_ID.get(id);
    if (!node) return;
    if (node.repeatable) {
      const k = (seen.get(id) ?? 0) + 1;
      seen.set(id, k);
      if (researchRankOf(state, id) >= k) return;
    } else if (owned.includes(id)) {
      return;
    }
    if (researchUnreachable(node, owned)) return;
    const list = out.get(id) ?? [];
    list.push(index + 1);
    out.set(id, list);
  });
  return out;
}

/** Zustand für den Baum aus fertigen Blockern (Vorrat entscheidet „erforschbar“ / „sparen“). */
export function researchTreeStateFrom(
  state: GameState,
  blockers: Readonly<Record<string, ResearchBlocker | null>>,
  perMinute: number,
): ResearchTreeState {
  const harmony = harmonyPointsOf(state);
  const plan = researchPlanNumbers(state);
  const next = plan.size > 0 ? nextPlannedResearch(state) : null;
  const nodes: Record<string, ResearchNodeState> = {};
  for (const node of RESEARCH) {
    let blocker = blockers[node.id] ?? null;
    const cost = researchCost(state, node.id) ?? node.cost;
    // Vor dem Vorrat ist alles erfüllt: nur der Vorrat entscheidet (ändert sich laufend).
    if (blocker === null || blocker === 'too-expensive') blocker = cost <= harmony ? null : 'too-expensive';
    const s: ResearchNodeState = { ...researchStatusFromBlocker(blocker), cost };
    if (node.repeatable) s.rank = researchRankOf(state, node.id);
    const numbers = plan.get(node.id);
    if (numbers) s.plan = numbers;
    if (next?.id === node.id) s.planNext = true;
    nodes[node.id] = s;
  }
  return { harmony, perMinute, stage: state.stage, nodes, planActive: state.meta.research?.auto === true };
}

/** Blocker aller Knoten (ändert nichts). */
export function researchBlockers(state: GameState): Record<string, ResearchBlocker | null> {
  const out: Record<string, ResearchBlocker | null> = {};
  for (const node of RESEARCH) out[node.id] = researchBlocker(state, node.id);
  return out;
}

/** Zustand des Baums direkt aus dem Spielstand (Tests, einmalige Aufrufe). */
export function researchTreeState(state: GameState, ev: Readonly<Evaluation> = evaluate(state)): ResearchTreeState {
  return researchTreeStateFrom(state, researchBlockers(state), harmonyPerMinute(state, ev));
}

/**
 * Quelle mit Merker: Blocker nur neu, wenn sich Auswertung, Stufe oder Forschung (auch Ränge –
 * jeder Rang hängt eine ID an) geändert haben.
 */
export function createResearchStateSource(): (state: GameState, ev: Readonly<Evaluation>) => ResearchTreeState {
  let lastEv: Readonly<Evaluation> | null = null;
  let lastState: GameState | null = null;
  let key = '';
  let blockers: Record<string, ResearchBlocker | null> = {};
  return (state, ev) => {
    const k = `${state.stage}|${state.cycle.number}|${state.cycle.research.join(',')}`;
    if (ev !== lastEv || state !== lastState || k !== key) {
      lastEv = ev;
      lastState = state;
      key = k;
      blockers = researchBlockers(state);
    }
    return researchTreeStateFrom(state, blockers, harmonyPerMinute(state, ev));
  };
}

// ---------------------------------------------------------------------------------------
// Schalter „Plan des letzten Zyklus folgen“ (27.8, 28.6)
// ---------------------------------------------------------------------------------------

export interface ResearchPlanView {
  /** Es gibt einen Plan (ab dem zweiten Zyklus, wenn im letzten geforscht wurde). */
  hasPlan: boolean;
  /** Schalter an. */
  on: boolean;
  /** Zeile unter dem Schalter. */
  status: string;
}

/** Text, wenn es noch keinen Plan gibt. */
export const PLAN_EMPTY_TEXT =
  'Den Plan schreibt der Neue Zyklus: Er merkt sich, in welcher Reihenfolge du forschst – auch jeden Rang der endlosen Knoten.';

const WAIT_TEXT: Partial<Record<ResearchBlocker, string>> = {
  stage: 'wartet auf die Stufe',
  requires: 'wartet auf eine Voraussetzung',
  condition: 'wartet auf eine Bedingung im Wald',
};

export function researchPlanView(state: GameState, perMinute: number): ResearchPlanView {
  const plan = state.meta.research?.plan;
  const steps = Array.isArray(plan) ? plan.length : 0;
  const on = state.meta.research?.auto === true;
  if (steps === 0) return { hasPlan: false, on, status: PLAN_EMPTY_TEXT };
  const stepsText = steps === 1 ? '1 Schritt' : `${formatNumber(steps)} Schritte`;
  if (!on) return { hasPlan: true, on, status: `Aus – du forschst selbst. Der Plan hat ${stepsText}; die Nummern stehen an den Karten.` };
  const next = nextPlannedResearch(state);
  if (!next) return { hasPlan: true, on, status: 'Plan erledigt – alles Weitere wählst du selbst.' };
  const node = RESEARCH_BY_ID.get(next.id)!;
  const head = `Als Nächstes (Nr. ${formatNumber(next.index + 1)}): ${node.icon} ${node.name}`;
  if (next.blocker === null) return { hasPlan: true, on, status: `${head} – gleich.` };
  if (next.blocker === 'too-expensive') {
    const cost = researchCost(state, next.id) ?? node.cost;
    if (researchUnaffordable(cost)) return { hasPlan: true, on, status: `${head} – unerreichbar, hier hält der Plan.` };
    const missing = Math.max(0, Math.ceil(cost - harmonyPointsOf(state)));
    const wait = waitText(missing, perMinute);
    return { hasPlan: true, on, status: `${head} – noch ${formatNumber(missing)} ⚖️${wait ? ` · ${wait}` : '.'}` };
  }
  return { hasPlan: true, on, status: `${head} – ${WAIT_TEXT[next.blocker] ?? 'wartet'}.` };
}

// ---------------------------------------------------------------------------------------
// Hinweis nach Käufen des Plans (TickReport.research)
// ---------------------------------------------------------------------------------------

/**
 * „🔍 Nach Plan erforscht: 🐞 Käferburg und 🐛 Bodenleben fördern ×2“ – wiederholte Ränge
 * zusammengefasst, höchstens drei Namen. Leer ohne Käufe.
 */
export function planResearchText(ids: readonly string[]): string {
  if (ids.length === 0) return '';
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const names = [...counts].map(([id, n]) => {
    const node = RESEARCH_BY_ID.get(id);
    const name = node ? `${node.icon} ${node.name}` : id;
    return n > 1 ? `${name} ×${formatNumber(n)}` : name;
  });
  const max = 3;
  const list =
    names.length <= 1
      ? names[0]!
      : names.length <= max
        ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`
        : `${names.slice(0, max).join(', ')} und ${formatNumber(names.length - max)} weitere`;
  return `🔍 Nach Plan erforscht: ${list}`;
}
