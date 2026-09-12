import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    launchOptions: process.env.CITEFLOW_CHROMIUM
      ? {
          executablePath: process.env.CITEFLOW_CHROMIUM,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        }
      : {},
  },
  webServer: {
    command: 'npm run preview:browser',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
  reporter: 'list',
});
