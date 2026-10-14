import { NextResponse } from 'next/server';
import { resolveAiEndpoint } from '@/lib/ai-chat';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { evaluateAllOrganizations } from '@/lib/badges-neon';
import { assertCronAuthorized } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Nightly: grant, expire and revoke badges in every organization. */
export async function GET(request: Request) {
  const auth = assertCronAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ ok: false, error: 'db_unconfigured' }, { status: 503 });
  }
  const started = Date.now();
  try {
    const ai = resolveAiEndpoint(request.headers.get('x-vercel-oidc-token'));
    const result = await evaluateAllOrganizations(ai, started + 50_000);
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
  } catch (error) {
    console.error('cron badges-evaluate', error);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
