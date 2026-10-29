import { DEFAULT_IDENTITY_ISSUER } from '@/lib/bhd/identity-public';
import { BHD_APPS, type BhdApp, type BhdAppMode } from '@/lib/bhd/apps';

export const IDENTITY_CATALOG_URL = `${DEFAULT_IDENTITY_ISSUER}/api/bhd/catalog`;
export const BHD_CATALOG_EVENT = 'bhd-catalog';

export type BhdCatalogPayload = {
  spec?: string;
  live?: boolean;
  apps?: unknown;
  hops?: string[];
};

let cache: BhdApp[] | null = null;

function asMode(value: unknown): BhdAppMode {
  return value === 'identity' || value === 'browse' || value === 'sso' ? value : 'sso';
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asNullableString(value: unknown) {
  const text = asString(value);
  return text || null;
}

/** Map identity catalog rows into the product BhdApp shape. */
export function normalizeCatalogApps(raw: unknown): BhdApp[] {
  if (!Array.isArray(raw)) return [];
  const apps: BhdApp[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const id = asString(item.id);
    const origin = asString(item.origin).replace(/\/$/, '');
    if (!id || !origin) continue;
    const workspacePath = asString(item.workspacePath, '/') || '/';
    const path = workspacePath.startsWith('/') ? workspacePath : `/${workspacePath}`;
    const startUrl =
      asNullableString(item.startUrl) ||
      (asMode(item.mode) === 'sso'
        ? `${origin}/api/auth/bhd/start?returnTo=${encodeURIComponent(path)}`
        : null);
    apps.push({
      id,
      clientId: asNullableString(item.clientId),
      nameAr: asString(item.nameAr, id),
      nameEn: asString(item.nameEn, id),
      origin,
      workspacePath: path,
      startUrl,
      mode: asMode(item.mode),
      enabled: item.enabled !== false,
      mark: asString(item.mark, id.slice(0, 2).toUpperCase()),
      accent: asString(item.accent, '#075c45'),
      soft: asString(item.soft, '#e6f1ec'),
    });
  }
  return apps.sort((a, b) => {
    const ao =
      typeof (a as BhdApp & { sortOrder?: number }).sortOrder === 'number'
        ? (a as BhdApp & { sortOrder?: number }).sortOrder!
        : apps.indexOf(a);
    const bo =
      typeof (b as BhdApp & { sortOrder?: number }).sortOrder === 'number'
        ? (b as BhdApp & { sortOrder?: number }).sortOrder!
        : apps.indexOf(b);
    return ao - bo;
  });
}

export function getCachedCatalogApps(): BhdApp[] {
  return cache && cache.length ? cache : BHD_APPS;
}

export function setCachedCatalogApps(apps: BhdApp[]) {
  if (!apps.length) return;
  cache = apps;
}

export function applyCatalogPayload(payload: unknown): BhdApp[] {
  const apps = Array.isArray(payload)
    ? normalizeCatalogApps(payload)
    : normalizeCatalogApps((payload as BhdCatalogPayload | null)?.apps);
  if (apps.length) setCachedCatalogApps(apps);
  return apps;
}

/** Client/server fetch of the live identity catalog. Falls back to the frozen copy. */
export async function fetchIdentityCatalog(): Promise<BhdApp[]> {
  try {
    const response = await fetch(IDENTITY_CATALOG_URL, {
      cache: 'no-store',
      next: { revalidate: 30 },
    });
    if (!response.ok) throw new Error(`catalog ${response.status}`);
    const body = (await response.json()) as BhdCatalogPayload;
    const apps = applyCatalogPayload(body);
    return apps.length ? apps : getCachedCatalogApps();
  } catch {
    return getCachedCatalogApps();
  }
}
