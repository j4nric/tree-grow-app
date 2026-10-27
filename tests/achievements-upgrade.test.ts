import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS_BY_ID } from '../src/content/achievements';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { NICHE_IDS } from '../src/content/types';
import { MAX_UPGRADE_LEVEL } from '../src/content/upgrades';
import { checkAchievements, isAchieved, targetOf, valueOf } from '../src/core/achievements';
import { loadGame, serialize } from '../src/core/save';
import type { GameState } from '../src/core/state';
import { startNewCycle, upgradeNiche } from '../src/core/tick';
import { stateAt } from './helpers';

/*
 * Erfolge des Ausbaus (DESIGN_V2.md 28.4, ROADMAP Phase 11, 2c): Bedingungsart `upgrade` über
 * die Bestmarke (bleibt über den Zyklus, Nachtrag beim Laden) bzw. die Stufen des Zyklus
 * („Rundum eingelebt“). Kein neues Feld, darum ohne SAVE_VERSION-Erhöhung.
 */

const UPGRADE_IDS = ['upgrade-25', 'upgrade-50', 'upgrades-all-10'];
const byId = (id: string) => ACHIEVEMENTS_BY_ID.get(id)!;
const unlockedUpgrades = (s: GameState) => s.meta.achievements.filter((id) => UPGRADE_IDS.includes(id));

/** Alle Nischen im laufenden Zyklus (und als Bestmarke) auf `level`. */
function allNiches(s: GameState, level: number): void {
  for (const id of NICHE_IDS) s.cycle.upgrades.niches[id] = s.meta.upgrades.best.niches[id] = level;
}

describe('Bedingungsart upgrade', () => {
  it('Inhalte: Titel und Ziele wie 28.4', () => {
    expect(byId('upgrade-25')).toMatchObject({ title: 'Gut bewohnt', condition: { kind: 'upgrade', level: 25, atLeast: 1 } });
    expect(byId('upgrade-50')).toMatchObject({ title: 'Prachtnische', condition: { kind: 'upgrade', level: 50, atLeast: 1 } });
    expect(byId('upgrades-all-10')).toMatchObject({ title: 'Rundum eingelebt', condition: { kind: 'upgrade', level: 10, inCycle: true } });
    expect(targetOf(byId('upgrades-all-10').condition)).toBe(NICHE_IDS.length);
    for (const id of UPGRADE_IDS) expect(byId(id).requires, id).toBeUndefined();
  });

  it('upgrade-25/50: zählt die Bestmarke, auch wenn der Zyklus wieder bei 0 steht', () => {
    const s = stateAt(1);
    expect(valueOf(s, byId('upgrade-25').condition)).toBe(0);
    s.meta.upgrades.best.niches.roots = 24;
    expect(isAchieved(s, byId('upgrade-25'))).toBe(false);
    s.meta.upgrades.best.niches.roots = 25;
    expect(isAchieved(s, byId('upgrade-25'))).toBe(true);
    expect(isAchieved(s, byId('upgrade-50'))).toBe(false);
    s.meta.upgrades.best.niches.pond = 50;
    expect(valueOf(s, byId('upgrade-25').condition)).toBe(2);
    expect(isAchieved(s, byId('upgrade-50'))).toBe(true);
    // Baumteile zählen nicht (es heißt „eine Nische“).
    const t = stateAt(1);
    t.meta.upgrades.best.tree.rings = 80;
    expect(isAchieved(t, byId('upgrade-25'))).toBe(false);
  });

  it('upgrades-all-10: alle zehn Nischen im laufenden Zyklus; Bestmarke allein reicht nicht', () => {
    const s = stateAt(5);
    for (const id of NICHE_IDS) s.meta.upgrades.best.niches[id] = 99;
    expect(valueOf(s, byId('upgrades-all-10').condition)).toBe(0);
    allNiches(s, 10);
    s.cycle.upgrades.niches.wall = 9;
    expect(valueOf(s, byId('upgrades-all-10').condition)).toBe(NICHE_IDS.length - 1);
    expect(isAchieved(s, byId('upgrades-all-10'))).toBe(false);
    s.cycle.upgrades.niches.wall = 10;
    expect(isAchieved(s, byId('upgrades-all-10'))).toBe(true);
  });

  it('kaputte Stufen (NaN, negativ, zu groß, Text, fehlendes Feld) zählen als 0', () => {
    const s = stateAt(1);
    const best = s.meta.upgrades.best.niches as Record<string, unknown>;
    best.roots = Number.NaN;
    best.litter = -30;
    best.edge = MAX_UPGRADE_LEVEL + 1;
    best.crown = '40';
    best.bark = 25.5;
    expect(valueOf(s, byId('upgrade-25').condition)).toBe(0);
    best.meadow = MAX_UPGRADE_LEVEL;
    expect(valueOf(s, byId('upgrade-25').condition)).toBe(1);
    (s.meta as { upgrades?: unknown }).upgrades = undefined;
    expect(valueOf(s, byId('upgrade-25').condition)).toBe(0);
  });
});

describe('Freischalten', () => {
  it('durch Kaufen: Wurzelraum 25 schaltet „Gut bewohnt“ frei', () => {
    const s = stateAt(1);
    s.seeds = 1e5;
    expect(upgradeNiche(s, 'roots', 24).ok).toBe(true);
    expect(checkAchievements(s)).not.toContain('upgrade-25');
    expect(upgradeNiche(s, 'roots').ok).toBe(true);
    expect(checkAchievements(s)).toContain('upgrade-25');
  });

  it('Neuer Zyklus prüft „Rundum eingelebt“ vor dem Zurücksetzen; die Bestmarke-Erfolge bleiben erreichbar', () => {
    const s = stateAt(NEW_CYCLE_MIN_STAGE, ['earthworm', 'robin']);
    allNiches(s, 10);
    const result = startNewCycle(s, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.achievements).toContain('upgrades-all-10');
    expect(s.cycle.upgrades.niches.roots ?? 0).toBe(0);
    expect(isAchieved(s, byId('upgrades-all-10'))).toBe(false);
    expect(s.meta.achievements).toContain('upgrades-all-10');
  });

  it('Nachtrag beim Laden: ein v18-Stand mit Bestmarke ohne die neuen Erfolge bekommt sie bei der ersten Prüfung', () => {
    const s = stateAt(3);
    s.meta.upgrades.best.niches.roots = 60;
    s.meta.upgrades.best.niches.litter = 30;
    s.meta.achievements = [];
    const loaded = loadGame(serialize(s), 0)!.state;
    expect(unlockedUpgrades(loaded)).toEqual([]);
    // main.ts prüft gleich nach dem Laden (wie bei jeder Erweiterung der Erfolge-Liste).
    expect(checkAchievements(loaded).filter((id) => UPGRADE_IDS.includes(id))).toEqual(['upgrade-25', 'upgrade-50']);
    // Neu gespeichert und geladen bleiben sie.
    expect(unlockedUpgrades(loadGame(serialize(loaded), 0)!.state)).toEqual(['upgrade-25', 'upgrade-50']);
  });

  it('ein v17-Stand (ohne Ausbau) lädt ohne Absturz und schaltet keinen Ausbau-Erfolg frei', () => {
    const s = stateAt(4);
    const raw = JSON.parse(serialize(s));
    raw.version = 17;
    delete raw.cycle.upgrades;
    delete raw.cycle.researchRanks;
    delete raw.meta.upgrades;
    const loaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(checkAchievements(loaded).filter((id) => UPGRADE_IDS.includes(id))).toEqual([]);
  });
});
