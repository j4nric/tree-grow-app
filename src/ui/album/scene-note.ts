/**
 * **Platzhalter** für die Haftnotiz zum Tier im Vollbild (docs/ALBUM_UI.md, C.6 und G-16):
 * Name, Zufriedenheit und Stimmung, dazu „Im Album ansehen ›“. Die echte Haftnotiz
 * (`Note`, popover, Lage am Auslöser) baut Schritt 4 – dann wird nur diese eine Funktion
 * ausgetauscht; Aufrufer und Navigation (`nav.note`) bleiben.
 *
 * Die Notiz entsteht beim Öffnen und verschwindet beim Schließen (kein Frame-Update).
 */
import { el } from '../dom';

export interface SceneNoteContent {
  title: string;
  text: string;
  /** Knopf „Im Album ansehen ›“. */
  moreLabel: string;
  onMore(): void;
  /** „Verstanden“ (schließt die Notiz). */
  onDismiss(): void;
}

/** Zeigt die Notiz in `host` und gibt eine Funktion zum Schließen zurück. */
export function showSceneNote(host: HTMLElement, content: SceneNoteContent): () => void {
  const note = el('div', 'scene-note');
  note.dataset.ref = 'note';
  note.setAttribute('role', 'note');
  const title = el('p', 'scene-note-title', content.title);
  const text = el('p', 'scene-note-text', content.text);
  const actions = el('div', 'scene-note-actions');
  const dismiss = el('button', 'scene-note-dismiss', 'Verstanden');
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => content.onDismiss());
  const more = el('button', 'scene-note-more', content.moreLabel);
  more.type = 'button';
  more.addEventListener('click', () => content.onMore());
  actions.append(dismiss, more);
  note.append(title, text, actions);
  host.append(note);
  return () => note.remove();
}
