/// <reference types="vite/client" />

/** Build-Variablen des Spiels (alle optional). */
interface ImportMetaEnv {
  /** Adresse des Sync-Servers (Konto); ohne sie gibt es kein Konto. */
  readonly VITE_SYNC_URL?: string;
}

/** Gebaut mit VSZW_SW_KILL=1 (Not-Aus): keinen Service Worker anmelden, alte abmelden. */
declare const __VSZW_SW_KILL__: boolean;
