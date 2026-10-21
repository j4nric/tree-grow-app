/// <reference types="vite/client" />

/** Build-Variablen des Spiels (alle optional). */
interface ImportMetaEnv {
  /** Adresse des Sync-Servers (Konto); ohne sie gibt es kein Konto. */
  readonly VITE_SYNC_URL?: string;
  /** Nur für e2e-Builds (playwright.config.ts): erlaubt das Abschalten der Tagesziele per `__VSZW_DAILY__`. */
  readonly VITE_E2E?: string;
}

/** Gebaut mit VSZW_SW_KILL=1 (Not-Aus): keinen Service Worker anmelden, alte abmelden. */
declare const __VSZW_SW_KILL__: boolean;
