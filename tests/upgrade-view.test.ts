import { describe, expect, it } from 'vitest';
import {
  fixtureUpgradeState,
  PLACEHOLDER_NICHE_MILESTONES,
  PLACEHOLDER_TREE_PARTS,
  placeholderCost,
  placeholderPrice,
  placeholderPurchase,
  UPGRADE_FIXTURES,
} from '../src/ui/upgrade-fixtures';
import {
  badgeOf,
  badgeView,
  buyAmountLabel,
  formatCountdown,
  goalLineView,
  milestoneProgress,
  nicheFooterView,
  treeMilestoneHint,
  treePartView,
  upgradeButtonView,
  waitText,
  type NicheUpgradeInput,
  type UpgradeContext,
} from '../src/ui/upgrade-view';

/** Ausbau und Zielzeile als Ansicht (Phase 11, 1c): Zustand → Texte, Balken, Abzeichen, aria. */

const NBSP = '\u00a0';
const ctx = (seeds: number, seedsPerSecond = 1, amount: UpgradeContext['amount'] = 1): UpgradeContext => ({ seeds, seedsPerSecond, amount });
const M = PLACEHOLDER_NICHE_MILESTONES;

const niche = (over: Partial<NicheUpgradeInput> = {}): NicheUpgradeInput => ({
  id: 'roots',
  icon: '🪱',
  label: 'Wurzelraum',
  level: 24,
  best: 24,
  milestones: M,
  pctPerLevel: 0.1,
  happiness: [0.95, 0.8, 0.9],
  purchase: { count: 1, cost: 268 },
  ...over,
});

describe('Platzhalter-Preise (wie 28.4)', () => {
  it('Wurzelraum 10 / 36 / 287, Summe bis 10 = 209', () => {
    expect(placeholderPrice(10, 0)).toBe(10);
    expect(placeholderPrice(10, 9)).toBe(36);
    expect(placeholderPrice(10, 24)).toBe(287);
    expect(placeholderCost(10, 0, 10)).toBe(209);
  });

  it('Max kauft so viele, wie die Samen reichen, sonst eine Stufe', () => {
    expect(placeholderPurchase(10, 0, 'max', 209)).toEqual({ count: 10, cost: 209 });
    expect(placeholderPurchase(10, 0, 'max', 5)).toEqual({ count: 1, cost: 10 });
    expect(placeholderPurchase(10, 0, 10, 0)).toEqual({ count: 10, cost: 209 });
  });
});

describe('formatCountdown und waitText', () => {
  it('auf 5 s aufgerundet, ab einer Stunde „über 1 Std.“', () => {
    expect(formatCountdown(0.2)).toBe('0:05');
    expect(formatCountdown(47)).toBe('0:50');
    expect(formatCountdown(100)).toBe('1:40');
    expect(formatCountdown(3599)).toBe('über 1 Std.');
    expect(formatCountdown(7200)).toBe('über 1 Std.');
    expect(formatCountdown(Infinity)).toBe('');
  });

  it('leer, wenn bezahlbar oder ohne Rate', () => {
    expect(waitText(100, 60, 1)).toBe('in 0:40');
    expect(waitText(100, 100, 1)).toBe('');
    expect(waitText(100, 0, 0)).toBe('');
  });
});

