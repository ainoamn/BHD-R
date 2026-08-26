import { NextResponse } from 'next/server';
import { configuredApiOrigin, isNestApiConfiguredForRuntime } from '@/lib/server-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Vercel Cron: ping Nest /health/ready so Render does not stay cold between visits.
 * Secure with CRON_SECRET (Vercel sends Authorization: Bearer <CRON_SECRET>).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!isNestApiConfiguredForRuntime()) {
    return NextResponse.json({ ok: false, error: 'nest_not_configured' }, { status: 503 });
  }
  const origin = configuredApiOrigin();
  if (!origin) {
    return NextResponse.json({ ok: false, error: 'missing_api_origin' }, { status: 503 });
  }

  const started = Date.now();
  try {
    const response = await fetch(`${origin}/health/ready`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
    const body = await response.text().catch(() => '');
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      origin,
      body: body.slice(0, 200),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'warmup_failed',
        ms: Date.now() - started,
        origin,
      },
      { status: 503 },
    );
  }
}
