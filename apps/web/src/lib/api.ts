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

function networkFailureMessage(error: unknown): string {
  if (error instanceof TypeError || (error instanceof Error && /failed to fetch/i.test(error.message))) {
    return 'تعذر الاتصال بالخادم. تحقق من الشبكة أو أعد المحاولة بعد لحظات.';
  }
  if (error instanceof Error) return error.message;
  return 'request_failed';
}

export async function browserMutation<T>(path: string, init: RequestInit): Promise<T> {
  let csrfResponse: Response;
  try {
    csrfResponse = await fetch(browserApiPath('/v1/auth/csrf'), {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new ApiError(0, 'network_error', networkFailureMessage(error));
  }
  if (!csrfResponse.ok)
    throw new ApiError(
      csrfResponse.status,
      'csrf_unavailable',
      'Could not establish a secure request',
    );
  const csrf = (await csrfResponse.json()) as { token: string };
  let response: Response;
  try {
    response = await fetch(browserApiPath(path), {
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
  } catch (error) {
    throw new ApiError(0, 'network_error', networkFailureMessage(error));
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

/** PUT file to Nest media ingress (same-origin rewrite first, absolute Nest URL fallback). */
export async function browserMediaPut(
  intent: { uploadUrl: string; uploadPath?: string; requiredHeaders?: Record<string, string> },
  file: File,
): Promise<void> {
  const headers = Object.fromEntries(
    Object.entries(intent.requiredHeaders ?? {}).filter(
      ([name]) => name.toLowerCase() !== 'content-length',
    ),
  );
  headers['content-type'] = file.type || headers['content-type'] || 'application/octet-stream';

  const targets = [intent.uploadPath, intent.uploadUrl].filter(
    (value, index, list): value is string => Boolean(value) && list.indexOf(value) === index,
  );

  let lastError: unknown;
  for (const target of targets) {
    try {
      const uploaded = await fetch(target, {
        method: 'PUT',
        body: file,
        headers,
      });
      if (uploaded.ok) return;
      lastError = new Error(`upload_failed:${uploaded.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new ApiError(0, 'upload_network_error', networkFailureMessage(lastError));
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
