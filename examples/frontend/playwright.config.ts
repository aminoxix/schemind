import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config for the schemind demo.
 *
 * Boots both servers automatically:
 *  - the Go backend (`go run .`) on :8080
 *  - the Next.js dev server on :3000
 *
 * Run with: `pnpm e2e` (from examples/frontend).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'go run .',
      cwd: '../backend-go',
      url: 'http://localhost:8080/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
