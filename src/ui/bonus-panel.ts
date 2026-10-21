/**
 * Aktive Boni in der Seitenleiste (Schritt 2.4): Zeit-Boni aus Ereignissen und bewirtete
 * Gäste mit Restzeit, dazu Wirkungen bis zum Neuen Zyklus. Schlicht – Feinschliff folgt.
 *
 * `update()` darf oft laufen: Das DOM wird nur neu gebaut, wenn sich die Ansicht ändert.
 */
import { el } from './dom';
import type { ActiveBonusView } from './view-model';

export interface BonusPanel {
  update(bonuses: readonly ActiveBonusView[]): void;
  readonly element: HTMLElement;
}

export function createBonusPanel(root: HTMLElement): BonusPanel {
  const section = el('section', 'bonuses');
  section.setAttribute('aria-label', 'Aktive Boni');
  section.dataset.ref = 'bonuses';
  const title = el('h2', 'eco-title', 'Aktive Boni');
  const list = el('ul', 'bonus-list');
  section.append(title, list);
  section.hidden = true;
  root.append(section);

  let shown = '';
  function update(bonuses: readonly ActiveBonusView[]): void {
    const key = JSON.stringify(bonuses);
    if (key === shown) return;
    shown = key;
    section.hidden = bonuses.length === 0;
    list.replaceChildren(
      ...bonuses.map((b) => {
        const li = el('li', 'bonus');
        li.dataset.bonus = b.id;
        const icon = el('span', 'bonus-icon', b.icon);
        icon.setAttribute('aria-hidden', 'true');
        li.append(icon, el('span', 'bonus-name', b.name), el('span', 'bonus-effect', b.effect), el('small', 'bonus-left', b.remaining));
        return li;
      }),
    );
  }

  return { update, element: section };
}
