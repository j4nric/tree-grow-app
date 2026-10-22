/**
 * Reiter „Landschaft“ – „Unsere Wälder“ · „🪶 3 Hähersaat“ (docs/ALBUM_UI.md, B.5 und A.10);
 * erst nach der Freischaltung sichtbar:
 * 1. Frage, Hähersaat und Wildwechsel-Chance am aktiven Wald,
 * 2. handgezeichnete Karte mit sechs Standorten – Tipp blättert zu U:Standort um,
 * 3. Ziel des nächsten Zyklus mit „Neuer Zyklus ›“ (Sprung in den Reiter „Ziele“),
 * 4. Korridore mit „Bauen“ (zweiter Klick bestätigt),
 * 5. Tagebuch der Wälder: je Wald die Angaben und die Hähersaat-Tabelle.
 *
 * Die Ansicht der Karte und das Ziel teilt die Seite mit U:Standort und U:Neuer Zyklus
 * (`env.albumTarget`, D.2). DOM einmal bauen; `update` setzt nur Texte und Klassen. Die
 * Liste der Wälder entsteht nur neu, wenn sich ihr Inhalt ändert (Gründung, Stammgast …).
 */
import type { SiteId } from '../../../content/landscape';
import { isDeliberateConfirm } from '../../confirm';
import { el, setAttr, setText } from '../../dom';
import { restartAnimation } from '../../feedback';
import { hyphenate } from '../../hyphenate';
import { toJournalLandscapeView } from '../../journal-landscape-view';
import type { LandscapeCorridorView, LandscapeMapView } from '../../landscape-view';
import type { JournalLandscapeRowView, JournalLandscapeView, JournalSiteView } from '../../view-model';
import { createLandscapeMap } from '../landscape-map';
import type { PageEnv, TabPage } from './registry';
import { createTabPanel } from './tab-pages';
import { corridorBuildLabel, landscapePageMeta, targetLine } from './landscape-page-view';
import './landscape.css';

/** So lange bleibt ein Bau-Knopf nach dem ersten Klick scharf (wie „Neuer Zyklus“). */
export const BUILD_CONFIRM_MS = 4000;

interface CorridorNode {
  row: HTMLLIElement;
  name: HTMLElement;
  ends: HTMLElement;
  note: HTMLElement;
  /** Wildwechsel über diesen Korridor (24.6) – nur gebaut, am aktiven Wald, mit Tieren drüben. */
  wildwechsel: HTMLElement;
  build: HTMLButtonElement;
  /** Zustand beim letzten Zeigen (für den kleinen Gruß nach dem Bau). */
  state: LandscapeCorridorView['state'] | null;
}

