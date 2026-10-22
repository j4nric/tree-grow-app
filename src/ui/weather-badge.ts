/**
 * Wetter-Abzeichen neben der Jahreszeit (DESIGN_V2.md 21.8): ein Knopf „🌬️ Sturm · −7,5 % 🌿 ·
 * +25 % 🌰“, der eine Erklärung aufklappt – Stimmung, Wirkung heute, Dämpfung, Vorhersage für
 * morgen und Tag/Nacht. Wie das Jahreszeiten-Abzeichen per Klick, Tippen, Enter und Leertaste
 * bedienbar (kein reiner Hover-Tooltip); Escape klappt zu und lässt den Fokus am Knopf.
 * `update()` darf jeden Frame laufen – das DOM ändert sich nur bei neuen Texten.
 */
import { el, setAttr, setText } from './dom';
import type { WeatherBadgeView } from './weather-view';

export interface WeatherBadge {
  update(view: WeatherBadgeView): void;
  readonly element: HTMLButtonElement;
}

/**
 * `anchor`: Knopf, hinter dem das Abzeichen in der DOM-Reihenfolge steht (Jahreszeit) – so
 * folgen beide Knöpfe in der Tab-Reihenfolge direkt aufeinander, die Erklärung danach.
 */
export function createWeatherBadge(root: HTMLElement, anchor?: HTMLElement): WeatherBadge {
  const badge = el('button', 'weather-badge');
  badge.type = 'button';
  badge.dataset.ref = 'weather';
  badge.setAttribute('aria-expanded', 'false');
  badge.setAttribute('aria-controls', 'weather-details');

  const details = el('div', 'weather-details');
  details.id = 'weather-details';
  details.dataset.ref = 'weather-details';
  details.setAttribute('role', 'region');
  details.setAttribute('aria-label', 'Wetter heute');
  details.hidden = true;
  const line = (cls: string, ref: string) => {
    const p = el('p', cls);
    p.dataset.ref = ref;
    details.append(p);
    return p;
  };
  const mood = line('weather-mood', 'weather-mood');
  const effects = line('weather-line', 'weather-effects');
  const damping = line('weather-line', 'weather-damping');
  const tip = line('weather-line weather-tip', 'weather-tip');
  const forecast = line('weather-line', 'weather-forecast');
  const daytime = line('weather-line', 'weather-daytime');
  const note = line('weather-line weather-tip', 'weather-daytime-note');

  let open = false;
  const toggle = (next: boolean) => {
    open = next;
    details.hidden = !open;
    badge.setAttribute('aria-expanded', String(open));
  };
  badge.addEventListener('click', () => toggle(!open));
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    toggle(false);
    badge.focus();
  };
  badge.addEventListener('keydown', closeOnEscape);
  details.addEventListener('keydown', closeOnEscape);

  if (anchor?.parentElement) anchor.after(badge);
  else root.append(badge);
  root.append(details);

  const setLine = (p: HTMLElement, text: string | null) => {
    setText(p, text ?? '');
    p.hidden = !text;
  };

  function update(view: WeatherBadgeView): void {
    setText(badge, view.text);
    setAttr(badge, 'aria-label', view.label);
    setAttr(badge, 'title', view.title);
    setAttr(badge, 'data-weather', view.id);
    badge.classList.toggle('rough', view.rough);
    setLine(mood, view.mood);
    setLine(effects, view.effects);
    setLine(damping, view.damping);
    setLine(tip, view.tip);
    setLine(forecast, view.forecast);
    setLine(daytime, view.daytime);
    setLine(note, view.daytimeNote);
  }

  return { update, element: badge };
}
