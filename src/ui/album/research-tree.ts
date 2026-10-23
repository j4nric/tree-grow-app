/**
 * Forschungsbaum im Album-Stil (docs/DESIGN_V2.md 27.12, ROADMAP Phase 10, 1c).
 *
 * Eigenständige Ansicht: baut das DOM einmal aus `RESEARCH` / `RESEARCH_BRANCHES` /
 * `RESEARCH_FORKS` (Aufbau aus `research-view.ts`), `update(state)` setzt danach nur Texte,
 * Klassen und Attribute. Noch nicht im Reiter eingehängt (das ist 4a) – zu sehen in
 * `src/ui/research-preview.html`.
 *
 * Zwei Darstellungen desselben DOM, umgeschaltet nach der Breite des Baums (nicht des
 * Fensters – im Album ist die rechte Seite schmaler als der Bildschirm):
 * - **Liste** (schmal, z. B. 360/390 px oder eine Album-Seite): Ast-Register oben (Sprung
 *   zum Ast), darunter die Äste als aufklappbare Abschnitte mit senkrechtem Zweig, Knoten
 *   als Karten gruppiert nach Ebenen („ab Alter Baum“). Gabeln: zwei halbe Karten mit
 *   „oder“. Unter 640 px sind anfangs nur Äste mit erforschbarem Knoten offen.
 * - **Raster** (ab GRID_MIN_WIDTH): sechs Spalten (Äste) × fünf Zeilen (Ebenen), dünne
 *   SVG-Linien zwischen Karten desselben Asts, einmal je Layout gezeichnet (ResizeObserver),
 *   nie je Frame.
 *
 * Voraussetzungen aus anderen Ästen stehen als Etikett „braucht 🌳 Nistkästen ›“ an der
 * Karte und springen dorthin (Ast aufklappen, Fokus, kurzes Aufleuchten).
 */
import { RESEARCH_BY_ID, type ResearchBranchId } from '../../content/research';
import { el, setAttr, setText, srOnly } from '../dom';
import { prefersReducedMotion, restartAnimation } from '../feedback';
import { hyphenate } from '../hyphenate';
import {
  assignLanes,
  branchSummary,
  edgeSide,
  researchForkView,
  researchHeader,
  researchLayout,
  researchNodeView,
  tierLabel,
  type ResearchSlot,
  type ResearchTreeState,
} from '../research-view';
import './research-tree.css';

/** Ab dieser Breite des Baums (px) das Raster 6 × 5 statt der Liste. */
export const GRID_MIN_WIDTH = 940;
/** Unter dieser Breite sind anfangs nur Äste mit erforschbarem Knoten offen. */
export const COLLAPSE_BELOW = 640;
/** Abstand der ersten Linien-Spur vom Spaltenrand und zwischen Spuren (px). */
const LANE_FIRST = 5;
const LANE_STEP = 5;

export type ResearchTreeLayoutMode = 'grid' | 'list';

export interface ResearchTreeOptions {
  /** Knopf „Erforschen“ (nur bei erforschbaren Knoten). */
  onResearch(id: string): void;
  /** Name angetippt → U:Forschungsknoten (4a). Ohne: Name ist kein Knopf. */
  onOpen?(id: string): void;
  /** Darstellung erzwingen (Tests); Standard: nach Breite. */
  layout?: ResearchTreeLayoutMode | 'auto';
}

export interface ResearchTree {
  root: HTMLElement;
  update(state: ResearchTreeState): void;
  /** Knoten zeigen: Ast aufklappen, Fokus, Aufleuchten. false, wenn es ihn nicht gibt. */
  reveal(id: string): boolean;
  /** Beobachter lösen. */
  destroy(): void;
}

interface NodeParts {
  id: string;
  card: HTMLElement;
  status: HTMLElement;
  stamp: HTMLElement;
  reason: HTMLElement;
  action: HTMLButtonElement;
  focusTarget: HTMLElement;
  refs: { id: string; button: HTMLButtonElement; done: boolean }[];
  baseClass: string;
}

