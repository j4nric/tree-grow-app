/**
 * Navigationszustand des Albums (docs/ALBUM_UI.md, C.1 und C.2): Reiter, Umschlag,
 * Unterseiten-Stapel (höchstens 2), Vollbild und Haftnotiz. Reine Funktionen ohne DOM –
 * der Zustand ist **kein** Teil des Spielstands und wird mit Vitest geprüft.
 */
import type { SiteId } from '../../content/landscape';

export type TabId = 'niches' | 'species' | 'care' | 'goals' | 'landscape';

/** Reihenfolge der Reiter (Landschaft erst nach der Freischaltung sichtbar). */
export const TAB_IDS: readonly TabId[] = ['niches', 'species', 'care', 'goals', 'landscape'];

export const TAB_LABELS: Readonly<Record<TabId, string>> = {
  niches: 'Nischen',
  species: 'Arten',
  care: 'Pflege',
  goals: 'Ziele',
  landscape: 'Landschaft',
};

/** Hash je Reiter (`#pflege`); beim Neuladen öffnet das Album diesen Reiter. */
export const TAB_HASHES: Readonly<Record<TabId, string>> = {
  niches: 'nischen',
  species: 'arten',
  care: 'pflege',
  goals: 'ziele',
  landscape: 'landschaft',
};

export type PageRef =
  | { kind: 'animal'; id: string }
  | { kind: 'foodweb' }
  | { kind: 'harmony' }
  | { kind: 'plant-picker' }
  | { kind: 'encounter' }
  | { kind: 'care-item'; id: string }
  | { kind: 'cycle' }
  | { kind: 'achievements' }
  | { kind: 'stats' }
  | { kind: 'site'; id: SiteId }
  | { kind: 'return-report' }
  | { kind: 'guide'; section?: string }
  | { kind: 'settings' }
  | { kind: 'account' }
  | { kind: 'save' };

export type PageKind = PageRef['kind'];

export interface AlbumNav {
  tab: TabId;
  /** Umschlag offen (eigene Ebene 0). */
  cover: boolean;
  /** Unterseiten, höchstens MAX_DEPTH Einträge. */
  stack: PageRef[];
  /** Vollbild der Szene. */
  fullscreen: boolean;
  /** ID der offenen Haftnotiz. */
  note: string | null;
}

export type NavAction =
  | { type: 'tab'; tab: TabId }
  | { type: 'open'; page: PageRef }
  | { type: 'back' }
  | { type: 'cover'; open: boolean }
  | { type: 'fullscreen'; open: boolean }
  | { type: 'note'; id: string | null }
  | { type: 'landscape-locked' };

export interface NavContext {
  landscapeUnlocked: boolean;
}

/** Es gibt nie eine Ebene 3: eine dritte Seite ersetzt die oberste. */
export const MAX_DEPTH = 2;

export function initialNav(tab: TabId = 'niches'): AlbumNav {
  return { tab, cover: false, stack: [], fullscreen: false, note: null };
}

/** Zeigen zwei Verweise auf dieselbe Seite (gleiche Art und gleiche ID bzw. gleicher Abschnitt)? */
export function samePage(a: PageRef, b: PageRef): boolean {
  if (a.kind !== b.kind) return false;
  if ('id' in a && 'id' in b) return a.id === b.id;
  if (a.kind === 'guide' && b.kind === 'guide') return a.section === b.section;
  return true;
}

/** Ist der Reiter sichtbar? Landschaft erst nach der Freischaltung. */
export function tabVisible(tab: TabId, ctx: NavContext): boolean {
  return tab !== 'landscape' || ctx.landscapeUnlocked;
}

/** Sichtbare Reiter in ihrer Reihenfolge. */
export function visibleTabs(ctx: NavContext): TabId[] {
  return TAB_IDS.filter((tab) => tabVisible(tab, ctx));
}

/**
 * Nächster Zustand nach einer Aktion (C.1). Ändert sich nichts, kommt dasselbe Objekt
 * zurück – so erkennt der Aufrufer „nichts zu tun“ ohne Vergleich.
 */
