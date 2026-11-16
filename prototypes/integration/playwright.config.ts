import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', workers: 1, fullyParallel: false,
  timeout: 30_000, expect: { timeout: 8_000 },
  outputDir: '../../_scratch/m2/integration/browser-results',
  reporter: [['list'], ['json', { outputFile: '../../_scratch/m2/integration/browser-results.json' }]],
  use: {
    headless: true,
    launchOptions: { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
  },
});
