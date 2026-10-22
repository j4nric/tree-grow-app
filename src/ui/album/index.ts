/**
 * Album-Oberfläche (docs/ALBUM_UI.md): baut alles einmal auf und ist der einzige Einstieg
 * für main.ts. main.ts ruft `refresh(now)` im Game Loop, meldet Änderungen mit
 * `invalidate(...)` und Hinweise mit `notify(text)`; Spieleraktionen kommen über
 * `deps.actions` zurück.
 *
 * Hier: Buch, Doppelseite/Einzelseite, Reiter, Umschlag, Umblättern, Verlauf und Hash,
 * Polaroid mit Vollbild der Szene, Etiketten und Stufenleiste, Haftnotizen, Stempel und
 * Banderolen. Die bisherigen Bauteile hängen bis zu ihrem Schritt als Übergangsinhalt in den
 * Reitern (legacy.ts).
 */
import { LANDSCAPE_SITES } from '../../content/landscape';
import { evaluate } from '../../core/formulas';
import { activeSite, landscapeUnlocked } from '../../core/landscape';
import { toAnimalDetailView, type AnimalDetailTarget } from '../animal-detail-view';
import { el } from '../dom';
import { restartAnimation } from '../feedback';
import { formatNumber, formatRate } from '../format';
import { toSeasonBadgeView } from '../season-view';
import { formatMultiplier, formatPercent } from '../view-format';
import type { EcosystemView } from '../view-model';
import { nightRateText } from '../weather-view';
import { createBook } from './book';
import { createCover } from './cover';
import { createAlbumTarget } from './cycle-target';
import { createBanderole } from './banderole';
import { createFullscreen } from './fullscreen';
import { createAlbumHistory } from './history';
import { createLabelNotes } from './label-notes';
import { createLegacyUi, type LegacyUi } from './legacy';
import { closeNotes, onNoteChange, openNote, openNoteId } from './note';
import {
  TAB_IDS,
  TAB_LABELS,
  hashOf,
  historyDepth,
  initialNav,
  navigate,
  tabFromHash,
  type AlbumNav,
  type NavAction,
  type NavContext,
  type PageRef,
  type TabId,
} from './nav';
import { TURNED_AWAY, createPageTurn } from './page-turn';
import type { CyclePage } from './pages/cycle-page';
import { SUBPAGES, TAB_PAGES, type PageEnv, type Subpage } from './pages/registry';
import { createPolaroid } from './polaroid';
import { createSpread } from './spread';
import { createStageLadder } from './stage-ladder';
import { createStamps } from './stamps';
import { createTabStrip } from './tab-strip';
import { createTapeLabel } from './tape-label';
import type { AlbumDeps } from './types';

export type { AlbumDeps, AlbumActions, AlbumPart } from './types';
export type { NotifyOptions } from './stamp-rules';
export { openNote, type Note, type NoteContent, type NoteMore } from './note';

export interface Album extends LegacyUi {
  /** Platz für die Kamera-Leiste (im Vollbild unten rechts). */
  readonly sceneFrame: HTMLElement;
  /** Platz für Banderolen über dem Album (Update-Hinweis aus pwa.ts). */
  readonly banners: HTMLElement;
  /**
   * Vollbild aufgezogen (bis zum Ende des Zuziehens): Kamera bedienbar, Szene mit
   * Kamera-Ansicht. Während des Aufziehens noch nicht – das Bild kommt aus dem Polaroid.
   */
  readonly fullscreen: boolean;
  /**
   * Ist die Szene zu sehen? Nein, wenn das Polaroid weggescrollt oder (mobil) von einer
   * Unterseite verdeckt ist und kein Vollbild offen ist – dann zeichnet der Game Loop nicht.
   */
  readonly sceneVisible: boolean;
  /** Tier in der Szene angetippt (Treffer-Test, nur im Vollbild): Haftnotiz zum Tier. */
  showSceneAnimal(target: AnimalDetailTarget): void;
  /** Dauerhafter Hinweis: Im Speicher liegt ein Stand einer neueren Spielversion. */
  showNewerSaveBanner(text: string): void;
  /** Nach dem Neuen Zyklus: zurück zu „Ziele“, Fokus auf die Überschrift (der Knopf ist weg). */
  focusCycle(): void;
  /** Aktueller Navigationszustand (nur lesen; für Tests und Fehlersuche). */
  readonly nav: Readonly<AlbumNav>;
}

