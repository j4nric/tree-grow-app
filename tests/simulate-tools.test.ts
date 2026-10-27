import { describe, expect, it } from 'vitest';
import {
  ALL_PURCHASES,
  GROWTH,
  HARMONY,
  RANDOM,
  SEED_PURCHASES,
  SEED_RESERVE_SECONDS,
  cheapestGoal,
  forkChoice,
  forkSideOf,
  longestPurchasePause,
  median,
  monteCarlo,
  offlineAfterStage,
  purchaseGaps,
  purchaseStats,
  runGame,
  runSession,
  seedGoals,
  seedReserve,
  seedSpendShare,
  sessionTable,
  type Purchase,
  type RunResult,
  type Snapshot,
  type Summary,
} from '../scripts/simulate';
import { REROLL_BASE_COST } from '../src/content/encounters';
import { RESEARCH_FORKS } from '../src/content/research';
import { goalCandidates, nextGoal } from '../src/core/goal';
import { createInitialState } from '../src/core/state';
import { MAX_OFFLINE_SECONDS } from '../src/core/tick';
import { FULL, HAIN, MAX_SECONDS, RUNS } from './balance-setup';

/**
 * Messwerkzeuge des Simulators für Phase 11 (1e; DESIGN_V2.md 27.11, 28.10): Takt der Käufe,
 * Anteil ausgegebener Samen, Gabel-Wahl je Strategie, Aussaat je Strategie, Sitzungsprofil über
 * simulateOffline. Die Kennzahlen selbst prüfen die Balancing-Tests; hier geht es um die Rechnung.
 */

/** Minimaler Durchgang: Stufen-Zeitpunkte und Käufe (für die reinen Rechenfunktionen). */
function fakeRun(stageTimes: (number | null)[], purchases: Purchase[], finalTime: number): RunResult {
  const snap = (time: number) => ({ time }) as Snapshot;
  return {
    stages: stageTimes.map((t) => (t === null ? null : snap(t))),
    samples: [],
    gaps: [],
    decisions: [],
    variety: [],
    memoryPath: [],
    early: { actions: [], seedPeak: 0 },
    purchases,
    final: snap(finalTime),
  };
}

const buy = (time: number, kind: Purchase['kind'] = 'sow'): Purchase => ({ time, stage: 0, kind, cost: 1 });

describe('Takt der Käufe (purchaseGaps)', () => {
  // Stufe 1 ab 0 s, Stufe 2 ab 100 s, Stufe 3 ab 300 s, Ende 400 s.
  const run = fakeRun([0, 0, 100, 300], [buy(30), buy(60), buy(60, 'reroll'), buy(100), buy(150, 'research'), buy(250)], 400);

  it('Abstände enden in der Stufe, gleichzeitige Käufe zählen als ein Kaufmoment', () => {
    expect(purchaseGaps(run, 1)).toEqual({ gaps: [30, 30], open: 40 });
    // Kauf genau am Wegpunkt der neuen Stufe gehört zu ihr; Forschung zählt nicht als 🌰-Kauf.
    expect(purchaseGaps(run, 2)).toEqual({ gaps: [40, 150], open: 50 });
    expect(purchaseGaps(run, 3)).toEqual({ gaps: [], open: 150 });
    expect(purchaseGaps(run, 4)).toBeNull();
  });

  it('mit Forschung (alle Käufe) und längste Pause inklusive der offenen Strecke', () => {
    expect(purchaseGaps(run, 2, ALL_PURCHASES)).toEqual({ gaps: [40, 50, 100], open: 50 });
    expect(longestPurchasePause(run, 2)).toBe(150);
    expect(longestPurchasePause(run, 3)).toBe(150);
  });

  it('purchaseStats: Median über alle Durchgänge, Käufe je Durchgang', () => {
    const st = purchaseStats({ strategy: HARMONY, runs: [run, run] }, 1, SEED_PURCHASES);
    expect(st.runs).toBe(2);
    expect(st.perRun).toBe(2);
    expect(st.median).toBe(30);
    expect(st.longestMax).toBe(40);
  });
});

describe('Anteil ausgegebener Samen', () => {
  it('ausgegeben (Aussaat, Würfeln, Gäste) durch verdient (passiv, Ablehnen, Extras, Ziele)', () => {
    const s = { earnedPassive: 600, earnedDecline: 200, earnedExtras: 150, earnedDaily: 50, spentPlants: 500, spent: 100, spentVisitors: 150 } as Snapshot;
    expect(seedSpendShare(s)).toBeCloseTo(0.75);
    expect(seedSpendShare({ ...s, earnedPassive: 0, earnedDecline: 0, earnedExtras: 0, earnedDaily: 0 })).toBe(0);
  });
});

