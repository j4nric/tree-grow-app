import { defineConfig, devices } from '@playwright/test';

// Minimale Typisierung statt @types/node als zusätzliche Abhängigkeit.
declare const process: { env: Record<string, string | undefined> };

/** Port über E2E_PORT einstellbar, damit lokal kein fremder Server (anderer Worktree) wiederverwendet wird. */
const PORT = Number(process.env.E2E_PORT ?? 4173);
/** Sync-Server für die Konto-Tests (server/, SQLite im Speicher) – Standard: Spiel-Port + 1. */
const SYNC_PORT = Number(process.env.E2E_SYNC_PORT ?? PORT + 1);
const CI = !!process.env.CI;

/**
 * End-to-End-Tests gegen den Produktions-Build (vite preview).
 * Nur Chromium – passt zu den vorinstallierten Browsern (PLAYWRIGHT_BROWSERS_PATH).
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'de-DE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      // Nur e2e/account.spec.ts spricht mit ihm (über window.__VSZW_SYNC_URL__); das Spiel
      // selbst ist ohne VITE_SYNC_URL gebaut und zeigt sonst kein Konto.
      command: 'npm --prefix server run build && node --disable-warning=ExperimentalWarning server/dist/index.js',
      url: `http://localhost:${SYNC_PORT}/api/health`,
      env: { PORT: String(SYNC_PORT), DB_PATH: ':memory:', ALLOWED_ORIGINS: `http://localhost:${PORT}` },
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
