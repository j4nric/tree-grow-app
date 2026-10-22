/**
 * Seiten des Albums (docs/ALBUM_UI.md, D.1 und F): je Reiter und je Unterseite **eine
 * Zeile** hier. Spätere Schritte tauschen ihre Seite aus bzw. tragen ihre Unterseite ein,
 * ohne `album/index.ts` zu ändern.
 */
import type { TabId, PageKind } from '../nav';
import type { Bookmark } from '../bookmark';
import type { Page } from '../page';
import type { AlbumDeps } from '../types';
import { createNichesPage } from './niches-page';
import { createSpeciesPage } from './species-page';
import { createCarePage } from './care-page';
import { createGoalsPage } from './goals-page';
import { createLandscapePage } from './landscape-page';
import { createSavePage } from './save-page';

/** Was eine Seite vom Album bekommt. */
export interface PageEnv {
  readonly deps: AlbumDeps;
  /** Eine Ebene zurück (über den Verlauf). */
  back(): void;
}

/** Reiterseite (Ebene 0). `update` läuft nur, solange sie sichtbar ist. */
export interface TabPage {
  readonly page: Page;
  update?(now: number): void;
}

/** Unterseite (Ebene 1–2): eigenes Lesezeichen, je Art einmal gebaut. */
export interface Subpage {
  readonly page: Page;
  readonly bookmark: Bookmark;
  /** Wird beim Öffnen gerufen (Inhalt füllen). */
  opened?(): void;
  update?(now: number): void;
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
} satisfies Partial<Record<PageKind, (env: PageEnv) => Subpage>>;

export type SubpageKind = keyof typeof SUBPAGES;
