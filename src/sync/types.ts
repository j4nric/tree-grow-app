/**
 * Schnittstellen des Konto-Abgleichs. Die echte Umsetzung spricht mit dem eigenen
 * Sync-Server (http-service.ts, lazy geladen); Tests benutzen Fakes – der Abgleich selbst
 * (engine.ts) kennt nur diese Schnittstellen.
 */
import type { RemoteMeta } from './policy';

/** Ein gespeicherter Stand in der Cloud: Kopfdaten und der Spielstand als Text-Code. */
export interface RemoteSave extends RemoteMeta {
  /** Spielstand als Export-Code („VSZW1:…“ mit Prüfsumme). */
  data: string;
}

/** Zu schreibende Werte. `actionVersion` fehlt = Push ohne Aktion (bleibt unverändert). */
export interface SaveWrite {
  data: string;
  version: number;
  device: string;
  actionVersion?: number;
}

/** 'conflict': Stand existiert schon (insert) bzw. hat nicht mehr die erwartete Version (update). */
export type WriteResult = 'ok' | 'conflict';

/** Zugriff auf den eigenen Stand. Netzfehler werfen (der Abgleich versucht es später erneut). */
export interface SyncBackend {
  fetch(): Promise<RemoteSave | null>;
  insert(row: SaveWrite): Promise<WriteResult>;
  /** Schreibt nur, wenn die Cloud noch `expected` als Version hat. */
  update(expected: number, row: SaveWrite): Promise<WriteResult>;
  /**
   * Meldet Änderungen am eigenen Stand. `null` = Verbindung (neu) aufgebaut – dazwischen
   * kann etwas verpasst worden sein. Rückgabe: Abo beenden.
   */
  subscribe(listener: (change: RemoteMeta | null) => void): () => void;
}

export interface AccountUser {
  /** Benutzername (klein geschrieben, eindeutig). */
  name: string;
}

/** Warum Anmelden oder Registrieren nicht geklappt hat. */
export type AccountErrorCode =
  | 'invalid-username'
  | 'invalid-password'
  | 'taken'
  | 'credentials'
  | 'rate-limited'
  | 'network'
  | 'unauthorized'
  | 'server';

export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(code);
  }
}

/** Anmeldung mit Benutzername und Passwort und Zugang zum Stand des angemeldeten Kontos. */
export interface AccountService {
  currentUser(): Promise<AccountUser | null>;
  /** Anmeldung verloren (z. B. Sitzung abgelaufen) oder neu. */
  onUserChange(listener: (user: AccountUser | null) => void): void;
  signIn(username: string, password: string): Promise<AccountUser>;
  register(username: string, password: string): Promise<AccountUser>;
  signOut(): Promise<void>;
  backend(user: AccountUser): SyncBackend;
}
