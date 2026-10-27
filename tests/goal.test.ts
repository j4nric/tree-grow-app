import { describe, expect, it } from 'vitest';
import { RESEARCH } from '../src/content/research';
import { NICHE_IDS } from '../src/content/types';
import { MAX_UPGRADE_LEVEL, NICHE_UPGRADE_BASE, TREE_UPGRADE_BASE } from '../src/content/upgrades';
import { evaluate, plantSlots, sowingCost } from '../src/core/formulas';
import { MAX_AFFORDABLE_STEPS, MILESTONE_GOAL_SECONDS, affordableUpgradeSteps, goalCandidates, nextGoal, researchAvailable, secondsUntilAffordable } from '../src/core/goal';
import type { GameState } from '../src/core/state';
import { researchBlocker, upgradeBlocker, upgradeNiche } from '../src/core/tick';
import { upgradeBase, upgradePrice } from '../src/core/upgrades';
import { stateAt } from './helpers';

/*
 * Zielzeile (DESIGN_V2.md 28.7): Kandidaten, Meilenstein-Regel ≤ 120 s, billigster,
 * Gleichstand (Säen, Nischen in NICHE_IDS-Reihenfolge, Baumteile), Zeit aus der Rate, null ohne
 * Kandidat, Anhang „erforschbar“.
 */

/** Keimling mit vollem Pflanzring (kein „Säen“), ohne Samen. */
function sprout(): GameState {
  const s = stateAt(1);
  s.plants = ['moss'].slice(0, plantSlots(1));
  s.seeds = 0;
  return s;
}

