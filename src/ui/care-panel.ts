/**
 * Pflege-Liste in der Seitenleiste (Schritt 2.7, DESIGN_V2.md 8): je Maßnahme nächster
 * Rang, Kosten, Wirkung, Vorschau, Blocker-Text und Kaufen-Knopf. Schlicht – Feinschliff
 * folgt durch ui-dev.
 *
 * `update()` darf oft laufen: Das DOM wird nur neu gebaut, wenn sich die Ansicht ändert.
 */
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

  let shown = '';
  function update(items: readonly CareView[]): void {
    const key = JSON.stringify(items);
    if (key === shown) return;
    shown = key;
    section.hidden = items.length === 0;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.buyCare;
    const rows = items.map((item) => {
      const li = el('li', 'care-item');
      li.dataset.care = item.id;
      const head = el('p', 'care-head');
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
      if (item.blocker) {
        const b = el('p', 'care-blocker hint', item.blocker);
        b.dataset.ref = 'care-blocker';
        li.append(b);
      }
      let button: HTMLButtonElement | null = null;
      if (item.cost) {
        button = el('button', 'care-buy', `Kaufen (${item.cost})`);
        button.type = 'button';
        button.dataset.buyCare = item.id;
        button.disabled = !item.canBuy;
        button.addEventListener('click', () => callbacks.onBuy(item.id));
        li.append(button);
      }
      return { li, button, id: item.id };
    });
    list.replaceChildren(...rows.map((r) => r.li));
    // Fokus nach dem Neuaufbau auf demselben Knopf lassen (Tastatur).
    if (focused) rows.find((r) => r.id === focused)?.button?.focus({ preventScroll: true });
  }

  return { update, element: section };
}
