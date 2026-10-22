import { describe, expect, it } from 'vitest';
import { referenceCases, referenceValue } from './predation-reference';

/**
 * Erzeugt die Referenzwerte für tests/predation.test.ts („nie schlechter als main“). Läuft nur
 * mit REFERENCE_OUT (Pfad der JSON-Datei); Anleitung in tests/predation-reference.ts.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const OUT = env.REFERENCE_OUT;

describe.skipIf(!OUT)('Referenz erzeugen', () => {
  it('schreibt die Werte', async () => {
    // Ohne @types/node: Modulname zur Laufzeit zusammensetzen.
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync(path: string, data: string): void };
    const cases = referenceCases();
    const values = cases.map(referenceValue);
    fs.writeFileSync(OUT!, `${JSON.stringify({ source: 'main 9dde233 (vor Räuber und Beute)', cases, values })}\n`);
    expect(values.length).toBe(cases.length);
  });
});
