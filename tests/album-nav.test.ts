import { describe, expect, it } from 'vitest';
import {
  MAX_DEPTH,
  TAB_IDS,
  hashOf,
  historyDepth,
  initialNav,
  navigate,
  opensNewPage,
  pageNumber,
  samePage,
  subpageKey,
  tabFromHash,
  visibleTabs,
  type AlbumNav,
  type NavAction,
  type NavContext,
} from '../src/ui/album/nav';

/** Navigationsstapel des Albums (docs/ALBUM_UI.md, C.1 und C.2). */

const open: NavContext = { landscapeUnlocked: true };
const locked: NavContext = { landscapeUnlocked: false };

/** Mehrere Aktionen nacheinander. */
function run(actions: NavAction[], start: AlbumNav = initialNav(), ctx: NavContext = open): AlbumNav {
  return actions.reduce((nav, action) => navigate(nav, action, ctx), start);
}

describe('Unterseiten-Stapel', () => {
  it('öffnet Unterseiten übereinander, höchstens zwei', () => {
    const nav = run([
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
      { type: 'open', page: { kind: 'foodweb' } },
    ]);
    expect(nav.stack).toEqual([{ kind: 'animal', id: 'robin' }, { kind: 'foodweb' }]);
    expect(MAX_DEPTH).toBe(2);
  });

  it('nie Ebene 3: die dritte Seite ersetzt die oberste', () => {
    const nav = run([
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
      { type: 'open', page: { kind: 'foodweb' } },
      { type: 'open', page: { kind: 'harmony' } },
    ]);
    expect(nav.stack).toEqual([{ kind: 'animal', id: 'robin' }, { kind: 'harmony' }]);
    expect(nav.stack.length).toBeLessThanOrEqual(MAX_DEPTH);
  });

  it('je Seitenart ein Blatt: dieselbe Art mit anderer ID ersetzt sie samt allem darüber', () => {
    const top = run([
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
      { type: 'open', page: { kind: 'animal', id: 'owl' } },
    ]);
    expect(top.stack).toEqual([{ kind: 'animal', id: 'owl' }]);
    const below = run([
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
      { type: 'open', page: { kind: 'foodweb' } },
      { type: 'open', page: { kind: 'animal', id: 'owl' } },
    ]);
    expect(below.stack).toEqual([{ kind: 'animal', id: 'owl' }]);
    // Aus dem Vollbild: schließt es und ersetzt die offene Tierseite.
    const fromScene = navigate(
      run([{ type: 'open', page: { kind: 'animal', id: 'robin' } }, { type: 'fullscreen', open: true }]),
      { type: 'open', page: { kind: 'animal', id: 'owl' } },
      open,
    );
    expect(fromScene).toMatchObject({ fullscreen: false, stack: [{ kind: 'animal', id: 'owl' }] });
  });

  it('dieselbe Seite oben: keine Änderung (gleiches Objekt)', () => {
    const nav = run([{ type: 'open', page: { kind: 'harmony' } }]);
    expect(navigate(nav, { type: 'open', page: { kind: 'harmony' } }, open)).toBe(nav);
  });

  it('eine weiter unten liegende Seite: dorthin zurück statt doppelt', () => {
    const nav = run([
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
      { type: 'open', page: { kind: 'foodweb' } },
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
    ]);
    expect(nav.stack).toEqual([{ kind: 'animal', id: 'robin' }]);
  });

  it('Begegnung legt sich auf eine offene Unterseite, bei vollem Stapel ersetzt sie die oberste', () => {
    const one = run([
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
      { type: 'open', page: { kind: 'encounter' } },
    ]);
    expect(one.stack.map((p) => p.kind)).toEqual(['animal', 'encounter']);
    const full = run([
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
      { type: 'open', page: { kind: 'foodweb' } },
      { type: 'open', page: { kind: 'encounter' } },
    ]);
    expect(full.stack.map((p) => p.kind)).toEqual(['animal', 'encounter']);
  });

  it('Umblättern schließt die Haftnotiz und das Vollbild', () => {
    const nav = run([
      { type: 'fullscreen', open: true },
      { type: 'note', id: 'animal-robin' },
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
    ]);
    expect(nav.note).toBeNull();
    expect(nav.fullscreen).toBe(false);
    expect(nav.stack).toHaveLength(1);
  });
});

