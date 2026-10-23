/**
 * Handgezeichnete Karte der Landschaft im Reiter „Landschaft“ (docs/ALBUM_UI.md, B.5 und
 * A.10 #109; DESIGN_V2.md 24.5, 24.6): sechs Standorte als echte Knöpfe über einer SVG-Ebene
 * mit den Korridoren (nur Zierde, aria-hidden – die Korridore stehen zusätzlich als Liste mit
 * „Bauen“ darunter). Ein Tipp auf einen Standort blättert zu U:Standort um; dort wird er
 * Ziel des nächsten Zyklus.
 *
 * DOM einmal aufbauen, `update()` setzt nur Texte, Klassen und Attribute (kein innerHTML).
 * Zustand immer auch als Text im Knopf (nicht nur Farbe): „hier“, „gegründet“, „gründen · 3 🪶“,
 * gesperrt mit Grund („erst im Urwald · 5 🪶“). Das Wetter des Waldtyps steht als kleines
 * Zeichen an der Ecke, der Satz dazu als Tooltip und für Screenreader.
 *
 * **Zwei Lagen:** Breit (Doppelseite, Tablet) liegt die Karte quer (4 : 3) wie in den Daten.
 * Schmal im Hochformat (Handy) gilt eine eigene Lage über die volle Höhe (`PORTRAIT`):
 * Bergmischwald oben, Buchenhallen und Auwald in den Seitenspalten, Heimatwald in der Mitte,
 * Kiefernheide und Erlenbruch unten – so überlappen sich die Knöpfe auch mit breiter Schrift
 * und 125 % Textgröße nicht, und die Korridore bleiben zwischen ihnen sichtbar (Playtest
 * Schritt 14, S7). Beide Lagen stehen als CSS-Variablen am Knopf bzw. als eigene Linienebene;
 * das CSS wählt (landscape.css) – kein Messen, kein Umbau beim Drehen.
 */
import type { SiteId } from '../../content/landscape';
import { el, setAttr, setText, srOnly } from '../dom';
import { keepNumberWithIcon } from '../format';
import { hyphenate } from '../hyphenate';
import type { LandscapeCorridorView, LandscapeMapView, LandscapeSiteView } from '../landscape-view';
import { isOtherTarget, siteButtonExtra } from './cycle-target';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface LandscapeMap {
  readonly element: HTMLElement;
  /** Knopf eines Standorts (Fokus nach „Zurück“). */
  button(id: SiteId): HTMLButtonElement | undefined;
  update(view: LandscapeMapView, target: SiteId | null): void;
}

/** Lage auf der Karte in Prozent (Rand frei für die Beschriftung). */
const left = (x: number) => 5 + x * 90;
const top = (y: number) => 9 + y * 80;

/**
 * Hochformat: Mitte des Knopfs in Prozent der Karte. Die Seitenspalten liegen genau in der
 * Mitte ihres Drittels (16,67 % / 83,33 %), damit Knöpfe von einem Drittel Breite (CSS) die
 * mittlere Spalte nie berühren.
 */
export const PORTRAIT: Readonly<Record<SiteId, { x: number; y: number }>> = {
  mountain: { x: 50, y: 14 },
  beechwood: { x: 100 / 6, y: 34 },
  floodplain: { x: 500 / 6, y: 34 },
  home: { x: 50, y: 60 },
  heath: { x: 22, y: 87 },
  carr: { x: 78, y: 87 },
};

const portraitOf = (id: SiteId, x: number, y: number) => PORTRAIT[id] ?? { x: left(x), y: top(y) };

interface SiteNode {
  button: HTMLButtonElement;
  name: HTMLElement;
  status: HTMLElement;
  /** Zusatz nur für Screenreader: „Ziel des nächsten Zyklus“. */
  state: HTMLElement;
}

