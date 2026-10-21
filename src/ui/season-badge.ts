/**
 * Abzeichen der Jahreszeit in der Kopfzeile der Seitenleiste (DESIGN_V2.md 16.6). Schlicht:
 * Symbol, Name, Restzeit; die Wirkungen als Tooltip. `update()` darf jeden Frame laufen –
 * das DOM ändert sich nur, wenn sich der Text ändert (etwa einmal je Sekunde).
 */
import { el, setAttr, setText } from './dom';
import type { SeasonBadgeView } from './season-view';

export interface SeasonBadge {
  update(view: SeasonBadgeView): void;
  readonly element: HTMLElement;
}

export function createSeasonBadge(root: HTMLElement): SeasonBadge {
  const badge = el('p', 'season-badge');
  badge.dataset.ref = 'season';
  root.append(badge);

  function update(view: SeasonBadgeView): void {
    setText(badge, view.text);
    setAttr(badge, 'title', view.title);
    setAttr(badge, 'data-season', view.id);
  }

  return { update, element: badge };
}
