import { DEFAULT_IDENTITY_ISSUER } from '@/lib/bhd/identity-public';

export const IDENTITY_RUNTIME_URL = `${DEFAULT_IDENTITY_ISSUER}/api/bhd/runtime`;
export const IDENTITY_SCRIPT_URL = `${DEFAULT_IDENTITY_ISSUER}/bhd-identity.js`;

/** Fallback if the identity host is unreachable — matches live runtime (40 days). */
export const SESSION_MAX_AGE_FALLBACK = 40 * 24 * 60 * 60;

export type BhdIdentityRuntime = {
  spec?: string;
  live?: boolean;
  issuer?: string;
  script?: string;
  session?: {
    maxAgeSec?: number;
    maxAgeDays?: number;
    idleTimeout?: boolean;
    cookieNames?: string[];
    windowTokenKey?: string;
    windowSignedOutKey?: string;
  };
};

let cache: { at: number; maxAgeSec: number; runtime: BhdIdentityRuntime } | null = null;
const CACHE_MS = 5 * 60_000;

function acceptMaxAge(value: unknown) {
  return typeof value === 'number' && value > 0 ? Math.floor(value) : SESSION_MAX_AGE_FALLBACK;
}

/** Non-blocking: returns cache or fallback immediately; refreshes in the background. */
export function identitySessionMaxAgeSecCached() {
  if (cache) {
    if (Date.now() - cache.at > CACHE_MS) void identitySessionMaxAgeSec().catch(() => undefined);
    return cache.maxAgeSec;
  }
  void identitySessionMaxAgeSec().catch(() => undefined);
  return SESSION_MAX_AGE_FALLBACK;
}

/** Live session length from identity — do not hardcode in the product. */
export async function identitySessionMaxAgeSec(): Promise<number> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.maxAgeSec;
  try {
    const response = await fetch(IDENTITY_RUNTIME_URL, {
      cache: 'no-store',
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error(`runtime ${response.status}`);
    const runtime = (await response.json()) as BhdIdentityRuntime;
    const maxAgeSec = acceptMaxAge(runtime.session?.maxAgeSec);
    cache = { at: now, maxAgeSec, runtime };
    return maxAgeSec;
  } catch {
    if (cache) return cache.maxAgeSec;
    return SESSION_MAX_AGE_FALLBACK;
  }
}
