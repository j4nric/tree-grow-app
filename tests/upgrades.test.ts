import { describe, expect, it } from 'vitest';
import { OFFLINE_FULL_SECONDS, OFFLINE_YIELD } from '../src/content/offline';
import { EVENTS } from '../src/content/events';
import { NICHES_BY_ID } from '../src/content/niches';
import { PLANTS } from '../src/content/plants';
import {
  MAX_RESEARCH_RANK,
  REPEATABLE_RESEARCH_BASE,
  REPEATABLE_RESEARCH_GROWTH,
  RESEARCH,
  RESEARCH_BRANCHES,
  RESEARCH_BY_ID,
  RESEARCH_FORKS,
  RESEARCH_REPEATABLE,
  RESEARCH_REPEATABLE_BY_ID,
} from '../src/content/research';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { NICHE_IDS, PLANT_GROUPS } from '../src/content/types';
import {
  BADGE_NAMES,
  MAX_UPGRADE_LEVEL,
  MILESTONE_NAMES,
  NICHE_MILESTONES,
  NICHE_UPGRADE_BASE,
  NICHE_UPGRADE_PCT,
  TREE_PART_IDS,
  TREE_PARTS,
  TREE_PARTS_BY_ID,
  TREE_UPGRADE_BASE,
  UPGRADE_GROWTH,
  type UpgradeMilestone,
} from '../src/content/upgrades';
import { VISITORS } from '../src/content/visitors';

/**
 * Inhaltstests Ausbau, endlose Forschungsknoten und Offline-Konstanten (docs/DESIGN_V2.md
 * 28.3/28.4/28.6). Noch keine Logik: verdrahtet wird in Phase 11, 1b/2a/2b.
 */

/** Preis der Stufe L → L+1 wie in 28.4 (die Formel baut 2a in core; hier nur für die Daten). */
const price = (base: number, level: number): number => Math.ceil(base * UPGRADE_GROWTH ** level);
const sum = (base: number, levels: number): number => {
  let s = 0;
  for (let l = 0; l < levels; l++) s += price(base, l);
  return s;
};
const unique = <T>(xs: readonly T[]): boolean => new Set(xs).size === xs.length;
const HAIN = STAGES.findIndex((s) => s.id === 'grove');

describe('Ausbau: Konstanten und Preise (28.4)', () => {
  it('Faktor 1,15, +0,1 % je Stufe und Tier, Obergrenze 1.000', () => {
    expect(UPGRADE_GROWTH).toBe(1.15);
    expect(NICHE_UPGRADE_PCT).toBe(0.1);
    expect(MAX_UPGRADE_LEVEL).toBe(1_000);
    // Auch die höchste Stufe bleibt eine endliche Zahl (CLAUDE.md, große Zahlen).
    expect(Number.isFinite(price(600, MAX_UPGRADE_LEVEL))).toBe(true);
  });

  it('jede Nische hat genau einen ganzzahligen Startpreis > 0', () => {
    expect(Object.keys(NICHE_UPGRADE_BASE).sort()).toEqual([...NICHE_IDS].sort());
    for (const id of NICHE_IDS) {
      expect(NICHES_BY_ID.has(id), id).toBe(true);
      expect(Number.isInteger(NICHE_UPGRADE_BASE[id]), id).toBe(true);
      expect(NICHE_UPGRADE_BASE[id], id).toBeGreaterThan(0);
    }
  });

  it('Startpreise wie in der Tabelle 28.4 (frühe Nischen billiger)', () => {
    expect(NICHE_UPGRADE_BASE).toEqual({
      roots: 10, litter: 25, edge: 25, crown: 60, bark: 60, meadow: 60,
      hollows: 250, deadwood: 250, pond: 250, wall: 600,
    });
    // Preise Stufe 1 / 10 / 25 / 50 und Summen bis 10 / 25 / 50 (Wurzelraum, Mauer).
    expect([1, 10, 25, 50].map((k) => price(10, k - 1))).toEqual([10, 36, 287, 9_424]);
    expect([10, 25, 50].map((k) => sum(10, k))).toEqual([209, 2_141, 72_203]);
    expect([1, 10, 25, 50].map((k) => price(600, k - 1))).toEqual([600, 2_111, 17_176, 565_387]);
  });

  it('Preise steigen streng mit jeder Stufe (Nischen und Baumteile)', () => {
    const bases = [...Object.values(NICHE_UPGRADE_BASE), ...TREE_PARTS.map((p) => p.base)];
    for (const b of bases) {
      for (let l = 0; l < 200; l++) expect(price(b, l + 1), `${b} St. ${l}`).toBeGreaterThan(price(b, l));
    }
  });
});

