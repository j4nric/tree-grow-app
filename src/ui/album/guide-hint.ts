/**
 * „Neu hier?“ (docs/ALBUM_UI.md, A.12 #128): Beim allerersten Start eines neuen Spiels
 * klappt am Knopf „☰ Umschlag“ eine Haftnotiz auf – „Anleitung lesen ›“ blättert zur
 * Spielanleitung, „Verstanden“ (wie jeder Klick daneben) schließt sie. Bei einem geladenen
 * Spielstand erscheint sie nie; der Merker gilt trotzdem als gesetzt (settings.ts).
 *
 * Die Notiz geht von selbst auf und nimmt darum keinen Fokus. Ihr Anker ist das Symbol im
 * Umschlag-Knopf (der Knopf selbst trägt `aria-expanded` für den Umschlag); beim Schließen
 * bekommt der Knopf den Fokus zurück.
 */
import { takeFirstStartHint } from '../settings';
import { createNote } from './note';

export const GUIDE_HINT_TITLE = 'Neu hier?';
export const GUIDE_HINT_TEXT = 'Im Umschlag steht die Spielanleitung – Kapitel für Kapitel zum Umblättern.';

export function showGuideHint(newGame: boolean, coverButton: HTMLElement, openGuide: () => void): void {
  // Auch bei einem geladenen Stand den Merker setzen: Wer schon spielt, braucht ihn nicht.
  if (!takeFirstStartHint() || !newGame) return;
  const note = createNote({
    id: 'guide-hint',
    ref: 'guide-hint',
    title: GUIDE_HINT_TITLE,
    more: {
      label: 'Anleitung lesen ›',
      onMore() {
        // Nach dem Zurückblättern bekommt der Umschlag-Knopf den Fokus (der Knopf der Notiz ist weg).
        coverButton.focus({ preventScroll: true });
        openGuide();
      },
    },
  });
  note.element.classList.add('note-hint');
  note.line().textContent = GUIDE_HINT_TEXT;
  const anchor = coverButton.querySelector<HTMLElement>('.album-cover-icon') ?? coverButton;
  // Erst nach dem ersten Layout (sonst stimmt die Lage des Ankers noch nicht).
  requestAnimationFrame(() => note.show(anchor, { focus: false, returnFocus: coverButton }));
}
