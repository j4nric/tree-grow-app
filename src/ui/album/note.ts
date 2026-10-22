/**
 * Haftnotiz (docs/ALBUM_UI.md, C.4): kurze Erklärung, die über der Seite aufklappt – gelber
 * Zettel mit Washi-Streifen, leicht gedreht, Knopf „Verstanden“ und optional „Mehr ›“
 * (öffnet die passende Unterseite und schließt die Notiz).
 *
 * - `popover="auto"`: oberste Ebene, Klick außerhalb und Escape vom Browser. Ohne popover
 *   (iOS < 17) hilft die Klasse `.note-open` mit eigenem Klick-außerhalb (G-22).
 * - Es gibt immer höchstens eine offene Notiz. Wer sie öffnet oder schließt, meldet das an
 *   `onNoteChange` (das Album führt die ID in `nav.note`, C.1).
 * - DOM einmal bauen: Jede Notiz ist ein festes Element; `update` setzt nur Texte.
 *   Ausnahme: `openNote` (freie Notiz, z. B. Tier-Tipp im Vollbild) baut ihren Inhalt beim
 *   Öffnen neu – das passiert nur auf Tippen, nie im Frame.
 * - Der Fokus wandert beim Öffnen in die Notiz und beim Schließen zurück an den Auslöser,
 *   wenn er sonst in der geschlossenen Notiz (oder im Nichts) stünde.
 */
import { el, setAttr, setText } from '../dom';
import { notePosition } from './note-layout';
import './note.css';

export interface NoteMore {
  /** Beschriftung, Standard „Mehr ›“. */
  label?: string;
  onMore(): void;
  /** Nur zeigen, wenn es die Unterseite schon gibt (Standard: immer). */
  available?(): boolean;
}

export interface NoteOptions {
  /** Kennung in `nav.note`; das Element heißt `note-<id>`. */
  id: string;
  title: string;
  /** `data-ref` der Notiz (Standard `note`). */
  ref?: string;
  more?: NoteMore;
}

export interface Note {
  readonly id: string;
  readonly element: HTMLElement;
  /** Inhalt zwischen Titel und Knöpfen (Zeilen per `line`). */
  readonly body: HTMLElement;
  readonly isOpen: boolean;
  setTitle(text: string): void;
  /** Neue Zeile im Inhalt (nur beim Aufbau aufrufen). */
  line(className?: string, ref?: string): HTMLParagraphElement;
  show(anchor: HTMLElement): void;
  /** Schließen; `focusAnchor` gibt den Fokus in jedem Fall an den Auslöser zurück. */
  hide(focusAnchor?: boolean): void;
  /** Lage neu rechnen (z. B. wenn der Inhalt länger wurde). */
  position(): void;
}

/** Inhalt einer freien Notiz (`openNote`). */
export interface NoteContent {
  title: string;
  /** Absätze; leere werden ausgelassen. */
  lines?: readonly string[];
  /** Hervorgehobene Zeile in Grün (z. B. „jetzt: Wachstum ×1,32“). */
  emphasis?: string;
  more?: NoteMore;
  /** `data-ref` der Notiz (Standard `note`). */
  ref?: string;
}

const POPOVER = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

let current: NoteImpl | null = null;
const listeners: ((id: string | null) => void)[] = [];

/** Meldet jede geöffnete (ID) bzw. geschlossene (null) Notiz – für `nav.note`. */
export function onNoteChange(listener: (id: string | null) => void): void {
  listeners.push(listener);
}

/** ID der offenen Notiz, sonst null. */
export function openNoteId(): string | null {
  return current?.id ?? null;
}

/** Offene Notiz schließen (Reiterwechsel, Umblättern, Vollbild, Escape). */
export function closeNotes(): void {
  current?.hide();
}

function emit(id: string | null): void {
  for (const listener of listeners) listener(id);
}

interface NoteImpl extends Note {
  readonly moreButton: HTMLButtonElement;
  setMore(more: NoteMore | null): void;
}

export function createNote(options: NoteOptions): Note {
  return build(options);
}

