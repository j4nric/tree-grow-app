import { describe, expect, it } from 'vitest';
import type { SiteId } from '../src/content/landscape';
import type { MainTreeId } from '../src/content/trees';
import { siteRun } from '../scripts/landscape';
import { registerCandidateTrees } from '../scripts/site-trees';
import { GROWTH, HARMONY, formatTime, median } from '../scripts/simulate';
import { env } from './balance-setup';

/**
 * Messung der geplanten Hauptbäume je Waldtyp (DESIGN_V2.md 25.4) – nur mit SIM_SITE_TREES=1.
 * Gleiche Messung wie „Waldtypen im Vergleich“ (24.7): siteRun, Gedächtnis 200, alle Gaben,
 * mit Pflege, 80 Durchgänge, Median bis zum Urwald; Ziel ±5 % gegenüber Heimatwald mit Eiche.
 */
const RUNS = Number(env.SIM_SITE_TREES_RUNS ?? 80);
const CASES: readonly [SiteId, string][] = [
  ['home', 'oak'], ['mountain', 'beech'], ['mountain', 'fir'], ['home', 'fir'],
  ['carr', 'oak'], ['carr', 'alder'], ['home', 'alder'],
];

describe.skipIf(!env.SIM_SITE_TREES)('Hauptbäume je Waldtyp – Messung (Phase 7)', { timeout: 1_800_000 }, () => {
  it('Weißtanne und Schwarzerle liegen innerhalb ±5 % (Gedächtnis 200 und 0)', () => {
    registerCandidateTrees();
    const deviations: string[] = [];
    for (const memory of [200, 0]) {
      const lines = [`Gedächtnis ${memory}`, '| Wald | Baum | Harmonie | gegenüber Heimatwald/Eiche | Wachstum | gegenüber Heimatwald/Eiche |', '|---|---|---|---|---|---|'];
      const cells = new Map<string, string[]>();
      for (const strategy of [HARMONY, GROWTH]) {
        let base = 0;
        for (const [site, tree] of CASES) {
          const t = median(Array.from({ length: RUNS }, (_, k) => siteRun(strategy, site, 3000 + k, memory, 6 * 3600, tree as MainTreeId).seconds ?? 6 * 3600));
          if (site === 'home' && tree === 'oak') base = t;
          const rel = t / base - 1;
          if (Math.abs(rel) >= 0.05) deviations.push(`${memory} ${strategy.id} ${site} ${tree} ${(rel * 100).toFixed(1)} %`);
          const key = `${site} ${tree}`;
          cells.set(key, [...(cells.get(key) ?? []), formatTime(t), `${rel >= 0 ? '+' : '−'}${Math.abs(rel * 100).toFixed(1).replace('.', ',')} %`]);
        }
      }
      for (const [key, c] of cells) lines.push(`| ${key.replace(' ', ' | ')} | ${c.join(' | ')} |`);
      console.log(lines.join('\n'));
    }
    expect(deviations).toEqual([]);
  });
});
