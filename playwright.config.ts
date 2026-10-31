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
    browserName: 'chromium',
    locale: 'es-ES',
    trace: 'retain-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173/', reuseExistingServer: true },
});
