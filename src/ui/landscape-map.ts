/**
 * Karte der Landschaft im Bereich „Neuer Zyklus“ (DESIGN_V2.md 24.5, 24.6): sechs Standorte
 * als echte Knöpfe über einer SVG-Ebene mit den Korridoren (nur Zierde, aria-hidden – die
 * Korridore stehen zusätzlich als Liste mit Kaufknöpfen darunter). Ein Klick auf einen
 * Standort zeigt seine Angaben; ist er wählbar, wird er Ziel des nächsten Zyklus.
 *
 * DOM einmal aufbauen, `update()` setzt nur Texte, Klassen und Attribute (kein innerHTML).
 * View-Model in landscape-view.ts.
 */
import type { SiteId } from '../content/landscape';
import { el, setAttr, setText } from './dom';
import { formatNumber } from './format';
import { hyphenate } from './hyphenate';
import type { LandscapeCorridorView, LandscapeMapView, LandscapeSiteView } from './landscape-view';
import { targetText } from './landscape-view';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface LandscapeMapCallbacks {
  /** Ziel des nächsten Zyklus hat sich geändert (auch beim Zurückfallen auf „hier“). */
  onTargetChange(target: SiteId): void;
  /** Kaufknopf eines Korridors. */
  onBuildCorridor(id: string): void;
}

export interface LandscapeMap {
  readonly element: HTMLElement;
  update(view: LandscapeMapView | null): void;
  /** Ziel des nächsten Zyklus (aktiver Wald, wenn nichts anderes gewählt ist). */
  target(): SiteId | null;
  /** Auswahl auf den aktiven Wald zurücksetzen (nach dem Neuen Zyklus, Import). */
  reset(): void;
}

/** Lage auf der Karte in Prozent (Rand frei für die Beschriftung). */
const left = (x: number) => 8 + x * 84;
const top = (y: number) => 9 + y * 80;

interface SiteNode {
  button: HTMLButtonElement;
  icon: HTMLElement;
  name: HTMLElement;
  status: HTMLElement;
}

interface CorridorNode {
  line: SVGLineElement;
  row: HTMLLIElement;
  name: HTMLElement;
  ends: HTMLElement;
  note: HTMLElement;
  build: HTMLButtonElement;
}

