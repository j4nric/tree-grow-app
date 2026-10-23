import { describe, expect, it } from 'vitest';
import { RESEARCH, RESEARCH_BRANCHES, RESEARCH_BY_ID, RESEARCH_FORKS } from '../src/content/research';
import { fixtureState, RESEARCH_FIXTURES } from '../src/ui/research-fixtures';
import {
  assignLanes,
  branchSummary,
  edgeSide,
  researchForkView,
  researchHeader,
  researchLayout,
  researchNodeView,
  researchStatusFromBlocker,
  type ResearchSlot,
  type ResearchTreeState,
} from '../src/ui/research-view';

/** Forschungsbaum als Ansicht (Phase 10, 1c): Aufbau und Zustand → Texte, Klassen, aria. */

const NBSP = ' ';
const state = (researched: string[], stage = 5, harmony = 1_000, perMinute = 60, conditionsMet = true): ResearchTreeState =>
  fixtureState({ researched, stage, harmony, perMinute, conditionsMet });

const slotIds = (slot: ResearchSlot): string[] => (slot.kind === 'node' ? [slot.id] : [...slot.ids]);

describe('researchLayout', () => {
  const layout = researchLayout();

  it('sechs Äste, fünf Ebenen (Setzling bis Wald)', () => {
    expect(layout.branches.map((b) => b.branch.id)).toEqual(RESEARCH_BRANCHES.map((b) => b.id));
    expect(layout.stages).toEqual([2, 3, 4, 5, 6]);
  });

  it('jeder Knoten steht genau einmal auf der Ebene seiner Stufe im eigenen Ast', () => {
    const seen: string[] = [];
    for (const b of layout.branches) {
      for (const tier of b.tiers) {
        expect(tier.row).toBe(layout.stages.indexOf(tier.stage));
        for (const slot of tier.slots) {
          for (const id of slotIds(slot)) {
            const node = RESEARCH_BY_ID.get(id)!;
            expect(node.branch).toBe(b.branch.id);
            expect(node.minStage).toBe(tier.stage);
            seen.push(id);
          }
        }
      }
    }
    expect(seen.sort()).toEqual(RESEARCH.map((n) => n.id).sort());
  });

  it('Gabeln als Paar Weg A / Weg B; die Frage nur an der ersten Ebene', () => {
    const forkSlots = layout.branches.flatMap((b) => b.tiers.flatMap((t) => t.slots)).filter((s) => s.kind === 'fork');
    // Krone über drei Ebenen, die übrigen vier je eine
    expect(forkSlots).toHaveLength(7);
    for (const fork of RESEARCH_FORKS) {
      const mine = forkSlots.filter((s) => s.forkId === fork.id);
      expect(mine.map((s) => s.ids)).toEqual(fork.paths[0].map((a, i) => [a, fork.paths[1][i]]));
      expect(mine.map((s) => s.first)).toEqual(fork.paths[0].map((_, i) => i === 0));
    }
  });

  it('Linien nur innerhalb eines Asts; Weg B einer Gabel läuft rechts', () => {
    for (const e of layout.edges) expect(RESEARCH_BY_ID.get(e.from)!.branch).toBe(RESEARCH_BY_ID.get(e.to)!.branch);
    expect(layout.edges).toContainEqual({ from: 'nest-boxes', to: 'dense-crown', any: false });
    expect(layout.edges).toContainEqual({ from: 'bee-wall', to: 'insect-hotel-3', any: true });
    // Querverweis statt Linie: Waldtümpel braucht Kompost (anderer Ast)
    expect(layout.edges.some((e) => e.to === 'pond')).toBe(false);
    expect(edgeSide({ from: 'nest-boxes', to: 'dense-crown', any: false })).toBe('right');
    expect(edgeSide({ from: 'nest-boxes', to: 'light-crown', any: false })).toBe('left');
    expect(edgeSide({ from: 'bee-wall', to: 'insect-hotel-3', any: true })).toBe('right');
    expect(edgeSide({ from: 'nest-boxes', to: 'nest-boxes-2', any: false })).toBe('left');
  });
});

