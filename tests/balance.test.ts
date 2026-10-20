import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { formatReport, simulate } from '../scripts/simulate';

/**
 * Balancing-Ziele aus docs/GAME_DESIGN.md, geprüft mit großzügiger Toleranz
 * (Faktor 2 nach oben und unten). Die Tabelle landet im Testprotokoll.
 */
const TARGETS: { stage: number; seconds: number }[] = [
  { stage: 2, seconds: 2 * 60 }, // Setzling
  { stage: 3, seconds: 8 * 60 }, // Junger Baum
  { stage: 4, seconds: 25 * 60 }, // Alter Baum
  { stage: 5, seconds: 60 * 60 }, // Hain
];

describe('Balancing (Simulation)', () => {
  const result = simulate({ targetStage: 6 });
  console.log(`Simulation – Standardspieler\n${formatReport(result)}`);

  it('Keimling in unter 30 Sekunden', () => {
    expect(result.stageTimes[1]).not.toBeNull();
    expect(result.stageTimes[1]!).toBeLessThan(30);
  });

  for (const { stage, seconds } of TARGETS) {
    it(`${STAGES[stage]!.name} nach etwa ${seconds / 60} Minuten`, () => {
      const t = result.stageTimes[stage];
      expect(t).not.toBeNull();
      expect(t!).toBeGreaterThan(seconds / 2);
      expect(t!).toBeLessThan(seconds * 2);
    });
  }

  it('anfangs selten mehr als ~30 s zwischen zwei Käufen', () => {
    expect(result.maxGapEarly).toBeLessThan(45);
  });

  it('auch ein Gelegenheitsspieler erreicht den Hain in vertretbarer Zeit', () => {
    // Klickt nur in der ersten Minute, einmal pro Sekunde.
    const casual = simulate({ clicks: [{ until: 60, perSecond: 1 }], targetStage: 5 });
    console.log(`Simulation – Gelegenheitsspieler\n${formatReport(casual)}`);
    expect(casual.stageTimes[5]).not.toBeNull();
    expect(casual.stageTimes[5]!).toBeLessThan(2 * 60 * 60);
  });
});
