import { describe, expect, it } from 'vitest';
import { CARE_V16 as CARE, CARE_V16_BY_ID as CARE_BY_ID } from './fixtures/care-v16';
import { CARDS_PER_ENCOUNTER, DECLINE_SEED_SECONDS } from '../src/content/encounters';
import { EVENTS } from '../src/content/events';
import { NICHES_BY_ID } from '../src/content/niches';
import { PLANTS } from '../src/content/plants';
import {
  CARE_TO_RESEARCH,
  RESEARCH,
  RESEARCH_BRANCHES,
  RESEARCH_BY_ID,
  RESEARCH_FORKS,
  type ResearchNode,
} from '../src/content/research';
import {
  MAX_SOWING_CARDS,
  SOWING_BASE,
  SOWING_GROWTH,
  SOWING_MIN_COST_FACTOR,
  SOWING_MIN_STAGE,
  SPRING_SOWING_FACTOR,
} from '../src/content/sowing';
import { SPECIES, TAG_NAMES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { GENERA, PLANT_GROUPS } from '../src/content/types';
import { VISITORS } from '../src/content/visitors';

/**
 * Inhaltstests Forschungsbaum und Aussaat (docs/DESIGN_V2.md 27.6/27.7). Noch keine
 * Logik: Die Daten werden erst in Phase 10, 2a/2b verdrahtet.
 */

const unique = <T>(xs: readonly T[]): boolean => new Set(xs).size === xs.length;
const node = (id: string): ResearchNode => RESEARCH_BY_ID.get(id)!;
const prereqs = (n: ResearchNode): string[] => [...(n.requires ?? []), ...(n.requiresAny ?? [])];
const HAIN = STAGES.findIndex((s) => s.id === 'grove');

/** Kosten aller Knoten ohne die zweite Seite jeder Gabel (= ein vollständiger Weg). */
function onePathCost(maxStage: number): number {
  const skipped = new Set(RESEARCH_FORKS.flatMap((f) => f.paths[1]));
  return RESEARCH.filter((n) => !skipped.has(n.id) && n.minStage <= maxStage).reduce((s, n) => s + n.cost, 0);
}

describe('Forschungsbaum: Aufbau (27.7)', () => {
  it('6 Äste, 32 Knoten, 5 Gabeln; IDs eindeutig, auch gegenüber Arten, Pflanzen, Ereignissen, Gästen', () => {
    expect(RESEARCH_BRANCHES).toHaveLength(6);
    expect(RESEARCH).toHaveLength(32);
    expect(RESEARCH_FORKS).toHaveLength(5);
    expect(RESEARCH_BY_ID.size).toBe(RESEARCH.length);
    expect(unique(RESEARCH.map((n) => n.name))).toBe(true);
    expect(unique(RESEARCH_BRANCHES.map((b) => b.id))).toBe(true);
    expect(unique(RESEARCH_BRANCHES.map((b) => b.name))).toBe(true);
    expect(unique(RESEARCH_BRANCHES.map((b) => b.color))).toBe(true);
    const ids = [
      ...RESEARCH.map((n) => n.id),
      ...SPECIES.map((x) => x.id),
      ...PLANTS.map((x) => x.id),
      ...EVENTS.map((x) => x.id),
      ...VISITORS.map((x) => x.id),
    ];
    expect(unique(ids)).toBe(true);
  });

  it('Äste: Name, Symbol, Farbe; jeder Ast hat Knoten', () => {
    for (const b of RESEARCH_BRANCHES) {
      expect(b.name.length, b.id).toBeGreaterThan(0);
      expect(b.icon.length, b.id).toBeGreaterThan(0);
      expect(b.color, b.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(RESEARCH.some((n) => n.branch === b.id), b.id).toBe(true);
    }
    for (const n of RESEARCH) expect(RESEARCH_BRANCHES.map((b) => b.id), n.id).toContain(n.branch);
  });

  it('Texte: Name, Symbol, Kurzwirkung; Stimmungstext ≤ 120 Zeichen, Bestätigung ≤ 30 Zeichen und eindeutig', () => {
    for (const n of RESEARCH) {
      expect(n.name.length, n.id).toBeGreaterThan(0);
      expect(n.icon.length, n.id).toBeGreaterThan(0);
      expect(n.summary.length, n.id).toBeGreaterThan(0);
      expect(n.text.trim().length, n.id).toBeGreaterThan(0);
      expect(n.text.length, n.id).toBeLessThanOrEqual(120);
      expect(n.boughtText.trim().length, n.id).toBeGreaterThan(0);
      expect(n.boughtText.length, n.id).toBeLessThanOrEqual(30);
    }
    expect(unique(RESEARCH.map((n) => n.boughtText))).toBe(true);
    for (const f of RESEARCH_FORKS) expect(f.question.length, f.id).toBeLessThanOrEqual(120);
  });

  it('Ebenen: Setzling bis Wald; Kosten > 0', () => {
    for (const n of RESEARCH) {
      expect(Number.isInteger(n.minStage), n.id).toBe(true);
      expect(n.minStage, n.id).toBeGreaterThanOrEqual(2);
      expect(n.minStage, n.id).toBeLessThanOrEqual(6);
      expect(n.minStage, n.id).toBeLessThan(STAGES.length);
      expect(Number.isInteger(n.cost), n.id).toBe(true);
      expect(n.cost, n.id).toBeGreaterThan(0);
    }
  });
});

describe('Forschungsbaum: Voraussetzungen (27.7)', () => {
  it('jede Voraussetzung existiert und steht in RESEARCH weiter oben (Reihenfolge der Migration)', () => {
    RESEARCH.forEach((n, i) => {
      for (const p of prereqs(n)) {
        expect(RESEARCH_BY_ID.has(p), `${n.id} → ${p}`).toBe(true);
        expect(p, n.id).not.toBe(n.id);
        expect(RESEARCH.findIndex((x) => x.id === p), `${n.id} → ${p}`).toBeLessThan(i);
      }
      expect(unique(prereqs(n)), n.id).toBe(true);
      if (n.requiresAny) expect(n.requiresAny.length, n.id).toBeGreaterThanOrEqual(2);
    });
  });

  it('der Graph ist kreisfrei', () => {
    const state = new Map<string, 'open' | 'done'>();
    const visit = (id: string, path: string[]): void => {
      if (state.get(id) === 'done') return;
      expect(state.get(id), `Kreis: ${[...path, id].join(' → ')}`).not.toBe('open');
      state.set(id, 'open');
      for (const p of prereqs(node(id))) visit(p, [...path, id]);
      state.set(id, 'done');
    };
    for (const n of RESEARCH) visit(n.id, []);
  });

  it('Voraussetzungen nur auf früherer oder gleicher Ebene und billiger (Kosten steigen entlang des Zweigs)', () => {
    for (const n of RESEARCH) {
      for (const p of prereqs(n)) {
        expect(node(p).minStage, `${n.id} → ${p}`).toBeLessThanOrEqual(n.minStage);
        expect(node(p).cost, `${n.id} → ${p}`).toBeLessThan(n.cost);
      }
    }
  });

  it('jeder Ast beginnt auf seiner ersten Ebene ohne Voraussetzung aus dem eigenen Ast (fremde nur von früherer Ebene)', () => {
    // Der Waldtümpel (Wasser, Alter Baum) braucht den Kompost (Boden, Setzling) – ein Netz, keine Leiter.
    for (const b of RESEARCH_BRANCHES) {
      const nodes = RESEARCH.filter((n) => n.branch === b.id);
      const first = Math.min(...nodes.map((n) => n.minStage));
      const roots = nodes.filter((n) => n.minStage === first);
      for (const r of roots) {
        for (const p of prereqs(r)) {
          expect(node(p).branch, `${r.id} → ${p}`).not.toBe(b.id);
          expect(node(p).minStage, `${r.id} → ${p}`).toBeLessThan(r.minStage);
        }
      }
    }
    expect(RESEARCH.filter((n) => prereqs(n).length === 0).length).toBeGreaterThanOrEqual(5);
  });

  it('Bedingungen sind gültig (nur Gattung, Gruppe, Merkmal)', () => {
    for (const n of RESEARCH) {
      for (const c of n.condition ?? []) {
        expect(['tag', 'group', 'genus'], n.id).toContain(c.kind);
        if (c.kind === 'genus') expect(GENERA, n.id).toContain(c.genus);
        if (c.kind === 'group') expect(PLANT_GROUPS, n.id).toContain(c.group);
        if (c.kind === 'tag') expect(TAG_NAMES[c.tag], n.id).toBeDefined();
      }
    }
  });
});

describe('Forschungsbaum: Gabeln (27.7)', () => {
  it('zwei Wege, Ebene für Ebene gleich teuer, gleiche Stufe, gleicher Ast; jeder Knoten höchstens in einer Gabel', () => {
    const seen: string[] = [];
    for (const f of RESEARCH_FORKS) {
      const [a, b] = f.paths;
      expect(a.length, f.id).toBeGreaterThan(0);
      expect(a.length, f.id).toBe(b.length);
      a.forEach((id, i) => {
        const x = node(id);
        const y = node(b[i]!);
        expect(x, id).toBeDefined();
        expect(y, b[i]).toBeDefined();
        expect(x.cost, `${f.id}: ${x.id} ↔ ${y.id}`).toBe(y.cost);
        expect(x.minStage, `${f.id}: ${x.id} ↔ ${y.id}`).toBe(y.minStage);
        expect(x.branch, `${f.id}: ${x.id} ↔ ${y.id}`).toBe(y.branch);
        // Spätere Ebenen eines Weges bauen auf der vorigen auf.
        if (i > 0) {
          expect(x.requires, x.id).toContain(a[i - 1]);
          expect(y.requires, y.id).toContain(b[i - 1]);
        }
      });
      seen.push(...a, ...b);
    }
    expect(unique(seen)).toBe(true);
  });

  it('jeder Knoten eines Weges schließt jeden des anderen aus (gegenseitig); sonst gibt es keine Ausschlüsse', () => {
    const inFork = new Set<string>();
    for (const f of RESEARCH_FORKS) {
      const [a, b] = f.paths;
      for (const [mine, other] of [[a, b], [b, a]] as const) {
        for (const id of mine) {
          inFork.add(id);
          expect([...(node(id).excludes ?? [])].sort(), id).toEqual([...other].sort());
        }
      }
    }
    for (const n of RESEARCH) {
      if (!inFork.has(n.id)) expect(n.excludes ?? [], n.id).toEqual([]);
      for (const x of n.excludes ?? []) expect(node(x).excludes ?? [], `${n.id} ↔ ${x}`).toContain(n.id);
    }
  });

  it('kein Knoten braucht beide Seiten einer Gabel', () => {
    for (const n of RESEARCH) {
      for (const f of RESEARCH_FORKS) {
        const req = n.requires ?? [];
        const both = f.paths[0].some((id) => req.includes(id)) && f.paths[1].some((id) => req.includes(id));
        expect(both, `${n.id} / ${f.id}`).toBe(false);
      }
    }
  });
});

describe('Forschungsbaum: Wirkungen (27.7)', () => {
  it('Wirkungen gültig, in Grenzen, jeder Knoten bringt etwas (Abzüge nur bei Licht/Wasser)', () => {
    for (const n of RESEARCH) {
      expect(n.effects.length, n.id).toBeGreaterThan(0);
      let positive = 0;
      for (const e of n.effects) {
        switch (e.kind) {
          case 'habitat':
            expect(TAG_NAMES[e.tag], n.id).toBeDefined();
            positive++;
            break;
          case 'happiness':
            expect(GENERA, n.id).toContain(e.genus);
            expect(e.points, n.id).toBeGreaterThan(0);
            expect(e.points, n.id).toBeLessThanOrEqual(15);
            positive++;
            break;
          case 'sowCards':
            expect(e.amount, n.id).toBe(1);
            positive++;
            break;
          case 'sowCost':
            expect(e.pct, n.id).toBeLessThan(0);
            expect(1 + e.pct / 100, n.id).toBeGreaterThanOrEqual(SOWING_MIN_COST_FACTOR);
            positive++;
            break;
          case 'sowFreeReroll':
            expect(e.amount, n.id).toBe(1);
            positive++;
            break;
          case 'cycle': {
            const x = e.effect;
            switch (x.kind) {
              case 'slot':
                expect(NICHES_BY_ID.has(x.niche), n.id).toBe(true);
                expect([1, 2], n.id).toContain(x.amount);
                positive++;
                break;
              case 'light':
              case 'water':
                expect(Math.abs(x.amount), n.id).toBeLessThanOrEqual(3);
                expect(x.amount, n.id).not.toBe(0);
                if (x.amount > 0) positive++;
                break;
              case 'harmony':
                expect(x.points, n.id).toBeGreaterThan(0);
                expect(x.points, n.id).toBeLessThanOrEqual(5);
                positive++;
                break;
              default:
                expect(x.pct, n.id).toBeGreaterThan(0);
                expect(x.pct, n.id).toBeLessThanOrEqual(40);
                if (x.kind === 'groupGrowth' || x.kind === 'groupSeeds') expect(PLANT_GROUPS).toContain(x.group);
                positive++;
            }
          }
        }
      }
      expect(positive, `${n.id}: ${n.summary}`).toBeGreaterThan(0);
    }
  });

  it('keine Prozent-Boni auf die Harmonie (27.3, 27.14): Harmonie nur als +N Punkte', () => {
    for (const n of RESEARCH) {
      for (const e of n.effects) {
        if (e.kind === 'cycle' && e.effect.kind === 'harmony') expect(Number.isInteger(e.effect.points), n.id).toBe(true);
      }
    }
  });

  it('Aussaat-Karten: 3 + Σ sowCards ≤ MAX_SOWING_CARDS', () => {
    const extra = RESEARCH.flatMap((n) => n.effects).reduce((s, e) => s + (e.kind === 'sowCards' ? e.amount : 0), 0);
    expect(CARDS_PER_ENCOUNTER + extra).toBeLessThanOrEqual(MAX_SOWING_CARDS);
  });
});

describe('Forschungsbaum: Pflege → Knoten (Migration 27.9)', () => {
  it('jede heutige Pflege-Stufe hat genau einen Knoten mit gleicher Wirkung und gleicher Stufe', () => {
    expect(Object.keys(CARE_TO_RESEARCH).sort()).toEqual(CARE.map((c) => c.id).sort());
    const mapped: string[] = [];
    let ranks = 0;
    for (const c of CARE) {
      const ids = CARE_TO_RESEARCH[c.id]!;
      expect(ids.length, c.id).toBe(c.ranks.length);
      c.ranks.forEach((r, i) => {
        const n = node(ids[i]!);
        expect(n, `${c.id} Rang ${i + 1}`).toBeDefined();
        expect(n.effects, `${c.id} Rang ${i + 1} → ${n.id}`).toEqual(r.effects);
        expect(n.minStage, `${c.id} Rang ${i + 1} → ${n.id}`).toBe(r.minStage);
        expect(n.summary, `${c.id} Rang ${i + 1} → ${n.id}`).toBe(r.summary);
        ranks++;
      });
      mapped.push(...ids);
    }
    expect(ranks).toBe(25);
    expect(unique(mapped)).toBe(true);
    // 25 Ränge → 25 Knoten, dazu 7 neue.
    expect(RESEARCH.length - mapped.length).toBe(7);
  });

  it('Rang 1 behält die ID der Maßnahme (Album-Verweise „Zur Forschung“)', () => {
    for (const c of CARE) expect(CARE_TO_RESEARCH[c.id]![0], c.id).toBe(c.id);
  });

  it('Bedingungen und Ausschlüsse der Pflege bleiben erhalten', () => {
    for (const c of CARE) {
      const first = node(c.id);
      expect(first.condition ?? [], c.id).toEqual(c.requires ?? []);
      for (const x of c.excludes ?? []) expect(first.excludes ?? [], c.id).toContain(x);
    }
    expect(CARE_BY_ID.get('light-crown')!.excludes).toContain('dense-crown');
  });

  it('spätere Ränge hängen am Knoten des vorigen Rangs (direkt oder über `requiresAny`)', () => {
    for (const [care, ids] of Object.entries(CARE_TO_RESEARCH)) {
      for (let i = 1; i < ids.length; i++) {
        const n = node(ids[i]!);
        const reachable = new Set<string>();
        const walk = (id: string): void => {
          for (const p of prereqs(node(id))) {
            if (!reachable.has(p)) {
              reachable.add(p);
              walk(p);
            }
          }
        };
        walk(n.id);
        expect(reachable.has(ids[i - 1]!), `${care}: ${n.id}`).toBe(true);
      }
    }
  });
});

describe('Forschungsbaum: Kosten (27.7, Budget je Ebene)', () => {
  it('vor dem Hain kostet ein Weg mehr, als der Harmonie-Spieler bis dahin sammelt (5.457 ⚖️)', () => {
    expect(onePathCost(HAIN - 1)).toBeGreaterThan(5_457);
  });

  it('ein ganzer Weg kostet mehr, als bis zum Urwald zufließt (Harmonie-Spieler 19.306 ⚖️) – man wählt', () => {
    expect(onePathCost(STAGES.length)).toBeGreaterThan(19_306);
  });
});

describe('Aussaat-Konstanten (27.6)', () => {
  /** Preis ohne Rabatt und Saatzeit, wie in 27.6 (n ≥ 1). */
  const price = (n: number): number => Math.ceil(SOWING_BASE * Math.pow(SOWING_GROWTH, n - 1));

  it('Preistabelle aus DESIGN_V2.md 27.6', () => {
    const table = [20, 35, 62, 108, 188, 329, 575, 1_006, 1_760, 3_079, 5_388, 9_429, 16_501, 28_876, 50_532, 88_431];
    expect(table.map((_, i) => price(i + 1))).toEqual(table);
  });

  it('ab Keimling, Frühling günstiger, Rabatt-Untergrenze, 4 Karten', () => {
    expect(SOWING_MIN_STAGE).toBe(STAGES.findIndex((s) => s.plantSlots > 0));
    expect(SPRING_SOWING_FACTOR).toBeGreaterThan(0);
    expect(SPRING_SOWING_FACTOR).toBeLessThan(1);
    expect(SOWING_MIN_COST_FACTOR).toBeGreaterThan(0);
    expect(SOWING_MIN_COST_FACTOR).toBeLessThan(1);
    expect(MAX_SOWING_CARDS).toBe(CARDS_PER_ENCOUNTER + 1);
    // Zurücklegen zahlt wie Ablehnen (27.6).
    expect(DECLINE_SEED_SECONDS).toBe(10);
  });
});
