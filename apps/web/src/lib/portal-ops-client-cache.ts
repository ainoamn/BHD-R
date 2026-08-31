import type { PortalRole } from '@/lib/types';
import type { OperationsSection, OperationsWorkspacePayload } from '@/lib/portal-ops-types';

type CacheEntry = {
  payload: OperationsWorkspacePayload;
  savedAt: number;
};

// Retain opened sections in memory so back/forward paints instantly. Keep the
// freshness window short and never persist private portal payloads to storage.
const FRESH_TTL_MS = 60 * 1000;
const RETAIN_TTL_MS = 15 * 60 * 1000;
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
  if (Date.now() - hit.savedAt > RETAIN_TTL_MS) {
    store.delete(key(portal, section));
    return null;
  }
  return hit.payload;
}

export function isOpsCacheFresh(portal: PortalRole, section: OperationsSection): boolean {
  const hit = store.get(key(portal, section));
  return Boolean(hit && Date.now() - hit.savedAt <= FRESH_TTL_MS);
}

export function setOpsCache(
  portal: PortalRole,
  section: OperationsSection,
  payload: OperationsWorkspacePayload,
): void {
  store.set(key(portal, section), { payload, savedAt: Date.now() });
}

/** Apply a warm-all batch into the in-memory nav cache. */
export function applyOpsCacheBatch(
  portal: PortalRole,
  sections: Partial<Record<string, OperationsWorkspacePayload>>,
): number {
  let applied = 0;
  for (const [section, payload] of Object.entries(sections)) {
    if (!payload || typeof payload !== 'object') continue;
    setOpsCache(portal, section as OperationsSection, payload);
    applied += 1;
  }
  return applied;
}

export async function warmAllOpsSections(portal: PortalRole): Promise<number> {
  try {
    const response = await fetch(`/api/portal/ops/${portal}/warm`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return 0;
    const body = (await response.json()) as {
      sections?: Partial<Record<string, OperationsWorkspacePayload>>;
    };
    if (!body.sections) return 0;
    return applyOpsCacheBatch(portal, body.sections);
  } catch {
    return 0;
  }
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
        signal: AbortSignal.timeout(6_000),
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

/** Warm a section without throwing; returning the task lets callers serialize it. */
export function warmOpsSection(
  portal: PortalRole,
  section: OperationsSection,
): Promise<OperationsWorkspacePayload | null> {
  const hit = getOpsCache(portal, section);
  if (hit && isOpsCacheFresh(portal, section)) return Promise.resolve(hit);
  return fetchOpsPayload(portal, section);
}