describe('Ausbau: Baumteile (28.4)', () => {
  it('drei Teile, eindeutig, Startpreis 15, Name/Symbol/Kurzwirkung, Text ≤ 120 Zeichen', () => {
    expect(TREE_PARTS.map((p) => p.id)).toEqual(['rings', 'leaves', 'mycorrhiza']);
    expect(TREE_PART_IDS).toEqual(TREE_PARTS.map((p) => p.id));
    expect(TREE_PARTS_BY_ID.size).toBe(3);
    expect(unique(TREE_PARTS.map((p) => p.name))).toBe(true);
    expect(TREE_UPGRADE_BASE).toBe(15);
    for (const p of TREE_PARTS) {
      expect(p.base, p.id).toBe(TREE_UPGRADE_BASE);
      expect(p.name.length, p.id).toBeGreaterThan(0);
      expect(p.icon.length, p.id).toBeGreaterThan(0);
      expect(p.summary.length, p.id).toBeGreaterThan(0);
      expect(p.text.trim().length, p.id).toBeGreaterThan(0);
      expect(p.text.length, p.id).toBeLessThanOrEqual(120);
    }
    // Nicht mit den Nischen Krone und Stamm & Rinde verwechselbar.
    const nicheNames = NICHE_IDS.map((id) => NICHES_BY_ID.get(id)!.name);
    for (const p of TREE_PARTS) expect(nicheNames, p.id).not.toContain(p.name);
  });

  it('Wirkung je Stufe wie 28.4: Jahresringe 0,4 % 🌿, Blattwerk 1 % 🌰, Pilzgeflecht 0,5 %', () => {
    expect(TREE_PARTS_BY_ID.get('rings')!.effect).toEqual({ kind: 'treeGrowth', pct: 0.4 });
    expect(TREE_PARTS_BY_ID.get('leaves')!.effect).toEqual({ kind: 'treeSeeds', pct: 1 });
    expect(TREE_PARTS_BY_ID.get('mycorrhiza')!.effect).toEqual({ kind: 'companions', pct: 0.5 });
    for (const p of TREE_PARTS) {
      expect(p.effect.pct, p.id).toBeGreaterThan(0);
      expect(p.effect.pct, p.id).toBeLessThanOrEqual(1);
    }
  });
});

/** Gemeinsame Prüfung einer Meilenstein-Liste. */
function checkMilestones(list: readonly UpgradeMilestone[], label: string): void {
  // Nach Stufe sortiert, Stufen ganzzahlig in 1 … MAX_UPGRADE_LEVEL.
  const levels = list.map((m) => m.level);
  expect(levels, label).toEqual([...levels].sort((a, b) => a - b));
  // Jeder Meilenstein genau einmal: keine Art doppelt auf derselben Stufe, jedes Abzeichen einmal.
  expect(unique(list.map((m) => `${m.level}:${m.kind}`)), label).toBe(true);
  const badges = list.flatMap((m) => (m.kind === 'badge' ? [m.badge] : []));
  expect(unique(badges), label).toBe(true);
  expect([...badges].sort(), label).toEqual(Object.keys(BADGE_NAMES).sort());
  for (const m of list) {
    const where = `${label} St. ${m.level} ${m.kind}`;
    expect(Number.isInteger(m.level), where).toBe(true);
    expect(m.level, where).toBeGreaterThan(0);
    expect(m.level, where).toBeLessThanOrEqual(MAX_UPGRADE_LEVEL);
    expect(m.summary.length, where).toBeGreaterThan(0);
    expect(m.summary.length, where).toBeLessThanOrEqual(30);
    switch (m.kind) {
      case 'drawWeight':
      case 'rareWeight':
        expect(m.factor, where).toBeGreaterThan(1);
        expect(m.factor, where).toBeLessThanOrEqual(2);
        if (m.kind === 'rareWeight') expect(m.minRarity, where).toBeGreaterThanOrEqual(1);
        break;
      case 'slot':
        expect(m.amount, where).toBe(1);
        if (m.niche) expect(NICHE_IDS, where).toContain(m.niche);
        break;
      case 'light':
      case 'water':
        expect(m.amount, where).toBeGreaterThan(0);
        break;
      case 'badge':
        break;
    }
  }
  // Plätze erst ab 25 (28.2, Folgerung 2: bei 10 heben sie H und das Gedächtnis zu stark).
  for (const m of list) if (m.kind === 'slot') expect(m.level, label).toBeGreaterThanOrEqual(25);
}

