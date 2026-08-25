/** Allowed browser origins for CORS + CSRF (web app → Nest via rewrite or direct). */

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, '');
}

/** Exact origins from env (WEB_ORIGIN, PUBLIC_WEB_ORIGIN, WEB_ORIGINS). */
export function configuredWebOrigins(): string[] {
  const values = [
    process.env.WEB_ORIGIN,
    process.env.PUBLIC_WEB_ORIGIN,
    process.env.PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    ...(process.env.WEB_ORIGINS ?? '').split(','),
  ];
  return [...new Set(values.map((v) => (v ? normalizeOrigin(v) : '')).filter(Boolean))];
}

/**
 * Vercel preview / alias hosts for this product (browser Origin on preview deployments).
 * Disable with WEB_ORIGIN_ALLOW_VERCEL_PREVIEWS=0
 */
export function isTrustedVercelWebOrigin(origin: string): boolean {
  if (process.env.WEB_ORIGIN_ALLOW_VERCEL_PREVIEWS === '0') return false;
  try {
    const url = new URL(normalizeOrigin(origin));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return (
      host === 'bhd-r-api.vercel.app' ||
      (host.startsWith('bhd-r-api-') && host.endsWith('.vercel.app'))
    );
  } catch {
    return false;
  }
}

export function isAllowedWebOrigin(origin: string | undefined): boolean {
  if (typeof origin !== 'string' || !origin.trim()) return true;
  const normalized = normalizeOrigin(origin);
  if (configuredWebOrigins().includes(normalized)) return true;
  return isTrustedVercelWebOrigin(normalized);
}

/**
 * Nest/Fastify CORS origin resolver (sync / async-compatible — not Express callback style).
 * Returns the request origin when allowed, otherwise false.
 */
export function resolveCorsOrigin(origin: string | undefined): boolean | string {
  if (!origin) return true;
  return isAllowedWebOrigin(origin) ? origin : false;
}
