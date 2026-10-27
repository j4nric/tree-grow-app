import { describe, expect, it } from 'vitest';
import { RESEARCH_REPEATABLE } from '../src/content/research';
import { SPECIES } from '../src/content/species';
import { NICHE_IDS } from '../src/content/types';
import {
  MAX_UPGRADE_LEVEL,
  NICHE_UPGRADE_BASE,
  NICHE_UPGRADE_PCT,
  TREE_PARTS,
  TREE_PART_IDS,
  TREE_UPGRADE_BASE,
  UPGRADE_GROWTH,
} from '../src/content/upgrades';
import {
  evaluate,
  evaluateEcosystem,
  nicheSlots,
  seedSecondsRate,
  slotBonuses,
  type Ecosystem,
} from '../src/core/formulas';
import { deserialize, exportCode, importCode, loadGame, serialize } from '../src/core/save';
import { SAVE_VERSION, createUpgradeLevels, emptyNiches, type GameState, type UpgradeLevels } from '../src/core/state';
import {
  drawAnimals,
  startNewCycle,
  upgradeAffordable,
  upgradeBlocker,
  upgradeCost,
  upgradeLevelOf,
  upgradeNiche,
  upgradeTree,
} from '../src/core/tick';
import {
  affordableUpgrades,
  hasDrawUpgrades,
  milestonesBetween,
  nextMilestone,
  normalizeUpgradeCount,
  normalizeUpgradeLevel,
  upgradeCostFrom,
  upgradeDrawWeight,
  upgradeEnvironment,
  upgradeLevelsKey,
  upgradePrice,
  upgradeSlotBonuses,
  type UpgradeTarget,
} from '../src/core/upgrades';
import { stateAt } from './helpers';

/*
 * Nischen- und Baum-Ausbau (DESIGN_V2.md 28.4) und Spielstand v18 (28.8): Preise, Aktionen,
 * Meilensteine (Plätze öffnen keine Nische, ☀️/💧, Kartengewichte), Wirkung in evaluate,
 * Cache-Schlüssel, Neuer Zyklus, robustes Laden und Migration v17 → v18.
 */

const ROOTS: UpgradeTarget = { kind: 'niche', id: 'roots' };
const RINGS: UpgradeTarget = { kind: 'tree', id: 'rings' };

/** Gekauftes bis Stufe `to` (Summe der Preise 0 … to−1). */
const sumTo = (base: number, to: number) => upgradeCostFrom(base, 0, to);

/** Ausbaustufen als Objekt (nur > 0). */
function levels(niches: UpgradeLevels['niches'] = {}, tree: UpgradeLevels['tree'] = {}): UpgradeLevels {
  return { niches: { ...niches }, tree: { ...tree } };
}

/** Reines Ökosystem ohne Jahreszeit, Wetter und Baumart – nur Stufe, Tiere, Pflanzen und Ausbau. */
function eco(stage: number, patch: Partial<Ecosystem> = {}): Ecosystem {
  return { stage, niches: emptyNiches(), forestMemory: 0, ...patch };
}

/** v18-Stand als JSON-Objekt (für Manipulationen). */
function rawOf(state: GameState): Record<string, any> {
  return JSON.parse(serialize(state));
}

/** Derselbe Stand, wie ihn das Spiel bis v17 gespeichert hat (ohne die v18-Felder). */
function toV17(state: GameState): string {
  const raw = rawOf(state);
  raw.version = 17;
  delete raw.cycle.upgrades;
  delete raw.cycle.researchRanks;
  delete raw.meta.upgrades;
  delete raw.meta.stats.upgradesBought;
  delete raw.meta.stats.upgradeSeeds;
  return JSON.stringify(raw);
}

