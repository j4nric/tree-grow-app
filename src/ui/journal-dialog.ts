/**
 * Naturtagebuch (Design v2, Abschnitte 10 und 11.2): Arten, Pflanzen, Lebensgemeinschaften,
 * Andenken und Landschaft als Reiter in einem modalen Dialog (Übergang bis Phase 8, Schritt 7;
 * Erfolge und Statistik stehen seit Schritt 9 im Album unter „Ziele“). Entdeckte Einträge mit Angaben,
 * unentdeckte als Silhouette mit „???“. Entdeckte Arten lassen sich als Stammgast wählen.
 *
 * Reine Darstellung: zeigt ein `JournalView` und meldet Stammgast-Schalter über einen
 * Callback. Der native `<dialog>` (showModal) hält den Fokus im Dialog und schließt mit
 * Escape; danach geht der Fokus an den auslösenden Knopf zurück.
 *
 * Der Reiter „Landschaft“ (24.11) bleibt verborgen, solange die Landschaft nicht freigeschaltet
 * ist (`view.landscape === null`); die Pfeiltasten überspringen ihn dann.
 *
 * Der Inhalt wird nur neu gebaut, wenn sich die Ansicht ändert (Entdeckung, Stammgast) –
 * nie pro Frame.
 */
import { el, setText, srOnly } from './dom';
import { hyphenate } from './hyphenate';
import { prefersReducedMotion } from './feedback';
import type {
  JournalCommunityView,
  JournalEntryView,
  JournalKeepsakeView,
  JournalLandscapeRowView,
  JournalLandscapeView,
  JournalSiteView,
  JournalTreeView,
  JournalView,
} from './view-model';

export interface JournalCallbacks {
  /** Stammgast an- oder abwählen (die Aktion selbst führt main.ts aus). */
  onToggleRegular(speciesId: string): void;
  onClose?(): void;
}

export interface JournalDialog {
  show(view: JournalView): void;
  /** Aktualisiert den offenen Dialog (tut nichts, wenn er zu ist). */
  update(view: JournalView): void;
  hide(): void;
  notice(text: string): void;
  readonly open: boolean;
}

type TabId = 'species' | 'plants' | 'communities' | 'keepsakes' | 'landscape';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'species', label: 'Arten' },
  { id: 'plants', label: 'Pflanzen' },
  { id: 'communities', label: 'Gemeinschaften' },
  { id: 'keepsakes', label: 'Andenken' },
  { id: 'landscape', label: 'Landschaft' },
];

/** Knopf „📖 Naturtagebuch“ für die Seitenleiste. */
export function createJournalButton(root: HTMLElement, onOpen: () => void): HTMLButtonElement {
  const button = el('button', 'journal-button');
  button.type = 'button';
  button.dataset.ref = 'journal-open';
  button.setAttribute('aria-haspopup', 'dialog');
  const icon = el('span', 'journal-button-icon', '📖');
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon, el('span', '', 'Naturtagebuch'));
  button.addEventListener('click', onOpen);
  root.append(button);
  return button;
}

