import { describe, expect, it } from 'vitest';
import { SPECIES } from '../src/content/species';
import { buyCare, startNewCycle } from '../src/core/tick';
import { toAnimalDetailView } from '../src/ui/animal-detail-view';
import { toCyclePanelView } from '../src/ui/cycle-view';
import { nicheNeverOpensByStage, regularNextCycleHint, regularWaitReason, regularWaitText } from '../src/ui/regular-wait';
import { stateAt } from './helpers';

const POND_HINT = 'zieht erst ein, wenn der Waldtümpel wieder angelegt ist (Pflege ab „Alter Baum“)';

/** Stand mit entdeckten Arten und Stammgast-Plätzen, ohne dass die Arten hier leben. */
function withRegulars(stage: number, regulars: string[], present: string[] = []) {
  const state = stateAt(stage, present);
  for (const id of regulars) if (!state.meta.journal.species.includes(id)) state.meta.journal.species.push(id);
  state.meta.forestMemory = 25 * regulars.length;
  state.meta.regulars = [...regulars];
  return state;
}

describe('Warum ein Stammgast wartet (regularWaitReason)', () => {
  it('nur der Waldtümpel öffnet nie mit dem Wachstum', () => {
    expect(nicheNeverOpensByStage('pond')).toBe(true);
    for (const n of ['roots', 'litter', 'edge', 'crown', 'bark', 'hollows'] as const) expect(nicheNeverOpensByStage(n)).toBe(false);
  });

  it('Amphibie ohne Tümpel: wartet auf den Waldtümpel, vor „Alter Baum“ mit Hinweis auf die Pflege', () => {
    const early = withRegulars(1, ['toad']);
    expect(regularWaitReason(early, 'toad')).toEqual({ kind: 'niche-closed', niche: 'pond' });
    expect(regularWaitText(early, regularWaitReason(early, 'toad')!)).toBe('wartet auf den Waldtümpel (Pflege ab „Alter Baum“)');
    const old = withRegulars(4, ['toad']);
    expect(regularWaitText(old, regularWaitReason(old, 'toad')!)).toBe('wartet auf den Waldtümpel');
  });

  it('Tümpel angelegt: Pflege lässt den Stammgast einziehen, danach kein Warten mehr', () => {
    const state = withRegulars(4, ['toad']);
    state.seeds = 10_000;
    const result = buyCare(state, 'pond');
    expect(result).toMatchObject({ ok: true, regulars: ['toad'] });
    expect(regularWaitReason(state, 'toad')).toBeNull();
  });

  it('Tümpel offen, aber die Art noch nicht freigeschaltet: wartet auf die Stufe', () => {
    const state = withRegulars(4, ['crestednewt']);
    state.cycle.care = { pond: 1 };
    expect(regularWaitReason(state, 'crestednewt')).toEqual({ kind: 'stage', stage: 5 });
    expect(regularWaitText(state, { kind: 'stage', stage: 5 })).toBe('wartet auf „Hain“');
  });

  it('Tümpel voll: wartet auf einen freien Platz', () => {
    const state = withRegulars(4, ['newt'], ['toad', 'frog']);
    state.cycle.care = { pond: 1 };
    expect(regularWaitReason(state, 'newt')).toEqual({ kind: 'niche-full', niche: 'pond' });
    expect(regularWaitText(state, { kind: 'niche-full', niche: 'pond' })).toBe('wartet auf einen freien Platz');
  });

  it('Nische öffnet mit dem Wachstum: wartet auf die Stufe (Krone ab „Junger Baum“)', () => {
    const state = withRegulars(1, ['bluetit']);
    expect(regularWaitReason(state, 'bluetit')).toEqual({ kind: 'stage', stage: 3 });
  });

  it('Platz frei: zieht am nächsten Wegpunkt ein', () => {
    const state = withRegulars(2, ['vole']);
    expect(regularWaitReason(state, 'vole')).toEqual({ kind: 'next-waypoint' });
    expect(regularWaitText(state, { kind: 'next-waypoint' })).toBe('zieht am nächsten Wegpunkt ein');
  });

  it('kein Warten: nicht gewählt, lebt schon hier oder unbekannt', () => {
    const state = withRegulars(4, ['earthworm'], ['earthworm']);
    expect(regularWaitReason(state, 'earthworm')).toBeNull();
    expect(regularWaitReason(state, 'toad')).toBeNull();
    expect(regularWaitReason(state, 'nope')).toBeNull();
  });

  it('nach dem Neuen Zyklus wartet ein Amphibien-Stammgast wieder auf den Tümpel', () => {
    const state = withRegulars(5, ['toad']);
    state.cycle.care = { pond: 1 };
    state.niches.pond = ['toad'];
    expect(regularWaitReason(state, 'toad')).toBeNull();
    expect(startNewCycle(state, 1000).ok).toBe(true);
    expect(regularWaitReason(state, 'toad')).toEqual({ kind: 'niche-closed', niche: 'pond' });
  });
});

describe('Hinweis für die Wahl (regularNextCycleHint)', () => {
  it('alle Amphibien bekommen den Tümpel-Hinweis, Lebensraum-Arten einen Hinweis auf ihren Lebensraum, alle anderen keinen', () => {
    for (const sp of SPECIES) {
      if (sp.niche === 'meadow' || sp.niche === 'deadwood' || sp.niche === 'wall') {
        expect(regularNextCycleHint(sp.id), sp.id).toMatch(/^zieht erst ein, wenn/);
        continue;
      }
      expect(regularNextCycleHint(sp.id)).toBe(sp.niche === 'pond' ? POND_HINT : null);
    }
    expect(regularNextCycleHint('nope')).toBeNull();
  });
});

describe('View-Models mit Stammgast-Hinweis', () => {
  it('Stammgäste-Auswahl: Hinweis an Amphibien, Warte-Status für gewählte, nichts für andere', () => {
    const state = withRegulars(4, ['toad'], ['earthworm']);
    state.meta.journal.species.push('frog');
    state.meta.forestMemory = 50;
    const view = toCyclePanelView(state);
    expect(view.regulars.find((r) => r.id === 'toad')).toMatchObject({ selected: true, note: 'wartet auf den Waldtümpel', waiting: true });
    expect(view.regulars.find((r) => r.id === 'frog')).toMatchObject({ selected: false, note: POND_HINT, waiting: false });
    expect(view.regulars.find((r) => r.id === 'earthworm')).toMatchObject({ note: null, waiting: false });
  });

  it('Stammgast lebt im Tümpel: Hinweis fürs nächste Mal statt Warte-Status', () => {
    const state = withRegulars(4, ['toad'], ['toad']);
    state.cycle.care = { pond: 1 };
    const toad = toCyclePanelView(state).regulars.find((r) => r.id === 'toad')!;
    expect(toad).toMatchObject({ present: true, note: POND_HINT, waiting: false });
  });

  it('Tierdetails: Amphibien-Stammgast „zieht erst ein, wenn …“ statt „gleich wieder“', () => {
    const state = withRegulars(4, ['toad', 'earthworm'], ['toad', 'earthworm']);
    state.cycle.care = { pond: 1 };
    expect(toAnimalDetailView(state, 'toad')?.regular).toBe(`★ Stammgast – ${POND_HINT}`);
    expect(toAnimalDetailView(state, 'earthworm')?.regular).toBe('★ Stammgast – zieht im nächsten Zyklus gleich wieder ein');
  });
});
