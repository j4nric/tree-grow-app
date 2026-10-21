/**
 * Naturtagebuch (Design v2, Abschnitte 10, 11.2 und 18): Arten, Pflanzen,
 * Lebensgemeinschaften, Andenken, Erfolge und Statistik als Reiter in einem modalen Dialog. Entdeckte Einträge mit Angaben,
 * unentdeckte als Silhouette mit „???“. Entdeckte Arten lassen sich als Stammgast wählen.
 *
 * Reine Darstellung: zeigt ein `JournalView` und meldet Stammgast-Schalter über einen
 * Callback. Der native `<dialog>` (showModal) hält den Fokus im Dialog und schließt mit
 * Escape; danach geht der Fokus an den auslösenden Knopf zurück.
 *
 * Der Inhalt wird nur neu gebaut, wenn sich die Ansicht ändert (Entdeckung, Stammgast) –
 * nie pro Frame. Die Kennzahlen im Reiter „Statistik“ stehen in fest angelegten Zeilen;
 * `updateStats` tauscht dort nur Texte (gedrosselt aus main.ts).
 */
import { el, setText, srOnly } from './dom';
import type {
  JournalAchievementProgressView,
  JournalAchievementView,
  JournalCommunityView,
  JournalEntryView,
  JournalKeepsakeView,
  JournalStatView,
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
  /** Nur die Kennzahlen im Reiter „Statistik“ (tut nichts, wenn der Dialog zu ist). */
  updateStats(stats: readonly JournalStatView[]): void;
  /** Nur der laufende Fortschritt der Zeit-Erfolge im Reiter „Erfolge“ (nur Texte). */
  updateAchievementProgress(progress: readonly JournalAchievementProgressView[]): void;
  hide(): void;
  notice(text: string): void;
  readonly open: boolean;
}

type TabId = 'species' | 'plants' | 'communities' | 'keepsakes' | 'achievements' | 'stats';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'species', label: 'Arten' },
  { id: 'plants', label: 'Pflanzen' },
  { id: 'communities', label: 'Gemeinschaften' },
  { id: 'keepsakes', label: 'Andenken' },
  { id: 'achievements', label: 'Erfolge' },
  { id: 'stats', label: 'Statistik' },
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
    body.append(el('h4', 'journal-name', k.name));
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
    const name = el('h4', 'journal-name', t.name);
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

  /** Erfolg: freigeschaltet mit Symbol, Titel, Beschreibung; offen gedämpft mit Fortschritt. */
  function achievementItem(a: JournalAchievementView): HTMLElement {
    const li = el('li', `journal-entry journal-achievement ${a.unlocked ? 'discovered' : 'locked'}`);
    li.dataset.achievement = a.key;
    li.dataset.unlocked = String(a.unlocked);
    const icon = el('span', 'journal-icon', a.icon);
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'journal-body');
    if (!a.unlocked) body.append(srOnly('Noch offen: '));
    body.append(el('h4', 'journal-name', a.title), el('p', 'journal-facts', a.description));
    if (a.progress) {
      const progress = el('p', 'journal-progress');
      const value = el('span', 'journal-progress-value', a.progress);
      progress.append(srOnly('Fortschritt '), value);
      body.append(progress);
      if (a.live) progressValues.set(a.key, value);
    }
    li.append(icon, body);
    return li;
  }

  /** Laufender Fortschritt der Zeit-Erfolge: Textknoten je Erfolgs-ID (nur Texte tauschen). */
  const progressValues = new Map<string, HTMLElement>();

  function renderAchievementProgress(progress: readonly { key: string; progress?: string }[]): void {
    for (const p of progress) {
      const node = progressValues.get(p.key);
      if (node && p.progress) setText(node, p.progress);
    }
  }

  // Statistik: Zeilen einmal anlegen, danach nur Texte tauschen.
  const statList = el('dl', 'journal-stats');
  statList.dataset.ref = 'journal-stats';
  // Abschnitt „Über alle Zyklen“ (Langzeit-Statistik) mit eigener Überschrift.
  const totalTitle = el('h3', 'journal-section-title', 'Über alle Zyklen');
  totalTitle.id = 'journal-stats-total-title';
  const totalList = el('dl', 'journal-stats');
  totalList.dataset.ref = 'journal-stats-total';
  totalList.setAttribute('aria-labelledby', totalTitle.id);
  const statRows = new Map<string, { value: HTMLElement; detail: HTMLElement }>();
  tabs.get('stats')!.panel.append(statList, totalTitle, totalList);

  function renderStats(stats: readonly JournalStatView[]): void {
    for (const s of stats) {
      let row = statRows.get(s.key);
      if (!row) {
        const wrap = el('div', 'journal-stat');
        wrap.dataset.stat = s.key;
        const dt = el('dt', 'journal-stat-label', s.label);
        const dd = el('dd', 'journal-stat-value');
        const value = el('span', 'journal-stat-number');
        const detail = el('span', 'journal-stat-detail');
        dd.append(value, detail);
        wrap.append(dt, dd);
        (s.section === 'total' ? totalList : statList).append(wrap);
        row = { value, detail };
        statRows.set(s.key, row);
      }
      setText(row.value, s.value);
      setText(row.detail, s.detail ?? '');
      row.detail.hidden = !s.detail;
    }
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
    renderStats(view.stats);
    // Kennzahlen und der Fortschritt der Zeit-Erfolge ändern sich laufend – sie zählen
    // nicht zur Signatur (kein Neubau), nur ihre Texte werden getauscht.
    const next = JSON.stringify({
      ...view,
      stats: null,
      achievements: view.achievements.map((a) => (a.live ? { ...a, progress: null } : a)),
    });
    if (next === signature) {
      renderAchievementProgress(view.achievements);
      return;
    }
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
    progressValues.clear();
    const done = view.achievements.filter((a) => a.unlocked);
    const open = view.achievements.filter((a) => !a.unlocked);
    const doneTitle = el('h3', 'journal-section-title', 'Erreicht');
    doneTitle.id = 'journal-achievements-done-title';
    const openTitle = el('h3', 'journal-section-title', 'Noch offen');
    openTitle.id = 'journal-achievements-open-title';
    tabs.get('achievements')!.panel.replaceChildren(
      doneTitle,
      ...list(doneTitle.id, done.map(achievementItem), 'Noch keine Erfolge – sie kommen ganz von selbst, Schritt für Schritt.', true),
      ...(open.length > 0 ? [openTitle, ...list(openTitle.id, open.map(achievementItem), '', true)] : []),
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

  function updateStats(stats: readonly JournalStatView[]): void {
    if (dialog.open) renderStats(stats);
  }

  function updateAchievementProgress(progress: readonly JournalAchievementProgressView[]): void {
    if (dialog.open) renderAchievementProgress(progress);
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
    updateStats,
    updateAchievementProgress,
    hide,
    notice,
    get open() {
      return dialog.open;
    },
  };
}
