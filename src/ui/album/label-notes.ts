/**
 * Haftnotizen der Etiketten Wachstum, Samen und Harmonie (docs/ALBUM_UI.md, A.2 #25–28):
 * Erklärung, Kernzahl und – solange sie gilt – die Nachtwirkung (🌙). Harmonie bekommt
 * zusätzlich „Mehr ›“ zur Unterseite U:Harmonie, sobald es sie gibt (Schritt 5).
 * Einmal gebaut; `update` setzt nur Texte (gedrosselt wie die Etiketten selbst).
 */
import { setText } from '../dom';
import { attachNote, createNote, type Note, type NoteMore } from './note';
import { growthNoteView, harmonyNoteView, seedsNoteView, type LabelNoteInput, type LabelNoteView } from './notes-text';
import type { TapeLabel } from './tape-label';

export interface LabelNotes {
  update(view: LabelNoteInput): void;
}

interface Part {
  note: Note;
  text: HTMLElement;
  emphasis: HTMLElement;
  night: HTMLElement;
  view(input: LabelNoteInput): LabelNoteView;
}

export function createLabelNotes(
  labels: { growth: TapeLabel; seeds: TapeLabel; harmony: TapeLabel },
  harmonyMore?: NoteMore,
): LabelNotes {
  const part = (id: string, label: TapeLabel, view: Part['view'], more?: NoteMore): Part => {
    const note = createNote({ id, title: '', ref: `${id}-note`, more });
    const text = note.line();
    const emphasis = note.line('note-emphasis');
    const night = note.line('note-soft');
    night.hidden = true;
    attachNote(label.element, note);
    return { note, text, emphasis, night, view };
  };
  const parts = [
    part('growth', labels.growth, growthNoteView),
    part('seeds', labels.seeds, seedsNoteView),
    part('harmony', labels.harmony, harmonyNoteView, harmonyMore),
  ];

  return {
    update(input) {
      for (const p of parts) {
        const view = p.view(input);
        p.note.setTitle(view.title);
        setText(p.text, view.text);
        setText(p.emphasis, view.emphasis);
        setText(p.night, view.night);
        if (p.night.hidden !== !view.night) {
          p.night.hidden = !view.night;
          if (p.note.isOpen) p.note.position();
        }
      }
    },
  };
}
