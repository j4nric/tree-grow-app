/**
 * Hilfe und Einstellungen: „❓ Spielanleitung“, „⚙️ Einstellungen“ und der Hinweis
 * „Neu hier?“ beim allerersten Start. Dazu `initPreferences()`, das die Einstellungen
 * lädt und anwendet (Zahlenformat, `data-motion` am body für Szene und CSS).
 *
 * Beide Dialoge sind native `<dialog>`-Elemente (showModal): Fokus bleibt im Dialog,
 * Escape schließt, danach geht der Fokus an den auslösenden Knopf zurück.
 */
import { el } from './dom';
import { formatNumber, setNumberStyle, type NumberStyle } from './format';
import { guideSections } from './guide-view';
import {
  LONG_TOAST_MS,
  TOAST_MS,
  effectiveReducedMotion,
  loadSettings,
  saveSettings,
  takeFirstStartHint,
  toastDuration,
  type MotionSetting,
  type Settings,
  type SoundLevel,
} from './settings';

export interface Preferences {
  readonly settings: Readonly<Settings>;
  /** Wirksam: Bewegung reduzieren (Einstellung oder System). */
  readonly reducedMotion: boolean;
  /** Anzeigedauer der Hinweise (Toasts) in ms. */
  toastMs(): number;
  update(patch: Partial<Settings>): void;
  /** Wird nach jeder wirksamen Änderung gerufen (Einstellung oder System). */
  onChange(listener: () => void): void;
}

/** Lädt und wendet die Einstellungen an. Einmal beim Start aufrufen (vor der ersten Anzeige). */
export function initPreferences(): Preferences {
  let settings = loadSettings();
  let reduced = false;
  const listeners: (() => void)[] = [];
  const query =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function apply(): void {
    setNumberStyle(settings.numbers);
    reduced = effectiveReducedMotion(settings.motion, query?.matches ?? false);
    // CSS-Animationen und feedback.ts lesen dieses Attribut (Vorrang vor der Media-Query).
    document.body.dataset.motion = reduced ? 'reduce' : 'full';
  }
  const changed = () => {
    apply();
    for (const listener of listeners) listener();
  };
  apply();
  query?.addEventListener('change', changed);

  return {
    get settings() {
      return settings;
    },
    get reducedMotion() {
      return reduced;
    },
    toastMs: () => toastDuration(settings),
    update(patch) {
      settings = { ...settings, ...patch };
      saveSettings(settings);
      changed();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}

interface Modal {
  dialog: HTMLDialogElement;
  body: HTMLElement;
  show(): void;
  hide(): void;
  /** Kurzer Hinweis in der Aktionsleiste (role=status), z. B. „Stammgast eingezogen“. */
  notice(text: string): void;
}

/** So lange bleibt ein Hinweis im Dialog stehen. */
const NOTICE_MS = 4000;

/** Schlichter modaler Dialog im Stil des Naturtagebuchs. */
function createModal(root: HTMLElement, ref: string, title: string): Modal {
  const dialog = el('dialog', `encounter help-dialog ${ref}`);
  dialog.dataset.ref = ref;
  dialog.setAttribute('aria-labelledby', `${ref}-title`);
  const inner = el('div', 'encounter-inner');
  const header = el('header', 'encounter-header');
  const heading = el('h2', 'encounter-title', title);
  heading.id = `${ref}-title`;
  header.append(heading);
  const body = el('div', 'help-body');
  const actions = el('div', 'encounter-actions');
  const noticeBox = el('p', 'encounter-notice');
  noticeBox.setAttribute('role', 'status');
  noticeBox.hidden = true;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const close = el('button', 'encounter-button secondary', 'Schließen');
  close.type = 'button';
  actions.append(noticeBox, close);
  inner.append(header, body, actions);
  dialog.append(inner);
  root.append(dialog);

  let returnFocus: HTMLElement | null = null;
  let showing = false;

  function clearNotice(): void {
    clearTimeout(noticeTimer);
    noticeBox.hidden = true;
    noticeBox.textContent = '';
  }

  function finish(): void {
    showing = false;
    clearNotice();
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected && !target.hidden) target.focus({ preventScroll: true });
  }
  function hide(): void {
    if (!dialog.open) return;
    dialog.close();
    finish();
  }
  close.addEventListener('click', hide);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    hide();
  });
  dialog.addEventListener('close', () => {
    if (showing && !dialog.open) finish();
  });

  return {
    dialog,
    body,
    show() {
      if (dialog.open) return;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      showing = true;
      dialog.showModal();
      dialog.scrollTop = 0;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    },
    hide,
    notice(text) {
      clearTimeout(noticeTimer);
      noticeBox.textContent = text;
      noticeBox.hidden = false;
      noticeTimer = setTimeout(clearNotice, NOTICE_MS);
    },
  };
}

