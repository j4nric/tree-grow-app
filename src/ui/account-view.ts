/**
 * Texte und Prüfungen für den Abschnitt „Konto“ in den Einstellungen – reine Funktionen
 * (getestet in tests/account-view.test.ts). Ruhiger Ton, kurze Sätze.
 */
import type { SyncEvent, SyncProblem, SyncStatus } from '../sync/engine';
import type { BackupEntry, BackupReason } from '../sync/storage';
import type { AccountErrorCode } from '../sync/types';

/** So lange nach einem Abgleich heißt es „Synchronisiert“. */
export const FRESH_SYNC_MS = 5000;
/** Regeln wie auf dem Server (server/src/auth.ts). */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export const ACCOUNT_TEXTS = {
  title: 'Konto',
  lead: 'Mit einem Konto spielst du denselben Wald auf mehreren Geräten – auch gleichzeitig. Melde dich auf jedem Gerät mit demselben Namen an.',
  loading: 'Konto wird geladen …',
  unavailable: 'Das Konto ist gerade nicht erreichbar. Dein Wald wächst auf diesem Gerät weiter.',
  usernameLabel: 'Benutzername',
  usernameHint: `${USERNAME_MIN}–${USERNAME_MAX} Zeichen: Buchstaben a–z, Ziffern, „-“, „_“ oder „.“`,
  passwordLabel: 'Passwort',
  passwordHint: `Mindestens ${PASSWORD_MIN} Zeichen.`,
  signIn: 'Anmelden',
  register: 'Konto anlegen',
  working: 'Einen Moment …',
  signedInAs: (name: string) => `Angemeldet als ${name}`,
  signOut: 'Abmelden',
  signedOut: 'Abgemeldet. Dein Wald bleibt auf diesem Gerät gespeichert.',
  signOutFailed: 'Abmelden hat nicht geklappt. Versuche es gleich noch einmal.',
  signOutUnsent:
    'Deine letzten Änderungen sind noch nicht im Konto (keine Verbindung). Sie bleiben auf diesem Gerät gespeichert. Erneut tippen, um trotzdem abzumelden.',
  signOutAnyway: 'Trotzdem abmelden',
  stale: (name: string) =>
    `In einem anderen Tab ist jetzt ${name ? `„${name}“` : 'ein anderes Konto'} angemeldet. Dieser Tab gleicht nichts mehr ab – lade die Seite neu, um mit diesem Konto weiterzuspielen.`,
  reload: 'Neu laden',
  restoreOpen: 'Sicherung vor dem Sync wiederherstellen',
  restoreHint: 'Welche Sicherung laden? Dein aktueller Wald wird dabei ersetzt.',
  restoreLoad: 'Laden',
  restoreCancel: 'Abbrechen',
  restored: 'Sicherung geladen.',
} as const;

/** Benutzername nach den Server-Regeln (klein geschrieben) oder null. */
export function normalizeUsername(value: string): string | null {
  const name = value.trim().toLowerCase();
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return null;
  return /^[a-z0-9][a-z0-9_.-]*$/.test(name) ? name : null;
}