describe('Meilenstein-Balken', () => {
  it('Balken vom vorigen bis zum nächsten Meilenstein, Wirkung vor Abzeichen', () => {
    expect(milestoneProgress(0, M)).toMatchObject({ next: 10, fraction: 0, label: '10: öfter in den Karten', remaining: 10 });
    expect(milestoneProgress(24, M)).toMatchObject({ next: 25, label: '25: +1 Platz', remaining: 1 });
    expect(milestoneProgress(24, M).fraction).toBeCloseTo(14 / 15);
    expect(milestoneProgress(50, M)).toMatchObject({ next: 75, label: '75: Abzeichen Gold' });
    expect(milestoneProgress(80, M)).toEqual({ next: null, fraction: 1, label: 'alle Meilensteine', summary: '', remaining: 0 });
  });

  it('Abzeichen nach bester Stufe: 25 Bronze, 50 Silber, 75 Gold', () => {
    expect(badgeOf(24, M)).toBeNull();
    expect(badgeOf(25, M)).toBe('bronze');
    expect(badgeOf(60, M)).toBe('silver');
    expect(badgeOf(75, M)).toBe('gold');
    expect(badgeView('Wurzelraum', 31, M)).toEqual({
      tier: 'bronze',
      text: '⭑ Bronze',
      title: 'Abzeichen Bronze: Wurzelraum einmal auf Stufe 25 – bleibt über den Zyklus.',
    });
  });
});

describe('Knopf „Ausbauen · Preis“', () => {
  it('×1, ×10, Max und zu teuer mit Wartezeit', () => {
    expect(upgradeButtonView('Krone', { count: 1, cost: 1240 }, ctx(2000))).toMatchObject({
      label: `Ausbauen · 1.240${NBSP}🌰`,
      affordable: true,
      wait: '',
      aria: 'Krone ausbauen: eine Stufe für 1.240 Samen',
    });
    expect(upgradeButtonView('Krone', { count: 10, cost: 4100 }, ctx(2000, 50, 10))).toMatchObject({
      label: `+10 · 4.100${NBSP}🌰`,
      affordable: false,
      wait: 'in 0:45',
      aria: 'Krone ausbauen: 10 Stufen für 4.100 Samen, noch zu teuer – in 0:45',
    });
    expect(upgradeButtonView('Krone', { count: 7, cost: 1900 }, ctx(2000, 1, 'max')).label).toBe('+7 · Max');
    // Max ohne genug Samen: Preis der nächsten Stufe
    expect(upgradeButtonView('Krone', { count: 1, cost: 300 }, ctx(10, 0, 'max'))).toMatchObject({ label: `Ausbauen · 300${NBSP}🌰`, wait: '' });
    expect(buyAmountLabel(10)).toBe('×10');
    expect(buyAmountLabel('max')).toBe('Max');
  });
});

describe('Fußzeile je Nische', () => {
  it('Stufe, Wirkung je Tier, Summe mit Zufriedenheit, Abzeichen', () => {
    const view = nicheFooterView(niche({ best: 31 }), ctx(240, 20));
    expect(view.closed).toBe(false);
    expect(view.levelText).toBe('St. 24');
    expect(view.progress.label).toBe('25: +1 Platz');
    expect(view.effectText).toBe('je Tier +2,4 %');
    // 2,4 · (0,95 + 0,8 + 0,9) = 6,36 → „+6,4 %“
    expect(view.effectLines[0]).toBe('3 Tiere, zusammen +6,4 % 🌿 und +6,4 % 🌰.');
    expect(view.button?.wait).toBe('in 0:05');
    expect(view.badge?.tier).toBe('bronze');
  });

  it('Stufe 0 und leere Nische', () => {
    const view = nicheFooterView(niche({ level: 0, best: 0, happiness: [] }), ctx(0, 1));
    expect(view.effectText).toBe('+0,1 % je Stufe');
    expect(view.effectLines).toEqual(['Je Stufe bekommt jedes Tier hier +0,1 % 🌿 und 🌰 – noch wohnt niemand hier.']);
    expect(view.badge).toBeNull();
  });

  it('verschlossene Nische: kein Knopf', () => {
    const view = nicheFooterView(niche({ purchase: null }), ctx(1000));
    expect(view.closed).toBe(true);
    expect(view.button).toBeNull();
  });
});

