/**
 * Bereich „Neuer Zyklus“ in der Seitenleiste mit der Stammgäste-Auswahl
 * (DESIGN_V2.md, Abschnitt 10). Schlicht im Stil der übrigen Panels.
 *
 * `update()` darf jeden Frame laufen: Das DOM wird nur neu gebaut, wenn sich die Ansicht
 * ändert (Schlüssel aus cycleViewKey). Der Knopf verlangt einen zweiten Klick zur
 * Bestätigung (kein confirm()).
 */
import { el, setText } from './dom';
import { cycleViewKey, type CyclePanelView } from './cycle-view';

/** So lange bleibt der Knopf nach dem ersten Klick scharf. */
export const CONFIRM_MS = 4000;

const BUTTON_TEXT = 'Neuen Zyklus beginnen';
const CONFIRM_TEXT = 'Wirklich neu beginnen? Zum Bestätigen erneut klicken';

export interface CyclePanelCallbacks {
  /** Zweiter Klick auf „Neuen Zyklus beginnen“. */
  onNewCycle(): void;
  /** Art als Stammgast an- oder abwählen. */
  onToggleRegular(speciesId: string): void;
}

export interface CyclePanel {
  update(view: CyclePanelView): void;
  /** Fokus auf die Überschrift (z. B. nach dem Zyklusstart, wenn der Knopf verschwindet). */
  focus(): void;
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

  const button = el('button', 'cycle-button', BUTTON_TEXT);
  button.type = 'button';
  button.dataset.ref = 'new-cycle';
  let armTimer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(armTimer);
    armTimer = undefined;
    button.textContent = BUTTON_TEXT;
    button.classList.remove('armed');
  };
  button.addEventListener('click', () => {
    if (armTimer === undefined) {
      button.textContent = CONFIRM_TEXT;
      button.classList.add('armed');
      armTimer = setTimeout(disarm, CONFIRM_MS);
      return;
    }
    disarm();
    callbacks.onNewCycle();
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

  section.append(title, sub, memory, blocker, gain, detail, slotsGain, button, regulars);
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

  return { update, focus: () => title.focus({ preventScroll: false }), element: section };
}