interface BranchParts {
  id: ResearchBranchId;
  section: HTMLElement;
  toggle: HTMLButtonElement;
  toggleSummary: HTMLElement;
  headSummary: HTMLElement;
  body: HTMLElement;
  tab: HTMLButtonElement;
  tabCount: HTMLElement;
  name: string;
  nodeIds: readonly string[];
}

interface ForkParts {
  id: string;
  group: HTMLElement;
  hint: HTMLElement | null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createResearchTree(options: ResearchTreeOptions): ResearchTree {
  const layout = researchLayout();
  const root = el('section', 'research-tree');
  root.setAttribute('aria-label', 'Forschungsbaum');
  root.dataset.layout = options.layout === 'grid' ? 'grid' : 'list';

  // --- Kopf: Vorrat, Produktion, erforschbar ---------------------------------------------
  const head = el('div', 'research-head');
  const supply = el('span', 'research-supply');
  const rate = el('span', 'research-rate');
  const count = el('span', 'research-count');
  head.append(supply, rate, count);

  // --- Ast-Register (nur Liste) -----------------------------------------------------------
  const register = el('nav', 'research-register');
  register.setAttribute('aria-label', 'Äste');

  // --- Brett: Raster bzw. Liste ----------------------------------------------------------
  const board = el('div', 'research-board');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'research-links');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  board.append(svg);

  // Zeilenköpfe und Trennlinien der Ebenen (nur Raster)
  layout.stages.forEach((stage, row) => {
    const rule = el('div', 'research-row-rule');
    rule.style.gridRow = String(row + 2);
    rule.setAttribute('aria-hidden', 'true');
    const label = el('div', 'research-row-label', tierLabel(stage));
    label.style.gridRow = String(row + 2);
    label.setAttribute('aria-hidden', 'true');
    board.append(rule, label);
  });

  const nodes = new Map<string, NodeParts>();
  const branches = new Map<string, BranchParts>();
  const forks: ForkParts[] = [];
  const uid = `rt${Math.random().toString(36).slice(2, 8)}`;

  const buildNode = (id: string, half: boolean, color: string): HTMLElement => {
    const node = RESEARCH_BY_ID.get(id)!;
    const baseClass = half ? 'research-node research-node-half' : 'research-node';
    const card = el('div', baseClass);
    card.dataset.node = id;
    card.style.setProperty('--branch-color', color);

    const icon = el('span', 'research-node-icon', node.icon);
    icon.setAttribute('aria-hidden', 'true');

    let nameEl: HTMLElement;
    if (options.onOpen) {
      const b = el('button', 'research-node-name');
      b.type = 'button';
      b.append(el('span', 'research-node-name-text', hyphenate(node.name)));
      b.setAttribute('aria-label', `${node.name} – Details`);
      b.addEventListener('click', () => options.onOpen?.(id));
      nameEl = b;
    } else {
      nameEl = el('h4', 'research-node-name', hyphenate(node.name));
      nameEl.tabIndex = -1;
    }
    const status = srOnly();
    const summary = el('p', 'research-node-summary', node.summary);
    const stamp = el('span', 'research-node-stamp', 'erforscht');
    stamp.setAttribute('aria-hidden', 'true');
    const reason = el('p', 'research-node-reason sr-only');

    const refs: NodeParts['refs'] = [];
    const refList = el('ul', 'research-node-refs');
    const action = el('button', 'research-node-action');
    action.type = 'button';
    action.addEventListener('click', () => {
      if (action.getAttribute('aria-disabled') === 'true') return;
      options.onResearch(id);
    });

    card.append(icon, nameEl, status, summary);
    const parts: NodeParts = { id, card, status, stamp, reason, action, focusTarget: nameEl, refs, baseClass };
    nodes.set(id, parts);
    // Querverweise erst bauen, wenn alle Knoten stehen (siehe unten) – hier nur die Liste.
    card.append(refList, stamp, reason, action);
    return card;
  };

