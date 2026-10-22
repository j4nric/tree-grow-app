/**
 * Unterseite „Erfolge“ (docs/ALBUM_UI.md, A.7 #89 und B.4; DESIGN_V2.md 18): ein Bogen mit
 * Kacheln – oben „Erreicht“ (eingeklebte Sticker), darunter „Noch offen“ (gestrichelt, mit
 * Fortschritt). Sichtbar sind nur Erfolge, die `isAchievementVisible` zeigt (die der
 * Landschaft erst nach deren Freischaltung). Titel und Beschreibungen sind neutral – nichts
 * Unentdecktes beim Namen.
 *
 * Die Kacheln entstehen nur neu, wenn sich Erreichtes oder Sichtbares ändert; der laufende
 * Fortschritt der Zeit-Erfolge tauscht nur Texte.
 */
import { achievementCountText, toJournalAchievements } from '../../achievement-view';
import { el, setText, srOnly } from '../../dom';
import { hyphenate } from '../../hyphenate';
import type { JournalAchievementView } from '../../view-model';
import { createBookmark } from '../bookmark';
import { initialNav, pageNumber } from '../nav';
import { createPage } from '../page';
import { tileTilt } from './goals-view';
import type { PageEnv, Subpage } from './registry';
import './goals.css';

const REFRESH_MS = 200;

export function createAchievementsPage(env: PageEnv): Subpage {
  const page = createPage({
    kind: 'achievements',
    title: 'Erfolge',
    number: pageNumber({ ...initialNav('goals'), stack: [{ kind: 'achievements' }] }),
    className: 'album-subpage achievements-page',
  });
  const bookmark = createBookmark(() => env.back());
  bookmark.setLabel('Ziele');
  page.element.prepend(bookmark.element);
  page.meta.dataset.ref = 'achievements-count';
  page.body.classList.add('goals-body');

  const doneTitle = el('h3', 'goals-section-title', 'Erreicht');
  doneTitle.id = 'achievements-done-title';
  const doneList = el('ul', 'ach-grid');
  doneList.setAttribute('aria-labelledby', doneTitle.id);
  const doneEmpty = el('p', 'cyc-hint', 'Noch keine Erfolge – sie kommen ganz von selbst, Schritt für Schritt.');
  const openTitle = el('h3', 'goals-section-title', 'Noch offen');
  openTitle.id = 'achievements-open-title';
  const openList = el('ul', 'ach-grid');
  openList.setAttribute('aria-labelledby', openTitle.id);
  page.body.append(doneTitle, doneList, doneEmpty, openTitle, openList);

  /** Fortschritt der Zeit-Erfolge: Textknoten je Erfolgs-ID (nur Texte tauschen). */
  const live = new Map<string, HTMLElement>();
  let signature = '';
  let last = -Infinity;

  function tile(a: JournalAchievementView): HTMLLIElement {
    const li = el('li', `ach-tile ${a.unlocked ? 'unlocked' : 'open'}`);
    li.dataset.achievement = a.key;
    li.dataset.unlocked = String(a.unlocked);
    li.style.setProperty('--tilt', `${tileTilt(a.key)}deg`);
    const sticker = el('span', 'ach-sticker', a.icon);
    sticker.setAttribute('aria-hidden', 'true');
    const body = el('div', 'ach-body');
    if (!a.unlocked) body.append(srOnly('Noch offen: '));
    body.append(el('h4', 'ach-title', hyphenate(a.title)), el('p', 'ach-text', hyphenate(a.description)));
    if (a.progress) {
      const progress = el('p', 'ach-progress');
      const value = el('span', 'ach-progress-value', a.progress);
      progress.append(srOnly('Fortschritt '), value);
      body.append(progress);
      if (a.live) live.set(a.key, value);
    }
    li.append(sticker, body);
    return li;
  }

  function render(force: boolean): void {
    const state = env.deps.state();
    const items = toJournalAchievements(state);
    page.setMeta(achievementCountText(state));
    // Laufender Fortschritt zählt nicht zur Signatur (kein Neubau), nur sein Text wird getauscht.
    const next = JSON.stringify(items.map((a) => (a.live ? { ...a, progress: null } : a)));
    if (!force && next === signature) {
      for (const a of items) {
        const node = live.get(a.key);
        if (node && a.progress) setText(node, a.progress);
      }
      return;
    }
    signature = next;
    live.clear();
    const done = items.filter((a) => a.unlocked);
    const open = items.filter((a) => !a.unlocked);
    doneList.replaceChildren(...done.map(tile));
    doneList.hidden = done.length === 0;
    doneEmpty.hidden = done.length > 0;
    openList.replaceChildren(...open.map(tile));
    openTitle.hidden = open.length === 0;
    openList.hidden = open.length === 0;
  }

  return {
    page,
    bookmark,
    opened() {
      last = performance.now();
      render(false);
    },
    update(now, force) {
      if (!force && now - last < REFRESH_MS) return;
      last = now;
      render(false);
    },
  };
}