function buildGuide(body: HTMLElement): void {
  const nav = el('p', 'help-lead', 'Kurz erklärt: So wächst dein Wald.');
  body.append(nav);
  for (const section of guideSections()) {
    const box = el('section', `help-section${section.soon ? ' soon' : ''}`);
    box.dataset.section = section.id;
    const title = el('h3', 'help-section-title');
    const icon = el('span', 'help-section-icon', section.icon);
    icon.setAttribute('aria-hidden', 'true');
    title.append(icon, el('span', '', section.title));
    if (section.soon) title.append(el('span', 'help-soon', 'kommt bald'));
    box.append(title, ...section.paragraphs.map((p) => el('p', 'help-text', p)));
    body.append(box);
  }
}

interface Choice<T extends string> {
  value: T;
  label: string;
}

/** Eine Gruppe echter Radio-Knöpfe (Pfeiltasten wählen, Tab springt zur nächsten Gruppe). */
function radioGroup<T extends string>(
  name: string,
  legend: string,
  choices: readonly Choice<T>[],
  current: T,
  onPick: (value: T) => void,
): HTMLElement {
  const fieldset = el('fieldset', 'help-setting');
  fieldset.dataset.setting = name;
  fieldset.append(el('legend', '', legend));
  for (const choice of choices) {
    const label = el('label', 'help-choice');
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = choice.value;
    input.checked = choice.value === current;
    input.addEventListener('change', () => {
      if (input.checked) onPick(choice.value);
    });
    label.append(input, el('span', '', choice.label));
    fieldset.append(label);
  }
  return fieldset;
}

function buildSettings(body: HTMLElement, prefs: Preferences): void {
  const s = prefs.settings;
  const example = 1_234_567;
  const seconds = (ms: number) => `${formatNumber(ms / 1000)} s`;
  body.append(
    el('p', 'help-lead', 'Gilt nur für dieses Gerät und diesen Browser – dein Spielstand bleibt unberührt.'),
    radioGroup<MotionSetting>(
      'motion',
      'Bewegung reduzieren',
      [
        { value: 'auto', label: 'Automatisch (wie im System eingestellt)' },
        { value: 'on', label: 'An – ruhige Szene, keine Animationen' },
        { value: 'off', label: 'Aus – alle Animationen' },
      ],
      s.motion,
      (motion) => prefs.update({ motion }),
    ),
    radioGroup<NumberStyle>(
      'numbers',
      'Zahlenformat',
      [
        { value: 'short', label: `Kurz („${formatNumber(example, 'short')}“)` },
        { value: 'long', label: `Ausgeschrieben („${formatNumber(example, 'long')}“)` },
      ],
      s.numbers,
      (numbers) => prefs.update({ numbers }),
    ),
    radioGroup<'no' | 'yes'>(
      'toasts',
      'Hinweise länger anzeigen',
      [
        { value: 'no', label: `Nein (${seconds(TOAST_MS)})` },
        { value: 'yes', label: `Ja (${seconds(LONG_TOAST_MS)})` },
      ],
      s.longToasts ? 'yes' : 'no',
      (value) => prefs.update({ longToasts: value === 'yes' }),
    ),
    radioGroup<SoundLevel>(
      'sound',
      'Klang',
      [
        { value: 'off', label: 'Aus (Standard, kein Ton)' },
        { value: 'quiet', label: 'Leise – Wind, Vögel und sanfte Töne' },
        { value: 'normal', label: 'Normal – etwas lauter' },
      ],
      s.sound,
      (sound) => prefs.update({ sound }),
    ),
  );
}