function build(options: NoteOptions): NoteImpl {
  const root = el('div', 'note');
  root.id = `note-${options.id}`;
  root.dataset.ref = options.ref ?? 'note';
  root.setAttribute('role', 'note');
  root.tabIndex = -1;
  if (POPOVER) root.popover = 'auto';
  else root.hidden = true;
  const tape = el('span', 'note-tape');
  tape.setAttribute('aria-hidden', 'true');
  const title = el('p', 'note-title', options.title);
  title.id = `note-${options.id}-title`;
  root.setAttribute('aria-labelledby', title.id);
  const body = el('div', 'note-body');
  const actions = el('div', 'note-actions');
  const more = el('button', 'note-more');
  more.type = 'button';
  const ok = el('button', 'note-ok', 'Verstanden');
  ok.type = 'button';
  actions.append(more, ok);
  root.append(tape, title, body, actions);
  document.body.append(root);

  let anchor: HTMLElement | null = null;
  let open = false;
  let moreOptions: NoteMore | null = null;
  let frame = 0;

  const reposition = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  };

  function setMore(next: NoteMore | null): void {
    moreOptions = next;
    setText(more, next?.label ?? 'Mehr ›');
    // `available` erst beim Öffnen fragen (beim Aufbau gibt es die Seiten evtl. noch nicht).
    if (open) refreshMore();
    else more.hidden = true;
  }

  function refreshMore(): void {
    const show = moreOptions !== null && (moreOptions.available?.() ?? true);
    if (more.hidden === show) more.hidden = !show;
  }

  function place(): void {
    if (!open || !anchor) return;
    if (!anchor.isConnected || anchor.closest('[hidden]')) {
      hide();
      return;
    }
    const a = anchor.getBoundingClientRect();
    const spot = notePosition(
      a,
      { width: root.offsetWidth, height: root.offsetHeight },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
    );
    root.style.left = `${spot.left}px`;
    root.style.top = `${spot.top}px`;
    root.classList.toggle('note-above', spot.above);
  }

  function setExpanded(value: boolean): void {
    if (anchor?.hasAttribute('aria-expanded')) setAttr(anchor, 'aria-expanded', String(value));
  }

  function show(next: HTMLElement): void {
    if (open && anchor === next) return;
    if (current && current !== note) current.hide();
    if (open) setExpanded(false);
    anchor = next;
    open = true;
    current = note;
    refreshMore();
    if (POPOVER) {
      if (!root.matches(':popover-open')) root.showPopover();
    } else {
      root.hidden = false;
      root.classList.add('note-open');
    }
    root.classList.remove('note-in');
    void root.offsetWidth; // Aufklappen neu starten
    root.classList.add('note-in');
    place();
    setExpanded(true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    if (!POPOVER) document.addEventListener('pointerdown', outside, true);
    root.focus({ preventScroll: true });
    emit(options.id);
  }

  /** Geschlossen (Knopf, Escape, Klick außerhalb, andere Notiz, Navigation). */
  function closed(focusAnchor: boolean): void {
    if (!open) return;
    open = false;
    const focusInside = root.contains(document.activeElement) || document.activeElement === document.body;
    setExpanded(false);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    document.removeEventListener('pointerdown', outside, true);
    root.classList.remove('note-in');
    const back = anchor;
    if (current === note) {
      current = null;
      emit(null);
    }
    if ((focusAnchor || focusInside) && back?.isConnected && !back.closest('[hidden], [inert]')) back.focus({ preventScroll: true });
  }

  function hide(focusAnchor = false): void {
    if (!open) return;
    if (POPOVER) {
      // Erst merken, dann schließen: das toggle-Ereignis kommt später und findet `open` = false.
      closed(focusAnchor);
      if (root.matches(':popover-open')) root.hidePopover();
    } else {
      root.classList.remove('note-open');
      root.hidden = true;
      closed(focusAnchor);
    }
  }

  function outside(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (!target || root.contains(target) || anchor?.contains(target)) return;
    hide();
  }

  if (POPOVER) {
    // Klick außerhalb und Escape schließt der Browser selbst.
    root.addEventListener('toggle', (event) => {
      if ((event as ToggleEvent).newState === 'closed') closed(false);
    });
  }
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open) return;
    // Nur die Notiz schließen – nicht zusätzlich eine Unterseite (Album hört auf Escape).
    event.preventDefault();
    hide(true);
  });
  ok.addEventListener('click', () => hide(true));
  more.addEventListener('click', () => {
    const action = moreOptions;
    hide();
    action?.onMore();
  });

  const note: NoteImpl = {
    id: options.id,
    element: root,
    body,
    moreButton: more,
    get isOpen() {
      return open;
    },
    setTitle: (text) => setText(title, text),
    line(className, ref) {
      const p = el('p', `note-line${className ? ` ${className}` : ''}`);
      if (ref) p.dataset.ref = ref;
      body.append(p);
      return p;
    },
    show,
    hide,
    position: () => place(),
    setMore,
  };
  setMore(options.more ?? null);
  return note;
}

/**
 * Knopf als Auslöser einer Notiz: `aria-expanded`, `aria-controls`, Klick klappt auf und zu.
 * Ein Tipp auf den Auslöser bei offener Notiz schließt sie (der Klick außerhalb hat sie dann
 * schon geschlossen – darum zählt der Stand beim Drücken, nicht beim Loslassen).
 */
export function attachNote(trigger: HTMLElement, note: Note): void {
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', note.element.id);
  let openOnPress: boolean | null = null;
  trigger.addEventListener('pointerdown', () => (openOnPress = note.isOpen));
  trigger.addEventListener('click', () => {
    const wasOpen = openOnPress ?? note.isOpen;
    openOnPress = null;
    if (wasOpen) note.hide(true);
    else note.show(trigger);
  });
}

let free: NoteImpl | null = null;

/**
 * Freie Haftnotiz an einem beliebigen Element (Schritt 3: Tier-Tipp im Vollbild mit
 * „Im Album ansehen ›“). Es gibt nur eine; ein neuer Aufruf ersetzt den Inhalt. Liefert die
 * Notiz (z. B. zum Schließen per `hide()`).
 */
export function openNote(anchor: HTMLElement, content: NoteContent): Note {
  free ??= build({ id: 'free', title: content.title });
  const note = free;
  note.hide();
  note.setTitle(content.title);
  note.element.dataset.ref = content.ref ?? 'note';
  const lines = (content.lines ?? []).filter(Boolean).map((text) => el('p', 'note-line', text));
  if (content.emphasis) lines.push(el('p', 'note-line note-emphasis', content.emphasis));
  note.body.replaceChildren(...lines);
  note.setMore(content.more ?? null);
  note.show(anchor);
  return note;
}
