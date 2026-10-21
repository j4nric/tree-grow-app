import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, environmentTable, formatTime, monteCarlo, stageStats } from '../scripts/simulate';
import { ambientModel, weatherOfDay, weatherSeed } from '../scripts/weather-model';
import { SEASON_IDS } from '../src/content/seasons';
import { WEATHERS } from '../src/content/weather';
import { env, HAIN, MAX_SECONDS, URWALD } from './balance-setup';

/**
 * Wetter und Nachtarten (DESIGN_V2.md 21) im MODELL (scripts/weather-model.ts) mit der
 * echten Logik aller übrigen Systeme. Läuft nur auf Wunsch – die Logik in core/ fehlt noch:
 *
 *   SIM_WEATHER=1 SIM_WEATHER_RUNS=200 npx vitest run tests/weather-balance.test.ts --silent=false
 *
 * SIM_WEATHER_FULL=1 rechnet bis zum Urwald statt bis zum Hain.
 */
const ON = !!env.SIM_WEATHER;
const RUNS = Number(env.SIM_WEATHER_RUNS ?? 60);
const TARGET = env.SIM_WEATHER_FULL ? URWALD : HAIN;

describe.skipIf(!ON)('Wetter und Nachtarten (Modell)', () => {
  it('Häufigkeiten über 2000 Zyklen × 400 Tage', () => {
    const counts = SEASON_IDS.map(() => new Map<string, number>());
    let roughPairs = 0;
    for (let c = 1; c <= 2000; c++) {
      const seed = weatherSeed({ number: c, startedAt: 1_700_000_000_000 + c * 86_400_017 });
      let prevRough = false;
      for (let d = 1; d <= 400; d++) {
        const w = weatherOfDay(seed, d);
        const m = counts[d % 4]!;
        m.set(w, (m.get(w) ?? 0) + 1);
        const rough = !!WEATHERS.find((x) => x.id === w)!.rough;
        if (rough && prevRough) roughPairs++;
        prevRough = rough;
      }
    }
    const lines = [
      '| Jahreszeit | ' + WEATHERS.map((w) => `${w.icon} ${w.name}`).join(' | ') + ' |',
      '|---|' + WEATHERS.map(() => '---|').join(''),
    ];
    SEASON_IDS.forEach((s, i) => {
      const total = [...counts[i]!.values()].reduce((a, b) => a + b, 0);
      lines.push(`| ${s} | ` + WEATHERS.map((w) => `${((100 * (counts[i]!.get(w.id) ?? 0)) / total).toFixed(1)} %`).join(' | ') + ' |');
    });
    console.log(lines.join('\n'));
    expect(roughPairs).toBe(0);
  });

  it('Stufenzeiten mit und ohne Wetter/Nacht', () => {
    const options = { targetStage: TARGET, maxSeconds: MAX_SECONDS, care: true };
    const variants = [
      { label: 'ohne (heute)', ambient: undefined },
      { label: 'nur Wetter', ambient: ambientModel({ weather: true, night: false }) },
      { label: 'nur Nachtarten', ambient: ambientModel({ weather: false, night: true }) },
      { label: 'Wetter + Nacht', ambient: ambientModel({ weather: true, night: true }) },
      { label: 'Wetter + Nacht, gemittelt (offline)', ambient: ambientModel({ weather: true, night: true, average: true }) },
    ];
    const results = variants.map((v) => ({
      label: v.label,
      s: monteCarlo([HARMONY, GROWTH], RUNS, { ...options, ambient: v.ambient }),
    }));
    for (const i of [0, 1]) {
      console.log(`#### ${i === 0 ? HARMONY.name : GROWTH.name} (${RUNS} Durchgänge)\n`);
      console.log(environmentTable(results.map((r) => ({ label: r.label, summary: r.s[i]! }))));
      const base = stageStats(results[0]!.s[i]!, HAIN).time;
      for (const r of results) {
        const t = stageStats(r.s[i]!, HAIN).time;
        console.log(`${r.label}: Hain ${formatTime(t)} (${((t / base - 1) * 100).toFixed(1)} %)`);
      }
    }
    expect(results.length).toBe(variants.length);
  }, 3_600_000);
});
