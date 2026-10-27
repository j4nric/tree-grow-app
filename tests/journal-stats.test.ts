import { afterEach, describe, expect, it } from 'vitest';
import { MEMORY_PER_REGULAR_SLOT, NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { COMMUNITIES } from '../src/content/communities';
import { PLANTS } from '../src/content/plants';
import { SEASON_SECONDS, YEAR_SECONDS } from '../src/content/seasons';
import { COMMON_SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { MAIN_TREES } from '../src/content/trees';
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
      'total-time', 'total-growth', 'total-harmony', 'total-cards', 'total-events', 'total-visitors', 'total-plants',
      'total-care', 'total-upgrades', 'total-upgrade-best', 'total-trees', 'total-daily-goals', 'total-daily-streak',
    ]);
    // Ausbau (28.9): noch nichts gekauft, keine Bestmarke.
    expect(statOf(stats, 'total-upgrades')).toEqual({ key: 'total-upgrades', label: 'Ausbaustufen gekauft', value: '0', section: 'total' });
    expect(statOf(stats, 'total-upgrade-best')).toMatchObject({ value: '–', detail: 'noch nichts ausgebaut' });
    // Tagesziele (seit v12): noch nichts erfüllt.
    expect(statOf(stats, 'total-daily-goals')).toMatchObject({ value: '0', detail: 'an 0 Tagen alle' });
    expect(statOf(stats, 'total-daily-streak').value).toBe('0 Tage');
    // Nur der Abschnitt „Über alle Zyklen“ ist markiert.
    expect(stats.filter((s) => s.section === 'total').every((s) => s.key.startsWith('total-'))).toBe(true);
    expect(stats.filter((s) => s.key.startsWith('total-')).every((s) => s.section === 'total')).toBe(true);
    expect(statOf(stats, 'total-time')).toMatchObject({ value: '0 Sek.', detail: 'weniger als eine Jahreszeit' });
    expect(statOf(stats, 'total-cards').value).toBe('0');
    expect(statOf(stats, 'total-trees')).toMatchObject({ value: `1/${MAIN_TREES.length}`, detail: 'Stieleiche' });
    expect(statOf(stats, 'cycle')).toEqual({ key: 'cycle', label: 'Zyklus', value: '1', detail: 'dein erster Zyklus' });
    expect(statOf(stats, 'time').value).toBe('weniger als eine Jahreszeit');
    expect(statOf(stats, 'time').detail).toBe('0 Sek. Spielzeit · jetzt 🌱 Frühling');
    expect(statOf(stats, 'tree').value).toBe('🌳 Stieleiche');
    expect(statOf(stats, 'stage').value).toBe('Samen');
    expect(statOf(stats, 'species').value).toBe(`0/${COMMON_SPECIES.length}`);
    expect(statOf(stats, 'plants').value).toBe(`0/${PLANTS.length}`);
    expect(statOf(stats, 'communities').value).toBe(`0/${COMMUNITIES.length}`);
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
    expect(statOf(stats, 'harmony').value).toBe(`${formatNumber(Math.round(ev.harmony))} ⚖️`);
    // Gerundet wie die Seitenleiste – auch der Höchstwert.
    expect(statOf(stats, 'harmony').detail).toMatch(/ · Höchstwert 43$/);
    expect(statOf(stats, 'species')).toMatchObject({ value: `2/${COMMON_SPECIES.length}`, detail: '1 neu in diesem Zyklus' });
    expect(statOf(stats, 'memory')).toMatchObject({ value: '25', detail: '+25 % Wachstum und Samen' });
    expect(statOf(stats, 'regulars')).toMatchObject({ value: '1/1', detail: 'Blaumeise' });
  });

  it('Über alle Zyklen: Werte aus meta.stats, Zahlenformat, kaputte Werte als 0', () => {
    const state = stateAt(0);
    state.meta.stats = {
      playSeconds: 2 * 86_400 + 3 * 3600 + 5,
      completedCyclesGrowth: 1_234_567.8,
      bestHarmony: 87.6,
      cardsChosen: 42,
      eventsDecided: 7,
      visitorsHosted: 3,
      plantsPlanted: 12_345,
      careRanksBought: 9,
      harmonyEarned: 0,
      wildwechselChosen: 0,
      upgradesBought: 0,
      upgradeSeeds: 0,
      grownTrees: ['oak', 'pine'],
    };
    let stats = toJournalStats(state, evaluate(state));
    expect(statOf(stats, 'total-time').value).toBe('2 Tage 3 Std.');
    expect(statOf(stats, 'total-growth').value).toBe(`${formatNumber(1_234_567)} 🌿`);
    expect(statOf(stats, 'total-harmony').value).toBe('88 ⚖️');
    expect(statOf(stats, 'total-cards')).toMatchObject({ value: '42', detail: 'Tierkarten gewählt' });
    expect(statOf(stats, 'total-plants')).toMatchObject({ label: 'Pflanzen gesät', detail: 'aus Aussaaten gesetzt' });
    expect(statOf(stats, 'total-events').value).toBe('7');
    expect(statOf(stats, 'total-visitors').value).toBe('3');
    expect(statOf(stats, 'total-plants').value).toBe('12.345');
    expect(statOf(stats, 'total-care').value).toBe('9');
    expect(statOf(stats, 'total-trees')).toMatchObject({ value: `2/${MAIN_TREES.length}`, detail: 'Stieleiche, Waldkiefer' });
    setNumberStyle('long');
    expect(statOf(toJournalStats(state, evaluate(state)), 'total-growth').value).toBe('1.234.567 🌿');
    state.meta.stats.playSeconds = Number.NaN;
    state.meta.stats.cardsChosen = -3;
    state.meta.stats.bestHarmony = Number.POSITIVE_INFINITY;
    stats = toJournalStats(state, evaluate(state));
    expect(statOf(stats, 'total-time').value).toBe('0 Sek.');
    expect(statOf(stats, 'total-cards').value).toBe('0');
    expect(statOf(stats, 'total-harmony').value).toBe('0 ⚖️');
  });

  it('Harmonie: gerundet wie die Seitenleiste, Stufe aus dem Rohwert', () => {
    const state = stateAt(0);
    state.cycle.maxHarmony = 12.5;
    const stat = statOf(toJournalStats(state, { harmony: 29.6 }), 'harmony');
    expect(stat.value).toBe('30 ⚖️');
    expect(stat.detail).toBe('Zarte Anfänge · Höchstwert 13'); // 29,6 liegt unter der Stufe ab 30
    expect(statOf(toJournalStats(state, { harmony: NaN }), 'harmony').value).toBe('0 ⚖️');
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
    expect(trees[0]).toMatchObject({ key: 'oak', name: 'Stieleiche', hidden: false, unlocked: true, current: true });
    expect(trees[0]!.text).toBeTruthy();
    const text = JSON.stringify(trees.slice(1));
    expect(text).not.toContain('Rotbuche');
    expect(text).not.toContain('Waldkiefer');
    expect(text).not.toContain('"beech"');
    expect(text).not.toContain('"pine"');
    expect(trees.slice(1).every((t) => t.name === '???' && t.hidden && !t.unlocked && !t.current && !!t.hint && !t.summary)).toBe(true);
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
    // Die Eiche war im ersten Zyklus Hauptbaum (Startwert), die Kiefer wächst gerade.
    expect(trees.map((t) => t.grown)).toEqual([true, false, true]);
  });

  it('„schon gewachsen“ aus meta.stats.grownTrees, die aktuelle Art immer', () => {
    const state = stateAt(1);
    state.cycle.number = 3;
    state.cycle.mainTree = 'beech';
    state.meta.journal.plants = ['pine', 'beech'];
    state.meta.stats.grownTrees = ['pine'];
    expect(toJournalTrees(state).map((t) => [t.key, t.grown, t.current])).toEqual([
      ['oak', false, false],
      ['beech', true, true],
      ['pine', true, false],
    ]);
  });
});
