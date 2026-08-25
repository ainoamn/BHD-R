export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function browserApiPath(path: string): string {
  if (!path.startsWith('/v1/')) throw new Error('Browser API path must begin with /v1/');
  // Same-origin BFF → Nest. Rewrites Origin to WEB_ORIGIN so CSRF accepts preview + prod.
  return `/api/backend${path}`;
}

export async function browserMutation<T>(path: string, init: RequestInit): Promise<T> {
  const csrfResponse = await fetch(browserApiPath('/v1/auth/csrf'), {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!csrfResponse.ok)
    throw new ApiError(
      csrfResponse.status,
      'csrf_unavailable',
      'Could not establish a secure request',
    );
  const csrf = (await csrfResponse.json()) as { token: string };
  const response = await fetch(browserApiPath(path), {
    ...init,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf-token': csrf.token,
      'idempotency-key': crypto.randomUUID(),
      ...init.headers,
    },
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

export async function browserPublicMutation<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(browserApiPath(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
      'x-requested-with': 'BHD-R',
    },
    body: JSON.stringify(body),
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
