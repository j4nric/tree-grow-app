/**
 * Cover: der Buchumschlag als Menü (docs/ALBUM_UI.md, B.7). Mobil schwenkt er als
 * Innenseite des Einbands von links herein, auf der Doppelseite klappt er über die linke
 * Seite. Inhalt: Titel (h1), Spielanleitung, Einstellungen, Spielstand ›, Schließen.
 *
 * Schritt 1: Anleitung und Einstellungen öffnen noch die bisherigen Dialoge (help.ts
 * hängt seine Knöpfe in `menu`); „Spielstand ›“ blättert zur Unterseite um.
 */
import { el } from '../dom';
import './cover.css';

export interface Cover {
  readonly element: HTMLElement;
  /** Überschrift „Vom Samen zum Wald“ (Fokusziel beim Öffnen). */
  readonly title: HTMLHeadingElement;
  /** Platz für Einträge (help.ts: Spielanleitung, Einstellungen). */
  readonly menu: HTMLElement;
  /** Eintrag „💾 Spielstand ›“. */
  readonly saveEntry: HTMLButtonElement;
  setOpen(open: boolean, animate: boolean): void;
}

export interface CoverCallbacks {
  onClose(): void;
  onOpenSave(): void;
}

export function createCover(callbacks: CoverCallbacks): Cover {
  const cover = el('aside', 'cover');
  cover.id = 'album-cover';
  cover.dataset.ref = 'cover';
  cover.setAttribute('aria-label', 'Buchumschlag');
  cover.hidden = true;
  const inner = el('div', 'cover-inner');
  const title = el('h1', 'cover-title', 'Vom Samen zum Wald');
  title.tabIndex = -1;
  const subtitle = el('p', 'cover-subtitle', 'Naturtagebuch');
  const menu = el('nav', 'cover-menu');
  menu.setAttribute('aria-label', 'Umschlag');
  const saveEntry = el('button', 'cover-entry');
  saveEntry.type = 'button';
  saveEntry.dataset.ref = 'save-open';
  const saveIcon = el('span', 'cover-entry-icon', '💾');
  saveIcon.setAttribute('aria-hidden', 'true');
  saveEntry.append(saveIcon, el('span', 'cover-entry-text', 'Spielstand'), el('span', 'cover-entry-more', '›'));
  saveEntry.addEventListener('click', callbacks.onOpenSave);
  const entries = el('div', 'cover-entries');
  entries.append(menu, saveEntry);
  const close = el('button', 'cover-close', 'Schließen');
  close.type = 'button';
  close.dataset.ref = 'cover-close';
  close.addEventListener('click', callbacks.onClose);
  inner.append(title, subtitle, entries, close);
  cover.append(inner);

  return {
    element: cover,
    title,
    menu,
    saveEntry,
    setOpen(open, animate) {
      if (cover.hidden === !open) return;
      cover.classList.remove('cover-in', 'cover-out');
      if (open) {
        cover.hidden = false;
        if (animate) cover.classList.add('cover-in');
        return;
      }
      if (!animate) {
        cover.hidden = true;
        return;
      }
      cover.classList.add('cover-out');
      const done = () => {
        cover.removeEventListener('animationend', done);
        if (cover.classList.contains('cover-out')) {
          cover.classList.remove('cover-out');
          cover.hidden = true;
        }
      };
      cover.addEventListener('animationend', done);
      // Sicherheitsnetz, falls keine Animation läuft (Hintergrund-Tab).
      setTimeout(done, 400);
    },
  };
}
