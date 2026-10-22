/**
 * Banderole (docs/ALBUM_UI.md, A.1 #11/#12): dauerhaftes Band quer über dem Album – gelb in
 * Washi-Optik für den Update-Hinweis (Logik in pwa.ts), rot für „neuerer Spielstand“. Bleibt,
 * bis der Spieler handelt (kein Ablauf wie bei Stempeln). Einmal gebaut, danach nur Text und
 * Sichtbarkeit.
 */
import { el, setText } from '../dom';
import './banderole.css';

export type BanderoleTone = 'tape' | 'alert';

export interface BanderoleButton {
  label: string;
  onClick(button: HTMLButtonElement): void;
  /** Nur ein Zeichen (z. B. „×“): aria-label und title. */
  ariaLabel?: string;
  className?: string;
}

export interface BanderoleOptions {
  tone: BanderoleTone;
  ref: string;
  role: 'status' | 'alert';
  text?: string;
  buttons?: readonly BanderoleButton[];
  /** Klasse zusätzlich zu `.banderole` (Altnamen, z. B. `update-hint`). */
  className?: string;
}

export interface Banderole {
  readonly element: HTMLElement;
  readonly buttons: readonly HTMLButtonElement[];
  setText(text: string): void;
  show(): void;
  hide(): void;
}

export function createBanderole(options: BanderoleOptions): Banderole {
  const root = el('div', `banderole banderole-${options.tone}${options.className ? ` ${options.className}` : ''}`);
  root.dataset.ref = options.ref;
  root.setAttribute('role', options.role);
  const text = el('p', 'banderole-text', options.text ?? '');
  const actions = el('div', 'banderole-actions');
  const buttons = (options.buttons ?? []).map((b) => {
    const button = el('button', `banderole-button${b.className ? ` ${b.className}` : ''}`, b.label);
    button.type = 'button';
    if (b.ariaLabel) {
      button.setAttribute('aria-label', b.ariaLabel);
      button.title = b.ariaLabel;
      button.classList.add('banderole-icon');
    }
    button.addEventListener('click', () => b.onClick(button));
    return button;
  });
  actions.append(...buttons);
  root.append(text, actions);

  return {
    element: root,
    buttons,
    setText: (value) => setText(text, value),
    show: () => (root.hidden = false),
    hide: () => (root.hidden = true),
  };
}
