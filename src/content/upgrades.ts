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
    baseCost: 12,
    costGrowth: 1.3,
    effect: { type: 'produce', resource: 'water', perLevel: 0.5 },
  },
  {
    id: 'cotyledon',
    name: 'Keimblatt',
    description: 'Ein erstes Blatt fängt Sonnenlicht ein.',
    unlockStage: 0,
    baseCost: 12,
    costGrowth: 1.3,
    effect: { type: 'produce', resource: 'light', perLevel: 0.5 },
  },
  {
    id: 'chlorophyll',
    name: 'Chlorophyll',
    description: 'Mehr Blattgrün – mehr Photosynthese pro Sekunde.',
    unlockStage: 1,
    baseCost: 30,
    costGrowth: 1.22,
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
    baseCost: 1_400,
    costGrowth: 1.24,
    effect: { type: 'photosynthesis', perLevel: 8 },
  },
  {
    id: 'root-network',
    name: 'Wurzelgeflecht',
    description: 'Ein weit verzweigtes Geflecht erschließt den ganzen Boden.',
    unlockStage: 4,
    baseCost: 4_000,
    costGrowth: 1.33,
    effect: { type: 'produce', resource: 'water', perLevel: 20 },
  },
  {
    id: 'leader-shoot',
    name: 'Wipfeltrieb',
    description: 'Die Spitze reckt sich über alle Nachbarn ins volle Licht.',
    unlockStage: 4,
    baseCost: 4_000,
    costGrowth: 1.33,
    effect: { type: 'produce', resource: 'light', perLevel: 20 },
  },
  {
    id: 'stomata',
    name: 'Spaltöffnungen',
    description: 'Tausende winzige Poren atmen Kohlendioxid ein.',
    unlockStage: 4,
    baseCost: 7_500,
    costGrowth: 1.3,
    effect: { type: 'photosynthesis', perLevel: 50 },
  },
  {
    id: 'root-grafts',
    name: 'Wurzelverwachsung',
    description: 'Die Wurzeln benachbarter Bäume wachsen zusammen und teilen ihr Wasser.',
    unlockStage: 5,
    baseCost: 15_000,
    costGrowth: 1.3,
    effect: { type: 'produce', resource: 'water', perLevel: 60 },
  },
  {
    id: 'shade-leaves',
    name: 'Schattenblätter',
    description: 'Große, dünne Blätter fangen unten im Hain das letzte Licht.',
    unlockStage: 5,
    baseCost: 15_000,
    costGrowth: 1.3,
    effect: { type: 'produce', resource: 'light', perLevel: 60 },
  },
  {
    id: 'young-growth',
    name: 'Jungwuchs',
    description: 'Aus deinen Samen wachsen neue Bäume – jeder betreibt Photosynthese.',
    unlockStage: 5,
    baseCost: 25_000,
    costGrowth: 1.3,
    effect: { type: 'photosynthesis', perLevel: 150 },
  },
];

export const UPGRADES_BY_ID: ReadonlyMap<string, Upgrade> = new Map(UPGRADES.map((u) => [u.id, u]));
