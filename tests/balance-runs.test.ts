import { describe, expect, it } from 'vitest';
import { HARMONY, RANDOM, branchCycles, runCycles, runGame, runStages } from '../scripts/simulate';
import { HAIN, MAX_SECONDS, URWALD, WALD } from './balance-setup';

/**
 * Die geteilten Durchgänge der Balancing-Tests (tests/balance-runs.ts) müssen genau dieselben
 * Ergebnisse liefern wie eigene Läufe – sonst würden die Tests etwas anderes messen als vorher.
 */
describe('Geteilte Balancing-Durchgänge (Checkpoints im Simulator)', () => {
  it('runStages: je Ziel-Stufe dasselbe Ergebnis wie ein eigener Lauf', () => {
    const options = { seed: 1007, maxSeconds: MAX_SECONDS, care: true };
    const shared = runStages(HARMONY, [HAIN, WALD], options);
    expect(shared.get(HAIN)).toEqual(runGame(HARMONY, { ...options, targetStage: HAIN }));
    expect(shared.get(WALD)).toEqual(runGame(HARMONY, { ...options, targetStage: WALD }));
  });

  it('branchCycles: je Neustart-Stufe dieselben Zyklen wie runCycles (auch Zufall und Stammgäste)', () => {
    const options = { seed: 1014, maxSeconds: MAX_SECONDS, care: true, cycles: 2 };
    const shared = branchCycles(RANDOM, [HAIN, WALD, URWALD], options);
    for (const stage of [HAIN, WALD, URWALD]) {
      expect(shared.get(stage), `Stufe ${stage}`).toEqual(runCycles(RANDOM, { ...options, targetStage: stage }));
    }
  });
});
