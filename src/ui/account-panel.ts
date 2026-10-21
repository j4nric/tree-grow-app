/**
 * Abschnitt „Konto“ im Dialog ⚙️ Einstellungen: Benutzername und Passwort, „Anmelden“ und
 * „Konto anlegen“, angemeldet „Abmelden“ und der Stand des Abgleichs.
 *
 * Reine Darstellung: Anmelden, Registrieren und Abmelden erledigt der Aufrufer
 * (src/sync/account.ts); Fehler (AccountError) werden hier als ruhige Meldung gezeigt.
 */
import { AccountError } from '../sync/types';
import { ACCOUNT_TEXTS as T, accountErrorText, isValidPassword, normalizeUsername } from './account-view';
import { el, setText } from './dom';

export interface AccountPanelCallbacks {
  /** Anmelden bzw. Konto anlegen; wirft bei Fehlern (AccountError). */
  onSignIn(username: string, password: string): Promise<void>;
  onRegister(username: string, password: string): Promise<void>;
  /**
   * Abmelden. `force` = auch mit noch nicht gesendeten Änderungen. Rückgabe 'unsent': nicht
   * abgemeldet, weil Änderungen noch nicht im Konto sind (Hinweis zeigen, erneut fragen).
   */
  onSignOut(force: boolean): Promise<'done' | 'unsent'>;
  /** Welche Sicherungen von vor dem Abgleich es gibt. */
  backups(): BackupAvailability;
  /** Sicherung laden (ersetzt den aktuellen Stand); Rückgabe: Fehlertext oder null. */
  onRestore(kind: BackupKind): string | null;
}

export type BackupKind = 'local' | 'cloud' | 'undo';

export interface BackupAvailability {
  /** Stand dieses Geräts vor dem Abgleich. */
  local: boolean;
  /** Stand aus dem Konto vor der ersten Anmeldung (nur für dasselbe Konto). */
  cloud: boolean;
  /** Stand vor dem letzten Wiederherstellen. */
  undo: boolean;
}

export interface AccountPanel {
  readonly element: HTMLElement;
  showLoading(): void;
  showUnavailable(): void;
  showSignedOut(): void;
  showSignedIn(name: string): void;
  /** Zeile zum Abgleich (nur angemeldet sichtbar); 'bad' = Abgleich angehalten. */
  setSync(text: string, tone?: 'neutral' | 'bad'): void;
  /** Ein anderer Tab hat sich mit einem anderen Konto angemeldet: nur noch „Neu laden“. */
  showStale(name: string): void;
  /** Knopf „Sicherung … wiederherstellen“ nur zeigen, wenn es eine gibt. */
  setBackups(available: BackupAvailability): void;
}

let fieldId = 0;

function field(label: string, hint: string, input: HTMLInputElement): HTMLElement {
  const id = `account-field-${++fieldId}`;
  const wrap = el('div', 'save-label');
  const labelEl = el('label', '', label);
  labelEl.htmlFor = id;
  input.id = id;
  const hintEl = el('span', 'account-hint', hint);
  hintEl.id = `${id}-hint`;
  input.setAttribute('aria-describedby', hintEl.id);
  wrap.append(labelEl, input, hintEl);
  return wrap;
}

