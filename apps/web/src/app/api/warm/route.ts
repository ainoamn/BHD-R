import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Free Render cold starts often exceed 50s; keep under Vercel route budget. */
export const maxDuration = 15;

/**
 * Nest wake-up for portal sessions (Render free-tier cold start).
 * Short budget so callers never hang navigations waiting for Render.
 */
export async function GET() {
  const origin = (process.env.API_INTERNAL_ORIGIN ?? process.env.API_ORIGIN ?? '')
    .trim()
    .replace(/\/$/, '');
  if (!origin || /localhost|127\.0\.0\.1|\.local$|\.internal$/i.test(origin)) {
    // A 204 response cannot have a JSON body (undici/Next throws at runtime).
    return new NextResponse(null, { status: 204 });
  }
  const started = Date.now();
  try {
    const response = await fetch(`${origin}/healthz`, {
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
