import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, environmentTable, monteCarlo, stageStats, treeTable, type Summary } from '../scripts/simulate';
import { SEASONS_BY_ID } from '../src/content/seasons';
import type { MainTreeId } from '../src/content/trees';
import { FULL, HAIN, MAX_SECONDS, TREE_RUNS, URWALD } from './balance-setup';

/**
 * Jahreszeiten und Hauptbaum-Arten mit der ECHTEN Logik und allen Systemen (Pflege,
 * Ereignisse, Gäste; DESIGN_V2.md 15.4, 16, 17). Verglichen werden die drei Baumarten im
 * ersten Zyklus (ohne Waldgedächtnis, ohne Freischaltung) mit denselben Seeds. Ziel aus
 * dem Balancing 2.10: keine Art dominiert – Buche und Kiefer liegen beim Hain innerhalb von
 * ±5 % der Eiche, für den Harmonie- wie für den Wachstums-Spieler.
 *
 * Im Check TREE_RUNS Durchgänge bis zum Hain; der große Lauf (npm run balance) zusätzlich
 * mit dem Zufallsspieler und bis zum Urwald.
 */
const options = { targetStage: FULL ? URWALD : HAIN, maxSeconds: MAX_SECONDS, care: true };
const strategies = FULL ? [HARMONY, GROWTH, RANDOM] : [HARMONY, GROWTH];
const TREES: readonly MainTreeId[] = ['oak', 'beech', 'pine'];
const byTree = Object.fromEntries(TREES.map((t) => [t, monteCarlo(strategies, TREE_RUNS, { ...options, mainTree: t })])) as Record<
  MainTreeId,
  Summary[]
>;
const rows = strategies.map((strategy, i) => ({
  strategy,
  trees: Object.fromEntries(TREES.map((t) => [t, byTree[t][i]!])) as Record<MainTreeId, Summary>,
}));

describe('Jahreszeiten und Baumarten (echte Logik, alle Systeme)', () => {
  it('Protokoll', () => {
    if (FULL) {
      console.log(treeTable(rows));
      for (const { strategy, trees } of rows) {
        console.log(
          `#### ${strategy.name} (${TREE_RUNS} Durchgänge)\n\n` +
            environmentTable([
              { label: 'Eiche', summary: trees.oak },
              { label: 'Buche', summary: trees.beech },
              { label: 'Kiefer', summary: trees.pine },
            ]),
        );
      }
    }
    expect(rows.length).toBe(strategies.length);
  });

  it('jede Art erreicht den Hain; Buche und Kiefer innerhalb ±5 % der Eiche (Check ±8 %; Harmonie und Wachstum)', () => {
    // Ziel ±5 % (großer Lauf, DESIGN_V2.md 15.4). Im Check (30 Durchgänge, feste Seeds)
    // schwankt der Median je nach Seed-Startwert deutlich (Kiefer bis −5,4 %) – Grenze dort ±8 %.
    const limit = FULL ? 0.05 : 0.08;
    for (const { strategy, trees } of rows.filter((r) => r.strategy !== RANDOM)) {
      const oak = stageStats(trees.oak, HAIN);
      for (const t of TREES) {
        const st = stageStats(trees[t], HAIN);
        expect(st.reachedShare, `${strategy.id} ${t}`).toBe(1);
        expect(Math.abs(st.time / oak.time - 1), `${strategy.id} ${t}`).toBeLessThan(limit);
        expect(Math.abs(st.harmony - oak.harmony), `${strategy.id} ${t}`).toBeLessThan(6);
      }
    }
  });

  it('Frühlingsbonus: der Zyklus beginnt im Frühling mit +10 % 🌿', () => {
    const spring = SEASONS_BY_ID.get('spring')!;
    expect(spring.effects).toContainEqual({ kind: 'growth', pct: 10 });
    // Der Setzling (~45 s) liegt ganz im ersten Frühling (3 min).
    for (const t of TREES) expect(stageStats(byTree[t][0]!, 2).time, t).toBeLessThan(180);
  });
});
