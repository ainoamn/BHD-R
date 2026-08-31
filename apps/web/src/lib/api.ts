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

let cachedNextCsrfToken: string | null = null;
let nextCsrfInflight: Promise<string> | null = null;
let cachedNestCsrfToken: string | null = null;
let nestCsrfInflight: Promise<string> | null = null;

export function clearBrowserCsrfCache(): void {
  cachedNextCsrfToken = null;
  nextCsrfInflight = null;
  cachedNestCsrfToken = null;
  nestCsrfInflight = null;
}

/**
 * CSRF for Next Route Handlers (`/api/owner/*`) — minted on Vercel with web CSRF_SECRET.
 * Do not reuse Nest-minted tokens here when secrets diverge.
 */
export async function fetchBrowserCsrfToken(force = false): Promise<string> {
  return getNextCsrfToken(force);
}

async function getNextCsrfToken(force = false): Promise<string> {
  if (!force && cachedNextCsrfToken) return cachedNextCsrfToken;
  if (!force && nextCsrfInflight) return nextCsrfInflight;
  nextCsrfInflight = (async () => {
    let response: Response;
    try {
      response = await fetch('/api/auth/csrf', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(
        0,
        'network_error',
        'تعذر إنشاء رمز الحماية. حدّث الصفحة أو سجّل الدخول مجدداً.',
      );
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string; messageAr?: string };
      } | null;
      throw new ApiError(
        response.status,
        payload?.error?.code ?? 'csrf_unavailable',
        payload?.error?.messageAr ??
          payload?.error?.message ??
          'تعذر إنشاء طلب آمن. سجّل الخروج وادخل مجدداً ثم أعد المحاولة.',
      );
    }
    const payload = (await response.json()) as { token?: string };
    if (!payload.token || payload.token.length < 16) {
      throw new ApiError(500, 'csrf_unavailable', 'تعذر إنشاء رمز الحماية.');
    }
    cachedNextCsrfToken = payload.token;
    return payload.token;
  })();
  try {
    return await nextCsrfInflight;
  } finally {
    nextCsrfInflight = null;
  }
}

/** CSRF for Nest mutations via BFF — minted by Nest `/v1/auth/csrf` (Render CSRF_SECRET). */
async function getNestCsrfToken(force = false): Promise<string> {
  if (!force && cachedNestCsrfToken) return cachedNestCsrfToken;
  if (!force && nestCsrfInflight) return nestCsrfInflight;
  nestCsrfInflight = (async () => {
    let csrfResponse: Response;
    try {
      csrfResponse = await fetch(browserApiPath('/v1/auth/csrf'), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(22_000),
        cache: 'no-store',
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
    cachedNestCsrfToken = csrf.token;
    // Nest Set-Cookie overwrites bhd_r_csrf — drop Next cache so owner writes remint next.
    cachedNextCsrfToken = null;
    return csrf.token;
  })();
  try {
    return await nestCsrfInflight;
  } finally {
    nestCsrfInflight = null;
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
      error?: { code?: string; message?: string | string[]; messageAr?: string; requestId?: string };
    } | null;
    const rawMessage = payload?.error?.message;
    const messageEn = Array.isArray(rawMessage) ? rawMessage.join(', ') : rawMessage;
    const csrfish =
      /csrf/i.test(`${payload?.error?.code ?? ''} ${messageEn ?? ''}`) ||
      payload?.error?.code === 'csrf_rejected';
    throw new ApiError(
      response.status,
      payload?.error?.code ?? (csrfish ? 'csrf_rejected' : 'api_error'),
      payload?.error?.messageAr ??
        (csrfish
          ? 'رمز الحماية مرفوض — حدّث الصفحة وأعد المحاولة'
          : messageEn && messageEn !== 'Request failed'
            ? messageEn
            : 'تعذر إكمال الطلب. أعد المحاولة أو تحقق من Nest.'),
      payload?.error?.requestId,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function browserMutation<T>(path: string, init: RequestInit): Promise<T> {
  const token = await getNestCsrfToken();
  try {
    return await browserMutationOnce<T>(path, init, token);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      /csrf/i.test(`${error.code} ${error.message}`)
    ) {
      clearBrowserCsrfCache();
      const fresh = await getNestCsrfToken(true);
      return browserMutationOnce<T>(path, init, fresh);
    }
    throw error;
  }
}

/**
 * Mutations against Next Route Handlers (`/api/owner/*`, `/api/public/*`, `/api/translate`).
 * Uses Vercel-minted CSRF — never Nest tokens (secrets diverge on Render).
 */
export async function browserNextMutation<T>(path: string, init: RequestInit): Promise<T> {
  if (!path.startsWith('/api/')) {
    throw new Error('Next mutation path must begin with /api/');
  }
  const run = async (csrfToken: string): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(path, {
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
    } catch {
      throw new ApiError(
        0,
        'network_error',
        'تعذر إكمال الطلب. تحقق من الشبكة ثم أعد المحاولة.',
      );
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string; messageAr?: string; requestId?: string };
      } | null;
      const csrfish =
        /csrf/i.test(`${payload?.error?.code ?? ''} ${payload?.error?.message ?? ''}`) ||
        payload?.error?.code === 'csrf_rejected';
      throw new ApiError(
        response.status,
        payload?.error?.code ?? (csrfish ? 'csrf_rejected' : 'api_error'),
        payload?.error?.messageAr ??
          (csrfish
            ? 'رمز الحماية مرفوض — حدّث الصفحة وأعد المحاولة'
            : payload?.error?.message ?? 'تعذر إكمال الطلب.'),
        payload?.error?.requestId,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  };

  const token = await getNextCsrfToken(true);
  try {
    return await run(token);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      /csrf/i.test(`${error.code} ${error.message}`)
    ) {
      clearBrowserCsrfCache();
      return run(await getNextCsrfToken(true));
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

export async function browserPublicMutation<T>(
  path: string,
  body: unknown,
  options?: { idempotencyKey?: string },
): Promise<T> {
  const response = await fetch(browserApiPath(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'idempotency-key': options?.idempotencyKey ?? crypto.randomUUID(),
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

export async function browserPublicGet<T>(path: string): Promise<T> {
  const response = await fetch(browserApiPath(path), {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'x-requested-with': 'BHD-R',
    },
    cache: 'no-store',
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
