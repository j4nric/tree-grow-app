import type { Effect, Genus } from './types';

/**
 * Gattungsboni (à la Teamfight Tactics): Leben mindestens 2 / 3 / 5 Arten einer
 * Gattung im Ökosystem, gilt der jeweilige Bonus zusätzlich (Stufen addieren sich).
 * Wirkungen werden NICHT mit Zufriedenheit skaliert. Zahlen aus scripts/v2/content.ts.
 * Im Prototyp hat jede Gattung nur 3 Arten – die 5er-Stufe ist noch unerreichbar.
 */
export const TRAIT_THRESHOLDS: readonly number[] = [2, 3, 5];

export interface TraitTier {
  effects: readonly Effect[];
  text: string;
}

export const TRAITS: Readonly<Record<Genus, readonly TraitTier[]>> = {
  birds: [
    { effects: [{ kind: 'control', tag: 'insekten', pct: 25 }], text: 'Insektenschaden −25 %' },
    { effects: [{ kind: 'seeds', pct: 15 }], text: '+15 % Samen' },
    { effects: [{ kind: 'growth', pct: 20 }, { kind: 'seeds', pct: 20 }], text: '+20 % Wachstum, +20 % Samen' },
  ],
  insects: [
    { effects: [{ kind: 'groupSeeds', group: 'flowers', pct: 30 }], text: 'Blumen +30 % Samen' },
    {
      effects: [
        { kind: 'groupSeeds', group: 'shrubs', pct: 30 },
        { kind: 'groupSeeds', group: 'trees', pct: 30 },
      ],
      text: 'Sträucher und Bäume +30 % Samen',
    },
    { effects: [{ kind: 'seeds', pct: 40 }], text: '+40 % Samen' },
  ],
  soil: [
    { effects: [{ kind: 'water', amount: 2 }], text: '+2 Wasser' },
    { effects: [{ kind: 'growth', pct: 12 }], text: '+12 % Wachstum' },
    { effects: [{ kind: 'growth', pct: 25 }, { kind: 'water', amount: 3 }], text: '+25 % Wachstum, +3 Wasser' },
  ],
};