  const buildSlot = (slot: ResearchSlot, color: string): HTMLLIElement => {
    const li = el('li', 'research-slot');
    if (slot.kind === 'node') {
      li.append(buildNode(slot.id, false, color));
      return li;
    }
    li.classList.add('research-fork');
    li.dataset.fork = slot.forkId;
    li.setAttribute('role', 'group');
    let hint: HTMLElement | null = null;
    if (slot.first) {
      hint = el('p', 'research-fork-hint');
      li.append(hint);
    }
    const pair = el('div', 'research-fork-pair');
    const or = el('span', 'research-fork-or', 'oder');
    pair.append(buildNode(slot.ids[0], true, color), or, buildNode(slot.ids[1], true, color));
    li.append(pair);
    forks.push({ id: slot.forkId, group: li, hint });
    return li;
  };

  layout.branches.forEach((b, col) => {
    const { branch } = b;
    const section = el('section', 'research-branch');
    section.dataset.branch = branch.id;
    section.style.setProperty('--branch-color', branch.color);
    section.style.gridColumn = String(col + 2);
    section.style.setProperty('--rows', String(layout.stages.length + 1));
    const titleId = `${uid}-${branch.id}-title`;
    const bodyId = `${uid}-${branch.id}-body`;
    section.setAttribute('aria-labelledby', titleId);

    const title = el('h3', 'research-branch-title');
    title.id = titleId;
    // Liste: aufklappbarer Kopf; Raster: schlichte Überschrift (je eins per CSS verborgen).
    const toggle = el('button', 'research-branch-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', bodyId);
    toggle.setAttribute('aria-expanded', 'true');
    const toggleSummary = el('span', 'research-branch-summary');
    const chevron = el('span', 'research-branch-chevron', '›');
    chevron.setAttribute('aria-hidden', 'true');
    const tIcon = el('span', 'research-branch-icon', branch.icon);
    tIcon.setAttribute('aria-hidden', 'true');
    toggle.append(tIcon, el('span', 'research-branch-name', branch.name), toggleSummary, chevron);
    const heading = el('span', 'research-branch-heading');
    const hIcon = el('span', 'research-branch-icon', branch.icon);
    hIcon.setAttribute('aria-hidden', 'true');
    const headSummary = el('span', 'research-branch-summary');
    heading.append(hIcon, el('span', 'research-branch-name', branch.name), headSummary);
    title.append(toggle, heading);

    const body = el('div', 'research-branch-body');
    body.id = bodyId;
    for (const tier of b.tiers) {
      const t = el('div', 'research-tier');
      t.dataset.stage = String(tier.stage);
      t.style.gridRow = String(tier.row + 2);
      const label = el('p', 'research-tier-label', tierLabel(tier.stage));
      const list = el('ul', 'research-tier-slots');
      list.setAttribute('aria-label', `${branch.name}, ${tierLabel(tier.stage)}`);
      for (const slot of tier.slots) list.append(buildSlot(slot, branch.color));
      t.append(label, list);
      body.append(t);
    }
    section.append(title, body);
    board.append(section);

    // Register-Reiter
    const tab = el('button', 'research-register-tab');
    tab.type = 'button';
    tab.style.setProperty('--branch-color', branch.color);
    const tabIcon = el('span', 'research-register-icon', branch.icon);
    tabIcon.setAttribute('aria-hidden', 'true');
    const tabName = el('span', 'research-register-name', branch.name);
    const tabCount = el('span', 'research-register-count');
    tabCount.setAttribute('aria-hidden', 'true');
    tab.append(tabIcon, tabName, tabCount);
    tab.addEventListener('click', () => {
      setOpen(parts, true);
      scrollTo(section);
      toggle.focus({ preventScroll: true });
    });
    register.append(tab);

    const parts: BranchParts = { id: branch.id, section, toggle, toggleSummary, headSummary, body, tab, tabCount, name: branch.name, nodeIds: b.nodeIds };
    toggle.addEventListener('click', () => {
      userToggled = true;
      setOpen(parts, toggle.getAttribute('aria-expanded') !== 'true');
    });
    branches.set(branch.id, parts);
  });