describe('nextGoal: Kandidaten', () => {
  it('vor dem Keimling: kein Ziel (null), auch mit Samen und Rate', () => {
    const s = stateAt(0);
    s.seeds = 1e6;
    expect(goalCandidates(s, 5)).toEqual([]);
    expect(nextGoal(s, 5)).toBeNull();
  });

  it('Keimling: Säen (erste Aussaat gratis) vor allem anderen', () => {
    const s = stateAt(1);
    s.plants = [];
    expect(sowingCost(s)).toBe(0);
    expect(nextGoal(s, 1)).toEqual({ kind: 'sow', target: null, level: null, cost: 0, milestones: [], seconds: 0 });
  });

  it('kein Säen bei vollem Ring, offener Aussaat oder ohne Pflanzplatz', () => {
    const full = sprout();
    expect(goalCandidates(full, 1).some((c) => c.kind === 'sow')).toBe(false);
    const open = stateAt(1);
    open.plants = [];
    open.cycle.sowing = { cards: ['moss'], rerolls: 0 };
    expect(goalCandidates(open, 1).some((c) => c.kind === 'sow')).toBe(false);
  });

  it('nur offene Nischen und die drei Baumteile, je die nächste Stufe', () => {
    const s = sprout();
    const list = goalCandidates(s, 1);
    const ids = list.map((c) => c.target?.id);
    expect(ids).toEqual(['roots', 'rings', 'leaves', 'mycorrhiza']);
    for (const id of NICHE_IDS) {
      if (id !== 'roots') expect(upgradeBlocker(s, { kind: 'niche', id }), id).toBe('closed');
    }
    expect(list[0]).toMatchObject({ kind: 'niche', level: 1, cost: NICHE_UPGRADE_BASE.roots, milestones: [] });
    expect(list[1]).toMatchObject({ kind: 'tree', level: 1, cost: TREE_UPGRADE_BASE });
  });

  it('höchste Stufe (MAX_UPGRADE_LEVEL, Preis Infinity) fällt weg', () => {
    const s = sprout();
    s.cycle.upgrades.niches.roots = MAX_UPGRADE_LEVEL;
    expect(goalCandidates(s, 1).some((c) => c.target?.id === 'roots')).toBe(false);
  });

  it('rein: ändert den Spielstand nicht', () => {
    const s = stateAt(4);
    s.seeds = 12_345;
    const before = JSON.stringify(s);
    nextGoal(s);
    researchAvailable(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('nextGoal: Auswahl', () => {
  it('ohne Meilenstein in Reichweite: der billigste (Wurzelraum 10 vor Baumteilen 15)', () => {
    expect(nextGoal(sprout(), 0.3)).toMatchObject({ kind: 'niche', target: { id: 'roots' }, level: 1, cost: 10 });
  });

  it('Meilenstein in ≤ 120 s gewinnt, auch wenn er teurer ist; darüber der billigste', () => {
    const s = sprout();
    s.cycle.upgrades.niches.roots = 9;
    const price = upgradePrice(NICHE_UPGRADE_BASE.roots, 9);
    expect(price).toBeGreaterThan(TREE_UPGRADE_BASE);
    // Genau 120 s: gilt noch.
    const goal = nextGoal(s, price / MILESTONE_GOAL_SECONDS);
    expect(goal).toMatchObject({ target: { id: 'roots' }, level: 10, cost: price, seconds: MILESTONE_GOAL_SECONDS });
    expect(goal!.milestones.map((m) => m.kind)).toEqual(['drawWeight']);
    // Etwas langsamer: der billigste (Jahresringe, Gleichstand der Baumteile).
    expect(nextGoal(s, price / (MILESTONE_GOAL_SECONDS + 1))).toMatchObject({ target: { id: 'rings' }, cost: TREE_UPGRADE_BASE, milestones: [] });
  });

  it('Meilenstein bezahlbar bei Rate 0 gewinnt; nicht bezahlbar bei Rate 0 nicht (Zeit Infinity)', () => {
    const s = sprout();
    s.cycle.upgrades.niches.roots = 24;
    const price = upgradePrice(NICHE_UPGRADE_BASE.roots, 24);
    s.seeds = price;
    expect(nextGoal(s, 0)).toMatchObject({ target: { id: 'roots' }, level: 25, seconds: 0 });
    expect(nextGoal(s, 0)!.milestones.map((m) => m.kind)).toEqual(['slot']);
    s.seeds = price - 1;
    expect(nextGoal(s, 0)).toMatchObject({ target: { id: 'rings' }, seconds: 0 });
    s.seeds = 0;
    expect(goalCandidates(s, 0).find((c) => c.target?.id === 'roots')!.seconds).toBe(Infinity);
    expect(nextGoal(s, 0)).toMatchObject({ target: { id: 'rings' }, seconds: Infinity });
  });

  it('mehrere Meilensteine in Reichweite: der billigste davon', () => {
    const s = stateAt(2);
    s.plants = ['moss', 'fern'].slice(0, plantSlots(2));
    s.cycle.upgrades.niches.roots = 24; // 25: +1 Platz
    s.cycle.upgrades.niches.litter = 9; // 10: öfter in den Karten
    s.seeds = 1e9;
    const roots = upgradePrice(NICHE_UPGRADE_BASE.roots, 24);
    const litter = upgradePrice(NICHE_UPGRADE_BASE.litter, 9);
    expect(litter).toBeLessThan(roots);
    expect(nextGoal(s, 0)).toMatchObject({ target: { id: 'litter' }, level: 10 });
  });

  it('reine Abzeichen (Baumteil 50) sind kein Meilenstein für Regel 2', () => {
    const s = sprout();
    s.cycle.upgrades.tree.rings = 49;
    s.seeds = 1e9;
    const rings = goalCandidates(s, 0).find((c) => c.target?.id === 'rings')!;
    expect(rings.milestones).toEqual([]);
    expect(nextGoal(s, 0)).toMatchObject({ target: { id: 'roots' } });
    // Baumteil 25 (+1 Platz Höhlen) zählt dagegen.
    s.cycle.upgrades.tree.rings = 24;
    expect(nextGoal(s, 0)).toMatchObject({ target: { id: 'rings' }, level: 25 });
  });

  it('Gleichstand: Säen vor Nischen', () => {
    const s = stateAt(1);
    s.plants = [];
    s.cycle.sowings = 1;
    const sow = sowingCost(s);
    const level = Array.from({ length: 60 }, (_, l) => l).find((l) => upgradePrice(NICHE_UPGRADE_BASE.roots, l) === sow);
    expect(level, `Wurzelraum-Stufe mit Preis ${sow}`).toBeDefined();
    s.cycle.upgrades.niches.roots = level!;
    s.cycle.upgrades.tree = { rings: 30, leaves: 30, mycorrhiza: 30 };
    expect(nextGoal(s, 1)).toMatchObject({ kind: 'sow', cost: sow });
  });

  it('Gleichstand: Nischen in NICHE_IDS-Reihenfolge (Laubstreu vor Waldsaum), dann Baumteile', () => {
    const s = stateAt(2);
    s.plants = ['moss', 'fern'].slice(0, plantSlots(2));
    s.cycle.upgrades.niches.roots = 40;
    s.cycle.upgrades.tree = { rings: 30, leaves: 30, mycorrhiza: 30 };
    expect(nextGoal(s, 1)).toMatchObject({ target: { kind: 'niche', id: 'litter' }, cost: NICHE_UPGRADE_BASE.litter });
    // Nische und Baumteil gleich teuer: die Nische.
    const pair = (() => {
      for (let a = 0; a < 80; a++) for (let b = 0; b < 80; b++) if (upgradePrice(NICHE_UPGRADE_BASE.roots, a) === upgradePrice(TREE_UPGRADE_BASE, b)) return [a, b] as const;
      return null;
    })();
    expect(pair).not.toBeNull();
    const t = sprout();
    t.cycle.upgrades.niches.roots = pair![0];
    t.cycle.upgrades.tree = { rings: pair![1], leaves: pair![1], mycorrhiza: pair![1] };
    expect(nextGoal(t, 1e-9)!.target).toEqual({ kind: 'niche', id: 'roots' });
  });

  it('Zeit: fehlende Samen ÷ Rate; Vorgabe ist die Live-Rate aus evaluate', () => {
    const s = sprout();
    s.seeds = 4;
    expect(nextGoal(s, 2)).toMatchObject({ cost: 10, seconds: 3 });
    const rate = evaluate(s).seeds;
    expect(rate).toBeGreaterThan(0);
    expect(nextGoal(s)!.seconds).toBeCloseTo(6 / rate, 9);
  });

  it('Grenzfälle: NaN-Samen zählen als 0, NaN/negative Rate wie 0, riesige Samen = jetzt', () => {
    const s = sprout();
    s.seeds = Number.NaN;
    expect(nextGoal(s, 1)).toMatchObject({ cost: 10, seconds: 10 });
    expect(nextGoal(s, Number.NaN)!.seconds).toBe(Infinity);
    expect(nextGoal(s, -5)!.seconds).toBe(Infinity);
    s.seeds = 1e300;
    expect(nextGoal(s, 0)).toMatchObject({ cost: 10, seconds: 0 });
    expect(secondsUntilAffordable(10, Infinity, 0)).toBe(0);
    expect(secondsUntilAffordable(10, -3, 1)).toBe(10);
  });

  it('nach einem Kauf: die nächste Stufe bzw. ein anderes Ziel', () => {
    const s = sprout();
    s.seeds = 10;
    expect(nextGoal(s, 0)).toMatchObject({ target: { id: 'roots' }, level: 1 });
    expect(upgradeNiche(s, 'roots').ok).toBe(true);
    // Wurzelraum 2 kostet ⌈11,5⌉ = 12, Baumteile 15.
    expect(nextGoal(s, 0)).toMatchObject({ target: { id: 'roots' }, level: 2, cost: 12 });
  });
});

describe('researchAvailable', () => {
  it('zählt Knoten ohne Sperrgrund (wie researchBlocker); ohne Vorrat 0', () => {
    const s = stateAt(5);
    s.harmonyPoints = 0;
    expect(researchAvailable(s)).toBe(0);
    s.harmonyPoints = 1e12;
    const expected = RESEARCH.filter((n) => researchBlocker(s, n.id) === null).length;
    expect(expected).toBeGreaterThan(0);
    expect(researchAvailable(s)).toBe(expected);
    s.harmonyPoints = Number.NaN;
    expect(researchAvailable(s)).toBe(0);
  });
});

describe('affordableUpgradeSteps (Rückkehr-Bericht „Genug für N Ausbaustufen“)', () => {
  /** Unabhängig gerechnet: alle Einzelpreise der offenen Ziele, aufsteigend, so viele wie reichen. */
  function expected(s: GameState): number {
    const prices: number[] = [];
    for (const c of goalCandidates(s, 0)) {
      if (!c.target) continue;
      const base = upgradeBase(c.target)!;
      for (let l = c.level! - 1; l < c.level! + 60; l++) prices.push(upgradePrice(base, l));
    }
    prices.sort((a, b) => a - b);
    let left = s.seeds;
    let n = 0;
    for (const p of prices) {
      if (p > left) break;
      left -= p;
      n++;
    }
    return n;
  }

  it('billigste Stufe zuerst über Nischen und Baumteile = größte Zahl, ohne den Spielstand zu ändern', () => {
    const s = sprout();
    s.cycle.upgrades.niches.roots = 7;
    s.cycle.upgrades.tree.leaves = 3;
    for (const seeds of [0, 9, NICHE_UPGRADE_BASE.roots, 500, 4_321, 60_000]) {
      s.seeds = seeds;
      const before = JSON.stringify(s);
      expect(affordableUpgradeSteps(s), String(seeds)).toBe(expected(s));
      expect(JSON.stringify(s)).toBe(before);
    }
    s.seeds = 60_000;
    expect(affordableUpgradeSteps(s)).toBeGreaterThan(10);
  });

  it('verschlossene Nischen zählen nicht; vor dem Keimling 0; kaputte Samen 0; gedeckelt', () => {
    const seed = stateAt(0);
    seed.seeds = 1e9;
    expect(affordableUpgradeSteps(seed)).toBe(0);
    const s = sprout();
    s.seeds = Number.NaN;
    expect(affordableUpgradeSteps(s)).toBe(0);
    s.seeds = -5;
    expect(affordableUpgradeSteps(s)).toBe(0);
    s.seeds = 1e300;
    expect(affordableUpgradeSteps(s)).toBe(MAX_AFFORDABLE_STEPS);
    expect(affordableUpgradeSteps(s, 3)).toBe(3);
    // Nur Wurzelraum und Baum offen: genau so viele, wie diese vier Ziele zusammen hergeben.
    s.seeds = 2_000;
    expect(affordableUpgradeSteps(s)).toBe(expected(s));
  });

  it('am Höchststand bleibt ein Ziel stehen', () => {
    const s = sprout();
    s.cycle.upgrades.niches.roots = MAX_UPGRADE_LEVEL;
    for (const id of ['rings', 'leaves', 'mycorrhiza'] as const) s.cycle.upgrades.tree[id] = MAX_UPGRADE_LEVEL;
    s.seeds = 1e300;
    expect(affordableUpgradeSteps(s)).toBe(0);
  });
});