describe('Ausbau: Meilensteine (28.4)', () => {
  it('Nischen: 10 öfter in den Karten, 25 +1 Platz (eigene Nische), 50 Seltene ×2; Abzeichen 25/50/75', () => {
    checkMilestones(NICHE_MILESTONES, 'Nische');
    const effects = NICHE_MILESTONES.filter((m) => m.kind !== 'badge').map((m) => [m.level, m.kind]);
    expect(effects).toEqual([[10, 'drawWeight'], [25, 'slot'], [50, 'rareWeight']]);
    for (const m of NICHE_MILESTONES) if (m.kind === 'slot') expect(m.niche).toBeUndefined();
    const badges = NICHE_MILESTONES.flatMap((m) => (m.kind === 'badge' ? [[m.level, m.badge]] : []));
    expect(badges).toEqual([[25, 'bronze'], [50, 'silver'], [75, 'gold']]);
    for (const m of NICHE_MILESTONES) {
      if (m.kind !== 'badge') expect(MILESTONE_NAMES[m.level], `St. ${m.level}`).toBeDefined();
    }
  });

  it('Baumteile: Meilenstein 25 wie 28.4 (Höhle, Krone, 💧), Abzeichen 25/50/75', () => {
    for (const p of TREE_PARTS) checkMilestones(p.milestones, p.id);
    const at25 = (id: 'rings' | 'leaves' | 'mycorrhiza'): UpgradeMilestone[] =>
      TREE_PARTS_BY_ID.get(id)!.milestones.filter((m) => m.level === 25 && m.kind !== 'badge');
    expect(at25('rings')).toMatchObject([{ kind: 'slot', niche: 'hollows', amount: 1 }]);
    expect(at25('leaves')).toMatchObject([{ kind: 'slot', niche: 'crown', amount: 1 }]);
    expect(at25('mycorrhiza')).toMatchObject([{ kind: 'water', amount: 1 }]);
  });
});