export function createAlbum(deps: AlbumDeps): Album {
  const ctx: NavContext = { landscapeUnlocked: landscapeUnlocked(deps.state()) };
  let nav: AlbumNav = initialNav(tabFromHash(location.hash, ctx));
  const turn = createPageTurn({ reducedMotion: () => deps.preferences.reducedMotion });
  /** Eingaben während des Blätterns – danach der Reihe nach (C.3). */
  const queue: (() => void)[] = [];
  /** Auslösender Knopf je Ebene: bekommt nach „Zurück“ den Fokus. */
  const triggers: (HTMLElement | null)[] = [];

  // --- Aufbau ---------------------------------------------------------------------------
  const tabStrip = createTabStrip((tab) => dispatch({ type: 'tab', tab }));
  const spread = createSpread(tabStrip.element);
  const cover = createCover({
    onClose: () => goBackTo((n) => !n.cover),
    onOpenSave: () => dispatch({ type: 'open', page: { kind: 'save' } }),
  });
  const book = createBook(spread, cover.element, () => dispatch({ type: 'cover', open: !nav.cover }));
  // Ziel des nächsten Zyklus: Karte der Landschaft ↔ U:Neuer Zyklus (D.2).
  const albumTarget = createAlbumTarget((id) => deps.actions.buildCorridor(id));
  const env: PageEnv = {
    deps,
    back: () => goBack(),
    open: (page) => dispatch({ type: 'open', page }),
    albumTarget,
  };

  // Linke Seite: Polaroid, Etiketten, Stufenleiste, Rückkehr-Bericht.
  const polaroid = createPolaroid(deps.canvas, () => dispatch({ type: 'fullscreen', open: true }));
  const labels = el('div', 'tape-labels');
  const growth = createTapeLabel('growth', 'Wachstum', 'growth-rate');
  const seeds = createTapeLabel('seeds', 'Samen', 'seeds');
  const harmony = createTapeLabel('harmony', 'Harmonie', 'harmony', true);
  labels.append(growth.element, seeds.element, harmony.element);
  const labelNotes = createLabelNotes(
    { growth, seeds, harmony },
    // „Mehr ›“ erst, wenn es U:Harmonie gibt (Schritt 5).
    { onMore: () => dispatch({ type: 'open', page: { kind: 'harmony' } }), available: () => subpages.has('harmony') },
  );
  const ladder = createStageLadder();
  const returnMount = el('div', 'album-return panel');
  returnMount.id = 'return-report';
  spread.left.append(polaroid.element, labels, ladder.element, returnMount);

  // Reiterseiten (eine Zeile je Seite in pages/registry.ts).
  const tabs = {
    niches: TAB_PAGES.niches(env),
    species: TAB_PAGES.species(env),
    care: TAB_PAGES.care(env),
    goals: TAB_PAGES.goals(env),
    landscape: TAB_PAGES.landscape(env),
  };
  for (const id of TAB_IDS) {
    const page = tabs[id].page;
    page.element.setAttribute('aria-labelledby', tabStrip.button(id).id);
    page.element.removeAttribute('aria-label');
    page.element.hidden = id !== nav.tab;
    spread.right.append(page.element);
  }
  tabStrip.select(nav.tab);
  tabStrip.setVisible('landscape', ctx.landscapeUnlocked);
  tabStrip.element.querySelector('.tab-landscape')?.classList.remove('tab-new');

  // Unterseiten: je Art einmal gebaut, liegen verborgen in der Ablage.
  const subpages = new Map<string, Subpage>();
  const savePage = SUBPAGES.save(env);
  subpages.set('save', savePage);
  const cyclePage: CyclePage = SUBPAGES.cycle(env);
  subpages.set('cycle', cyclePage);
  subpages.set('achievements', SUBPAGES.achievements(env));
  subpages.set('stats', SUBPAGES.stats(env));
  for (const sub of subpages.values()) {
    sub.page.element.hidden = true;
    spread.sub.append(sub.page.element);
  }

  document.body.prepend(book.element);
  // Stempel und Zettel (C.5): über dem Album, auch über Unterseiten.
  const stamps = createStamps(
    () => deps.preferences.toastMs(),
    () => deps.preferences.reducedMotion,
    book.banners,
  );
  book.element.after(stamps.element);

  const legacy = createLegacyUi(
    deps,
    {
      ...tabs,
      season: polaroid.season,
      photo: polaroid.stamps,
      returnReport: returnMount,
      albumTarget,
      coverMenu: cover.menu,
      hint: book.headStart,
      coverButton: book.coverButton,
      dock: book.dock,
    },
    {
      onEcosystem: showSummary,
      onLandscape(unlocked) {
        if (ctx.landscapeUnlocked === unlocked) return;
        ctx.landscapeUnlocked = unlocked;
        tabStrip.setVisible('landscape', unlocked);
        if (!unlocked) dispatch({ type: 'landscape-locked' });
      },
      showCareTab: () => dispatch({ type: 'tab', tab: 'care' }),
      focusTarget,
      stamp: (text, options) => stamps.show(text, options),
    },
  );
  // Haftnotizen (C.4): offene Notiz steht in nav.note; Navigation schließt sie.
  onNoteChange((id) => dispatch({ type: 'note', id }));

  // --- Szene: Vollbild, Haftnotiz zum Tier, Sichtbarkeit (C.6, D.3) ----------------------
  const fullscreen = createFullscreen({
    canvas: deps.canvas,
    home: polaroid.button,
    stamps: polaroid.stamps,
    background: book.element,
    reducedMotion: () => deps.preferences.reducedMotion,
    onClose: () => goBack(),
  });
  /**
   * Anker der Tier-Notiz im Vollbild: unsichtbar an der zuletzt angetippten Stelle (der
   * Treffer-Test meldet nur das Tier, nicht den Punkt).
   */
  const sceneAnchor = el('span', 'scene-note-anchor');
  sceneAnchor.setAttribute('aria-hidden', 'true');
  sceneAnchor.tabIndex = -1;
  fullscreen.element.append(sceneAnchor);
  let lastTap: { x: number; y: number } | null = null;
  fullscreen.element.addEventListener('pointerdown', (event) => (lastTap = { x: event.clientX, y: event.clientY }), true);
  /** Polaroid im Bild? (IntersectionObserver statt Messung je Frame) */
  let polaroidInView = true;
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) polaroidInView = entry.isIntersecting;
    }).observe(polaroid.photo);
  }

  function showSceneAnimal(target: AnimalDetailTarget): void {
    const state = deps.state();
    const view = toAnimalDetailView(state, target, evaluate(state));
    if (!view) return;
    if (!fullscreen.open) {
      legacy.openAnimalDetail(target, polaroid.button);
      return;
    }
    const frame = fullscreen.element.getBoundingClientRect();
    const tap = lastTap ?? { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
    sceneAnchor.style.left = `${Math.round(tap.x - frame.left)}px`;
    sceneAnchor.style.top = `${Math.round(tap.y - frame.top)}px`;
    // Erst das Vollbild, dann die Notiz: `fullscreen: true` leert nav.note (C.1).
    openNote(sceneAnchor, {
      title: view.name,
      lines: [`😊 ${formatPercent(view.happiness)} zufrieden · ${view.mood}`],
      more: {
        label: 'Im Album ansehen ›',
        onMore() {
          // Die Notiz ist schon zu; Vollbild schließen (über den Verlauf), dann die Tierdetails.
          if (nav.fullscreen) goBack();
          legacy.openAnimalDetail(target, polaroid.button);
        },
      },
    });
  }

  setOrientation();
  book.onLayoutChange(() => {
    setOrientation();
    // Weggedrehte Seite gehört zum alten Layout (mobil: Hauptansicht, Doppelseite: rechte
    // Seite): neu setzen – während einer Drehung erst danach.
    whenIdle(settleTurns);
  });

  // --- Verlauf, Hash, Tastatur -----------------------------------------------------------
  const albumHistory = createAlbumHistory({
    onBack(depth) {
      // Während des Blätterns vormerken (sonst liefen zwei Drehungen zugleich).
      whenIdle(() => {
        let next = nav;
        for (let guard = 0; historyDepth(next) > depth && guard < 8; guard++) {
          const back = navigate(next, { type: 'back' }, ctx);
          if (back === next) break;
          next = back;
        }
        if (next !== nav) commit(next, false);
      });
    },
  });
  albumHistory.setHash(hashOf(nav.tab));
  window.addEventListener('hashchange', () => {
    const tab = tabFromHash(location.hash, ctx);
    if (tab !== nav.tab || historyDepth(nav) > 0) dispatch({ type: 'tab', tab });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Offene Dialoge (Kartenwahl, Anleitung …) schließen sich selbst.
    if (document.querySelector('dialog[open]')) return;
    if (nav.note === null && historyDepth(nav) === 0) return;
    goBack();
  });

  // --- Navigation -----------------------------------------------------------------------

  /** Läuft eine Animation (Umblättern oder Auf-/Zuziehen des Vollbilds)? */
  function busy(): boolean {
    return turn.busy || fullscreen.moving;
  }

  /** Sofort ausführen oder – während des Blätterns bzw. des Vollbild-FLIP – vormerken (C.3). */
  function whenIdle(task: () => void): void {
    if (busy()) queue.push(task);
    else task();
  }

  function dispatch(action: NavAction): void {
    if (busy()) {
      queue.push(() => dispatch(action));
      return;
    }
    if (action.type === 'open' && !subpages.has(action.page.kind)) return;
    const next = navigate(nav, action, ctx);
    if (next === nav) return;
    if (action.type === 'open') triggers[next.stack.length - 1] = activeButton();
    commit(next, true);
  }

  /** Eine Ebene zurück: Haftnotizen direkt, sonst über den Verlauf (C.2). */
  function goBack(): void {
    if (nav.note !== null || albumHistory.depth === 0) {
      dispatch({ type: 'back' });
      return;
    }
    albumHistory.back();
  }

  /** Zurück, bis `done` gilt (z. B. Umschlag zu). */
  function goBackTo(done: (nav: AlbumNav) => boolean): void {
    if (busy()) {
      queue.push(() => goBackTo(done));
      return;
    }
    if (done(nav)) return;
    let next = nav;
    for (let guard = 0; !done(next) && guard < 8; guard++) next = navigate(next, { type: 'back' }, ctx);
    if (albumHistory.depth > 0) albumHistory.sync(historyDepth(next));
    commit(next, false);
  }

  function activeButton(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  }

  function commit(next: AlbumNav, record: boolean): void {
    const prev = nav;
    nav = next;
    if (record) albumHistory.sync(historyDepth(next));
    if (prev.tab !== next.tab) albumHistory.setHash(hashOf(next.tab));
    void render(prev, next).finally(drain);
  }

  /** Vorgemerkte Eingaben der Reihe nach, bis wieder eine Drehung läuft. */
  function drain(): void {
    while (!busy()) {
      const task = queue.shift();
      if (!task) return;
      task();
    }
  }

  /** Element einer Ebene: 0 = Hauptansicht bzw. Umschlag, sonst die Unterseite. */
  function levelElement(state: AlbumNav, level: number): HTMLElement {
    if (level > 0) return subpageOf(state.stack[level - 1]!)!.page.element;
    if (book.layout === 'spread') return spread.right;
    return state.cover ? cover.element : spread.main;
  }

  function subpageOf(ref: PageRef): Subpage | undefined {
    return subpages.get(ref.kind);
  }

  async function render(prev: AlbumNav, next: AlbumNav): Promise<void> {
    if (next.note === null && openNoteId() !== null) closeNotes();
    if (prev.fullscreen !== next.fullscreen) await fullscreen.setOpen(next.fullscreen);
    if (prev.tab !== next.tab) showTab(next.tab);
    if (prev.cover !== next.cover) {
      cover.setOpen(next.cover, !deps.preferences.reducedMotion);
      book.coverButton.setAttribute('aria-expanded', String(next.cover));
      if (next.cover) cover.title.focus({ preventScroll: true });
      else if (next.stack.length === 0 && cover.element.contains(document.activeElement)) book.coverButton.focus();
    }
    const a = prev.stack;
    const b = next.stack;
    const prefix = (short: PageRef[], long: PageRef[]) => short.every((p, i) => long[i] === p);
    const coverSame = prev.cover === next.cover;
    if (coverSame && b.length === a.length + 1 && prefix(a, b)) {
      // Vorwärts: neue Seite darunterlegen, aktuelle Seite wegdrehen.
      const sub = subpageOf(b[b.length - 1]!)!;
      fillSubpage(sub, next, b.length);
      spread.sub.hidden = false;
      lockScroll();
      await turn.forward(levelElement(next, b.length - 1), sub.page.element);
      sub.page.focusTitle();
    } else if (coverSame && a.length === b.length + 1 && prefix(b, a)) {
      // Zurück: verlassene Seite dreht sich über die Unterseite zurück.
      const sub = subpageOf(a[a.length - 1]!)!;
      await turn.back(levelElement(next, b.length), sub.page.element);
      if (b.length === 0) spread.sub.hidden = true;
      lockScroll();
      const trigger = triggers[b.length];
      triggers.length = b.length;
      if (trigger?.isConnected && !trigger.closest('[inert], [hidden]')) trigger.focus({ preventScroll: true });
      else focusTarget()?.focus({ preventScroll: true });
    } else if (a !== b) {
      // Ersetzt oder geleert (Reiterwechsel, Umschlag): ohne Umblättern.
      const top = b[b.length - 1];
      if (top) fillSubpage(subpageOf(top)!, next, b.length);
      settleTurns();
    }
  }

  /**
   * Ruhezustand ohne Animation: oberste Unterseite sichtbar, alle Ebenen darüber weggedreht
   * und nicht bedienbar. Nach Ersetzen/Leeren des Stapels und nach einem Layoutwechsel.
   */
  function settleTurns(): void {
    resetTurns();
    const top = nav.stack[nav.stack.length - 1];
    for (const sub of subpages.values()) sub.page.element.hidden = true;
    if (top) {
      subpageOf(top)!.page.element.hidden = false;
      for (let level = 0; level < nav.stack.length; level++) {
        const element = levelElement(nav, level);
        element.hidden = false;
        element.classList.add(TURNED_AWAY);
        element.inert = true;
      }
    }
    spread.sub.hidden = !top;
    lockScroll();
  }

  function fillSubpage(sub: Subpage, state: AlbumNav, level: number): void {
    const below = level > 1 ? subpageOf(state.stack[level - 2]!)?.page.title.textContent : null;
    sub.bookmark.setLabel(below ?? (state.cover ? 'Umschlag' : TAB_LABELS[state.tab]));
    sub.opened?.();
  }

  /** Alle weggedrehten Seiten wieder hinlegen (ohne Animation). */
  function resetTurns(): void {
    for (const node of [spread.main, spread.right, cover.element, ...[...subpages.values()].map((s) => s.page.element)]) {
      node.classList.remove(TURNED_AWAY);
      node.inert = false;
    }
  }

  /** Mobil: Solange eine Unterseite offen ist, scrollt nur sie (die Lage der Hauptseite bleibt). */
  function lockScroll(): void {
    const lock = book.layout === 'single' && nav.stack.length > 0;
    document.documentElement.classList.toggle('album-sub-open', lock);
  }

  function showTab(tab: TabId): void {
    // Gleich befüllen (auch wenn der Game Loop gerade steht, z. B. mit angehaltener Testuhr).
    queueMicrotask(() => refreshPages(performance.now()));
    tabStrip.select(tab);
    for (const id of TAB_IDS) {
      const page = tabs[id].page.element;
      const show = id === tab;
      if (page.hidden === !show) continue;
      page.hidden = !show;
      if (show) restartAnimation(page, 'tab-fade');
    }
  }

  function setOrientation(): void {
    tabStrip.setOrientation(book.layout === 'spread' ? 'vertical' : 'horizontal');
  }

  function focusTarget(): HTMLElement | null {
    const top = nav.stack[nav.stack.length - 1];
    if (top) return subpageOf(top)?.page.title ?? null;
    if (nav.cover) return cover.title;
    return tabs[nav.tab].page.title;
  }

  // --- Linke Seite: Bildunterschrift, Etiketten, Stufenleiste -----------------------------
  let lastHarmony: number | null = null;
  let shownSite = '';

  function showSummary(view: EcosystemView): void {
    const state = deps.state();
    polaroid.setStage(view.stageName);
    const season = toSeasonBadgeView(state.cycle.elapsed);
    fullscreen.setCaption(view.stageName, `${season.icon} ${season.name}`);
    growth.setValue(formatRate(view.growthPerSec));
    growth.setTitle(`mit ⚖️ ${formatMultiplier(view.harmonyMultiplier)}`);
    growth.setNight(nightRateText(view.night.growth));
    seeds.setValue(formatNumber(Math.floor(view.seeds)));
    seeds.setSub(`+${formatRate(view.seedsPerSec)}`);
    seeds.setNight(nightRateText(view.night.seeds));
    const harmonyRounded = Math.round(view.harmony);
    harmony.setValue(formatNumber(harmonyRounded));
    harmony.setTitle(view.harmonyTier);
    if (lastHarmony !== null && harmonyRounded > lastHarmony) harmony.pop();
    lastHarmony = harmonyRounded;
    labelNotes.update(view);
    ladder.update({ stage: state.stage, waypoint: state.waypoint, waypointProgress: view.stageProgress, hint: view.progressHint });
    const site = activeSite(state.meta.landscape);
    if (site !== shownSite) {
      shownSite = site;
      book.setForestName(LANDSCAPE_SITES.find((s) => s.id === site)?.name ?? '');
    }
  }

  // --- Seiten aktualisieren (D.1: nur die sichtbare) ------------------------------------

  /** Spielstand geändert oder andere Seite gezeigt: sichtbare Seite sofort (ungedrosselt) nachziehen. */
  let pagesDirty = true;
  let shownPage: object | null = null;

  function refreshPages(now: number): void {
    for (const id of TAB_IDS) {
      const dot = tabs[id].dot;
      if (dot) tabStrip.setDot(id, dot());
    }
    const top = nav.stack[nav.stack.length - 1];
    const visible = top ? subpageOf(top) : nav.cover ? undefined : tabs[nav.tab];
    const force = pagesDirty || visible !== shownPage;
    pagesDirty = false;
    shownPage = visible ?? null;
    visible?.update?.(now, force);
  }

  // --- Schnittstelle für main.ts ---------------------------------------------------------
  return {
    ...legacy,
    refresh(now) {
      legacy.refresh(now);
      refreshPages(now);
    },
    invalidate(parts) {
      legacy.invalidate(parts);
      pagesDirty = true;
    },
    focusCycle() {
      if (nav.stack.some((p) => p.kind === 'cycle')) {
        // Zurück zu „Ziele“; danach Fokus auf deren Überschrift statt auf „Vorbereiten ›“.
        triggers.length = 0;
        goBackTo((n) => n.stack.length === 0);
        whenIdle(() => tabs[nav.tab].page.focusTitle());
      } else if (!nav.cover) {
        tabs[nav.tab].page.focusTitle();
      }
    },
    sceneFrame: fullscreen.tools,
    banners: book.banners,
    get nav() {
      return nav;
    },
    get fullscreen() {
      return fullscreen.open;
    },
    get sceneVisible() {
      if (fullscreen.shown) return true;
      if (!polaroidInView) return false;
      // Mobil liegt eine Unterseite über der ganzen Hauptansicht (außer beim Umblättern).
      return !(book.layout === 'single' && nav.stack.length > 0 && !turn.busy);
    },
    showSceneAnimal,
    replaced() {
      legacy.replaced();
      closeNotes();
      albumTarget.disarm();
      for (const sub of subpages.values()) sub.reset?.();
      pagesDirty = true;
    },
    adopted(headChanged) {
      legacy.adopted(headChanged);
      albumTarget.disarm();
      savePage.disarm();
      cyclePage.disarm();
      pagesDirty = true;
    },
    showNewerSaveBanner(text) {
      if (book.banners.querySelector('[data-ref="newer-save-banner"]')) return;
      const banner = createBanderole({
        tone: 'alert',
        ref: 'newer-save-banner',
        role: 'alert',
        text,
        buttons: [{ label: 'Seite neu laden', onClick: () => location.reload() }],
      });
      book.banners.prepend(banner.element);
    },
  };
}
