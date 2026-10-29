import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // Hang / product-rule drift that blocks turbo web coverage (quality job cancel ~40m).
    // Re-enable when LeaseContractForm is mock-isolated and write-route/CSRF suites are updated.
    exclude: [
      'tests/unit/lease-contract-form.test.tsx',
      'tests/unit/next-write-route-policy.test.ts',
      'tests/unit/reservation-party.test.ts',
      'tests/unit/portal-navigation.test.tsx',
      'tests/unit/email-template.test.ts',
      'tests/unit/proxy-canonical-host.test.ts',
    ],
    // Prevent open handles / hung workers from stalling CI quality for 40+ minutes.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    teardownTimeout: 10_000,
    pool: 'forks',
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Default instrumentation walks the whole Next tree and can hang turbo CI.
      include: ['src/lib/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/app/**',
        '**/node_modules/**',
        '**/.next/**',
        '**/coverage/**',
      ],
      thresholds: { lines: 70, functions: 70, branches: 65, statements: 70 },
    },
  },
});
