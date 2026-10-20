import type { BadgeChip } from '@/lib/badges-shared';
import type { MyTenancy } from '@/lib/tenancy-shared';

export const TENANT_SPACE_WARM_DONE_EVENT = 'bhd-r-tenant-space-warm-done';

export type TenantSpacePayload = {
  data: MyTenancy;
  badges: BadgeChip[];
  displayName: string;
  ownerPortal: 'owner' | 'developer' | null;
  failed: boolean;
};

type CacheEntry = { payload: TenantSpacePayload; savedAt: number };

const FRESH_TTL_MS = 5 * 60 * 1000;
const RETAIN_TTL_MS = 30 * 60 * 1000;
let entry: CacheEntry | null = null;
let inflight: Promise<TenantSpacePayload> | null = null;

export function getTenantSpaceCache(): TenantSpacePayload | null {
  if (!entry) return null;
  if (Date.now() - entry.savedAt > RETAIN_TTL_MS) {
    entry = null;
    return null;
  }
  return entry.payload;
}

export function isTenantSpaceCacheFresh(): boolean {
  return Boolean(entry && Date.now() - entry.savedAt <= FRESH_TTL_MS);
}

export function setTenantSpaceCache(payload: TenantSpacePayload): void {
  entry = { payload, savedAt: Date.now() };
}

export function invalidateTenantSpaceCache(): void {
  entry = null;
  inflight = null;
}

export async function warmTenantSpace(): Promise<TenantSpacePayload | null> {
  const cached = getTenantSpaceCache();
  if (cached && isTenantSpaceCacheFresh()) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch('/api/tenant/space', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error('tenant_space_failed');
      const body = (await response.json()) as TenantSpacePayload;
      setTenantSpaceCache(body);
      window.dispatchEvent(new CustomEvent(TENANT_SPACE_WARM_DONE_EVENT));
      return body;
    } finally {
      inflight = null;
    }
  })();
  try {
    return await inflight;
  } catch {
    return getTenantSpaceCache();
  }
}