  // Querverweise „braucht 🌳 Nistkästen ›“ (Knoten anderer Äste)
  for (const parts of nodes.values()) {
    const list = parts.card.querySelector<HTMLUListElement>('.research-node-refs')!;
    const view = researchNodeView(parts.id, { harmony: 0, perMinute: 0, stage: 0, nodes: {} });
    for (const ref of view.crossRefs) {
      const li = el('li');
      const button = el('button', 'research-ref');
      button.type = 'button';
      button.setAttribute('aria-label', ref.label);
      const chip = el('span', 'research-ref-chip');
      chip.append(el('span', 'research-ref-word', 'braucht'), ` ${ref.text}\u00a0›`);
      button.append(chip);
      button.addEventListener('click', () => reveal(ref.id));
      li.append(button);
      list.append(li);
      parts.refs.push({ id: ref.id, button, done: false });
    }
    list.hidden = view.crossRefs.length === 0;
  }

  // Kanten (nur Raster): ein Pfad je Verbindung, Lage beim Layout gesetzt
  const edgePaths = layout.edges.map((edge) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', edge.any ? 'research-link is-any' : 'research-link');
    const color = nodes.get(edge.to)!.card.style.getPropertyValue('--branch-color');
    path.style.setProperty('--branch-color', color);
    svg.append(path);
    return { edge, path };
  });

  root.append(head, register, board);

  // --- Auf- und Zuklappen ----------------------------------------------------------------
  let userToggled = false;
  let initialOpenDone = false;

  function setOpen(parts: BranchParts, open: boolean): void {
    setAttr(parts.toggle, 'aria-expanded', String(open));
    parts.section.classList.toggle('is-collapsed', !open);
  }

  function scrollTo(target: HTMLElement): void {
    target.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function reveal(id: string): boolean {
    const parts = nodes.get(id);
    const node = RESEARCH_BY_ID.get(id);
    if (!parts || !node) return false;
    const branch = branches.get(node.branch);
    if (branch) setOpen(branch, true);
    parts.card.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    parts.focusTarget.focus({ preventScroll: true });
    restartAnimation(parts.card, 'research-flash');
    return true;
  }

  // --- Darstellung nach Breite -----------------------------------------------------------
  let mode: ResearchTreeLayoutMode = root.dataset.layout as ResearchTreeLayoutMode;
  let observer: ResizeObserver | null = null;
  let boardObserver: ResizeObserver | null = null;

  function applyMode(width: number): void {
    if (options.layout === 'grid' || options.layout === 'list') return;
    const next: ResearchTreeLayoutMode = width >= GRID_MIN_WIDTH ? 'grid' : 'list';
    if (next !== mode) {
      mode = next;
      root.dataset.layout = next;
    }
  }

  /**
   * SVG-Linien neu legen – nur bei Größenänderung (ResizeObserver), nie je Frame. Jede
   * Verbindung läuft als Leitung im Zwischenraum neben der Spalte: aus der Seite der Quelle,
   * senkrecht in ihrer Spur, in die Seite des Ziels (Weg B einer Gabel rechts, sonst links).
   */
  function drawLinks(): void {
    if (mode !== 'grid') return;
    const box = board.getBoundingClientRect();
    if (box.width === 0) return;
    svg.setAttribute('width', String(Math.round(box.width)));
    svg.setAttribute('height', String(Math.round(box.height)));
    svg.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
    const geo = edgePaths.map(({ edge }, i) => {
      const a = nodes.get(edge.from)!.card.getBoundingClientRect();
      const b = nodes.get(edge.to)!.card.getBoundingClientRect();
      const col = branches.get(RESEARCH_BY_ID.get(edge.to)!.branch)!.section.getBoundingClientRect();
      const side = edgeSide(edge);
      const y1 = a.top + Math.min(26, a.height / 2) - box.top;
      const y2 = b.top + Math.min(26, b.height / 2) - box.top;
      return { i, side, a, b, col, y1, y2 };
    });
    const lanes = assignLanes(
      geo.map((g) => ({ key: String(g.i), group: `${g.col.left}|${g.side}`, top: g.y1, bottom: g.y2 })),
    );
    for (const g of geo) {
      const lane = lanes.get(String(g.i)) ?? 0;
      const left = g.side === 'left';
      const x1 = (left ? g.a.left : g.a.right) - box.left;
      const x2 = (left ? g.b.left : g.b.right) - box.left;
      const edgeX = (left ? g.col.left : g.col.right) - box.left;
      const lx = edgeX + (left ? -1 : 1) * (LANE_FIRST + lane * LANE_STEP);
      edgePaths[g.i]!.path.setAttribute(
        'd',
        `M${x1.toFixed(1)} ${g.y1.toFixed(1)} H${lx.toFixed(1)} V${g.y2.toFixed(1)} H${x2.toFixed(1)}`,
      );
    }
  }

  // Beobachter melden nur; umgeschaltet und gezeichnet wird im nächsten Frame (sonst löst die
  // Umschaltung im Beobachter selbst eine weitere Meldung aus – „ResizeObserver loop“).
  let pending = 0;
  function schedule(): void {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      applyMode(root.getBoundingClientRect().width);
      drawLinks();
    });
  }
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(schedule);
    observer.observe(root);
    // Höhe der Karten ändert sich mit den Texten → Linien nachziehen.
    boardObserver = new ResizeObserver(schedule);
    boardObserver.observe(board);
  }

  // --- update ----------------------------------------------------------------------------
  function update(state: ResearchTreeState): void {
    const h = researchHeader(state);
    setText(supply, h.supply);
    setText(rate, h.rate);
    setText(count, h.available);
    count.classList.toggle('is-some', h.count > 0);

    const shown = new Map<string, string>();
    for (const parts of nodes.values()) {
      const view = researchNodeView(parts.id, state);
      shown.set(parts.id, view.status);
      const cls = `${parts.baseClass} ${view.classes.join(' ')}`;
      if (parts.card.className.replace(/\s*research-flash/, '') !== cls) {
        const flashing = parts.card.classList.contains('research-flash');
        parts.card.className = cls;
        if (flashing) parts.card.classList.add('research-flash');
      }
      parts.card.dataset.status = view.status;
      setText(parts.status, `, ${view.statusText}`);
      setText(parts.reason, view.reason ?? '');
      parts.stamp.hidden = view.status !== 'researched';
      parts.action.hidden = !view.showAction;
      setText(parts.action, view.actionText);
      setAttr(parts.action, 'aria-label', view.actionLabel);
      setAttr(parts.action, 'aria-disabled', String(view.disabled));
      view.crossRefs.forEach((ref, i) => {
        const r = parts.refs[i];
        if (r) r.button.classList.toggle('is-done', ref.done);
      });
    }

    for (const fork of forks) {
      const view = researchForkView(fork.id, state);
      setAttr(fork.group, 'aria-label', view.label);
      fork.group.dataset.chosen = view.chosen === null ? 'none' : String(view.chosen);
      fork.group.classList.toggle('is-open', view.chosen === null);
      if (fork.hint) setText(fork.hint, view.hint);
    }

    for (const parts of branches.values()) {
      const s = branchSummary(parts.id, state);
      setText(parts.toggleSummary, s.text);
      setText(parts.headSummary, s.text);
      setText(parts.tabCount, s.available > 0 ? String(s.available) : '');
      parts.tab.classList.toggle('has-available', s.available > 0);
      setAttr(parts.tab, 'aria-label', `Ast ${parts.name}: ${s.text}`);
      parts.section.classList.toggle('has-available', s.available > 0);
    }

    for (const { edge, path } of edgePaths) {
      const done = shown.get(edge.from) === 'researched' && shown.get(edge.to) === 'researched';
      const off = shown.get(edge.to) === 'excluded';
      path.classList.toggle('is-done', done);
      path.classList.toggle('is-off', off);
    }

    if (!initialOpenDone && !userToggled) {
      initialOpenDone = true;
      const width = root.getBoundingClientRect().width || (typeof window !== 'undefined' ? window.innerWidth : 0);
      const narrow = width > 0 && width < COLLAPSE_BELOW;
      const anyAvailable = [...branches.values()].some((b) => b.section.classList.contains('has-available'));
      for (const parts of branches.values()) {
        setOpen(parts, !narrow || !anyAvailable || parts.section.classList.contains('has-available'));
      }
    }
  }

  return {
    root,
    update,
    reveal,
    destroy() {
      if (pending) cancelAnimationFrame(pending);
      observer?.disconnect();
      boardObserver?.disconnect();
    },
  };
}
