/**
 * Naturtagebuch (Design v2, Abschnitte 10 und 11.2): Arten, Pflanzen, Lebensgemeinschaften
 * und Andenken als Reiter in einem modalen Dialog. Entdeckte Einträge mit Angaben,
 * unentdeckte als Silhouette mit „???“. Entdeckte Arten lassen sich als Stammgast wählen.
 *
 * Reine Darstellung: zeigt ein `JournalView` und meldet Stammgast-Schalter über einen
 * Callback. Der native `<dialog>` (showModal) hält den Fokus im Dialog und schließt mit
 * Escape; danach geht der Fokus an den auslösenden Knopf zurück.
 *
 * Der Inhalt wird nur neu gebaut, wenn sich die Ansicht ändert (Entdeckung, Stammgast) –
 * nie pro Frame.
 */
import { el, setText, srOnly } from './dom';
import type { JournalCommunityView, JournalEntryView, JournalKeepsakeView, JournalView } from './view-model';

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

type TabId = 'species' | 'plants' | 'communities' | 'keepsakes';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'species', label: 'Arten' },
  { id: 'plants', label: 'Pflanzen' },
  { id: 'communities', label: 'Gemeinschaften' },
  { id: 'keepsakes', label: 'Andenken' },
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
    const order = TABS.map((t) => t.id);
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

  let selected: TabId = 'species';
  let signature = '';
  let returnFocus: HTMLElement | null = null;
  let showing = false;

  function selectTab(id: TabId, focus = false): void {
    selected = id;
    for (const [key, refs] of tabs) {
      const on = key === id;
      refs.tab.setAttribute('aria-selected', String(on));
      refs.tab.tabIndex = on ? 0 : -1;
      refs.panel.hidden = !on;
    }
    if (focus) tabs.get(id)!.tab.focus();
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
    const name = el('h3', 'journal-name', entry.name);
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
    const name = el('h3', 'journal-name', c.name);
    if (!c.discovered) {
      name.setAttribute('aria-hidden', 'true');
      body.append(srOnly('Unentdeckte Lebensgemeinschaft'));
    }
    body.append(name);
    if (c.members) body.append(el('p', 'journal-facts', c.members));
    if (c.effect) body.append(el('p', 'journal-effect', c.effect));
    if (c.hint) body.append(el('p', 'journal-text', c.hint));
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
    body.append(el('h3', 'journal-name', k.name));
    if (k.text) body.append(el('p', 'journal-text', k.text));
    li.append(icon, body);
    return li;
  }

  function list(label: string, items: HTMLElement[], empty: string): HTMLElement[] {
    if (items.length === 0) return [el('p', 'journal-empty', empty)];
    const ul = el('ul', 'journal-grid');
    ul.setAttribute('aria-label', label);
    ul.append(...items);
    return [ul];
  }

  function render(view: JournalView): void {
    const next = JSON.stringify(view);
    if (next === signature) return;
    signature = next;
    const focusKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey : undefined;

    setText(counts, view.counts);
    setText(meta, view.meta);
    setText(regulars, view.regulars ?? '');
    regulars.hidden = !view.regulars;
    for (const { id } of TABS) setText(tabs.get(id)!.count, view.tabCounts[id]);

    tabs.get('species')!.panel.replaceChildren(
      ...list('Arten', view.species.map((e) => entryItem(e, 'species')), 'Noch keine Arten.'),
    );
    tabs.get('plants')!.panel.replaceChildren(
      ...list('Pflanzen', view.plants.map((e) => entryItem(e, 'plant')), 'Noch keine Pflanzen.'),
    );
    tabs.get('communities')!.panel.replaceChildren(
      ...list('Lebensgemeinschaften', view.communities.map(communityItem), 'Noch keine Lebensgemeinschaften.'),
    );
    tabs.get('keepsakes')!.panel.replaceChildren(
      ...list('Andenken', view.keepsakes.map(keepsakeItem), 'Noch keine Andenken – sie erinnern an besondere Momente.'),
    );
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
