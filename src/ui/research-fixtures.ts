/**
 * Beispielzustände für den Forschungsbaum (Vorschau `research-preview.html` und Tests).
 *
 * PLATZHALTER bis Phase 10, 4a: Die Ableitung hier ahmt die Blocker-Reihenfolge aus 27.7
 * nach (erforscht, Stufe, Gabel, Voraussetzung, Bedingung, zu teuer), damit die Vorschau
 * stimmige Zustände zeigt. Im Spiel kommt der Zustand aus `researchBlocker` des Spielstands
 * (`researchStatusFromBlocker`) – diese Datei wird dort nicht benutzt.
 */
import { RESEARCH } from '../content/research';
import type { ResearchNodeState, ResearchTreeState } from './research-view';

export interface ResearchFixtureInput {
  stage: number;
  harmony: number;
  perMinute: number;
  researched: readonly string[];
  /** Bedingungen (z. B. ≥ 1 Insekt) erfüllt? Standard: ja. */
  conditionsMet?: boolean;
}

export function fixtureState(input: ResearchFixtureInput): ResearchTreeState {
  const owned = new Set(input.researched);
  const nodes: Record<string, ResearchNodeState> = {};
  for (const node of RESEARCH) {
    if (owned.has(node.id)) nodes[node.id] = { status: 'researched' };
    else if (input.stage < node.minStage) nodes[node.id] = { status: 'locked', lock: 'stage' };
    else if ((node.excludes ?? []).some((id) => owned.has(id))) nodes[node.id] = { status: 'excluded' };
    else if (
      !(node.requires ?? []).every((id) => owned.has(id)) ||
      (node.requiresAny !== undefined && !node.requiresAny.some((id) => owned.has(id)))
    )
      nodes[node.id] = { status: 'locked', lock: 'requires' };
    else if (node.condition && input.conditionsMet === false) nodes[node.id] = { status: 'locked', lock: 'condition' };
    else if (node.cost > input.harmony) nodes[node.id] = { status: 'saving' };
    else nodes[node.id] = { status: 'available' };
  }
  return { harmony: input.harmony, perMinute: input.perMinute, stage: input.stage, nodes };
}

export type ResearchFixtureId = 'start' | 'middle' | 'late';

/** Die drei Beispielstände der Vorschau. */
export const RESEARCH_FIXTURES: Readonly<Record<ResearchFixtureId, { name: string; input: ResearchFixtureInput }>> = {
  // Junger Baum, erste Knoten: Kompost erforscht, Insekten fehlen noch.
  start: {
    name: 'Anfang (Junger Baum)',
    input: { stage: 3, harmony: 260, perMinute: 24, researched: ['compost'], conditionsMet: false },
  },
  // Hain: Krone licht gewählt, Saat-Gabel mit Samenbank entschieden, Boden- und Wasser-Gabel offen.
  middle: {
    name: 'Mitte (Hain, Gabeln gewählt)',
    input: {
      stage: 5,
      harmony: 900,
      perMinute: 110,
      researched: [
        'compost', 'leaf-litter', 'nest-boxes', 'wildflower-hem', 'seed-sorting', 'meadow',
        'light-crown', 'deadwood-pile', 'pond', 'insect-hotel', 'seed-bank',
      ],
    },
  },
  // Wald: fast alles erforscht, Dichte Krone gewählt.
  late: {
    name: 'Fast alles (Wald)',
    input: {
      stage: 6,
      harmony: 1_800,
      perMinute: 240,
      researched: [
        'compost', 'leaf-litter', 'deadwood-pile', 'humus', 'fungus-garden',
        'pond', 'spring-brook',
        'nest-boxes', 'dense-crown', 'nest-boxes-2', 'dense-crown-2',
        'wildflower-hem', 'hem-wide', 'insect-hotel', 'bee-wall', 'insect-hotel-3',
        'meadow', 'meadow-2', 'drystone-wall',
        'seed-sorting', 'nursery', 'dead-hedge',
      ],
    },
  },
};
