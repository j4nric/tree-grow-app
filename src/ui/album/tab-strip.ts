/**
 * TabStrip: die Reiter des Albums (docs/ALBUM_UI.md, B.0 und C.1). Mobil waagerecht über
 * der Heftseite (klebt beim Scrollen oben), auf der Doppelseite senkrecht am rechten
 * Buchrand. Rollen `tablist`/`tab`, Pfeiltasten (beide Richtungen), Pos1 und Ende;
 * verborgene Reiter werden übersprungen. Ein Punkt am Reiter zeigt „hier gibt es etwas“.
 *
 * **Passend machen (mobil):** Passen die Reiter nicht in die Breite (5 Reiter bei 360 px,
 * breite Ersatzschrift, größere Schrift), werden sie stufenweise schmaler – `data-fit`:
 * `tight` (enger, kleiner), `icons` (nur der gewählte Reiter mit Namen, die übrigen mit
 * Symbol), `icons-small` (dazu der Name kleiner), `icons-only`. Der Name bleibt immer der zugängliche Name. Gemessen wird nur bei
 * Größen- oder Schriftwechsel, neuen Reitern und Reiterwechsel – nie pro Frame.
 */
import { el, setAttr } from '../dom';
import { TAB_IDS, TAB_LABELS, type TabId } from './nav';
import './tab-strip.css';

/** Symbole der Reiter für die schmalen Stufen (nur Schmuck, nicht vorgelesen). */
export const TAB_ICONS: Readonly<Record<TabId, string>> = {
  niches: '🏡',
  species: '🦋',
  care: '💧',
  goals: '🎯',
  landscape: '🗺️',
};

/** Stufen von breit nach schmal (CSS: tab-strip.css). */
export const TAB_FITS = ['', 'tight', 'icons', 'icons-small', 'icons-only'] as const;
export type TabFit = (typeof TAB_FITS)[number];

export interface TabStrip {
  readonly element: HTMLElement;
  /** Reiter-Knopf, z. B. für `aria-labelledby` der Seite. */
  button(tab: TabId): HTMLButtonElement;
  select(tab: TabId): void;
  setVisible(tab: TabId, visible: boolean): void;
  setDot(tab: TabId, on: boolean): void;
  /** Senkrecht (Doppelseite) oder waagerecht (Einzelseite). */
  setOrientation(orientation: 'horizontal' | 'vertical'): void;
  /** Breite neu prüfen und die passende Stufe wählen (`data-fit`). */
  fit(): void;
}

export function createTabStrip(onSelect: (tab: TabId) => void): TabStrip {
  const list = el('div', 'tab-strip');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Kapitel des Albums');
  list.dataset.ref = 'tabs';
  const buttons = new Map<TabId, HTMLButtonElement>();
  let selected: TabId = 'niches';

  for (const tab of TAB_IDS) {
    const button = el('button', `tab tab-${tab}`);
    button.type = 'button';
    button.id = `tab-${tab}`;
    button.dataset.ref = `tab-${tab}`;
    button.dataset.tab = tab;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `tabpanel-${tab}`);
    button.dataset.icon = TAB_ICONS[tab];
    button.append(el('span', 'tab-label', TAB_LABELS[tab]));
    const dot = el('span', 'tab-dot');
    dot.setAttribute('aria-hidden', 'true');
    dot.hidden = true;
    button.append(dot);
    button.addEventListener('click', () => onSelect(tab));
    buttons.set(tab, button);
    list.append(button);
  }

  const visible = () => TAB_IDS.filter((t) => !buttons.get(t)!.hidden);

  list.addEventListener('keydown', (event) => {
    const order = visible();
    const index = order.indexOf(selected);
    let next: TabId | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = order[(index + 1) % order.length];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = order[(index - 1 + order.length) % order.length];
        break;
      case 'Home':
        next = order[0];
        break;
      case 'End':
        next = order[order.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (!next) return;
    onSelect(next);
    buttons.get(next)!.focus();
  });

  /** Gewählten Reiter in der (mobil waagerecht scrollbaren) Leiste zeigen, ohne die Seite zu bewegen. */
  function reveal(button: HTMLElement): void {
    if (list.scrollWidth <= list.clientWidth) return;
    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = left - 8;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 8;
  }

  function select(tab: TabId): void {
    selected = tab;
    for (const [id, button] of buttons) {
      const active = id === tab;
      setAttr(button, 'aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    // Stufe „icons“ zeigt nur am gewählten Reiter den Namen: neu passend machen.
    if (fitted !== '') fit();
    reveal(buttons.get(tab)!);
  }

  let vertical = false;
  let fitted: TabFit = '';
  /**
   * Schmalste nötige Stufe wählen. Waagerecht scrollt die Leiste notfalls weiterhin (R6);
   * senkrecht (Doppelseite) gibt es nichts anzupassen.
   */
  function fit(): void {
    let next: TabFit = '';
    if (!vertical && list.isConnected) {
      for (const tier of TAB_FITS) {
        next = tier;
        setFit(tier);
        if (list.scrollWidth <= list.clientWidth + 1) break;
      }
    }
    setFit(next);
  }
  function setFit(tier: TabFit): void {
    fitted = tier;
    if (tier) list.dataset.fit = tier;
    else delete list.dataset.fit;
  }
  let lastWidth = -1;
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      // Nur auf Breitenwechsel – die eigene Stufe ändert die Breite der Leiste nicht.
      if (list.clientWidth === lastWidth) return;
      lastWidth = list.clientWidth;
      fit();
    }).observe(list);
  }
  // Schriften kommen per `font-display: swap` später: danach neu messen.
  document.fonts?.addEventListener?.('loadingdone', () => fit());

  select('niches');

  return {
    element: list,
    button: (tab) => buttons.get(tab)!,
    select,
    setVisible(tab, show) {
      const button = buttons.get(tab)!;
      if (button.hidden === !show) return;
      button.hidden = !show;
      // Neu erschienen (Landschaft freigeschaltet): kurz „eingeklebt“.
      if (show) button.classList.add('tab-new');
      fit();
    },
    setDot(tab, on) {
      const dot = buttons.get(tab)!.querySelector<HTMLElement>('.tab-dot')!;
      if (dot.hidden === !on) return;
      dot.hidden = !on;
    },
    setOrientation(orientation) {
      setAttr(list, 'aria-orientation', orientation);
      vertical = orientation === 'vertical';
      fit();
    },
    fit,
  };
}
