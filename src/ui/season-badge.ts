/**
 * Abzeichen der Jahreszeit in der Kopfzeile der Seitenleiste (DESIGN_V2.md 16.6). Schlicht:
 * ein Knopf mit Symbol, Name und Restzeit; Klick, Tippen oder Enter klappt eine Zeile mit
 * den Wirkungen auf (auch per Tastatur und Touch erreichbar, nicht nur als Tooltip).
 * `update()` darf jeden Frame laufen – das DOM ändert sich nur, wenn sich ein Text ändert
 * (etwa einmal je Sekunde).
 */
import { el, setAttr, setText } from './dom';
import type { SeasonBadgeView } from './season-view';

export interface SeasonBadge {
  update(view: SeasonBadgeView): void;
  readonly element: HTMLElement;
}

export function createSeasonBadge(root: HTMLElement): SeasonBadge {
  const wrap = el('div', 'season');
  const badge = el('button', 'season-badge');
  badge.type = 'button';
  badge.dataset.ref = 'season';
  badge.setAttribute('aria-expanded', 'false');
  badge.setAttribute('aria-controls', 'season-effects');
  const effects = el('p', 'season-effects');
  effects.id = 'season-effects';
  effects.dataset.ref = 'season-effects';
  effects.hidden = true;
  badge.addEventListener('click', () => {
    effects.hidden = !effects.hidden;
    badge.setAttribute('aria-expanded', String(!effects.hidden));
  });
  wrap.append(badge, effects);
  root.append(wrap);

  function update(view: SeasonBadgeView): void {
    setText(badge, view.text);
    setAttr(badge, 'title', view.title);
    setAttr(badge, 'data-season', view.id);
    setText(effects, view.title);
  }

  return { update, element: badge };
}
