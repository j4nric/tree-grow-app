/**
 * Unterseite „Nahrungsnetz“ (docs/ALBUM_UI.md, B.1 und A.3 #33): je Beute-Merkmal der
 * Zustand (immer auch als Text), „Beute · Bestand“, die Jäger als kleine Sticker mit Namen,
 * wer sie klein hält, und ein Hinweis. Erreichbar vom Reiter Nischen und aus U:Tier
 * („Räuber und Beute“, dann Ebene 2).
 *
 * DOM einmal bauen; Zeilen entstehen nur für neue Merkmale.
 */
import { el, setText, srOnly } from '../../dom';
import type { EcosystemView, FoodWebRowView } from '../../view-model';
import { createBookmark } from '../bookmark';
import { createPage } from '../page';
import { createStickerImage, type StickerImage } from '../sticker';
import { stickerTilt } from '../sticker-rules';
import type { PageEnv, Subpage } from './registry';
import './subpage.css';
import './food-web-page.css';

/** Kantenlänge der kleinen Jäger-Sticker. */
const HUNTER_SIZE = 30;

export const FOOD_WEB_INTRO = 'Wer jagt wen? Zufriedene Beute ernährt mehr Jäger.';

interface Row {
  root: HTMLLIElement;
  icon: HTMLElement;
  name: HTMLElement;
  stateIcon: HTMLElement;
  stateLabel: HTMLElement;
  prey: HTMLElement;
  hunterBox: HTMLElement;
  hunterStickers: { root: HTMLElement; image: StickerImage }[];
  hunters: HTMLElement;
  hint: HTMLElement;
}

export function createFoodWebPage(env: PageEnv): Subpage {
  const page = createPage({ kind: 'foodweb', title: 'Nahrungsnetz', className: 'album-subpage food-web-page' });
  const bookmark = createBookmark(() => env.back());
  page.element.prepend(bookmark.element);

  const box = el('section', 'sub-section food-web');
  box.dataset.ref = 'food-web';
  box.setAttribute('aria-label', 'Nahrungsnetz');
  const intro = el('p', 'sub-intro', FOOD_WEB_INTRO);
  const list = el('ul', 'web-list');
  list.setAttribute('aria-label', 'Nahrungsnetz');
  const empty = el('p', 'web-empty');
  empty.dataset.ref = 'food-web-empty';
  box.append(intro, list, empty);
  page.body.append(box);

  const rows = new Map<string, Row>();
  let order = '';
  let shownView: EcosystemView | null = null;

  function buildRow(tag: string): Row {
    const li = el('li', 'web-row');
    li.dataset.tag = tag;
    const head = el('p', 'web-head');
    const icon = el('span', 'web-icon');
    icon.setAttribute('aria-hidden', 'true');
    const name = el('b', 'web-name');
    const state = el('span', 'web-state');
    state.dataset.ref = 'food-web-state';
    const stateIcon = el('span', 'web-state-icon');
    stateIcon.setAttribute('aria-hidden', 'true');
    const stateLabel = el('span');
    state.append(stateIcon, stateLabel);
    head.append(icon, name, srOnly(': '), state);
    const prey = el('p', 'web-line');
    prey.dataset.ref = 'food-web-prey';
    const hunterLine = el('div', 'web-hunter-line');
    const hunterBox = el('span', 'web-hunter-stickers');
    hunterBox.setAttribute('aria-hidden', 'true');
    const hunters = el('p', 'web-line');
    hunters.dataset.ref = 'food-web-hunters';
    hunterLine.append(hunterBox, hunters);
    const hint = el('p', 'web-hint');
    hint.dataset.ref = 'food-web-hint';
    li.append(head, prey, hunterLine, hint);
    return { root: li, icon, name, stateIcon, stateLabel, prey, hunterBox, hunterStickers: [], hunters, hint };
  }

  function updateRow(row: Row, item: FoodWebRowView): void {
    const className = `web-row state-${item.state}`;
    if (row.root.className !== className) row.root.className = className;
    setText(row.icon, item.icon);
    setText(row.name, item.name);
    setText(row.stateIcon, item.stateIcon);
    setText(row.stateLabel, item.stateLabel);
    setText(row.prey, `Beute: ${item.prey} · Bestand ${item.stock.label}`);
    const who = item.hunters ? `Jäger: ${item.hunters}` : 'Jäger: keine';
    setText(row.hunters, item.controllers ? `${who} · hält klein: ${item.controllers}` : who);
    setText(row.hint, item.hint);
    const ids = item.hunterIds ?? [];
    while (row.hunterStickers.length < ids.length) {
      const root = el('span', 'web-hunter');
      const image = createStickerImage(HUNTER_SIZE, 'web-hunter-img');
      root.append(image.canvas);
      row.hunterBox.append(root);
      row.hunterStickers.push({ root, image });
    }
    row.hunterStickers.forEach((sticker, i) => {
      const id = ids[i];
      sticker.root.hidden = !id;
      if (!id) return;
      sticker.root.style.setProperty('--tilt', `${stickerTilt(id, i)}deg`);
      sticker.image.draw(id, 'color');
    });
    row.hunterBox.hidden = ids.length === 0;
  }

  function update(): void {
    const view = env.eco.view;
    if (!view || view === shownView) return;
    shownView = view;
    const web = view.foodWeb;
    page.setMeta(web.rows.length > 0 ? web.summary : '');
    for (const item of web.rows) {
      let row = rows.get(item.tag);
      if (!row) {
        row = buildRow(item.tag);
        rows.set(item.tag, row);
      }
      updateRow(row, item);
    }
    const next = web.rows.map((r) => r.tag).join('|');
    if (next !== order) {
      order = next;
      list.replaceChildren(...web.rows.map((r) => rows.get(r.tag)!.root));
      const present = new Set(web.rows.map((r) => r.tag));
      for (const tag of [...rows.keys()]) if (!present.has(tag)) rows.delete(tag);
    }
    const none = web.rows.length === 0;
    list.hidden = none;
    intro.hidden = none;
    setText(empty, none ? web.emptyText : '');
    empty.hidden = !none;
  }

  return {
    page,
    bookmark,
    opened() {
      update();
      page.element.scrollTop = 0;
    },
    update,
  };
}