describe('Reiterwechsel', () => {
  it('leert den Stapel und schließt Haftnotiz und Umschlag', () => {
    const nav = run([
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
      { type: 'note', id: 'harmony' },
      { type: 'tab', tab: 'care' },
    ]);
    expect(nav).toEqual({ tab: 'care', cover: false, stack: [], fullscreen: false, note: null });
    const fromCover = run([{ type: 'cover', open: true }, { type: 'tab', tab: 'goals' }]);
    expect(fromCover.cover).toBe(false);
    expect(fromCover.tab).toBe('goals');
  });

  it('derselbe Reiter ohne offene Ebenen: keine Änderung', () => {
    const nav = initialNav('species');
    expect(navigate(nav, { type: 'tab', tab: 'species' }, open)).toBe(nav);
  });

  it('Landschaft vor der Freischaltung lässt sich nicht wählen', () => {
    const nav = initialNav();
    expect(navigate(nav, { type: 'tab', tab: 'landscape' }, locked)).toBe(nav);
    expect(navigate(nav, { type: 'tab', tab: 'landscape' }, open).tab).toBe('landscape');
  });

  it('Sprung in einen anderen Reiter mit Unterseite: erst Reiter, dann Umblättern', () => {
    const nav = run([
      { type: 'tab', tab: 'landscape' },
      { type: 'tab', tab: 'goals' },
      { type: 'open', page: { kind: 'cycle' } },
    ]);
    expect(nav.tab).toBe('goals');
    expect(nav.stack).toEqual([{ kind: 'cycle' }]);
  });

  it('Landschaft verschwindet (z. B. Import eines älteren Stands): zurück zu Nischen', () => {
    const nav = run([{ type: 'tab', tab: 'landscape' }, { type: 'open', page: { kind: 'site', id: 'floodplain' } }]);
    const after = navigate(nav, { type: 'landscape-locked' }, locked);
    expect(after.tab).toBe('niches');
    expect(after.stack).toEqual([]);
    const elsewhere = initialNav('care');
    expect(navigate(elsewhere, { type: 'landscape-locked' }, locked)).toBe(elsewhere);
  });

  it('Landschaft verschwindet, während U:Standort auf dem Stapel von „Ziele“ liegt: zuklappen', () => {
    const nav = run([{ type: 'tab', tab: 'goals' }, { type: 'open', page: { kind: 'cycle' } }, { type: 'open', page: { kind: 'site', id: 'home' } }]);
    const after = navigate(nav, { type: 'landscape-locked' }, locked);
    expect(after.tab).toBe('goals');
    expect(after.stack).toEqual([{ kind: 'cycle' }]);
    // Ohne Standort auf dem Stapel ändert sich nichts.
    expect(navigate(after, { type: 'landscape-locked' }, locked)).toBe(after);
  });
});

describe('Zurück', () => {
  it('Reihenfolge: Haftnotiz → Vollbild → Unterseite → Umschlag → nichts', () => {
    let nav = run([
      { type: 'cover', open: true },
      { type: 'open', page: { kind: 'save' } },
      { type: 'fullscreen', open: true },
      { type: 'note', id: 'weather' },
    ]);
    expect(nav).toMatchObject({ cover: true, fullscreen: true, note: 'weather' });
    expect(nav.stack).toHaveLength(1);

    nav = navigate(nav, { type: 'back' }, open);
    expect(nav).toMatchObject({ note: null, fullscreen: true, cover: true });
    nav = navigate(nav, { type: 'back' }, open);
    expect(nav).toMatchObject({ fullscreen: false, cover: true });
    expect(nav.stack).toHaveLength(1);
    nav = navigate(nav, { type: 'back' }, open);
    expect(nav.stack).toHaveLength(0);
    expect(nav.cover).toBe(true);
    nav = navigate(nav, { type: 'back' }, open);
    expect(nav.cover).toBe(false);
    expect(navigate(nav, { type: 'back' }, open)).toBe(nav);
  });

  it('zwei Unterseiten: zuerst die oberste', () => {
    let nav = run([
      { type: 'open', page: { kind: 'animal', id: 'robin' } },
      { type: 'open', page: { kind: 'foodweb' } },
    ]);
    nav = navigate(nav, { type: 'back' }, open);
    expect(nav.stack).toEqual([{ kind: 'animal', id: 'robin' }]);
  });
});

describe('Umschlag', () => {
  it('ist eine eigene Ebene 0: Öffnen schließt offene Unterseiten des Reiters', () => {
    const nav = run([{ type: 'open', page: { kind: 'animal', id: 'robin' } }, { type: 'cover', open: true }]);
    expect(nav.cover).toBe(true);
    expect(nav.stack).toEqual([]);
  });

  it('Schließen nimmt seine Unterseiten mit; zu bleibt zu', () => {
    const nav = run([{ type: 'cover', open: true }, { type: 'open', page: { kind: 'save' } }, { type: 'cover', open: false }]);
    expect(nav.cover).toBe(false);
    expect(nav.stack).toEqual([]);
    expect(navigate(nav, { type: 'cover', open: false }, open)).toBe(nav);
  });
});

