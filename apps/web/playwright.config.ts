import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const e2eSessionSecret = 'e2e-session-secret-is-local-and-at-least-32-characters';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: externalBaseUrl ?? 'http://127.0.0.1:3000', trace: 'on-first-retry' },
  ...(externalBaseUrl
    ? {}
    : {
        webServer: [
          {
            command: 'node tests/e2e/mock-api.mjs',
            url: 'http://127.0.0.1:4000/health',
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
          },
          {
            command: 'pnpm start',
            url: 'http://127.0.0.1:3000/ar',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: {
              ...process.env,
              BHD_R_SESSION_SECRET: e2eSessionSecret,
              BHD_R_OIDC_STATE_SECRET: e2eSessionSecret,
              CSRF_SECRET: e2eSessionSecret,
              API_ORIGIN: 'http://127.0.0.1:4000',
            },
          },
        ],
      }),
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
