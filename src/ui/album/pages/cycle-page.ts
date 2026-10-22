/**
 * Unterseite „Neuer Zyklus“ (docs/ALBUM_UI.md, B.4 und A.9 #102–105; DESIGN_V2.md 10, 17.2,
 * 25.2): Zyklus und Wald, Hauptbaum jetzt, Waldgedächtnis, Gewinn bzw. Grund, Regel, Ziel-Wald
 * aus der Landschaft, Baumwahl als „Samentütchen“ mit echten Radioknöpfen, Knopf mit zweitem
 * Klick und die Stammgäste.
 *
 * Baumwahl (Phase 7, 3a): alle sichtbaren Hauptbäume (`isTreeVisible` über previewNewCycle) –
 * Weißtanne und Schwarzerle erst mit der Landschaft, bis zur Gründung ihres Waldes gesperrt
 * mit Hinweis. Mit einem Ziel in der Landschaft gelten dessen Arten und Vorauswahl
 * (`treeChoiceFor`, Leitbaum beim Gründen).
 *
 * DOM einmal bauen. Tütchen und Stammgast-Zeilen entstehen je Art einmal und werden danach
 * nur aktualisiert (Fokus und Auswahl bleiben erhalten). Aktualisiert wird nur, solange die
 * Seite offen ist.
 */
import { SPECIES_BY_ID } from '../../../content/species';
import type { MainTreeId } from '../../../content/trees';
import { renderSpeciesSticker } from '../../../render/sticker';
import { isDeliberateConfirm } from '../../confirm';
import { cycleViewKey, toCyclePanelView, treeChoiceFor, type CyclePanelView, type RegularOptionView } from '../../cycle-view';
import { el, setAttr, setText } from '../../dom';
import { newCycleButtonText, targetText } from '../../landscape-view';
import { createBookmark } from '../bookmark';
import { initialNav, pageNumber } from '../nav';
import { createPage } from '../page';
import type { PageEnv, Subpage } from './registry';
import './goals.css';

/** So lange bleibt der Knopf nach dem ersten Klick scharf. */
export const CONFIRM_MS = 4000;
const CONFIRM_TEXT = 'Wirklich neu beginnen? Zum Bestätigen erneut klicken';
const REFRESH_MS = 200;
/** Größe der Stammgast-Sticker (CSS-Pixel). */
const STICKER_PX = 40;

interface TreeItem {
  row: HTMLLabelElement;
  input: HTMLInputElement;
  name: HTMLElement;
  info: HTMLElement;
  lock: HTMLElement;
}

interface RegularItem {
  li: HTMLLIElement;
  toggle: HTMLButtonElement;
  star: HTMLElement;
  niche: HTMLElement;
  note: HTMLElement;
}

export interface CyclePage extends Subpage {
  /** Offene Bestätigung zurücknehmen (Import, Stand eines anderen Geräts). */
  disarm(): void;
}

