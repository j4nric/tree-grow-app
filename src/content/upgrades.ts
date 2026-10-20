import type { ResourceId } from '../core/state';

/** Was ein Upgrade pro Stufe bewirkt. Neue Effekttypen brauchen Logik in core/formulas.ts. */
export type UpgradeEffect =
  | { type: 'produce'; resource: Extract<ResourceId, 'water' | 'light'>; perLevel: number }
  | { type: 'photosynthesis'; perLevel: number };

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  /** Ab welchem Stufen-Index (siehe stages.ts) das Upgrade sichtbar ist. */
  unlockStage: number;
  /** Kosten in Energie für Stufe 1. */
  baseCost: number;
  /** Kostenfaktor pro bereits gekaufter Stufe. */
  costGrowth: number;
  effect: UpgradeEffect;
}

export const UPGRADES: readonly Upgrade[] = [
  {
    id: 'root-hairs',
    name: 'Wurzelhaare',
    description: 'Feine Härchen saugen Wasser aus dem Boden.',
    unlockStage: 0,
    baseCost: 5,
    costGrowth: 1.15,
    effect: { type: 'produce', resource: 'water', perLevel: 0.5 },
  },
  {
    id: 'cotyledon',
    name: 'Keimblatt',
    description: 'Ein erstes Blatt fängt Sonnenlicht ein.',
    unlockStage: 0,
    baseCost: 5,
    costGrowth: 1.15,
    effect: { type: 'produce', resource: 'light', perLevel: 0.5 },
  },
  {
    id: 'chlorophyll',
    name: 'Chlorophyll',
    description: 'Mehr Blattgrün – mehr Photosynthese pro Sekunde.',
    unlockStage: 1,
    baseCost: 20,
    costGrowth: 1.2,
    effect: { type: 'photosynthesis', perLevel: 1 },
  },
  {
    id: 'taproot',
    name: 'Pfahlwurzel',
    description: 'Eine tiefe Wurzel erreicht das Grundwasser.',
    unlockStage: 2,
    baseCost: 120,
    costGrowth: 1.17,
    effect: { type: 'produce', resource: 'water', perLevel: 3 },
  },
  {
    id: 'canopy',
    name: 'Blätterkrone',
    description: 'Viele Blätter, viel Licht.',
    unlockStage: 2,
    baseCost: 120,
    costGrowth: 1.17,
    effect: { type: 'produce', resource: 'light', perLevel: 3 },
  },
  {
    id: 'chloroplasts',
    name: 'Chloroplasten',
    description: 'Die Kraftwerke der Zelle arbeiten auf Hochtouren.',
    unlockStage: 3,
    baseCost: 900,
    costGrowth: 1.22,
    effect: { type: 'photosynthesis', perLevel: 8 },
  },
];

export const UPGRADES_BY_ID: ReadonlyMap<string, Upgrade> = new Map(UPGRADES.map((u) => [u.id, u]));
