import { defineConfig, devices } from '@playwright/test';

// Minimale Typisierung statt @types/node als zusätzliche Abhängigkeit.
declare const process: { env: Record<string, string | undefined> };

const PORT = 4173;
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
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
