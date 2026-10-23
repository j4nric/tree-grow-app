import { describe, expect, it } from 'vitest';
import { RESEARCH } from '../src/content/research';
import { DAY_SECONDS, DAY_START_PHASE, NIGHT_END_PHASE, NIGHT_SHARE, NIGHT_START_PHASE, NOCTURNAL } from '../src/content/daytime';
import { SEASON_IDS } from '../src/content/seasons';
import { SPECIES_BY_ID } from '../src/content/species';
import { MAIN_TREES_BY_ID } from '../src/content/trees';
import {
  AFTER_ROUGH_WEATHER,
  DIVERSITY_DAMPING_MAX,
  DIVERSITY_DAMPING_PER_GENUS,
  FIRST_DAY_WEATHER,
  PROTECTION_FACTOR,
  WEATHERS,
  WEATHERS_BY_ID,
  WEATHER_WEIGHTS,
  type WeatherId,
} from '../src/content/weather';

/** Daten-Invarianten für Wetter und Nachtarten (DESIGN_V2.md 21). Logik: weather-core.test.ts. */
describe('Wetter (Daten)', () => {
  it('IDs eindeutig, Texte deutsch und vorhanden', () => {
    expect(new Set(WEATHERS.map((w) => w.id)).size).toBe(WEATHERS.length);
    for (const w of WEATHERS) {
      expect(w.name.length, w.id).toBeGreaterThan(0);
      expect(w.text.length, w.id).toBeGreaterThan(0);
      expect(w.summary.length, w.id).toBeGreaterThan(0);
    }
  });

  it('Wirkungen klein: je Wert −15 … +30 %, Gesamtwachstum nie unter −15 %', () => {
    for (const w of WEATHERS) {
      for (const e of w.effects) {
        expect(e.pct, w.id).toBeGreaterThanOrEqual(-15);
        expect(e.pct, w.id).toBeLessThanOrEqual(30);
      }
      const growth = w.effects.filter((e) => e.kind === 'growth').reduce((s, e) => s + e.pct, 0);
      expect(growth, w.id).toBeGreaterThanOrEqual(-15);
    }
  });

  it('nur raue Lagen haben Abzüge – und jede bringt dafür Samen; Schutz ist ein echter Forschungsknoten', () => {
    const careIds = new Set(RESEARCH.map((c) => c.id));
    for (const w of WEATHERS) {
      const negative = w.effects.some((e) => e.pct < 0);
      expect(negative, w.id).toBe(!!w.rough);
      if (!w.rough) continue;
      expect(w.effects.some((e) => e.kind === 'seeds' && e.pct > 0), w.id).toBe(true);
      expect(w.protection && careIds.has(w.protection), w.id).toBe(true);
      expect(w.protectionText, w.id).toBeTruthy();
      for (const t of w.immuneTrees ?? []) expect(MAIN_TREES_BY_ID.has(t), `${w.id} ${t}`).toBe(true);
    }
  });

  it('Gewichte: je Jahreszeit Summe 100, „Wechselhaft“ mindestens 35 %, raue Lagen höchstens 25 %', () => {
    for (const s of SEASON_IDS) {
      const entries = Object.entries(WEATHER_WEIGHTS[s]) as [WeatherId, number][];
      expect(entries.reduce((a, [, v]) => a + v, 0), s).toBe(100);
      for (const [id, v] of entries) {
        expect(WEATHERS_BY_ID.has(id), `${s} ${id}`).toBe(true);
        expect(v, `${s} ${id}`).toBeGreaterThan(0);
      }
      expect(WEATHER_WEIGHTS[s].mild ?? 0, s).toBeGreaterThanOrEqual(35);
      const rough = entries.filter(([id]) => WEATHERS_BY_ID.get(id)!.rough).reduce((a, [, v]) => a + v, 0);
      expect(rough, s).toBeLessThanOrEqual(25);
    }
    // Jedes Wetter kommt in mindestens einer Jahreszeit vor.
    for (const w of WEATHERS) expect(SEASON_IDS.some((s) => (WEATHER_WEIGHTS[s][w.id] ?? 0) > 0), w.id).toBe(true);
  });

  it('Ersatzwetter sind ruhig, Dämpfung im Rahmen', () => {
    for (const id of [FIRST_DAY_WEATHER, AFTER_ROUGH_WEATHER]) {
      expect(WEATHERS_BY_ID.get(id)!.rough, id).toBeFalsy();
    }
    expect(DIVERSITY_DAMPING_PER_GENUS).toBeGreaterThan(0);
    expect(DIVERSITY_DAMPING_MAX).toBeLessThanOrEqual(0.5);
    expect(PROTECTION_FACTOR).toBeGreaterThan(0);
    expect(PROTECTION_FACTOR).toBeLessThan(1);
  });
});

describe('Nachtarten (Daten)', () => {
  it('Nacht = halbe Spielzeit, Sekunde 81 bis 171 des Tages', () => {
    expect(NIGHT_SHARE).toBeCloseTo(1 - (NIGHT_START_PHASE - NIGHT_END_PHASE), 10);
    expect((NIGHT_START_PHASE - DAY_START_PHASE) * DAY_SECONDS).toBeCloseTo(81, 10);
    expect((1 + NIGHT_END_PHASE - DAY_START_PHASE) * DAY_SECONDS).toBeCloseTo(171, 10);
  });

  it('nur echte Arten, je einmal; nur kleine positive 🌿/🌰-Wirkungen', () => {
    expect(new Set(NOCTURNAL.map((n) => n.species)).size).toBe(NOCTURNAL.length);
    for (const n of NOCTURNAL) {
      expect(SPECIES_BY_ID.has(n.species), n.species).toBe(true);
      expect(n.effects.length, n.species).toBeGreaterThan(0);
      for (const e of n.effects) {
        expect(['growth', 'seeds'], n.species).toContain(e.kind);
        expect(e.pct, n.species).toBeGreaterThan(0);
        expect(e.pct, n.species).toBeLessThanOrEqual(15);
      }
      for (const s of n.seasons ?? []) expect(SEASON_IDS, n.species).toContain(s);
    }
  });
});
