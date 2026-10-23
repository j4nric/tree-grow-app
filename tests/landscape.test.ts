import { describe, expect, it } from 'vitest';
import {
  CORRIDORS,
  CORRIDORS_BY_ID,
  CORRIDOR_INFLOW,
  CORRIDOR_INFLOW_CAP,
  FEATURED_GENUS_WEIGHT,
  FOUNDING_COSTS,
  HOME_SITE,
  JAY_SEEDS_FIRST_ANCIENT,
  JAY_SEEDS_MEMORY_STEP,
  LANDSCAPE_SITES,
  LANDSCAPE_SITES_BY_ID,
  LANDSCAPE_UNLOCK_ACHIEVEMENT,
  LANDSCAPE_UNLOCK_MEMORY,
  MAX_JAY_SEEDS,
  MAX_SITE_FAUNA,
  SITE_IDS,
  WILDWECHSEL_CHANCE,
  WILDWECHSEL_MAX_CHANCE,
} from '../src/content/landscape';
import { ACHIEVEMENTS } from '../src/content/achievements';
import { EVENTS_BY_ID } from '../src/content/events';
import { GENUS_INFO, TAG_NAMES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { MAIN_TREES_BY_ID, type TreeEffect } from '../src/content/trees';
import { GENERA, NICHE_IDS, PLANT_GROUPS } from '../src/content/types';
import { MAX_FOREST_MEMORY } from '../src/core/state';
import { corridorBetween } from '../src/core/landscape';
import { nicheSlots, slotBonuses } from '../src/core/formulas';
import { createInitialState, createSite } from '../src/core/state';
import { SEASON_IDS } from '../src/content/seasons';
import { WEATHERS_BY_ID, WEATHER_WEIGHTS, type WeatherId } from '../src/content/weather';

/**
 * Inhalte der Waldlandschaft (DESIGN_V2.md 24). Die Rechenregeln (wirksames Gedächtnis,
 * Hähersaat, Gründen, Laden) prüft tests/landscape-core.test.ts mit der Logik aus core/.
 */

/** Zahl einer Wirkung mit Vorzeichen (Gewinn > 0, Verzicht < 0). */
function signOf(e: TreeEffect): number {
  switch (e.kind) {
    case 'slot':
    case 'light':
    case 'water':
      return Math.sign(e.amount);
    case 'groupGrowth':
    case 'groupSeeds':
      return Math.sign(e.pct);
    case 'happiness':
      return Math.sign(e.points);
  }
}

describe('Waldlandschaft: Standorte', () => {
  it('IDs eindeutig, Heimatwald zuerst und ohne Eigenheit', () => {
    expect(LANDSCAPE_SITES.map((s) => s.id)).toEqual([...SITE_IDS]);
    expect(new Set(SITE_IDS).size).toBe(SITE_IDS.length);
    expect(SITE_IDS[0]).toBe(HOME_SITE);
    const home = LANDSCAPE_SITES_BY_ID.get(HOME_SITE)!;
    expect(home.traits).toEqual([]);
    expect(home.habitats).toEqual([]);
    expect(home.gift).toBeNull();
  });

  it('Texte vorhanden, Lagen auf der Karte verschieden und in [0, 1]', () => {
    const seen = new Set<string>();
    for (const s of LANDSCAPE_SITES) {
      for (const text of [s.name, s.forestType, s.icon, s.text, s.summary, s.giftSummary]) expect(text.trim().length, s.id).toBeGreaterThan(0);
      expect(s.position.x).toBeGreaterThanOrEqual(0);
      expect(s.position.x).toBeLessThanOrEqual(1);
      expect(s.position.y).toBeGreaterThanOrEqual(0);
      expect(s.position.y).toBeLessThanOrEqual(1);
      const key = `${s.position.x}|${s.position.y}`;
      expect(seen.has(key), s.id).toBe(false);
      seen.add(key);
    }
  });

  it('Eigenheiten: gültige Wirkungen, jeder neue Wald mit Gewinn und Verzicht', () => {
    for (const s of LANDSCAPE_SITES) {
      if (s.leadTree !== null) expect(MAIN_TREES_BY_ID.has(s.leadTree), s.id).toBe(true);
      for (const tag of s.habitats) expect(TAG_NAMES[tag], s.id).toBeDefined();
      for (const g of s.featured) expect(GENERA).toContain(g);
      for (const t of s.traits) {
        expect(t.minStage).toBeGreaterThanOrEqual(0);
        expect(t.minStage).toBeLessThan(STAGES.length);
        const e = t.effect;
        if (e.kind === 'slot') expect(NICHE_IDS).toContain(e.niche);
        if (e.kind === 'groupGrowth' || e.kind === 'groupSeeds') expect(PLANT_GROUPS).toContain(e.group);
        if (e.kind === 'happiness') expect(GENUS_INFO[e.genus]).toBeDefined();
        // Plätze nur dazu, nie weg (ein Tier soll nie wegen des Standorts ausziehen).
        if (e.kind === 'slot') expect(e.amount).toBeGreaterThan(0);
        expect(signOf(e), `${s.id}: Wirkung 0`).not.toBe(0);
      }
      if (s.id === HOME_SITE) continue;
      const signs = s.traits.map((t) => signOf(t.effect));
      expect(signs.some((x) => x > 0) || s.habitats.length > 0, `${s.id}: Gewinn`).toBe(true);
      expect(signs.some((x) => x < 0), `${s.id}: Verzicht`).toBe(true);
    }
  });

  it('Gaben sind klein und ohne Multiplikator: nur Plätze, Licht, Wasser, Zufriedenheit, alle positiv', () => {
    for (const s of LANDSCAPE_SITES) {
      if (s.id === HOME_SITE) continue;
      expect(s.gift, s.id).not.toBeNull();
      const e = s.gift!.effect;
      expect(['slot', 'light', 'water', 'happiness']).toContain(e.kind);
      expect(signOf(e)).toBe(1);
      if (e.kind === 'slot') expect(e.amount).toBe(1);
      if (e.kind === 'light' || e.kind === 'water') expect(e.amount).toBe(1);
      if (e.kind === 'happiness') expect(e.points).toBeLessThanOrEqual(5);
    }
  });
});

describe('Waldlandschaft: Wetter je Waldtyp (24.14, Daten für Phase 7, 3c)', () => {
  /** Anteile einer Jahreszeit an einem Standort nach der Formel aus 24.14 (vor „nie zwei rau“). */
  const shares = (site: (typeof LANDSCAPE_SITES)[number], season: (typeof SEASON_IDS)[number]) => {
    const entries = (Object.entries(WEATHER_WEIGHTS[season]) as [WeatherId, number][]).map(([id, w]) => [id, w * (site.weather[id] ?? 1)] as const);
    const total = entries.reduce((a, [, w]) => a + w, 0);
    return new Map(entries.map(([id, w]) => [id, w / total]));
  };

  it('Heimatwald ohne Faktoren, jeder andere Wald mit eigenem Wetter und Kurztext', () => {
    const home = LANDSCAPE_SITES_BY_ID.get(HOME_SITE)!;
    expect(home.weather).toEqual({});
    expect(home.weatherSummary).toBe('');
    for (const site of LANDSCAPE_SITES.filter((s) => s.id !== HOME_SITE)) {
      expect(Object.values(site.weather).some((f) => f! > 1), site.id).toBe(true);
      expect(site.weatherSummary.length, site.id).toBeGreaterThan(10);
    }
    // Jeder Wald hat ein anderes Wetter.
    const keys = LANDSCAPE_SITES.map((s) => JSON.stringify(Object.entries(s.weather).sort()));
    expect(new Set(keys).size).toBe(LANDSCAPE_SITES.length);
  });

  it('Faktoren nur für bekannte Lagen, nie für „Wechselhaft“, zwischen 0,5 und 2,5', () => {
    for (const site of LANDSCAPE_SITES) {
      for (const [id, f] of Object.entries(site.weather) as [WeatherId, number][]) {
        expect(WEATHERS_BY_ID.has(id), `${site.id} ${id}`).toBe(true);
        expect(id, site.id).not.toBe('mild');
        expect(f, `${site.id} ${id}`).toBeGreaterThanOrEqual(0.5);
        expect(f, `${site.id} ${id}`).toBeLessThanOrEqual(2.5);
        expect(f, `${site.id} ${id}`).not.toBe(1);
        // Ein Faktor wirkt nur, wenn die Lage in mindestens einer Jahreszeit vorkommt.
        expect(SEASON_IDS.some((s) => (WEATHER_WEIGHTS[s][id] ?? 0) > 0), `${site.id} ${id}`).toBe(true);
      }
    }
  });

  it('jede Jahreszeit bleibt ruhig genug: „Wechselhaft“ ≥ 25 %, raue Lagen ≤ 30 %', () => {
    for (const site of LANDSCAPE_SITES) {
      for (const season of SEASON_IDS) {
        const m = shares(site, season);
        const rough = [...m].filter(([id]) => WEATHERS_BY_ID.get(id)!.rough).reduce((a, [, p]) => a + p, 0);
        expect(m.get('mild')!, `${site.id} ${season}`).toBeGreaterThanOrEqual(0.25);
        expect(rough, `${site.id} ${season}`).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it('Charakter: Bergmischwald mehr Neuschnee, Auwald mehr Landregen, Kiefernheide mehr Dürre, Erlenbruch mehr Nebel', () => {
    const home = LANDSCAPE_SITES_BY_ID.get(HOME_SITE)!;
    const more = (site: (typeof SITE_IDS)[number], id: WeatherId, season: (typeof SEASON_IDS)[number]) =>
      shares(LANDSCAPE_SITES_BY_ID.get(site)!, season).get(id)! > shares(home, season).get(id)!;
    expect(more('mountain', 'snow', 'winter')).toBe(true);
    expect(more('floodplain', 'rain', 'spring')).toBe(true);
    expect(more('heath', 'drought', 'summer')).toBe(true);
    expect(more('carr', 'fog', 'autumn')).toBe(true);
  });
});

describe('Waldlandschaft: Ereignisse je Waldtyp (24.13, Phase 7, 3e)', () => {
  it('Heimatwald ohne Faktoren, Kiefernheide Käferjahr × 3', () => {
    expect(LANDSCAPE_SITES_BY_ID.get(HOME_SITE)!.eventFactors).toEqual({});
    expect(LANDSCAPE_SITES_BY_ID.get('heath')!.eventFactors).toEqual({ 'beetle-year': 3 });
  });

  it('Jeder Waldtyp hat sein Ereignis (26.2, Phase 9, 1a); Heimatwald und Bergmischwald ohne', () => {
    const factors = Object.fromEntries(LANDSCAPE_SITES.map((s) => [s.id, s.eventFactors]));
    expect(factors).toEqual({
      home: {},
      floodplain: { rain: 2, 'slug-year': 3 },
      carr: { 'toad-migration': 3 },
      beechwood: { 'mast-year': 2, 'vole-year': 3 },
      mountain: {},
      heath: { 'beetle-year': 3 },
    });
    // Der Kurztext nennt das Ereignis (die Oberfläche zeigt die Faktoren in Aufgabe 1c).
    expect(LANDSCAPE_SITES_BY_ID.get('floodplain')!.weatherSummary).toContain('Regenreicher Frühling öfter');
    expect(LANDSCAPE_SITES_BY_ID.get('carr')!.weatherSummary).toContain('Krötennächte öfter');
    expect(LANDSCAPE_SITES_BY_ID.get('beechwood')!.weatherSummary).toContain('Buchenmast öfter');
  });

  it('Kiefernheide: ab Hain +1 Platz Trockenmauer – öffnet die Mauer ohne Pflege (26.2)', () => {
    const heath = LANDSCAPE_SITES_BY_ID.get('heath')!;
    expect(heath.traits).toContainEqual({ minStage: 5, effect: { kind: 'slot', niche: 'wall', amount: 1 } });
    expect(heath.summary).toContain('ab Hain +1 Platz Trockenmauer');
    const wallAt = (site: (typeof SITE_IDS)[number], stage: number) => {
      const state = createInitialState(0, 1);
      for (const s of LANDSCAPE_SITES) if (s.id !== HOME_SITE) state.meta.landscape.sites.push(createSite(s.id));
      state.meta.landscape.active = site;
      state.stage = stage;
      expect(state.cycle.care ?? {}).toEqual({});
      return nicheSlots(stage, state.niches, slotBonuses(state)).wall;
    };
    expect(wallAt('heath', 4)).toBe(0);
    expect(wallAt('heath', 5)).toBe(1);
    expect(wallAt('heath', 7)).toBe(1);
    // Nur in der Heide (Eigenheit, keine Gabe).
    for (const site of SITE_IDS.filter((s) => s !== 'heath')) expect(wallAt(site, 7), site).toBe(0);
  });

  it('Schlüssel nur bekannte Ereignis-IDs, Faktoren endlich, > 1 und ≤ 3', () => {
    for (const site of LANDSCAPE_SITES) {
      for (const [id, f] of Object.entries(site.eventFactors)) {
        expect(EVENTS_BY_ID.has(id), `${site.id} ${id}`).toBe(true);
        expect(Number.isFinite(f), `${site.id} ${id}`).toBe(true);
        expect(f, `${site.id} ${id}`).toBeGreaterThan(1);
        expect(f, `${site.id} ${id}`).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('Waldlandschaft: Korridore und Hähersaat', () => {
  it('Korridore verbinden zwei verschiedene Standorte, je Paar höchstens einer', () => {
    const pairs = new Set<string>();
    for (const c of CORRIDORS) {
      expect(CORRIDORS_BY_ID.get(c.id)).toBe(c);
      const [a, b] = c.sites;
      expect(SITE_IDS).toContain(a);
      expect(SITE_IDS).toContain(b);
      expect(a).not.toBe(b);
      const key = [a, b].sort().join('|');
      expect(pairs.has(key), c.id).toBe(false);
      pairs.add(key);
      expect(Number.isInteger(c.cost) && c.cost > 0, c.id).toBe(true);
      expect(c.name.trim().length).toBeGreaterThan(0);
      expect(c.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('jeder neue Standort liegt am Heimatwald (freie Reihenfolge der Gründung)', () => {
    for (const id of SITE_IDS) if (id !== HOME_SITE) expect(corridorBetween(HOME_SITE, id), id).toBeDefined();
  });

  it('Gründungskosten steigen, alles zusammen ist mit der Hähersaat bezahlbar – mit etwas Luft', () => {
    expect(FOUNDING_COSTS).toHaveLength(SITE_IDS.length - 1);
    for (let i = 1; i < FOUNDING_COSTS.length; i++) expect(FOUNDING_COSTS[i]!).toBeGreaterThan(FOUNDING_COSTS[i - 1]!);
    expect(MAX_JAY_SEEDS).toBe(SITE_IDS.length * (MAX_FOREST_MEMORY / JAY_SEEDS_MEMORY_STEP + JAY_SEEDS_FIRST_ANCIENT));
    // Der Korridor zum Wald, aus dem gegründet wird, ist in der Gründung enthalten: ein Korridor
    // je neuem Wald entfällt höchstens. Gerechnet wird mit allen Korridoren (obere Grenze).
    const all = FOUNDING_COSTS.reduce((s, x) => s + x, 0) + CORRIDORS.reduce((s, c) => s + c.cost, 0);
    expect(all).toBeLessThanOrEqual(MAX_JAY_SEEDS - 5);
  });

  it('Freischaltung über einen vorhandenen Erfolg, Zahlen im Rahmen', () => {
    expect(ACHIEVEMENTS.some((a) => a.id === LANDSCAPE_UNLOCK_ACHIEVEMENT)).toBe(true);
    expect(LANDSCAPE_UNLOCK_MEMORY).toBeGreaterThan(0);
    expect(LANDSCAPE_UNLOCK_MEMORY).toBeLessThan(MAX_FOREST_MEMORY);
    expect(CORRIDOR_INFLOW).toBeGreaterThan(0);
    expect(CORRIDOR_INFLOW).toBeLessThanOrEqual(1);
    expect(CORRIDOR_INFLOW_CAP).toBeLessThanOrEqual(MAX_FOREST_MEMORY);
    expect(WILDWECHSEL_CHANCE).toBeGreaterThan(0);
    expect(WILDWECHSEL_MAX_CHANCE).toBeLessThan(1 / 3 + 1e-9); // höchstens jede dritte Begegnung
    expect(MAX_SITE_FAUNA).toBeGreaterThan(0);
    expect(FEATURED_GENUS_WEIGHT).toBeGreaterThan(1);
    expect(FEATURED_GENUS_WEIGHT).toBeLessThanOrEqual(2);
  });
});
