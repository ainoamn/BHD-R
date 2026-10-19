/**
 * In-memory accounting API cache + in-flight dedupe so nav hover and the hub
 * share one request storm, and revisits paint from memory without flicker.
 */

const FRESH_TTL_MS = 45_000;
const RETAIN_TTL_MS = 30 * 60_000;

type Entry = { data: unknown; savedAt: number };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

function pathKey(path: string): string {
  return path.split('?')[0] ?? path;
}

export function getAccountingCache<T>(path: string): T | null {
  const hit = store.get(pathKey(path));
  if (!hit) return null;
  if (Date.now() - hit.savedAt > RETAIN_TTL_MS) {
    store.delete(pathKey(path));
    return null;
  }
  return hit.data as T;
}

export function isAccountingCacheFresh(path: string): boolean {
  const hit = store.get(pathKey(path));
  return Boolean(hit && Date.now() - hit.savedAt <= FRESH_TTL_MS);
}

export function setAccountingCache(path: string, data: unknown): void {
  store.set(pathKey(path), { data, savedAt: Date.now() });
}

export function invalidateAccountingCache(prefix = '/api/owner/accounting'): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

/** Shared GET with dedupe; always network unless `preferCache` and fresh. */
export async function fetchAccountingJson<T>(
  path: string,
  opts?: { preferCache?: boolean; signal?: AbortSignal },
): Promise<T> {
  const key = pathKey(path);
  if (opts?.preferCache) {
    const cached = getAccountingCache<T>(path);
    if (cached !== null && isAccountingCacheFresh(path)) return cached;
  }
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const request = (async () => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { messageAr?: string; message?: string; code?: string };
      } | null;
      throw new Error(
        payload?.error?.messageAr ?? payload?.error?.message ?? payload?.error?.code ?? 'request_failed',
      );
    }
    const data = (await response.json()) as T;
    setAccountingCache(path, data);
    return data;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, request);
  return request;
}

const WARM_PATHS = [
  '/api/owner/accounting/hub',
  '/api/owner/accounting/cheques',
  '/api/owner/accounting/documents',
  '/api/owner/accounting/journals',
  '/api/owner/accounting/accounts',
  '/api/owner/accounting/expenses',
  '/api/owner/accounting/periods',
  '/api/owner/accounting/audit',
] as const;

/** Prefetch on nav hover / focus — does not block UI. */
export function warmAccountingHub(): Promise<void> {
  return Promise.all(
    WARM_PATHS.map((path) =>
      fetchAccountingJson(path, { preferCache: true }).catch(() => undefined),
    ),
  ).then(() => undefined);
}