export function createLandscapeMap(onSite: (id: SiteId) => void): LandscapeMap {
  const map = el('div', 'lsc-map');
  map.dataset.ref = 'landscape-map';
  // Wischen gilt hier nicht als „Zurück“ (C.2).
  map.dataset.noSwipe = '';
  map.setAttribute('role', 'group');
  map.setAttribute('aria-label', 'Karte der Landschaft');
  /** Linienebene je Lage (quer bzw. Hochformat); das CSS zeigt genau eine. */
  const layer = (variant: 'wide' | 'portrait') => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', `lsc-lines lsc-lines-${variant}`);
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    map.append(svg);
    return svg;
  };
  const svg = layer('wide');
  const portraitSvg = layer('portrait');

  const sites = new Map<SiteId, SiteNode>();
  const lines = new Map<string, SVGLineElement[]>();

  function createSite(site: LandscapeSiteView): SiteNode {
    const button = el('button', 'lsc-site');
    button.type = 'button';
    button.dataset.site = site.id;
    const portrait = portraitOf(site.id, site.x, site.y);
    button.style.setProperty('--x', `${left(site.x)}%`);
    button.style.setProperty('--y', `${top(site.y)}%`);
    button.style.setProperty('--px', `${portrait.x}%`);
    button.style.setProperty('--py', `${portrait.y}%`);
    const icon = el('span', 'lsc-site-icon', site.icon);
    icon.setAttribute('aria-hidden', 'true');
    const name = el('span', 'lsc-site-name');
    const status = el('span', 'lsc-site-status');
    const state = srOnly();
    button.append(icon, name, status, state);
    // Wetter des Waldtyps (24.14): Zeichen an der Ecke, der Satz als Tooltip und vorgelesen.
    if (site.weather && site.weatherIcon) {
      const weather = el('span', 'lsc-site-weather', site.weatherIcon);
      weather.setAttribute('aria-hidden', 'true');
      // Tooltip am Zeichen (Maus); vorgelesen als Teil des Knopfs – nicht doppelt als Beschreibung.
      weather.title = `Wetter: ${site.weather}`;
      button.append(weather, srOnly(`, Wetter: ${site.weather}`));
    }
    // Ereignisse des Waldtyps (Phase 9, 1c): Zeichen an der linken Ecke, der Satz als Tooltip und vorgelesen.
    if (site.events && site.eventIcons) {
      const events = el('span', 'lsc-site-events', site.eventIcons);
      events.setAttribute('aria-hidden', 'true');
      events.title = `Hier öfter: ${site.events}`;
      button.append(events, srOnly(`, hier öfter: ${site.events}`));
    }
    button.addEventListener('click', () => onSite(site.id));
    map.append(button);
    const node = { button, name, status, state };
    sites.set(site.id, node);
    return node;
  }

  function line(target: SVGSVGElement, id: string, from: { x: number; y: number }, to: { x: number; y: number }): SVGLineElement {
    const node = document.createElementNS(SVG_NS, 'line');
    node.setAttribute('x1', String(from.x));
    node.setAttribute('y1', String(from.y));
    node.setAttribute('x2', String(to.x));
    node.setAttribute('y2', String(to.y));
    node.setAttribute('vector-effect', 'non-scaling-stroke');
    node.dataset.corridor = id;
    target.append(node);
    return node;
  }

  function createLines(c: LandscapeCorridorView): SVGLineElement[] {
    const [a, b] = c.id.split('-') as [SiteId, SiteId];
    const pair = [
      line(svg, c.id, { x: left(c.from.x), y: top(c.from.y) }, { x: left(c.to.x), y: top(c.to.y) }),
      line(portraitSvg, c.id, portraitOf(a, c.from.x, c.from.y), portraitOf(b, c.to.x, c.to.y)),
    ];
    lines.set(c.id, pair);
    return pair;
  }

  return {
    element: map,
    button: (id) => sites.get(id)?.button,
    update(view, target) {
      for (const c of view.corridors) {
        const pair = lines.get(c.id) ?? createLines(c);
        const cls = `lsc-line ${c.state}${c.free ? ' free' : ''}${c.wildwechsel ? ' wildwechsel' : ''}`;
        for (const node of pair) if (node.getAttribute('class') !== cls) node.setAttribute('class', cls);
      }
      for (const s of view.sites) {
        const node = sites.get(s.id) ?? createSite(s);
        setText(node.name, hyphenate(s.name));
        setText(node.status, keepNumberWithIcon(s.status));
        node.button.classList.toggle('active', s.active);
        node.button.classList.toggle('founded', s.founded);
        node.button.classList.toggle('unfounded', !s.founded);
        node.button.classList.toggle('ancient', s.ancient);
        node.button.classList.toggle('choosable', s.action !== null && !s.active);
        node.button.classList.toggle('target', isOtherTarget(view, s, target));
        setText(node.state, siteButtonExtra(view, s, target));
        if (s.active) setAttr(node.button, 'aria-current', 'location');
        else node.button.removeAttribute('aria-current');
      }
    },
  };
}
