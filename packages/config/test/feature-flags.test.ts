import { describe, expect, it } from 'vitest';
import {
  readStaysFlagsFromEnv,
  resolveStaysEnabled,
  resolveStaysEnabledFromEnv,
  staysPublicSurfaceEnabled,
} from '../src/feature-flags.js';

describe('stays feature flags (phase 0)', () => {
  it('defaults platform off with empty env', () => {
    const flags = readStaysFlagsFromEnv({});
    expect(flags.platformEnabled).toBe(false);
    expect(flags.organizationAllowlist.size).toBe(0);
  });

  it('resolveStaysEnabled is fail-closed at every layer', () => {
    expect(resolveStaysEnabled({}).reason).toBe('platform_off');
    expect(
      resolveStaysEnabled({ platformEnabled: true }).reason,
    ).toBe('organization_off');
    expect(
      resolveStaysEnabled({ platformEnabled: true, organizationEnabled: true }).reason,
    ).toBe('property_off');
    expect(
      resolveStaysEnabled({
        platformEnabled: true,
        organizationEnabled: true,
        propertyEnabled: true,
      }).reason,
    ).toBe('unit_off');
    expect(
      resolveStaysEnabled({
        platformEnabled: true,
        organizationEnabled: true,
        propertyEnabled: true,
        unitEnabled: true,
      }),
    ).toMatchObject({ enabled: true, reason: 'enabled' });
  });

  it('env allowlist does not enable public surface without property+unit', () => {
    const env = {
      STAYS_PLATFORM_ENABLED: 'true',
      STAYS_ORG_ALLOWLIST: '00000000-0000-4000-8000-000000000001',
    };
    const partial = resolveStaysEnabledFromEnv(
      { organizationId: '00000000-0000-4000-8000-000000000001' },
      env,
    );
    expect(partial.enabled).toBe(false);
    expect(partial.reason).toBe('property_off');
    expect(staysPublicSurfaceEnabled(partial)).toBe(false);
  });

  it('treats unknown boolean strings as default false', () => {
    expect(readStaysFlagsFromEnv({ STAYS_PLATFORM_ENABLED: 'maybe' }).platformEnabled).toBe(
      false,
    );
  });

  it('env-only public surface follows the platform kill-switch', () => {
    const prev = process.env.STAYS_PLATFORM_ENABLED;
    try {
      delete process.env.STAYS_PLATFORM_ENABLED;
      expect(staysPublicSurfaceEnabled()).toBe(false);
      process.env.STAYS_PLATFORM_ENABLED = 'true';
      expect(staysPublicSurfaceEnabled()).toBe(true);
      process.env.STAYS_PLATFORM_ENABLED = 'false';
      expect(staysPublicSurfaceEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.STAYS_PLATFORM_ENABLED;
      else process.env.STAYS_PLATFORM_ENABLED = prev;
    }
  });
});