export function createJournalDialog(root: HTMLElement, callbacks: JournalCallbacks): JournalDialog {
  const dialog = el('dialog', 'encounter journal');
  dialog.setAttribute('aria-labelledby', 'journal-title');
  dialog.setAttribute('aria-describedby', 'journal-counts');
  dialog.dataset.ref = 'journal';

  const inner = el('div', 'encounter-inner');
  const header = el('header', 'encounter-header journal-header');
  const title = el('h2', 'encounter-title', '📖 Naturtagebuch');
  title.id = 'journal-title';
  const counts = el('p', 'encounter-subtitle journal-counts');
  counts.id = 'journal-counts';
  counts.dataset.ref = 'journal-counts';
  const meta = el('p', 'journal-meta');
  meta.dataset.ref = 'journal-meta';
  const regulars = el('p', 'journal-regulars');
  regulars.dataset.ref = 'journal-regulars';
  header.append(title, counts, meta, regulars);

  // Reiter (Tabs) mit Pfeiltasten-Bedienung
  const tabList = el('div', 'journal-tabs');
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-label', 'Bereiche des Naturtagebuchs');
  const tabs = new Map<TabId, { tab: HTMLButtonElement; count: HTMLElement; panel: HTMLElement }>();
  const panels = el('div', 'journal-panels');
  for (const { id, label } of TABS) {
    const tab = el('button', 'journal-tab');
    tab.type = 'button';
    tab.id = `journal-tab-${id}`;
    tab.dataset.tab = id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `journal-panel-${id}`);
    const count = el('span', 'journal-tab-count');
    tab.append(el('span', '', label), count);
    tab.addEventListener('click', () => selectTab(id, true));
    tabList.append(tab);
    const panel = el('div', 'journal-panel');
    panel.id = `journal-panel-${id}`;
    panel.dataset.panel = id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
    panels.append(panel);
    tabs.set(id, { tab, count, panel });
  }
  tabList.addEventListener('keydown', (event) => {
    // Verborgene Reiter (Landschaft vor der Freischaltung) überspringen.
    const order = TABS.map((t) => t.id).filter((id) => !tabs.get(id)!.tab.hidden);
    const at = order.indexOf(selected);
    let next: TabId | null = null;
    if (event.key === 'ArrowRight') next = order[(at + 1) % order.length]!;
    else if (event.key === 'ArrowLeft') next = order[(at - 1 + order.length) % order.length]!;
    else if (event.key === 'Home') next = order[0]!;
    else if (event.key === 'End') next = order[order.length - 1]!;
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  });

  const noticeBox = el('p', 'encounter-notice');
  noticeBox.setAttribute('role', 'status');
  noticeBox.hidden = true;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const actions = el('div', 'encounter-actions');
  const close = el('button', 'encounter-button secondary', 'Schließen');
  close.type = 'button';
  actions.append(noticeBox, close);

  inner.append(header, tabList, panels, actions);
  dialog.append(inner);
  root.append(dialog);

  // Landschaft: verborgen bis zur ersten Ansicht mit freigeschalteter Landschaft.
  tabs.get('landscape')!.tab.hidden = true;
  tabs.get('landscape')!.panel.hidden = true;

  let selected: TabId = 'species';
  let signature = '';
  let returnFocus: HTMLElement | null = null;
  let showing = false;

  function selectTab(id: TabId, focus = false): void {
    if (tabs.get(id)!.tab.hidden) id = 'species';
    selected = id;
    for (const [key, refs] of tabs) {
      const on = key === id;
      refs.tab.setAttribute('aria-selected', String(on));
      refs.tab.tabIndex = on ? 0 : -1;
      refs.panel.hidden = !on;
    }
    const tab = tabs.get(id)!.tab;
    if (focus) tab.focus();
    // Schmale Bildschirme: Die Reiterleiste scrollt waagerecht – gewählten Reiter zeigen.
    if (tabList.scrollWidth > tabList.clientWidth) {
      const left = tab.offsetLeft - tabList.offsetLeft;
      const target = Math.max(0, Math.min(left - (tabList.clientWidth - tab.offsetWidth) / 2, tabList.scrollWidth - tabList.clientWidth));
      tabList.scrollTo({ left: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }
  selectTab('species');

  function entryItem(entry: JournalEntryView, kind: 'species' | 'plant'): HTMLElement {
    const li = el(
      'li',
      `journal-entry family-${entry.family}${entry.rarity ? ` rarity-${entry.rarity}` : ''} ${entry.discovered ? 'discovered' : 'unknown'}`,
    );
    // Nur entdeckte tragen ihre ID – Unentdeckte verraten nichts.
    if (entry.discovered) li.dataset[kind === 'species' ? 'species' : 'plant'] = entry.key;
    const icon = el('span', 'journal-icon', entry.icon);
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'journal-body');
    const name = el('h3', 'journal-name', hyphenate(entry.name));
    if (!entry.discovered) {
      name.setAttribute('aria-hidden', 'true');
      body.append(srOnly(kind === 'species' ? 'Unentdeckte Art' : 'Unentdeckte Pflanze'));
    }
    body.append(name, el('p', 'journal-facts', entry.facts.join(' · ')));
    if (entry.text) body.append(el('p', 'journal-text', entry.text));
    if (entry.present) body.append(el('p', 'journal-present', kind === 'species' ? 'lebt gerade hier' : 'wächst gerade hier'));
    li.append(icon, body);
    if (entry.regular) {
      const toggle = el('button', 'journal-regular');
      toggle.type = 'button';
      toggle.dataset.focusKey = `regular-${entry.key}`;
      toggle.setAttribute('aria-pressed', String(entry.regular.selected));
      toggle.disabled = entry.regular.disabled;
      const star = el('span', 'journal-regular-star', entry.regular.selected ? '★' : '☆');
      star.setAttribute('aria-hidden', 'true');
      toggle.append(star, el('span', '', 'Stammgast'));
      toggle.setAttribute(
        'aria-label',
        `${entry.name} als Stammgast${entry.regular.disabled ? ' – alle Plätze belegt' : ''}`,
      );
      if (entry.regular.disabled) toggle.title = 'Alle Plätze für Stammgäste sind belegt';
      toggle.addEventListener('click', () => callbacks.onToggleRegular(entry.key));
      li.append(toggle);
    }
    return li;
  }

  function communityItem(c: JournalCommunityView): HTMLElement {
    const li = el('li', `journal-entry journal-community ${c.discovered ? 'discovered' : 'unknown'}${c.active ? ' active' : ''}`);
    if (c.discovered) li.dataset.community = c.key;
    const icon = el('span', 'journal-icon', c.icon);
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'journal-body');
    const name = el('h3', 'journal-name', hyphenate(c.name));
    if (!c.discovered) {
      name.setAttribute('aria-hidden', 'true');
      body.append(srOnly('Unentdeckte Lebensgemeinschaft'));
    }
    body.append(name);
    if (c.members) body.append(el('p', 'journal-facts', c.members));
    if (c.effect) body.append(el('p', 'journal-effect', c.effect));
    if (c.hint) body.append(el('p', 'journal-text', c.hint));
    if (c.progress) body.append(el('p', 'journal-progress', c.progress));
    if (c.active) body.append(el('p', 'journal-present', 'besteht gerade'));
    li.append(icon, body);
    return li;
  }

  function keepsakeItem(k: JournalKeepsakeView): HTMLElement {
    const li = el('li', 'journal-entry discovered journal-keepsake');
    li.dataset.keepsake = k.key;
    const icon = el('span', 'journal-icon', k.icon);
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'journal-body');
    body.append(el('h4', 'journal-name', hyphenate(k.name)));
    if (k.text) body.append(el('p', 'journal-text', k.text));
    li.append(icon, body);
    return li;
  }

  function treeItem(t: JournalTreeView): HTMLElement {
    const known = !t.hidden;
    const li = el(
      'li',
      `journal-entry journal-tree ${t.unlocked ? 'discovered' : known ? 'locked' : 'unknown'}${t.current ? ' current' : ''}`,
    );
    if (known) li.dataset.tree = t.key;
    const icon = el('span', 'journal-icon', t.icon);
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'journal-body');
    const name = el('h4', 'journal-name', hyphenate(t.name));
    if (!known) {
      name.setAttribute('aria-hidden', 'true');
      body.append(srOnly('Unbekannte Baumart'));
    }
    body.append(name);
    const status = t.current ? 'wächst in diesem Zyklus' : t.grown ? 'schon gewachsen' : t.unlocked ? 'freigeschaltet' : 'gesperrt';
    const kind = t.current ? 'current' : t.grown ? 'grown' : t.unlocked ? 'unlocked' : 'locked';
    const badge = el('p', `journal-tree-status ${kind}`);
    const badgeIcon = el('span', '', t.current ? '★ ' : t.grown ? '✓ ' : t.unlocked ? '' : '🔒 ');
    badgeIcon.setAttribute('aria-hidden', 'true');
    badge.append(badgeIcon, status);
    body.append(badge);
    if (t.summary) body.append(el('p', 'journal-facts', t.summary));
    if (t.text) body.append(el('p', 'journal-text', t.text));
    if (t.hint) body.append(el('p', 'journal-progress', t.hint));
    li.append(icon, body);
    return li;
  }

  /** Beschreibungsliste aus Zeilen „Bezeichnung – Wert“ (Angaben zu einem Wald, Hähersaat). */
  function rowList(rows: readonly JournalLandscapeRowView[], className: string): HTMLDListElement {
    const dl = el('dl', className);
    for (const r of rows) {
      const wrap = el('div', `${className}-row`);
      wrap.dataset.row = r.key;
      wrap.append(el('dt', '', r.label), el('dd', '', hyphenate(r.value)));
      dl.append(wrap);
    }
    return dl;
  }

  function siteItem(s: JournalSiteView): HTMLElement {
    const li = el('li', `journal-entry discovered journal-site${s.active ? ' current' : ''}${s.ancient ? ' ancient' : ''}`);
    li.dataset.site = s.id;
    const icon = el('span', 'journal-icon', s.icon);
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'journal-body');
    const name = el('h4', 'journal-name', hyphenate(s.name));
    body.append(name);
    if (s.active) {
      const badge = el('p', 'journal-tree-status current');
      const star = el('span', '', '★ ');
      star.setAttribute('aria-hidden', 'true');
      badge.append(star, 'hier wächst dein Wald');
      body.append(badge);
    }
    if (s.forestType) body.append(el('p', 'journal-facts', hyphenate(s.forestType)));
    li.append(icon, body, rowList(s.rows, 'journal-site-facts'));
    return li;
  }

  function renderLandscape(view: JournalLandscapeView | null): void {
    const { tab, panel } = tabs.get('landscape')!;
    tab.hidden = view === null;
    if (!view) {
      panel.replaceChildren();
      if (selected === 'landscape') selectTab('species');
      return;
    }
    const summary = el('p', 'journal-landscape-summary', view.summary);
    summary.dataset.ref = 'journal-landscape-summary';
    const seedsTitle = el('h3', 'journal-section-title', '🪶 Hähersaat');
    seedsTitle.id = 'journal-landscape-seeds-title';
    const seeds = rowList(view.jaySeeds, 'journal-seeds');
    seeds.dataset.ref = 'journal-jay-seeds';
    seeds.setAttribute('aria-labelledby', seedsTitle.id);
    const seedsNote = el('p', 'journal-text', view.jaySeedsNote);
    const sitesTitle = el('h3', 'journal-section-title', 'Wälder');
    sitesTitle.id = 'journal-landscape-sites-title';
    const siteNodes = list(sitesTitle.id, view.sites.map(siteItem), '', true);
    for (const node of siteNodes) node.classList.add('journal-sites');
    const hint = view.sitesHint ? [el('p', 'journal-progress', view.sitesHint)] : [];
    const corridorTitle = el('h3', 'journal-section-title', 'Korridore');
    corridorTitle.id = 'journal-landscape-corridors-title';
    const corridorNodes = list(
      corridorTitle.id,
      view.corridors.map((c) => {
        const li = el('li', 'journal-corridor');
        li.dataset.corridor = c.id;
        const icon = el('span', 'journal-corridor-icon', c.icon);
        icon.setAttribute('aria-hidden', 'true');
        const text = el('span', 'journal-corridor-text');
        text.append(
          el('strong', 'journal-corridor-name', hyphenate(c.name)),
          el('span', 'journal-corridor-ends', hyphenate(c.ends)),
          el('span', 'journal-corridor-note', c.note),
        );
        li.append(icon, text);
        return li;
      }),
      'Noch keine Korridore – der erste entsteht mit der Gründung eines Waldes.',
      true,
    );
    for (const node of corridorNodes) if (node instanceof HTMLUListElement) node.className = 'journal-corridors';
    panel.replaceChildren(summary, seedsTitle, seeds, seedsNote, sitesTitle, ...siteNodes, ...hint, corridorTitle, ...corridorNodes);
  }

  /** `label` ist ein Name oder – mit `labelledBy` – die ID einer sichtbaren Überschrift. */
  function list(label: string, items: HTMLElement[], empty: string, labelledBy = false): HTMLElement[] {
    if (items.length === 0) return [el('p', 'journal-empty', empty)];
    const ul = el('ul', 'journal-grid');
    ul.setAttribute(labelledBy ? 'aria-labelledby' : 'aria-label', label);
    ul.append(...items);
    return [ul];
  }

  function render(view: JournalView): void {
    // Kennzahlen und Erfolge zeigt das Album (Reiter „Ziele“) – sie zählen nicht zur Signatur.
    const next = JSON.stringify({ ...view, stats: null, achievements: null, tabCounts: { ...view.tabCounts, achievements: '', stats: '' } });
    if (next === signature) return;
    signature = next;
    const focusKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey : undefined;

    setText(counts, view.counts);
    setText(meta, view.meta);
    setText(regulars, view.regulars ?? '');
    regulars.hidden = !view.regulars;
    for (const { id } of TABS) {
      const count = tabs.get(id)!.count;
      setText(count, view.tabCounts[id]);
      count.hidden = view.tabCounts[id] === '';
    }

    tabs.get('species')!.panel.replaceChildren(
      ...list('Arten', view.species.map((e) => entryItem(e, 'species')), 'Noch keine Arten.'),
    );
    tabs.get('plants')!.panel.replaceChildren(
      ...list('Pflanzen', view.plants.map((e) => entryItem(e, 'plant')), 'Noch keine Pflanzen.'),
    );
    tabs.get('communities')!.panel.replaceChildren(
      ...list('Lebensgemeinschaften', view.communities.map(communityItem), 'Noch keine Lebensgemeinschaften.'),
    );
    const treeList = el('ul', 'journal-grid');
    treeList.setAttribute('aria-labelledby', 'journal-trees-title');
    treeList.append(...view.trees.map(treeItem));
    const treeTitle = el('h3', 'journal-section-title', 'Hauptbaum-Arten');
    treeTitle.id = 'journal-trees-title';
    const memoryTitle = el('h3', 'journal-section-title', 'Erinnerungen');
    memoryTitle.id = 'journal-memories-title';
    tabs.get('keepsakes')!.panel.replaceChildren(
      treeTitle,
      treeList,
      memoryTitle,
      ...list('journal-memories-title', view.keepsakes.map(keepsakeItem), 'Noch keine Erinnerungen – sie halten besondere Momente fest.', true),
    );
    renderLandscape(view.landscape);
    if (focusKey) dialog.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  function show(view: JournalView): void {
    render(view);
    if (dialog.open) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    showing = true;
    clearNotice();
    dialog.showModal();
    dialog.scrollTop = 0;
    tabs.get(selected)!.tab.focus({ preventScroll: true });
  }

  function update(view: JournalView): void {
    if (dialog.open) render(view);
  }

  function clearNotice(): void {
    clearTimeout(noticeTimer);
    noticeBox.hidden = true;
    noticeBox.textContent = '';
  }

  function notice(text: string): void {
    clearTimeout(noticeTimer);
    noticeBox.textContent = text;
    noticeBox.hidden = false;
    noticeTimer = setTimeout(clearNotice, 4000);
  }

  function finish(): void {
    showing = false;
    clearNotice();
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected && !target.hidden) target.focus({ preventScroll: true });
    callbacks.onClose?.();
  }

  function hide(): void {
    if (!dialog.open) return;
    dialog.close();
    finish();
  }

  close.addEventListener('click', () => hide());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    hide();
  });
  // Schließt der Browser den Dialog selbst, trotzdem aufräumen.
  dialog.addEventListener('close', () => {
    if (!showing || dialog.open) return;
    finish();
  });

  return {
    show,
    update,
    hide,
    notice,
    get open() {
      return dialog.open;
    },
  };
}