export function createAccountPanel(callbacks: AccountPanelCallbacks): AccountPanel {
  const section = el('section', 'help-setting account');
  section.dataset.ref = 'account';
  section.setAttribute('aria-labelledby', 'account-title');
  const title = el('h3', 'account-title', T.title);
  title.id = 'account-title';
  const lead = el('p', 'account-text', T.lead);

  // Abgemeldet: Name, Passwort, „Anmelden“ (Enter) und „Konto anlegen“.
  const form = el('form', 'account-form');
  form.noValidate = true;
  const username = el('input', 'account-input');
  username.type = 'text';
  username.name = 'username';
  username.autocomplete = 'username';
  username.autocapitalize = 'none';
  username.spellcheck = false;
  username.maxLength = 64;
  username.dataset.ref = 'account-username';
  const password = el('input', 'account-input');
  password.type = 'password';
  password.name = 'password';
  password.autocomplete = 'current-password';
  password.maxLength = 200;
  password.dataset.ref = 'account-password';
  const signIn = el('button', 'save-button', T.signIn);
  signIn.type = 'submit';
  signIn.dataset.ref = 'account-signin';
  const register = el('button', 'save-button', T.register);
  register.type = 'button';
  register.dataset.ref = 'account-register';
  const row = el('div', 'save-row');
  row.append(signIn, register);
  form.append(field(T.usernameLabel, T.usernameHint, username), field(T.passwordLabel, T.passwordHint, password), row);

  // Angemeldet: wer, Abgleich, Abmelden.
  const signedIn = el('div', 'account-signed-in');
  signedIn.hidden = true;
  const who = el('p', 'account-who');
  who.dataset.ref = 'account-who';
  const sync = el('p', 'account-sync');
  sync.dataset.ref = 'account-sync';
  const signOut = el('button', 'save-button', T.signOut);
  signOut.type = 'button';
  signOut.dataset.ref = 'account-signout';
  signedIn.append(who, sync, signOut);

  const status = el('p', 'save-status account-status');
  status.setAttribute('role', 'status');
  status.dataset.ref = 'account-status';

  // Anderer Tab, anderes Konto: nur noch neu laden.
  const staleBox = el('div', 'account-stale');
  staleBox.hidden = true;
  const staleText = el('p', 'account-text');
  staleText.dataset.ref = 'account-stale';
  const reload = el('button', 'save-button', T.reload);
  reload.type = 'button';
  reload.addEventListener('click', () => window.location.reload());
  staleBox.append(staleText, reload);

  // Sicherungen von vor dem Abgleich laden – zwei Schritte statt confirm().
  const restore = el('div', 'account-restore');
  restore.hidden = true;
  const restoreOpen = el('button', 'link-button', T.restoreOpen);
  restoreOpen.type = 'button';
  restoreOpen.dataset.ref = 'account-restore';
  restoreOpen.setAttribute('aria-expanded', 'false');
  const restoreChoice = el('div', 'account-restore-choice');
  restoreChoice.hidden = true;
  const restoreHint = el('p', 'account-text', T.restoreHint);
  const restoreLocal = el('button', 'save-button', T.restoreLocal);
  restoreLocal.type = 'button';
  restoreLocal.dataset.ref = 'account-restore-local';
  const restoreCloud = el('button', 'save-button', T.restoreCloud);
  restoreCloud.type = 'button';
  restoreCloud.dataset.ref = 'account-restore-cloud';
  const restoreUndo = el('button', 'save-button', T.restoreUndo);
  restoreUndo.type = 'button';
  restoreUndo.dataset.ref = 'account-restore-undo';
  const restoreCancel = el('button', 'save-button', T.restoreCancel);
  restoreCancel.type = 'button';
  const restoreRow = el('div', 'save-row');
  restoreRow.append(restoreLocal, restoreCloud, restoreUndo, restoreCancel);
  restoreChoice.append(restoreHint, restoreRow);
  restore.append(restoreOpen, restoreChoice);

  section.append(title, lead, form, signedIn, staleBox, restore, status);

  let isStale = false;
  function setBackups(available: BackupAvailability): void {
    restoreLocal.hidden = !available.local;
    restoreCloud.hidden = !available.cloud;
    restoreUndo.hidden = !available.undo;
    // Veralteter Tab (anderes Konto in einem anderen Tab): nie etwas laden.
    restore.hidden = isStale || (!available.local && !available.cloud && !available.undo);
    if (restore.hidden) closeRestore();
  }

  function closeRestore(): void {
    restoreChoice.hidden = true;
    restoreOpen.setAttribute('aria-expanded', 'false');
  }

  restoreOpen.addEventListener('click', () => {
    setBackups(callbacks.backups());
    restoreChoice.hidden = !restoreChoice.hidden;
    restoreOpen.setAttribute('aria-expanded', String(!restoreChoice.hidden));
  });
  restoreCancel.addEventListener('click', () => {
    closeRestore();
    restoreOpen.focus();
  });
  for (const [button, kind] of [
    [restoreLocal, 'local'],
    [restoreCloud, 'cloud'],
    [restoreUndo, 'undo'],
  ] as const) {
    button.addEventListener('click', () => {
      const error = callbacks.onRestore(kind);
      closeRestore();
      say(error ?? T.restored, error ? 'bad' : 'good');
    });
  }

  function say(text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral'): void {
    status.textContent = text;
    status.className = `save-status account-status tone-${tone}`;
  }

  let working = false;
  function setWorking(on: boolean, button: HTMLButtonElement, label: string): void {
    working = on;
    signIn.disabled = on;
    register.disabled = on;
    button.setAttribute('aria-busy', String(on));
    button.textContent = on ? T.working : label;
  }

  function invalid(input: HTMLInputElement, text: string): void {
    input.setAttribute('aria-invalid', 'true');
    say(text, 'bad');
    input.focus();
  }

  function submit(kind: 'signin' | 'register'): void {
    if (working) return;
    username.removeAttribute('aria-invalid');
    password.removeAttribute('aria-invalid');
    const name = normalizeUsername(username.value);
    if (!name) return invalid(username, accountErrorText('invalid-username'));
    if (!isValidPassword(password.value)) {
      // Beim Anmelden nicht verraten, welche Regeln gelten – nur „stimmt nicht“.
      return invalid(password, accountErrorText(kind === 'register' ? 'invalid-password' : 'credentials'));
    }
    const button = kind === 'signin' ? signIn : register;
    const label = kind === 'signin' ? T.signIn : T.register;
    setWorking(true, button, label);
    const action = kind === 'signin' ? callbacks.onSignIn : callbacks.onRegister;
    action(name, password.value).then(
      () => setWorking(false, button, label),
      (error: unknown) => {
        setWorking(false, button, label);
        say(accountErrorText(error instanceof AccountError ? error.code : undefined), 'bad');
      },
    );
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit('signin');
  });
  register.addEventListener('click', () => submit('register'));

  // Zweiter Klick nach dem Hinweis auf nicht gesendete Änderungen: trotzdem abmelden.
  let forceSignOut = false;
  function resetSignOut(): void {
    forceSignOut = false;
    signOut.textContent = T.signOut;
  }

  signOut.addEventListener('click', () => {
    if (signOut.disabled) return;
    signOut.disabled = true;
    callbacks.onSignOut(forceSignOut).then(
      (result) => {
        signOut.disabled = false;
        if (result === 'unsent') {
          forceSignOut = true;
          signOut.textContent = T.signOutAnyway;
          say(T.signOutUnsent, 'bad');
        } else {
          resetSignOut();
        }
      },
      () => {
        signOut.disabled = false;
        say(T.signOutFailed, 'bad');
      },
    );
  });

  function mode(which: 'loading' | 'unavailable' | 'out' | 'in' | 'stale'): void {
    form.hidden = which !== 'out';
    signedIn.hidden = which !== 'in';
    staleBox.hidden = which !== 'stale';
    lead.hidden = which === 'in' || which === 'stale';
  }

  const panel: AccountPanel = {
    element: section,
    showLoading() {
      mode('loading');
      say(T.loading);
    },
    showUnavailable() {
      mode('unavailable');
      say(T.unavailable, 'bad');
    },
    showSignedOut() {
      const wasIn = !signedIn.hidden;
      // Fokus lag auf „Abmelden“, das gleich verschwindet: aufs Namensfeld setzen.
      const focusInside = signedIn.contains(document.activeElement);
      mode('out');
      say(wasIn ? T.signedOut : '');
      if (focusInside) username.focus({ preventScroll: true });
    },
    showSignedIn(name) {
      // Fokus lag im Formular, das gleich verschwindet: auf „Abmelden“ setzen.
      const focusInside = form.contains(document.activeElement);
      password.value = '';
      mode('in');
      resetSignOut();
      setText(who, T.signedInAs(name));
      say('');
      if (focusInside) signOut.focus({ preventScroll: true });
    },
    showStale(name) {
      isStale = true;
      setBackups({ local: false, cloud: false, undo: false });
      mode('stale');
      setText(staleText, T.stale(name));
      say('');
    },
    setBackups,
    setSync(text, tone = 'neutral') {
      setText(sync, text);
      sync.className = `account-sync tone-${tone}`;
    },
  };
  panel.showLoading();
  setBackups(callbacks.backups());
  return panel;
}