export function createLandscapePage(env: PageEnv): TabPage {
  const deps = env.deps;
  const target = env.albumTarget;
  const page = createTabPanel('landscape');
  page.body.classList.add('lsc-body');
  page.body.dataset.ref = 'landscape';

  // --- 1. Kopf: Frage, Hähersaat, Wildwechsel -------------------------------------------
  const head = el('div', 'lsc-head');
  const question = el('p', 'lsc-question');
  const seeds = el('p', 'lsc-seeds');
  seeds.dataset.ref = 'jay-seeds';
  const wildwechsel = el('p', 'lsc-wildwechsel');
  wildwechsel.dataset.ref = 'wildwechsel-chance';
  head.append(question, seeds, wildwechsel);

  // --- 2. Karte -------------------------------------------------------------------------
  const map = createLandscapeMap((id) => env.open({ kind: 'site', id }));

  // --- 3. Ziel des nächsten Zyklus -------------------------------------------------------
  const targetRow = el('div', 'lsc-target-row');
  const targetText = el('p', 'lsc-target');
  targetText.dataset.ref = 'landscape-target';
  const cycleOpen = el('button', 'lsc-more', 'Neuer Zyklus ›');
  cycleOpen.type = 'button';
  cycleOpen.dataset.ref = 'landscape-cycle-open';
  cycleOpen.setAttribute('aria-label', 'Neuer Zyklus (im Reiter Ziele)');
  cycleOpen.addEventListener('click', () => env.goto('goals', { kind: 'cycle' }));
  targetRow.append(targetText, cycleOpen);

  // --- 4. Korridore ---------------------------------------------------------------------
  const corridors = el('section', 'lsc-section lsc-corridors');
  const corridorTitle = el('h3', 'lsc-title');
  corridorTitle.id = 'lsc-corridors-title';
  const corridorList = el('ul', 'lsc-corridor-list');
  corridorList.dataset.ref = 'corridors';
  corridorList.setAttribute('aria-labelledby', corridorTitle.id);
  const corridorEmpty = el('p', 'lsc-hint');
  const corridorHint = el('p', 'lsc-hint');
  corridors.append(corridorTitle, corridorList, corridorEmpty, corridorHint);
  const corridorNodes = new Map<string, CorridorNode>();

  // --- 5. Tagebuch der Wälder -----------------------------------------------------------
  const diary = el('section', 'lsc-section lsc-diary');
  diary.dataset.ref = 'landscape-diary';
  const diaryTitle = el('h3', 'lsc-title');
  const summary = el('p', 'lsc-summary');
  summary.dataset.ref = 'landscape-summary';
  const seedsTitle = el('h4', 'lsc-subtitle');
  seedsTitle.id = 'lsc-seeds-title';
  const seedTable = el('dl', 'lsc-seed-table');
  seedTable.dataset.ref = 'landscape-jay-seeds';
  seedTable.setAttribute('aria-labelledby', seedsTitle.id);
  const seedsNote = el('p', 'lsc-hint');
  const forestsTitle = el('h4', 'lsc-subtitle');
  forestsTitle.id = 'lsc-forests-title';
  const forests = el('ul', 'lsc-forests');
  forests.dataset.ref = 'landscape-forests';
  forests.setAttribute('aria-labelledby', forestsTitle.id);
  const forestsHint = el('p', 'lsc-hint');
  diary.append(diaryTitle, summary, seedsTitle, seedTable, seedsNote, forestsTitle, forests, forestsHint);

  page.body.append(head, map.element, targetRow, corridors, diary);

  // --- Bau-Knopf mit zweitem Klick ------------------------------------------------------
  /** Scharfgeschalteter Bau-Knopf (Korridor-ID) – der zweite Klick baut. */
  let armed: string | null = null;
  let armedAt = 0;
  let armTimer: ReturnType<typeof setTimeout> | undefined;
  function disarm(): void {
    clearTimeout(armTimer);
    armTimer = undefined;
    armed = null;
  }
  target.onDisarm(() => {
    disarm();
    refreshBuildButtons();
  });

  function createCorridor(c: LandscapeCorridorView): CorridorNode {
    const row = el('li', 'lsc-corridor');
    row.dataset.corridor = c.id;
    const icon = el('span', 'lsc-corridor-icon', c.icon);
    icon.setAttribute('aria-hidden', 'true');
    const text = el('span', 'lsc-corridor-text');
    const name = el('span', 'lsc-corridor-name');
    const ends = el('small', 'lsc-corridor-ends');
    const note = el('small', 'lsc-corridor-note');
    note.id = `lsc-corridor-note-${c.id}`;
    const ww = el('small', 'lsc-corridor-wildwechsel');
    ww.dataset.ref = 'corridor-wildwechsel';
    text.append(name, ends, note, ww);
    const build = el('button', 'lsc-build');
    build.type = 'button';
    build.dataset.build = c.id;
    build.setAttribute('aria-describedby', note.id);
    build.addEventListener('click', (event) => {
      // Hähersaat ist knapp und der Bau dauerhaft: zweiter Klick bestätigt.
      if (armed !== c.id) {
        if (event.detail > 1) return;
        disarm();
        armed = c.id;
        armedAt = performance.now();
        armTimer = setTimeout(() => {
          disarm();
          refreshBuildButtons();
        }, BUILD_CONFIRM_MS);
        refreshBuildButtons();
        return;
      }
      // Doppelklick oder gehaltene Enter-Taste bestätigen nicht.
      if (!isDeliberateConfirm(event, armedAt, performance.now())) return;
      disarm();
      refreshBuildButtons();
      deps.actions.buildCorridor(c.id);
    });
    row.title = c.text;
    row.append(icon, text, build);
    corridorList.append(row);
    const node: CorridorNode = { row, name, ends, note, wildwechsel: ww, build, state: null };
    corridorNodes.set(c.id, node);
    return node;
  }

  /** Beschriftung der Bau-Knöpfe (scharf: „Wirklich bauen?“). */
  function refreshBuildButtons(): void {
    for (const c of shownView?.corridors ?? []) {
      const node = corridorNodes.get(c.id);
      if (!node) continue;
      const isArmed = armed === c.id;
      const label = corridorBuildLabel(c, isArmed);
      node.build.classList.toggle('armed', isArmed);
      setText(node.build, label.text);
      setAttr(node.build, 'aria-label', label.label);
    }
  }

  function updateCorridors(view: LandscapeMapView): void {
    let listed = 0;
    for (const c of view.corridors) {
      const node = corridorNodes.get(c.id) ?? createCorridor(c);
      node.row.hidden = !c.listed;
      if (c.listed) listed++;
      node.row.classList.toggle('built', c.state === 'built');
      node.row.classList.toggle('wildwechsel', c.wildwechsel !== null);
      // Gerade gebaut: kurz „eingeklebt“ (nicht beim ersten Zeigen).
      if (c.state === 'built' && node.state !== null && node.state !== 'built') restartAnimation(node.row, 'lsc-fresh');
      node.state = c.state;
      node.wildwechsel.hidden = c.wildwechsel === null;
      setText(node.wildwechsel, c.wildwechsel ?? '');
      setText(node.name, hyphenate(c.name));
      setText(node.ends, hyphenate(c.ends));
      setText(node.note, c.state === 'buildable' ? c.text : c.note);
      node.build.hidden = c.state === 'built';
      node.build.disabled = c.state !== 'buildable';
      if (armed === c.id && c.state !== 'buildable') disarm();
    }
    corridorEmpty.hidden = listed > 0;
    corridorHint.hidden = view.corridorHint === null;
    setText(corridorHint, view.corridorHint ?? '');
    refreshBuildButtons();
  }

  // --- Tagebuch der Wälder --------------------------------------------------------------
  let diaryKey = '';

  function rowList(rows: readonly JournalLandscapeRowView[], className: string): HTMLDListElement {
    const dl = el('dl', className);
    for (const r of rows) {
      const wrap = el('div', `${className}-row`);
      wrap.dataset.row = r.key;
      wrap.append(el('dt', '', r.label), el('dd', '', hyphenate(r.value)));
      dl.append(wrap);
    }
    return dl;
  }

  function forestItem(s: JournalSiteView, index: number): HTMLLIElement {
    const li = el('li', `lsc-forest${s.active ? ' current' : ''}${s.ancient ? ' ancient' : ''}`);
    li.dataset.forest = s.id;
    li.style.setProperty('--tilt', `${index % 2 === 0 ? -0.6 : 0.5}deg`);
    const head = el('div', 'lsc-forest-head');
    const open = el('button', 'lsc-forest-open');
    open.type = 'button';
    open.dataset.ref = 'forest-open';
    const icon = el('span', 'lsc-forest-icon', s.icon);
    icon.setAttribute('aria-hidden', 'true');
    const name = el('span', 'lsc-forest-name', hyphenate(s.name));
    const arrow = el('span', 'lsc-forest-arrow', '›');
    arrow.setAttribute('aria-hidden', 'true');
    open.append(icon, name, arrow);
    open.setAttribute('aria-label', `${s.name}: Standort ansehen`);
    open.addEventListener('click', () => env.open({ kind: 'site', id: s.id as SiteId }));
    head.append(open);
    if (s.active) {
      const badge = el('span', 'lsc-forest-here', '★ hier wächst dein Wald');
      head.append(badge);
    }
    li.append(head);
    if (s.forestType) li.append(el('p', 'lsc-forest-type', hyphenate(s.forestType)));
    li.append(rowList(s.rows, 'lsc-facts'));
    return li;
  }

  function updateDiary(journal: JournalLandscapeView | null): void {
    diary.hidden = journal === null;
    if (!journal) return;
    const key = JSON.stringify(journal);
    if (key === diaryKey) return;
    diaryKey = key;
    setText(summary, journal.summary);
    seedTable.replaceChildren(...rowList(journal.jaySeeds, 'lsc-seed-table').childNodes);
    setText(seedsNote, journal.jaySeedsNote);
    // Fokus auf einem Wald-Knopf bleibt beim Neubau dort.
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-forest]')?.dataset.forest : undefined;
    forests.replaceChildren(...journal.sites.map(forestItem));
    if (focused) forests.querySelector<HTMLElement>(`[data-forest="${focused}"] .lsc-forest-open`)?.focus({ preventScroll: true });
    forestsHint.hidden = journal.sitesHint === null;
    setText(forestsHint, journal.sitesHint ?? '');
  }

  // --- Auffrischen ----------------------------------------------------------------------
  let shownView: LandscapeMapView | null = null;
  let shownTarget: SiteId | null = null;

  function render(force: boolean): void {
    const view = target.view();
    const tgt = target.target();
    if (!force && view === shownView && tgt === shownTarget) return;
    const changed = force || view !== shownView;
    shownView = view;
    shownTarget = tgt;
    page.setMeta(landscapePageMeta(view));
    page.body.hidden = view === null;
    if (!view) return;
    // Feste Überschriften erst mit der ersten Ansicht – vorher steht nichts (auch verborgen) im DOM.
    setText(corridorTitle, 'Korridore');
    setText(corridorEmpty, 'Noch keine Korridore – der erste entsteht mit der Gründung eines Waldes.');
    setText(diaryTitle, 'Tagebuch der Wälder');
    setText(seedsTitle, '🪶 Hähersaat');
    setText(forestsTitle, 'Wälder');
    map.update(view, tgt);
    const line = targetLine(view, tgt);
    targetText.hidden = line === null;
    setText(targetText, line ?? '');
    if (!changed) return;
    setText(question, view.question);
    setText(seeds, view.jaySeeds);
    wildwechsel.hidden = view.wildwechsel === null;
    setText(wildwechsel, view.wildwechsel ?? '');
    updateCorridors(view);
    updateDiary(toJournalLandscapeView(deps.state()));
  }

  return {
    page,
    update(_now, force) {
      render(force === true);
    },
  };
}
