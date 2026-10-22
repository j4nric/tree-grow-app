import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { ladderProgress, ladderSteps } from '../src/ui/album/stage-ladder-view';

/** Stufenleiste mit allen 8 Stufen (docs/ALBUM_UI.md, G-27). */
describe('Stufenleiste', () => {
  it('alle Stufen aus content/stages.ts, aktuelle markiert', () => {
    const steps = ladderSteps(3);
    expect(steps.map((s) => s.name)).toEqual(STAGES.map((s) => s.name));
    expect(steps.length).toBe(8);
    expect(steps.map((s) => s.state)).toEqual(['reached', 'reached', 'reached', 'current', 'future', 'future', 'future', 'future']);
  });

  it('Balken steht an der Stufe, plus Anteil bis zur nächsten', () => {
    const last = STAGES.length - 1;
    expect(ladderProgress(0, 0, 0)).toBe(0);
    // Junger Baum (Wegpunkt 6), Alter Baum ab 12: drei von sechs Wegpunkten geschafft.
    expect(ladderProgress(3, 9, 0)).toBeCloseTo((3 + 0.5) / last);
    expect(ladderProgress(3, 9, 0.5)).toBeCloseTo((3 + 3.5 / 6) / last);
    expect(ladderProgress(last, 40, 0.3)).toBe(1);
  });

  it('steigt monoton und bleibt zwischen 0 und 1, auch bei kaputten Werten', () => {
    let previous = -1;
    for (let w = 0; w <= 36; w++) {
      const stage = STAGES.reduce((found, s, i) => (s.waypoint <= w ? i : found), 0);
      for (const p of [0, 0.5, 0.99]) {
        const value = ladderProgress(stage, w, p);
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value).toBeLessThanOrEqual(1);
        previous = value;
      }
    }
    expect(ladderProgress(2, 4, Number.NaN)).toBeGreaterThanOrEqual(0);
    expect(ladderProgress(2, 4, Infinity)).toBeLessThanOrEqual(1);
  });
});