describe('Verlauf und Hash', () => {
  it('Tiefe im Verlauf: Umschlag, Unterseiten und Vollbild, keine Haftnotiz', () => {
    expect(historyDepth(initialNav())).toBe(0);
    const nav = run([
      { type: 'cover', open: true },
      { type: 'open', page: { kind: 'save' } },
      { type: 'note', id: 'x' },
    ]);
    expect(historyDepth(nav)).toBe(2);
    expect(historyDepth(navigate(nav, { type: 'fullscreen', open: true }, open))).toBe(3);
  });

  it('Hash ↔ Reiter', () => {
    for (const tab of TAB_IDS) expect(tabFromHash(hashOf(tab), open)).toBe(tab);
    expect(hashOf('care')).toBe('#pflege');
    expect(tabFromHash('#Ziele', open)).toBe('goals');
    expect(tabFromHash('arten', open)).toBe('species');
  });

  it('unbekannter Hash oder gesperrte Landschaft → Nischen', () => {
    expect(tabFromHash('', open)).toBe('niches');
    expect(tabFromHash('#quatsch', open)).toBe('niches');
    expect(tabFromHash('#landschaft', locked)).toBe('niches');
  });

  it('sichtbare Reiter: Landschaft erst nach der Freischaltung', () => {
    expect(visibleTabs(locked)).toEqual(['niches', 'species', 'care', 'goals']);
    expect(visibleTabs(open)).toEqual(TAB_IDS);
  });
});

describe('samePage und Seitenzahlen', () => {
  it('vergleicht Art und ID bzw. Abschnitt', () => {
    expect(samePage({ kind: 'animal', id: 'a' }, { kind: 'animal', id: 'a' })).toBe(true);
    expect(samePage({ kind: 'animal', id: 'a' }, { kind: 'animal', id: 'b' })).toBe(false);
    expect(samePage({ kind: 'guide', section: 'x' }, { kind: 'guide', section: 'y' })).toBe(false);
    expect(samePage({ kind: 'stats' }, { kind: 'achievements' })).toBe(false);
  });

  it('feste Seitenzahl je Seite, verschieden je Reiter', () => {
    const numbers = TAB_IDS.map((tab) => pageNumber(initialNav(tab)));
    expect(new Set(numbers).size).toBe(TAB_IDS.length);
    expect(pageNumber(initialNav('niches'))).toBe(12);
    const sub = run([{ type: 'open', page: { kind: 'harmony' } }]);
    expect(pageNumber(sub)).toBe(pageNumber(sub));
    expect(pageNumber(sub)).not.toBe(12);
  });
});

describe('Spielanleitung im Umschlag (Schritt 11)', () => {
  it('Inhaltsverzeichnis und Kapitel sind verschiedene Seiten', () => {
    expect(subpageKey({ kind: 'guide' })).toBe('guide');
    expect(subpageKey({ kind: 'guide', section: 'growth' })).toBe('guide-chapter');
    expect(subpageKey({ kind: 'settings' })).toBe('settings');
    expect(subpageKey({ kind: 'animal', id: 'x' })).toBe('animal');
  });

  it('Umschlag → Anleitung → Kapitel; Weiterblättern ersetzt das Kapitel, Zurück führt zum Verzeichnis', () => {
    let nav = navigate(initialNav(), { type: 'cover', open: true }, open);
    nav = navigate(nav, { type: 'open', page: { kind: 'guide' } }, open);
    nav = navigate(nav, { type: 'open', page: { kind: 'guide', section: 'growth' } }, open);
    expect(nav.stack).toEqual([{ kind: 'guide' }, { kind: 'guide', section: 'growth' }]);
    nav = navigate(nav, { type: 'open', page: { kind: 'guide', section: 'encounters' } }, open);
    expect(nav.stack).toEqual([{ kind: 'guide' }, { kind: 'guide', section: 'encounters' }]);
    expect(historyDepth(nav)).toBe(3);
    nav = navigate(nav, { type: 'back' }, open);
    expect(nav.stack).toEqual([{ kind: 'guide' }]);
    nav = navigate(nav, { type: 'back' }, open);
    expect(nav).toMatchObject({ cover: true, stack: [] });
  });
});

describe('opensNewPage (Fokus-Rückgabe, Schritt 12)', () => {
  const ctx: NavContext = { landscapeUnlocked: true };
  it('vorwärts und ersetzt: neue Seite; zurück zu einer Seite weiter unten: keine', () => {
    let nav = initialNav('goals');
    const cycle = navigate(nav, { type: 'open', page: { kind: 'cycle' } }, ctx);
    expect(opensNewPage(nav, cycle)).toBe(true);
    const site = navigate(cycle, { type: 'open', page: { kind: 'site', id: 'floodplain' } }, ctx);
    expect(opensNewPage(cycle, site)).toBe(true);
    // Anderer Standort ersetzt das Blatt: neuer Auslöser.
    const other = navigate(site, { type: 'open', page: { kind: 'site', id: 'carr' } }, ctx);
    expect(other.stack).toHaveLength(2);
    expect(opensNewPage(site, other)).toBe(true);
    // „Neuer Zyklus ›“ auf U:Standort: zurück zu U:Neuer Zyklus – dessen Auslöser bleibt.
    const back = navigate(other, { type: 'open', page: { kind: 'cycle' } }, ctx);
    expect(back.stack).toEqual([{ kind: 'cycle' }]);
    expect(opensNewPage(other, back)).toBe(false);
    nav = navigate(back, { type: 'back' }, ctx);
    expect(opensNewPage(back, nav)).toBe(false);
  });
});
