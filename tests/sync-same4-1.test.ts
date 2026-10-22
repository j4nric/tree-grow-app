// Konto-Abgleich, zwei Tabs mit demselben Konto: alle Abfolgen der Länge 4 – ein Teil davon.
// Die Aufzählung ist auf tests/sync-same4-1.test.ts bis -3 verteilt (gleicher Inhalt, der Teil
// ergibt sich aus dem Dateinamen), damit Vitest die Teile parallel ausführt. Prüfstand und
// Aufteilung: tests/sync-harness.ts; dass die Teile zusammen jede Abfolge genau einmal abdecken:
// tests/sync-sequences.test.ts.
import { describe, expect, it } from 'vitest';
import { SAME4_PARTS, runSameLength4 } from './sync-harness';

const part = Number(/sync-same4-(\d+)\.test\.ts/.exec(import.meta.url)?.[1]) - 1;

describe('Konto-Abgleich: zwei Tabs mit demselben Konto', () => {
  it(`Länge 4 vollständig – Teil ${part + 1}/${SAME4_PARTS}`, async () => {
    expect(part >= 0 && part < SAME4_PARTS).toBe(true);
    expect(await runSameLength4(part)).toEqual([]);
  }, 600_000);
});