describe('Echte Durchgänge: Käufe, Gabeln, Aussaat je Strategie', () => {
  // Wenige Durchgänge genügen (Rechnung, nicht Balancing; die großen Läufe: tests/balance.test.ts).
  const [harmony, random] = monteCarlo([HARMONY, RANDOM], 8, { targetStage: HAIN, maxSeconds: MAX_SECONDS, care: true }) as [Summary, Summary];

  it('Käufe sind zeitlich geordnet und passen zu den Zählern', () => {
    for (const r of [...harmony.runs, ...random.runs]) {
      for (let i = 1; i < r.purchases.length; i++) expect(r.purchases[i]!.time).toBeGreaterThanOrEqual(r.purchases[i - 1]!.time);
      const kinds = (k: Purchase['kind']) => r.purchases.filter((p) => p.kind === k).length;
      expect(kinds('research')).toBe(r.final.counts.careBought);
      expect(kinds('reroll')).toBe(r.final.counts.rerolls);
      expect(kinds('host')).toBe(r.final.counts.hosted);
      // Ausbau (Phase 11, 3a): jede Stufe ein Kauf, Kosten = ausgegebene Samen.
      expect(kinds('upgrade')).toBe(r.final.counts.upgradesBought);
      const upgradeSeeds = r.purchases.filter((p) => p.kind === 'upgrade').reduce((sum, p) => sum + p.cost, 0);
      expect(upgradeSeeds).toBeCloseTo(r.final.spentUpgrades, 6);
      // Bezahlte Aussaaten: alle gekauften außer der ersten gratis.
      expect(kinds('sow')).toBeLessThanOrEqual(r.final.counts.plantsBought);
      expect(kinds('sow')).toBeGreaterThanOrEqual(r.final.counts.plantsBought - 1);
      const share = seedSpendShare(r.final);
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
  });

  it('nie beide Wege einer Gabel; forkChoice bleibt bei der erforschten Seite', () => {
    for (const r of [...harmony.runs, ...random.runs]) {
      const owned = Object.keys(r.final.careRanks);
      for (const fork of RESEARCH_FORKS) {
        const a = fork.paths[0].some((id) => owned.includes(id));
        const b = fork.paths[1].some((id) => owned.includes(id));
        expect(a && b, fork.id).toBe(false);
      }
    }
    const state = createInitialState(0, 1);
    state.cycle.research = ['nest-boxes', 'dense-crown'];
    const crown = RESEARCH_FORKS.findIndex((f) => f.id === 'crown');
    for (const s of [HARMONY, GROWTH, RANDOM]) expect(forkChoice(state, s, RESEARCH_FORKS[crown]!, crown)).toBe(1);
    expect(forkSideOf(state.cycle.research, RESEARCH_FORKS[crown]!)).toBe(1);
    // Ohne erreichbaren Weg (Stufe fehlt) ist nichts entschieden.
    expect(forkChoice(createInitialState(0, 1), HARMONY, RESEARCH_FORKS[crown]!, crown)).toBeNull();
  });

  it('der Zufallsspieler sät und tauscht (sowPolicy spend) – er sitzt nicht mehr auf seinen Samen', () => {
    // Bis Phase 11, 1e säte er nur in freie Plätze: ~1 % ausgegeben bis Hain (28.2).
    const share = median(random.runs.map((r) => seedSpendShare(r.stages[HAIN]!)));
    expect(share).toBeGreaterThan(0.3);
    expect(median(random.runs.map((r) => r.stages[HAIN]!.counts.plantsBought))).toBeGreaterThan(8);
  });
});

describe('Ausbau-Strategie (Phase 11, 3a): Zielzeile, Rücklage, Säen mit Vorrang', () => {
  it('cheapestGoal wählt wie nextGoal (Meilenstein in ≤ 120 s, sonst der billigste, Gleichstand: der frühere)', () => {
    const state = createInitialState(0, 1);
    state.stage = 1;
    state.plants = ['moss'];
    state.cycle.upgrades.niches.roots = 9;
    for (const rate of [0.01, 0.3, 1, 1e3]) {
      for (const seeds of [0, 50, 1e4]) {
        state.seeds = seeds;
        expect(cheapestGoal(goalCandidates(state, rate)), `${rate} ${seeds}`).toEqual(nextGoal(state, rate));
      }
    }
  });

  it('seedGoals: Säen nur, wenn die Strategie säen würde – vorn (Gleichstand: Säen zuerst)', () => {
    const state = createInitialState(0, 1);
    state.stage = 2;
    state.plants = ['moss', 'moss'];
    expect(seedGoals(state, false, 1).some((g) => g.kind === 'sow')).toBe(false);
    const goals = seedGoals(state, true, 1);
    expect(goals[0]!.kind).toBe('sow');
    expect(goals.filter((g) => g.kind === 'sow')).toHaveLength(1);
  });

  it('Rücklage: 60 Samen-Sekunden plus ein Wurf', () => {
    expect(seedReserve(0)).toBe(REROLL_BASE_COST);
    expect(seedReserve(2)).toBe(SEED_RESERVE_SECONDS * 2 + REROLL_BASE_COST);
    expect(seedReserve(NaN)).toBe(REROLL_BASE_COST);
  });

  it('ohne Ausbau (upgrades: false) kauft der Simulator keine Stufe; mit Ausbau baut er aus', () => {
    const opts = { seed: 1007, targetStage: 4, maxSeconds: MAX_SECONDS, care: true };
    const off = runGame(HARMONY, { ...opts, upgrades: false });
    expect(off.final.counts.upgradesBought).toBe(0);
    expect(off.final.spentUpgrades).toBe(0);
    const on = runGame(HARMONY, opts);
    expect(on.final.counts.upgradesBought).toBeGreaterThan(20);
    expect(Object.keys(on.final.upgradeLevels)).toContain('roots');
    // Der Zufallsspieler baut mit eigenem Zufall aus – deterministisch je Seed.
    expect(runGame(RANDOM, opts)).toEqual(runGame(RANDOM, opts));
  });
});

describe('Sitzungsprofil (aktiv / offline über simulateOffline)', () => {
  const options = { seed: 1007, activeSeconds: 600, offlineSeconds: 3600, days: 3 };

  it('ist deterministisch, rechnet die Abwesenheit mit simulateOffline und spielt danach weiter', () => {
    const a = runSession(HARMONY, options);
    expect(runSession(HARMONY, options)).toEqual(a);
    expect(a.length).toBeGreaterThan(1);
    for (const d of a) {
      expect(d.offlineSeconds).toBe(Math.min(options.offlineSeconds, MAX_OFFLINE_SECONDS));
      expect(d.offlineSeeds).toBeGreaterThan(0);
      expect(d.stageOffline).toBeGreaterThanOrEqual(d.stageActive);
      expect(d.stageActive).toBeGreaterThanOrEqual(d.stageStart);
    }
    // Der zweite Tag beginnt dort, wo die Abwesenheit endete.
    expect(a[1]!.stageStart).toBe(a[0]!.stageOffline);
  });

  it('endet mit der Ziel-Stufe', () => {
    const days = runSession(GROWTH, { ...options, targetStage: 3, days: 10 });
    expect(days[days.length - 1]!.stageOffline).toBeGreaterThanOrEqual(3);
  });

  it('Abwesenheit ab einer Stufe: Stand wie runGame bis dorthin', () => {
    const off = offlineAfterStage(HARMONY, { seed: 1007, stage: 3, seconds: 1800 });
    const run = runGame(HARMONY, { seed: 1007, targetStage: 3, maxSeconds: MAX_SECONDS, care: true });
    expect(off.stage).toBe(run.final.stage);
    expect(off.stageAfter).toBeGreaterThanOrEqual(off.stage);
    expect(off.seeds).toBeGreaterThan(0);
  });

  it.skipIf(!FULL)('Protokoll: ein Tag mit 30 min aktiv und 8 h offline (Harmonie, Zufall) und 8 h offline am Hain', () => {
    const n = Math.min(RUNS, 100);
    for (const s of [HARMONY, RANDOM]) {
      console.log(sessionTable(s.name, Array.from({ length: n }, (_, i) => runSession(s, { seed: 1000 + 7 * i }))));
    }
    const off = Array.from({ length: n }, (_, i) => offlineAfterStage(HARMONY, { seed: 1000 + 7 * i, stage: HAIN, seconds: 8 * 3600 }));
    console.log(
      `8 h offline am Hain (Harmonie, ${n} Durchgänge, Median): ${median(off.map((o) => o.waypoints))} Wegpunkte, ` +
        `${median(off.map((o) => o.stageAfter - o.stage))} Stufen, ${Math.round(median(off.map((o) => o.seeds)))} 🌰, ${Math.round(median(off.map((o) => o.harmony)))} ⚖️ ` +
        `(Ziel 28.10: ≤ 8 Wegpunkte, ≤ 1 Stufe)`,
    );
    expect(off.length).toBe(n);
  }, 3_600_000);
});