export function createCyclePage(env: PageEnv): CyclePage {
  const deps = env.deps;
  const page = createPage({
    kind: 'cycle',
    title: 'Neuer Zyklus',
    number: pageNumber({ ...initialNav('goals'), stack: [{ kind: 'cycle' }] }),
    className: 'album-subpage cycle-page',
  });
  const bookmark = createBookmark(() => env.back());
  bookmark.setLabel('Ziele');
  page.element.prepend(bookmark.element);
  page.meta.dataset.ref = 'cycle-sub';
  page.body.classList.add('goals-body');

  // --- Jetzt: Hauptbaum und Gedächtnis -------------------------------------------------
  const now = el('section', 'cyc-now');
  const tree = el('p', 'cyc-tree');
  tree.dataset.ref = 'main-tree';
  const memory = el('p', 'cyc-memory');
  memory.dataset.ref = 'forest-memory';
  now.append(tree, memory);

  // --- Was der Zyklus bringt -------------------------------------------------------------
  const gainBox = el('section', 'cyc-gain-box');
  const gainTitle = el('h3', 'goals-section-title', 'Was er bringt');
  const blocker = el('p', 'cyc-blocker');
  blocker.dataset.ref = 'cycle-blocker';
  const gain = el('p', 'cyc-gain');
  gain.dataset.ref = 'cycle-gain';
  const detail = el('p', 'cyc-detail');
  const slotsGain = el('p', 'cyc-detail');
  // Regel fürs Waldgedächtnis als gelber Zettel – auch vor dem Hain (Harmonie über 100 lohnt sich).
  const rule = el('p', 'cyc-rule');
  rule.dataset.ref = 'memory-rule';
  gainBox.append(gainTitle, blocker, gain, detail, slotsGain, rule);

  // --- Ziel-Wald (Karte der Landschaft) --------------------------------------------------
  const target = el('p', 'cyc-target');
  target.dataset.ref = 'cycle-target';

  // --- Baumwahl ------------------------------------------------------------------------
  const trees = el('fieldset', 'cyc-trees');
  trees.dataset.ref = 'tree-choice';
  const legend = el('legend', 'goals-section-title', 'Welcher Baum keimt?');
  // Native Radioknöpfe in fieldset/legend: Gruppe und Pfeiltasten kommen vom Browser.
  const treeList = el('div', 'cyc-tree-list');
  trees.append(legend, treeList);
  const treeItems = new Map<MainTreeId, TreeItem>();
  /** Gewählte Art (null = Vorauswahl). */
  let chosen: MainTreeId | null = null;
  let shownCurrent: MainTreeId | null = null;
  let current: MainTreeId = 'oak';

  // --- Knopf ---------------------------------------------------------------------------
  const button = el('button', 'cyc-button');
  button.type = 'button';
  button.dataset.ref = 'new-cycle';
  let buttonText = '';
  let armTimer: ReturnType<typeof setTimeout> | undefined;
  let armedAt = 0;
  function disarm(): void {
    clearTimeout(armTimer);
    armTimer = undefined;
    button.textContent = buttonText;
    button.classList.remove('armed');
  }
  button.addEventListener('click', (event) => {
    if (armTimer === undefined) {
      if (event.detail > 1) return;
      button.textContent = CONFIRM_TEXT;
      button.classList.add('armed');
      armedAt = performance.now();
      armTimer = setTimeout(disarm, CONFIRM_MS);
      return;
    }
    // Doppelklick oder gehaltene Enter-Taste bestätigen nicht.
    if (!isDeliberateConfirm(event, armedAt, performance.now())) return;
    disarm();
    const site = view ? targetSite(view) : undefined;
    last = -Infinity;
    deps.actions.newCycle(chosen ?? current, site?.id);
  });

  // --- Stammgäste ----------------------------------------------------------------------
  const regulars = el('section', 'cyc-regulars');
  regulars.dataset.ref = 'regulars';
  const regularsTitle = el('h3', 'goals-section-title');
  const regularsHint = el(
    'p',
    'cyc-hint',
    'Stammgäste ziehen von selbst und kostenlos ein, sobald in ihrer Nische ein Platz frei ist.',
  );
  const regularList = el('ul', 'cyc-regular-list');
  regulars.append(regularsTitle, regularsHint, regularList);
  const regularItems = new Map<string, RegularItem>();
  let regularOrder = '';

  page.body.append(now, gainBox, target, trees, button, regulars);

  let view: CyclePanelView | null = null;
  let shownKey = '';
  let last = -Infinity;

  // Anderes Ziel in der Landschaft: Vorauswahl des Baums aus diesem Wald (Leitbaum bzw. zuletzt dort).
  env.albumTarget.onChange(() => {
    disarm();
    chosen = null;
    if (view) {
      updateTarget(view);
      updateTrees(view);
    }
  });

  /** Ziel-Wald in der Landschaft (undefined = hier weiter). */
  function targetSite(v: CyclePanelView) {
    const id = env.albumTarget.target();
    return v.landscape?.sites.find((s) => s.id === id && !s.active && s.action !== null);
  }

  function updateTarget(v: CyclePanelView): void {
    const site = targetSite(v);
    const text = newCycleButtonText(site);
    if (text !== buttonText) {
      buttonText = text;
      if (armTimer === undefined) button.textContent = text;
    }
    const map = v.landscape;
    target.hidden = !map || !v.allowed;
    if (map) {
      const active = map.sites.find((s) => s.id === map.active);
      setText(target, targetText(site, active ? `${active.icon} ${active.name}` : ''));
    }
  }

  function createTreeItem(id: MainTreeId, icon: string, index: number): TreeItem {
    // Das ganze Tütchen ist das Label; der Name des Knopfs bleibt kurz (aria-labelledby).
    const row = el('label', `cycle-tree cyc-packet tree-${id}`);
    row.dataset.tree = id;
    row.style.setProperty('--tilt', `${index % 2 === 0 ? -1.2 : 1}deg`);
    const input = el('input');
    input.type = 'radio';
    input.name = 'cycle-tree';
    input.value = id;
    input.dataset.tree = id;
    const infoId = `cycle-tree-info-${id}`;
    input.setAttribute('aria-describedby', infoId);
    input.addEventListener('change', () => {
      if (input.checked) chosen = id;
    });
    const sticker = el('span', 'cyc-packet-sticker', icon);
    sticker.setAttribute('aria-hidden', 'true');
    const name = el('span', 'cyc-packet-name');
    name.id = `cycle-tree-name-${id}`;
    input.setAttribute('aria-labelledby', name.id);
    const lock = el('span', 'cyc-packet-lock', '🔒');
    lock.setAttribute('aria-hidden', 'true');
    const info = el('small', 'cyc-packet-info');
    info.id = infoId;
    row.append(input, sticker, lock, name, info);
    treeList.append(row);
    const item = { row, input, name, info, lock };
    treeItems.set(id, item);
    return item;
  }

  /**
   * Tütchen aktualisieren (angelegt nur beim ersten Mal – Fokus und Auswahl bleiben). Die
   * Wahl bleibt, solange die Art wählbar ist; vorausgewählt ist die laufende Art bzw. die des
   * Ziel-Waldes, ist sie gesperrt, die erste freie.
   */
  function updateTrees(v: CyclePanelView): void {
    const choice = treeChoiceFor(v, targetSite(v));
    current = choice.current;
    // Neuer Zyklus begonnen: wieder die (neue) laufende Art vorauswählen.
    if (current !== shownCurrent) chosen = null;
    shownCurrent = current;
    if (chosen !== null && !choice.trees.some((t) => t.id === chosen && t.unlocked)) chosen = null;
    trees.hidden = !v.allowed;
    const visible = new Set(choice.trees.map((t) => t.id));
    choice.trees.forEach((t, i) => {
      const item = treeItems.get(t.id) ?? createTreeItem(t.id, t.icon, i);
      item.row.hidden = false;
      item.row.classList.toggle('locked', !t.unlocked);
      item.row.classList.toggle('current', t.current);
      item.lock.hidden = t.unlocked;
      item.input.disabled = !t.unlocked;
      item.input.checked = t.id === (chosen ?? current);
      setText(item.name, t.current ? `${t.name} (jetzt)` : t.name);
      setText(item.info, t.hint ?? t.summary);
    });
    // Nach einem Import wieder verborgene Arten (Landschaft gesperrt) ausblenden.
    for (const [id, item] of treeItems) if (!visible.has(id)) item.row.hidden = true;
  }

  function createRegular(r: RegularOptionView): RegularItem {
    const li = el('li', 'cyc-regular-item');
    const toggle = el('button', 'cycle-regular cyc-regular');
    toggle.type = 'button';
    toggle.dataset.regular = r.id;
    const genus = SPECIES_BY_ID.get(r.id)?.genus;
    const sticker = el('span', `cyc-sticker${genus ? ` fam-${genus}` : ''}`);
    sticker.setAttribute('aria-hidden', 'true');
    const canvas = el('canvas', 'cyc-sticker-canvas');
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const image = renderSpeciesSticker(r.id, STICKER_PX, { dpr });
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    sticker.append(canvas);
    const text = el('span', 'cyc-regular-text');
    const name = el('span', 'cycle-regular-name', r.name);
    const niche = el('small', 'cycle-regular-niche');
    text.append(name, niche);
    const star = el('span', 'cyc-regular-star');
    star.setAttribute('aria-hidden', 'true');
    toggle.append(sticker, text, star);
    toggle.addEventListener('click', () => {
      // Gleich im nächsten Frame zeigen (nicht erst nach der Drosselung).
      last = -Infinity;
      deps.actions.toggleRegular(r.id);
    });
    // Warum der Stammgast wartet bzw. wann er einzieht: unter dem Knopf, per
    // aria-describedby vorgelesen (der Name des Knopfs bleibt kurz).
    const note = el('small', 'cycle-regular-note');
    note.id = `cycle-regular-note-${r.id}`;
    note.dataset.regularNote = r.id;
    li.append(toggle, note);
    const item = { li, toggle, star, niche, note };
    regularItems.set(r.id, item);
    return item;
  }

  function updateRegulars(v: CyclePanelView): void {
    regulars.hidden = v.regularSlots === 0;
    setText(regularsTitle, v.regularsTitle);
    for (const r of v.regulars) {
      const item = regularItems.get(r.id) ?? createRegular(r);
      item.toggle.classList.toggle('selected', r.selected);
      setAttr(item.toggle, 'aria-pressed', String(r.selected));
      item.toggle.disabled = r.disabled;
      setText(item.star, r.selected ? '★' : '☆');
      setText(item.niche, r.present ? `${r.niche} · lebt hier` : r.niche);
      // Ohne Hinweis kein (leeres) Element: Tests und Screenreader sehen nur echte Hinweise.
      if (r.note) {
        setText(item.note, r.note);
        item.note.classList.toggle('waiting', r.waiting);
        setAttr(item.toggle, 'aria-describedby', item.note.id);
        if (!item.note.isConnected) item.li.append(item.note);
      } else {
        item.toggle.removeAttribute('aria-describedby');
        item.note.remove();
      }
    }
    // Reihenfolge bzw. Menge geändert (neue Art im Tagebuch, Import): Liste neu ordnen.
    const order = v.regulars.map((r) => r.id).join(',');
    if (order !== regularOrder) {
      regularOrder = order;
      const keep = new Set(v.regulars.map((r) => r.id));
      for (const id of [...regularItems.keys()]) if (!keep.has(id)) regularItems.delete(id);
      const focused = document.activeElement;
      regularList.replaceChildren(...v.regulars.map((r) => regularItems.get(r.id)!.li));
      if (focused instanceof HTMLElement && regularList.contains(focused)) focused.focus({ preventScroll: true });
    }
  }

  function render(force = false): void {
    const next = toCyclePanelView(deps.state());
    const key = cycleViewKey(next);
    if (!force && key === shownKey) return;
    shownKey = key;
    view = next;
    page.setMeta(next.title);
    setText(tree, `Hauptbaum: ${next.tree}`);
    setText(memory, next.memory);
    blocker.hidden = next.blocker === null;
    setText(blocker, next.blocker ?? '');
    gain.hidden = next.gain === null;
    setText(gain, next.gain ?? '');
    detail.hidden = next.gainDetail === null;
    setText(detail, next.gainDetail ?? '');
    slotsGain.hidden = next.slotsGain === null;
    setText(slotsGain, next.slotsGain ?? '');
    setText(rule, next.memoryRule);
    if (!next.allowed) disarm();
    button.hidden = !next.allowed;
    page.element.classList.toggle('ready', next.allowed);
    updateTarget(next);
    updateTrees(next);
    updateRegulars(next);
  }

  return {
    page,
    bookmark,
    opened() {
      last = performance.now();
      render(true);
    },
    update(t, force) {
      if (!force && t - last < REFRESH_MS) return;
      last = t;
      render();
    },
    reset: disarm,
    disarm,
  };
}
