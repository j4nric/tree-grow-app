/**
 * Bereich „Neuer Zyklus“ in der Seitenleiste mit der Wahl des Hauptbaums
 * (DESIGN_V2.md 17.2) und der Stammgäste-Auswahl (Abschnitt 10). Schlicht im Stil der
 * übrigen Panels.
 *
 * `update()` darf jeden Frame laufen: Das DOM wird nur neu gebaut, wenn sich die Ansicht
 * ändert (Schlüssel aus cycleViewKey). Der Knopf verlangt einen zweiten Klick zur
 * Bestätigung (kein confirm()).
 */
import { isDeliberateConfirm } from './confirm';
import { el, setText } from './dom';
import { cycleViewKey, type CyclePanelView } from './cycle-view';
import type { MainTreeId } from '../content/trees';

/** So lange bleibt der Knopf nach dem ersten Klick scharf. */
export const CONFIRM_MS = 4000;

const BUTTON_TEXT = 'Neuen Zyklus beginnen';
const CONFIRM_TEXT = 'Wirklich neu beginnen? Zum Bestätigen erneut klicken';

export interface CyclePanelCallbacks {
  /** Zweiter Klick auf „Neuen Zyklus beginnen“, mit der gewählten Art des Hauptbaums. */
  onNewCycle(mainTree: MainTreeId): void;
  /** Art als Stammgast an- oder abwählen. */
  onToggleRegular(speciesId: string): void;
}

export interface CyclePanel {
  update(view: CyclePanelView): void;
  /** Fokus auf die Überschrift (z. B. nach dem Zyklusstart, wenn der Knopf verschwindet). */
  focus(): void;
  /** Offene Bestätigung „Zum Bestätigen erneut klicken“ zurücknehmen (z. B. nach einem Import). */
  disarm(): void;
  readonly element: HTMLElement;
}

