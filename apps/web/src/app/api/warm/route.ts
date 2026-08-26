import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * Lightweight Nest wake-up for portal sessions (Render cold start).
 * Called from NestKeepAlive while the owner/developer/tenant UI is open.
 */
export async function GET() {
  const origin = (process.env.API_INTERNAL_ORIGIN ?? process.env.API_ORIGIN ?? '')
    .trim()
    .replace(/\/$/, '');
  if (!origin || /localhost|127\.0\.0\.1|\.local$|\.internal$/i.test(origin)) {
    return NextResponse.json({ ok: false, reason: 'api_unconfigured' }, { status: 204 });
  }
  const started = Date.now();
  try {
    const response = await fetch(`${origin}/health/ready`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
    });
  } catch {
    return NextResponse.json({ ok: false, ms: Date.now() - started }, { status: 502 });
  }
}