// Zahlen seit der Messung Phase 11, 3a (DESIGN_V2.md 28.10): Faktor 1,2 statt 1,15, Startpreise ×2
// (Wurzelraum 20, Baumteile 30). Die Tabellen hier folgen der Tabelle 28.4.
describe('Preise (28.4)', () => {
  it('Tabelle 28.4: Preis der Stufe 1 / 10 / 25 / 50 und Summen bis 10 / 25 / 50', () => {
    const rows: [number, number[], number[]][] = [
      [20, [20, 104, 1_590, 151_674], [522, 9_448, 909_966]],
      [50, [50, 258, 3_975, 379_185], [1_301, 23_609, 2_274_882]],
      [120, [120, 620, 9_540, 910_044], [3_118, 56_646, 5_459_684]],
      [500, [500, 2_580, 39_749, 3_791_850], [12_981, 236_000, 22_748_617]],
      [1_200, [1_200, 6_192, 95_397, 9_100_439], [31_153, 566_390, 54_596_654]],
    ];
    for (const [base, prices, sums] of rows) {
      expect([1, 10, 25, 50].map((l) => upgradePrice(base, l - 1)), String(base)).toEqual(prices);
      expect([10, 25, 50].map((l) => sumTo(base, l)), String(base)).toEqual(sums);
    }
  });

  it('Startpreise aus den Daten: Nischen b_n, Baumteile 30 🌰', () => {
    const state = stateAt(1);
    for (const id of NICHE_IDS) expect(upgradeCost(state, { kind: 'niche', id })).toBe(NICHE_UPGRADE_BASE[id]);
    for (const id of TREE_PART_IDS) expect(upgradeCost(state, { kind: 'tree', id })).toBe(TREE_UPGRADE_BASE);
    // Ganze Preise bleiben ganz: 1.200 · 1,2 und 120 · 1,2; 125 · 1,2³ = 216 liegt als
    // Gleitkommazahl knapp darunter (215,999…) und rundet auf 216.
    expect(upgradePrice(1_200, 1)).toBe(1_440);
    expect(upgradePrice(120, 1)).toBe(144);
    expect(upgradePrice(125, 3)).toBe(216);
  });

  it('hohe Stufen exakt: ⌈b · 6^L / 5^L⌉ mit ganzen Zahlen nachgerechnet', () => {
    expect(UPGRADE_GROWTH).toBe(1.2);
    /** Exakter Preis mit BigInt (1,2 = 6/5). */
    const exact = (base: number, level: number) => {
      const num = BigInt(base) * 6n ** BigInt(level);
      const den = 5n ** BigInt(level);
      return Number((num + den - 1n) / den);
    };
    // Wurzelraum ab Stufe 120 (Preis 120 → 121): 20 · 1,2^120 = 63.500.847.475,6… → 63.500.847.476.
    expect(upgradePrice(20, 120)).toBe(63_500_847_476);
    expect(exact(20, 120)).toBe(63_500_847_476);
    let checked = 0;
    for (const base of [20, 30, 50, 120, 500, 1_200]) {
      // Bis 1e12: darüber reicht die Genauigkeit von Math.pow(1,2, L) nicht mehr sicher für Einer.
      for (let level = 0; base * Math.pow(1.2, level) < 1e12; level++) {
        expect(upgradePrice(base, level), `${base} · 1,2^${level}`).toBe(exact(base, level));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(700);
  });

  it('upgradeCost mit count = Summe der Einzelpreise ab der aktuellen Stufe', () => {
    const state = stateAt(1);
    state.cycle.upgrades.niches.roots = 9;
    expect(upgradeCost(state, ROOTS)).toBe(104);
    expect(upgradeCost(state, ROOTS, 3)).toBe(upgradePrice(20, 9) + upgradePrice(20, 10) + upgradePrice(20, 11));
    expect(upgradeCost(state, ROOTS, 16)).toBe(sumTo(20, 25) - sumTo(20, 9));
  });

  it('Grenzfälle: Stufe NaN/±Infinity/MAX, kaputter Startpreis, Kaufmenge 0/NaN/Infinity, unbekanntes Ziel', () => {
    expect(upgradePrice(10, MAX_UPGRADE_LEVEL)).toBe(Infinity);
    expect(upgradePrice(10, MAX_UPGRADE_LEVEL - 1)).toBeGreaterThan(0);
    expect(upgradePrice(10, Infinity)).toBe(Infinity);
    expect(upgradePrice(10, NaN)).toBe(Infinity);
    expect(upgradePrice(10, -Infinity)).toBe(Infinity);
    expect(upgradePrice(10, -3)).toBe(10);
    expect(upgradePrice(NaN, 0)).toBe(Infinity);
    expect(upgradePrice(0, 0)).toBe(Infinity);
    for (const n of [0, -1, NaN, 0.5, '3' as unknown as number]) expect(normalizeUpgradeCount(n), String(n)).toBe(1);
    expect(normalizeUpgradeCount(2.9)).toBe(2);
    expect(normalizeUpgradeCount(Infinity)).toBe(MAX_UPGRADE_LEVEL);
    expect(upgradeCostFrom(10, MAX_UPGRADE_LEVEL - 1, 2)).toBe(Infinity);
    // Alle 1.000 Stufen zusammen: riesig, aber endlich (10 · 1,2^999 ≈ 1e80).
    expect(upgradeCostFrom(10, 0, Infinity)).toBeGreaterThan(1e60);
    expect(Number.isFinite(upgradeCostFrom(10, 0, Infinity))).toBe(true);
    const state = stateAt(1);
    expect(upgradeCost(state, { kind: 'niche', id: 'drache' } as unknown as UpgradeTarget)).toBe(Infinity);
    expect(upgradeCost(state, { kind: 'tree', id: 'roots' } as unknown as UpgradeTarget)).toBe(Infinity);
  });

  it('affordableUpgrades kauft in Reihenfolge, nur was die Samen tragen', () => {
    expect(affordableUpgrades(10, 0, 0, 5)).toEqual({ count: 0, cost: 0 });
    expect(affordableUpgrades(10, 0, 10, 5)).toEqual({ count: 1, cost: 10 });
    expect(affordableUpgrades(20, 0, 522, Infinity)).toEqual({ count: 10, cost: 522 });
    expect(affordableUpgrades(20, 0, 521.9, Infinity)).toEqual({ count: 9, cost: sumTo(20, 9) });
    expect(affordableUpgrades(10, 0, NaN, 5)).toEqual({ count: 0, cost: 0 });
    expect(affordableUpgrades(10, 0, Infinity, Infinity).count).toBe(MAX_UPGRADE_LEVEL);
    expect(affordableUpgrades(10, 0, Number.MAX_VALUE, Infinity).count).toBe(MAX_UPGRADE_LEVEL);
  });
});

describe('Aktionen upgradeNiche, upgradeTree, upgradeBlocker (28.4)', () => {
  it('Blocker: unbekannt, verschlossen (Nische ohne eigenen Platz, Baum vor dem Keimling), zu teuer', () => {
    const seed = stateAt(0);
    seed.seeds = 1e6;
    expect(upgradeBlocker(seed, ROOTS)).toBe('closed');
    expect(upgradeBlocker(seed, RINGS)).toBe('closed');
    expect(upgradeBlocker(seed, { kind: 'niche', id: 'nope' } as unknown as UpgradeTarget)).toBe('unknown');
    expect(upgradeBlocker(seed, null as unknown as UpgradeTarget)).toBe('unknown');
    const sprout = stateAt(1);
    expect(upgradeBlocker(sprout, ROOTS)).toBe('too-expensive');
    expect(upgradeBlocker(sprout, RINGS)).toBe('too-expensive');
    sprout.seeds = NICHE_UPGRADE_BASE.roots;
    expect(upgradeBlocker(sprout, ROOTS)).toBeNull();
    expect(upgradeBlocker(sprout, RINGS)).toBe('too-expensive');
    sprout.seeds = TREE_UPGRADE_BASE;
    expect(upgradeBlocker(sprout, RINGS)).toBeNull();
    // Laubstreu öffnet erst beim Setzling, Waldtümpel nur mit Forschung, Höhlen beim Alten Baum.
    expect(upgradeBlocker(sprout, { kind: 'niche', id: 'litter' })).toBe('closed');
    const young = stateAt(3);
    young.seeds = 1e9;
    expect(upgradeBlocker(young, { kind: 'niche', id: 'pond' })).toBe('closed');
    expect(upgradeBlocker(young, { kind: 'niche', id: 'hollows' })).toBe('closed');
    // Der Borkenkäfer öffnet die Höhlen früh (opensEarly) – dann geht auch der Ausbau.
    young.niches.bark.push('barkbeetle');
    expect(upgradeBlocker(young, { kind: 'niche', id: 'hollows' })).toBeNull();
  });

  it('kauft bis zu count Stufen, solange die Samen reichen; Statistik, Bestmarke, Ergebnis', () => {
    const state = stateAt(1);
    state.seeds = 100;
    const result = upgradeNiche(state, 'roots', 10);
    // 20 + 24 + 29 = 73; die vierte Stufe (35) reicht nicht mehr.
    expect(result).toEqual({
      ok: true,
      seeds: -73,
      upgrade: { target: ROOTS, bought: 3, spent: 73, level: 3, milestones: [] },
    });
    expect(state.seeds).toBe(27);
    expect(upgradeLevelOf(state, ROOTS)).toBe(3);
    expect(state.meta.upgrades.best.niches.roots).toBe(3);
    expect(state.meta.stats.upgradesBought).toBe(3);
    expect(state.meta.stats.upgradeSeeds).toBe(73);
    // Nichts mehr bezahlbar: nichts geändert.
    state.seeds = 34;
    expect(upgradeNiche(state, 'roots')).toEqual({ ok: false, error: 'too-expensive' });
    expect(state.seeds).toBe(34);
    expect(upgradeLevelOf(state, ROOTS)).toBe(3);
    // Standard: eine Stufe; kaputte Kaufmenge wie 1.
    state.seeds = 1000;
    expect(upgradeNiche(state, 'roots', NaN).ok).toBe(true);
    expect(upgradeLevelOf(state, ROOTS)).toBe(4);
    expect(upgradeNiche(state, 'roots', 0).ok).toBe(true);
    expect(upgradeLevelOf(state, ROOTS)).toBe(5);
  });

  it('Max (count = Infinity) kauft alles Bezahlbare, upgradeAffordable sagt es vorher', () => {
    const state = stateAt(1);
    state.seeds = sumTo(TREE_UPGRADE_BASE, 25) + 3;
    expect(upgradeAffordable(state, RINGS)).toEqual({ count: 25, cost: sumTo(TREE_UPGRADE_BASE, 25) });
    const result = upgradeTree(state, 'rings', Infinity);
    expect(result.ok && result.upgrade?.bought).toBe(25);
    expect(state.seeds).toBe(3);
    expect(state.cycle.upgrades.tree.rings).toBe(25);
  });

  it('Meilensteine je einmal: 10 beim zehnten, 25 mit Platz und Bronze, nichts doppelt', () => {
    const state = stateAt(1);
    state.seeds = 1e9;
    const first = upgradeNiche(state, 'roots', 9);
    expect(first.ok && first.upgrade?.milestones).toEqual([]);
    const tenth = upgradeNiche(state, 'roots');
    expect(tenth.ok && tenth.upgrade?.milestones.map((m) => [m.level, m.kind])).toEqual([[10, 'drawWeight']]);
    const more = upgradeNiche(state, 'roots', 40);
    expect(more.ok && more.upgrade?.milestones.map((m) => [m.level, m.kind])).toEqual([
      [25, 'slot'],
      [25, 'badge'],
      [50, 'rareWeight'],
      [50, 'badge'],
    ]);
    const again = upgradeNiche(state, 'roots');
    expect(again.ok && again.upgrade?.milestones).toEqual([]);
    expect(milestonesBetween(ROOTS, 0, 75).map((m) => m.level)).toEqual([10, 25, 25, 50, 50, 75]);
    expect(nextMilestone(ROOTS, 24)?.level).toBe(25);
    expect(nextMilestone(ROOTS, 75)).toBeNull();
    expect(nextMilestone(RINGS, 0)?.kind).toBe('slot');
  });

  it('Stufe MAX_UPGRADE_LEVEL ist die Grenze – auch mit unendlich vielen Samen', () => {
    const state = stateAt(1);
    state.seeds = Number.MAX_VALUE;
    state.cycle.upgrades.niches.roots = MAX_UPGRADE_LEVEL - 1;
    expect(upgradeNiche(state, 'roots', Infinity).ok).toBe(true);
    expect(upgradeLevelOf(state, ROOTS)).toBe(MAX_UPGRADE_LEVEL);
    expect(upgradeNiche(state, 'roots')).toEqual({ ok: false, error: 'too-expensive' });
    expect(Number.isFinite(state.seeds)).toBe(true);
  });

  it('Bestmarke sinkt nie (niedrigere Stufe im Zyklus)', () => {
    const state = stateAt(1);
    state.meta.upgrades.best.niches.roots = 40;
    state.seeds = 1000;
    upgradeNiche(state, 'roots', 3);
    expect(state.meta.upgrades.best.niches.roots).toBe(40);
  });

  it('neuer Platz (Meilenstein 25): Stammgast zieht sofort ein', () => {
    const state = stateAt(1, ['earthworm']);
    state.meta.journal.species.push('vole');
    state.meta.regulars = ['vole'];
    state.seeds = 1e6;
    expect(evaluate(state).slots.roots).toBe(1);
    const result = upgradeNiche(state, 'roots', 25);
    expect(result.ok && result.regulars).toEqual(['vole']);
    expect(state.niches.roots).toEqual(['earthworm', 'vole']);
    expect(evaluate(state).slots.roots).toBe(2);
  });
});

describe('Plätze der Meilensteine (28.4): öffnen keine Nische', () => {
  it('upgradeSlotBonuses: Nische selbst ab 25, Jahresringe → Höhlen, Blattwerk → Krone', () => {
    expect(upgradeSlotBonuses(levels({ roots: 24 }))).toEqual([]);
    expect(upgradeSlotBonuses(levels({ roots: 25, pond: 80 }, { rings: 25, leaves: 30, mycorrhiza: 99 }))).toEqual([
      { niche: 'roots', amount: 1, upgrade: true },
      { niche: 'pond', amount: 1, upgrade: true },
      { niche: 'hollows', amount: 1, upgrade: true },
      { niche: 'crown', amount: 1, upgrade: true },
    ]);
    expect(upgradeSlotBonuses(undefined)).toEqual([]);
  });

  it('geschlossene Nische bleibt zu: Tümpel ohne Forschung, Höhlen vor dem Alten Baum', () => {
    const state = stateAt(3);
    state.cycle.upgrades = levels({ pond: 30, hollows: 30 }, { rings: 30 });
    const ev = evaluate(state);
    expect(ev.slots.pond).toBe(0);
    expect(ev.slots.hollows).toBe(0);
    expect(nicheSlots(state.stage, state.niches, slotBonuses(state)).hollows).toBe(0);
    // Öffnet der Borkenkäfer die Höhlen, zählen beide Ausbau-Plätze dazu.
    state.niches.bark.push('barkbeetle');
    expect(evaluate(state).slots.hollows).toBe(1 + 2);
    // Ab dem Alten Baum ist die Nische ohnehin offen.
    const old = stateAt(4);
    old.cycle.upgrades = levels({ hollows: 25 }, { rings: 25 });
    expect(evaluate(old).slots.hollows).toBe(1 + 2);
  });

  it('Platz-Summe mit Forschung, Eigenheit der Baumart und Tier', () => {
    // Junger Baum, Eiche: Krone 2 + 1 (Eigenheit), + Krone 25 + Blattwerk 25.
    const state = stateAt(3);
    expect(evaluate(state).slots.crown).toBe(3);
    state.cycle.upgrades = levels({ crown: 25 }, { leaves: 25 });
    expect(evaluate(state).slots.crown).toBe(5);
    expect(nicheSlots(state.stage, state.niches, slotBonuses(state)).crown).toBe(5);
    // Höhlen: Borkenkäfer (Tier) öffnet, Jahresringe und Höhlen-Ausbau kommen dazu.
    state.niches.bark.push('barkbeetle');
    state.cycle.upgrades.niches.hollows = 25;
    state.cycle.upgrades.tree.rings = 25;
    expect(evaluate(state).slots.hollows).toBe(3);
  });

  it('nicheSlots: ein Ausbau-Platz allein öffnet nichts, auch nicht bei opensEarly', () => {
    const upgrade = [{ niche: 'hollows' as const, amount: 3, upgrade: true }];
    expect(nicheSlots(3, emptyNiches(), upgrade).hollows).toBe(0);
    expect(nicheSlots(3, emptyNiches(), [...upgrade, { niche: 'hollows', amount: 1 }]).hollows).toBe(4);
    // Negative Plätze aus anderen Quellen, die die Nische schließen: Ausbau zählt nicht.
    expect(nicheSlots(1, emptyNiches(), [{ niche: 'roots', amount: -1 }, { niche: 'roots', amount: 2, upgrade: true }]).roots).toBe(0);
  });
});

describe('Wirkung in evaluate (28.4)', () => {
  it('ohne Ausbau bitgleich: leere Stufen = kein Feld', () => {
    const base = eco(5, { niches: { ...emptyNiches(), roots: ['earthworm', 'mole'] }, plants: ['hazel', 'fern'] });
    expect(evaluateEcosystem({ ...base, upgrades: createUpgradeLevels() })).toEqual(evaluateEcosystem(base));
    expect(evaluateEcosystem({ ...base, upgrades: levels({ roots: 0 }, { rings: 0 }) })).toEqual(evaluateEcosystem(base));
  });

  it('je Tier +NICHE_UPGRADE_PCT % · L · z auf 🌿 und 🌰 (seit 3a 0,06 %)', () => {
    const base = eco(5, { niches: { ...emptyNiches(), roots: ['earthworm', 'mole'], crown: ['bluetit'] } });
    const before = evaluateEcosystem(base);
    const after = evaluateEcosystem({ ...base, upgrades: levels({ roots: 25 }) });
    const z = before.animals.earthworm!.happiness + before.animals.mole!.happiness;
    expect(after.growthBonus - before.growthBonus).toBeCloseTo((25 * NICHE_UPGRADE_PCT / 100) * z, 12);
    expect(after.seedsBonus - before.seedsBonus).toBeCloseTo((25 * NICHE_UPGRADE_PCT / 100) * z, 12);
    // Nur 🌿 und 🌰: Harmonie, Zufriedenheit, Licht, Wasser unverändert.
    expect(after.harmony).toBe(before.harmony);
    expect(after.animals).toEqual(before.animals);
    expect([after.light, after.water]).toEqual([before.light, before.water]);
    expect(after.growth).toBeGreaterThan(before.growth);
    // Eine leere ausgebaute Nische wirkt nicht.
    expect(evaluateEcosystem({ ...base, upgrades: levels({ litter: 50 }) }).growth).toBe(before.growth);
  });

  it('Hauptbaum: Jahresringe +0,4 % 🌿, Blattwerk +1 % 🌰 – nur der Baum', () => {
    const base = eco(3);
    const before = evaluateEcosystem(base);
    const rings = evaluateEcosystem({ ...base, upgrades: levels({}, { rings: 22 }) });
    expect(rings.growth / before.growth).toBeCloseTo(1 + 0.004 * 22, 12);
    expect(rings.seeds).toBe(before.seeds);
    const leaves = evaluateEcosystem({ ...base, upgrades: levels({}, { leaves: 21 }) });
    expect(leaves.seeds / before.seeds).toBeCloseTo(1.21, 12);
    expect(leaves.growth).toBe(before.growth);
    // Begleitpflanzen bleiben vom Hauptbaum-Ausbau unberührt.
    const plants = eco(3, { plants: ['hazel'] });
    expect(evaluateEcosystem({ ...plants, upgrades: levels({}, { rings: 50, leaves: 50 }) }).plantGrowth).toBe(
      evaluateEcosystem(plants).plantGrowth,
    );
  });

  it('Pilzgeflecht: Begleitpflanzen +0,5 % 🌿 und 🌰 je Stufe, ab 25 +1 💧', () => {
    const base = eco(3, { plants: ['hazel', 'fern'] });
    const before = evaluateEcosystem(base);
    const after = evaluateEcosystem({ ...base, upgrades: levels({}, { mycorrhiza: 24 }) });
    expect(after.plantGrowth / before.plantGrowth).toBeCloseTo(1.12, 12);
    expect(after.plantSeeds / before.plantSeeds).toBeCloseTo(1.12, 12);
    expect(after.water).toBe(before.water);
    const at25 = evaluateEcosystem({ ...base, upgrades: levels({}, { mycorrhiza: 25 }) });
    expect(at25.water).toBe(before.water + 1);
    expect(upgradeEnvironment(levels({}, { mycorrhiza: 25 }))).toEqual({ light: 0, water: 1 });
    expect(upgradeEnvironment(undefined)).toEqual({ light: 0, water: 0 });
  });

  it('kaputte Stufen im Ökosystem zählen als 0 (NaN, negativ, Text, zu groß)', () => {
    const base = eco(3, { niches: { ...emptyNiches(), roots: ['earthworm'] }, plants: ['hazel'] });
    const broken = { roots: NaN, crown: -5, litter: 'x', edge: 1e9 } as unknown as UpgradeLevels['niches'];
    const tree = { rings: Infinity, leaves: 2.5 } as unknown as UpgradeLevels['tree'];
    expect(evaluateEcosystem({ ...base, upgrades: { niches: broken, tree } })).toEqual(evaluateEcosystem(base));
    for (const v of [NaN, -1, 1.5, 1e9, Infinity, '3', null]) expect(normalizeUpgradeLevel(v), String(v)).toBe(0);
    expect(normalizeUpgradeLevel(MAX_UPGRADE_LEVEL)).toBe(MAX_UPGRADE_LEVEL);
  });

  it('Cache-Schlüssel: evaluate und Samen-Sekunden-Rate sehen jede Stufe', () => {
    const state = stateAt(1, ['earthworm']);
    const before = evaluate(state);
    const rate = seedSecondsRate(state);
    state.cycle.upgrades.niches.roots = 5;
    const after = evaluate(state);
    expect(after).not.toBe(before);
    expect(after.growth).toBeGreaterThan(before.growth);
    expect(seedSecondsRate(state)).toBeGreaterThan(rate);
    state.cycle.upgrades.tree.leaves = 3;
    expect(evaluate(state).seeds).toBeGreaterThan(after.seeds);
    expect(upgradeLevelsKey(levels({ roots: 5, wall: 2 }, { leaves: 3 }))).toBe('roots:5,wall:2,leaves:3');
    expect(upgradeLevelsKey(levels({ roots: 0 }))).toBe('');
  });
});

describe('Kartengewichte (28.4): ×1,5 ab 10, seltene ×2 ab 50', () => {
  it('upgradeDrawWeight je Stufe und Seltenheit', () => {
    const at = (l: number, rarity: number) => upgradeDrawWeight(levels({ roots: l }), 'roots', rarity);
    expect(at(0, 0)).toBe(1);
    expect(at(9, 3)).toBe(1);
    expect(at(10, 0)).toBe(1.5);
    expect(at(49, 1)).toBe(1.5);
    expect(at(50, 0)).toBe(1.5);
    expect([1, 2, 3].map((r) => at(50, r))).toEqual([3, 3, 3]);
    expect(upgradeDrawWeight(levels({ roots: 50 }), 'crown', 1)).toBe(1);
    expect(hasDrawUpgrades(levels({ roots: 9 }, { rings: 99 }))).toBe(false);
    expect(hasDrawUpgrades(levels({ edge: 10 }))).toBe(true);
  });

  it('drawAnimals zieht Arten der ausgebauten Nische öfter (innerhalb der Seltenheit)', () => {
    // Keimling, Zyklus 1: gewöhnlich sind Wühlmaus, Regenwurm, Pfifferling (Wurzelraum) und
    // die übrigen Keimlings-Arten – mit Ausbau 10 zieht der Wurzelraum öfter.
    const share = (upgrade: number) => {
      const state = stateAt(2);
      state.cycle.upgrades.niches.roots = upgrade;
      const rng = { rngState: 12345 };
      let roots = 0;
      let all = 0;
      for (let i = 0; i < 3000; i++) {
        for (const id of drawAnimals(state, [], rng)) {
          all++;
          if (SPECIES.find((s) => s.id === id)!.niche === 'roots') roots++;
        }
      }
      return roots / all;
    };
    expect(share(10)).toBeGreaterThan(share(0) + 0.03);
  });

  it('ohne Ausbau derselbe Zug wie vor v18 (gleicher Zufall verbraucht)', () => {
    const a = stateAt(3, ['earthworm', 'robin'], 77);
    const b = structuredClone(a);
    b.cycle.upgrades = levels({ roots: 9 }, { rings: 40 }); // kein Gewichts-Meilenstein
    expect(drawAnimals(b)).toEqual(drawAnimals(a));
    expect(b.rngState).toBe(a.rngState);
  });
});

describe('Neuer Zyklus (28.4)', () => {
  it('setzt Stufen und Ränge zurück, Bestmarke und Statistik bleiben', () => {
    const state = stateAt(5, ['earthworm']);
    state.seeds = 1e6;
    upgradeNiche(state, 'roots', 30);
    upgradeTree(state, 'mycorrhiza', 12);
    state.cycle.researchRanks = { 'soil-life': 2 };
    const bought = state.meta.stats.upgradesBought;
    expect(startNewCycle(state, 1000).ok).toBe(true);
    expect(state.cycle.upgrades).toEqual(createUpgradeLevels());
    expect(state.cycle.researchRanks).toEqual({});
    expect(state.meta.upgrades.best).toEqual(levels({ roots: 30 }, { mycorrhiza: 12 }));
    expect(state.meta.stats.upgradesBought).toBe(bought);
    expect(bought).toBe(42);
    // Ein frischer Zyklus beginnt wieder beim Startpreis.
    expect(upgradeCost(state, ROOTS)).toBe(NICHE_UPGRADE_BASE.roots);
  });
});

describe('Spielstand v18 (28.8)', () => {
  /** Stand mit Ausbau, Forschung bis zur Boden-Gabel, Plan und Statistik. */
  function upgraded(): GameState {
    const state = stateAt(6, ['earthworm', 'robin', 'barkbeetle']);
    state.seeds = 5e5;
    state.cycle.research = ['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle'];
    state.meta.research = { plan: ['compost', 'leaf-litter'], auto: true };
    expect(upgradeNiche(state, 'roots', 27).ok).toBe(true);
    expect(upgradeTree(state, 'rings', 25).ok).toBe(true);
    state.cycle.researchRanks = { 'soil-life': 3 };
    state.meta.upgrades.best.niches.edge = 60;
    return state;
  }

  it('Startwerte: leer, Statistik 0; Version 18', () => {
    const state = stateAt(0);
    expect(SAVE_VERSION).toBe(18);
    expect(state.version).toBe(18);
    expect(state.cycle.upgrades).toEqual({ niches: {}, tree: {} });
    expect(state.cycle.researchRanks).toEqual({});
    expect(state.meta.upgrades).toEqual({ best: { niches: {}, tree: {} } });
    expect([state.meta.stats.upgradesBought, state.meta.stats.upgradeSeeds]).toEqual([0, 0]);
  });

  it('Roundtrip gleich, zweites Laden ändert nichts', () => {
    const state = upgraded();
    expect(state.cycle.research).toContain('beetle-castle');
    const loaded = deserialize(serialize(state), 0)!;
    expect(loaded.version).toBe(18);
    expect(loaded.cycle.upgrades).toEqual(state.cycle.upgrades);
    expect(loaded.cycle.researchRanks).toEqual({ 'soil-life': 3 });
    expect(loaded.meta.upgrades).toEqual(state.meta.upgrades);
    expect(loaded.meta.stats).toEqual(state.meta.stats);
    expect(loaded.niches).toEqual(state.niches);
    expect(serialize(deserialize(serialize(loaded), 0)!)).toBe(serialize(loaded));
    const code = importCode(exportCode(state), 0);
    expect(code.ok && code.result.state.cycle.upgrades).toEqual(state.cycle.upgrades);
  });

  it('v17 → v18 ohne Verlust: Samen, Forschung, Plan; Ausbau leer, Statistik 0', () => {
    const state = upgraded();
    const loaded = loadGame(toV17(state), 0)!.state;
    expect(loaded.version).toBe(18);
    expect(loaded.seeds).toBe(state.seeds);
    expect(loaded.harmonyPoints).toBe(state.harmonyPoints);
    expect(loaded.cycle.research).toEqual(state.cycle.research);
    expect(loaded.meta.research).toEqual(state.meta.research);
    expect(loaded.cycle.upgrades).toEqual(createUpgradeLevels());
    expect(loaded.cycle.researchRanks).toEqual({});
    expect(loaded.meta.upgrades).toEqual({ best: createUpgradeLevels() });
    expect([loaded.meta.stats.upgradesBought, loaded.meta.stats.upgradeSeeds]).toEqual([0, 0]);
    // Ein v17-Stand mit fremden Feldern gleichen Namens übernimmt sie nicht.
    const raw = JSON.parse(toV17(state));
    raw.cycle.upgrades = { niches: { roots: 40 }, tree: {} };
    raw.meta.upgrades = { best: { niches: { roots: 80 } } };
    raw.meta.stats.upgradesBought = 5;
    const foreign = loadGame(JSON.stringify(raw), 0)!.state;
    expect(foreign.cycle.upgrades).toEqual(createUpgradeLevels());
    expect(foreign.meta.upgrades.best).toEqual(createUpgradeLevels());
    expect(foreign.meta.stats.upgradesBought).toBe(0);
  });

  it('Samen bleiben: ein großer Vorrat aus der Zeit von 100 % offline kauft viel (kein Kürzen)', () => {
    const state = stateAt(5, ['earthworm']);
    state.seeds = 1e6;
    const loaded = loadGame(toV17(state), 0)!.state;
    expect(loaded.seeds).toBe(1e6);
    upgradeNiche(loaded, 'roots', Infinity);
    // Logarithmus: 1 Mio. 🌰 ≈ Wurzelraum 50 (Σ 20 · 1,2^L ≈ 20 · 1,2^50 / 0,2; bis 3a: 68).
    expect(upgradeLevelOf(loaded, ROOTS)).toBe(50);
    expect(loaded.seeds).toBeLessThan(upgradePrice(20, 50));
  });

  it('jede Version v2 … v17 lädt als v18 ohne Ausbau', () => {
    const state = stateAt(4, ['earthworm', 'robin']);
    for (let v = 2; v <= 17; v++) {
      const raw = JSON.parse(toV17(state));
      raw.version = v;
      const loaded = loadGame(JSON.stringify(raw), 0)!.state;
      expect(loaded.version, String(v)).toBe(18);
      expect(loaded.cycle.upgrades, String(v)).toEqual(createUpgradeLevels());
      expect(loaded.meta.upgrades.best, String(v)).toEqual(createUpgradeLevels());
    }
  });

  it('kaputte Stufen (NaN, negativ, 1e9, Bruch, Text) → 0, unbekannte Nischen und Teile fallen weg', () => {
    const state = stateAt(4);
    const raw = rawOf(state);
    raw.cycle.upgrades = {
      niches: { roots: 12, litter: -3, edge: 1e9, crown: 2.5, bark: '7', drache: 5, meadow: null, hollows: MAX_UPGRADE_LEVEL },
      tree: { rings: 4, leaves: '__NAN__', mycorrhiza: '__INF__', stamm: 9 },
    };
    const json = JSON.stringify(raw).replace('"__NAN__"', 'NaN').replace('"__INF__"', '1e400');
    // NaN ist kein JSON: dieser Stand lädt gar nicht – mit gültigem JSON:
    expect(loadGame(json, 0)).toBeNull();
    const loaded = loadGame(JSON.stringify(raw).replace('"__INF__"', '1e400'), 0)!.state;
    expect(loaded.cycle.upgrades).toEqual(levels({ roots: 12, hollows: MAX_UPGRADE_LEVEL }, { rings: 4 }));
    for (const broken of [null, 'x', 42, [1, 2], { niches: [3], tree: 'x' }]) {
      const r = rawOf(state);
      r.cycle.upgrades = broken;
      expect(loadGame(JSON.stringify(r), 0)!.state.cycle.upgrades, JSON.stringify(broken)).toEqual(createUpgradeLevels());
    }
  });

  it('Bestmarke robust und nie unter der Stufe im Zyklus (nachgezogen)', () => {
    const state = stateAt(4);
    const raw = rawOf(state);
    raw.cycle.upgrades = { niches: { roots: 30, crown: 5 }, tree: { leaves: 8 } };
    raw.meta.upgrades = { best: { niches: { roots: 12, crown: 40, edge: -1, drache: 3 }, tree: { rings: 1e9, leaves: 2 } } };
    const loaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(loaded.meta.upgrades.best).toEqual(levels({ roots: 30, crown: 40 }, { leaves: 8 }));
    for (const broken of [undefined, null, 'x', { best: 7 }]) {
      const r = rawOf(state);
      r.cycle.upgrades = { niches: { roots: 3 }, tree: {} };
      r.meta.upgrades = broken;
      expect(loadGame(JSON.stringify(r), 0)!.state.meta.upgrades.best, String(broken)).toEqual(levels({ roots: 3 }));
    }
  });

  it('Stufe in einer verschlossenen Nische bleibt (sie ruht), ihr Platz zählt nicht', () => {
    const state = stateAt(3);
    const raw = rawOf(state);
    raw.cycle.upgrades = { niches: { pond: 30, hollows: 26 }, tree: { rings: 25 } };
    const loaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(loaded.cycle.upgrades.niches).toEqual({ pond: 30, hollows: 26 });
    expect(evaluate(loaded).slots.pond).toBe(0);
    expect(evaluate(loaded).slots.hollows).toBe(0);
  });

  it('Ausbau-Plätze zählen beim Kürzen der Nischen mit', () => {
    const state = stateAt(1);
    state.niches.roots = ['earthworm', 'vole'];
    state.meta.journal.species.push('earthworm', 'vole');
    state.cycle.upgrades.niches.roots = 25;
    expect(deserialize(serialize(state), 0)!.niches.roots).toEqual(['earthworm', 'vole']);
    state.cycle.upgrades.niches.roots = 24;
    expect(deserialize(serialize(state), 0)!.niches.roots).toEqual(['earthworm']);
  });

  it('Ränge nur für wiederholbare Knoten hinter ihrer Gabel, ganzzahlig 1 … 200', () => {
    expect(RESEARCH_REPEATABLE.map((n) => n.id)).toContain('soil-life');
    const state = stateAt(6);
    state.cycle.research = ['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle'];
    const raw = rawOf(state);
    raw.cycle.researchRanks = {
      'soil-life': 4, // Gabel Käferburg erforscht
      'old-branches': 2, // Lichte/Dichte Krone II fehlen
      'wet-care': 'x',
      compost: 3, // kein wiederholbarer Knoten
      drache: 1,
    };
    const loaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(loaded.cycle.research).toEqual(state.cycle.research);
    expect(loaded.cycle.researchRanks).toEqual({ 'soil-life': 4 });
    for (const rank of [0, -1, 2.5, 201, 1e9]) {
      const r = rawOf(state);
      r.cycle.researchRanks = { 'soil-life': rank };
      expect(loadGame(JSON.stringify(r), 0)!.state.cycle.researchRanks, String(rank)).toEqual({});
    }
    const r = rawOf(state);
    r.cycle.researchRanks = { 'soil-life': 200 };
    expect(loadGame(JSON.stringify(r), 0)!.state.cycle.researchRanks).toEqual({ 'soil-life': 200 });
    // Vor dem Hain gibt es keinen Rang.
    const young = rawOf(stateAt(4));
    young.cycle.research = ['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle'];
    young.cycle.researchRanks = { 'soil-life': 1 };
    expect(loadGame(JSON.stringify(young), 0)!.state.cycle.researchRanks).toEqual({});
  });

  it('Statistik robust: endlich, ≥ 0, Zähler ganzzahlig', () => {
    const state = stateAt(1);
    const raw = rawOf(state);
    raw.meta.stats.upgradesBought = 7.9;
    raw.meta.stats.upgradeSeeds = '__INF__';
    const loaded = loadGame(JSON.stringify(raw).replace('"__INF__"', '1e400'), 0)!.state;
    expect(loaded.meta.stats.upgradesBought).toBe(7);
    expect(loaded.meta.stats.upgradeSeeds).toBe(Number.MAX_VALUE);
    raw.meta.stats.upgradesBought = -2;
    raw.meta.stats.upgradeSeeds = 'viel';
    const zero = loadGame(JSON.stringify(raw), 0)!.state;
    expect([zero.meta.stats.upgradesBought, zero.meta.stats.upgradeSeeds]).toEqual([0, 0]);
  });

  it('Baumteile: Daten und Schlüssel passen zusammen', () => {
    expect(TREE_PARTS.map((p) => p.id)).toEqual([...TREE_PART_IDS]);
  });
});