describe('Forschung: wiederholbare Knoten (28.6)', () => {
  it('sechs Knoten, einer je Ast; IDs und Namen eindeutig, auch gegenüber dem Baum und allen Inhalten', () => {
    expect(RESEARCH_REPEATABLE).toHaveLength(6);
    expect([...RESEARCH_REPEATABLE.map((n) => n.branch)].sort()).toEqual(RESEARCH_BRANCHES.map((b) => b.id).sort());
    expect(RESEARCH_REPEATABLE_BY_ID.size).toBe(6);
    const ids = [
      ...RESEARCH.map((n) => n.id),
      ...SPECIES.map((x) => x.id),
      ...PLANTS.map((x) => x.id),
      ...EVENTS.map((x) => x.id),
      ...VISITORS.map((x) => x.id),
    ];
    expect(unique(ids)).toBe(true);
    expect(unique(RESEARCH.map((n) => n.name))).toBe(true);
    expect(unique(RESEARCH.map((n) => n.icon))).toBe(true);
    expect(unique(RESEARCH.map((n) => n.boughtText))).toBe(true);
  });

  it('seit Phase 11, 2b in RESEARCH / RESEARCH_BY_ID (hinten); nur sie sind wiederholbar', () => {
    for (const n of RESEARCH_REPEATABLE) expect(RESEARCH_BY_ID.get(n.id), n.id).toBe(n);
    expect(RESEARCH.slice(-RESEARCH_REPEATABLE.length)).toEqual(RESEARCH_REPEATABLE);
    expect(RESEARCH.filter((n) => n.repeatable).map((n) => n.id)).toEqual(RESEARCH_REPEATABLE.map((n) => n.id));
  });

  it('Kosten ⌈1.500 · 1,3^r⌉, Obergrenze 200 Ränge, `cost` = Startpreis', () => {
    expect(REPEATABLE_RESEARCH_BASE).toBe(1_500);
    expect(REPEATABLE_RESEARCH_GROWTH).toBe(1.3);
    expect(MAX_RESEARCH_RANK).toBe(200);
    // Wie 28.6 in JS-Gleitkomma: 1.500 · 1,3² = 2.535,000…05 → 2.536.
    const cost = (r: number): number => Math.ceil(1_500 * 1.3 ** r);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(cost)).toEqual([1_500, 1_950, 2_536, 3_296, 4_285, 5_570, 7_241, 9_413]);
    expect(Number.isFinite(cost(MAX_RESEARCH_RANK))).toBe(true);
    for (const n of RESEARCH_REPEATABLE) {
      expect(n.repeatable, n.id).toEqual({ base: 1_500, growth: 1.3 });
      expect(n.cost, n.id).toBe(n.repeatable!.base);
    }
  });

  it('ab Hain und nur hinter einer Gabel: requiresAny = ein Knoten je Weg der Gabel des Asts', () => {
    for (const n of RESEARCH_REPEATABLE) {
      expect(n.minStage, n.id).toBe(HAIN);
      expect(n.requires ?? [], n.id).toEqual([]);
      expect(n.excludes ?? [], n.id).toEqual([]);
      expect(n.condition ?? [], n.id).toEqual([]);
      const any = n.requiresAny ?? [];
      expect(any, n.id).toHaveLength(2);
      for (const id of any) {
        const p = RESEARCH_BY_ID.get(id);
        expect(p, `${n.id} → ${id}`).toBeDefined();
        expect(p!.branch, `${n.id} → ${id}`).toBe(n.branch);
        expect(p!.minStage, `${n.id} → ${id}`).toBeLessThanOrEqual(n.minStage);
      }
      const fork = RESEARCH_FORKS.find((f) => f.id === n.branch);
      if (fork) {
        // Je ein Knoten aus jedem Weg – egal welcher Weg gewählt wurde, der Knoten öffnet sich.
        expect(fork.paths[0].filter((id) => any.includes(id)), n.id).toHaveLength(1);
        expect(fork.paths[1].filter((id) => any.includes(id)), n.id).toHaveLength(1);
      } else {
        // Offenland hat keine Gabel: seine zwei Hain-Knoten (Spätmahd, Trockenmauer) sind die Abzweigung.
        expect(n.branch).toBe('open');
        expect([...any].sort()).toEqual(
          RESEARCH.filter((x) => x.branch === 'open' && x.minStage === HAIN && !x.repeatable).map((x) => x.id).sort(),
        );
      }
    }
  });

  it('Wirkung je Rang klein und nur 🌿/🌰 von Pflanzengruppen (nie Harmonie, Plätze, Licht, Wasser)', () => {
    for (const n of RESEARCH_REPEATABLE) {
      expect(n.effects.length, n.id).toBeGreaterThan(0);
      for (const e of n.effects) {
        expect(e.kind, n.id).toBe('cycle');
        if (e.kind !== 'cycle') continue;
        expect(['groupGrowth', 'groupSeeds'], n.id).toContain(e.effect.kind);
        if (e.effect.kind !== 'groupGrowth' && e.effect.kind !== 'groupSeeds') continue;
        expect(PLANT_GROUPS, n.id).toContain(e.effect.group);
        expect(e.effect.pct, n.id).toBeGreaterThan(0);
        expect(e.effect.pct, n.id).toBeLessThanOrEqual(5);
      }
    }
  });

  it('Texte: Name, Symbol, Kurzwirkung; Stimmungstext ≤ 120, Bestätigung ≤ 30 Zeichen', () => {
    for (const n of RESEARCH_REPEATABLE) {
      expect(n.name.length, n.id).toBeGreaterThan(0);
      expect(n.icon.length, n.id).toBeGreaterThan(0);
      expect(n.summary, n.id).toMatch(/je Rang$/);
      expect(n.text.trim().length, n.id).toBeGreaterThan(0);
      expect(n.text.length, n.id).toBeLessThanOrEqual(120);
      expect(n.boughtText.trim().length, n.id).toBeGreaterThan(0);
      expect(n.boughtText.length, n.id).toBeLessThanOrEqual(30);
    }
  });
});

describe('Offline (28.3)', () => {
  it('10 % nach 60 vollen Sekunden', () => {
    expect(OFFLINE_YIELD).toBe(0.1);
    expect(OFFLINE_FULL_SECONDS).toBe(60);
    // Beispiel aus content/offline.ts: 2 h fort ≙ 774 s online.
    expect(OFFLINE_FULL_SECONDS + (7_200 - OFFLINE_FULL_SECONDS) * OFFLINE_YIELD).toBeCloseTo(774);
  });
});
