import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser',
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 4,
  fullyParallel: false,
  outputDir: '../../../../build/test-results/reader',
  reporter: [['list'], ['json', { outputFile: '../../../../build/test-results/reader/results.json' }]],
  use: {
    headless: true,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node src/reading/tests/generate-large.mjs --if-missing && node src/reading/tests/serve.mjs',
    cwd: '../../..',
    // Defer Base URL - Playwright reads this env var in its baseURL fixture after the server starts.
    wait: {
      stdout: /^Reader test server listening at (?<PLAYWRIGHT_TEST_BASE_URL>http:\/\/127\.0\.0\.1:\d+)\n/m,
    },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
