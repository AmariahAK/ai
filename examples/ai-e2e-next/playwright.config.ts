import { devices, type PlaywrightTestConfig } from '@playwright/test';

const PORT = process.env.PORT ?? '3217';
const hostOrigin = `http://localhost:${PORT}`;

const config: PlaywrightTestConfig = {
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'],
    },
  ],
  use: {
    baseURL: hostOrigin,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm exec next dev --hostname 0.0.0.0 --port ${PORT}`,
    env: {
      MCP_APP_HOST_ORIGIN: hostOrigin,
    },
    url: hostOrigin,
    timeout: 120_000,
    reuseExistingServer: false,
  },
};

export default config;
