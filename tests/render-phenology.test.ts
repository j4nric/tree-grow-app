import { describe, expect, it } from 'vitest';
import {
  bloomParticles,
  elderBerries,
  elderFlowers,
  fireflySeason,
  hazelCatkinBloom,
  hazelNuts,
  insectActivity,
  isEvergreen,
  plantLeafAmount,
  rowanBerries,
} from '../src/render/phenology';
import { leafShrink } from '../src/render/plant';
import { seasonLeaves, seasonLook } from '../src/render/season';
import { seedGlowAlpha, seedGlowPulse, seedGlowStrength } from '../src/render/seed-glow';

const SPRING = seasonLook(0);
const SUMMER = seasonLook(1);
const AUTUMN = seasonLook(2);
/** Beginn des Winters im Spiel (core/season.ts sceneSeason: Winter ab 2,5). */
const WINTER_START = seasonLook(2.55);
const WINTER = seasonLook(3);
const LATE_WINTER = seasonLook(3.3);

describe('Jahreszeiten je Pflanze (phenology.ts)', () => {
  it('nur die Kiefer bleibt immergrün – die Eberesche ist im Winter kahl', () => {
    expect(isEvergreen('pine')).toBe(true);
    for (const kind of ['rowan', 'birch', 'beech', 'hazel', 'elder', 'tree']) {
      expect(isEvergreen(kind), kind).toBe(false);
      expect(plantLeafAmount(kind, WINTER), kind).toBe(0);
      expect(plantLeafAmount(kind, WINTER_START), kind).toBe(0);
      expect(plantLeafAmount(kind, SUMMER), kind).toBe(1);
    }
    expect(plantLeafAmount('pine', WINTER)).toBe(1);
    expect(plantLeafAmount('rowan', null)).toBe(1);
  });

  it('Vogelbeeren nur im Spätsommer und Herbst', () => {
    expect(rowanBerries(null)).toBe(1);
    expect(rowanBerries(SUMMER)).toBe(1);
    expect(rowanBerries(AUTUMN)).toBe(1);
    expect(rowanBerries(SPRING)).toBe(0);
    expect(rowanBerries(WINTER)).toBe(0);
    expect(rowanBerries(LATE_WINTER)).toBe(0);
  });

  it('Hasel: Nüsse im Sommer und Herbst, im Spätwinter blühende Kätzchen', () => {
    expect(hazelNuts(SUMMER)).toBe(1);
    expect(hazelNuts(AUTUMN)).toBe(1);
    expect(hazelNuts(WINTER)).toBe(0);
    expect(hazelNuts(SPRING)).toBe(0);
    expect(hazelCatkinBloom(null)).toBe(0);
    expect(hazelCatkinBloom(SUMMER)).toBe(0);
    expect(hazelCatkinBloom(AUTUMN)).toBe(0);
    expect(hazelCatkinBloom(LATE_WINTER)).toBe(1);
  });

  it('Holunder: Blüten im Frühsommer, Beeren im Herbst, im Winter nichts', () => {
    expect(elderFlowers(SUMMER)).toBe(1);
    expect(elderBerries(SUMMER)).toBe(1);
    expect(elderFlowers(AUTUMN)).toBe(0);
    expect(elderBerries(AUTUMN)).toBe(1);
    expect(elderFlowers(WINTER)).toBe(0);
    expect(elderBerries(WINTER)).toBe(0);
  });

  it('im Winter ruhen Insekten, keine Blütenblätter und Glühwürmchen', () => {
    for (const look of [null, SPRING, SUMMER]) {
      expect(insectActivity(look)).toBe(1);
      expect(bloomParticles(look)).toBe(1);
    }
    expect(fireflySeason(SUMMER)).toBe(1);
    for (const look of [WINTER_START, WINTER, LATE_WINTER]) {
      expect(insectActivity(look)).toBe(0);
      expect(bloomParticles(look)).toBe(0);
      expect(fireflySeason(look)).toBe(0);
    }
    // Herbst: keine Blütenblätter mehr, Insekten noch unterwegs.
    expect(bloomParticles(AUTUMN)).toBe(0);
    expect(insectActivity(AUTUMN)).toBe(1);
  });

  it('alle Werte stufenlos über das Jahr (Schritt 0,05)', () => {
    const fns = [rowanBerries, hazelNuts, hazelCatkinBloom, elderFlowers, elderBerries, insectActivity, bloomParticles, fireflySeason];
    let prev = fns.map((f) => f(seasonLook(0)));
    for (let s = 0.05; s < 4.01; s += 0.05) {
      const cur = fns.map((f) => f(seasonLook(s)));
      cur.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(Math.abs(v - prev[k]!), `Funktion ${k} bei ${s.toFixed(2)}`).toBeLessThan(0.4);
      });
      prev = cur;
    }
  });
});

describe('letztes Laub vor dem Winter', () => {
  it('Laubbäume sind zu Winterbeginn kahl, Mitte Herbst noch voll', () => {
    expect(WINTER_START!.leaves).toBe(0);
    expect(AUTUMN!.leaves).toBeGreaterThan(0.85);
  });

  it('wenige Blätter sind kleiner und welk statt große orange Ballen', () => {
    expect(leafShrink(1)).toBe(1);
    expect(leafShrink(0.8)).toBe(1);
    expect(leafShrink(0.1)).toBeLessThan(0.7);
    const palette = { shadow: '#2c5230', tones: ['#3a6e39', '#4d8942', '#68a14e'] as [string, string, string], highlight: '#a7cf7c' };
    const late = seasonLeaves(palette, seasonLook(2.45));
    const mid = seasonLeaves(palette, AUTUMN);
    // Welk: weniger gesättigt als das kräftige Herbstlaub (Abstand Rot–Blau kleiner).
    const sat = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      return Math.max(...c) - Math.min(...c);
    };
    expect(sat(late.tones[1])).toBeLessThan(sat(mid.tones[1]));
  });
});

describe('Lichtschein am Samen', () => {
  it('voll zu Spielbeginn, weg ab dem ersten Wegpunkt (Wachstum 1)', () => {
    expect(seedGlowStrength(0)).toBe(1);
    expect(seedGlowStrength(0.5)).toBe(1);
    expect(seedGlowStrength(0.8)).toBeGreaterThan(0);
    expect(seedGlowStrength(0.8)).toBeLessThan(1);
    expect(seedGlowStrength(1)).toBe(0);
    expect(seedGlowStrength(5)).toBe(0);
    expect(seedGlowStrength(Number.NaN)).toBe(0);
    expect(seedGlowAlpha(2, 3, false)).toBe(0);
  });

  it('pulsiert sanft, bei reduzierter Bewegung steht er still', () => {
    const values = [0, 0.3, 0.6, 0.9, 1.2].map((t) => seedGlowPulse(t, false));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.2);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0.55);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(seedGlowPulse(0, true)).toBe(seedGlowPulse(7.7, true));
    expect(seedGlowAlpha(0, 0, true)).toBe(seedGlowAlpha(0, 3, true));
  });
});
