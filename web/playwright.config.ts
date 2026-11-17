import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  outputDir: '../_scratch/m3/frontend/browser-results',
  reporter: [['list'], ['json', { outputFile: '../_scratch/m3/frontend/browser-results.json' }]],
  use: {
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] },
  },
});
