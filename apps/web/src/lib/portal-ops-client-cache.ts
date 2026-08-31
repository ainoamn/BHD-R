import type { PortalRole } from '@/lib/types';
import type { OperationsSection, OperationsWorkspacePayload } from '@/lib/portal-ops-types';

type CacheEntry = {
  payload: OperationsWorkspacePayload;
  savedAt: number;
};

const TTL_MS = 5 * 60 * 1000;
const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<OperationsWorkspacePayload | null>>();

function key(portal: PortalRole, section: OperationsSection): string {
  return `${portal}:${section}`;
}

export function emptyOpsPayload(locale: 'ar' | 'en' = 'ar'): OperationsWorkspacePayload {
  return {
    records: [],
    summary: {},
    secondary: [],
    context: {},
    apiOnline: false,
    nestConfigured: true,
    recordsEmpty: true,
    apiUnauthorized: false,
    dataFromDb: false,
    locale,
  };
}

export function getOpsCache(
  portal: PortalRole,
  section: OperationsSection,
): OperationsWorkspacePayload | null {
  const hit = store.get(key(portal, section));
  if (!hit) return null;
  if (Date.now() - hit.savedAt > TTL_MS) {
    store.delete(key(portal, section));
    return null;
  }
  return hit.payload;
}

export function setOpsCache(
  portal: PortalRole,
  section: OperationsSection,
  payload: OperationsWorkspacePayload,
): void {
  store.set(key(portal, section), { payload, savedAt: Date.now() });
}

export function invalidateOpsCache(portal?: PortalRole, section?: OperationsSection): void {
  if (!portal) {
    store.clear();
    return;
  }
  if (!section) {
    for (const k of store.keys()) {
      if (k.startsWith(`${portal}:`)) store.delete(k);
    }
    return;
  }
  store.delete(key(portal, section));
}

export async function fetchOpsPayload(
  portal: PortalRole,
  section: OperationsSection,
): Promise<OperationsWorkspacePayload | null> {
  const cacheKey = key(portal, section);
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const task = (async () => {
    try {
      const response = await fetch(`/api/portal/ops/${portal}/${section}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as OperationsWorkspacePayload;
      setOpsCache(portal, section, payload);
      return payload;
    } catch {
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, task);
  return task;
}

/** Warm a section into memory without throwing. */
export function warmOpsSection(portal: PortalRole, section: OperationsSection): void {
  if (getOpsCache(portal, section)) return;
  void fetchOpsPayload(portal, section);
}