describe('assignLanes', () => {
  it('überlappende Strecken bekommen getrennte Spuren, je Gruppe', () => {
    const lanes = assignLanes([
      { key: 'a', group: 'x', top: 0, bottom: 100 },
      { key: 'b', group: 'x', top: 50, bottom: 200 },
      { key: 'c', group: 'x', top: 120, bottom: 300 },
      { key: 'd', group: 'y', top: 60, bottom: 90 },
    ]);
    expect(Object.fromEntries(lanes)).toEqual({ a: 0, b: 1, c: 0, d: 0 });
  });
});

describe('researchStatusFromBlocker', () => {
  it('bildet die Blocker des Spielstands ab', () => {
    expect(researchStatusFromBlocker(null)).toEqual({ status: 'available' });
    expect(researchStatusFromBlocker('owned')).toEqual({ status: 'researched' });
    expect(researchStatusFromBlocker('too-expensive')).toEqual({ status: 'saving' });
    expect(researchStatusFromBlocker('excluded')).toEqual({ status: 'excluded' });
    expect(researchStatusFromBlocker('requires')).toEqual({ status: 'locked', lock: 'requires' });
    expect(researchStatusFromBlocker('condition')).toEqual({ status: 'locked', lock: 'condition' });
    expect(researchStatusFromBlocker('stage')).toEqual({ status: 'locked', lock: 'stage' });
  });
});

describe('researchNodeView', () => {
  it('erforschbar: Knopf aktiv mit Kosten', () => {
    const v = researchNodeView('light-crown', state(['nest-boxes']));
    expect(v.status).toBe('available');
    expect(v.classes).toEqual(['is-available', 'is-fork']);
    expect(v.disabled).toBe(false);
    expect(v.showAction).toBe(true);
    expect(v.actionText).toBe(`Erforschen · ⚖️${NBSP}550`);
    expect(v.actionLabel).toBe('Lichte Krone erforschen, 550 Harmonie');
    expect(v.reason).toBeNull();
  });

  it('erforscht: Stempel statt Knopf', () => {
    const v = researchNodeView('compost', state(['compost']));
    expect(v.classes).toEqual(['is-researched']);
    expect(v.showAction).toBe(false);
    expect(v.statusText).toBe('erforscht');
  });

  it('zu wenig ⚖️: Fehlbetrag und Wartezeit aus der Produktion', () => {
    const v = researchNodeView('pond', state(['compost'], 4, 880, 60));
    expect(v.status).toBe('saving');
    expect(v.disabled).toBe(true);
    expect(v.actionText).toBe(`Noch 120${NBSP}⚖️ · ~2 Min.`);
    expect(v.reason).toBe('Es fehlen noch 120 Harmonie (etwa 2 Min.).');
    // ohne Produktion keine Wartezeit
    expect(researchNodeView('pond', state(['compost'], 4, 880, 0)).actionText).toBe(`Noch 120${NBSP}⚖️`);
  });

  it('gesperrt nach Stufe, Voraussetzung und Bedingung – Grund vorlesbar', () => {
    const stage = researchNodeView('pond', state([], 3));
    expect(stage.classes).toEqual(['is-locked', 'lock-stage']);
    expect(stage.actionText).toBe('ab Alter Baum');
    expect(stage.actionLabel).toBe('Waldtümpel: Gesperrt: erst ab Alter Baum.');

    const req = researchNodeView('humus', state(['compost']));
    expect(req.classes).toContain('lock-requires');
    expect(req.actionText).toBe('braucht Laub liegen lassen');

    const both = researchNodeView('humus', state([]));
    expect(both.actionText).toBe('braucht Kompost und Laub liegen lassen');

    const any = researchNodeView('insect-hotel-3', state(['wildflower-hem', 'insect-hotel'], 6));
    expect(any.actionText).toBe('braucht Blütenvorrat oder Wildbienenwand');

    const cond = researchNodeView('insect-hotel', state(['wildflower-hem'], 4, 1_000, 60, false));
    expect(cond.classes).toContain('lock-condition');
    expect(cond.actionText).toMatch(/^braucht Insekt/);
    expect(cond.disabled).toBe(true);
  });

  it('durch die Gabel ausgeschlossen: nennt den gewählten Weg', () => {
    const v = researchNodeView('dense-crown-2', state(['nest-boxes', 'light-crown']));
    expect(v.status).toBe('excluded');
    expect(v.classes).toEqual(['is-excluded', 'is-fork']);
    expect(v.actionText).toBe('anderer Weg gewählt');
    expect(v.reason).toBe('Ausgeschlossen: An dieser Gabel ist Lichte Krone gewählt.');
    expect(v.disabled).toBe(true);
  });

  it('Voraussetzungen aus anderen Ästen als Querverweis', () => {
    const v = researchNodeView('dead-hedge', state(['seed-sorting']));
    expect(v.crossRefs).toEqual([
      { id: 'nest-boxes', branch: 'crown', text: '🌳 Nistkästen', label: 'Zu Nistkästen im Ast Krone springen', done: false },
    ]);
    expect(researchNodeView('pond', state(['compost'])).crossRefs[0]!.done).toBe(true);
    expect(researchNodeView('humus', state([])).crossRefs).toEqual([]);
  });
});

