import 'server-only';
import { cookies, headers } from 'next/headers';
import { ApiError } from './api';

export { ApiError };

const DEFAULT_DEV_API = 'http://localhost:4000';
/**
 * Keep portal pages responsive when Nest is asleep/unreachable.
 * Prefer empty/offline UI within ~8s over hanging 60–80s on Render cold starts.
 */
const FETCH_TIMEOUT_MS = 8_000;
const HEALTH_TIMEOUT_MS = 3_000;

export function configuredApiOrigin(): string | null {
  const value = process.env.API_INTERNAL_ORIGIN ?? process.env.API_ORIGIN;
  return value?.trim() ? value.replace(/\/$/, '') : null;
}

export function isLoopbackOrPrivate(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    );
  } catch {
    return true;
  }
}

/** True when Vercel can actually call a public Nest HTTPS origin (not localhost). */
export function isNestApiConfiguredForRuntime(): boolean {
  const configured = configuredApiOrigin();
  if (!configured) return false;
  if (process.env.VERCEL && isLoopbackOrPrivate(configured)) return false;
  if (process.env.VERCEL) {
    try {
      return new URL(configured).protocol === 'https:';
    } catch {
      return false;
    }
  }
  return true;
}

/** Prefer a reachable API. On Vercel, never block on localhost (hangs 20–70s). */
export async function resolveApiOrigin(): Promise<string> {
  const configured = configuredApiOrigin();
  if (configured) {
    if (process.env.VERCEL && isLoopbackOrPrivate(configured)) {
      // Fall through to same-origin so missing Nest fails fast (404) instead of TCP hang.
    } else {
      return configured;
    }
  } else if (!process.env.VERCEL) {
    return DEFAULT_DEV_API;
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const proto = requestHeaders.get('x-forwarded-proto') ?? (process.env.VERCEL ? 'https' : 'http');
  if (host) return `${proto}://${host.split(',')[0]!.trim()}`;
  return DEFAULT_DEV_API;
}

/** Unauthenticated probe — Nest process is up if /healthz returns 200 (Render platform health). */
export async function probeNestReady(): Promise<boolean> {
  if (!isNestApiConfiguredForRuntime()) return false;
  try {
    const origin = await resolveApiOrigin();
    const response = await fetch(`${origin}/healthz`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function mergeSignal(init?: RequestInit): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  if (!init?.signal) return timeout;
  return AbortSignal.any([init.signal, timeout]);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/')) throw new Error('API path must be absolute');
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const origin = await resolveApiOrigin();
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        cookie: cookieStore.toString(),
        'x-request-id': requestHeaders.get('x-request-id') ?? crypto.randomUUID(),
        ...init.headers,
      },
      cache: init.cache ?? 'no-store',
      signal: mergeSignal(init),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'API unreachable';
    throw new ApiError(503, 'api_unreachable', message);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; requestId?: string };
    } | null;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'api_error',
      payload?.error?.message ?? 'Request failed',
      payload?.error?.requestId,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function publicApiFetch<T>(
  path: string,
  revalidate = 60,
  tags: string[] = ['public-listings'],
): Promise<T> {
  if (!path.startsWith('/')) throw new Error('API path must be absolute');
  const origin = await resolveApiOrigin();
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      headers: { accept: 'application/json' },
      next: { revalidate, tags },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Public API unreachable';
    throw new ApiError(503, 'public_api_unreachable', message);
  }
  if (!response.ok)
    throw new ApiError(response.status, 'public_api_error', 'Public data is unavailable');
  return response.json() as Promise<T>;
}
