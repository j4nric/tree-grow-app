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
  care: 'Forschung',
  goals: 'Ziele',
  landscape: 'Landschaft',
};

/** Hash je Reiter (`#forschung`); beim Neuladen öffnet das Album diesen Reiter. */
export const TAB_HASHES: Readonly<Record<TabId, string>> = {
  niches: 'nischen',
  species: 'arten',
  care: 'forschung',
  goals: 'ziele',
  landscape: 'landschaft',
};

export type PageRef =
  | { kind: 'animal'; id: string }
  | { kind: 'foodweb' }
  | { kind: 'harmony' }
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

/** Schlüssel der Unterseite zu einem Verweis: Kapitel der Anleitung haben eine eigene Seite (Ebene 2). */
export type SubpageKey = PageKind | 'guide-chapter';

export function subpageKey(ref: PageRef): SubpageKey {
  return ref.kind === 'guide' && ref.section ? 'guide-chapter' : ref.kind;
}

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
      // Je Seitenart gibt es ein Blatt (D.1): dieselbe Art mit anderer ID (Tier, Standort …)
      // ersetzt es samt allem darüber.
      // (Inhaltsverzeichnis und Kapitel der Anleitung sind verschiedene Blätter, subpageKey.)
      const sameKind = nav.stack.findIndex((p) => subpageKey(p) === subpageKey(page));
      let stack: PageRef[];
      if (below >= 0) stack = nav.stack.slice(0, below + 1);
      else if (sameKind >= 0) stack = [...nav.stack.slice(0, sameKind), page];
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
      if (nav.tab === 'landscape') return { ...nav, tab: 'niches', stack: nav.cover ? nav.stack : [], note: null };
      // U:Standort kann auch in einem anderen Reiter liegen (Ziele: [cycle, site]) – zuschlagen.
      const site = nav.stack.findIndex((p) => p.kind === 'site');
      if (site < 0) return nav;
      return { ...nav, stack: nav.stack.slice(0, site), note: null };
    }
  }
}

/**
 * Hat ein Schritt eine neue Seite obenauf gelegt (vorwärts oder ersetzt)? Nein, wenn er nur zu
 * einer Seite weiter unten zurückführt („Neuer Zyklus ›“ auf U:Standort über U:Neuer Zyklus):
 * Dann behält die Ebene ihren Auslöser für „Zurück“ (Fokus-Rückgabe, album/index.ts).
 */
export function opensNewPage(prev: AlbumNav, next: AlbumNav): boolean {
  const top = next.stack.length - 1;
  if (top < 0) return false;
  return next.stack.length > prev.stack.length || prev.stack[top] !== next.stack[top];
}

/**
 * Tiefe im Browser-Verlauf: Umschlag, jede Unterseite und das Vollbild legen je einen
 * Eintrag an (C.2), Haftnotizen nicht.
 */
export function historyDepth(nav: AlbumNav): number {
  return (nav.cover ? 1 : 0) + nav.stack.length + (nav.fullscreen ? 1 : 0);
}

/**
 * Frühere Hashes (Lesezeichen): Der Reiter „Pflege“ heißt seit Phase 11, 4a „Forschung“.
 */
const LEGACY_HASHES: Readonly<Record<string, TabId>> = { pflege: 'care' };

/** Hash eines Reiters, z. B. „#forschung“. */
export function hashOf(tab: TabId): string {
  return `#${TAB_HASHES[tab]}`;
}

/**
 * Reiter aus dem Hash: unbekannter Hash → Nischen, Landschaft vor der Freischaltung →
 * Nischen. Groß-/Kleinschreibung egal, mit oder ohne „#“.
 */
export function tabFromHash(hash: string, ctx: NavContext): TabId {
  const key = hash.replace(/^#/, '').trim().toLowerCase();
  const tab = TAB_IDS.find((id) => TAB_HASHES[id] === key) ?? LEGACY_HASHES[key];
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
