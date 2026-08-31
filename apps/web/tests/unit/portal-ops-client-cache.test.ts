import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationsWorkspacePayload } from '@/lib/portal-ops-types';
import {
  getOpsCache,
  invalidateOpsCache,
  isOpsCacheFresh,
  setOpsCache,
  warmOpsSection,
} from '@/lib/portal-ops-client-cache';

const payload: OperationsWorkspacePayload = {
  records: [{ id: 'property-1' }],
  summary: {},
  secondary: [],
  context: {},
  apiOnline: true,
  nestConfigured: true,
  recordsEmpty: false,
  apiUnauthorized: false,
  dataFromDb: true,
  locale: 'ar',
};

afterEach(() => {
  invalidateOpsCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('portal operations memory cache', () => {
  it('keeps a visited section visible while distinguishing fresh from stale data', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T10:00:00.000Z'));
    setOpsCache('owner', 'properties', payload);

    expect(getOpsCache('owner', 'properties')).toBe(payload);
    expect(isOpsCacheFresh('owner', 'properties')).toBe(true);

    vi.advanceTimersByTime(61_000);
    expect(getOpsCache('owner', 'properties')).toBe(payload);
    expect(isOpsCacheFresh('owner', 'properties')).toBe(false);

    vi.advanceTimersByTime(15 * 60_000);
    expect(getOpsCache('owner', 'properties')).toBeNull();
  });

  it('does not request a section again while its cached data is fresh', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setOpsCache('owner', 'properties', payload);

    await expect(warmOpsSection('owner', 'properties')).resolves.toBe(payload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('coalesces concurrent warm requests for the same section', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      warmOpsSection('owner', 'properties'),
      warmOpsSection('owner', 'properties'),
    ]);

    expect(first).toEqual(payload);
    expect(second).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
