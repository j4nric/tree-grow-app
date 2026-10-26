import { describe, expect, it } from 'vitest';
import { NICHE_MILESTONES, TREE_PARTS_BY_ID } from '../src/content/upgrades';
import { evaluate } from '../src/core/formulas';
import { upgradeNiche } from '../src/core/tick';
import { refreshEcosystemView, toEcosystemView, treeUpgradeViews, upgradeMilestoneText } from '../src/ui/adapters';
import { stateAt } from './helpers';

/*
 * Einfache Ausbau-Ansicht im Reiter Nischen (Phase 11, 2a): Knopf „Ausbauen · Preis“ je offener
 * Nische, drei Baum-Zeilen ab dem Keimling, Meldung bei Meilensteinen. Die ausgefeilte Ansicht
 * (Kaufmenge, Balken, Abzeichen) folgt mit 4b.
 */

/** Geschützte Leerzeichen (Zahlenformat) als normale – für lesbare Erwartungen. */
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('Ausbau in der Ökosystem-Ansicht', () => {
  it('Knopf nur an offenen Nischen; Stufe, Wirkung, nächster Meilenstein, Preis', () => {
    const state = stateAt(1, ['earthworm']);
    state.cycle.upgrades.niches.roots = 24;
    const view = toEcosystemView(state, evaluate(state));
    const roots = view.niches.find((n) => n.id === 'roots')!;
    expect(plain(roots.upgrade!.effect)).toBe('je Tier +2,4 %');
    expect(roots.upgrade).toMatchObject({
      target: { kind: 'niche', id: 'roots' },
      id: 'roots',
      level: 24,
      next: 'St. 25: +1 Platz',
      cost: 287,
      costLabel: '287',
      affordable: false,
    });
    // Verschlossene Nischen (Laubstreu vor dem Setzling, Tümpel ohne Forschung) ohne Knopf.
    expect(view.niches.find((n) => n.id === 'litter')!.upgrade).toBeUndefined();
    expect(view.niches.find((n) => n.id === 'pond')!.upgrade).toBeUndefined();
  });

  it('„reicht es?“ folgt den Samen ohne Neuaufbau', () => {
    const state = stateAt(1);
    const view = toEcosystemView(state, evaluate(state));
    const roots = view.niches.find((n) => n.id === 'roots')!.upgrade!;
    expect(roots.affordable).toBe(false);
    expect(view.treeUpgrades.every((p) => !p.affordable)).toBe(true);
    state.seeds = 12;
    refreshEcosystemView(view, state);
    expect(roots.affordable).toBe(true);
    expect(view.treeUpgrades.every((p) => !p.affordable)).toBe(true);
    state.seeds = 15;
    refreshEcosystemView(view, state);
    expect(view.treeUpgrades.every((p) => p.affordable)).toBe(true);
  });

  it('Baum-Zeilen ab dem Keimling, Wirkung je Teil', () => {
    expect(treeUpgradeViews(stateAt(0))).toEqual([]);
    const state = stateAt(3);
    state.cycle.upgrades.tree = { rings: 22, leaves: 21, mycorrhiza: 22 };
    const rows = treeUpgradeViews(state);
    expect(rows.map((r) => [r.id, r.label, plain(r.effect)])).toEqual([
      ['rings', 'Jahresringe', 'Baum +8,8 % 🌿'],
      ['leaves', 'Blattwerk', 'Baum +21 % 🌰'],
      ['mycorrhiza', 'Pilzgeflecht', 'Pflanzen +11 % 🌿 🌰'],
    ]);
    expect(rows[0]!.next).toBe(`St. 25: ${TREE_PARTS_BY_ID.get('rings')!.milestones[0]!.summary}`);
  });

  it('Meldung bei Meilensteinen, leer ohne', () => {
    const state = stateAt(1);
    state.seeds = 1e6;
    const result = upgradeNiche(state, 'roots', 25);
    expect(result.ok && upgradeMilestoneText(result.upgrade!)).toBe(
      '🪱 Wurzelraum Stufe 10: öfter in den Karten. 🪱 Wurzelraum Stufe 25: +1 Platz, Abzeichen Bronze',
    );
    const plain = upgradeNiche(state, 'roots');
    expect(plain.ok && upgradeMilestoneText(plain.upgrade!)).toBe('');
    expect(NICHE_MILESTONES[0]!.summary).toBe('öfter in den Karten');
  });

  it('Stufe am Ende (MAX): kein Preis, nie bezahlbar', () => {
    const state = stateAt(1);
    state.seeds = Number.MAX_VALUE;
    state.cycle.upgrades.niches.roots = 1000;
    const view = toEcosystemView(state, evaluate(state));
    expect(view.niches.find((n) => n.id === 'roots')!.upgrade).toMatchObject({ cost: Infinity, costLabel: '–', affordable: false, next: '' });
  });
});
