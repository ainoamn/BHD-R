import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  // Force re-import of the module under the restored env on the next test.
});

describe('requireOidcStateSecret', () => {
  it('requires a dedicated OIDC secret in production and never falls back to the session secret', async () => {
    // Prefer force flag — NODE_ENV is often read-only under Vitest/tsconfig.
    process.env.BHD_R_FORCE_PRODUCTION = '1';
    process.env.VERCEL_ENV = 'production';
    process.env.BHD_R_SESSION_SECRET = 'session-secret-that-is-long-enough-0123456789';
    delete process.env.BHD_R_OIDC_STATE_SECRET;

    vi.resetModules();
    const { requireOidcStateSecret } = await import('@/lib/runtime-env');
    expect(() => requireOidcStateSecret()).toThrow(/BHD_R_OIDC_STATE_SECRET_required/);
  });

  it('accepts a dedicated OIDC secret of at least 32 characters', async () => {
    process.env.BHD_R_FORCE_PRODUCTION = '1';
    process.env.VERCEL_ENV = 'production';
    process.env.BHD_R_OIDC_STATE_SECRET = 'oidc-state-secret-that-is-long-enough-0123';
    vi.resetModules();
    const { requireOidcStateSecret } = await import('@/lib/runtime-env');
    expect(requireOidcStateSecret()).toBe('oidc-state-secret-that-is-long-enough-0123');
  });
});
