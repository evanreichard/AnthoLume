import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 20000, expect: { timeout: 7000 },
  outputDir: '../../_scratch/m2/reader-isolation/browser-results',
  reporter: [['list'], ['json', {outputFile: '../../_scratch/m2/reader-isolation/browser-results.json'}]],
  use: { baseURL: 'http://127.0.0.1:5318', headless: true, launchOptions: { executablePath: process.env.CHROMIUM_PATH }, trace: 'retain-on-failure' },
  webServer: { command: process.env.M2_PRODUCTION === '1' ? 'npm run build && node scripts/serve.mjs' : 'npm run test:serve', url: 'http://127.0.0.1:5318', reuseExistingServer: false, timeout: 30000 }
});
