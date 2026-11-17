import { defineConfig } from '@playwright/test';

const externalPreview = process.env.M2_BASE_URL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: externalPreview || 'http://127.0.0.1:5313',
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: externalPreview
    ? undefined
    : {
        command: 'npm run dev -- --port 5313',
        url: 'http://127.0.0.1:5313',
        reuseExistingServer: false,
        timeout: 30_000,
      },
});