/** Passwort lang genug (in Zeichen) und nicht zu lang. */
export function isValidPassword(value: string): boolean {
  return [...value].length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

/** Meldung zu einem Fehler beim Anmelden oder Registrieren. */
export function accountErrorText(code: AccountErrorCode | undefined): string {
  switch (code) {
    case 'invalid-username':
      return `Der Benutzername passt nicht: ${ACCOUNT_TEXTS.usernameHint}.`;
    case 'invalid-password':
      return `Das Passwort ist zu kurz. ${ACCOUNT_TEXTS.passwordHint}`;
    case 'taken':
      return 'Diesen Namen gibt es schon. Wähle einen anderen – oder melde dich an, wenn es deiner ist.';
    case 'credentials':
      return 'Name oder Passwort stimmen nicht.';
    case 'rate-limited':
      return 'Zu viele Versuche. Bitte warte ein paar Minuten.';
    case 'network':
      return 'Keine Verbindung zum Konto-Server. Dein Wald wächst hier weiter – versuche es später noch einmal.';
    case 'registration-closed':
      return 'Gerade können keine neuen Konten angelegt werden. Dein Wald wächst auf diesem Gerät weiter.';
    case 'storage-full':
      return 'Der Konto-Server hat gerade keinen Platz. Dein Wald wächst auf diesem Gerät weiter – versuche es später noch einmal.';
    default:
      return 'Das hat nicht geklappt. Versuche es gleich noch einmal.';
  }
}

/** „vor 12 s“, „vor 3 min“, „vor 2 h“ – nie negativ, NaN → „gerade eben“. */
export function agoText(ms: number): string {
  if (!(ms >= 1000)) return 'gerade eben';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `vor ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `vor ${min} min`;
  return `vor ${Math.floor(min / 60)} h`;
}

/** Zeile zum Abgleich: „Synchronisiert“, „Gespeichert vor 12 s“ oder „Offline …“. */
export function syncStatusText(status: SyncStatus, now: number): string {
  const age = status.lastSyncedAt === null ? null : now - status.lastSyncedAt;
  switch (status.phase) {
    case 'connecting':
      return 'Verbinde mit dem Konto …';
    case 'offline':
      return age === null
        ? 'Offline – dein Wald wächst hier weiter, der Abgleich folgt von selbst.'
        : `Offline – zuletzt gespeichert ${agoText(age)}. Dein Wald wächst hier weiter, der Abgleich folgt von selbst.`;
    case 'synced':
      return age === null || age < FRESH_SYNC_MS ? 'Synchronisiert' : `Gespeichert ${agoText(age)}`;
    case 'outdated':
      return SYNC_PROBLEM_TEXTS.outdated;
    case 'cloud-unreadable':
      return SYNC_PROBLEM_TEXTS['cloud-unreadable'];
    case 'local-invalid':
    case 'backup-failed':
      return SYNC_PROBLEM_TEXTS[status.phase];
  }
}

/** Angehaltener Abgleich: kurze Erklärung, der Wald auf diesem Gerät bleibt immer erhalten. */
export const SYNC_PROBLEM_TEXTS: Readonly<Record<SyncProblem, string>> = {
  outdated: 'Neue Spielversion – bitte neu laden. Bis dahin sendet dieses Gerät nichts ans Konto.',
  'cloud-unreadable': 'Der Spielstand im Konto ist nicht lesbar. Der Abgleich ist angehalten; dein Wald wächst hier weiter.',
  'local-invalid': 'Dein Spielstand ist zu groß für das Konto. Er bleibt auf diesem Gerät gespeichert.',
  'backup-failed':
    'Der Speicher dieses Browsers ist voll: Dein Stand ließ sich vor dem Übernehmen nicht sichern. Der Abgleich ist angehalten; dein Wald wächst hier weiter.',
};

/** Ist der Abgleich angehalten (Zeile hervorheben)? */
export function isSyncProblem(status: SyncStatus): boolean {
  return status.phase in SYNC_PROBLEM_TEXTS;
}

/** Kurzer Hinweis zu einem Abgleich-Ereignis (Toast). */
export function syncEventText(event: SyncEvent): string {
  if (event.kind === 'first-login') {
    return event.winner === 'local'
      ? 'Angemeldet. Dein Wald auf diesem Gerät war weiter – er ist jetzt im Konto gespeichert.'
      : 'Angemeldet. Dein Wald aus dem Konto ist geladen; der bisherige Stand dieses Geräts ist als Sicherung aufgehoben.';
  }
  return event.lostLocal
    ? 'Auf anderem Gerät weitergespielt – übernommen. Deine letzte Aktion hier ist als Sicherung aufgehoben.'
    : 'Auf anderem Gerät weitergespielt – übernommen.';
}

/** Warum eine Sicherung angelegt wurde – kurz. */
export const BACKUP_REASON_TEXTS: Readonly<Record<BackupReason, string>> = {
  'first-login-local': 'Stand dieses Geräts vor der ersten Anmeldung',
  'first-login-cloud': 'Stand aus dem Konto vor der ersten Anmeldung',
  'lost-action': 'Von einem anderen Gerät überholte Aktion',
  'before-take': 'Stand dieses Geräts vor dem Übernehmen',
  'before-restore': 'Stand vor dem Wiederherstellen',
  'before-replace': 'Stand vor dem Löschen bzw. Importieren',
  legacy: 'Frühere Sicherung',
};

/** „Stand … · Konto eiche · Zyklus 2 · vor 5 min“ (rein lokal: ohne Konto). */
export function backupLabel(entry: BackupEntry, now: number): string {
  const parts = [BACKUP_REASON_TEXTS[entry.reason]];
  if (entry.owner) parts.push(`Konto ${entry.owner}`);
  if (entry.progress && Number.isFinite(entry.progress.cycle)) parts.push(`Zyklus ${entry.progress.cycle}`);
  parts.push(agoText(now - entry.at));
  return parts.join(' · ');
}