export interface Help {
  openGuide(): void;
  /** Ist die Anleitung oder sind die Einstellungen offen? */
  readonly open: boolean;
  /** Hinweis im offenen Dialog zeigen; false, wenn keiner offen ist. */
  notice(text: string): boolean;
  /** Weiterer Abschnitt am Ende der Einstellungen (z. B. „Konto“). */
  addSettingsSection(section: HTMLElement): void;
}

export interface HelpOptions {
  /**
   * Neues Spiel (kein gespeicherter Stand): Nur dann erscheint „Neu hier?“. Bei einem
   * geladenen Spielstand wird der Hinweis gar nicht erst gezeigt (und gilt als gesehen).
   */
  newGame: boolean;
}

/**
 * Knöpfe „❓ Spielanleitung“ und „⚙️ Einstellungen“ in `root` (Seitenleiste), die Dialoge
 * und – nur beim allerersten Start eines neuen Spiels – der schließbare Hinweis „Neu hier?“.
 */
export function createHelp(root: HTMLElement, prefs: Preferences, options: HelpOptions): Help {
  const bar = el('div', 'help-bar');
  const guideButton = el('button', 'help-button');
  guideButton.type = 'button';
  guideButton.dataset.ref = 'guide-open';
  guideButton.setAttribute('aria-haspopup', 'dialog');
  const guideIcon = el('span', '', '❓');
  guideIcon.setAttribute('aria-hidden', 'true');
  guideButton.append(guideIcon, el('span', '', 'Spielanleitung'));
  const settingsButton = el('button', 'help-button');
  settingsButton.type = 'button';
  settingsButton.dataset.ref = 'settings-open';
  settingsButton.setAttribute('aria-haspopup', 'dialog');
  const settingsIcon = el('span', '', '⚙️');
  settingsIcon.setAttribute('aria-hidden', 'true');
  settingsButton.append(settingsIcon, el('span', '', 'Einstellungen'));
  bar.append(guideButton, settingsButton);
  root.append(bar);

  const guide = createModal(document.body, 'guide', '❓ Spielanleitung');
  buildGuide(guide.body);
  const settings = createModal(document.body, 'settings', '⚙️ Einstellungen');
  buildSettings(settings.body, prefs);

  guideButton.addEventListener('click', () => guide.show());
  settingsButton.addEventListener('click', () => settings.show());

  // Auch bei einem geladenen Stand den Merker setzen: Wer schon spielt, braucht ihn nicht.
  const firstStart = takeFirstStartHint();
  if (firstStart && options.newGame) {
    const hint = el('div', 'help-hint');
    hint.dataset.ref = 'guide-hint';
    const text = el('span', 'help-hint-text', 'Neu hier?');
    const open = el('button', 'help-hint-open', 'Spielanleitung öffnen');
    open.type = 'button';
    const dismiss = el('button', 'help-hint-close', '×');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Hinweis schließen');
    hint.append(text, open, dismiss);
    root.append(hint);
    const remove = () => {
      // Fokus nicht im Nichts lassen, wenn er auf dem Hinweis lag.
      if (hint.contains(document.activeElement)) guideButton.focus({ preventScroll: true });
      hint.remove();
    };
    open.addEventListener('click', () => {
      remove();
      guide.show();
    });
    dismiss.addEventListener('click', remove);
  }

  const openModal = () => (guide.dialog.open ? guide : settings.dialog.open ? settings : null);
  return {
    openGuide: () => guide.show(),
    get open() {
      return openModal() !== null;
    },
    notice(text) {
      const modal = openModal();
      if (!modal) return false;
      modal.notice(text);
      return true;
    },
    addSettingsSection(section) {
      settings.body.append(section);
    },
  };
}
