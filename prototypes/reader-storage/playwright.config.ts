import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  timeout: 45000, expect: { timeout: 10000 },
  outputDir: '../../_scratch/m2/reader-storage/browser-results',
  reporter: [['list'], ['json', { outputFile: '../../_scratch/m2/reader-storage/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5314', headless: true,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] },
    trace: 'retain-on-failure' },
  webServer: { command: 'npm run test:serve', url: 'http://127.0.0.1:5314', reuseExistingServer: false, timeout: 30000 }
});
