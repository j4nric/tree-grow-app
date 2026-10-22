/**
 * Seiten des Albums (docs/ALBUM_UI.md, D.1 und F): je Reiter und je Unterseite **eine
 * Zeile** hier. Spätere Schritte tauschen ihre Seite aus bzw. tragen ihre Unterseite ein,
 * ohne `album/index.ts` zu ändern.
 */
import type { TabId, PageRef, SubpageKey } from '../nav';
import type { AlbumTarget } from '../cycle-target';
import type { Bookmark } from '../bookmark';
import type { Page } from '../page';
import type { AlbumDeps } from '../types';
import type { EcosystemView } from '../../view-model';
import { createNichesPage } from './niches-page';
import { createSpeciesPage } from './species-page';
import { createCarePage } from './care-page';
import { createGoalsPage } from './goals-page';
import { createLandscapePage } from './landscape-page';
import { createSavePage } from './save-page';
import { createCyclePage } from './cycle-page';
import { createAchievementsPage } from './achievements-page';
import { createStatsPage } from './stats-page';
import { createGuideChapterPage, createGuidePage } from './guide-page';
import { createSettingsPage } from './settings-page';
import { createCareItemPage } from './care-item-page';
import { createAnimalPage } from './animal-page';
import { createFoodWebPage } from './food-web-page';
import { createHarmonyPage } from './harmony-page';
import { createEncounterPage } from './encounter-page';
import { createPlantPickerPage } from './plant-picker-page';

/**
 * Ökosystem-Ansicht für die Seiten: `view` wird bei Änderungen ersetzt bzw. (Zahlen) an
 * Ort und Stelle aufgefrischt; `serial` zählt jede Auffrischung. Seiten vergleichen `serial`
 * und schreiben nur, wenn sich etwas getan hat.
 */
export interface EcoFeed {
  readonly view: EcosystemView | null;
  readonly serial: number;
}

/** Was eine Seite vom Album bekommt. */
export interface PageEnv {
  readonly deps: AlbumDeps;
  /** Eine Ebene zurück (über den Verlauf). */
  back(): void;
  /** Unterseite aufschlagen (Umblättern). */
  open(page: PageRef): void;
  /** Schwebende Bestätigung an Bildschirm-Koordinaten (clientX/Y). */
  float(text: string, x: number, y: number): void;
  /** Ziel des nächsten Zyklus in der Landschaft (D.2 `albumTarget`). */
  readonly albumTarget: AlbumTarget;
  /** Aktuelle Ökosystem-Ansicht (aus dem Game Loop, gedrosselt). */
  readonly eco: EcoFeed;
}

/** Reiterseite (Ebene 0). `update` läuft nur, solange sie sichtbar ist. */
export interface TabPage {
  readonly page: Page;
  /** `force`: sofort (Spielstand geändert, Seite neu gezeigt) statt gedrosselt. */
  update?(now: number, force?: boolean): void;
  /** Punkt am Reiter (G-13); läuft bei jedem Auffrischen, auch verborgen – billig halten. */
  badge?(now: number): boolean;
}

/** Unterseite (Ebene 1–2): eigenes Lesezeichen, je Art einmal gebaut. */
export interface Subpage {
  readonly page: Page;
  readonly bookmark: Bookmark;
  /** Wird beim Öffnen gerufen (Inhalt füllen); `ref` nennt z. B. die Art. */
  opened?(ref: PageRef): void;
  /** `force`: sofort (Spielstand geändert) statt gedrosselt. */
  update?(now: number, force?: boolean): void;
  /** Nach Löschen oder Import des Spielstands: offene Bestätigungen zurücknehmen. */
  reset?(): void;
}

export const TAB_PAGES = {
  niches: createNichesPage,
  species: createSpeciesPage,
  care: createCarePage,
  goals: createGoalsPage,
  landscape: createLandscapePage,
} satisfies Record<TabId, (env: PageEnv) => TabPage>;

export const SUBPAGES = {
  save: createSavePage,
  'care-item': createCareItemPage,
  cycle: createCyclePage,
  achievements: createAchievementsPage,
  stats: createStatsPage,
  animal: createAnimalPage,
  harmony: createHarmonyPage,
  foodweb: createFoodWebPage,
  encounter: createEncounterPage,
  'plant-picker': createPlantPickerPage,
  guide: createGuidePage,
  'guide-chapter': createGuideChapterPage,
  settings: createSettingsPage,
} satisfies Partial<Record<SubpageKey, (env: PageEnv) => Subpage>>;

export type SubpageKind = keyof typeof SUBPAGES;