export function createLandscapeMap(callbacks: LandscapeMapCallbacks): LandscapeMap {
  const root = el('div', 'landscape');
  root.dataset.ref = 'landscape';
  const heading = el('h3', 'landscape-title', 'Waldlandschaft');
  const question = el('p', 'landscape-question');
  const seeds = el('p', 'landscape-seeds');
  seeds.dataset.ref = 'jay-seeds';

  const map = el('div', 'landscape-map');
  map.dataset.ref = 'landscape-map';
  map.setAttribute('role', 'group');
  map.setAttribute('aria-label', 'Karte der Landschaft');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'landscape-lines');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  map.append(svg);

  const detail = el('div', 'landscape-detail');
  detail.dataset.ref = 'site-detail';
  detail.id = 'landscape-detail';
  detail.setAttribute('aria-live', 'polite');
  const dTitle = el('h4', 'landscape-detail-title');
  const dType = el('p', 'landscape-detail-type');
  const dText = el('p', 'landscape-detail-text');
  const dMemory = el('p', 'landscape-detail-line');
  dMemory.dataset.ref = 'site-memory';
  const dTree = el('p', 'landscape-detail-line');
  const dAncient = el('p', 'landscape-detail-line');
  const dGains = el('p', 'landscape-detail-line landscape-gain');
  const dCosts = el('p', 'landscape-detail-line landscape-cost');
  const dGift = el('p', 'landscape-detail-line landscape-gift');
  const dBlocker = el('p', 'landscape-blocker');
  dBlocker.dataset.ref = 'site-blocker';
  detail.append(dTitle, dType, dText, dMemory, dTree, dAncient, dGains, dCosts, dGift, dBlocker);

  const target = el('p', 'landscape-target');
  target.dataset.ref = 'landscape-target';

  const corridorTitle = el('h4', 'landscape-corridors-title', 'Korridore');
  const corridorList = el('ul', 'landscape-corridors');
  corridorList.dataset.ref = 'corridors';
  const corridorHint = el('p', 'hint landscape-corridor-hint');

  root.append(heading, question, seeds, map, target, detail, corridorTitle, corridorList, corridorHint);

  const siteNodes = new Map<SiteId, SiteNode>();
  const corridorNodes = new Map<string, CorridorNode>();
  let view: LandscapeMapView | null = null;
  /** Angezeigter Standort (Angaben) und Ziel des nächsten Zyklus. */
  let selected: SiteId | null = null;
  let chosen: SiteId | null = null;

  function createSite(site: LandscapeSiteView): SiteNode {
    const button = el('button', 'landscape-site');
    button.type = 'button';
    button.dataset.site = site.id;
    button.style.left = `${left(site.x)}%`;
    button.style.top = `${top(site.y)}%`;
    button.setAttribute('aria-controls', detail.id);
    const icon = el('span', 'landscape-site-icon', site.icon);
    icon.setAttribute('aria-hidden', 'true');
    const name = el('span', 'landscape-site-name');
    const status = el('span', 'landscape-site-status');
    button.append(icon, name, status);
    button.addEventListener('click', () => select(site.id));
    map.append(button);
    const node = { button, icon, name, status };
    siteNodes.set(site.id, node);
    return node;
  }

  function createCorridor(c: LandscapeCorridorView): CorridorNode {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(left(c.from.x)));
    line.setAttribute('y1', String(top(c.from.y)));
    line.setAttribute('x2', String(left(c.to.x)));
    line.setAttribute('y2', String(top(c.to.y)));
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.dataset.corridor = c.id;
    svg.append(line);
    const row = el('li', 'landscape-corridor');
    row.dataset.corridor = c.id;
    const icon = el('span', 'landscape-corridor-icon', c.icon);
    icon.setAttribute('aria-hidden', 'true');
    const text = el('span', 'landscape-corridor-text');
    const name = el('span', 'landscape-corridor-name');
    const ends = el('small', 'landscape-corridor-ends');
    const note = el('small', 'landscape-corridor-note');
    note.id = `landscape-corridor-note-${c.id}`;
    text.append(name, ends, note);
    const build = el('button', 'landscape-build');
    build.type = 'button';
    build.dataset.build = c.id;
    build.setAttribute('aria-describedby', note.id);
    build.addEventListener('click', () => callbacks.onBuildCorridor(c.id));
    row.append(icon, text, build);
    row.title = c.text;
    corridorList.append(row);
    const node = { line, row, name, ends, note, build };
    corridorNodes.set(c.id, node);
    return node;
  }

  const siteOf = (id: SiteId | null) => view?.sites.find((s) => s.id === id);

  /** Ziel: gewählt und noch wählbar, sonst der aktive Wald. */
  function currentTarget(): SiteId | null {
    if (!view) return null;
    const pick = siteOf(chosen);
    return pick && pick.action !== null ? pick.id : view.active;
  }

  function select(id: SiteId): void {
    selected = id;
    const site = siteOf(id);
    const before = currentTarget();
    if (site && site.action !== null && view?.allowed) chosen = id;
    render();
    const after = currentTarget();
    if (after && after !== before) callbacks.onTargetChange(after);
  }

  function render(): void {
    if (!view) return;
    const tgt = currentTarget();
    const shown = siteOf(selected) ?? siteOf(tgt) ?? view.sites[0]!;
    for (const s of view.sites) {
      const node = siteNodes.get(s.id) ?? createSite(s);
      setText(node.name, hyphenate(s.name));
      setText(node.status, s.status);
      node.button.classList.toggle('active', s.active);
      node.button.classList.toggle('founded', s.founded);
      node.button.classList.toggle('unfounded', !s.founded);
      node.button.classList.toggle('ancient', s.ancient);
      node.button.classList.toggle('choosable', s.action !== null && !s.active);
      node.button.classList.toggle('target', s.id === tgt && view.allowed);
      node.button.classList.toggle('shown', s.id === shown.id);
      setAttr(node.button, 'aria-pressed', String(s.id === shown.id));
      if (s.active) setAttr(node.button, 'aria-current', 'location');
      else node.button.removeAttribute('aria-current');
    }
    setText(dTitle, `${shown.icon} ${shown.name}`);
    setText(dType, shown.forestType);
    setText(dText, shown.text);
    setText(dMemory, shown.memory);
    setText(dTree, shown.tree);
    dAncient.hidden = shown.ancientText === null;
    setText(dAncient, shown.ancientText ?? '');
    dGains.hidden = shown.gains === null;
    setText(dGains, shown.gains ? `Eigenheit (nur hier): ${shown.gains}` : '');
    dCosts.hidden = shown.costs === null;
    setText(dCosts, shown.costs ? `Verzicht (nur hier): ${shown.costs}` : '');
    dGift.hidden = shown.gift === null;
    setText(dGift, shown.gift ? `Gabe (${shown.giftActive ? 'wirkt schon' : 'nach der Gründung'}): ${shown.gift}` : '');
    dGift.classList.toggle('inactive', !shown.giftActive);
    dBlocker.hidden = shown.blocker === null;
    setText(dBlocker, shown.blocker ?? '');
    const active = siteOf(view.active);
    target.hidden = !view.allowed;
    setText(target, targetText(siteOf(tgt), active ? `${active.icon} ${active.name}` : ''));
  }

  function update(next: LandscapeMapView | null): void {
    const before = currentTarget();
    view = next;
    root.hidden = next === null;
    if (!next) return;
    setText(question, next.question);
    setText(seeds, next.jaySeeds);
    for (const c of next.corridors) {
      const node = corridorNodes.get(c.id) ?? createCorridor(c);
      const lineClass = `landscape-line ${c.state}${c.free ? ' free' : ''}`;
      if (node.line.getAttribute('class') !== lineClass) node.line.setAttribute('class', lineClass);
      node.row.hidden = !c.listed;
      node.row.classList.toggle('built', c.state === 'built');
      setText(node.name, c.name);
      setText(node.ends, c.ends);
      setText(node.note, c.state === 'buildable' ? c.text : c.note);
      node.build.hidden = c.state === 'built';
      node.build.disabled = c.state !== 'buildable';
      setText(node.build, `Bauen · ${formatNumber(c.cost)} 🪶`);
      setAttr(node.build, 'aria-label', `${c.name} bauen, ${formatNumber(c.cost)} Hähersaat`);
    }
    corridorHint.hidden = next.corridorHint === null;
    setText(corridorHint, next.corridorHint ?? '');
    render();
    const after = currentTarget();
    if (after !== before && after) callbacks.onTargetChange(after);
  }

  return {
    element: root,
    update,
    target: currentTarget,
    reset() {
      chosen = null;
      selected = null;
      render();
    },
  };
}
