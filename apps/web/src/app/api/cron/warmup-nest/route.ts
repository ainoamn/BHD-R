import { NextResponse } from 'next/server';
import { configuredApiOrigin, isNestApiConfiguredForRuntime } from '@/lib/server-api';
import { assertCronAuthorized } from '@/lib/route-rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Vercel Cron: ping Nest /healthz so Render does not stay cold between visits.
 * Requires CRON_SECRET (fail-closed) — Vercel sends Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: Request) {
  const auth = assertCronAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
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
    const response = await fetch(`${origin}/healthz`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'warmup_failed',
        ms: Date.now() - started,
      },
      { status: 503 },
    );
  }
}
