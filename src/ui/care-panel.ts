/**
 * Pflege-Liste in der Seitenleiste (Schritt 2.7, DESIGN_V2.md 8): je Maßnahme nächster
 * Rang, Kosten, Wirkung, Vorschau, Blocker-Text und Kaufen-Knopf. Schlicht – Feinschliff
 * folgt durch ui-dev.
 *
 * `update()` darf oft laufen: Das DOM wird nur neu gebaut, wenn sich die Ansicht ändert.
 */
import { REPEAT_GUARD_MS, isDeliberateConfirm, isKeyRepeat } from './confirm';
import { el } from './dom';
import { formatSigned, formatSignedPercent } from './view-format';
import type { CareView } from './view-model';

export interface CarePanelCallbacks {
  onBuy(id: string): void;
}

export interface CarePanel {
  update(items: readonly CareView[]): void;
  readonly element: HTMLElement;
}

/** Vorschau in Kurzform, z. B. „⚖️ +3 · 🌿 +5 %“; leer, wenn sich nichts ändert. */
export function carePreviewText(preview: CareView['preview']): string {
  if (!preview) return '';
  const parts: string[] = [];
  if (Math.abs(preview.harmonyDelta) >= 0.05) parts.push(`⚖️ ${formatSigned(preview.harmonyDelta)}`);
  if (Math.abs(preview.growthDelta) >= 0.0005) parts.push(`🌿 ${formatSignedPercent(preview.growthDelta)}`);
  if (Math.abs(preview.seedDelta) >= 0.0005) parts.push(`🌰 ${formatSignedPercent(preview.seedDelta)}`);
  return parts.join(' · ');
}

export function createCarePanel(root: HTMLElement, callbacks: CarePanelCallbacks): CarePanel {
  const section = el('section', 'care');
  section.setAttribute('aria-label', 'Pflege');
  section.dataset.ref = 'care';
  const title = el('h2', 'eco-title', 'Pflege');
  const list = el('ul', 'care-list');
  section.append(title, list);
  section.hidden = true;
  root.append(section);

  /** Zeitpunkt des letzten Kaufs je Maßnahme (performance.now) – Sperre gegen Doppelkäufe. */
  const lastBuy = new Map<string, number>();
  interface Row {
    id: string;
    li: HTMLLIElement;
    head: HTMLElement;
    button: HTMLButtonElement | null;
    blocker: HTMLElement | null;
  }
  let rows: Row[] = [];
  let shown = '';

  function build(items: readonly CareView[]): void {
    const active = document.activeElement as HTMLElement | null;
    const focused = active?.dataset?.buyCare ?? active?.dataset?.careTitle;
    rows = items.map((item) => {
      const li = el('li', 'care-item');
      li.dataset.care = item.id;
      const head = el('p', 'care-head');
      // Ziel für den Fokus, wenn der Kaufen-Knopf nach dem letzten Rang verschwindet.
      head.tabIndex = -1;
      head.dataset.careTitle = item.id;
      const icon = el('span', 'care-icon', item.icon);
      icon.setAttribute('aria-hidden', 'true');
      head.append(icon, el('span', 'care-name', item.name), el('small', 'care-rank', item.rank));
      li.append(head);
      if (item.next) li.append(el('p', 'care-next', item.next));
      const preview = carePreviewText(item.preview);
      if (preview) {
        const p = el('p', 'care-preview hint', `Vorschau: ${preview}`);
        p.dataset.ref = 'care-preview';
        li.append(p);
      }
      let blocker: HTMLElement | null = null;
      if (item.blocker) {
        blocker = el('p', 'care-blocker hint');
        blocker.dataset.ref = 'care-blocker';
        li.append(blocker);
      }
      let button: HTMLButtonElement | null = null;
      if (item.cost) {
        button = el('button', 'care-buy', `Kaufen (${item.cost})`);
        button.type = 'button';
        button.dataset.buyCare = item.id;
        // Nicht `disabled`: Der Knopf bleibt fokussierbar (Fokus geht nach dem Kauf nicht
        // verloren) und der Sperrgrund vorlesbar. Gesperrte Klicks ignoriert der Handler.
        if (!item.canBuy) button.setAttribute('aria-disabled', 'true');
        const canBuy = item.canBuy;
        button.addEventListener('keydown', (event) => {
          // Gehaltene Enter-Taste: Wiederholungen lösen keinen weiteren Kauf aus.
          if (isKeyRepeat(event)) event.preventDefault();
        });
        button.addEventListener('click', (event) => {
          if (!canBuy) return;
          const now = performance.now();
          // Doppelklick (detail > 1) und Klicks kurz nach einem Kauf kaufen keinen zweiten Rang.
          if (!isDeliberateConfirm(event, lastBuy.get(item.id) ?? -Infinity, now, REPEAT_GUARD_MS)) return;
          lastBuy.set(item.id, now);
          callbacks.onBuy(item.id);
        });
        li.append(button);
      }
      return { id: item.id, li, head, button, blocker };
    });
    list.replaceChildren(...rows.map((r) => r.li));
    // Fokus nach dem Neuaufbau auf demselben Knopf lassen (Tastatur); ist er weg (voll
    // ausgebaut), auf den Titel der Maßnahme.
    if (focused) {
      const row = rows.find((r) => r.id === focused);
      (row?.button ?? row?.head)?.focus({ preventScroll: true });
    }
  }

  function update(items: readonly CareView[]): void {
    // Blocker-Texte wie „Noch 250 🌰“ ändern sich mit jedem Samen: Sie werden an Ort und
    // Stelle ersetzt. Neu gebaut wird nur, wenn sich mehr ändert (sonst ginge z. B. ein
    // Klick zwischen mousedown und mouseup verloren).
    const key = JSON.stringify(items.map((i) => ({ ...i, blocker: i.blocker !== null })));
    if (key !== shown) {
      shown = key;
      section.hidden = items.length === 0;
      build(items);
    }
    items.forEach((item, i) => {
      const row = rows[i];
      if (!row || row.id !== item.id) return;
      if (row.blocker && row.blocker.textContent !== item.blocker) row.blocker.textContent = item.blocker;
      if (row.button && !item.canBuy && item.blocker) {
        const label = `Kaufen (${item.cost}) – gesperrt: ${item.blocker}`;
        if (row.button.getAttribute('aria-label') !== label) row.button.setAttribute('aria-label', label);
      }
    });
  }

  return { update, element: section };
}
