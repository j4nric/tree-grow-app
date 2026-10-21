import type { Effect, Genus } from './types';

/**
 * Gattungsboni (à la Teamfight Tactics): Leben mindestens 2 / 3 / 5 Arten einer
 * Gattung im Ökosystem, gilt der jeweilige Bonus zusätzlich (Stufen addieren sich).
 * Wirkungen werden NICHT mit Zufriedenheit skaliert. Zahlen ursprünglich aus dem
 * Prototyp (scripts/v2, entfernt in Schritt 2.10).
 * Jede Grundgattung hat 6–8 Arten (DESIGN_V2.md 5.1); wer eine Gattung stapelt, erreicht
 * die 5. Die Amphibien (Erweiterung, 3 Arten) erreichen höchstens die Stufe 3.
 */
export const TRAIT_THRESHOLDS: readonly number[] = [2, 3, 5];

/*
 * Balancing 2.10: Alle 🌿-Wirkungen der Gattungsboni sind ×0,6 (gerundet) gegenüber dem
 * Prototyp. Der Wachstums-Spieler erreichte die mittlere Stufe (3 Bodenleben bzw.
 * Säugetiere) viel öfter als der Harmonie-Spieler, der für die Vielfalt streut; mit
 * Arten-🌿 ×0,75 ist er damit höchstens ~15 % schneller (DESIGN_V2.md 15.4).
 * Samen, Licht, Wasser und Schutz bleiben unverändert.
 */

export interface TraitTier {
  effects: readonly Effect[];
  text: string;
}

export const TRAITS: Readonly<Record<Genus, readonly TraitTier[]>> = {
  birds: [
    { effects: [{ kind: 'control', tag: 'insekten', pct: 25 }], text: 'Insektenschaden −25 %' },
    { effects: [{ kind: 'seeds', pct: 15 }], text: '+15 % Samen' },
    { effects: [{ kind: 'growth', pct: 12 }, { kind: 'seeds', pct: 20 }], text: '+12 % Wachstum, +20 % Samen' },
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
  mammals: [
    { effects: [{ kind: 'seeds', pct: 10 }], text: '+10 % Samen' },
    { effects: [{ kind: 'growth', pct: 7 }], text: '+7 % Wachstum' },
    { effects: [{ kind: 'growth', pct: 15 }], text: '+15 % Wachstum' },
  ],
  soil: [
    { effects: [{ kind: 'water', amount: 2 }], text: '+2 Wasser' },
    { effects: [{ kind: 'growth', pct: 7 }], text: '+7 % Wachstum' },
    { effects: [{ kind: 'growth', pct: 15 }, { kind: 'water', amount: 3 }], text: '+15 % Wachstum, +3 Wasser' },
  ],
  fungi: [
    { effects: [{ kind: 'groupGrowth', group: 'trees', pct: 6 }], text: 'Bäume +6 % Wachstum' },
    {
      effects: [
        { kind: 'water', amount: 3 },
        { kind: 'light', amount: 2 },
      ],
      text: '+3 Wasser, +2 Licht',
    },
    { effects: [{ kind: 'growth', pct: 18 }], text: '+18 % Wachstum' },
  ],
  // Erweiterung (DESIGN_V2.md 5.5): nur 3 Arten – die Stufe 5 erreicht nur, wer dazu
  // künftige Amphibien-Gäste hat; sie steht für die spätere Erweiterung bereit.
  amphibians: [
    { effects: [{ kind: 'control', tag: 'schnecken', pct: 25 }], text: 'Schneckenschaden −25 %' },
    {
      effects: [
        { kind: 'water', amount: 2 },
        { kind: 'growth', pct: 5 },
      ],
      text: '+2 Wasser, +5 % Wachstum',
    },
    { effects: [{ kind: 'growth', pct: 12 }], text: '+12 % Wachstum' },
  ],
};
