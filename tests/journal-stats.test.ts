import { afterEach, describe, expect, it } from 'vitest';
import { MEMORY_PER_REGULAR_SLOT, NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { PLANTS } from '../src/content/plants';
import { SEASON_SECONDS, YEAR_SECONDS } from '../src/content/seasons';
import { STAGES } from '../src/content/stages';
import { evaluate } from '../src/core/formulas';
import { cycleAgeText, toJournalStats, toJournalTrees, toJournalView } from '../src/ui/adapters';
import { formatNumber, setNumberStyle } from '../src/ui/format';
import { stateAt } from './helpers';

const statOf = (stats: ReturnType<typeof toJournalStats>, key: string) => stats.find((s) => s.key === key)!;

afterEach(() => setNumberStyle('short'));

describe('cycleAgeText (Alter des Zyklus in Jahren und Jahreszeiten)', () => {
  it('zählt volle Jahre und Jahreszeiten, Einzahl nur bei 1', () => {
    expect(cycleAgeText(0)).toBe('weniger als eine Jahreszeit');
    expect(cycleAgeText(SEASON_SECONDS - 1)).toBe('weniger als eine Jahreszeit');
    expect(cycleAgeText(SEASON_SECONDS)).toBe('1 Jahreszeit');
    expect(cycleAgeText(3 * SEASON_SECONDS + 5)).toBe('3 Jahreszeiten');
    expect(cycleAgeText(YEAR_SECONDS)).toBe('1 Jahr');
    expect(cycleAgeText(2 * YEAR_SECONDS + 2 * SEASON_SECONDS)).toBe('2 Jahre, 2 Jahreszeiten');
  });

  it('kaputte Werte zählen als 0', () => {
    expect(cycleAgeText(Number.NaN)).toBe('weniger als eine Jahreszeit');
    expect(cycleAgeText(-50)).toBe('weniger als eine Jahreszeit');
  });
});

describe('toJournalStats (Reiter „Statistik“)', () => {
  it('Start: erster Zyklus, Samen-Stufe, alles bei 0, feste Reihenfolge', () => {
    const state = stateAt(0);
    const stats = toJournalStats(state, evaluate(state));
    expect(stats.map((s) => s.key)).toEqual([
      'cycle', 'time', 'tree', 'stage', 'growth', 'seeds', 'harmony', 'species', 'plants', 'communities', 'memory', 'regulars',
    ]);
    expect(statOf(stats, 'cycle')).toEqual({ key: 'cycle', label: 'Zyklus', value: '1', detail: 'dein erster Zyklus' });
    expect(statOf(stats, 'time').value).toBe('weniger als eine Jahreszeit');
    expect(statOf(stats, 'time').detail).toBe('0 Sek. Spielzeit · jetzt 🌱 Frühling');
    expect(statOf(stats, 'tree').value).toBe('🌳 Stieleiche');
    expect(statOf(stats, 'stage').value).toBe('Samen');
    expect(statOf(stats, 'species').value).toBe('0/32');
    expect(statOf(stats, 'plants').value).toBe(`0/${PLANTS.length}`);
    expect(statOf(stats, 'communities').value).toBe('0/9');
    expect(statOf(stats, 'memory').detail).toBe('wächst mit jedem Neuen Zyklus');
    expect(statOf(stats, 'regulars')).toMatchObject({
      value: '–',
      detail: `erster Platz ab ${MEMORY_PER_REGULAR_SLOT} Waldgedächtnis`,
    });
    // Kein „undefined“ in optionalen Feldern.
    expect(stats.every((s) => !('detail' in s) || typeof s.detail === 'string')).toBe(true);
  });

  it('laufendes Spiel: Zyklus 3, Zeit, Zahlen, Harmonie, Stammgäste mit Namen', () => {
    const state = stateAt(3, ['bluetit', 'robin']);
    state.cycle.number = 3;
    state.cycle.elapsed = YEAR_SECONDS + 2 * SEASON_SECONDS + 30; // Herbst des 2. Jahres
    state.cycle.newSpecies = ['robin'];
    state.cycle.maxHarmony = 42.7;
    state.seeds = 1234.9;
    state.totalGrowth = 98765.4;
    state.meta.forestMemory = MEMORY_PER_REGULAR_SLOT;
    state.meta.regulars = ['bluetit'];
    state.meta.journal.species.push('not-a-species'); // zählt nicht
    const ev = evaluate(state);
    const stats = toJournalStats(state, ev);
    expect(statOf(stats, 'cycle').detail).toBe('2 Zyklen abgeschlossen');
    expect(statOf(stats, 'time').value).toBe('1 Jahr, 2 Jahreszeiten');
    expect(statOf(stats, 'time').detail).toBe('18 Min. Spielzeit · jetzt 🍂 Herbst');
    expect(statOf(stats, 'stage')).toMatchObject({
      value: 'Junger Baum',
      detail: `4/${STAGES.length} · Wegpunkt ${state.waypoint}`,
    });
    expect(statOf(stats, 'growth').value).toBe('98.765 🌿');
    expect(statOf(stats, 'seeds').value).toBe('1.234 🌰');
    expect(statOf(stats, 'harmony').value).toBe(`${Math.floor(ev.harmony)} ⚖️`);
    expect(statOf(stats, 'harmony').detail).toMatch(/ · Höchstwert 42$/);
    expect(statOf(stats, 'species')).toMatchObject({ value: '2/32', detail: '1 neu in diesem Zyklus' });
    expect(statOf(stats, 'memory')).toMatchObject({ value: '25', detail: '+25 % Wachstum und Samen' });
    expect(statOf(stats, 'regulars')).toMatchObject({ value: '1/1', detail: 'Blaumeise' });
  });

  it('folgt dem Zahlenformat (kurz/ausgeschrieben)', () => {
    const state = stateAt(0);
    state.seeds = 3_450_000;
    expect(statOf(toJournalStats(state, evaluate(state)), 'seeds').value).toBe(`${formatNumber(3_450_000)} 🌰`);
    setNumberStyle('long');
    expect(statOf(toJournalStats(state, evaluate(state)), 'seeds').value).toBe('3.450.000 🌰');
  });

  it('steckt auch im JournalView', () => {
    const state = stateAt(0);
    expect(toJournalView(state, evaluate(state)).stats).toEqual(toJournalStats(state, evaluate(state)));
  });
});

describe('toJournalTrees (Reiter „Andenken“: Hauptbaum-Arten)', () => {
  it('erster Zyklus vor „Hain“: Eiche aktuell, gesperrte Arten ohne Namen und ID', () => {
    const state = stateAt(0);
    const trees = toJournalTrees(state);
    expect(trees).toHaveLength(3);
    expect(trees[0]).toMatchObject({ key: 'oak', name: 'Stieleiche', unlocked: true, current: true });
    expect(trees[0]!.text).toBeTruthy();
    const text = JSON.stringify(trees.slice(1));
    expect(text).not.toContain('Rotbuche');
    expect(text).not.toContain('Waldkiefer');
    expect(text).not.toContain('"beech"');
    expect(text).not.toContain('"pine"');
    expect(trees.slice(1).every((t) => t.name === '???' && !t.unlocked && !t.current && !!t.hint && !t.summary)).toBe(true);
    expect(trees[1]!.key).not.toBe(trees[2]!.key);
  });

  it('ab „Hain“ gesperrte Arten mit Namen und Hinweis wie bei „Neuer Zyklus“', () => {
    const state = stateAt(NEW_CYCLE_MIN_STAGE);
    const beech = toJournalTrees(state).find((t) => t.key === 'beech')!;
    expect(beech).toMatchObject({
      name: 'Rotbuche',
      unlocked: false,
      current: false,
      hint: 'Lass einmal eine Rotbuche im Pflanzring wachsen.',
    });
    expect(beech.text).toBeUndefined();
  });

  it('späterer Zyklus: freigeschaltet über das Tagebuch, aktuelle Art markiert', () => {
    const state = stateAt(1);
    state.cycle.number = 2;
    state.cycle.mainTree = 'pine';
    state.meta.journal.plants = ['pine'];
    const trees = toJournalTrees(state);
    expect(trees.map((t) => [t.key, t.unlocked, t.current])).toEqual([
      ['oak', true, false],
      ['beech', false, false],
      ['pine', true, true],
    ]);
    expect(trees[2]!.hint).toBeUndefined();
    expect(trees[1]!.hint).toContain('Rotbuche');
    expect(toJournalView(state, evaluate(state)).tabCounts.keepsakes).toBe('2');
  });
});
