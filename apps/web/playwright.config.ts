import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const e2eSessionSecret = 'e2e-session-secret-is-local-and-at-least-32-characters';

/** Next production server for fixture e2e — strip CI DB URLs and force production mode. */
function webServerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    env[key] = value;
  }
  // Job-level CI sets NODE_ENV=test and DATABASE_URL to a migrated (empty) DB.
  // Playwright merges webServer.env with process.env, so delete is not enough —
  // blank the URLs so hasDatabaseUrl() is false for next start.
  for (const key of [
    'DATABASE_URL',
    'SYSTEM_DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'TEST_DATABASE_URL',
    'TEST_MIGRATION_DATABASE_URL',
    'WORKER_DATABASE_URL',
  ] as const) {
    env[key] = '';
  }
  env.NODE_ENV = 'production';
  // Match CI e2e build: non-standalone next start must see fixture flags at runtime.
  env.VERCEL = '1';
  env.BHD_R_SESSION_SECRET = e2eSessionSecret;
  env.BHD_R_OIDC_STATE_SECRET = e2eSessionSecret;
  env.CSRF_SECRET = e2eSessionSecret;
  env.API_ORIGIN = 'http://127.0.0.1:4000';
  env.STAYS_PLATFORM_ENABLED = 'false';
  env.E2E_FORCE_NEST_FIXTURES = '1';
  return env;
}

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
            env: webServerEnv(),
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
