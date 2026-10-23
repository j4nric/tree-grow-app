import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, formatTime, median } from '../scripts/simulate';
import { siteRun } from '../scripts/landscape';
import { withSiteWeather } from '../scripts/site-weather';
import { LANDSCAPE_SITES, SITE_IDS } from '../src/content/landscape';
import { SEASON_IDS } from '../src/content/seasons';
import { WEATHERS } from '../src/content/weather';
import { averageWeatherEffectsFor, isRough, weatherOfDayFromSeed, weatherSeed } from '../src/core/weather';
import { env } from './balance-setup';

/**
 * Waldtyp und Wetter (DESIGN_V2.md 24.14, Phase 7, 3b) – Messung vor der Logik (3c) über
 * scripts/site-weather.ts (Gewichte des Standorts zur Laufzeit). Nur auf Wunsch:
 *
 *   SIM_SITE_WEATHER=1 npx vitest run tests/site-weather-balance.test.ts --silent=false
 *
 * Ziel wie 24.7: jeder Waldtyp ±5 % Zeit bis zum Urwald gegenüber dem Heimatwald.
 *
 * Achtung seit 3c: Der Kern rechnet die Standort-Faktoren selbst ein. Der Vergleich der
 * Waldtypen (`siteRun` mit aktivem Standort) wendet sie hier doppelt an – keine neuen Zahlen
 * damit messen. 3d ersetzt die Messung durch den großen Lauf und löscht diese Datei.
 */
const ON = !!env.SIM_SITE_WEATHER;
const SITE_RUNS = Number(env.SIM_SITE_WEATHER_RUNS ?? 80);
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')} %`;

describe.skipIf(!ON)('Waldtyp und Wetter (Messung)', { timeout: 7_200_000 }, () => {
  it('Häufigkeiten je Standort (2000 Zyklen × 400 Tage) und Mittel über das Jahr', () => {
    const lines = ['| Wald | Jahreszeit | ' + WEATHERS.map((w) => w.icon).join(' | ') + ' | rau |', '|---|---|' + WEATHERS.map(() => '---|').join('') + '---|'];
    const year = ['| Wald | 🌿 ungedämpft | 🌿 Hain (5 Gattungen) | 🌰 | Moose 🌿 | Blumen 🌰 |', '|---|---|---|---|---|---|'];
    for (const site of LANDSCAPE_SITES) {
      withSiteWeather(site.id, () => {
        const counts = SEASON_IDS.map(() => new Map<string, number>());
        let roughPairs = 0;
        for (let c = 1; c <= 2000; c++) {
          const seed = weatherSeed({ number: c, startedAt: 1_700_000_000_000 + c * 86_400_017 });
          let prevRough = false;
          for (let d = 4; d <= 400; d++) {
            const w = weatherOfDayFromSeed(seed, d);
            const m = counts[d % 4]!;
            m.set(w, (m.get(w) ?? 0) + 1);
            if (isRough(w) && prevRough) roughPairs++;
            prevRough = isRough(w);
          }
        }
        expect(roughPairs).toBe(0);
        SEASON_IDS.forEach((s, i) => {
          const m = counts[i]!;
          const all = [...m.values()].reduce((a, b) => a + b, 0);
          const share = (id: string) => (m.get(id) ?? 0) / all;
          const rough = WEATHERS.filter((w) => w.rough).reduce((a, w) => a + share(w.id), 0);
          lines.push(`| ${site.icon} ${site.name} | ${s} | ` + WEATHERS.map((w) => (share(w.id) > 0 ? `${(share(w.id) * 100).toFixed(1).replace('.', ',')} %` : '–')).join(' | ') + ` | ${(rough * 100).toFixed(1).replace('.', ',')} % |`);
        });
        // Jahresmittel (Mittelwetter 21.5, Eiche, ohne Pflege): Gruppen getrennt.
        const sum = (genera: number, kind: string, group?: string) =>
          SEASON_IDS.reduce((a, s) => a + averageWeatherEffectsFor(s, genera, {}, 'oak').filter((e) => e.kind === kind && (group === undefined || ('group' in e && e.group === group))).reduce((b, e) => b + e.pct, 0), 0) / 4;
        const f = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1).replace('.', ',')} %`;
        year.push(`| ${site.icon} ${site.name} | ${f(sum(0, 'growth'))} | ${f(sum(5, 'growth'))} | ${f(sum(0, 'seeds'))} | ${f(sum(0, 'groupGrowth', 'mosses'))} | ${f(sum(0, 'groupSeeds', 'flowers'))} |`);
      });
    }
    console.log(`${lines.join('\n')}\n\n${year.join('\n')}`);
  });

  it('Waldtypen im Vergleich mit Wetter je Standort (24.7) und Käferjahr', () => {
    const head = '| Wald | Leitbaum | Harmonie: Urwald | gegenüber Heimatwald | ohne Standort-Wetter | Wachstum: Urwald | gegenüber Heimatwald | ohne Standort-Wetter | Käferjahr H / W |';
    const lines = [head, '|---|---|---|---|---|---|---|---|---|'];
    const deviations: string[] = [];
    const home: Record<string, number> = {};
    const cells: Record<string, string[]> = {};
    const beetle: Record<string, string[]> = {};
    for (const strategy of [HARMONY, GROWTH]) {
      for (const site of SITE_IDS) {
        const plain = Array.from({ length: SITE_RUNS }, (_, k) => siteRun(strategy, site, 3000 + k, 200));
        const weather = withSiteWeather(site, () => Array.from({ length: SITE_RUNS }, (_, k) => siteRun(strategy, site, 3000 + k, 200)));
        const t0 = median(plain.map((r) => r.seconds ?? 6 * 3600));
        const t = median(weather.map((r) => r.seconds ?? 6 * 3600));
        if (site === 'home') home[strategy.id] = t;
        const rel = t / home[strategy.id]! - 1;
        const rel0 = t0 / home[strategy.id]! - 1;
        (cells[site] ??= []).push(formatTime(t), pct(rel), pct(rel0));
        (beetle[site] ??= []).push(`${weather.filter((r) => r.seen.includes('beetle-year')).length}/${SITE_RUNS} (vorher ${plain.filter((r) => r.seen.includes('beetle-year')).length})`);
        if (Math.abs(rel) >= 0.05) deviations.push(`${strategy.id} ${site} ${(rel * 100).toFixed(1)} %`);
      }
    }
    for (const s of LANDSCAPE_SITES) lines.push(`| ${s.icon} ${s.name} | ${s.leadTree ?? 'oak'} | ${cells[s.id]!.slice(0, 3).join(' | ')} | ${cells[s.id]!.slice(3).join(' | ')} | ${beetle[s.id]!.join(' / ')} |`);
    console.log(lines.join('\n'));
    expect(deviations).toEqual([]);
  });
});
