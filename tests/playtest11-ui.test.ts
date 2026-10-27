import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { evaluate, secondsToNextStage, thresholdFor } from '../src/core/formulas';
import { stageEtaText, toEcosystemView } from '../src/ui/adapters';
import { stateAt } from './helpers';

/** Playtest Phase 11 (docs/playtest/phase11.md), F4: mittelfristiges Ziel unter der Stufenleiste. */
describe('Restzeit zur nächsten Stufe (F4)', () => {
  it('„Alter Baum in ~N Min.“ aus der aktuellen Rate, auf Minuten aufgerundet', () => {
    const state = stateAt(3, ['earthworm'], 1);
    const next = STAGES[4]!.name;
    const rest = thresholdFor(STAGES[4]!.waypoint) - state.totalGrowth;
    // 22 Min. 10 s → „~23 Min.“
    expect(stageEtaText(state, rest / (22 * 60 + 10))).toBe(`${next} in ~23 Min.`);
    expect(stageEtaText(state, rest / (79.5 * 60))).toBe(`${next} in ~1 Std. 20 Min.`);
    expect(stageEtaText(state, rest / 30)).toBe(`${next} in unter 1 Min.`);
  });

  it('leer ohne Wachstum und auf der letzten Stufe; die Ansicht nutzt die Rate der Auswertung', () => {
    const state = stateAt(3, ['earthworm'], 1);
    expect(stageEtaText(state, 0)).toBe('');
    expect(stageEtaText(stateAt(STAGES.length - 1, ['earthworm'], 1), 5)).toBe('');
    const ev = evaluate(state);
    const view = toEcosystemView(state, ev);
    expect(view.stageEta).toBe(stageEtaText(state, ev.growth));
    expect(Number.isFinite(secondsToNextStage(state, ev.growth))).toBe(true);
  });
});
