import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, formatTime, median, runCycles, type Strategy } from '../scripts/simulate';
import {
  firstCycleOf,
  firstCycleTable,
  harmonyTable,
  medianOrNull,
  milestoneTable,
  peakTable,
  runLandscape,
  siteRun,
  varietyLandscapeTable,
  wildwechselChanceTable,
  withoutFeatured,
  withoutSiteWeather,
  type LandscapeSummary,
} from '../scripts/landscape';
import { LANDSCAPE_SITES, SITE_IDS } from '../src/content/landscape';
import { SEASON_IDS } from '../src/content/seasons';
import { WEATHERS } from '../src/content/weather';
import { averageWeatherEffectsFor, isRough, weatherOfDayFromSeed, weatherSeed } from '../src/core/weather';
import { env } from './balance-setup';

/**
 * Waldlandschaft (DESIGN_V2.md 24.10) mit der echten Logik aus core/ (scripts/landscape.ts).
 * Eine ganze Landschaft sind 70–90 Zyklen bis zum Urwald – der große Lauf nur auf Wunsch:
 *
 *   SIM_LANDSCAPE=1 SIM_LANDSCAPE_RUNS=20 npx vitest run tests/landscape-balance.test.ts --silent=false
 *
 * Ziele (24.10): (a) jeder neue Wald erreicht seinen ersten Urwald schneller als der
 * Heimatwald (2. Wald ≤ 0,5 ×, danach nie langsamer als ~1,1 × der vorige), (b) die Landschaft
 * ist für den Harmonie-Spieler nach 12–30 h Spielzeit vollständig (lange Motivation, ohne
 * zähe Strecken), (c) Waldtypen ±5 % wie die Hauptbaum-Arten, (d) alle Zahlen bleiben weit
 * unter 1e15 (kein break_infinity.js nötig).
 */
const LARGE = !!env.SIM_LANDSCAPE;
const RUNS = Number(env.SIM_LANDSCAPE_RUNS ?? 20);
const SITE_RUNS = Number(env.SIM_LANDSCAPE_SITE_RUNS ?? 160);
const options = { maxCycles: 250, cycleMaxSeconds: 6 * 3600 };

function summary(label: string, strategy: Strategy, runs = RUNS, wildwechsel = true): LandscapeSummary {
  return { label, runs: Array.from({ length: runs }, (_, k) => runLandscape({ ...options, strategy, seed: 1001 + k, wildwechsel })) };
}

/**
 * Wildwechsel-Varianten (2c): `on` = Spiel heute, `off` = ohne Wildwechsel-Karten (Bestand der
 * Nachbarn leer), `none` = zusätzlich ohne `featured` (wie vor Schritt B). Auswahl mit
 * SIM_LANDSCAPE_WW=on,off,none (Standard: alle drei; einzeln, um parallel zu rechnen).
 */
const WW_VARIANTS = (env.SIM_LANDSCAPE_WW ?? 'on,off,none').split(',');

/**
 * Wetter je Standort (24.14, seit 3c in core/): SIM_LANDSCAPE_SITE_WEATHER=off spielt die
 * Spielweisen ohne `ForestSite.weather` (jeder Wald mit dem Wetter des Heimatwaldes) – der
 * Vergleich „vor 3c“ für 24.10 (3d).
 */
const SITE_WEATHER = env.SIM_LANDSCAPE_SITE_WEATHER !== 'off';
const withSiteWeatherSetting = <T>(fn: () => T): T => (SITE_WEATHER ? fn() : withoutSiteWeather(fn));
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')} %`;

describe('Waldlandschaft – Simulation (kurz)', { timeout: 120_000 }, () => {
  it('ein Harmonie-Spieler schaltet die Landschaft frei und gründet den zweiten Wald (echte Logik)', () => {
    const run = runLandscape({ strategy: HARMONY, seed: 1001, maxCycles: 5, cycleMaxSeconds: 6 * 3600 });
    expect(run.unlockAt).not.toBeNull();
    expect(Object.keys(run.foundedAt).length).toBeGreaterThanOrEqual(2);
    expect(run.jayEarned).toBeGreaterThanOrEqual(run.jaySpent);
    const second = run.cycles.find((c) => c.site !== 'home');
    // Der zweite Wald startet mit Zufluss über den Gratis-Korridor, nicht bei 0.
    expect(second?.effective).toBeGreaterThan(0);
    expect(second?.ownBefore).toBe(0);
  });
});

