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
  if (
    error instanceof TypeError ||
    (error instanceof Error && /failed to fetch/i.test(error.message))
  ) {
    return 'تعذر الاتصال بالخادم. تحقق من الشبكة أو أعد المحاولة بعد لحظات.';
  }
  if (error instanceof Error) return error.message;
  return 'request_failed';
}

let cachedCsrfToken: string | null = null;
let csrfInflight: Promise<string> | null = null;

export function clearBrowserCsrfCache(): void {
  cachedCsrfToken = null;
  csrfInflight = null;
}

/** Expose CSRF for same-origin Next Route Handlers (owner media/properties). */
export async function fetchBrowserCsrfToken(force = false): Promise<string> {
  return getCsrfToken(force);
}

async function getCsrfToken(force = false): Promise<string> {
  if (!force && cachedCsrfToken) return cachedCsrfToken;
  if (!force && csrfInflight) return csrfInflight;
  csrfInflight = (async () => {
    // Always mint on Next/Vercel first. Nest-issued cookies can fail verification
    // when CSRF_SECRET differs between Render and Vercel.
    try {
      const local = await fetch('/api/auth/csrf', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      });
      if (local.ok) {
        const payload = (await local.json()) as { token?: string };
        if (payload.token && payload.token.length >= 16) {
          cachedCsrfToken = payload.token;
          return payload.token;
        }
      }
    } catch {
      /* fall through to Nest */
    }

    let csrfResponse: Response;
    try {
      csrfResponse = await fetch(browserApiPath('/v1/auth/csrf'), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(22_000),
      });
    } catch {
      throw new ApiError(
        0,
        'network_error',
        'تعذر إنشاء رمز الحماية. حدّث الصفحة أو سجّل الدخول مجدداً.',
      );
    }
    if (!csrfResponse.ok) {
      const payload = (await csrfResponse.json().catch(() => null)) as {
        error?: { code?: string; message?: string; messageAr?: string };
      } | null;
      const arMessage =
        payload?.error?.messageAr ??
        (csrfResponse.status === 502 || payload?.error?.code === 'api_unreachable'
          ? 'خادم Nest غير متاح حالياً (Render). افتح لوحة Render وأعد تشغيل/نشر الخدمة، ثم تحقق من /health/ready.'
          : 'تعذر إنشاء طلب آمن. سجّل الخروج وادخل مجدداً ثم أعد المحاولة.');
      throw new ApiError(
        csrfResponse.status,
        payload?.error?.code ?? 'csrf_unavailable',
        arMessage,
      );
    }
    const csrf = (await csrfResponse.json()) as { token: string };
    cachedCsrfToken = csrf.token;
    return csrf.token;
  })();
  try {
    return await csrfInflight;
  } finally {
    csrfInflight = null;
  }
}

async function browserMutationOnce<T>(
  path: string,
  init: RequestInit,
  csrfToken: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(browserApiPath(path), {
      ...init,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        'idempotency-key': crypto.randomUUID(),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(45_000),
    });
  } catch (error) {
    throw new ApiError(
      0,
      'network_error',
      'تعذر إكمال الطلب — Nest لا يستجيب. تحقق من Render ثم أعد المحاولة.',
    );
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; messageAr?: string; requestId?: string };
    } | null;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'api_error',
      payload?.error?.messageAr ?? payload?.error?.message ?? 'Request failed',
      payload?.error?.requestId,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function browserMutation<T>(path: string, init: RequestInit): Promise<T> {
  const token = await getCsrfToken();
  try {
    return await browserMutationOnce<T>(path, init, token);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      /csrf/i.test(`${error.code} ${error.message}`)
    ) {
      clearBrowserCsrfCache();
      const fresh = await getCsrfToken(true);
      return browserMutationOnce<T>(path, init, fresh);
    }
    throw error;
  }
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

/** Run async work over items with a fixed concurrency limit. */
export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        await worker(items[index]!, index);
      }
    }),
  );
}
