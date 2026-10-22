/**
 * Cover: der Buchumschlag als Menü (docs/ALBUM_UI.md, B.7). Mobil schwenkt er als
 * Innenseite des Einbands von links herein, auf der Doppelseite klappt er über die linke
 * Seite. Inhalt: Titel (h1) auf einem eingeklebten Schild, dann die Einträge
 * „📖 Spielanleitung ›“, „⚙️ Einstellungen ›“, „👤 Konto ›“ (nur mit Sync-Adresse),
 * „💾 Spielstand ›“ – jeder blättert zu seiner Unterseite um – und „Schließen“.
 */
import { el, setText } from '../dom';
import './cover.css';

/** Unterseiten, die der Umschlag öffnet. */
export type CoverPage = 'guide' | 'settings' | 'account' | 'save';

export interface Cover {
  readonly element: HTMLElement;
  /** Überschrift „Vom Samen zum Wald“ (Fokusziel beim Öffnen). */
  readonly title: HTMLHeadingElement;
  /** Eintrag je Unterseite (data-ref `<page>-open`). */
  readonly entries: Readonly<Record<CoverPage, HTMLButtonElement>>;
  /** Eintrag „Konto“ zeigen (sobald der Konto-Abschnitt eingehängt ist). */
  showAccount(): void;
  /** Name des aktiven Waldes auf dem Schild („Naturtagebuch · Heimatwald“). */
  setForestName(name: string): void;
  setOpen(open: boolean, animate: boolean): void;
}

export interface CoverCallbacks {
  onClose(): void;
  onOpen(page: CoverPage): void;
}

const ENTRIES: readonly { page: CoverPage; icon: string; text: string; hint: string }[] = [
  { page: 'guide', icon: '📖', text: 'Spielanleitung', hint: 'Kapitel zum Nachlesen' },
  { page: 'settings', icon: '⚙️', text: 'Einstellungen', hint: 'Bewegung, Zahlen, Klang, Tageszeit' },
  { page: 'account', icon: '👤', text: 'Konto', hint: 'Wald auf mehreren Geräten' },
  { page: 'save', icon: '💾', text: 'Spielstand', hint: 'Exportieren, importieren, löschen' },
];

export function createCover(callbacks: CoverCallbacks): Cover {
  const cover = el('aside', 'cover');
  cover.id = 'album-cover';
  cover.dataset.ref = 'cover';
  cover.setAttribute('aria-label', 'Buchumschlag');
  cover.hidden = true;
  const inner = el('div', 'cover-inner');

  // Eingeklebtes Schild mit Titel (wie ein Exlibris auf der Innenseite des Einbands).
  const plate = el('div', 'cover-plate');
  for (const side of ['left', 'right']) {
    const tape = el('span', `cover-tape cover-tape-${side}`);
    tape.setAttribute('aria-hidden', 'true');
    plate.append(tape);
  }
  const sprout = el('span', 'cover-sprout', '🌱');
  sprout.setAttribute('aria-hidden', 'true');
  const title = el('h1', 'cover-title', 'Vom Samen zum Wald');
  title.tabIndex = -1;
  const subtitle = el('p', 'cover-subtitle');
  const subtitleBook = el('span', '', 'Naturtagebuch');
  const subtitleForest = el('span', 'cover-forest');
  subtitle.append(subtitleBook, subtitleForest);
  plate.append(sprout, title, subtitle);

  const menu = el('nav', 'cover-menu');
  menu.setAttribute('aria-label', 'Umschlag');
  const entries = {} as Record<CoverPage, HTMLButtonElement>;
  for (const entry of ENTRIES) {
    const button = el('button', `cover-entry cover-entry-${entry.page}`);
    button.type = 'button';
    button.dataset.ref = `${entry.page}-open`;
    const icon = el('span', 'cover-entry-icon', entry.icon);
    icon.setAttribute('aria-hidden', 'true');
    const label = el('span', 'cover-entry-label');
    label.append(el('span', 'cover-entry-text', entry.text), el('span', 'cover-entry-hint', entry.hint));
    const more = el('span', 'cover-entry-more', '›');
    more.setAttribute('aria-hidden', 'true');
    button.append(icon, label, more);
    button.addEventListener('click', () => callbacks.onOpen(entry.page));
    entries[entry.page] = button;
    menu.append(button);
  }
  // Konto erst, wenn es eine Sync-Adresse gibt (account-panel.ts hängt sich dann ein).
  entries.account.hidden = true;

  const close = el('button', 'cover-close', 'Schließen');
  close.type = 'button';
  close.dataset.ref = 'cover-close';
  close.addEventListener('click', callbacks.onClose);
  inner.append(plate, menu, close);
  cover.append(inner);

  /** Soll-Zustand (gilt sofort, auch während der Animation). */
  let isOpen = false;
  /** Zählt die Wechsel; das Ende einer abgebrochenen Schließ-Animation tut nichts. */
  let generation = 0;

  return {
    element: cover,
    title,
    entries,
    showAccount() {
      entries.account.hidden = false;
    },
    setForestName: (name) => setText(subtitleForest, name ? ` · ${name}` : ''),
    setOpen(open, animate) {
      if (open === isOpen) return;
      isOpen = open;
      // Eine laufende Animation (z. B. Schließen) wird abgebrochen: ihr Ende bleibt wirkungslos.
      const mine = ++generation;
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
        if (mine !== generation) return;
        cover.classList.remove('cover-out');
        cover.hidden = true;
      };
      cover.addEventListener('animationend', done);
      // Sicherheitsnetz, falls keine Animation läuft (Hintergrund-Tab).
      setTimeout(done, 400);
    },
  };
}