export function navigate(nav: AlbumNav, action: NavAction, ctx: NavContext): AlbumNav {
  switch (action.type) {
    case 'tab': {
      if (!tabVisible(action.tab, ctx)) return nav;
      if (nav.tab === action.tab && !nav.cover && nav.stack.length === 0 && nav.note === null && !nav.fullscreen) return nav;
      // Reiterwechsel leert den Stapel und schließt Haftnotiz und Umschlag (G-4).
      return { tab: action.tab, cover: false, stack: [], fullscreen: false, note: null };
    }
    case 'open': {
      const page = action.page;
      const top = nav.stack[nav.stack.length - 1];
      if (top && samePage(top, page)) {
        return nav.note === null && !nav.fullscreen ? nav : { ...nav, note: null, fullscreen: false };
      }
      // Liegt die Seite schon weiter unten: dorthin zurück statt doppelt.
      const below = nav.stack.findIndex((p) => samePage(p, page));
      let stack: PageRef[];
      if (below >= 0) stack = nav.stack.slice(0, below + 1);
      else if (nav.stack.length >= MAX_DEPTH) stack = [...nav.stack.slice(0, MAX_DEPTH - 1), page];
      else stack = [...nav.stack, page];
      // Umblättern schließt die Haftnotiz; „Im Album ansehen“ schließt das Vollbild.
      return { ...nav, stack, note: null, fullscreen: false };
    }
    case 'back': {
      // Reihenfolge: Haftnotiz → Vollbild → oberste Unterseite → Umschlag → nichts.
      if (nav.note !== null) return { ...nav, note: null };
      if (nav.fullscreen) return { ...nav, fullscreen: false };
      if (nav.stack.length > 0) return { ...nav, stack: nav.stack.slice(0, -1) };
      if (nav.cover) return { ...nav, cover: false };
      return nav;
    }
    case 'cover': {
      if (action.open) {
        if (nav.cover && nav.stack.length === 0 && nav.note === null && !nav.fullscreen) return nav;
        // Der Umschlag ist eine eigene Ebene 0: offene Unterseiten des Reiters schließen.
        return { ...nav, cover: true, stack: [], note: null, fullscreen: false };
      }
      if (!nav.cover) return nav;
      return { ...nav, cover: false, stack: [], note: null };
    }
    case 'fullscreen': {
      if (nav.fullscreen === action.open) return nav;
      return { ...nav, fullscreen: action.open, note: null };
    }
    case 'note': {
      if (nav.note === action.id) return nav;
      return { ...nav, note: action.id };
    }
    case 'landscape-locked': {
      if (nav.tab !== 'landscape') return nav;
      return { ...nav, tab: 'niches', stack: nav.cover ? nav.stack : [], note: null };
    }
  }
}

/**
 * Tiefe im Browser-Verlauf: Umschlag, jede Unterseite und das Vollbild legen je einen
 * Eintrag an (C.2), Haftnotizen nicht.
 */
export function historyDepth(nav: AlbumNav): number {
  return (nav.cover ? 1 : 0) + nav.stack.length + (nav.fullscreen ? 1 : 0);
}

/** Hash eines Reiters, z. B. „#pflege“. */
export function hashOf(tab: TabId): string {
  return `#${TAB_HASHES[tab]}`;
}

/**
 * Reiter aus dem Hash: unbekannter Hash → Nischen, Landschaft vor der Freischaltung →
 * Nischen. Groß-/Kleinschreibung egal, mit oder ohne „#“.
 */
export function tabFromHash(hash: string, ctx: NavContext): TabId {
  const key = hash.replace(/^#/, '').trim().toLowerCase();
  const tab = TAB_IDS.find((id) => TAB_HASHES[id] === key);
  if (!tab || !tabVisible(tab, ctx)) return 'niches';
  return tab;
}

/** Feste Seitenzahl je Reiter (Schmuck aus dem Desktop-Mockup, G-26). */
const TAB_PAGE_NUMBERS: Readonly<Record<TabId, number>> = {
  niches: 12,
  species: 24,
  care: 36,
  goals: 48,
  landscape: 60,
};

/** Versatz der Unterseiten zur Seitenzahl ihres Reiters bzw. des Umschlags. */
const SUBPAGE_OFFSETS: Readonly<Record<PageKind, number>> = {
  animal: 1,
  foodweb: 2,
  harmony: 3,
  'plant-picker': 4,
  encounter: 5,
  'care-item': 1,
  cycle: 1,
  achievements: 2,
  stats: 3,
  site: 1,
  'return-report': 7,
  guide: 1,
  settings: 2,
  account: 3,
  save: 4,
};

/**
 * Seitenzahl der sichtbaren Seite: fest aus Reiter (bzw. Umschlag = Seite 2) und
 * Unterseite, damit sie beim Wiederkommen gleich bleibt.
 */
export function pageNumber(nav: Pick<AlbumNav, 'tab' | 'cover' | 'stack'>): number {
  const base = nav.cover ? 2 : TAB_PAGE_NUMBERS[nav.tab];
  const top = nav.stack[nav.stack.length - 1];
  if (!top) return base;
  return base + SUBPAGE_OFFSETS[top.kind] + (nav.stack.length - 1) * 8;
}
