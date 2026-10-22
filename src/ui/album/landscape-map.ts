/**
 * Handgezeichnete Karte der Landschaft im Reiter „Landschaft“ (docs/ALBUM_UI.md, B.5 und
 * A.10 #109; DESIGN_V2.md 24.5, 24.6): sechs Standorte als echte Knöpfe über einer SVG-Ebene
 * mit den Korridoren (nur Zierde, aria-hidden – die Korridore stehen zusätzlich als Liste mit
 * „Bauen“ darunter). Ein Tipp auf einen Standort blättert zu U:Standort um; dort wird er
 * Ziel des nächsten Zyklus.
 *
 * DOM einmal aufbauen, `update()` setzt nur Texte, Klassen und Attribute (kein innerHTML).
 * Zustand immer auch als Text im Knopf (nicht nur Farbe): „hier“, „gegründet“, „gründen · 3 🪶“.
 */
import type { SiteId } from '../../content/landscape';
import { el, setAttr, setText, srOnly } from '../dom';
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
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'lsc-lines');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  map.append(svg);

  const sites = new Map<SiteId, SiteNode>();
  const lines = new Map<string, SVGLineElement>();

  function createSite(site: LandscapeSiteView): SiteNode {
    const button = el('button', 'lsc-site');
    button.type = 'button';
    button.dataset.site = site.id;
    button.style.left = `${left(site.x)}%`;
    button.style.top = `${top(site.y)}%`;
    const icon = el('span', 'lsc-site-icon', site.icon);
    icon.setAttribute('aria-hidden', 'true');
    const name = el('span', 'lsc-site-name');
    const status = el('span', 'lsc-site-status');
    const state = srOnly();
    button.append(icon, name, status, state);
    button.addEventListener('click', () => onSite(site.id));
    map.append(button);
    const node = { button, name, status, state };
    sites.set(site.id, node);
    return node;
  }

  function createLine(c: LandscapeCorridorView): SVGLineElement {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(left(c.from.x)));
    line.setAttribute('y1', String(top(c.from.y)));
    line.setAttribute('x2', String(left(c.to.x)));
    line.setAttribute('y2', String(top(c.to.y)));
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.dataset.corridor = c.id;
    svg.append(line);
    lines.set(c.id, line);
    return line;
  }

  return {
    element: map,
    button: (id) => sites.get(id)?.button,
    update(view, target) {
      for (const c of view.corridors) {
        const line = lines.get(c.id) ?? createLine(c);
        const cls = `lsc-line ${c.state}${c.free ? ' free' : ''}${c.wildwechsel ? ' wildwechsel' : ''}`;
        if (line.getAttribute('class') !== cls) line.setAttribute('class', cls);
      }
      for (const s of view.sites) {
        const node = sites.get(s.id) ?? createSite(s);
        setText(node.name, hyphenate(s.name));
        setText(node.status, s.status);
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
