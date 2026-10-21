/// <reference types="vite/client" />

/** Build-Variablen des Spiels (alle optional). */
interface ImportMetaEnv {
  /** Adresse des Sync-Servers (Konto); ohne sie gibt es kein Konto. */
  readonly VITE_SYNC_URL?: string;
}
