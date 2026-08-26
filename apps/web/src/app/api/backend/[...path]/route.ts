import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function apiOrigin(): string | null {
  const value = process.env.API_INTERNAL_ORIGIN ?? process.env.API_ORIGIN;
  if (!value?.trim()) return null;
  return value.trim().replace(/\/$/, '');
}

function trustedWebOrigin(request: NextRequest): string {
  const configured =
    process.env.WEB_ORIGIN?.trim() ||
    process.env.PUBLIC_WEB_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  return request.nextUrl.origin.replace(/\/$/, '');
}

async function proxy(request: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const upstreamBase = apiOrigin();
  if (!upstreamBase) {
    return NextResponse.json(
      { error: { code: 'api_unconfigured', message: 'API_INTERNAL_ORIGIN is not set' } },
      { status: 503 },
    );
  }

  const suffix = pathSegments.map(encodeURIComponent).join('/');
  const target = new URL(`${upstreamBase}/${suffix}`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === 'origin' || lower.startsWith('sec-')) return;
    headers.set(key, value);
  });
  headers.set('origin', trustedWebOrigin(request));
  headers.set('x-forwarded-host', request.nextUrl.host);
  headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
    cache: 'no-store',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  // Fail fast when Nest is asleep/crashed — avoid 60–160s browser hangs on CSRF/save.
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  const timeoutMs = isRead ? 12_000 : 25_000;
  init.signal = AbortSignal.timeout(timeoutMs);

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'api_unreachable',
          message:
            'Nest API unreachable or timed out. Open Render → service Live, then https://bhd-r.onrender.com/healthz',
          messageAr:
            'تعذر الوصول إلى Nest أو انتهت المهلة. من Render تأكد أن الخدمة Live ثم افتح /healthz',
        },
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'transfer-encoding' || lower === 'connection') return;
    if (lower === 'set-cookie') return;
    responseHeaders.set(key, value);
  });

  const setCookies =
    typeof upstream.headers.getSetCookie === 'function'
      ? upstream.headers.getSetCookie()
      : [];
  for (const cookie of setCookies) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  if (!path?.length || path[0] !== 'v1') {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Only /api/backend/v1/* is allowed' } },
      { status: 404 },
    );
  }
  return proxy(request, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
