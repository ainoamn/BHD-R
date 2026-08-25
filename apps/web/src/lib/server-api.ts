import 'server-only';
import { cookies, headers } from 'next/headers';
import { ApiError } from './api';

const apiOrigin =
  process.env.API_INTERNAL_ORIGIN ?? process.env.API_ORIGIN ?? 'http://localhost:4000';

export { ApiError };

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/')) throw new Error('API path must be absolute');
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      cookie: cookieStore.toString(),
      'x-request-id': requestHeaders.get('x-request-id') ?? crypto.randomUUID(),
      ...init.headers,
    },
    cache: init.cache ?? 'no-store',
  });
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
  const response = await fetch(`${apiOrigin}${path}`, {
    headers: { accept: 'application/json' },
    next: { revalidate, tags },
  });
  if (!response.ok)
    throw new ApiError(response.status, 'public_api_error', 'Public data is unavailable');
  return response.json() as Promise<T>;
}