describe('researchForkView', () => {
  it('offen: Frage als Hinweis', () => {
    const v = researchForkView('soil', state([]));
    expect(v.chosen).toBeNull();
    expect(v.hint).toBe(`Gabel: ${RESEARCH_FORKS.find((f) => f.id === 'soil')!.question}`);
    expect(v.label).toBe('Gabel Boden: Käferburg oder Pilzgarten, nur ein Weg ist möglich');
  });

  it('entschieden: gewählter Weg, bei der Krone für alle Ebenen', () => {
    const crown = researchForkView('crown', state(['nest-boxes', 'dense-crown']));
    expect(crown.chosen).toBe(1);
    expect(crown.hint).toBe('Gabel entschieden: Dichte Krone – die Wahl gilt für alle Ebenen.');
    expect(researchForkView('seed', state(['seed-sorting', 'seed-bank'])).hint).toBe('Gabel entschieden: Samenbank.');
  });
});

describe('Kopf und Ast-Zusammenfassung', () => {
  it('zählt erforscht / erreichbar, Ausgeschlossenes nicht', () => {
    const s = state(['nest-boxes', 'light-crown'], 5, 10_000);
    expect(branchSummary('crown', s)).toMatchObject({ researched: 2, total: 5, available: 2, text: '2 / 5 erforscht · 2 erforschbar' });
    expect(branchSummary('water', state([], 2)).text).toBe('0 / 3 erforscht');
  });

  it('Vorrat, Produktion, erforschbar', () => {
    const h = researchHeader(state([], 2, 1_234.7, 110));
    expect(h).toEqual({ supply: `⚖️${NBSP}1.234`, rate: '+110/min', available: '2 erforschbar', count: 2 });
    expect(researchHeader(state([], 2, 0)).available).toBe('nichts erforschbar');
  });
});

describe('Beispielzustände', () => {
  it('stimmig: nie beide Wege einer Gabel, jede Gabel-Lage vertreten', () => {
    for (const { input } of Object.values(RESEARCH_FIXTURES)) {
      const owned = new Set(input.researched);
      for (const id of owned) {
        const node = RESEARCH_BY_ID.get(id)!;
        expect(node.minStage).toBeLessThanOrEqual(input.stage);
        for (const ex of node.excludes ?? []) expect(owned.has(ex)).toBe(false);
        for (const req of node.requires ?? []) expect(owned.has(req)).toBe(true);
      }
    }
    const middle = fixtureState(RESEARCH_FIXTURES.middle.input);
    expect(researchForkView('crown', middle).chosen).toBe(0);
    expect(researchForkView('soil', middle).chosen).toBeNull();
    const statuses = new Set(Object.values(middle.nodes).map((n) => n.status));
    expect([...statuses].sort()).toEqual(['available', 'excluded', 'locked', 'researched', 'saving']);
  });
});

describe('Anzeige-Zustand an Gabeln', () => {
  it('anderer Weg gewählt schlägt die Stufe (Dichte Krone III im Hain)', () => {
    const s = state(['nest-boxes', 'light-crown'], 5);
    expect(s.nodes['dense-crown-3']).toEqual({ status: 'locked', lock: 'stage' });
    expect(researchNodeView('dense-crown-3', s).status).toBe('excluded');
    // der eigene Weg bleibt nach Stufe gesperrt
    expect(researchNodeView('light-crown-3', s).actionText).toBe('ab Wald');
  });
});