export function createCyclePanel(root: HTMLElement, callbacks: CyclePanelCallbacks): CyclePanel {
  const section = el('section', 'cycle');
  section.setAttribute('aria-label', 'Neuer Zyklus');
  section.dataset.ref = 'cycle-panel';

  const title = el('h2', 'eco-title', 'Neuer Zyklus');
  title.tabIndex = -1;
  title.dataset.ref = 'cycle-title';
  const sub = el('p', 'hint cycle-sub');
  const memory = el('p', 'cycle-memory');
  memory.dataset.ref = 'forest-memory';
  const blocker = el('p', 'hint');
  blocker.dataset.ref = 'cycle-blocker';
  const gain = el('p', 'cycle-gain');
  gain.dataset.ref = 'cycle-gain';
  const detail = el('p', 'hint');
  const slotsGain = el('p', 'hint');
  // Art des laufenden Zyklus (solange kein Neuer Zyklus möglich ist).
  const tree = el('p', 'cycle-tree-current');
  tree.dataset.ref = 'main-tree';

  // Wahl des Hauptbaums für den nächsten Zyklus: Radiogruppe, gesperrte Arten mit Hinweis.
  const trees = el('fieldset', 'cycle-trees');
  trees.dataset.ref = 'tree-choice';
  const legend = el('legend', 'cycle-trees-title', 'Hauptbaum des nächsten Zyklus');
  // Native Radioknöpfe in fieldset/legend: Gruppe und Pfeiltasten kommen vom Browser.
  const treeList = el('div', 'cycle-tree-list');
  trees.append(legend, treeList);
  /** Gewählte Art (null = die des laufenden Zyklus). */
  let chosen: MainTreeId | null = null;
  let shownCurrent: MainTreeId | null = null;
  let current: MainTreeId = 'oak';

  const button = el('button', 'cycle-button', BUTTON_TEXT);
  button.type = 'button';
  button.dataset.ref = 'new-cycle';
  let armTimer: ReturnType<typeof setTimeout> | undefined;
  let armedAt = 0;
  const disarm = () => {
    clearTimeout(armTimer);
    armTimer = undefined;
    button.textContent = BUTTON_TEXT;
    button.classList.remove('armed');
  };
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
    callbacks.onNewCycle(chosen ?? current);
  });

  const regulars = el('div', 'cycle-regulars');
  regulars.dataset.ref = 'regulars';
  const regularsTitle = el('h3', 'cycle-regulars-title');
  const regularsHint = el(
    'p',
    'hint',
    'Stammgäste ziehen von selbst und kostenlos ein, sobald in ihrer Nische ein Platz frei ist.',
  );
  const list = el('ul', 'cycle-regular-list');
  regulars.append(regularsTitle, regularsHint, list);

  section.append(title, sub, tree, memory, blocker, gain, detail, slotsGain, trees, button, regulars);
  root.append(section);

  let shownKey = '';

  function update(view: CyclePanelView): void {
    const key = cycleViewKey(view);
    if (key === shownKey) return;
    shownKey = key;
    setText(sub, view.title);
    setText(memory, view.memory);
    blocker.hidden = view.blocker === null;
    setText(blocker, view.blocker ?? '');
    gain.hidden = view.gain === null;
    setText(gain, view.gain ?? '');
    detail.hidden = view.gainDetail === null;
    setText(detail, view.gainDetail ?? '');
    slotsGain.hidden = view.slotsGain === null;
    setText(slotsGain, view.slotsGain ?? '');
    if (!view.allowed) disarm();
    button.hidden = !view.allowed;
    setText(tree, `Hauptbaum: ${view.tree}`);
    updateTrees(view);

    regulars.hidden = view.regularSlots === 0;
    setText(regularsTitle, view.regularsTitle);
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.regular;
    const items = view.regulars.map((r) => {
      const li = el('li');
      const toggle = el('button', `cycle-regular${r.selected ? ' selected' : ''}`);
      toggle.type = 'button';
      toggle.dataset.regular = r.id;
      toggle.setAttribute('aria-pressed', String(r.selected));
      toggle.disabled = r.disabled;
      const icon = el('span', 'cycle-regular-icon', r.icon);
      icon.setAttribute('aria-hidden', 'true');
      const name = el('span', 'cycle-regular-name', r.name);
      const niche = el('small', 'cycle-regular-niche', r.present ? `${r.niche} · lebt hier` : r.niche);
      toggle.append(icon, name, niche);
      toggle.addEventListener('click', () => callbacks.onToggleRegular(r.id));
      li.append(toggle);
      return { li, toggle, id: r.id };
    });
    list.replaceChildren(...items.map((i) => i.li));
    // Fokus nach dem Neuaufbau auf demselben Eintrag lassen (Tastaturbedienung).
    if (focused) items.find((i) => i.id === focused)?.toggle.focus({ preventScroll: true });
  }

  /** Radiogruppe neu bauen; die Wahl bleibt, solange die Art wählbar ist. */
  function updateTrees(view: CyclePanelView): void {
    current = view.trees.find((t) => t.current)?.id ?? 'oak';
    // Neuer Zyklus begonnen: wieder die (neue) laufende Art vorauswählen.
    if (current !== shownCurrent) chosen = null;
    shownCurrent = current;
    if (chosen !== null && !view.trees.some((t) => t.id === chosen && t.unlocked)) chosen = null;
    trees.hidden = !view.allowed;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.tree;
    const items = view.trees.map((t) => {
      const label = el('label', `cycle-tree${t.unlocked ? '' : ' locked'}`);
      label.dataset.tree = t.id;
      const input = el('input');
      input.type = 'radio';
      input.name = 'cycle-tree';
      input.value = t.id;
      input.dataset.tree = t.id;
      input.checked = t.id === (chosen ?? current);
      input.disabled = !t.unlocked;
      input.addEventListener('change', () => {
        if (input.checked) chosen = t.id;
      });
      const icon = el('span', 'cycle-tree-icon', t.icon);
      icon.setAttribute('aria-hidden', 'true');
      const name = el('span', 'cycle-tree-name', t.current ? `${t.name} (jetzt)` : t.name);
      const info = el('small', 'cycle-tree-info', t.hint ?? t.summary);
      label.append(input, icon, name, info);
      return { label, input, id: t.id };
    });
    treeList.replaceChildren(...items.map((i) => i.label));
    if (focused) items.find((i) => i.id === focused)?.input.focus({ preventScroll: true });
  }

  return { update, focus: () => title.focus({ preventScroll: false }), element: section, disarm };
}
