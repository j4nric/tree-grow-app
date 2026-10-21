import { describe, expect, it } from 'vitest';
import {
  bloomParticles,
  edgeBare,
  edgePetals,
  edgeSeedHeads,
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
import { seedGlowAlpha, seedGlowCycleFade, seedGlowPulse, seedGlowStrength } from '../src/render/seed-glow';

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
    for (const s of [null, 0, 1]) {
      expect(insectActivity(s)).toBe(1);
      expect(bloomParticles(s)).toBe(1);
    }
    expect(fireflySeason(1)).toBe(1);
    for (const s of [2.55, 3, 3.3]) {
      expect(insectActivity(s)).toBe(0);
      expect(bloomParticles(s)).toBe(0);
      expect(fireflySeason(s)).toBe(0);
    }
    // Herbst: keine Blütenblätter mehr, Insekten noch unterwegs.
    expect(bloomParticles(2)).toBe(0);
    expect(insectActivity(2)).toBe(1);
  });

  it('Waldsaum-Blumen: blühen im Sommer, verblüht im Herbst, im Winter nur Halme', () => {
    for (const s of [null, 0, 1]) {
      expect(edgePetals(s)).toBe(1);
      expect(edgeSeedHeads(s)).toBe(0);
      expect(edgeBare(s)).toBe(0);
    }
    expect(edgePetals(2)).toBe(0);
    expect(edgeSeedHeads(2)).toBe(1);
    expect(edgeBare(2)).toBe(0);
    for (const s of [2.55, 3, 3.3]) {
      expect(edgePetals(s)).toBe(0);
      expect(edgeSeedHeads(s)).toBe(0);
      expect(edgeBare(s)).toBe(1);
    }
  });

  it('gecachte Werte stufenlos über das Jahr (gerundete Jahreszeit, Schritt 0,05)', () => {
    const fns = [rowanBerries, hazelNuts, hazelCatkinBloom, elderFlowers, elderBerries];
    let prev = fns.map((f) => f(seasonLook(0)));
    for (let s = 0.05; s < 4.01; s += 0.05) {
      const cur = fns.map((f) => f(seasonLook(s)));
      cur.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        // Steilste Kurve: 0,25 Saison breit → höchstens 1,5 · 0,05 / 0,25 = 0,3 je Stufe.
        expect(Math.abs(v - prev[k]!), `Funktion ${k} bei ${s.toFixed(2)}`).toBeLessThanOrEqual(0.301);
      });
      prev = cur;
    }
  });

  it('Werte pro Frame ohne Sprünge (ungerundete Jahreszeit, Schritt 0,01)', () => {
    const fns = [insectActivity, bloomParticles, fireflySeason, edgePetals, edgeSeedHeads, edgeBare];
    let prev = fns.map((f) => f(0));
    for (let i = 1; i <= 400; i++) {
      const s = i / 100;
      const cur = fns.map((f) => f(s % 4));
      cur.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(Math.abs(v - prev[k]!), `Funktion ${k} bei ${s.toFixed(2)}`).toBeLessThan(0.05);
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

  it('pulsiert sanft (0,7–1, etwa alle 5 s), bei reduzierter Bewegung steht er still', () => {
    const values = Array.from({ length: 60 }, (_, i) => seedGlowPulse(i * 0.1, false));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.25);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0.7 - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Ruhig: zwischen zwei Frames (1/60 s) kaum Änderung.
    expect(Math.abs(seedGlowPulse(1, false) - seedGlowPulse(1 + 1 / 60, false))).toBeLessThan(0.01);
    expect(seedGlowPulse(0, true)).toBe(seedGlowPulse(7.7, true));
    expect(seedGlowAlpha(0, 0, true)).toBe(seedGlowAlpha(0, 3, true));
  });
});

describe('Lichtschein am Samen beim Neuen Zyklus', () => {
  it('aus, bis die Eichel gelandet ist (u < 3,6), danach weich bis zum Ende der Sequenz', () => {
    for (const u of [0, 0.5, 1.8, 2.9, 3.3, 3.59]) {
      expect(seedGlowCycleFade(u, false)).toBe(0);
      expect(seedGlowAlpha(0, 10, false, u)).toBe(0);
    }
    expect(seedGlowCycleFade(4.3, false)).toBeGreaterThan(0);
    expect(seedGlowCycleFade(4.3, false)).toBeLessThan(1);
    // Vor dem Ende der Sequenz (5,5 s) voll – kein Sprung, wenn cycleU zu NaN wird.
    expect(seedGlowCycleFade(5.1, false)).toBe(1);
    expect(seedGlowCycleFade(5.49, false)).toBe(1);
    expect(seedGlowCycleFade(Number.NaN, false)).toBe(1);
    expect(seedGlowAlpha(0, 10, false, Number.NaN)).toBe(seedGlowAlpha(0, 10, false));
    // Stufenlos (Schritt 1/60 s).
    for (let u = 0; u < 5.5; u += 1 / 60) {
      expect(Math.abs(seedGlowCycleFade(u + 1 / 60, false) - seedGlowCycleFade(u, false))).toBeLessThan(0.03);
    }
    // Weniger Bewegung: mit dem Überblenden (0,8 s), am Ende voll.
    expect(seedGlowCycleFade(0, true)).toBe(0);
    expect(seedGlowCycleFade(0.8, true)).toBe(1);
  });
});
