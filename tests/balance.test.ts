import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { ACTIVE_CLICKS, ALWAYS_CLICKS, NO_CLICKS, formatReport, simulate } from '../scripts/simulate';

/**
 * Balancing-Ziele aus docs/GAME_DESIGN.md, geprüft mit großzügiger Toleranz
 * (Faktor 2 nach oben und unten). Die Zielzeiten gelten für einen Spieler, der
 * **gar nicht klickt** und nur kauft. Die Tabellen landen im Testprotokoll.
 */
const TARGETS: { stage: number; seconds: number }[] = [
  { stage: 2, seconds: 2 * 60 }, // Setzling
  { stage: 3, seconds: 8 * 60 }, // Junger Baum
  { stage: 4, seconds: 25 * 60 }, // Alter Baum
  { stage: 5, seconds: 60 * 60 }, // Hain
];

/** Takt-Ziel ~45 s; geprüft wird großzügig: Median ≤ 60 s, längste Wartezeit ≤ 90 s. */
const MAX_MEDIAN_GAP = 60;
const MAX_SINGLE_GAP = 90;
/**
 * Abschnitte mit Takt-Prüfung: Keimling bis Alter Baum, also alle Käufe bis zum
 * Erreichen des Hains. Der Samen-Abschnitt dauert nur ~10 s und hat keinen Kauf;
 * die Wartezeit bis zum ersten Kauf zählt im Keimling-Abschnitt mit.
 */
const PACED_STAGES = [1, 2, 3, 4];

describe('Balancing (Simulation)', () => {
  const idle = simulate({ clicks: NO_CLICKS, targetStage: 6 });
  console.log(`Simulation – Nicht-Klicker (Standard)\n${formatReport(idle)}`);

  it('Keimling in unter 30 Sekunden – ganz ohne Klick', () => {
    expect(idle.stageTimes[1]).not.toBeNull();
    expect(idle.stageTimes[1]!).toBeLessThan(30);
  });

  for (const { stage, seconds } of TARGETS) {
    it(`${STAGES[stage]!.name} nach etwa ${seconds / 60} Minuten (ohne Klicks)`, () => {
      const t = idle.stageTimes[stage];
      expect(t).not.toBeNull();
      expect(t!).toBeGreaterThan(seconds / 2);
      expect(t!).toBeLessThan(seconds * 2);
    });
  }

  for (const stage of PACED_STAGES) {
    it(`Takt im Abschnitt ab „${STAGES[stage]!.name}“: Median ≤ ${MAX_MEDIAN_GAP} s, nie über ${MAX_SINGLE_GAP} s`, () => {
      const section = idle.sections[stage]!;
      expect(section.purchases).toBeGreaterThan(0);
      expect(section.medianGap!).toBeLessThanOrEqual(MAX_MEDIAN_GAP);
      expect(section.maxGap!).toBeLessThanOrEqual(MAX_SINGLE_GAP);
    });
  }

  it('Klicken beschleunigt spürbar, aber moderat', () => {
    const active = simulate({ clicks: ACTIVE_CLICKS, targetStage: 5 });
    const always = simulate({ clicks: ALWAYS_CLICKS, targetStage: 5 });
    console.log(`Simulation – aktiver Spieler\n${formatReport(active)}`);
    console.log(`Simulation – Dauerklicker\n${formatReport(always)}`);
    for (const stage of [2, 3, 5]) {
      const idleTime = idle.stageTimes[stage]!;
      for (const run of [active, always]) {
        const t = run.stageTimes[stage]!;
        // Nie langsamer als ohne Klicks, aber auch nicht mehr als doppelt so schnell.
        expect(t).toBeLessThanOrEqual(idleTime);
        expect(t).toBeGreaterThan(idleTime / 2);
      }
    }
    // Spürbar: Wer anfangs klickt, ist beim Setzling mindestens 15 % schneller.
    expect(active.stageTimes[2]!).toBeLessThan(idle.stageTimes[2]! * 0.85);
    // Und Klicken bleibt später relevant: Dauerklicker erreichen den Hain mindestens 15 % früher.
    expect(always.stageTimes[5]!).toBeLessThan(idle.stageTimes[5]! * 0.85);
  });
});
