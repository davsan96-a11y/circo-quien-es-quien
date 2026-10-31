import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:5173/';

export default defineConfig({
  testDir: './tests',
  timeout: 240_000,
  expect: { timeout: 12_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'es-ES',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // Motor de Safari (iPhone): las partidas completas también se prueban aquí
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: /(game|questions|resilience)\.spec\.ts/ },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173/', reuseExistingServer: true },
});