describe.skipIf(!LARGE)('Waldlandschaft – Simulation (großer Lauf)', { timeout: 7_200_000 }, () => {
  it('Heute: Urwald-Neustarts bis zum vollen Waldgedächtnis (ohne Landschaft)', () => {
    const cycles = 16;
    const runs = Array.from({ length: RUNS }, (_, k) => runCycles(HARMONY, { seed: 1001 + k, targetStage: 7, maxSeconds: 6 * 3600, care: true, cycles }));
    const lines = ['| Zyklus | Gedächtnis zu Beginn | Gewinn | Urwald nach | Spielzeit gesamt |', '|---|---|---|---|---|'];
    let total = 0;
    for (let c = 0; c < cycles; c++) {
      const t = median(runs.map((r) => r[c]!.result.stages[7]?.time ?? r[c]!.result.final.time));
      total += t;
      lines.push(`| ${c + 1} | ${median(runs.map((r) => r[c]!.memory))} | ${median(runs.map((r) => r[c]!.memoryGain))} | ${formatTime(t)} | ${(total / 3600).toFixed(1).replace('.', ',')} h |`);
    }
    console.log(lines.join('\n'));
    expect(median(runs.map((r) => r[13]!.memory))).toBe(1000);
  });

  it('Spielweisen', () => {
    const rows = withSiteWeatherSetting(() => [summary('Harmonie', HARMONY), summary('Wachstum', GROWTH), summary('Zufall', RANDOM, Math.min(RUNS, 10))]);
    console.log(`### Spielweisen, ${SITE_WEATHER ? 'mit' : 'ohne'} Wetter je Standort`);
    const complete = rows.map((r) => medianOrNull(r.runs.map((x) => x.completeAt)));
    const maxed = rows.map((r) => medianOrNull(r.runs.map((x) => x.allMaxedAt)));
    console.log(`${milestoneTable(rows)}\n\n${firstCycleTable(rows)}\n\n${harmonyTable(rows)}\n\n${peakTable(rows)}`);
    console.log(
      `Wachstum gegenüber Harmonie: vollständig ${((complete[0]! / complete[1]! - 1) * 100).toFixed(1)} % schneller, alle voll ${((maxed[0]! / maxed[1]! - 1) * 100).toFixed(1)} % schneller`,
    );
    const h = rows[0]!;
    // (a) Jeder neue Wald startet deutlich schneller als der Heimatwald.
    const first = [0, 1, 2, 3, 4, 5].map((k) => medianOrNull(h.runs.map((run) => firstCycleOf(run, k))));
    expect(first[1]!).toBeLessThanOrEqual(0.5 * first[0]!);
    for (let k = 2; k <= 5; k++) expect(first[k]!).toBeLessThanOrEqual(1.1 * first[k - 1]!);
    // (b) Vollständig nach 12–30 h.
    expect(complete[0]!).toBeGreaterThan(12 * 3600);
    expect(complete[0]!).toBeLessThan(30 * 3600);
    // (d) Größenordnung.
    for (const r of rows) {
      expect(complete[rows.indexOf(r)], r.label).not.toBeNull();
      for (const run of r.runs) {
        expect(run.maxGrowth).toBeLessThan(1e5);
        expect(run.lifetimeGrowth).toBeLessThan(1e9);
      }
    }
  });

  it('Wildwechsel: Vielfalt der Karten mit und ohne (7.7, 24.6)', () => {
    const labels = { on: 'mit Wildwechsel', off: 'ohne Wildwechsel', none: 'ohne Wildwechsel und ohne featured' } as const;
    for (const v of WW_VARIANTS as (keyof typeof labels)[]) {
      const make = () => [
        summary(`Harmonie, ${labels[v]}`, HARMONY, RUNS, v === 'on'),
        summary(`Wachstum, ${labels[v]}`, GROWTH, RUNS, v === 'on'),
        summary(`Zufall, ${labels[v]}`, RANDOM, Math.min(RUNS, 10), v === 'on'),
      ];
      const rows = v === 'none' ? withoutFeatured(make) : make();
      console.log(`### ${labels[v]}\n\n${milestoneTable(rows)}\n\n${firstCycleTable(rows)}\n\n${varietyLandscapeTable(rows)}\n\n${wildwechselChanceTable(rows)}`);
      const complete = rows.map((r) => medianOrNull(r.runs.map((x) => x.completeAt)));
      const maxed = rows.map((r) => medianOrNull(r.runs.map((x) => x.allMaxedAt)));
      console.log(`Wachstum gegenüber Harmonie (${labels[v]}): vollständig ${((complete[0]! / complete[1]! - 1) * 100).toFixed(1)} %, alle voll ${((maxed[0]! / maxed[1]! - 1) * 100).toFixed(1)} %`);
      for (const r of rows) for (const run of r.runs) for (const c of run.cycles) {
        expect(c.wildwechselOffered).toBeLessThanOrEqual(c.animalEncounters);
        if (v !== 'on') expect(c.wildwechselOffered).toBe(0);
      }
    }
  });

  it('Waldtypen im Vergleich (wie die Baumarten, 17.4), mit und ohne Wetter je Standort, Käferjahr', () => {
    const head = '| Wald | Leitbaum | Harmonie: Urwald | gegenüber Heimatwald | ohne Standort-Wetter | Wachstum: Urwald | gegenüber Heimatwald | ohne Standort-Wetter | Käferjahr H / W (ohne) |';
    const lines = [head, '|---|---|---|---|---|---|---|---|---|'];
    const home: Record<string, number> = {};
    const cells: Record<string, string[]> = {};
    const beetle: Record<string, string[]> = {};
    const deviations: string[] = [];
    const runs = (strategy: Strategy, site: (typeof SITE_IDS)[number]) => Array.from({ length: SITE_RUNS }, (_, k) => siteRun(strategy, site, 3000 + k, 200));
    for (const strategy of [HARMONY, GROWTH]) {
      for (const site of SITE_IDS) {
        const withWeather = runs(strategy, site);
        const plain = withoutSiteWeather(() => runs(strategy, site));
        const t = median(withWeather.map((r) => r.seconds ?? 6 * 3600));
        const t0 = median(plain.map((r) => r.seconds ?? 6 * 3600));
        // Der Heimatwald hat keine Faktoren: mit und ohne gleich – Bezug für beide Spalten.
        if (site === 'home') home[strategy.id] = t;
        const rel = t / home[strategy.id]! - 1;
        (cells[site] ??= []).push(formatTime(t), pct(rel), pct(t0 / home[strategy.id]! - 1));
        const count = (rs: { seen: string[] }[]) => rs.filter((r) => r.seen.includes('beetle-year')).length;
        (beetle[site] ??= []).push(`${count(withWeather)} (${count(plain)})`);
        if (Math.abs(rel) >= 0.05) deviations.push(`${strategy.id} ${site} ${(rel * 100).toFixed(1)} %`);
      }
    }
    for (const s of LANDSCAPE_SITES) lines.push(`| ${s.icon} ${s.name} | ${s.leadTree ?? 'oak'} | ${cells[s.id]!.join(' | ')} | ${beetle[s.id]!.join(' / ')} von ${SITE_RUNS} |`);
    console.log(lines.join('\n'));
    expect(deviations).toEqual([]);
  });

  it('Wetter je Standort: Häufigkeiten nach den Regeln und Mittel über das Jahr (24.14, echte Logik)', () => {
    const lines = ['| Wald | Jahreszeit | ' + WEATHERS.map((w) => w.icon).join(' | ') + ' | rau |', '|---|---|' + WEATHERS.map(() => '---|').join('') + '---|'];
    const year = ['| Wald | 🌿 ungedämpft | 🌿 Hain | 🌰 | Moose & Farne 🌿 | Blumen 🌰 |', '|---|---|---|---|---|---|'];
    const f = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1).replace('.', ',')} %`;
    for (const site of LANDSCAPE_SITES) {
      const counts = SEASON_IDS.map(() => new Map<string, number>());
      let roughPairs = 0;
      for (let c = 1; c <= 2000; c++) {
        const seed = weatherSeed({ number: c, startedAt: 1_700_000_000_000 + c * 86_400_017 });
        let prevRough = false;
        for (let d = 4; d <= 400; d++) {
          const w = weatherOfDayFromSeed(seed, d, site.id);
          const m = counts[d % 4]!;
          m.set(w, (m.get(w) ?? 0) + 1);
          if (isRough(w) && prevRough) roughPairs++;
          prevRough = isRough(w);
        }
      }
      expect(roughPairs).toBe(0);
      SEASON_IDS.forEach((season, i) => {
        const m = counts[i]!;
        const all = [...m.values()].reduce((a, b) => a + b, 0);
        const share = (id: string) => (m.get(id) ?? 0) / all;
        const rough = WEATHERS.filter((w) => w.rough).reduce((a, w) => a + share(w.id), 0);
        lines.push(`| ${site.icon} ${site.name} | ${season} | ` + WEATHERS.map((w) => (share(w.id) > 0 ? `${(share(w.id) * 100).toFixed(1).replace('.', ',')} %` : '–')).join(' | ') + ` | ${(rough * 100).toFixed(1).replace('.', ',')} % |`);
      });
      const sum = (genera: number, kind: string, group?: string) =>
        SEASON_IDS.reduce((a, s) => a + averageWeatherEffectsFor(s, genera, {}, 'oak', false, site.id).filter((e) => e.kind === kind && (group === undefined || ('group' in e && e.group === group))).reduce((b, e) => b + e.pct, 0), 0) / 4;
      year.push(`| ${site.icon} ${site.name} | ${f(sum(0, 'growth'))} | ${f(sum(5, 'growth'))} | ${f(sum(0, 'seeds'))} | ${f(sum(0, 'groupGrowth', 'mosses'))} | ${f(sum(0, 'groupSeeds', 'flowers'))} |`);
    }
    console.log(`${lines.join('\n')}\n\n${year.join('\n')}`);
  });
});
