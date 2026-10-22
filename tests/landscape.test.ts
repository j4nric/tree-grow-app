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
  type SiteId,
} from '../src/content/landscape';
import { ACHIEVEMENTS } from '../src/content/achievements';
import { GENUS_INFO, TAG_NAMES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { MAIN_TREES_BY_ID, type TreeEffect } from '../src/content/trees';
import { GENERA, NICHE_IDS, PLANT_GROUPS } from '../src/content/types';
import { MAX_FOREST_MEMORY } from '../src/core/state';
import { corridorBetween, effectiveMemory, jaySeedsEarned } from '../scripts/landscape';

/**
 * Inhalte der Waldlandschaft (DESIGN_V2.md 24) – noch nicht verdrahtet, darum prüft dieser
 * Test die Daten für sich und die Rechenregeln des Modells (scripts/landscape.ts), die der
 * core-engineer übernimmt (24.11).
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

describe('Waldlandschaft: Rechenregeln (Vorlage für core/)', () => {
  const sites = (entries: [SiteId, number, boolean?][]) =>
    new Map(entries.map(([id, own, ancient]) => [id, { own, ancient: ancient ?? false }] as const));

  it('wirksames Gedächtnis: eigenes + Zufluss (höchstens 500), höchstens 1000', () => {
    const s = sites([['home', 600], ['floodplain', 0], ['carr', 300]]);
    expect(effectiveMemory('floodplain', s, new Set(), 0.5, 500)).toBe(0);
    expect(effectiveMemory('floodplain', s, new Set(['home-floodplain']), 0.5, 500)).toBe(300);
    expect(effectiveMemory('floodplain', s, new Set(['home-floodplain', 'floodplain-carr']), 0.5, 500)).toBe(450);
    // Deckel des Zuflusses: 0,5 · (1000 + 1000) = 1000 → 500.
    const full = sites([['home', 1000], ['floodplain', 100], ['carr', 1000]]);
    expect(effectiveMemory('floodplain', full, new Set(['home-floodplain', 'floodplain-carr']), 0.5, 500)).toBe(600);
    // Obergrenze MAX_FOREST_MEMORY.
    const late = sites([['home', 1000], ['floodplain', 900]]);
    expect(effectiveMemory('floodplain', late, new Set(['home-floodplain']), 0.5, 500)).toBe(MAX_FOREST_MEMORY);
    // Korridore zu anderen Wäldern zählen nicht.
    expect(effectiveMemory('floodplain', s, new Set(['home-carr']), 0.5, 500)).toBe(0);
  });

  it('Hähersaat: 1 je volle 100 eigenes Gedächtnis, +2 für den ersten Urwald je Wald', () => {
    expect(jaySeedsEarned(sites([['home', 266, true]]))).toBe(4);
    expect(jaySeedsEarned(sites([['home', 1000, true], ['floodplain', 99, false]]))).toBe(12);
    const max = sites(SITE_IDS.map((id) => [id, MAX_FOREST_MEMORY, true] as [SiteId, number, boolean]));
    expect(jaySeedsEarned(max)).toBe(MAX_JAY_SEEDS);
  });
});