describe('„🌳 Dein Baum“', () => {
  const parts = fixtureUpgradeState(UPGRADE_FIXTURES.middle.input, 1).tree;

  it('Wirkung je Baumteil wie in der Skizze 28.9', () => {
    const views = parts.map((p) => treePartView(p, ctx(240, 20)));
    expect(views.map((v) => [v.title, v.levelText, v.effectText])).toEqual([
      ['🪵 Jahresringe', 'St. 22', `Baum +8,8 %${NBSP}🌿`],
      ['🍃 Blattwerk', 'St. 21', `Baum +21 %${NBSP}🌰`],
      ['🍄 Pilzgeflecht', 'St. 22', 'Pflanzen +11 %'],
    ]);
    expect(views[0]!.progress.label).toBe('25: +1 Höhle');
  });

  it('nächster Meilenstein: der Teil mit den wenigsten fehlenden Stufen', () => {
    expect(treeMilestoneHint(parts)).toBe('nächster Meilenstein: Jahresringe 25 · +1 Höhle');
    const done = parts.map((p) => ({ ...p, level: 80 }));
    expect(treeMilestoneHint(done)).toBe('');
  });

  it('Stufe 0 nennt die Wirkung je Stufe', () => {
    const part = { ...PLACEHOLDER_TREE_PARTS[2]!, level: 0, best: 0, purchase: { count: 1, cost: 15 } };
    expect(treePartView(part, ctx(0)).effectText).toBe('Pflanzen +0,5 % je Stufe');
  });
});

describe('Zielzeile', () => {
  const goal = { kind: 'niche' as const, id: 'crown', icon: '🌳', name: 'Krone', level: 14, cost: 1240 };

  it('„Nächstes“ mit Countdown, „Jetzt“ hervorgehoben, Meilenstein in Klammern', () => {
    expect(goalLineView(goal, ctx(1000, 5))).toMatchObject({
      key: 'niche:crown:14',
      ready: false,
      text: `Nächstes: 🌳 Krone St. 14 · 1.240${NBSP}🌰 · in 0:50`,
      research: '',
    });
    expect(goalLineView(goal, ctx(1300, 5))).toMatchObject({ ready: true, text: `Jetzt: 🌳 Krone St. 14 · 1.240${NBSP}🌰 ›` });
    const milestone = goalLineView({ ...goal, id: 'roots', icon: '🪱', name: 'Wurzelraum', level: 25, cost: 2900, milestone: '+1 Platz' }, ctx(2400, 5), 2);
    expect(milestone?.text).toBe(`Nächstes: 🪱 Wurzelraum St. 25 (+1 Platz) · 2.900${NBSP}🌰 · in 1:40`);
    expect(milestone?.research).toBe('🔍 2 erforschbar ›');
    expect(milestone?.announce).toBe('Nächstes Ziel: Wurzelraum St. 25 (+1 Platz), 2.900 Samen');
  });

  it('ohne Rate keine Zeit, ohne Ziel keine Zeile', () => {
    expect(goalLineView(goal, ctx(0, 0))?.text).toBe(`Nächstes: 🌳 Krone St. 14 · 1.240${NBSP}🌰`);
    expect(goalLineView(null, ctx(0))).toBeNull();
  });

  it('Beispielzustände: Meilenstein in ≤ 120 s gewinnt, sonst der billigste', () => {
    // Hain: Waldsaum 9 → 10 ist ein Meilenstein und bezahlbar
    expect(fixtureUpgradeState(UPGRADE_FIXTURES.middle.input, 1).goal).toMatchObject({ id: 'edge', level: 10, milestone: 'öfter in den Karten' });
    // Keimling: kein Meilenstein in Reichweite → billigster (Pilzgeflecht 15)
    expect(fixtureUpgradeState(UPGRADE_FIXTURES.start.input, 1).goal).toMatchObject({ id: 'mycorrhiza', level: 1, cost: 15 });
  });
});

describe('Beispielzustände', () => {
  it('verschlossene Nischen haben keinen Kauf, offene einen', () => {
    for (const { input } of Object.values(UPGRADE_FIXTURES)) {
      const state = fixtureUpgradeState(input, 'max');
      for (const n of state.niches) expect(n.purchase === null).toBe(n.capacity <= 0);
      expect(state.tree).toHaveLength(3);
    }
  });
});
